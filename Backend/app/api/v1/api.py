from fastapi import APIRouter
from app.api.v1.endpoints import auth

api_router = APIRouter()
api_router.include_router(auth.router, prefix="/auth", tags=["Auth"])
# Placeholders for other endpoints
# api_router.include_router(session.router, prefix="/sessions", tags=["Sessions"])
# api_router.include_router(knowledge_base.router, prefix="/knowledge-base", tags=["Knowledge Base"])
