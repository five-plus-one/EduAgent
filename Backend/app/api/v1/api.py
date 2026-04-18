from fastapi import APIRouter
from app.api.v1.endpoints import auth, session, knowledge_base, generation, images, admin_images, games

api_router = APIRouter()
api_router.include_router(auth.router, prefix="/auth", tags=["Auth"])
api_router.include_router(session.router, prefix="/sessions", tags=["Sessions"])
api_router.include_router(images.router, prefix="/users/me/images", tags=["User Images"])
api_router.include_router(knowledge_base.router, prefix="/knowledge-base", tags=["Knowledge Base"])
api_router.include_router(generation.router, tags=["Generation & Export"])
api_router.include_router(admin_images.router, prefix="/admin", tags=["Admin Image Library"])
api_router.include_router(games.router, tags=["Interactive Games"])
