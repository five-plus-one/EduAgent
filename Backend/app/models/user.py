from sqlalchemy import Column, String, JSON
from app.db.base_class import Base

class User(Base):
    __tablename__ = "user"

    id = Column(String, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    name = Column(String, default="未命名教师")
    department = Column(String, default="")
    preferences = Column(JSON, default={"default_theme": "tech_blue"})
