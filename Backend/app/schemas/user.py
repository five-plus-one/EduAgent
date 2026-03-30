from typing import Optional, Dict, Any
from pydantic import BaseModel

# Properties to receive via API on creation
class UserCreate(BaseModel):
    username: str
    password: str
    name: Optional[str] = "未命名教师"
    department: Optional[str] = ""

class PreferencesUpdate(BaseModel):
    theme: Optional[str] = None
    language: Optional[str] = None
    default_ai_model: Optional[str] = None

# Properties to return to client
class UserResponse(BaseModel):
    user_id: str
    name: str
    department: str
    preferences: Dict[str, Any]

class Token(BaseModel):
    access_token: str
    refresh_token: str
    expires_in: int
    token_type: str = "bearer"
    
class TokenPayload(BaseModel):
    sub: Optional[str] = None
