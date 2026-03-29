# EduAgent v1.1  API 规范文档

## 0. 全局架构与设计规范

### 0.1 基础信息
* **基础路径 (Base URL)**: `/api/v1`
* **数据交换格式**: 请求体与响应体默认采用 `application/json` (除文件上传外)。
* **鉴权方式**: 所有非公共接口需在 HTTP Header 中携带凭证：`Authorization: Bearer <access_token>`。

### 0.2 统一响应结构
所有 API 严格遵循一致的外层包裹格式：
```json
{
  "code": 200,      // 业务状态码 (200: 成功, 其他: 失败)
  "message": "ok",  // 提示信息
  "data": {}        // 核心负载体
}
```
*(注：为保持说明简洁，下文各接口的响应结构中将省略 `code` 与 `message`，仅展示 `data` 内部的核心负载态设计)*

### 0.3 统一分页规范 (Pagination)
凡涉及列表查询的接口（如会话列表、知识库列表），均通用以下标准：
* **入参 (Query Params)**:
  * `page`: 当前所在页面号 (默认 1)
  * `size`: 单页容纳条数 (默认 20，最高 100)
* **响应结构 (以 data 为根节点)**:
```json
{
  "total": 150,       // 总条目数
  "page": 1,          // 当前所在页码
  "size": 20,         // 每页容量
  "has_more": true,   // 是否还有更多数据
  "items": [ ... ]    // 具体的数据列表
}
```

### 0.4 标准化异常反馈 (Error Schema)
当 HTTP Status Code 不为 `2xx` 时，系统启用增强型错误响应格式（特别针对 400 表单校验或业务权限阻断）：
```json
{
  "code": 4001,
  "message": "参数校验失败",
  "data": {
    "error_ref": "ERR-91A2D", 
    "details": [
      {
        "field": "password",
        "issue": "must be at least 8 characters long"
      }
    ]
  }
}
```

---

## 模块一：身份认证与偏好设置 (Auth & Preferences)

### 1.1 用户登录
* **POST** `/auth/login`
* **说明**: 提交教工账号与密码获取短效与长效授信。
* **请求体 (Body)**:
```json
{
  "username": "teacher_01",
  "password": "secure_password123"
}
```
* **响应负载**:
```json
{
  "access_token": "eyJhbGciOi...",
  "refresh_token": "def5020...",
  "expires_in": 7200,             // 秒级过期倒计时
  "token_type": "Bearer"
}
```

### 1.1 用户登录
* **POST** `/auth/login`
* **说明**: 提交教工账号与密码获取短效与长效授信。
* **请求体 (Body)**:
```json
{
  "username": "teacher_01",
  "password": "secure_password123"
}
```
* **响应负载**:
```json
{
  "access_token": "eyJhbGciOi...",
  "refresh_token": "def5020...",
  "expires_in": 7200,
  "token_type": "Bearer"
}
```

### 1.2 用户注册
* **POST** `/auth/register`
* **说明**: 创建新的教师账户，无需鉴权。成功后直接返回用户信息，需再调用 `1.1 登录` 接口获取 Token。
* **请求体 (Body)**:

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `username` | string | ✅ | 登录用教工号，唯一 |
| `password` | string | ✅ | 登录密码（建议至少 8 位） |
| `name` | string | 否 | 显示名称（默认：未命名教师）|
| `department` | string | 否 | 所在院系（默认：空字符串） |

```json
{
  "username": "teacher_02",
  "password": "Secure@2026",
  "name": "李老师",
  "department": "数学系"
}
```
* **响应负载** (HTTP 200):
```json
{
  "user_id": "u_86e89852",
  "name": "李老师",
  "department": "数学系",
  "preferences": {
    "default_theme": "tech_blue"
  }
}
```
* **错误响应** (用户名已存在, HTTP 400):
```json
{
  "code": 4001,
  "message": "用户名已被占用",
  "data": {
    "details": [{ "field": "username", "issue": "already taken" }]
  }
}
```

### 1.3 登出 / 吊销授权
* **POST** `/auth/logout`
* **说明**: 使当前携带的 `access_token` 失效（后端加入缓存黑名单）。
* **请求**: 无携带负载体。
* **响应负载**: `null`

### 1.3 获取个人档案
* **GET** `/auth/me`
* **说明**: 拉取当前登录教工的基本面貌及全局个性化设置。
* **响应负载**:
```json
{
  "user_id": "u_1001",
  "name": "王老师",
  "department": "物理系",
  "preferences": {
    "theme": "dark",
    "language": "zh-CN",
    "default_ai_model": "doubao-seed-1-8-251228"
  }
}
```

