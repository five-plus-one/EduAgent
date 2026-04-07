# EduAgent 图片库系统 — API 补充规范

> 本文档是 `API.md` v1.1 的增量补丁，专门描述图片素材管理与 PPT 图文混排相关的新增功能。
> 前端需要阅读本文档；后端按此规范实现。

---

## 系统架构概述

### 图片检索原理（为什么不需要遍历）

PPT 生成时，LLM 会在 elements 数组中输出 type:image 元素，携带一段 query 自然语言描述。后端通过以下流程完成**语义匹配**：

```
上传图片
   └─ Vision LLM 自动生成描述 + 标签
         └─ 拼接描述+标签 → 向量 Embedding → 存入 ChromaDB
               集合名称：images_session（用户图）/ images_library（默认库）

生成 PPT 时
   └─ LLM 输出 query: "牛顿苹果树落苹果示意图"
         └─ 对 query 做向量 Embedding → ChromaDB 余弦相似度检索 Top-1
               └─ 优先撞击 images_session（本会话）→ fallback images_library → 仍无则跳过
```

无需遍历，O(log n) 向量检索。

---

## 两类图片库

| 属性 | 会话图片库 | 默认图片库 |
|---|---|---|
| 谁能看到 | 仅上传者本次会话 | 所有人（但前端不暴露入口）|
| 谁能上传 | 普通用户（教师）| 仅管理员（开发者后台）|
| API 前缀 | /sessions/{id}/images/ | /admin/image-library/ |
| ChromaDB Collection | images_session | images_library |
| 数据库表 | session_image | image_library |
| 前端是否有管理UI | 有（图片上传面板）| 无（仅后台接口）|

---

## 数据库新增表结构（后端参考）

### session_image 表

| 字段 | 类型 | 说明 |
|---|---|---|
| id | String PK | img_ + uuid8，如 img_3f8a1b2c |
| session_id | String FK | 归属会话 |
| filename | String | 原始文件名 |
| file_path | String | 服务器本地路径（相对 uploads/session_images/）|
| mime_type | String | image/jpeg、image/png、image/webp |
| file_size | Integer | 字节数 |
| label | String | 用户自填备注（可选）|
| description | Text | Vision LLM 自动生成的一句话描述 |
| tags | JSON | Vision LLM 生成的标签列表 |
| vector_id | String | ChromaDB 中对应 document ID |
| annotate_status | String | pending / processing / done / failed |
| created_at | DateTime | 上传时间 |

### image_library 表

| 字段 | 类型 | 说明 |
|---|---|---|
| id | String PK | lib_ + uuid8 |
| filename | String | 文件名 |
| file_path | String | 服务器本地路径（相对 uploads/image_library/）|
| category | String | 开发者手动分类（physics、chemistry、math、general）|
| description | Text | Vision LLM 自动生成的描述 |
| tags | JSON | Vision LLM 生成的标签列表 |
| vector_id | String | ChromaDB 中对应 document ID |
| annotate_status | String | pending / processing / done / failed |
| import_note | Text | 开发者录入时的备注 |
| created_at | DateTime | 导入时间 |

---

## 新增 API — 模块 3.x 补充：会话图片管理

### 3.8 上传图片到会话

- **POST** `/sessions/{session_id}/images`
- **Content-Type**: multipart/form-data
- **请求字段**:

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| file | File | 是 | 图片文件，支持 jpg/png/webp，单张最大 10MB |
| label | string | 否 | 用户自填备注，如"第三章示意图" |

- **响应** (HTTP 201):

```json
{
  "image_id": "img_3f8a1b2c",
  "filename": "physics_demo.jpg",
  "file_size": 204800,
  "annotate_status": "pending",
  "preview_url": "/api/v1/sessions/sess_8f9a2b/images/img_3f8a1b2c/preview",
  "created_at": "2026-04-07T10:00:00Z"
}
```

annotate_status 初始为 pending，后端异步完成 LLM 描述后变为 done。前端无需等待。

---

### 3.9 获取会话图片列表

- **GET** `/sessions/{session_id}/images`
- **Query 参数**: ?page=1&size=20
- **响应**:

```json
{
  "total": 5,
  "items": [
    {
      "image_id": "img_3f8a1b2c",
      "filename": "physics_demo.jpg",
      "label": "第三章示意图",
      "preview_url": "/api/v1/sessions/sess_8f9a2b/images/img_3f8a1b2c/preview",
      "annotate_status": "done",
      "tags": ["苹果", "物理", "引力", "手绘"],
      "description": "黑白手绘风格示意图，展示苹果从树上落下",
      "created_at": "2026-04-07T10:00:00Z"
    }
  ]
}
```

---

### 3.10 获取图片预览

- **GET** `/sessions/{session_id}/images/{image_id}/preview`
- **响应**: Content-Type: image/jpeg（图片二进制流）

---

### 3.11 删除会话图片

- **DELETE** `/sessions/{session_id}/images/{image_id}`
- **响应**: null

---

### 3.12 重新触发图片标注

- **POST** `/sessions/{session_id}/images/{image_id}/annotate`
- **说明**: 对标注失败的图片手动重试。
- **响应**:

```json
{
  "image_id": "img_3f8a1b2c",
  "annotate_status": "processing"
}
```

---

## 新增 API — 模块 7：默认图库管理（Admin Only）

这组接口对最终用户不可见，前端无需开发任何相关 UI。
开发者通过 Postman / curl 调用，在演示前预先导入教学图片。

### 7.1 导入图片到默认库

- **POST** `/admin/image-library`
- **鉴权**: X-Admin-Key: {ADMIN_SECRET_KEY}（配置在后端 .env）
- **Content-Type**: multipart/form-data

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| file | File | 是 | 图片文件 |
| category | string | 否 | 分类：physics、math、general 等 |
| import_note | string | 否 | 开发者备注 |

- **响应** (HTTP 201):

```json
{
  "lib_id": "lib_9a2c3d4e",
  "filename": "newton_apple.jpg",
  "category": "physics",
  "annotate_status": "pending"
}
```

---

### 7.2 批量导入（目录扫描）

- **POST** `/admin/image-library/batch`
- **鉴权**: X-Admin-Key
- **说明**: 在服务器指定目录下放好图片后调用，触发批量扫描入库并异步标注。
- **请求体**:

```json
{
  "scan_dir": "uploads/image_library/physics",
  "category": "physics",
  "import_note": "物理教学图集 v1"
}
```

- **响应**:

```json
{
  "queued": 42,
  "skipped": 3,
  "task_id": "batch_annotate_7f2a"
}
```

---

### 7.3 查询默认图库列表

- **GET** `/admin/image-library`
- **鉴权**: X-Admin-Key
- **Query**: ?category=physics&annotate_status=done&page=1&size=50
- **响应**:

```json
{
  "total": 128,
  "items": [
    {
      "lib_id": "lib_9a2c3d4e",
      "filename": "newton_apple.jpg",
      "category": "physics",
      "description": "牛顿站在苹果树下、苹果落下的黑白手绘教学插图",
      "tags": ["牛顿", "苹果", "引力", "经典物理", "手绘"],
      "annotate_status": "done",
      "preview_url": "/admin/image-library/lib_9a2c3d4e/preview",
      "created_at": "2026-04-07T10:00:00Z"
    }
  ]
}
```

---

### 7.4 删除默认库图片

- **DELETE** `/admin/image-library/{lib_id}`
- **鉴权**: X-Admin-Key
- **响应**: null

---

### 7.5 默认库图片预览

- **GET** `/admin/image-library/{lib_id}/preview`
- **响应**: 图片二进制流。

---

## 生成流变化 — page_chunk 新增 image element

LLM Prompt 中新增图片元素类型指引，前端渲染 page_chunk 时需处理 type === image 的 element。

### LLM 输出格式（新增 element 类型）

```json
{
  "element_id": "img_e2",
  "type": "image",
  "position": "right",
  "query": "牛顿苹果树引力手绘教学插图",
  "alt": "牛顿引力示意图"
}
```

