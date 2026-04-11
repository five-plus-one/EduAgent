# EduAgent 课件单页编辑 API 文档

> 整理时间：2026-04-11
> 说明：本文档覆盖课件 PPT 单页编辑相关的所有后端接口，包括图片替换、手动内容编辑、布局切换。

---

## 接口总览

| # | 方法 | 路径 | 功能 | 状态 |
|---|---|---|---|---|
| 1 | PATCH | `/sessions/{id}/courseware/slides/{page}/elements/{elem}/image` | 单页图片替换 | ✅ 已实现 |
| 2 | PUT | `/sessions/{id}/courseware/slides/{page}` | 手动编辑单页内容 | ✅ 已实现 |
| 3 | POST | `/sessions/{id}/courseware/slides/{page}/apply-layout` | 布局模板切换 | ✅ 已实现 |
| 4 | GET | `/users/me/images?keyword=xxx` | 图片库搜索（用于选图弹窗） | ✅ 已实现 |

---

## 1. 图片替换

### `PATCH /api/v1/sessions/{session_id}/courseware/slides/{page_index}/elements/{element_id}/image`

**功能**：将 PPT 某一页某图片元素的图源替换为用户图片库中的图片，并持久化到数据库。后续导出的 PPT 会使用新图片。

**路径参数**

| 参数 | 类型 | 说明 |
|---|---|---|
| `session_id` | string | 会话 ID |
| `page_index` | int | 页码（从 1 开始，与 `page_index` 字段对应） |
| `element_id` | string | 元素 ID（如 `e_a1b2c3`，来自预览数据） |

**请求体**

