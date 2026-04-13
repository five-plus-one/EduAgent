# 知识库 API 文档

> **版本**: v1.2 | **更新日期**: 2026-04-13
> **路由前缀**: `/api/v1/knowledge-base`
> **鉴权**: 所有接口均需 `Authorization: Bearer <access_token>`
> `?token=<access_token>` 作为降级方案（专供 `<img>` / `<a>` / `<iframe>` 无法设置 Header 的场景）

---

## 目录

| # | Method | 路径 | 说明 |
|---|--------|------|------|
| 1 | `POST`   | `/documents` | 上传文档或视频 |
| 2 | `GET`    | `/documents` | 获取文档列表（分页） |
| 3 | `PATCH`  | `/documents/{doc_id}` | 更新名称 / 描述 |
| 4 | `PUT`    | `/documents/{doc_id}` | 替换全部 metadata |
| 5 | `DELETE` | `/documents/{doc_id}` | 删除文档 |
| 6 | `POST`   | `/documents/{doc_id}/retry` | 重新处理失败文档 |
| 7 | `GET`    | `/documents/{doc_id}/download` | 下载原始文件 |
| 8 | `GET`    | `/documents/{doc_id}/preview` | 在线预览文件 |
| 9 | `GET`    | `/documents/{doc_id}/keyframes/{filename}` | 获取视频关键帧图片 |

---

## 1. 上传文档或视频

**`POST /documents`**  
`Content-Type: multipart/form-data`

### 请求

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `file` | File | ✅ | 文件本体 |
| `metadata_json` | string | ❌ | 自定义 JSON 字符串，默认 `"{}"` |

### 支持格式与大小限制

| 类型 | 后缀 | 限制 |
|------|------|------|
| 文档 | `.pdf` `.docx` `.doc` `.pptx` `.txt` `.md` `.json` `.csv` | **100 MB** |
| 视频 | `.mp4` `.mov` `.avi` `.webm` `.mkv` `.flv` | **500 MB** |

### 响应 `200`

```json
{
  "document_id": "doc_a1b2c3d4",
  "status": "processing",
  "file_type": "video"
}
```

> 上传成功后立即返回，后台异步处理。请用 **接口 2** 轮询进度。

---

## 2. 获取文档列表

**`GET /documents?page=1&size=20&status=`**

### Query 参数

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `page` | int | `1` | 页码 |
| `size` | int | `20` | 每页数量 |
| `status` | string | 空（全部）| 筛选状态：`pending` / `processing` / `completed` / `failed` |

### 响应 `200`

```json
{
  "total": 12,
  "page": 1,
  "size": 20,
  "has_more": false,
  "items": [
    {
      "document_id":  "doc_a1b2c3d4",
      "filename":     "lecture_06.mp4",
      "display_name": "第六章-简谐振动",
      "description":  "2024秋大学物理配套视频",
      "file_type":    "video",
      "status":       "processing",
      "progress":     52,
      "process_stage": "analyzing_frames",
      "stage_label":  "🤖 AI 分析画面...",
      "summary":      null,
      "metadata":     {},
      "created_at":   "2026-04-13T04:00:00",
      "duration_sec": 1842,
      "transcript_json": null,
      "keyframes_json":  null,
      "video_summary":   null
    },
    {
      "document_id":  "doc_b2c3d4e5",
      "filename":     "chapter5.pdf",
      "display_name": null,
      "description":  null,
      "file_type":    "document",
      "status":       "completed",
      "progress":     100,
      "process_stage": null,
      "stage_label":  null,
      "summary":      "Total length: 8432 characters extracted.",
      "metadata":     {},
      "created_at":   "2026-04-12T10:00:00"
    }
  ]
}
```

### 字段说明

#### 通用字段（所有类型）

| 字段 | 类型 | 说明 |
|------|------|------|
| `document_id` | string | 文档唯一 ID |
| `filename` | string | 原始物理文件名（不可修改） |
| `display_name` | string \| null | 用户自定义显示名（可通过 PATCH 修改） |
| `description` | string \| null | 用户自定义描述 |
| `file_type` | `"document"` \| `"video"` | 文件类型 |
| `status` | string | `pending` / `processing` / `completed` / `failed` |
| `progress` | int | 0～100 进度百分比 |
| `process_stage` | string \| null | 处理中的细粒度阶段码（完成/失败后为 null） |
| `stage_label` | string \| null | ⭐ **阶段中文文案，直接用于 UI 展示** |
| `summary` | string \| null | 简短摘要 |
| `metadata` | object | 原始 metadata |
| `created_at` | string | ISO 8601 时间戳 |

#### 视频专用字段（`file_type === "video"` 时附加）

