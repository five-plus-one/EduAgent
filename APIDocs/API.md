
## 全局规范

* **基础路径 (Base URL)**: `/api/v1`
* **数据交换格式**: `application/json` (除文件上传外)
* **鉴权方式**: 所有非 `/auth/login` 的请求，需在 Header 中携带 `Authorization: Bearer <access_token>`
* **通用返回结构**:
```json
{
  "code": 200,
  "message": "success",
  "data": {} 
}
```
*(注：为保持文档简洁，以下接口说明中均省略外层的 `code` 和 `message`，仅展示 `data` 内部的核心结构体)*

---

## 模块零：基础用户与认证 (Auth)

### 0.1 用户登录
* **接口**: `POST /auth/login`
* **说明**: 账号密码验证，获取访问凭证。
* **请求**:
```json
{
  "username": "teacher_01",
  "password": "hashed_password"
}
```
* **响应**:
```json
{
  "access_token": "eyJhbGciOiJIUzI1...",
  "refresh_token": "def50200a...",
  "expires_in": 3600
}
```

### 0.2 获取当前用户信息
* **接口**: `GET /auth/me`
* **说明**: 获取当前登录教师的基础信息和系统配置。
* **响应**:
```json
{
  "user_id": "u_1001",
  "name": "王老师",
  "department": "物理系",
  "preferences": {
    "default_theme": "tech_blue"
  }
}
```

---

## 模块一：核心对话交互与意图理解 (Chat & Session)

### 1.1 创建教学设计会话
* **接口**: `POST /sessions`
* **说明**: 初始化一次备课任务的上下文。
* **请求**: 
```json
{
  "course_name": "牛顿第二定律",
  "target_audience": "大一新生"
}
```
* **响应**:
```json
{
  "session_id": "sess_8f9a2b",
  "created_at": "2026-03-29T10:00:00Z"
}
```

### 1.2 发送文本消息 (流式交互)
* **接口**: `POST /sessions/{session_id}/chat`
* **说明**: 前端发送用户指令，后端通过 SSE (Server-Sent Events) 流式返回大模型的思考和回答。
* **Headers**: `Accept: text/event-stream`
* **请求**:
```json
{
  "content": "我想做一份关于牛顿第二定律的课件，重点讲一下相对运动。"
}
```
* **响应 (SSE 事件流)**:
```text
data: {"chunk": "好", "is_finished": false}
data: {"chunk": "的，", "is_finished": false}
data: {"chunk": "关于牛顿第二定律...", "is_finished": false}
data: {"chunk": "", "is_finished": true, "extracted_intent": {"core_topic": "牛顿第二定律", "key_point": "相对运动"}}
```

### 1.3 语音输入转文本
* **接口**: `POST /sessions/{session_id}/audio-chat`
* **说明**: 上传录音，后端调用 ASR 转成文字后，直接返回文字内容（供前端展示并确认后再调用 1.2 接口）。
* **Content-Type**: `multipart/form-data`
* **请求**: `audio_file` (Blob/File)
* **响应**:
```json
{
  "text": "我想做一份关于牛顿第二定律的课件..."
}
```

---

## 模块二：多模态参考资料处理 (Multimodal Files)

### 2.1 上传参考文件并触发解析
* **接口**: `POST /sessions/{session_id}/files`
* **说明**: 异步上传文档或视频资料。
* **Content-Type**: `multipart/form-data`
* **请求**: 
  * `file`: (文件对象)
  * `intent_desc`: "参考这个PDF的第二章内容" (可选字符串)
* **响应**:
```json
{
  "file_id": "file_a1b2",
  "status": "processing"
}
```

### 2.2 查询文件解析状态
* **接口**: `GET /sessions/{session_id}/files/{file_id}/status`
* **说明**: 前端轮询此接口获取解析进度。
* **响应**:
```json
{
  "status": "processing", 
  "progress": 65,
  "summary": null
}
```
*(注：status 枚举值为 `pending`, `processing`, `completed`, `failed`)*

