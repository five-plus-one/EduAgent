import os
import shutil
import uuid
import json
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, BackgroundTasks, Form
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from app.api import deps
from app.models.user import User
from app.models.document import Document
from app.services.document_processor_task import process_global_document_task, process_video_task
from app.services.vector_store import delete_document_vectors

router = APIRouter()
UPLOAD_DIR = os.path.join(os.getcwd(), "uploads", "global")
os.makedirs(UPLOAD_DIR, exist_ok=True)

# 支持的格式
_DOC_EXTS = {".pdf", ".docx", ".doc", ".pptx", ".txt", ".md", ".json", ".csv"}
_VIDEO_EXTS = {".mp4", ".mov", ".avi", ".webm", ".mkv", ".flv"}
_MAX_VIDEO_BYTES = 500 * 1024 * 1024   # 500 MB
_MAX_DOC_BYTES   = 100 * 1024 * 1024   # 100 MB

# 视频处理阶段 → 前端展示文案（由后端统一维护，避免前端硬编码）
_VIDEO_STAGE_LABELS: dict[str, str] = {
    "reading_metadata":      "🎬 读取视频信息...",
    "extracting_audio":      "🔊 提取音频...",
    "transcribing":          "🎵 语音识别中...",
    "transcribing_done":     "✅ 语音识别完成",
    "extracting_frames":     "🖼 提取关键帧...",
    "extracting_frames_done":"✅ 关键帧提取完成",
    "analyzing_frames":      "🤖 AI 分析画面...",
    "analyzing_frames_done": "✅ 画面分析完成",
    "summarizing":           "📋 生成摘要...",
    "summarizing_done":      "✅ 摘要生成完成",
    "indexing":              "📦 向量化索引中...",
    "done":                  "✅ 处理完成",
}


@router.post("/documents")
async def upload_global_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    metadata_json: str = Form(default="{}"),
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db)
):
    try:
        meta = json.loads(metadata_json)
    except Exception:
        meta = {}

    ext = os.path.splitext(file.filename or "")[1].lower()
    is_video = ext in _VIDEO_EXTS
    is_doc   = ext in _DOC_EXTS

    if not is_video and not is_doc:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的文件格式：{ext}。支持：PDF / DOCX / PPTX / TXT 及 MP4 / MOV / AVI / WebM。"
        )

    max_size = _MAX_VIDEO_BYTES if is_video else _MAX_DOC_BYTES
    doc_id = "doc_" + uuid.uuid4().hex[:8]
    safe_filename = f"{doc_id}{ext}"
    file_path = os.path.join(UPLOAD_DIR, safe_filename)

    # 写文件（同时统计大小）
    written = 0
    with open(file_path, "wb") as buf:
        chunk = await file.read(1024 * 1024)  # 1 MB 块读取
        while chunk:
            written += len(chunk)
            if written > max_size:
                buf.close()
                os.unlink(file_path)
                limit_mb = max_size // (1024 * 1024)
                raise HTTPException(status_code=413, detail=f"文件超过 {limit_mb} MB 限制。")
            buf.write(chunk)
            chunk = await file.read(1024 * 1024)

    new_doc = Document(
        id=doc_id,
        user_id=current_user.id,
        filename=file.filename,
        file_path=file_path,
        status="pending",
        metadata_json=meta,
        file_type="video" if is_video else "document",
    )
    db.add(new_doc)
    db.commit()

    if is_video:
        background_tasks.add_task(process_video_task, doc_id, current_user.id)
    else:
        background_tasks.add_task(process_global_document_task, doc_id, current_user.id)

    return {
        "document_id": doc_id,
        "status": "processing",
        "file_type": "video" if is_video else "document",
    }


@router.get("/documents")
def list_global_documents(
    page: int = 1,
    size: int = 20,
    status: str = None,
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db)
):
    query = db.query(Document).filter(Document.user_id == current_user.id)
    if status:
        query = query.filter(Document.status == status)

    total = query.count()
    docs = query.order_by(Document.created_at.desc()).offset((page - 1) * size).limit(size).all()

    items = []
    for d in docs:
        item = {
            "document_id":  d.id,
            "filename":     d.filename,
            "status":       d.status,
            "progress":     d.progress,
            "summary":      d.summary,
            "metadata":     d.metadata_json,
            "created_at":   d.created_at,
            # 通用新字段
            "file_type":    getattr(d, "file_type", "document") or "document",
        }
        # 视频专用字段
        if item["file_type"] == "video":
            stage = getattr(d, "process_stage", None)
            item.update({
                "duration_sec":   getattr(d, "duration_sec", None),
                "process_stage":  stage,
                "stage_label":    _VIDEO_STAGE_LABELS.get(stage) if stage else None,
                "transcript_json": getattr(d, "transcript_json", None),
                "keyframes_json":  getattr(d, "keyframes_json", None),
                "video_summary":   getattr(d, "video_summary", None),
            })
        items.append(item)

    return {
        "total":    total,
        "page":     page,
        "size":     size,
        "has_more": (page * size) < total,
        "items":    items,
    }

@router.put("/documents/{doc_id}")
def update_document_metadata(
    doc_id: str,
    metadata_json: dict,
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db)
):
    doc = db.query(Document).filter(
        Document.id == doc_id, Document.user_id == current_user.id
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    doc.metadata_json = metadata_json
    db.commit()
    return None


@router.delete("/documents/{doc_id}")
def delete_document(
    doc_id: str,
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db)
):
    doc = db.query(Document).filter(
        Document.id == doc_id, Document.user_id == current_user.id
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    delete_document_vectors(doc_id)

    if os.path.exists(doc.file_path):
        os.remove(doc.file_path)

    # 清理视频工作目录
    vid_dir = os.path.join(
        os.path.dirname(doc.file_path), f"vid_{doc_id}"
    )
    if os.path.exists(vid_dir):
        shutil.rmtree(vid_dir, ignore_errors=True)

    db.delete(doc)
    db.commit()
    return None


@router.post("/documents/{doc_id}/retry")
def retry_document_processing(
    doc_id: str,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db)
):
    """重新处理失败的文档（无需重新上传文件）。"""
    doc = db.query(Document).filter(
        Document.id == doc_id, Document.user_id == current_user.id
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if doc.status not in ("failed", "pending"):
        raise HTTPException(status_code=400, detail="只能对失败或未处理的文档重试")
    if not doc.file_path or not os.path.exists(doc.file_path):
        raise HTTPException(status_code=400, detail="原始文件不存在，请重新上传")

    # 视频重试：清理上次失败产生的临时工作目录（audio、关键帧等）
    file_type = getattr(doc, "file_type", "document") or "document"
    if file_type == "video":
        vid_dir = os.path.join(os.path.dirname(doc.file_path), f"vid_{doc_id}")
        if os.path.exists(vid_dir):
            shutil.rmtree(vid_dir, ignore_errors=True)

    doc.status = "pending"
    doc.progress = 0
    doc.summary = None
    doc.process_stage = None
    db.commit()

    if file_type == "video":
        background_tasks.add_task(process_video_task, doc_id, current_user.id)
    else:
        background_tasks.add_task(process_global_document_task, doc_id, current_user.id)

    return {"document_id": doc_id, "status": "processing"}
