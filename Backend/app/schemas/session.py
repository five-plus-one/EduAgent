from typing import Optional
from pydantic import BaseModel
from datetime import datetime

class SessionCreate(BaseModel):
    course_name: Optional[str] = None
    target_audience: Optional[str] = None

class SessionResponse(BaseModel):
    session_id: str
    created_at: datetime

class ChatMessage(BaseModel):
    content: str
