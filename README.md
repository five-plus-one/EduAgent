# EduAgent

> 第十七届中国大学生服务外包创新创业大赛东部区域赛二等奖作品

EduAgent 是一个面向教学场景的多模态 AI 备课工作台。项目将对话式备课、知识库检索、图片素材管理、课件生成、讲义导出和互动游戏生成整合到同一个系统中，帮助教师或内容创作者完成“资料整理 -> AI 生成 -> 编辑优化 -> 导出发布”的完整链路。

GitHub 仓库地址：
`https://github.com/five-plus-one/EduAgent`

## 项目简介

EduAgent 主要包含两部分：

- `Frontend`：基于 React + TypeScript + Vite 的前端工作台
- `Backend`：基于 FastAPI + SQLAlchemy + LangChain 的后端服务

当前项目支持的核心能力包括：

- AI 对话式备课与会话管理
- 文档知识库上传、解析、向量化与检索
- 图片素材上传、标注、复用与素材中心管理
- PPT 课件生成、预览、编辑与导出
- 讲义内容生成与导出
- 教学互动小游戏生成、预览与分享
- 语音输入、视频资料处理等多模态能力

## 技术栈

### 前端

- React 19
- TypeScript
- Vite
- React Router
- Zustand
- Radix UI

### 后端

- FastAPI
- Uvicorn
- SQLAlchemy
- Pydantic Settings
- LangChain
- ChromaDB
- OpenAI 兼容接口
- SQLite

## 目录结构

```text
EduAgent/
├─ Frontend/                # 前端工作台
│  ├─ src/
│  ├─ public/
│  ├─ .env.development.example
│  └─ .env.production.example
├─ Backend/                 # 后端服务
│  ├─ app/
│  ├─ chroma_db/            # 向量库数据目录
│  ├─ uploads/              # 上传文件目录
│  ├─ .env.example
│  └─ requirements.txt
├─ APIDocs/                 # 接口相关文档
├─ Intro/                   # 项目介绍材料
└─ README.md
```

## 运行前准备

建议环境：

- Node.js 20+
- npm 10+
- Python 3.10+
- Git

如果需要使用 AI 能力，还需要准备：

- 可用的 OpenAI 兼容 API Key
- 可用的模型服务地址

## 一、本地开发部署

### 1. 克隆仓库

```bash
git clone https://github.com/five-plus-one/EduAgent.git
cd EduAgent
```

### 2. 启动后端

进入后端目录：

```bash
cd Backend
```

创建 Python 虚拟环境并激活：

Windows PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

macOS / Linux:

```bash
python3 -m venv .venv
source .venv/bin/activate
```

安装依赖：

```bash
pip install -r requirements.txt
```

创建环境变量文件：

```bash
copy .env.example .env
```

或 macOS / Linux：

```bash
cp .env.example .env
```

然后编辑 `Backend/.env`，至少补充：

```env
OPENAI_API_KEY=你的密钥
```

如果你使用自定义网关或其他兼容服务，也可以根据需要补充：

```env
OPENAI_API_BASE=https://你的接口地址/v1
LLM_MODEL=你的文本模型
EMBEDDING_MODEL=你的向量模型
WHISPER_MODEL=whisper-1
VISION_MODEL=你的视觉模型
SECRET_KEY=请替换为生产可用随机字符串
```

后端默认配置说明：

- API 前缀：`/api/v1`
- 默认端口：`8000`
- 默认数据库：`Backend/edu_agent.db`
- 默认向量库目录：`Backend/chroma_db`
- 默认上传目录：`Backend/uploads`

启动后端：

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

启动成功后，可访问：

- 接口文档：`http://localhost:8000/docs`
- 健康入口：`http://localhost:8000/`

Windows 用户如果希望直接双击启动，也可以使用：

```bat
Backend\start.bat
```

注意：这个脚本当前内置了本地 Anaconda 环境路径，使用前请根据你的机器实际环境调整。

### 3. 启动前端

新开一个终端，进入前端目录：

```bash
cd Frontend
```

安装依赖：

```bash
npm install
```

创建开发环境变量：

```bash
copy .env.development.example .env.development
```

或 macOS / Linux：

```bash
cp .env.development.example .env.development
```

编辑 `Frontend/.env.development`，确保它指向你的本地后端：

```env
VITE_API_BASE_URL=http://127.0.0.1:8000/api/v1
VITE_BACKEND_ORIGIN=http://127.0.0.1:8000
VITE_API_TIMEOUT=120000
```

启动前端：

```bash
npm run dev
```

默认情况下，Vite 会输出本地访问地址，例如：

- `http://localhost:5173`

