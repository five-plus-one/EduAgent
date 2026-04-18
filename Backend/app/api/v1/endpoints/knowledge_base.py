import os
import shutil
import uuid
import json
import mimetypes
import urllib.parse
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, BackgroundTasks, Form, Query
from fastapi.responses import FileResponse, RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from app.api import deps
from app.models.user import User
from app.models.document import Document
from app.services.document_processor_task import process_global_document_task, process_video_task
from app.services.vector_store import delete_document_vectors

# 支持浏览器内联预览的格式
_INLINE_EXTS = {
    ".pdf",
    ".png", ".jpg", ".jpeg", ".webp", ".gif",
    ".mp4", ".mov", ".webm", ".mkv",
    ".txt", ".md", ".csv",
}

class PatchDocumentRequest(BaseModel):
    """
    至少传一个字段：display_name （自定义显示名） 和/或 description（描述）。
    display_name 存入 metadata_json["display_name"]，不修改物理文件名 (filename)。
    """
    display_name: Optional[str] = Field(default=None, min_length=1, max_length=100,
                                        description="用户自定义显示名，1-100 字")
    description:  Optional[str] = Field(default=None, min_length=1, max_length=500,
                                        description="自定义描述，1-500 字")

    def model_post_init(self, __context):
        if self.display_name is None and self.description is None:
            raise ValueError("display_name 和 description 至少提供一个")

def _safe_path(file_path: str) -> str:
    """返回规范化绝对路径，供路径穿越检查使用。"""
    return os.path.realpath(os.path.abspath(file_path))

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
            "document_id":   d.id,
            "filename":      d.filename,
            "display_name":  (d.metadata_json or {}).get("display_name"),  # 用户自定义显示名
            "description":   (d.metadata_json or {}).get("description"),   # 用户自定义描述
            "status":        d.status,
            "progress":      d.progress,
            "summary":       d.summary,
            "metadata":      d.metadata_json,
            "created_at":    d.created_at,
            # 通用新字段
            "file_type":     getattr(d, "file_type", "document") or "document",
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


# ── PATCH 更新文档名称 / 描述 ───────────────────────────────────────────────