---

## 模块三：多模态课件生成与迭代 (Generation)

### 3.1 触发课件生成
* **接口**: `POST /sessions/{session_id}/generate`
* **说明**: 对话完成后，根据已提取的意图和文件摘要，异步生成课件。
* **响应**:
```json
{
  "task_id": "gen_9x8y",
  "status": "generating"
}
```

### 3.2 查询生成任务状态
* **接口**: `GET /generate/tasks/{task_id}`
* **说明**: 轮询获取生成进度。
* **响应**:
```json
{
  "status": "generating",
  "stage": "generating_slides", 
  "progress": 80
}
```

### 3.3 获取课件结构化预览数据 (核心)
* **接口**: `GET /sessions/{session_id}/courseware/preview`
* **说明**: 获取大模型生成的结构化 JSON，前端据此渲染高保真预览界面。
* **响应**:
```json
{
  "ppt_data": [
    {
      "page_index": 1,
      "type": "cover",
      "title": "牛顿第二定律探讨",
      "speaker": "王老师"
    },
    {
      "page_index": 2,
      "type": "content",
      "title": "核心公式推导",
      "bullets": ["F = ma", "动量守恒的关联"],
      "suggested_image_prompt": "物理实验室，牛顿摆..."
    }
  ],
  "word_教案": "教学目标：掌握核心定律...\n教学过程：...",
  "interactive_game": {
    "type": "quiz",
    "question": "当质量加倍时，加速度如何变化？"
  }
}
```

### 3.4 提交局部修改意见
* **接口**: `POST /sessions/{session_id}/courseware/iterate`
* **说明**: 针对特定页面提出修改，返回更新后的该页数据。
* **请求**:
```json
{
  "target_type": "ppt",
  "page_index": 2,
  "instruction": "把核心公式推导这里的文字精简一下，加一个生活中的案例。"
}
```
* **响应**:
```json
{
  "page_index": 2,
  "title": "核心公式推导（生活实例）",
  "bullets": ["F = ma", "案例：推空车与推满载货车的区别"]
}
```

---

## 模块四：导出与下载 (Export)

### 4.1 触发打包导出
* **接口**: `POST /sessions/{session_id}/export`
* **说明**: 异步将 JSON 数据渲染为物理文件 (.pptx, .docx)。
* **请求**: 提交前端最终确认无误的完整 JSON 结构（或告知后端使用 session 缓存的最新版本）。
* **响应**:
```json
{
  "export_task_id": "exp_3k4m"
}
```

### 4.2 获取下载链接
* **接口**: `GET /export/tasks/{export_task_id}`
* **说明**: 轮询导出状态，完成后获取真实文件 URL。
* **响应**:
```json
{
  "status": "completed",
  "download_urls": {
    "ppt_url": "https://oss.domain.com/files/newton_course.pptx",
    "word_url": "https://oss.domain.com/files/newton_plan.docx",
    "h5_url": "https://oss.domain.com/games/quiz_1.html"
  }
}
```

---

## 模块五：本地知识库管理 (RAG Admin)

### 5.1 上传并向量化文档
* **接口**: `POST /knowledge-base/documents`
* **说明**: 管理员上传专业资料补充 RAG 知识库。
* **Content-Type**: `multipart/form-data`
* **请求**: 
  * `file`: 文件实体
  * `metadata`: `{"subject": "Physics", "level": "University"}`
* **响应**:
```json
{
  "doc_id": "doc_991",
  "status": "embedding"
}
```

### 5.2 获取知识库文档列表
* **接口**: `GET /knowledge-base/documents`
* **说明**: 分页查询知识库已入库文档的状态。
* **响应**:
```json
{
  "total": 120,
  "items": [
    {
      "doc_id": "doc_991",
      "filename": "大学物理-力学篇.pdf",
      "status": "completed"
    }
  ]
}
```

---
