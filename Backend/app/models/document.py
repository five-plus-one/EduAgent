from sqlalchemy import Column, String, DateTime, Text, JSON, Integer
from datetime import datetime, timezone
from app.db.base_class import Base

class Document(Base):
    __tablename__ = "document"
    id = Column(String, primary_key=True, index=True)
    filename = Column(String, nullable=False)
    file_path = Column(String, nullable=False)
    status = Column(String, default="pending") # pending, processing, completed, failed
    progress = Column(Integer, default=0)
    summary = Column(Text, nullable=True)
    metadata_json = Column(JSON, default={})
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
