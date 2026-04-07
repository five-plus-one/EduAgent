from sqlalchemy import Column, String, DateTime, Text, JSON, Integer, ForeignKey, BigInteger
from datetime import datetime, timezone
from app.db.base_class import Base


class SessionImage(Base):
    """用户在某个会话中上传的图片素材。"""
    __tablename__ = "session_image"

    id             = Column(String, primary_key=True, index=True)          # img_xxxxxxxx
    session_id     = Column(String, ForeignKey("session_context.id"), index=True, nullable=False)
    filename       = Column(String, nullable=False)
    file_path      = Column(String, nullable=False)                         # 相对于 IMAGE_UPLOAD_DIR
    mime_type      = Column(String, default="image/jpeg")
    file_size      = Column(BigInteger, default=0)
    label          = Column(String, nullable=True)                          # 用户自填备注
    description    = Column(Text, nullable=True)                            # Vision LLM 生成의 描述
    tags           = Column(JSON, default=list)                             # Vision LLM 生成的标签列表
    vector_id      = Column(String, nullable=True)                          # ChromaDB document ID
    annotate_status = Column(String, default="pending")                     # pending/processing/done/failed
    created_at     = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class ImageLibrary(Base):
    """开发者预置的默认图片库（对普通用户不可见）。"""
    __tablename__ = "image_library"

    id             = Column(String, primary_key=True, index=True)          # lib_xxxxxxxx
    filename       = Column(String, nullable=False)
    file_path      = Column(String, nullable=False)
    category       = Column(String, default="general")                     # physics/chemistry/math/general
    description    = Column(Text, nullable=True)
    tags           = Column(JSON, default=list)
    vector_id      = Column(String, nullable=True)
    annotate_status = Column(String, default="pending")
    import_note    = Column(Text, nullable=True)
    created_at     = Column(DateTime, default=lambda: datetime.now(timezone.utc))
