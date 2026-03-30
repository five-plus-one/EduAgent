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

class AssociatedFile(BaseModel):
    session_file_id: str
    document_id: Optional[str] = None  # 全局知识库资料的原始 ID，用于前端状态还原
    filename: str
    status: str

class SessionDetailResponse(BaseModel):
    session_id: str
    course_name: Optional[str]
    target_audience: Optional[str]
    messages: List[Dict[str, Any]]
    associated_files: List[AssociatedFile]

class SessionUpdate(BaseModel):
    course_name: Optional[str] = None
