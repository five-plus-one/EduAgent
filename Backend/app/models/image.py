from sqlalchemy import Column, String, DateTime, Text, JSON, BigInteger
from datetime import datetime, timezone
from app.db.base_class import Base


class UserImage(Base):
    """用户个人图片素材库（绑定用户账号，跨对话共享）。"""
    __tablename__ = "user_image"

    id              = Column(String, primary_key=True, index=True)           # img_xxxxxxxx
    user_id         = Column(String, index=True, nullable=False)
    filename        = Column(String, nullable=False)
    file_path       = Column(String, nullable=False)
    mime_type       = Column(String, default="image/jpeg")
    file_size       = Column(BigInteger, default=0)
    label           = Column(String, nullable=True)                          # 用户自填备注
    description     = Column(Text, nullable=True)                            # 自动标注描述
    tags            = Column(JSON, default=list)                             # 自动标注标签
    vector_id       = Column(String, nullable=True)
    annotate_status = Column(String, default="pending")                      # pending/processing/done/failed
    created_at      = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class ImageLibrary(Base):
    """开发者预置的默认图片库（对普通用户不可见）。"""
    __tablename__ = "image_library"

    id              = Column(String, primary_key=True, index=True)           # lib_xxxxxxxx
    filename        = Column(String, nullable=False)
    file_path       = Column(String, nullable=False)
    category        = Column(String, default="general")
    description     = Column(Text, nullable=True)
    tags            = Column(JSON, default=list)
    vector_id       = Column(String, nullable=True)
    annotate_status = Column(String, default="pending")
    import_note     = Column(Text, nullable=True)
    created_at      = Column(DateTime, default=lambda: datetime.now(timezone.utc))
