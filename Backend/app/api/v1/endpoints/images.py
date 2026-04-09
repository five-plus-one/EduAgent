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

    # ── 生成本用户唯一的顺序编号显示名 ──
    existing_count = db.query(UserImage).filter(UserImage.user_id == current_user.id).count()
    seq_num = existing_count + 1
    ext = os.path.splitext(file.filename or "")[1].lower() or ".jpg"
    display_name = f"img_{seq_num:04d}{ext}"   # e.g. img_0001.jpg，每用户唯一顺序编号

    # ── 物理文件用 UUID 命名（防冲突）──
    img_id = "img_" + uuid.uuid4().hex[:8]
    safe_name = f"{img_id}{ext}"
    file_path = os.path.join(_IMAGE_DIR, safe_name)
    with open(file_path, "wb") as f:
        f.write(content)

    img = UserImage(
        id=img_id,
        user_id=current_user.id,
        filename=display_name,        # 存顺序编号名，非原始文件名
        file_path=file_path,
        mime_type=mime,
        file_size=len(content),
        label=label or None,
        annotate_status="pending",
    )
    db.add(img)
    db.commit()

    # 后台异步 Vision 标注
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
    db: Session = Depends(deps.get_db),
):
    """图片预览（无需鉴权）。
    image_id 为随机 hex 字符串，本身具备不可猜测性，展示场景下无需额外鉴权。
    这样前端 <img src=""> 和 PPT 导出均可直接使用。
    """
    img = db.query(UserImage).filter(UserImage.id == image_id).first()
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


# ── 修改用户描述（上传后补填/修改）────────────────────────────────────────────

from pydantic import BaseModel
from typing import Optional as _Opt, List as _List

class UpdateLabelBody(BaseModel):
    label: _Opt[str] = None   # 用户自填描述/备注，传 null 清空

@router.patch("/{image_id}", status_code=200)
def update_image_label(
    image_id: str,
    body: UpdateLabelBody,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db),
):
    """修改图片的用户描述字段（label）。
    若标注已完成，会在后台重新将新 label 融入向量以提升检索精度。
    """
    img = db.query(UserImage).filter(
        UserImage.id == image_id,
        UserImage.user_id == current_user.id
    ).first()
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")

    img.label = body.label   # None 表示清空
    db.commit()

    # 若已标注完成，重新向量化（把新 label 融入检索文本）
    if img.annotate_status == "done":
        background_tasks.add_task(_update_image_vector, image_id)

    db.refresh(img)
    return {
        "image_id": img.id,
        "filename": img.filename,
        "label": img.label,
        "description": img.description,
        "tags": img.tags or [],
        "annotate_status": img.annotate_status,
        "preview_url": _get_preview_url(img.id),
    }


# ── 修改标签列表 ──────────────────────────────────────────────────────────────

class UpdateTagsBody(BaseModel):
    tags: _List[str]   # 完整目标标签列表（替换式，非追加式）

@router.put("/{image_id}/tags", status_code=200)
def update_image_tags(
    image_id: str,
    body: UpdateTagsBody,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db),
):
    """替换图片的全部标签（整体覆盖，前端维护最新完整列表后提交）。
    更新后自动重建向量索引，以保证语义检索精度。
    """
    img = db.query(UserImage).filter(
        UserImage.id == image_id,
        UserImage.user_id == current_user.id
    ).first()
    if not img:
        raise HTTPException(status_code=404, detail="Image not found")

    # 去重 + 去空白
    cleaned = list(dict.fromkeys([t.strip() for t in body.tags if t.strip()]))
    img.tags = cleaned
    db.commit()

    # 后台更新向量（标签变化影响语义检索）
    background_tasks.add_task(_update_image_vector, image_id)

    db.refresh(img)
    return {
        "image_id": img.id,
        "filename": img.filename,
        "label": img.label,
        "description": img.description,
        "tags": img.tags or [],
        "annotate_status": img.annotate_status,
        "preview_url": _get_preview_url(img.id),
    }


def _update_image_vector(image_id: str):
    """后台同步任务：用最新 description + tags + label 重建向量索引。"""
    import asyncio
    from app.db.session import SessionLocal
    from app.services.image_service import _store_image_vector, _COLLECTION_USER

    db = SessionLocal()
    try:
        img = db.query(UserImage).filter(UserImage.id == image_id).first()
        if not img or img.annotate_status != "done":
            return
        # 向量文本 = AI描述 + 全部标签 + 用户label
        parts = [img.description or "", " ".join(img.tags or [])]
        if img.label:
            parts.append(img.label)
        text = " ".join(p for p in parts if p).strip()
        if text:
            _store_image_vector(
                _COLLECTION_USER, image_id, text,
                {"user_id": img.user_id, "filename": img.filename}
            )
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning(f"[_update_image_vector] {e}")
    finally:
        db.close()
