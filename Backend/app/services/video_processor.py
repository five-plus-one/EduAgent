"""
video_processor.py — 视频处理核心服务

流水线：
  1. get_video_metadata()  — 解析时长/fps/分辨率
  2. extract_audio()       — FFmpeg 提取 MP3
  3. transcribe_whisper()  — Whisper API 语音转文字（支持超 25MB 长视频自动分段）
  4. extract_keyframes()   — FFmpeg 场景变化检测关键帧
  5. analyze_frames()      — Vision LLM（mimo-v2-omni）逐帧分析
  6. summarize_video()     — LLM 生成结构化视频摘要

FFmpeg 来源：imageio-ffmpeg pip 包，无需系统安装。
"""

import os
import re
import base64
import logging
import subprocess
from pathlib import Path
from typing import Optional

import requests

from app.core.config import settings

log = logging.getLogger(__name__)

# ── FFmpeg 路径（优先 imageio-ffmpeg 内置，回退到系统 PATH）──────────────
_FFMPEG_PATH: Optional[str] = None

def _get_ffmpeg() -> str:
    global _FFMPEG_PATH
    if _FFMPEG_PATH:
        return _FFMPEG_PATH
    try:
        import imageio_ffmpeg  # type: ignore
        _FFMPEG_PATH = imageio_ffmpeg.get_ffmpeg_exe()
        log.info(f"[video] Using imageio-ffmpeg binary: {_FFMPEG_PATH}")
        return _FFMPEG_PATH
    except Exception:
        pass
    import shutil
    path = shutil.which("ffmpeg")
    if path:
        _FFMPEG_PATH = path
        return _FFMPEG_PATH
    raise RuntimeError(
        "FFmpeg 未找到。请运行：pip install imageio-ffmpeg，或系统安装 FFmpeg。"
    )


# ── 1. 视频元数据 ──────────────────────────────────────────────────────────

def get_video_metadata(video_path: str) -> dict:
    """返回 {duration_sec, fps, width, height}（缺失字段不包含）。"""
    ffmpeg = _get_ffmpeg()
    result = subprocess.run(
        [ffmpeg, "-i", video_path],
        stderr=subprocess.PIPE, stdout=subprocess.PIPE,
        encoding="utf-8", errors="replace"
    )
    stderr = result.stderr
    meta: dict = {}

    m = re.search(r"Duration:\s*(\d+):(\d+):(\d+)\.(\d+)", stderr)
    if m:
        h, mn, s, _ = int(m.group(1)), int(m.group(2)), int(m.group(3)), int(m.group(4))
        meta["duration_sec"] = h * 3600 + mn * 60 + s

    m = re.search(r"(\d+(?:\.\d+)?)\s+fps", stderr)
    if m:
        meta["fps"] = float(m.group(1))

    m = re.search(r"(\d{3,4})x(\d{3,4})", stderr)
    if m:
        meta["width"], meta["height"] = int(m.group(1)), int(m.group(2))

    # 检查是否存在音频流
    meta["has_audio"] = "Audio:" in stderr

    return meta


# ── 2. 音频提取 ────────────────────────────────────────────────────────────

def extract_audio(video_path: str, output_path: str) -> bool:
    """从视频提取 MP3 音频。返回是否成功（无音轨则返回 False）。"""
    meta = get_video_metadata(video_path)
    if not meta.get("has_audio"):
        log.info("[video] No audio track found, skipping extraction")
        return False

    ffmpeg = _get_ffmpeg()
    result = subprocess.run(
        [ffmpeg, "-i", video_path, "-q:a", "0", "-map", "a", "-y", output_path],
        stderr=subprocess.PIPE, stdout=subprocess.PIPE
    )
    success = result.returncode == 0 and os.path.exists(output_path)
    if not success:
        log.warning(f"[video] Audio extraction failed: {result.stderr.decode(errors='replace')[-500:]}")
    return success


# ── 3. Whisper 语音转文字 ─────────────────────────────────────────────────

_WHISPER_MAX_BYTES   = 24 * 1024 * 1024   # 24MB（留 1MB 余量，对应 Whisper 25MB 限制）
_CHUNK_DURATION_SEC  = 20 * 60             # 20 分钟一块


