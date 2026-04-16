from sqlalchemy import Column, String, DateTime, ForeignKey, Text, Integer, JSON
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
from app.db.base_class import Base

class SessionContext(Base):
    __tablename__ = "session_context"
    id = Column(String, primary_key=True, index=True)
    user_id = Column(String, ForeignKey("user.id"), index=True)
    course_name = Column(String, nullable=True)
    target_audience = Column(String, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    # PPT 主题偏好持久化
    ppt_theme_key        = Column(String,   nullable=True)  # e.g. "ocean_depths"；NULL 表示自动
    ppt_custom_colors    = Column(JSON,     nullable=True)  # 自定义颜色字典；NULL 表示使用预设
    ppt_theme_updated_at = Column(DateTime, nullable=True)  # 最近一次修改的时间
    messages = relationship("Message", back_populates="session", cascade="all, delete-orphan")

class Message(Base):
    __tablename__ = "message"
    id = Column(String, primary_key=True)
    session_id = Column(String, ForeignKey("session_context.id"), index=True)
    role = Column(String) # 'user' or 'assistant'
    content = Column(Text)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    session = relationship("SessionContext", back_populates="messages")

class SessionFile(Base):
    __tablename__ = "session_file"
    id = Column(String, primary_key=True)
    session_id = Column(String, ForeignKey("session_context.id"), index=True)
    document_id = Column(String, ForeignKey("document.id"), nullable=True, index=True)
    filename = Column(String, nullable=False)
    file_path = Column(String, nullable=True)
    status = Column(String, default="pending") # processing, completed, failed
    intent_desc = Column(Text, nullable=True)
    progress = Column(Integer, default=0)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    session = relationship("SessionContext", backref="associated_files")
