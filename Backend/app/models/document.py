from sqlalchemy import Column, String, DateTime, Text, JSON, Integer, ForeignKey
from datetime import datetime, timezone
from app.db.base_class import Base

class Document(Base):
    __tablename__ = "document"
    id = Column(String, primary_key=True, index=True)
    user_id = Column(String, ForeignKey("user.id"), nullable=True, index=True)  # 归属用户，为 None 则是全局公开资料
    filename = Column(String, nullable=False)
    file_path = Column(String, nullable=False)
    status = Column(String, default="pending") # pending, processing, completed, failed
    progress = Column(Integer, default=0)
    summary = Column(Text, nullable=True)
    metadata_json = Column(JSON, default={})
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    # ── 视频专用字段 ────────────────────────────────────────────────
    file_type     = Column(String, default="document")   # "document" | "video"
    duration_sec  = Column(Integer, nullable=True)        # 视频总时长（秒）
    process_stage = Column(String, nullable=True)         # 细粒度阶段: transcribing/extracting_frames/...
    transcript_json  = Column(JSON, nullable=True)        # [{start, end, text}, ...]（Whisper 字幕段）
    keyframes_json   = Column(JSON, nullable=True)        # [{filename, timestamp, description}, ...]
    video_summary    = Column(Text, nullable=True)        # LLM 综合摘要
