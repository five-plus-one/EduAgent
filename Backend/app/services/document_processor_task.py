import os
import logging
from pathlib import Path
from sqlalchemy.orm import Session
from app.db.session import SessionLocal
from app.models.document import Document
from app.models.session import SessionFile
from app.services.document_parser import extract_text_from_file
from app.services.vector_store import store_document_vectors

log = logging.getLogger(__name__)

def process_global_document_task(document_id: str, uploader_id: str):
    # ── 初始化：取出必要字段后立即关闭 session ──────────────────────────────
    with SessionLocal() as _db:
        doc = _db.query(Document).filter(Document.id == document_id).first()
        if not doc:
            return
        file_path:  str  = doc.file_path
        filename:   str  = doc.filename or ""
        doc_id:     str  = doc.id
        meta_json:  dict = dict(doc.metadata_json or {})
        doc.status   = "processing"
        doc.progress = 10
        _db.commit()

    def _write(**fields):
        with SessionLocal() as _db:
            _doc = _db.query(Document).filter(Document.id == doc_id).first()
            if _doc:
                for k, v in fields.items():
                    setattr(_doc, k, v)
                _db.commit()

    try:
        text = extract_text_from_file(file_path, filename)
        _write(progress=40)

        meta_json.update({"uploader_id": uploader_id, "filename": filename, "source": "global"})
        store_document_vectors(text, document_id=doc_id, metadata=meta_json)

        _write(progress=100, status="completed",
               summary=f"Total length: {len(text)} characters extracted.")
    except Exception as e:
        log.exception(f"[doc] {document_id}: processing failed")
        _write(status="failed", summary=str(e)[:500])


def process_session_file_task(session_file_id: str):
    # ── 初始化：取出必要字段后立即关闭 session ──────────────────────────────
    with SessionLocal() as _db:
        sf = _db.query(SessionFile).filter(SessionFile.id == session_file_id).first()
        if not sf:
            return
        file_path:  str = sf.file_path
        filename:   str = sf.filename or ""
        sf_id:      str = sf.id
        session_id: str = sf.session_id
        sf.status   = "processing"
        sf.progress = 10
        _db.commit()

    def _write(**fields):
        with SessionLocal() as _db:
            _sf = _db.query(SessionFile).filter(SessionFile.id == sf_id).first()
            if _sf:
                for k, v in fields.items():
                    setattr(_sf, k, v)
                _db.commit()

    try:
        text = extract_text_from_file(file_path, filename)
        _write(progress=50)

        store_document_vectors(
            text, document_id=sf_id,
            metadata={"session_id": session_id, "filename": filename, "source": "session_local"},
        )
        _write(progress=100, status="completed")
    except Exception as e:
        log.exception(f"[session_file] {session_file_id}: processing failed")
        _write(status="failed", summary=str(e)[:500])


# ── 视频异步处理任务 ────────────────────────────────────────────────────────

