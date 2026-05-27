from sqlalchemy import Column, String, JSON, DateTime, Text, ForeignKey
from datetime import datetime, timezone
from app.db.base_class import Base


class TeacherProfile(Base):
    __tablename__ = "teacher_profile"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("user.id"), unique=True, index=True, nullable=False)

    # 教学风格标签，如 ["互动型", "案例驱动", "视觉化"]
    teaching_style_tags = Column(JSON, default=list)
    # 偏好记录，如 {"ppt风格": "简洁", "布局偏好": "图文并列"}
    preferences = Column(JSON, default=dict)
    # 常用学科/课程领域
    subject_domains = Column(JSON, default=list)
    # 历史对话中提取的关键需求摘要（滚动更新）
    needs_summary = Column(Text, default="")
    # 更新时间
    updated_at = Column(DateTime, onupdate=lambda: datetime.now(timezone.utc))