def _split_audio_ffmpeg(audio_path: str, chunk_sec: int = _CHUNK_DURATION_SEC) -> list[tuple[str, float]]:
    """
    用 ffmpeg -f segment 将音频切成多段（无需 ffprobe）。
    返回 [(chunk_path, offset_sec), ...]，失败时返回 [(audio_path, 0.0)]。
    """
    ffmpeg = _get_ffmpeg()
    base   = os.path.splitext(audio_path)[0]
    pattern = f"{base}_chunk%03d.mp3"

    result = subprocess.run(
        [ffmpeg, "-i", audio_path,
         "-f", "segment", "-segment_time", str(chunk_sec),
         "-c", "copy", "-y", pattern],
        stderr=subprocess.PIPE, stdout=subprocess.PIPE,
    )
    if result.returncode != 0:
        log.warning(f"[video] ffmpeg segment failed: {result.stderr.decode(errors='replace')[-300:]}")
        return [(audio_path, 0.0)]

    chunks: list[tuple[str, float]] = []
    i = 0
    while True:
        chunk_path = f"{base}_chunk{i:03d}.mp3"
        if not os.path.exists(chunk_path):
            break
        chunks.append((chunk_path, float(i * chunk_sec)))
        i += 1

    return chunks if chunks else [(audio_path, 0.0)]


def transcribe_whisper(audio_path: str, language: str = "zh") -> list[dict]:
    """
    使用 Whisper API 将音频转写为字幕段列表。
    自动处理超 25MB 音频：用 ffmpeg 原生分段（不依赖 ffprobe / pydub）。
    返回 [{start: float, end: float, text: str}, ...]。
    """
    file_size = os.path.getsize(audio_path)
    segments: list[dict] = []

    if file_size <= _WHISPER_MAX_BYTES:
        # 小文件：直接发给 Whisper API
        _whisper_chunk(audio_path, segments, language, offset_sec=0.0)
    else:
        # 大文件：先用 ffmpeg 切块，再逐块转写
        log.info(f"[video] Audio {file_size/1024/1024:.1f} MB > 24 MB, splitting with ffmpeg...")
        chunks = _split_audio_ffmpeg(audio_path)
        for chunk_path, offset_sec in chunks:
            _whisper_chunk(chunk_path, segments, language, offset_sec=offset_sec)
            # 清理临时块（原文件本身不要删）
            if chunk_path != audio_path:
                try:
                    os.unlink(chunk_path)
                except OSError:
                    pass

    return segments


def _whisper_chunk(audio_path: str, out: list, language: str, offset_sec: float):
    """对单个音频块调用 Whisper API，将 segments 追加到 out。"""
    url = f"{settings.OPENAI_API_BASE.rstrip('/')}/audio/transcriptions"
    try:
        with open(audio_path, "rb") as f:
            resp = requests.post(
                url,
                headers={"Authorization": f"Bearer {settings.OPENAI_API_KEY}"},
                files={"file": (os.path.basename(audio_path), f, "audio/mpeg")},
                data={
                    "model": "whisper-1",
                    "language": language,
                    "response_format": "verbose_json",
                    "timestamp_granularities[]": "segment",
                },
                timeout=120,
            )
        if resp.status_code != 200:
            log.warning(f"[video] Whisper API error {resp.status_code}: {resp.text[:300]}")
            return
        data = resp.json()
        for seg in data.get("segments", []):
            out.append({
                "start": round(seg["start"] + offset_sec, 2),
                "end":   round(seg["end"]   + offset_sec, 2),
                "text":  seg["text"].strip(),
            })
    except Exception as e:
        log.warning(f"[video] Whisper transcription failed: {e}")


# ── 4. 关键帧提取 ─────────────────────────────────────────────────────────