### 1.4 更新个人偏好 (部分覆盖)
* **PUT** `/auth/me/preferences`
* **说明**: 更新系统偏好配置（支持全量或部分传递更新）。
* **请求体 (Body)**:
```json
{
  "theme": "glass_blue",
  "default_ai_model": "doubao-seed-1-8-251228"
}
```
* **响应负载**:
```json
{
  "theme": "glass_blue",
  "language": "zh-CN",
  "default_ai_model": "doubao-seed-1-8-251228",
  "updated_at": "2026-03-29T10:05:00Z"
}
```

---

## 模块二：会话生命周期管理 (Session LCM)

### 2.1 创建新的备课会话
* **POST** `/sessions`
* **说明**: 开拓一个具有独立上下文的新备课或知识共创流。
* **请求体**: 
```json
{
  "course_name": "牛顿第二定律",
  "target_audience": "大一新生",
  "objective": "强调公式推导与动量对应关系"
}
```
* **响应负载**:
```json
{
  "session_id": "sess_8f9a2b",
  "created_at": "2026-03-29T10:00:00Z"
}
```

### 2.2 查询历史会话列表
* **GET** `/sessions`
* **说明**: 获取当前用户拥有的教务会话记录列表。遵循全局分页标准。
* **Query 参数**: `?page=1&size=20&keyword=物理`
* **响应负载**:
```json
{
  "total": 35,
  "page": 1,
  "has_more": true,
  "items": [
    {
      "session_id": "sess_8f9a2b",
      "course_name": "牛顿第二定律",
      "updated_at": "2026-03-29T14:30:00Z"
    }
  ]
}
```

### 2.3 获取单个会话详情与历史记录
* **GET** `/sessions/{session_id}`
* **说明**: 获取指定会话的全量配置信息以及其关联的聊天历史（Messages）。
* **响应负载**:
```json
{
  "session_id": "sess_8f9a2b",
  "course_name": "牛顿第二定律",
  "target_audience": "大一新生",
  "messages": [
    {"role": "user", "content": "我想做一份..."},
    {"role": "assistant", "content": "好的..."}
  ],
  "associated_files": ["f_a1b2", "k_9901"]
}
```

### 2.4 修改会话元数据
* **PUT** `/sessions/{session_id}`
* **说明**: 对会话名称或目标进行重命名。
* **请求体**: 
```json
{"course_name": "牛顿第二定律 (进阶版)"}
```
* **响应负载**: `null`

### 2.5 废弃删除会话
* **DELETE** `/sessions/{session_id}`
* **说明**: 清除此条记录（物理删除或系统软归档）。
* **响应负载**: `null`

---

## 模块三：上下文与资料挂载调度 (Interaction & Reference)

### 3.1 文本对话式聊天 (流式)
* **POST** `/sessions/{session_id}/chat`
* **说明**: 前端向会话递送指令，并订阅返回的 SSE 事件流获取大语言模型的思考态与文本。
* **Header**: `Accept: text/event-stream`
* **请求体**: 
```json
{"content": "请把侧重点放在抛物线运动上。"}
```
* **响应流**: 标准 Server-Sent Events 流。

### 3.2 语音输入转文本识别
* **POST** `/sessions/{session_id}/audio-chat`
* **说明**: 上传录音片段，调用后端大模型/ASR 引擎将其转换为文字，直接回传给前端（前端确认修改后再走文字流式 3.1）。
* **Content-Type**: `multipart/form-data`
* **请求**: `audio_file` (Blob/File 流数据)
* **响应负载**:
```json
{
  "text": "我想做一份关于牛顿第二定律的课件..."
}
```

### 3.3 资料文件上传 (独立会话内)
* **POST** `/sessions/{session_id}/files`
* **说明**: 上传独立文件的过程。
* **Content-Type**: `multipart/form-data`
* **请求栏**: `file`, `intent_desc` (可选，比如 "只引用前三页数据")。
* **响应**: `{ "file_id": "f_a1b2", "status": "processing" }`

### 3.4 查询资料解析状态
* **GET** `/sessions/{session_id}/files/{file_id}/status`
* **说明**: 上传后轮询进度，大文本可能需要几秒到十几秒向量化抽象。
* **响应负载**:
```json
{
  "status": "processing", 
  "progress": 65,
  "summary": null
}
```
*(注：status 枚举值为 `pending`, `processing`, `completed`, `failed`)*

### 3.5 RAG 知识库越权挂载 (引用机制)
* **POST** `/sessions/{session_id}/references`
* **说明**: 将全局知识库中的资料不经过重新上传，直接强行映射引用入当前备课会话中。
* **请求体**:
```json
{
  "reference_ids": ["doc_991", "doc_992"]
}
```
* **响应负载**: `null`

### 3.6 会话局部资料修改
* **PUT** `/sessions/{session_id}/files/{file_id}`
* **说明**: 动态修改之前已经上传文件的提示词引流诉求。
* **请求体**: `{"intent_desc": "由于课时变更，现在只需参考本文档第一章即可"}`
* **响应**: `null`

### 3.7 踢出挂载资料
* **DELETE** `/sessions/{session_id}/files/{file_id}`
* **说明**: 从本 session 缓存链路中剥离该文件，后续生成大纲时不参考。

