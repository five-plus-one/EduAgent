from sqlalchemy import Column, String, Integer, JSON, ForeignKey, DateTime, Text
from datetime import datetime, timezone
from app.db.base_class import Base

class GenerationTask(Base):
    __tablename__ = "generation_task"
    id = Column(String, primary_key=True)
    session_id = Column(String, ForeignKey("session_context.id"), index=True)
    task_type = Column(String) # "generate" or "export"
    status = Column(String, default="generating") # generating, completed, failed
    stage = Column(String, nullable=True)
    progress = Column(Integer, default=0)
    result_data = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

class Courseware(Base):
    __tablename__ = "courseware"
    id = Column(String, primary_key=True)
    session_id = Column(String, ForeignKey("session_context.id"), unique=True)
    ppt_data = Column(JSON, nullable=True)
    word_markdown = Column(Text, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
