# ── EduAgent Backend Dockerfile ──────────────────────────────────
# 基础镜像：使用阿里云镜像加速 Python 拉取
FROM python:3.11-slim

# 设置工作目录
WORKDIR /app

# ── 系统依赖（lxml / Pillow / imageio-ffmpeg 等 C 扩展需要）──────
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        libxml2-dev \
        libxslt1-dev \
        libffi-dev \
        libssl-dev \
        ffmpeg \
        curl \
    && rm -rf /var/lib/apt/lists/*

# ── 配置 pip 国内镜像（清华 TUNA），解决国内服务器无法访问 pypi.org 的问题 ──
COPY pip.conf /etc/pip.conf

# ── 先复制 requirements 并安装依赖（利用 Docker 层缓存）──────────
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

# ── 复制项目代码 ──────────────────────────────────────────────────
COPY . .

# ── 创建必要的运行时目录 ──────────────────────────────────────────
RUN mkdir -p uploads/sessions uploads/games uploads/documents chroma_db

# ── 环境变量默认值（可被 docker-compose / -e 覆盖）──────────────
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8000

EXPOSE 8000

# ── 启动命令（生产环境用 4 worker，调试时改 --reload）────────────
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
