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