---

## 模块四：智能化结构化课件生成 (Generation & Workflow)

### 4.1 触发结构化合成
* **POST** `/sessions/{session_id}/generate`
* **说明**: 大模型对现有的所有聊天历史及明确选中的文件上下文进行分析，推导出完整 JSON 化树形架构的 PPT、教案文本等介质。
* **请求体 (核心)**:
```json
{
  "selected_file_ids": ["f_a1b2", "doc_991"], 
  "generation_mode": "depth"    // 快速生成(fast)或深度发散(depth)
}
```
* **说明**: 借用 `selected_file_ids` 字段强制钳制生成范围保障幻觉受控。
* **响应**: `{"task_id": "gen_8872", "status": "generating"}`

### 4.2 查询后台合成进度
* **GET** `/generate/tasks/{task_id}`
* **说明**: 由于大型备课可能会调用多个链式大模型（Chain of Thought），支持通过轮询本接口获取分步骤进度。
* **响应负载**:
```json
{
  "status": "generating",
  "stage": "generating_slides", 
  "progress": 80
}
```

### 4.3 获取 / 预览核心大纲图元
* **GET** `/sessions/{session_id}/courseware/preview`
* **说明**: 拉取大模型经过排版组装后的 JSON 图元数组，该数组具备适应多端渲染引擎的独立区块阵列（Block Elements Array），可以轻松实现纯文字、图文混排（左右/上下）或画廊模式。
* **响应结构**:
```json
{
  "ppt_data": [
    {
      "page_index": 1,
      "layout_type": "cover",          // 支持: cover, standard, two_column (双列对比), image_gallery (多图画廊)
      "title": "力学模型溯源",
      "speaker_notes": "在这个阶段讲一下摩擦力的前置推导...",
      "elements": [
        {
          "element_id": "txt_101",
          "type": "text_block",
          "position": "center",        // 支持: top, bottom, center, left, right, right_top, right_bottom
          "content": [
            "牛顿定律的边界情况",
            "在非惯性系中如何看待科里奥利力"
          ]
        }
      ]
    },
    {
      "page_index": 2,
      "layout_type": "two_column",
      "title": "微观粒子的摩擦学表现",
      "speaker_notes": "引导学生通过右侧双图对比玻璃板和木板的光滑度极差。",
      "elements": [
        {
          "element_id": "txt_201",
          "type": "text_block",
          "position": "left",
          "content": [
            "接触面越粗糙，滚动阻力和附着力呈指数放大。",
            "下面这是我们在高倍显微镜下的晶体解理面结构抓拍："
          ]
        },
        {
          "element_id": "img_202",
          "type": "image",
          "position": "right_top",     // 右侧双图排版：图A
          "url": "https://oss/glass_surface_micro.jpg",
          "alt": "玻璃解理面微观示意图"
        },
        {
          "element_id": "img_203",
          "type": "image",
          "position": "right_bottom",  // 右侧双图排版：图B
          "url": "https://oss/wood_surface_micro.jpg",
          "alt": "木材切面微观示意图"
        }
      ]
    }
  ],
  "word_markdown": "# 第一节 大纲...\n## 结论..."
}
```

### 4.4 局部微调迭代 (Regeneration)
* **POST** `/sessions/{session_id}/courseware/iterate`
* **说明**: 针对特定的一页幻灯片内容发起定向自然语言洗牌。
* **请求体**: `{"target_type": "ppt", "page_index": 1, "instruction": "减少字数加几张示意图"}`
* **响应负载**: (直接返回那页更新完毕的 `page` 子对象)

---

## 模块五：渲染导出管道 (Export)

* **POST /sessions/{session_id}/export**
  根据前端最终定稿的 JSON 或后端最新的记忆体状态唤起 Office 物理文档渲染机制。
* **GET /export/tasks/{export_task_id}**
  轮询下载长链路 `{"status": "completed", "download_urls": {"ppt_url": "..."}}`

---

## 模块六：知识域行政管控区 (RAG Knowledge Base Admin)

### 6.1 全局知识新增入库
* **POST** `/knowledge-base/documents`
* **上传方式**: `multipart/form-data` 带 `metadata` 分类指纹。

### 6.2 知识库文档分页检索
* **GET** `/knowledge-base/documents`
* **说明**: 此接口受上述 `0.3` 统一分页与字段索引规范限制。可筛选 `?status=completed&subject=力学`。

### 6.3 更新知识分档指纹
* **PUT** `/knowledge-base/documents/{doc_id}`
* **请求体**: `{"metadata": {"subject": "经典物理学的延伸"}}`
* **响应负载**: `null`

### 6.4 销毁剔除 RAG 资料
* **DELETE** `/knowledge-base/documents/{doc_id}`
* **说明**: 强行终结和删除底库向量表，使其再也无法服务于新的 session。
