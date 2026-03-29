from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import timedelta
import uuid

from app.core import security
from app.core.config import settings
from app.api import deps
from app.models.user import User
from app.schemas.user import Token, UserResponse, UserCreate
from pydantic import BaseModel

router = APIRouter()

class LoginRequest(BaseModel):
    username: str
    password: str

@router.post("/login", response_model=Token)
def login_access_token(
    db: Session = Depends(deps.get_db),
    login_data: LoginRequest = None
) -> dict:
    """
    OAuth2 compatible token login, get an access token for future requests.
    Using LoginRequest body as requested by API.md 'POST /auth/login'.
    """
    user = db.query(User).filter(User.username == login_data.username).first()
    if not user or not security.verify_password(login_data.password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Incorrect username or password")
    
    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    return {
        "access_token": security.create_access_token(
            user.id, expires_delta=access_token_expires
        ),
        "refresh_token": "dummy_refresh_token_for_now",
        "expires_in": settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        "token_type": "bearer",
    }

@router.get("/me", response_model=UserResponse)
def read_current_user(
    current_user: User = Depends(deps.get_current_user),
) -> dict:
    """
    Get current user profile interface.
    """
    return {
        "user_id": current_user.id,
        "name": current_user.name,
        "department": current_user.department,
        "preferences": current_user.preferences
    }

# Endpoint just for init test user easier
@router.post("/register", response_model=UserResponse)
def register_user(
    user_in: UserCreate,
    db: Session = Depends(deps.get_db)
) -> dict:
    """
    Create new user.
    """
    user = db.query(User).filter(User.username == user_in.username).first()
    if user:
        raise HTTPException(
            status_code=400,
            detail="The user with this username already exists in the system.",
        )
    user = User(
        id="u_" + str(uuid.uuid4())[:8],
        username=user_in.username,
        hashed_password=security.get_password_hash(user_in.password),
        name=user_in.name,
        department=user_in.department,
        preferences={"default_theme": "tech_blue"}
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return {
        "user_id": user.id,
        "name": user.name,
        "department": user.department,
        "preferences": user.preferences
    }
