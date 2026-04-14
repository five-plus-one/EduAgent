from sqlalchemy import Column, String, DateTime, Integer, Boolean
from datetime import datetime, timezone
from app.db.base_class import Base


class GameShare(Base):
    __tablename__ = "game_share"

    code        = Column(String(8),   primary_key=True, index=True)   # 短码，6-8位 Base62
    game_id     = Column(String,      nullable=False, index=True)       # 关联 game.id
    created_by  = Column(String,      nullable=False, index=True)       # 创建者 user_id
    created_at  = Column(DateTime,    default=lambda: datetime.now(timezone.utc))
    expires_at  = Column(DateTime,    nullable=True)                    # NULL = 永不过期
    view_count  = Column(Integer,     default=0)
    is_active   = Column(Boolean,     default=True)
