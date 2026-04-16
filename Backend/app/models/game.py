from sqlalchemy import Column, String, DateTime, Text, JSON, Integer
from datetime import datetime, timezone
from app.db.base_class import Base


class Game(Base):
    __tablename__ = "game"

    id          = Column(String, primary_key=True, index=True)   # game_xxxxxxxx
    session_id  = Column(String, index=True, nullable=False)
    user_id     = Column(String, nullable=False, index=True)
    title       = Column(String, nullable=False)
    game_type   = Column(String, nullable=False)   # quiz/memory/fillblank/sort/match/flashcard/custom
    status      = Column(String, default="generating")  # generating/completed/failed
    html_file   = Column(String, nullable=True)    # filename in GAMES_DIR (not full path)
    error       = Column(Text, nullable=True)
    spec_json   = Column(JSON, nullable=True)      # full spec submitted by LLM tool call
    version     = Column(Integer, default=1)       # bumped on each refinement
    created_at  = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at  = Column(DateTime, default=lambda: datetime.now(timezone.utc),
                         onupdate=lambda: datetime.now(timezone.utc))
