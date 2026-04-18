from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import AnyHttpUrl
from typing import List, Union

class Settings(BaseSettings):
    PROJECT_NAME: str = "EduAgent API"
    API_V1_STR: str = "/api/v1"
    
    # CORS
    BACKEND_CORS_ORIGINS: List[str] = ["*"]
    
    # Public server URL（用于拼接分享链接，应填前端地址）
    # 开发环境默认值；生产环境在服务器 .env 中设置 SERVER_URL=https://eduagent.five-plus-one.com
    SERVER_URL: str = "http://localhost:5173"
    
    # Auth
    SECRET_KEY: str = "09d25e094faa6ca2556c818166b7a9563b93f7099f6f0f4caa6cf63b88e8d3e7" # Development key
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7 # 7 days
    
    # Database (SQLite)
    SQLALCHEMY_DATABASE_URI: str = "sqlite:///./edu_agent.db"
    
    # LLM Settings
    OPENAI_API_BASE: str = "https://api.ai.five-plus-one.com/v1"
    OPENAI_API_KEY: str = ""  # 密钥已移除，通过本地 .env 文件提供
    LLM_MODEL: str = "doubao-seed-2-0-pro-260215"   # 文本生成/摄要用
    EMBEDDING_MODEL: str = "text-embedding-3-large"  # 向量嵌入用
    WHISPER_MODEL: str = "whisper-1"                 # 音频转写用；空字符串 = 跳过语音识别阶段

    # Image system
    VISION_MODEL: str = "mimo-v2-omni"              # 图像/视视频帧分析用
    IMAGE_UPLOAD_DIR: str = "uploads/session_images"
    IMAGE_LIBRARY_DIR: str = "uploads/image_library"
    ADMIN_SECRET_KEY: str = "admin_secret_change_me"
    IMAGE_SEARCH_SESSION_THRESHOLD: float = 0.30
    IMAGE_SEARCH_LIBRARY_THRESHOLD: float = 0.25

    model_config = SettingsConfigDict(case_sensitive=True, env_file=".env")

settings = Settings()