@router.patch("/documents/{doc_id}")
def patch_document(
    doc_id: str,
    body: PatchDocumentRequest,
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db),
):
    """更新文档自定义名称和/或描述，不影响物理文件名。"""
    doc = db.query(Document).filter(
        Document.id == doc_id, Document.user_id == current_user.id
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    meta = dict(doc.metadata_json or {})
    if body.display_name is not None:
        meta["display_name"] = body.display_name
    if body.description is not None:
        meta["description"] = body.description
    doc.metadata_json = meta
    db.commit()
    return {
        "document_id":  doc_id,
        "display_name": meta.get("display_name"),
        "description":  meta.get("description"),
    }


# ── 新增：下载原始文件 ─────────────────────────────────────────────────────────

@router.get("/documents/{doc_id}/download")
def download_document(
    doc_id: str,
    token: Optional[str] = Query(default=None),
    current_user: User = Depends(deps.get_current_user_or_token),
    db: Session = Depends(deps.get_db),
):
    """以 attachment 模式返回原始文件，触发浏览器下载对话框。支持 ?token= 降级鉴权。"""
    doc = db.query(Document).filter(
        Document.id == doc_id, Document.user_id == current_user.id
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if not doc.file_path or not os.path.exists(doc.file_path):
        raise HTTPException(status_code=404, detail="File not found on disk")

    # 路径穿越防护
    upload_root = _safe_path(UPLOAD_DIR)
    if not _safe_path(doc.file_path).startswith(upload_root):
        raise HTTPException(status_code=403, detail="Forbidden")

    encoded_name = urllib.parse.quote(doc.filename or "file", safe="")
    return FileResponse(
        path=doc.file_path,
        filename=doc.filename,
        media_type="application/octet-stream",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{encoded_name}",
        },
    )


# ── 新增：在线预览文件 ─────────────────────────────────────────────────────────

@router.get("/documents/{doc_id}/preview")
def preview_document(
    doc_id: str,
    token: Optional[str] = Query(default=None),
    current_user: User = Depends(deps.get_current_user_or_token),
    db: Session = Depends(deps.get_db),
):
    """
    内联预览文件。
    - PDF / 图片 / 视频 / 纯文本：Content-Disposition: inline，浏览器直接渲染。
    - 视频支持 Range 请求（Starlette FileResponse 原生支持）。
    - Office 等格式：302 重定向到 /download。
    支持 ?token= 降级鉴权（<iframe src=...> 场景）。
    """
    doc = db.query(Document).filter(
        Document.id == doc_id, Document.user_id == current_user.id
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if not doc.file_path or not os.path.exists(doc.file_path):
        raise HTTPException(status_code=404, detail="File not found on disk")

    # 路径穿越防护
    upload_root = _safe_path(UPLOAD_DIR)
    if not _safe_path(doc.file_path).startswith(upload_root):
        raise HTTPException(status_code=403, detail="Forbidden")

    ext = os.path.splitext(doc.filename or "")[1].lower()

    if ext not in _INLINE_EXTS:
        # 不支持内联的格式 → 重定向到下载
        qs = f"?token={urllib.parse.quote(token)}" if token else ""
        return RedirectResponse(
            url=f"/api/v1/knowledge-base/documents/{doc_id}/download{qs}",
            status_code=302,
        )

    mime_type, _ = mimetypes.guess_type(doc.filename or "")
    encoded_name = urllib.parse.quote(doc.filename or "file", safe="")
    return FileResponse(
        path=doc.file_path,
        media_type=mime_type or "application/octet-stream",
        headers={
            "Content-Disposition": f"inline; filename*=UTF-8''{encoded_name}",
            "Accept-Ranges": "bytes",       # 允许视频 Range 请求
            "Cache-Control": "private, max-age=3600",
        },
    )


# ── 关键帧图片 ───────────────────────────────────────────────────────────────

@router.get("/documents/{doc_id}/keyframes/{filename}")
def get_keyframe_image(
    doc_id:   str,
    filename: str,
    token:    Optional[str] = Query(default=None),
    current_user: User = Depends(deps.get_current_user_or_token),
    db:       Session = Depends(deps.get_db),
):
    """
    返回视频关键帧图片（JPEG）。
    支持 ?token= 降级鉴权，供 <img src="...?token=..."> 直接嵌入使用。
    """
    # 1. 鉴权：验证文档属于当前用户
    doc = db.query(Document).filter(
        Document.id == doc_id, Document.user_id == current_user.id
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    # 2. 文件名安全校验，只允许纯文件名字符，防止路径穿越
    import re as _re
    if not _re.match(r'^[\w\-]+\.(jpg|jpeg|png)$', filename, _re.IGNORECASE):
        raise HTTPException(status_code=400, detail="Invalid filename")

    # 3. 构造关键帧路径（与 process_video_task 中的 frames_dir 保持一致）
    #    file_path = uploads/global/{doc_id}.mp4
    #    frames    = uploads/global/vid_{doc_id}/frames/{filename}
    frames_dir = os.path.join(os.path.dirname(doc.file_path), f"vid_{doc_id}", "frames")
    frame_path = os.path.join(frames_dir, filename)

    # 4. 路径穿越防护
    upload_root = _safe_path(UPLOAD_DIR)
    if not _safe_path(frame_path).startswith(upload_root):
        raise HTTPException(status_code=403, detail="Forbidden")

    if not os.path.exists(frame_path):
        raise HTTPException(status_code=404, detail="Keyframe not found")

    return FileResponse(
        path=frame_path,
        media_type="image/jpeg",
        headers={"Cache-Control": "private, max-age=86400"},   # 关键帧不变，可缓存 1 天
    )