| 字段 | 类型 | 说明 |
|------|------|------|
| `duration_sec` | int \| null | 视频总时长（秒） |
| `transcript_json` | array \| null | 字幕段列表，见下 |
| `keyframes_json` | array \| null | 关键帧列表，见下 |
| `video_summary` | string \| null | LLM 生成的结构化摘要 |

**`transcript_json` 元素**

```json
{ "start": 0.0, "end": 5.2, "text": "今天我们来学习简谐振动。" }
```

**`keyframes_json` 元素**

```json
{
  "filename":      "frame_0001.jpg",
  "timestamp_est": 0,
  "description":   "PPT 封面，标题《简谐振动》"
}
```

### 视频处理阶段完整表

| `process_stage` | `progress` | `stage_label` |
|----------------|-----------|---------------|
| `reading_metadata` | 5% | 🎬 读取视频信息... |
| `extracting_audio` | 10% | 🔊 提取音频... |
| `transcribing` | 15% | 🎵 语音识别中... |
| `transcribing_done` | 30% | ✅ 语音识别完成 |
| `extracting_frames` | 35% | 🖼 提取关键帧... |
| `extracting_frames_done` | 50% | ✅ 关键帧提取完成 |
| `analyzing_frames` | 52% | 🤖 AI 分析画面... |
| `analyzing_frames_done` | 75% | ✅ 画面分析完成 |
| `summarizing` | 78% | 📋 生成摘要... |
| `summarizing_done` | 88% | ✅ 摘要生成完成 |
| `indexing` | 90% | 📦 向量化索引中... |
| `done` | 100% | ✅ 处理完成 |

---

## 3. 更新文档名称 / 描述

**`PATCH /documents/{doc_id}`**  
`Content-Type: application/json`

两个字段均可选，**至少传一个**。

### 请求体

```json
{
  "display_name": "第六章配套视频",
  "description": "2024秋大学物理，涵盖简谐振动与受迫振动"
}
```

| 字段 | 类型 | 必填 | 约束 |
|------|------|------|------|
| `display_name` | string | ❌ | 1–100 字 |
| `description` | string | ❌ | 1–500 字 |

### 响应 `200`

```json
{
  "document_id":  "doc_a1b2c3d4",
  "display_name": "第六章配套视频",
  "description":  "2024秋大学物理，涵盖简谐振动与受迫振动"
}
```

> 前端展示时建议优先用 `display_name`，为空则 fallback 到 `filename`：
> ```ts
> const title = doc.display_name ?? doc.filename
> ```

---

## 4. 替换全部 Metadata

**`PUT /documents/{doc_id}`**  
`Content-Type: application/json`

直接传入完整 metadata 对象替换，慎用（会覆盖所有现有 metadata）。

### 请求体

```json
{ "custom_key": "custom_value" }
```

### 响应 `204` No Content

---

## 5. 删除文档

**`DELETE /documents/{doc_id}`**

同时清理：向量索引 + 原始文件 + 视频工作目录（含关键帧图片）。

### 响应 `204` No Content

---

## 6. 重新处理失败文档

**`POST /documents/{doc_id}/retry`**

对 `status === "failed"` 或 `"pending"` 的文档重新触发处理，**无需重新上传**。  
重试前会自动清理上次失败产生的临时文件。

### 响应 `200`

```json
{ "document_id": "doc_a1b2c3d4", "status": "processing" }
```

### 错误

| 状态码 | 说明 |
|--------|------|
| `400` | 文档不是 failed/pending 状态，或原始文件已被清理 |
| `404` | 文档不存在 |

---

## 7. 下载原始文件

**`GET /documents/{doc_id}/download?token=<JWT>`**

触发浏览器下载对话框，返回原始文件（PDF、视频等）。

### 前端用法

```tsx
// 推荐：直接用 <a href> 无需 fetch，支持大文件
const downloadUrl = `${API_BASE}/knowledge-base/documents/${docId}/download?token=${token}`;

<a href={downloadUrl} download={doc.filename}>
  下载
</a>
```

### 响应

- `Content-Type`: 文件对应 MIME 类型
- `Content-Disposition`: `attachment; filename*=UTF-8''<编码文件名>`

---

## 8. 在线预览文件

**`GET /documents/{doc_id}/preview?token=<JWT>`**

在浏览器内联展示文件（不弹下载框）。

### 各格式行为

| 格式 | 行为 |
|------|------|
| `.pdf` | `200` 内联返回，浏览器 PDF 渲染器 |
| `.png` `.jpg` `.webp` `.gif` | `200` 内联图片 |
| `.mp4` `.mov` `.webm` | `200` 内联视频（支持 Range 请求，进度条可拖） |
| `.txt` `.md` `.csv` | `200` 内联纯文本 |
| `.docx` `.pptx` `.xlsx` | `302` 重定向到 `/download` |

