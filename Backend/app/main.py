from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from app.core.config import settings
from app.api.v1.api import api_router

from app.db.base_class import Base
from app.db.session import engine, SessionLocal
from sqlalchemy import text
from app.models.user import User
from app.models.session import SessionContext, Message, SessionFile
from app.models.document import Document
from app.models.generation import GenerationTask, Courseware
from app.models.image import UserImage, ImageLibrary  # 图片系统
from app.models.game import Game                        # 互动游戏
from app.models.game_share import GameShare             # 游戏分享短链接
from app.core import security

# Create tables
Base.metadata.create_all(bind=engine)

# ── 兼容旧数据库：新增视频字段列（已存在则忽略）──────────────────────
def _migrate_video_columns():
    _video_cols = [
        ("file_type",        "VARCHAR DEFAULT 'document'"),
        ("duration_sec",     "INTEGER"),
        ("process_stage",    "VARCHAR"),
        ("transcript_json",  "TEXT"),
        ("keyframes_json",   "TEXT"),
        ("video_summary",    "TEXT"),
    ]
    with engine.connect() as conn:
        for col, col_def in _video_cols:
            try:
                conn.execute(text(f"ALTER TABLE document ADD COLUMN {col} {col_def}"))
                conn.commit()
            except Exception:
                pass  # 列已存在，忽略

_migrate_video_columns()

app = FastAPI(
    title=settings.PROJECT_NAME,
    openapi_url=f"{settings.API_V1_STR}/openapi.json"
)

# Standardize JSON response wrapper as requested in API.md
# Note: For simple prototyping we can use a middleware, but for SSE we shouldn't wrap. 
# We'll stick to basic return models matching the spec.

# Set all CORS enabled origins
if settings.BACKEND_CORS_ORIGINS:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[str(origin) for origin in settings.BACKEND_CORS_ORIGINS],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

app.include_router(api_router, prefix=settings.API_V1_STR)

@app.get("/")
def root():
    return {"message": "Welcome to EduAgent Backend API. Please visit /docs for API documentation."}


# ── 短链接重定向 /s/{code} ── 302 → /play/{code} ────────────────────────────
from fastapi import Request
from fastapi.responses import RedirectResponse
from app.db.session import SessionLocal as _SL_share
from app.models.game_share import GameShare as _GameShare
from datetime import datetime, timezone

@app.get("/s/{code}")
def short_link_redirect(code: str):
    """
    短链接入口（无需登录）。
    - 有效链接 → 302 重定向到 /play/{code}，同时 view_count+1
    - 不存在   → 404 简洁 HTML 错误页
    - 已过期 / 已停用 → 410 Gone HTML 错误页
    """
    from fastapi.responses import HTMLResponse

    def _error_page(status: int, title: str, desc: str) -> HTMLResponse:
        html = f"""<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8">
<title>{title} · EduAgent</title>
<style>body{{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;
height:100vh;margin:0;background:#f8fafc;color:#1e293b}}
.card{{text-align:center;padding:48px 40px;background:#fff;border-radius:16px;
box-shadow:0 4px 24px rgba(0,0,0,.08);max-width:400px}}
h1{{font-size:3rem;margin:0 0 8px}}
h2{{font-size:1.2rem;font-weight:600;margin:0 0 12px}}
p{{color:#64748b;margin:0}}
</style></head><body><div class="card">
<h1>{'❌' if status==404 else '⏰'}</h1>
<h2>{title}</h2><p>{desc}</p>
</div></body></html>"""
        return HTMLResponse(content=html, status_code=status)

    db = _SL_share()
    try:
        share = db.query(_GameShare).filter(_GameShare.code == code).first()
        if not share:
            return _error_page(404, "链接不存在", "该分享链接不存在或已被删除")
        if not share.is_active:
            return _error_page(410, "链接已停用", "该分享链接已被创建者停用")
        if share.expires_at and share.expires_at < datetime.now(timezone.utc):
            return _error_page(410, "链接已过期", "该分享链接已超过有效期")
        # view_count + 1
        share.view_count = (share.view_count or 0) + 1
        db.commit()
    finally:
        db.close()

    return RedirectResponse(url=f"/play/{code}", status_code=302)

