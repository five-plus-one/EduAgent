"""
用户图片素材库端点（绑定用户账户，跨对话共享）
路由前缀: /api/v1/users/me/images

API:
  POST   /users/me/images                  上传图片
  GET    /users/me/images                  列出图片
  GET    /users/me/images/{image_id}/preview   预览（支持 ?token= 绕过 Authorization header）
  DELETE /users/me/images/{image_id}       删除
  POST   /users/me/images/{image_id}/annotate  重试标注
"""
import os
import uuid
import asyncio

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, BackgroundTasks, Query
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.api import deps
from app.models.user import User
from app.models.image import UserImage
from app.services.image_service import annotate_user_image, delete_user_image_data
from app.core.config import settings

router = APIRouter()

_IMAGE_DIR = os.path.join(
    os.getcwd(),
    getattr(settings, "IMAGE_UPLOAD_DIR", "uploads/session_images")
)
os.makedirs(_IMAGE_DIR, exist_ok=True)

_ALLOWED_MIME = {"image/jpeg", "image/png", "image/webp", "image/gif"}
_MAX_SIZE = 10 * 1024 * 1024  # 10 MB


def _get_preview_url(image_id: str) -> str:
    return f"/api/v1/users/me/images/{image_id}/preview"


# ── 上传图片 ──────────────────────────────────────────────────────────────────

@router.post("", status_code=201)
async def upload_user_image(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    label: str = Form(default=""),
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db),
):
    mime = file.content_type or "image/jpeg"
    if mime not in _ALLOWED_MIME:
        raise HTTPException(status_code=400, detail=f"Unsupported image type: {mime}")

    content = await file.read()
    if len(content) > _MAX_SIZE:
        raise HTTPException(status_code=400, detail="Image exceeds 10 MB limit")

    img_id = "img_" + uuid.uuid4().hex[:8]
    ext = os.path.splitext(file.filename or "")[1].lower() or ".jpg"
    safe_name = f"{img_id}{ext}"
    file_path = os.path.join(_IMAGE_DIR, safe_name)
    with open(file_path, "wb") as f:
        f.write(content)

    img = UserImage(
        id=img_id,
        user_id=current_user.id,
        filename=file.filename or safe_name,
        file_path=file_path,
        mime_type=mime,
        file_size=len(content),
        label=label or None,
        annotate_status="pending",
    )
    db.add(img)
    db.commit()

    # 后台异步标注（文本推断式，必定成功）
    background_tasks.add_task(_run_annotate, img_id)

    return {
        "image_id": img_id,
        "filename": img.filename,
        "file_size": img.file_size,
        "label": img.label,
        "annotate_status": img.annotate_status,
        "preview_url": _get_preview_url(img_id),
        "created_at": img.created_at,
    }


def _run_annotate(image_id: str):
    asyncio.run(annotate_user_image(image_id))


# ── 图片列表 ──────────────────────────────────────────────────────────────────

@router.get("")
def list_user_images(
    page: int = 1,
    size: int = 20,
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db),
):
    q = db.query(UserImage).filter(
        UserImage.user_id == current_user.id
    ).order_by(UserImage.created_at.desc())
    total = q.count()
    items = q.offset((page - 1) * size).limit(size).all()
    return {
        "total": total,
        "items": [
            {
                "image_id": img.id,
                "filename": img.filename,
                "label": img.label,
                "preview_url": _get_preview_url(img.id),
                "annotate_status": img.annotate_status,
                "tags": img.tags or [],
                "description": img.description,
                "created_at": img.created_at,
            }
            for img in items
        ],
    }


# ── 图片预览 ──────────────────────────────────────────────────────────────────
# 支持两种鉴权方式：
#   1. Authorization: Bearer <token>  （标准方式，适合 XHR/fetch）
#   2. ?token=<token>                 （Query 参数方式，适合 <img src="...?token=...">）

@router.get("/{image_id}/preview")
def preview_user_image(
    image_id: str,
    token: str = Query(default=None, description="JWT token（可选，用于 <img src> 等不支持 header 的场景）"),
    current_user: User = Depends(deps.get_current_user_optional),
    db: Session = Depends(deps.get_db),
):
    # 若 header 鉴权失败但提供了 ?token=，尝试用 token 校验
    if current_user is None and token:
        from app.api.deps import get_user_from_token
        current_user = get_user_from_token(token, db)
    if current_user is None:
        raise HTTPException(status_code=401, detail="Not authenticated")

    img = db.query(UserImage).filter(
        UserImage.id == image_id,
        UserImage.user_id == current_user.id
    ).first()
    if not img or not os.path.exists(img.file_path):
        raise HTTPException(status_code=404, detail="Image not found")
    return FileResponse(img.file_path, media_type=img.mime_type)


# ── 删除图片 ──────────────────────────────────────────────────────────────────

@router.delete("/{image_id}", status_code=204)
def delete_user_image(
    image_id: str,
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db),
):
    img = db.query(UserImage).filter(
        UserImage.id == image_id,
        UserImage.user_id == current_user.id
    ).first()
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")
    delete_user_image_data(db, image_id)
    return None


# ── 重试标注 ──────────────────────────────────────────────────────────────────

@router.post("/{image_id}/annotate")
def retry_annotate_user_image(
    image_id: str,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db),
):
    img = db.query(UserImage).filter(
        UserImage.id == image_id,
        UserImage.user_id == current_user.id
    ).first()
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")

    img.annotate_status = "pending"
    db.commit()
    background_tasks.add_task(_run_annotate, image_id)
    return {"image_id": image_id, "annotate_status": "processing"}