def extract_keyframes(video_path: str, output_dir: str,
                      max_frames: int = 20) -> list[dict]:
    """
    使用 FFmpeg 场景变化检测提取关键帧（阈值 0.35）。
    若场景帧 < 3，降级为固定间隔（每 30s 一帧）。
    最多保留 max_frames 帧。
    返回 [{filename, path, timestamp_est}, ...]。
    """
    os.makedirs(output_dir, exist_ok=True)
    ffmpeg = _get_ffmpeg()
    out_pattern = os.path.join(output_dir, "frame_%04d.jpg")

    # 场景变化检测
    subprocess.run(
        [ffmpeg, "-i", video_path,
         "-vf", "select=gt(scene\\,0.35),scale=1280:-1",
         "-vsync", "vfr", "-y", out_pattern],
        stderr=subprocess.PIPE, stdout=subprocess.PIPE,
    )

    frames = sorted(f for f in os.listdir(output_dir) if f.endswith(".jpg"))

    if len(frames) < 3:
        # 清理后用固定间隔
        for f in frames:
            try:
                os.unlink(os.path.join(output_dir, f))
            except OSError:
                pass
        meta = get_video_metadata(video_path)
        duration = meta.get("duration_sec") or 60
        interval = max(10, duration // max_frames)
        subprocess.run(
            [ffmpeg, "-i", video_path,
             "-vf", f"fps=1/{interval},scale=1280:-1",
             "-y", out_pattern],
            stderr=subprocess.PIPE, stdout=subprocess.PIPE,
        )
        frames = sorted(f for f in os.listdir(output_dir) if f.endswith(".jpg"))

    # 如果帧数超过上限，均匀抽样
    if len(frames) > max_frames:
        step = max(1, len(frames) // max_frames)
        frames = frames[::step][:max_frames]

    # 估算时间戳（基于帧序号在总时长中的位置）
    meta = get_video_metadata(video_path)
    duration = meta.get("duration_sec") or 0
    n = len(frames)
    result = []
    for i, fname in enumerate(frames):
        result.append({
            "filename":      fname,
            "path":          os.path.join(output_dir, fname),
            "timestamp_est": round(duration * i / max(n - 1, 1)) if n > 1 else 0,
            "description":   None,
        })
    return result


# ── 5. Vision LLM 帧分析 ──────────────────────────────────────────────────

def analyze_frames(frames: list[dict], transcript_segments: list[dict],
                   vision_model: Optional[str] = None) -> list[dict]:
    """
    用 Vision LLM（mimo-v2-omni）分析每帧截图。
    为每帧附加 description 字段。
    """
    model = vision_model or settings.LLM_MODEL
    url   = f"{settings.OPENAI_API_BASE.rstrip('/')}/chat/completions"

    for frame in frames:
        path = frame.get("path", "")
        if not os.path.exists(path):
            frame["description"] = ""
            continue

        ts = frame.get("timestamp_est", 0)
        # 取该时间点前后 30s 的字幕上下文
        context = " ".join(
            seg["text"] for seg in transcript_segments
            if abs(seg["start"] - ts) <= 30
        ).strip()

        # 读取 base64 图片
        try:
            with open(path, "rb") as f:
                img_b64 = base64.b64encode(f.read()).decode()
        except Exception:
            frame["description"] = ""
            continue

        prompt = (
            "请分析这帧教学视频截图，描述画面内容"
            "（如 PPT 幻灯片、黑板板书、实验演示、公式推导等），"
            "并提取其中出现的关键知识点、公式或结论（100-200字）。"
        )
        if context:
            prompt += f"\n\n该时刻附近字幕：{context[:300]}"

        payload = {
            "model": model,
            "messages": [{
                "role": "user",
                "content": [
                    {"type": "image_url",
                     "image_url": {"url": f"data:image/jpeg;base64,{img_b64}"}},
                    {"type": "text", "text": prompt},
                ],
            }],
            "max_tokens": 400,
        }
        try:
            resp = requests.post(
                url,
                headers={"Authorization": f"Bearer {settings.OPENAI_API_KEY}",
                         "Content-Type": "application/json"},
                json=payload,
                timeout=60,
            )
            if resp.status_code == 200:
                frame["description"] = (
                    resp.json()["choices"][0]["message"]["content"] or ""
                )
            else:
                log.warning(f"[video] Vision LLM {resp.status_code}: {resp.text[:200]}")
                frame["description"] = ""
        except Exception as e:
            log.warning(f"[video] Frame analysis failed: {e}")
            frame["description"] = ""

    return frames


# ── 6. 综合摘要 ───────────────────────────────────────────────────────────

def summarize_video(transcript_segments: list[dict],
                    frame_descriptions: list[str],
                    title: str = "") -> str:
    """
    将字幕 + 帧描述综合，让 LLM 生成结构化视频摘要。
    包含：主要内容、核心知识点列表、重要公式/结论。
    """
    url = f"{settings.OPENAI_API_BASE.rstrip('/')}/chat/completions"

    # 截断避免 Token 超限
    transcript_text = "\n".join(
        f"[{seg['start']:.0f}s] {seg['text']}"
        for seg in transcript_segments[:120]
    )
    frames_text = "\n".join(
        f"关键帧{i + 1}: {desc}"
        for i, desc in enumerate(frame_descriptions)
        if desc
    )

    prompt = (
        "请根据以下教学视频的字幕和关键帧分析，生成结构化摘要，"
        "格式为：\n"
        "**主要内容**：（一段概述）\n"
        "**核心知识点**：（列表）\n"
        "**重要公式/结论**：（列表，若有）\n\n"
    )
    if title:
        prompt += f"视频标题：{title}\n\n"
    if transcript_text:
        prompt += f"【字幕节选】\n{transcript_text[:3000]}\n\n"
    if frames_text:
        prompt += f"【关键帧描述】\n{frames_text[:2000]}"

    payload = {
        "model": settings.LLM_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 1000,
    }
    try:
        resp = requests.post(
            url,
            headers={"Authorization": f"Bearer {settings.OPENAI_API_KEY}",
                     "Content-Type": "application/json"},
            json=payload,
            timeout=120,
        )
        if resp.status_code == 200:
            return resp.json()["choices"][0]["message"]["content"] or ""
    except Exception as e:
        log.warning(f"[video] Summarize failed: {e}")

    # 降级：拼接字幕前 2000 字
    return transcript_text[:2000]
