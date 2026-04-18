from typing import Generator, Optional
from fastapi import Depends, HTTPException, status, Query, Header
from fastapi.security import APIKeyHeader
import jwt
from jwt.exceptions import PyJWTError
from sqlalchemy.orm import Session
from pydantic import ValidationError

from app.core import security
from app.core.config import settings
from app.db.session import SessionLocal
from app.models.user import User
from app.schemas.user import TokenPayload

reusable_oauth2 = APIKeyHeader(name="Authorization", scheme_name="JWT", auto_error=False)

def get_db() -> Generator:
    try:
        db = SessionLocal()
        yield db
    finally:
        db.close()


def get_user_from_token(token: str, db: Session) -> Optional[User]:
    """Validate a raw JWT token string and return the User, or None."""
    if not token:
        return None
    try:
        if token.startswith("Bearer "):
            token = token[7:]
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[security.ALGORITHM])
        token_data = TokenPayload(**payload)
    except (PyJWTError, ValidationError):
        return None
    return db.query(User).filter(User.id == token_data.sub).first()


def get_current_user(
    db: Session = Depends(get_db), token: str = Depends(reusable_oauth2)
) -> User:
    user = get_user_from_token(token or "", db)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Could not validate credentials",
        )
    return user


def get_current_user_optional(
    db: Session = Depends(get_db), token: str = Depends(reusable_oauth2)
) -> Optional[User]:
    """Like get_current_user but returns None instead of raising 401."""
    return get_user_from_token(token or "", db)


async def get_current_user_or_token(
    db: Session = Depends(get_db),
    authorization: Optional[str] = Header(default=None),
    token: Optional[str] = Query(default=None),
) -> User:
    """
    同时支持两种鉴权方式：
      1. Authorization: Bearer <token>  —— 标准 Header 方式
      2. ?token=<token>                 —— 降级 Query 方式（<a>/<img>/<iframe> 无法设置 Header 时使用）
    两者均无效则返回 401。
    """
    raw: Optional[str] = None
    if authorization and authorization.startswith("Bearer "):
        raw = authorization[7:]
    elif token:
        raw = token

    if not raw:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    user = get_user_from_token(raw, db)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
    return user
