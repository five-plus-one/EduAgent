"""
管理员图库端点 (API 7.1 ~ 7.5)
鉴权：请求头 X-Admin-Key: {ADMIN_SECRET_KEY}
"""
import os
import uuid
import asyncio

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, BackgroundTasks, Header
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.api import deps
from app.models.image import ImageLibrary
from app.services.image_service import annotate_library_image, delete_library_image_data
from app.core.config import settings

router = APIRouter()

_LIBRARY_DIR = os.path.join(
    os.getcwd(),
    getattr(settings, "IMAGE_LIBRARY_DIR", "uploads/image_library")
)
os.makedirs(_LIBRARY_DIR, exist_ok=True)

_ALLOWED_MIME = {"image/jpeg", "image/png", "image/webp", "image/gif"}
_ADMIN_KEY = getattr(settings, "ADMIN_SECRET_KEY", "admin_secret_change_me")


def _check_admin(x_admin_key: str = Header(default="")):
    if x_admin_key != _ADMIN_KEY:
        raise HTTPException(status_code=403, detail="Invalid admin key")


class BatchImportRequest(BaseModel):
    scan_dir: str
    category: str = "general"
    import_note: str = ""


def _run_annotate_lib(lib_id: str):
    asyncio.run(annotate_library_image(lib_id))


# ── 7.1 导入图片 ──────────────────────────────────────────────────────────────

@router.post("/image-library", status_code=201)
async def import_library_image(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    category: str = Form(default="general"),
    import_note: str = Form(default=""),
    x_admin_key: str = Header(default=""),
    db: Session = Depends(deps.get_db),
):
    _check_admin(x_admin_key)

    mime = file.content_type or "image/jpeg"
    content = await file.read()

    lib_id = "lib_" + uuid.uuid4().hex[:8]
    ext = os.path.splitext(file.filename or "")[1].lower() or ".jpg"
    safe_name = f"{lib_id}{ext}"
    file_path = os.path.join(_LIBRARY_DIR, safe_name)
    with open(file_path, "wb") as f:
        f.write(content)

    img = ImageLibrary(
        id=lib_id,
        filename=file.filename or safe_name,
        file_path=file_path,
        category=category,
        import_note=import_note or None,
        annotate_status="pending",
    )
    db.add(img)
    db.commit()

    background_tasks.add_task(_run_annotate_lib, lib_id)

    return {
        "lib_id": lib_id,
        "filename": img.filename,
        "category": img.category,
        "annotate_status": img.annotate_status,
    }


# ── 7.2 批量导入（目录扫描）──────────────────────────────────────────────────

@router.post("/image-library/batch")
def batch_import_library(
    body: BatchImportRequest,
    background_tasks: BackgroundTasks,
    x_admin_key: str = Header(default=""),
    db: Session = Depends(deps.get_db),
):
    _check_admin(x_admin_key)

    scan_path = os.path.join(os.getcwd(), body.scan_dir.lstrip("/\\"))
    if not os.path.isdir(scan_path):
        raise HTTPException(status_code=400, detail=f"Directory not found: {scan_path}")

    IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
    queued, skipped = 0, 0
    task_id = "batch_" + uuid.uuid4().hex[:8]

    for fname in os.listdir(scan_path):
        ext = os.path.splitext(fname)[1].lower()
        if ext not in IMAGE_EXTS:
            continue
        # 跳过已入库的同名文件
        if db.query(ImageLibrary).filter(ImageLibrary.filename == fname).first():
            skipped += 1
            continue

        src = os.path.join(scan_path, fname)
        lib_id = "lib_" + uuid.uuid4().hex[:8]
        dst = os.path.join(_LIBRARY_DIR, f"{lib_id}{ext}")
        import shutil
        shutil.copy2(src, dst)

        img = ImageLibrary(
            id=lib_id,
            filename=fname,
            file_path=dst,
            category=body.category,
            import_note=body.import_note or None,
            annotate_status="pending",
        )
        db.add(img)
        db.flush()
        background_tasks.add_task(_run_annotate_lib, lib_id)
        queued += 1

    db.commit()
    return {"queued": queued, "skipped": skipped, "task_id": task_id}


# ── 7.3 列表 ──────────────────────────────────────────────────────────────────

@router.get("/image-library")
def list_library_images(
    category: str = None,
    annotate_status: str = None,
    page: int = 1,
    size: int = 50,
    x_admin_key: str = Header(default=""),
    db: Session = Depends(deps.get_db),
):
    _check_admin(x_admin_key)
    q = db.query(ImageLibrary)
    if category:
        q = q.filter(ImageLibrary.category == category)
    if annotate_status:
        q = q.filter(ImageLibrary.annotate_status == annotate_status)
    total = q.count()
    items = q.order_by(ImageLibrary.created_at.desc()).offset((page - 1) * size).limit(size).all()
    return {
        "total": total,
        "items": [
            {
                "lib_id": img.id,
                "filename": img.filename,
                "category": img.category,
                "description": img.description,
                "tags": img.tags or [],
                "annotate_status": img.annotate_status,
                "preview_url": f"/api/v1/admin/image-library/{img.id}/preview",
                "created_at": img.created_at,
            }
            for img in items
        ],
    }


# ── 7.4 删除 ──────────────────────────────────────────────────────────────────

@router.delete("/image-library/{lib_id}")
def delete_library_image(
    lib_id: str,
    x_admin_key: str = Header(default=""),
    db: Session = Depends(deps.get_db),
):
    _check_admin(x_admin_key)
    img = db.query(ImageLibrary).filter(ImageLibrary.id == lib_id).first()
    if not img:
        raise HTTPException(status_code=404, detail="Library image not found")
    delete_library_image_data(db, lib_id)
    return None


# ── 7.5 预览（无需鉴权，lib_id 本身具备不可猜测性）─────────────────────────

@router.get("/image-library/{lib_id}/preview")
def preview_library_image(
    lib_id: str,
    db: Session = Depends(deps.get_db),
):
    img = db.query(ImageLibrary).filter(ImageLibrary.id == lib_id).first()
    if not img or not os.path.exists(img.file_path):
        raise HTTPException(status_code=404, detail="Library image not found")
    return FileResponse(img.file_path, media_type=img.mime_type or "image/jpeg")
