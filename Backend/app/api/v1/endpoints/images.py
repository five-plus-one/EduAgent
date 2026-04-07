"""
会话图片管理端点 (API 3.8 ~ 3.12)
"""
import os
import uuid
import shutil
import asyncio

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, BackgroundTasks
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.api import deps
from app.models.user import User
from app.models.image import SessionImage
from app.models.session import SessionContext
from app.services.image_service import annotate_session_image, delete_session_image_data
from app.core.config import settings

router = APIRouter()

# 图片上传目录
_IMAGE_DIR = os.path.join(
    os.getcwd(),
    getattr(settings, "IMAGE_UPLOAD_DIR", "uploads/session_images")
)
os.makedirs(_IMAGE_DIR, exist_ok=True)

_ALLOWED_MIME = {"image/jpeg", "image/png", "image/webp", "image/gif"}
_MAX_SIZE = 10 * 1024 * 1024  # 10 MB


def _check_session(session_id: str, user: User, db: Session) -> SessionContext:
    ctx = db.query(SessionContext).filter(
        SessionContext.id == session_id,
        SessionContext.user_id == user.id
    ).first()
    if not ctx:
        raise HTTPException(status_code=404, detail="Session not found")
    return ctx


# ── 3.8 上传图片 ─────────────────────────────────────────────────────────────

@router.post("/{session_id}/images", status_code=201)
async def upload_session_image(
    session_id: str,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    label: str = Form(default=""),
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db),
):
    _check_session(session_id, current_user, db)

    # 验证 MIME
    mime = file.content_type or "image/jpeg"
    if mime not in _ALLOWED_MIME:
        raise HTTPException(status_code=400, detail=f"Unsupported image type: {mime}")

    # 读取并检查大小
    content = await file.read()
    if len(content) > _MAX_SIZE:
        raise HTTPException(status_code=400, detail="Image exceeds 10 MB limit")

    # 保存文件
    img_id = "img_" + uuid.uuid4().hex[:8]
    ext = os.path.splitext(file.filename or "")[1].lower() or ".jpg"
    safe_name = f"{img_id}{ext}"
    file_path = os.path.join(_IMAGE_DIR, safe_name)
    with open(file_path, "wb") as f:
        f.write(content)

    # 入库
    img = SessionImage(
        id=img_id,
        session_id=session_id,
        filename=file.filename or safe_name,
        file_path=file_path,
        mime_type=mime,
        file_size=len(content),
        label=label or None,
        annotate_status="pending",
    )
    db.add(img)
    db.commit()

    # 异步标注（BackgroundTasks 不直接支持 async，用 asyncio.create_task）
    background_tasks.add_task(_run_annotate, img_id)

    return {
        "image_id": img_id,
        "filename": img.filename,
        "file_size": img.file_size,
        "annotate_status": img.annotate_status,
        "preview_url": f"/api/v1/sessions/{session_id}/images/{img_id}/preview",
        "created_at": img.created_at,
    }


def _run_annotate(image_id: str):
    """在后台线程中运行异步标注任务。"""
    asyncio.run(annotate_session_image(image_id))


# ── 3.9 图片列表 ──────────────────────────────────────────────────────────────

@router.get("/{session_id}/images")
def list_session_images(
    session_id: str,
    page: int = 1,
    size: int = 20,
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db),
):
    _check_session(session_id, current_user, db)
    q = db.query(SessionImage).filter(
        SessionImage.session_id == session_id
    ).order_by(SessionImage.created_at.desc())
    total = q.count()
    items = q.offset((page - 1) * size).limit(size).all()
    return {
        "total": total,
        "items": [
            {
                "image_id": img.id,
                "filename": img.filename,
                "label": img.label,
                "preview_url": f"/api/v1/sessions/{session_id}/images/{img.id}/preview",
                "annotate_status": img.annotate_status,
                "tags": img.tags or [],
                "description": img.description,
                "created_at": img.created_at,
            }
            for img in items
        ],
    }


# ── 3.10 图片预览 ─────────────────────────────────────────────────────────────

@router.get("/{session_id}/images/{image_id}/preview")
def preview_session_image(
    session_id: str,
    image_id: str,
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db),
):
    _check_session(session_id, current_user, db)
    img = db.query(SessionImage).filter(
        SessionImage.id == image_id,
        SessionImage.session_id == session_id
    ).first()
    if not img or not os.path.exists(img.file_path):
        raise HTTPException(status_code=404, detail="Image not found")
    return FileResponse(img.file_path, media_type=img.mime_type)


# ── 3.11 删除图片 ─────────────────────────────────────────────────────────────

@router.delete("/{session_id}/images/{image_id}")
def delete_session_image(
    session_id: str,
    image_id: str,
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db),
):
    _check_session(session_id, current_user, db)
    img = db.query(SessionImage).filter(
        SessionImage.id == image_id,
        SessionImage.session_id == session_id
    ).first()
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")
    delete_session_image_data(db, image_id)
    return None


# ── 3.12 重试标注 ─────────────────────────────────────────────────────────────

@router.post("/{session_id}/images/{image_id}/annotate")
def retry_annotate_session_image(
    session_id: str,
    image_id: str,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db),
):
    _check_session(session_id, current_user, db)
    img = db.query(SessionImage).filter(
        SessionImage.id == image_id,
        SessionImage.session_id == session_id
    ).first()
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")

    img.annotate_status = "pending"
    db.commit()
    background_tasks.add_task(_run_annotate, image_id)
    return {"image_id": image_id, "annotate_status": "processing"}