至此，本地开发环境即可使用。

## 二、生产环境部署

下面给出一种最常见的部署方式：

- 前端：构建为静态文件，由 Nginx 托管
- 后端：使用 Uvicorn 启动，由 Nginx 反向代理
- 数据：SQLite + ChromaDB + uploads 目录持久化保存

### 1. 部署后端

服务器上进入项目目录：

```bash
cd EduAgent/Backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

编辑 `Backend/.env`，至少配置：

```env
OPENAI_API_KEY=你的生产密钥
OPENAI_API_BASE=https://你的兼容接口/v1
LLM_MODEL=你的生产模型
EMBEDDING_MODEL=你的向量模型
VISION_MODEL=你的视觉模型
WHISPER_MODEL=whisper-1
SECRET_KEY=请替换为安全随机字符串
BACKEND_CORS_ORIGINS=["https://你的前端域名"]
```

推荐先手工验证启动：

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

确认无误后，再接入进程守护工具，例如 `systemd`。

示例 `systemd` 服务文件：

```ini
[Unit]
Description=EduAgent Backend
After=network.target

[Service]
WorkingDirectory=/opt/EduAgent/Backend
ExecStart=/opt/EduAgent/Backend/.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
Restart=always
User=www-data
Group=www-data
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
```

启用服务：

```bash
sudo systemctl daemon-reload
sudo systemctl enable eduagent-backend
sudo systemctl start eduagent-backend
sudo systemctl status eduagent-backend
```

### 2. 部署前端

进入前端目录：

```bash
cd EduAgent/Frontend
npm install
cp .env.production.example .env.production
```

编辑 `Frontend/.env.production`：

```env
VITE_API_BASE_URL=https://api.your-domain.com/api/v1
VITE_BACKEND_ORIGIN=https://api.your-domain.com
VITE_API_TIMEOUT=120000
```

构建前端：

```bash
npm run build
```

构建产物输出在：

```text
Frontend/dist
```

将 `dist` 目录部署到 Nginx 静态站点目录，例如：

```bash
sudo mkdir -p /var/www/eduagent
sudo cp -r dist/* /var/www/eduagent/
```

### 3. 配置 Nginx

前端站点示例：

```nginx
server {
    listen 80;
    server_name your-domain.com;

    root /var/www/eduagent;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

后端反向代理示例：

```nginx
server {
    listen 80;
    server_name api.your-domain.com;

    client_max_body_size 100M;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

如果是 HTTPS，请自行接入证书，例如使用 `Let's Encrypt + certbot`。

## 三、部署后的关键检查

建议上线后依次检查：

1. 前端首页是否正常打开
2. 登录 / 注册是否正常
3. 后端 `https://api.your-domain.com/docs` 是否可访问
4. AI 对话是否可正常返回
5. 知识库文档上传是否成功
6. 图片素材上传与预览是否正常
7. PPT 导出与游戏生成是否可用

## 四、常见问题

### 1. 前端启动后请求不到后端

请检查：

- `Frontend/.env.development` 中的 `VITE_API_BASE_URL`
- 后端是否运行在 `8000` 端口
- 前后端是否存在跨域限制

### 2. 后端启动成功，但 AI 功能不可用

通常是以下原因：

- `OPENAI_API_KEY` 未配置
- `OPENAI_API_BASE` 不可用
- 模型名称不匹配
- 上游接口不兼容部分能力，例如语音或视觉模型

### 3. 上传文件后处理失败

请优先检查：

- 后端日志
- `uploads/` 目录权限
- `chroma_db/` 目录权限
- 服务器磁盘空间
- 上游模型接口是否正常

### 4. 前端构建失败

可尝试：

```bash
cd Frontend
rm -rf node_modules
npm install
npm run build
```

Windows 下可手动删除 `node_modules` 后重装。

## 五、开发建议

- 不要把真实密钥提交到仓库
- 生产环境请替换 `SECRET_KEY`
- `Backend/edu_agent.db`、`Backend/chroma_db/`、`Backend/uploads/` 建议做持久化备份
- 生产环境建议用独立数据库替代单机 SQLite
- 如果后续访问量增大，建议将向量库、文件存储和模型服务解耦

## 六、仓库说明

如果你准备二次开发，建议优先阅读：

- [Frontend/src](/d:/5plus1/Projects/dev/EduAgent/Frontend/src)
- [Backend/app](/d:/5plus1/Projects/dev/EduAgent/Backend/app)
- [APIDocs](/d:/5plus1/Projects/dev/EduAgent/APIDocs)

---

如需提交 issue 或参与开发，请基于仓库：
`https://github.com/five-plus-one/EduAgent`
