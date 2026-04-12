# 知识库视频处理 — 前端进度轮询 API 文档

> **接口前缀**：`/api/v1/knowledge-base/`  
> **认证方式**：请求头 `Authorization: Bearer <token>`  
> **文档版本**：v1.1 (2026-04-12)

---

## 一、上传视频文件

### `POST /knowledge-base/documents`

**请求**（`multipart/form-data`）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `file` | File | ✅ | 视频文件 |
| `metadata_json` | string | ❌ | 自定义 JSON 元数据（如 `{}`）|

**支持格式与大小限制**

| 类型 | 后缀 | 上限 |
|------|------|------|
| 视频 | `.mp4` `.mov` `.avi` `.webm` `.mkv` `.flv` | **500 MB** |
| 文档 | `.pdf` `.docx` `.pptx` `.txt` `.md` | 100 MB |

**响应** `200`

```json
{
  "document_id": "doc_a1b2c3d4",
  "status": "processing",
  "file_type": "video"
}
```

上传成功后，后台立即启动异步 7 阶段处理流水线。**前端拿到 `document_id` 后应开始轮询进度**。

---

## 二、轮询进度（核心接口）

### `GET /knowledge-base/documents?page=1&size=50`

建议每 **3 秒**调用一次，直到 `status` 变为 `completed` 或 `failed`。

**视频文档的响应字段**

```json
{
  "total": 2,
  "page": 1,
  "size": 50,
  "has_more": false,
  "items": [
    {
      "document_id": "doc_a1b2c3d4",
      "filename": "lecture.mp4",
      "file_type": "video",
      "status": "processing",
      "progress": 35,
      "process_stage": "extracting_frames",
      "stage_label": "🖼 提取关键帧...",
      "duration_sec": null,
      "transcript_json": null,
      "keyframes_json": null,
      "video_summary": null,
      "summary": null,
      "created_at": "2026-04-12T15:00:00"
    }
  ]
}
```

### 进度字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `status` | string | `pending` / `processing` / `completed` / `failed` |
| `progress` | integer | 0 ~ 100，当前进度百分比 |
| `process_stage` | string \| null | 当前处理阶段的机器码（处理中有值，完成/失败后为 null）|
| `stage_label` | string \| null | **⭐ 当前阶段的中文展示文案**，直接用于 UI 显示 |

> **`stage_label` 由后端统一维护**，前端直接渲染即可，无需自己维护翻译表。

### 处理阶段完整映射

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

## 三、处理完成后的数据结构

当 `status === "completed"` 时，所有视频分析字段才有值：

```json
{
  "document_id": "doc_a1b2c3d4",
  "filename": "lecture.mp4",
  "file_type": "video",
  "status": "completed",
  "progress": 100,
  "process_stage": null,
  "stage_label": null,
  "duration_sec": 1842,
  "summary": "本视频讲解了转动惯量...",
  "video_summary": "**主要内容**：...\n**核心知识点**：\n- 转动惯量定义\n- 平行轴定理\n**重要公式**：\n- $I = \\int r^2 dm$",
  "transcript_json": [
    { "start": 0.0,  "end": 5.2,  "text": "今天我们来学习转动惯量的基本概念。" },
    { "start": 5.2,  "end": 12.8, "text": "转动惯量描述物体对旋转运动的惯性大小。" }
  ],
  "keyframes_json": [
    {
      "filename": "frame_0001.jpg",
      "timestamp_est": 0,
      "description": "PPT封面，标题《转动惯量》，板书有定义式 I=∫r²dm。"
    },
    {
      "filename": "frame_0005.jpg",
      "timestamp_est": 460,
      "description": "黑板推导均质圆盘公式 I=½mR²，并给出积分过程。"
    }
  ],
  "created_at": "2026-04-12T15:00:00"
}
```

### 各字段含义

| 字段 | 类型 | 说明 |
|------|------|------|
| `duration_sec` | integer \| null | 视频总时长（秒），读取元数据后写入 |
| `video_summary` | string \| null | LLM 生成的结构化综合摘要（含主要内容/知识点/公式） |
| `summary` | string \| null | 简短摘要（500字以内），用于列表卡片展示 |
| `transcript_json` | array \| null | Whisper 字幕段列表，见下表 |
| `keyframes_json` | array \| null | 关键帧信息列表，见下表 |

**`transcript_json` 元素结构**

| 字段 | 类型 | 说明 |
|------|------|------|
| `start` | float | 开始时间（秒） |
| `end` | float | 结束时间（秒） |
| `text` | string | 该段语音文字 |

**`keyframes_json` 元素结构**

| 字段 | 类型 | 说明 |
|------|------|------|
| `filename` | string | 帧图片文件名（如 `frame_0001.jpg`）|
| `timestamp_est` | integer | 估算时间戳（秒） |
| `description` | string | Vision LLM 对该帧画面的描述 |

---

## 四、其他接口

### 删除文档

```
DELETE /knowledge-base/documents/{doc_id}
```

同时清理：向量索引 + 原始文件 + 视频工作目录（含关键帧图片）。

### 重试失败的视频

```
POST /knowledge-base/documents/{doc_id}/retry
```

对 `status === "failed"` 的文档重新触发处理，无需重新上传。

**响应**

```json
{ "document_id": "doc_a1b2c3d4", "status": "processing" }
```

---

## 五、前端推荐实现方式

### 进度条展示逻辑

```javascript
// 轮询结果中的视频文档
const doc = items.find(d => d.document_id === targetId);

if (doc.status === 'processing') {
  // progress 直接控制进度条宽度
  progressBar.style.width = `${doc.progress}%`;

  // stage_label 直接展示，后端已翻译好
  statusText.textContent = doc.stage_label ?? `处理中 ${doc.progress}%`;
}

if (doc.status === 'completed') {
  // 渲染摘要、关键帧、字幕
  showSummary(doc.video_summary);
  showKeyframes(doc.keyframes_json);
  showTranscript(doc.transcript_json);
}

if (doc.status === 'failed') {
  showError('处理失败，可点击重试');
}
```

### 轮询控制

```javascript
// 开始轮询
const timer = setInterval(async () => {
  const data = await fetchDocuments();   // GET /knowledge-base/documents
  const hasProcessing = data.items.some(
    d => d.status === 'processing' || d.status === 'pending'
  );
  if (!hasProcessing) clearInterval(timer);  // 全部处理完毕，停止轮询
}, 3000);  // 每 3 秒一次

// 组件卸载时务必清理
onUnmount(() => clearInterval(timer));
```

---

## 六、旧数据兼容说明

| 问题 | 处理方式 |
|------|---------|
| `file_type` 为 `null`（2026-04-12 前上传的文档）| 视为 `"document"` |
| 视频但 `stage_label` 为 `null` | 表示处理完成或失败，参考 `status` 字段 |
| `progress` 为 0 且 `status` 为 `"pending"` | 任务已入队，等待工作线程拾取（正常现象）|