```json
{
  "image_id": "img_xxxxxxxx"
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `image_id` | string | 用户图片库中的图片 ID（通过 `GET /users/me/images` 获取） |

**成功响应 `200`**

```json
{
  "element_id": "e_a1b2c3",
  "page_index": 3,
  "image_id": "img_xxxxxxxx",
  "preview_url": "/api/v1/users/me/images/img_xxxxxxxx/preview"
}
```

**前端调用时机**：用户在图片选择弹窗中点击"应用"时调用。

**注意**：`preview_url` 需要携带 token 才能在 `<img>` 中显示，可通过追加 `?token=<jwt>` 实现：
```
/api/v1/users/me/images/img_xxx/preview?token=<jwt>
```

---

## 2. 手动编辑单页内容

### `PUT /api/v1/sessions/{session_id}/courseware/slides/{page_index}`

**功能**：将手动编辑后的页面数据持久化到数据库。导出 PPT 时会使用这里保存的内容。

**路径参数**

| 参数 | 类型 | 说明 |
|---|---|---|
| `session_id` | string | 会话 ID |
| `page_index` | int | 页码 |

**请求体**（所有字段均可选，只传实际改动的部分）

```json
{
  "title": "课程概览",
  "elements": [
    {
      "element_id": "e1",
      "type": "list",
      "position": "full",
      "content": [
        "刚体的基本定义与运动形式",
        "角动量、力矩的核心概念",
        "角动量定理与守恒定律"
      ],
      "is_accent": false
    }
  ],
  "speaker_notes": "提示：可先复习牛顿第二定律"
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `title` | string? | 页面标题 |
| `elements` | array? | 完整元素数组（**全量替换**，不传则保持原内容不变） |
| `elements[].element_id` | string | 元素唯一 ID（可省略，后端会自动生成） |
| `elements[].type` | string | 元素类型：`list` / `text_block` / `image` / `title` / `subtitle` 等 |
| `elements[].position` | string | 位置：`full` / `left` / `right` / `left_top` / `right_bottom` 等 |
| `elements[].content` | string[] | 文字内容数组 |
| `speaker_notes` | string? | 演讲者注记 |

**成功响应 `200`**

```json
{
  "page_index": 2,
  "slide": {
    "page_index": 2,
    "title": "课程概览",
    "layout_type": "minimal_list",
    "elements": [...]
  }
}
```

**特别说明**：若 `elements` 中包含图片元素但未传 `resolved` 字段，后端会**自动从旧数据回填**，防止手动编辑时丢失已替换的图片信息。

**前端调用时机**：手动编辑对话框点击"保存"或关闭时调用。

---

## 3. 布局模板切换

### `POST /api/v1/sessions/{session_id}/courseware/slides/{page_index}/apply-layout`

**功能**：程序化切换单页布局模板，**不经过 AI**，结果确定可靠。

与通过 AI 自然语言指令切换布局不同，此接口直接修改 `layout_type` 和 `position` 字段，保证导出 PPT 排版格式正确。

**路径参数**

| 参数 | 类型 | 说明 |
|---|---|---|
| `session_id` | string | 会话 ID |
| `page_index` | int | 页码 |

**请求体**

```json
{
  "layout_type": "two_column"
}
```

**支持的 `layout_type` 值**

| 值 | 说明 | ppt_exporter 支持 |
|---|---|---|
| `cover` | 封面页，大标题居中 | ✅ |
| `minimal_list` | 全幅列表，文字+图片各分区 | ✅ |
| `two_column` | 双栏，左文右图（按 position 字段分栏） | ✅ |
| `stat_callout` | 数据强调，大数字居中 | ✅ |
| `timeline` | 时间轴 | ✅ |
| `standard` | 标准（自动映射到 `minimal_list`） | ✅（映射） |
| `image_gallery` | 图片墙（自动映射到 `two_column`） | ✅（映射） |
| `full_content` | 全幅内容（自动映射到 `minimal_list`） | ✅（映射） |
| `card_grid` | 卡片网格（自动映射到 `minimal_list`） | ✅（映射） |
| `title_slide` | 标题页（自动映射到 `cover`） | ✅（映射） |

**成功响应 `200`**

```json
{
  "page_index": 3,
  "layout_type": "two_column",
  "original_layout_type": "two_column",
  "slide": {
    "page_index": 3,
    "title": "刚体基础概念",
    "layout_type": "two_column",
    "elements": [
      { "element_id": "e1", "type": "list", "position": "left", ... },
      { "element_id": "e2", "type": "image", "position": "right", ... }
    ]
  }
}
```

> `layout_type`：实际应用的布局（可能已被自动映射）  
> `original_layout_type`：前端请求的布局

**position 分配规则（two_column 时）**

```
image 元素  →  right / right_top / right_bottom
其他元素    →  left  / left_top  / left_bottom

若无图片元素：前半部分 → left，后半部分 → right
```

**其他布局**：ppt_exporter 按元素 `type` 分区（不看 `position`），无需修改 position 字段。

**前端调用时机**：用户在"切换布局"面板选择模板并确认时调用，返回的 `slide` 可直接替换本地状态刷新预览，无需重新拉取 preview 接口。

---

## 4. 图片库搜索

### `GET /api/v1/users/me/images`

**功能**：获取当前用户图片库列表，支持关键词搜索（用于图片选择弹窗）。

**查询参数**

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `page` | int | 1 | 页码 |
| `size` | int | 20 | 每页数量 |
| `keyword` | string? | — | 关键词，在 label / description / tags 中模糊搜索 |

**示例请求**
```
GET /api/v1/users/me/images?page=1&size=20&keyword=显微镜
```

**成功响应 `200`**

```json
{
  "total": 3,
  "items": [
    {
      "image_id": "img_xxxxxxxx",
      "filename": "microscope.jpg",
      "label": "光学显微镜示意图",
      "preview_url": "/api/v1/users/me/images/img_xxxxxxxx/preview",
      "annotate_status": "done",
      "tags": ["显微镜", "光学", "实验器材"],
      "description": "一张显示光学显微镜结构的示意图",
      "created_at": "2026-04-10T10:00:00Z"
    }
  ]
}
```

---

## 数据流说明

### 图片替换完整流程

```
① 前端：调用 GET /users/me/images?keyword=xxx 获取图片列表
         ↓
② 用户在弹窗中选图（image_id: img_yyy）
         ↓
③ 前端：调用 PATCH .../elements/{elem}/image
         → 后端更新 DB 中 resolved: { image_id: img_yyy, source: "user" }
         → 返回 preview_url
         ↓
④ 前端：用 preview_url?token=xxx 替换 <img src>，预览立即更新
         ↓
⑤ 用户点击导出 → POST /sessions/{id}/export
         → ppt_exporter 读 DB → 找到 image_id → 查询 UserImage.file_path
         → 将文件插入 PPTX → 导出文件包含新图片 ✅
```

### 手动编辑 + 布局切换完整流程

```
① 前端：用户打开手动编辑面板，修改标题和内容
         ↓
② 用户选择新布局（如 two_column）
         ↓
③ 前端：调用 POST .../apply-layout { layout_type: "two_column" }
         → 后端修改 layout_type + 重分配 position 字段 → 写 DB
         → 返回完整更新后的 slide
         ↓
④ 前端：用 slide 数据更新本地预览（不需要重新调用 preview 接口）
         ↓
⑤ 前端：调用 PUT .../slides/{page} { title, elements }
         → 后端保存手动编辑内容到 DB
         ↓
⑥ 导出 → ppt_exporter 读 DB → layout_type + position 都正确 → 排版格式正确 ✅
```

---

## 错误码

| HTTP 状态码 | 说明 |
|---|---|
| `400` | 请求参数错误（如不支持的 layout_type） |
| `401` | 未登录或 token 失效 |
| `404` | 会话/页面/元素/图片不存在 |
| `500` | 服务器内部错误 |

所有接口均需要携带 `Authorization: Bearer <token>` 请求头。
