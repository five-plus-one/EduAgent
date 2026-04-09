from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.api.v1.api import api_router

from app.db.base_class import Base
from app.db.session import engine, SessionLocal
from app.models.user import User
from app.models.session import SessionContext, Message, SessionFile
from app.models.document import Document
from app.models.generation import GenerationTask, Courseware
from app.models.image import UserImage, ImageLibrary  # 图片系统
from app.core import security

# Create tables
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title=settings.PROJECT_NAME,
    openapi_url=f"{settings.API_V1_STR}/openapi.json"
)

# Standardize JSON response wrapper as requested in API.md
# Note: For simple prototyping we can use a middleware, but for SSE we shouldn't wrap. 
# We'll stick to basic return models matching the spec.

# Set all CORS enabled origins
if settings.BACKEND_CORS_ORIGINS:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[str(origin) for origin in settings.BACKEND_CORS_ORIGINS],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

app.include_router(api_router, prefix=settings.API_V1_STR)

@app.get("/")
def root():
    return {"message": "Welcome to EduAgent Backend API. Please visit /docs for API documentation."}