| 字段 | 说明 |
|---|---|
| type | 固定 "image" |
| position | left / right / right_top / right_bottom / center |
| query | 自然语言图片用途描述，后端用此字段做向量检索 |
| alt | 图片替代文字（PPT 中作图注，前端渲染 img alt）|

### 后端处理流程

```
LLM 输出 page_chunk（含 type:image element）
  ↓ 对 query 做向量 Embedding
  ├─ 搜索 images_session（filter: session_id），top_k=1, threshold=0.75
  ├─ 若未命中 → 搜索 images_library，top_k=1, threshold=0.70
  └─ 若仍未命中 → resolved = null
  ↓ 命中时在 image element 追加 resolved 字段后推送给前端
```

### 前端收到的 page_chunk 格式示例

```json
{
  "event": "page_chunk",
  "data": {
    "page_index": 2,
    "layout_type": "two_column",
    "title": "万有引力定律",
    "elements": [
      {
        "element_id": "txt_e1",
        "type": "text_block",
        "position": "left",
        "content": ["F = GMm/r² (LaTeX格式见正文)", "引力与质量积成正比，与距离平方成反比"]
      },
      {
        "element_id": "img_e2",
        "type": "image",
        "position": "right",
        "query": "牛顿苹果树引力手绘教学插图",
        "alt": "牛顿引力示意图",
        "resolved": {
          "image_id": "img_3f8a1b2c",
          "preview_url": "/api/v1/sessions/sess_8f9a2b/images/img_3f8a1b2c/preview",
          "source": "session",
          "similarity": 0.89
        }
      }
    ]
  }
}
```

**前端渲染规则**：

| resolved 状态 | 前端行为 |
|---|---|
| 存在且有 preview_url | 渲染真实图片 |
| null | 渲染灰色占位框 + 图片检索无匹配 提示 |
| source === "library" | 可选显示系统图库小徽章（参赛 demo 展示用）|

---

## 前端新增 UI 说明

### 组件 1：图片上传面板

建议位置：现有文件上传区旁边，新增图片素材 Tab。

功能要点：
- 支持本地拖拽/点击多选上传
- 缩略图网格 + 标注状态徽章（待标注 / 标注中 / 已就绪 / 失败）
- 已就绪图片展示 LLM 生成的描述和标签（可折叠）
- 图片删除（确认弹窗）

轮询策略：上传后，对 annotate_status 为 pending / processing 的图片每 3 秒轮询 GET /sessions/{id}/images，直到变为 done 或 failed。

### 组件 2：PPT 预览卡片中的图片元素

对 type === image 元素进行渲染（命中/未命中两种状态）。

---

## 导出 PPTX 影响

- 导出时后端重新执行图片检索（防止预览阶段图片被删除）
- 命中图片通过 python-pptx 的 add_picture() 以二进制嵌入 PPTX
- 导出文件自包含，不依赖服务器路径

---

## 环境配置补充（后端 .env）

```
IMAGE_UPLOAD_DIR=uploads/session_images
IMAGE_LIBRARY_DIR=uploads/image_library
ADMIN_SECRET_KEY=your_admin_secret_here
VISION_MODEL=doubao-vision-pro-32k
IMAGE_SEARCH_SESSION_THRESHOLD=0.75
IMAGE_SEARCH_LIBRARY_THRESHOLD=0.70
```

---

## Vision LLM 自动标注 Prompt（后端实现参考）

系统提示：
```
你是一个专业的教学图片标注助手。请分析图片内容，以中文输出：
1. 一句话精准描述（30字以内），聚焦图片的核心教学信息
2. 5-8个检索标签（简短词组，用于教学场景语义匹配）
输出严格为 JSON 格式：{"description": "...", "tags": ["tag1", "tag2", ...]}
```

示例输出：
```json
{
  "description": "苹果从树上落下的黑白手绘示意图，用于讲解牛顿万有引力定律",
  "tags": ["牛顿", "引力", "苹果树", "物理", "手绘", "经典力学", "示意图"]
}
```

标注完成后将 description + tags 拼接做向量化，存入 ChromaDB 对应 collection，
metadata 记录 image_id（或 lib_id）和 source（session 或 library）。

---

文档版本: v1.0-image-supplement | 日期: 2026-04-07