### 前端用法

```tsx
const previewUrl = `${API_BASE}/knowledge-base/documents/${docId}/preview?token=${token}`;

// PDF 内嵌预览
<iframe src={previewUrl} style={{ width: '100%', height: 480 }} />

// 视频内嵌播放
<video src={previewUrl} controls style={{ width: '100%' }} />

// 新标签页打开（通用）
<a href={previewUrl} target="_blank" rel="noopener noreferrer">预览</a>
```

---

## 9. 获取视频关键帧图片

**`GET /documents/{doc_id}/keyframes/{filename}?token=<JWT>`**

返回关键帧 JPEG 图片，供 `<img>` 标签直接嵌入。

### 路径参数

| 参数 | 说明 |
|------|------|
| `doc_id` | 文档 ID |
| `filename` | 帧文件名，如 `frame_0001.jpg`（从 `keyframes_json[].filename` 取得）|

### 前端用法

```tsx
// 遍历 keyframes_json 渲染关键帧
{doc.keyframes_json?.map(kf => (
  <img
    key={kf.filename}
    src={`${API_BASE}/knowledge-base/documents/${doc.document_id}/keyframes/${kf.filename}?token=${token}`}
    alt={kf.description}
    title={`${kf.timestamp_est}s: ${kf.description}`}
  />
))}
```

### 响应

- `Content-Type`: `image/jpeg`
- `Cache-Control`: `private, max-age=86400`（关键帧内容不变，可缓存 1 天）

---

## 前端通用工具函数

```typescript
// src/utils/knowledgeBaseApi.ts

const API_BASE = import.meta.env.VITE_API_BASE_URL + '/api/v1/knowledge-base';
const getToken = () => localStorage.getItem('access_token') ?? '';

/** 下载 URL（<a href> 直接使用） */
export function getDownloadUrl(docId: string) {
  return `${API_BASE}/documents/${docId}/download?token=${encodeURIComponent(getToken())}`;
}

/** 预览 URL（<iframe>/<video>/<img> 直接使用） */
export function getPreviewUrl(docId: string) {
  return `${API_BASE}/documents/${docId}/preview?token=${encodeURIComponent(getToken())}`;
}

/** 关键帧图片 URL */
export function getKeyframeUrl(docId: string, filename: string) {
  return `${API_BASE}/documents/${docId}/keyframes/${filename}?token=${encodeURIComponent(getToken())}`;
}

/** 更新显示名或描述 */
export async function patchDocument(
  docId: string,
  data: { display_name?: string; description?: string }
) {
  const res = await fetch(`${API_BASE}/documents/${docId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${getToken()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });
  return res.json();
}

/** 重新处理失败文档 */
export async function retryDocument(docId: string) {
  const res = await fetch(`${API_BASE}/documents/${docId}/retry`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${getToken()}` },
  });
  return res.json();
}

/** 进度轮询（每 3 秒调用一次） */
export async function pollDocuments(page = 1, size = 50) {
  const res = await fetch(`${API_BASE}/documents?page=${page}&size=${size}`, {
    headers: { 'Authorization': `Bearer ${getToken()}` },
  });
  return res.json();
}
```

---

## 进度轮询示例

```typescript
// 上传后开始轮询，直到所有任务完成
let timer: ReturnType<typeof setInterval>;

function startPolling() {
  timer = setInterval(async () => {
    const data = await pollDocuments();
    const stillProcessing = data.items.some(
      d => d.status === 'pending' || d.status === 'processing'
    );

    // 更新 UI
    data.items.forEach(doc => {
      if (doc.status === 'processing') {
        // 直接用后端提供的中文文案
        updateProgressBar(doc.document_id, doc.progress, doc.stage_label);
      }
    });

    if (!stillProcessing) {
      clearInterval(timer); // 全部完成，停止轮询
    }
  }, 3000);
}

// 组件卸载时清理
onUnmount(() => clearInterval(timer));
```

---

## 错误码汇总

| 状态码 | 含义 | 常见原因 |
|--------|------|---------|
| `400` | 请求参数错误 | 格式不支持 / 文件超限 / 重试非失败文档 |
| `401` | 未认证 | Token 缺失或无效 |
| `403` | 无权访问 | 文档属于其他用户 |
| `404` | 资源不存在 | 文档 ID 错误 / 文件已被清理 / 关键帧不存在 |
| `413` | 文件过大 | 超过 100MB（文档）或 500MB（视频）|
| `500` | 服务器错误 | 内部异常，联系后端排查 |
