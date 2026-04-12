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
    db: Session = SessionLocal()
    doc = db.query(Document).filter(Document.id == document_id).first()
    if not doc:
        db.close()
        return
        
    try:
        doc.status = "processing"
        doc.progress = 10
        db.commit()
        
        # 1. Extract text
        text = extract_text_from_file(doc.file_path, doc.filename)
        doc.progress = 40
        db.commit()
        
        # 2. Vectorize and store
        metadata = doc.metadata_json or {}
        metadata.update({"uploader_id": uploader_id, "filename": doc.filename, "source": "global"})
        store_document_vectors(text, document_id=doc.id, metadata=metadata)
        
        doc.progress = 100
        doc.status = "completed"
        doc.summary = f"Total length: {len(text)} characters extracted."
        db.commit()
    except Exception as e:
        doc.status = "failed"
        doc.summary = str(e)
        db.commit()
    finally:
        db.close()

def process_session_file_task(session_file_id: str):
    db: Session = SessionLocal()
    sf = db.query(SessionFile).filter(SessionFile.id == session_file_id).first()
    if not sf:
        db.close()
        return
        
    try:
        sf.status = "processing"
        sf.progress = 10
        db.commit()
        
        text = extract_text_from_file(sf.file_path, sf.filename)
        sf.progress = 50
        db.commit()
        
        # Vectorize and attribute to session file ID
        store_document_vectors(text, document_id=sf.id, metadata={"session_id": sf.session_id, "filename": sf.filename, "source": "session_local"})
        
        sf.progress = 100
        sf.status = "completed"
        db.commit()
    except Exception as e:
        sf.status = "failed"
        db.commit()


    finally:
        db.close()


# ── 视频异步处理任务 ────────────────────────────────────────────────────────

def process_video_task(document_id: str, uploader_id: str):
    """
    7 阶段视频处理流水线：
      音频提取 → Whisper 转文字 → 关键帧提取 → Vision LLM 帧分析 → 摘要 → 向量索引
    进度: 0 → 10 → 30 → 50 → 75 → 88 → 100
    """
    from app.services.video_processor import (
        get_video_metadata, extract_audio, transcribe_whisper,
        extract_keyframes, analyze_frames, summarize_video,
    )

    db: Session = SessionLocal()
    doc = db.query(Document).filter(Document.id == document_id).first()
    if not doc:
        db.close()
        return

    # 临时工作目录
    vid_dir = Path(doc.file_path).parent / f"vid_{document_id}"
    vid_dir.mkdir(exist_ok=True)

    def _commit(stage: str, progress: int, **kwargs):
        doc.process_stage = stage
        doc.progress = progress
        for k, v in kwargs.items():
            setattr(doc, k, v)
        db.commit()

    try:
        doc.status = "processing"
        db.commit()

        # ── Stage 1: 视频元数据 ──────────────────────────────────────
        _commit("reading_metadata", 5)
        meta = get_video_metadata(doc.file_path)
        meta_json = doc.metadata_json or {}
        meta_json.update({
            "uploader_id": uploader_id,
            "fps": meta.get("fps"),
            "width": meta.get("width"),
            "height": meta.get("height"),
            "file_type": "video",
        })
        doc.duration_sec = meta.get("duration_sec")
        doc.metadata_json = meta_json
        db.commit()

        # ── Stage 2: 音频提取 ────────────────────────────────────────
        _commit("extracting_audio", 10)
        audio_path = str(vid_dir / "audio.mp3")
        has_audio = extract_audio(doc.file_path, audio_path)

        # ── Stage 3: Whisper 转文字 ──────────────────────────────────
        _commit("transcribing", 15)
        transcript_segs: list[dict] = []
        if has_audio:
            transcript_segs = transcribe_whisper(audio_path)
            log.info(f"[video] {document_id}: {len(transcript_segs)} transcript segments")
        _commit("transcribing_done", 30, transcript_json=transcript_segs)

        # ── Stage 4: 关键帧提取 ──────────────────────────────────────
        _commit("extracting_frames", 35)
        frames_dir = str(vid_dir / "frames")
        frames = extract_keyframes(doc.file_path, frames_dir, max_frames=20)
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
        frame_descs = [f.get("description") or "" for f in frames]
        summary = summarize_video(transcript_segs, frame_descs, title=doc.filename)
        short_summary = summary[:500] + ("..." if len(summary) > 500 else "")
        _commit("summarizing_done", 88, video_summary=summary, summary=short_summary)

        # ── Stage 7: 向量索引（3 种 chunk 类型）─────────────────────
        _commit("indexing", 90)
        base_meta = {
            "uploader_id": uploader_id,
            "filename":    doc.filename,
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
        doc.status = "failed"
        doc.summary = str(e)[:500]
        try:
            db.commit()
        except Exception:
            pass
    finally:
        db.close()