def process_video_task(document_id: str, uploader_id: str):
    """
    7 阶段视频处理流水线：
      音频提取 → Whisper 转文字 → 关键帧提取 → Vision LLM 帧分析 → 摘要 → 向量索引
    进度: 0 → 10 → 30 → 50 → 75 → 88 → 100

    【Session 策略】每次写 DB 均创建独立的短命 Session，避免长寿命 Session
    因 identity map 过期导致 StaleDataError（多任务并发时常见）。
    """
    from app.services.video_processor import (
        get_video_metadata, extract_audio, transcribe_whisper,
        extract_keyframes, analyze_frames, summarize_video,
    )

    # ── 初始化：读取必要字段后立即关闭 session ─────────────────────────────
    with SessionLocal() as _init_db:
        doc = _init_db.query(Document).filter(Document.id == document_id).first()
        if not doc:
            log.warning(f"[video] {document_id}: document not found, aborting")
            return
        # 只取出纯 Python 值，不持有 ORM 对象
        file_path: str  = doc.file_path
        filename:  str  = doc.filename or ""
        meta_json: dict = dict(doc.metadata_json or {})
        doc.status   = "processing"
        doc.progress = 0
        _init_db.commit()

    vid_dir    = Path(file_path).parent / f"vid_{document_id}"
    audio_path = str(vid_dir / "audio.mp3")
    frames_dir = str(vid_dir / "frames")
    vid_dir.mkdir(exist_ok=True)

    def _commit(stage: str, progress: int, **kwargs):
        """每次都用新 session 写进度，彻底避免 StaleDataError。"""
        with SessionLocal() as _db:
            _doc = _db.query(Document).filter(Document.id == document_id).first()
            if not _doc:
                return
            _doc.process_stage = stage
            _doc.progress      = progress
            _doc.status        = kwargs.pop("status", "processing")
            for k, v in kwargs.items():
                setattr(_doc, k, v)
            _db.commit()

    def _fail(reason: str):
        """标记为失败，同样用新 session。"""
        with SessionLocal() as _db:
            _doc = _db.query(Document).filter(Document.id == document_id).first()
            if _doc:
                _doc.status  = "failed"
                _doc.summary = reason[:500]
                _db.commit()

    try:
        # ── Stage 1: 视频元数据 ──────────────────────────────────────
        _commit("reading_metadata", 5)
        meta = get_video_metadata(file_path)
        meta_json.update({
            "uploader_id": uploader_id,
            "fps":    meta.get("fps"),
            "width":  meta.get("width"),
            "height": meta.get("height"),
            "file_type": "video",
        })
        # duration_sec 单独写一次
        with SessionLocal() as _db:
            _doc = _db.query(Document).filter(Document.id == document_id).first()
            if _doc:
                _doc.duration_sec  = meta.get("duration_sec")
                _doc.metadata_json = meta_json
                _db.commit()

        # ── Stage 2: 音频提取 ────────────────────────────────────────
        _commit("extracting_audio", 10)
        has_audio = extract_audio(file_path, audio_path)

        # ── Stage 3: 语音转文字 ──────────────────────────────────────
        _commit("transcribing", 15)
        transcript_segs: list[dict] = []
        if has_audio:
            transcript_segs = transcribe_whisper(audio_path)
            log.info(f"[video] {document_id}: {len(transcript_segs)} transcript segments")
        _commit("transcribing_done", 30, transcript_json=transcript_segs)

        # ── Stage 4: 关键帧提取 ──────────────────────────────────────
        _commit("extracting_frames", 35)
        frames = extract_keyframes(file_path, frames_dir, max_frames=20)
        log.info(f"[video] {document_id}: {len(frames)} keyframes extracted")
        _commit("extracting_frames_done", 50)

        # ── Stage 5: Vision LLM 帧分析 ──────────────────────────────
        _commit("analyzing_frames", 52)
        frames = analyze_frames(frames, transcript_segs)
        keyframes_data = [
            {
                "filename":      f["filename"],
                "timestamp_est": f["timestamp_est"],
                "description":   f.get("description") or "",
            }
            for f in frames
        ]
        _commit("analyzing_frames_done", 75, keyframes_json=keyframes_data)

        # ── Stage 6: LLM 摘要 ────────────────────────────────────────
        _commit("summarizing", 78)
        frame_descs  = [f.get("description") or "" for f in frames]
        summary      = summarize_video(transcript_segs, frame_descs, title=filename)
        short_summary = summary[:500] + ("..." if len(summary) > 500 else "")
        _commit("summarizing_done", 88, video_summary=summary, summary=short_summary)

        # ── Stage 7: 向量索引 ────────────────────────────────────────
        _commit("indexing", 90)
        base_meta = {
            "uploader_id": uploader_id,
            "filename":    filename,
            "source":      "global",
            "file_type":   "video",
        }

        # A. 字幕分段（每 ~30s 合并为一个 chunk）
        if transcript_segs:
            window: list[str] = []
            window_start = transcript_segs[0]["start"]
            for seg in transcript_segs:
                window.append(seg["text"])
                if seg["end"] - window_start >= 30:
                    store_document_vectors(
                        " ".join(window), document_id=document_id,
                        metadata={**base_meta, "chunk_type": "transcript_segment",
                                  "timestamp_start": window_start},
                    )
                    window, window_start = [], seg["end"]
            if window:
                store_document_vectors(
                    " ".join(window), document_id=document_id,
                    metadata={**base_meta, "chunk_type": "transcript_segment",
                              "timestamp_start": window_start},
                )

        # B. 帧描述
        for i, kf in enumerate(keyframes_data):
            if kf["description"]:
                store_document_vectors(
                    kf["description"], document_id=document_id,
                    metadata={**base_meta, "chunk_type": "frame_description",
                              "frame_index": i, "timestamp": kf["timestamp_est"]},
                )

        # C. 综合摘要
        if summary:
            store_document_vectors(
                summary, document_id=document_id,
                metadata={**base_meta, "chunk_type": "video_summary"},
            )

        _commit("done", 100, status="completed")
        log.info(f"[video] {document_id}: processing complete")

    except Exception as e:
        log.exception(f"[video] {document_id}: processing failed")
        _fail(str(e))
