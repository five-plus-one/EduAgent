from typing import Optional, List, Any, Dict
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

class SessionItem(BaseModel):
    session_id: str
    course_name: Optional[str] = None
    updated_at: datetime

class SessionListResponse(BaseModel):
    total: int
    page: int
    has_more: bool
    items: List[SessionItem]

class SessionDetailResponse(BaseModel):
    session_id: str
    course_name: Optional[str]
    target_audience: Optional[str]
    messages: List[Dict[str, Any]]
    associated_files: List[str]

class SessionUpdate(BaseModel):
    course_name: Optional[str] = None
