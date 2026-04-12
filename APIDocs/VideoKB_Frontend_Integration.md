# 视频知识库 — 前端对接文档

> **版本**: v1.0 | **更新**: 2026-04-12  
> **前端对应文件**: `src/utils/videoKnowledgeApi.ts`（新增，不修改任何已有文件）  
> **后端路由前缀**: `/api/v1/knowledge-base/`

---

## 快速开始

```typescript
import {
  uploadKnowledgeFile,
  getKnowledgeDocument,
  getKeyframeUrl,
  pollVideoProgress,
  validateUploadFile,
  KBVideoDocument,
} from '../utils/videoKnowledgeApi';
```

---

## 端点一览

| Method | Path | 说明 |
|--------|------|------|
| `POST` | `/knowledge-base/documents` | 上传文档或视频 |
| `GET`  | `/knowledge-base/documents` | 获取文档列表（含视频字段）|
| `GET`  | `/knowledge-base/documents/{doc_id}` | 🆕 获取单个文档详情 |
| `DELETE` | `/knowledge-base/documents/{doc_id}` | 删除文档（含视频工作目录）|
| `GET`  | `/knowledge-base/documents/{doc_id}/keyframes/{filename}` | 🆕 获取关键帧图片 |
| `POST` | `/knowledge-base/documents/{doc_id}/retry` | 重试失败的文档 |

---

## 1. 上传文档/视频

### `POST /knowledge-base/documents`

**请求**（`multipart/form-data`）

| 字段 | 类型 | 说明 |
|------|------|------|
| `file` | File | 文件本体 |
| `metadata_json` | string | JSON 字符串，自定义元数据（可为 `{}`）|

**支持的格式**

| 类别 | 后缀 | 大小上限 |
|------|------|--------|
| 文档 | `.pdf` `.docx` `.doc` `.pptx` `.txt` `.md` `.json` `.csv` | 100 MB |
| 视频 | `.mp4` `.mov` `.avi` `.webm` `.mkv` `.flv` | **500 MB** |

**响应** `200`

```json
{
  "document_id": "doc_a1b2c3d4",
  "status": "processing",
  "file_type": "video"
}
```

**前端调用示例**

```typescript
// 1. 先校验（可选，防止无效请求）
const err = validateUploadFile(file);
if (err) { alert(err); return; }

// 2. 上传
const result = await uploadKnowledgeFile(file);

// 3. 视频：开始轮询进度
if (result.file_type === 'video') {
  const cancel = pollVideoProgress(result.document_id, (doc) => {
    console.log(`进度: ${doc.progress}%，阶段: ${(doc as KBVideoDocument).process_stage}`);
    if (doc.status === 'completed') {
      setVideoDoc(doc as KBVideoDocument);
      cancel();
    }
  });
}
```

---

## 2. 获取文档列表

### `GET /knowledge-base/documents?page=1&size=20`

**响应** `200`

```json
{
  "total": 5,
  "page": 1,
  "size": 20,
  "has_more": false,
  "items": [
    {
      "document_id": "doc_a1b2c3d4",
      "filename": "lecture.mp4",
      "status": "completed",
      "progress": 100,
      "file_type": "video",
      "duration_sec": 754,
      "process_stage": "done",
      "summary": "本视频讲解了转动惯量...",
      "transcript_json": [{"start":0.0,"end":5.2,"text":"今天我们来学习..."}],
      "keyframes_json": [{"filename":"frame_0001.jpg","timestamp_est":0,"description":"..."}],
      "video_summary": "**主要内容**：...\n**核心知识点**：..."
    },
    {
      "document_id": "doc_e5f6g7h8",
      "filename": "教案.pdf",
      "status": "completed",
      "progress": 100,
      "file_type": "document",
      "summary": "Total length: 8432 characters extracted."
    }
  ]
}
```

> ⚠️ **旧数据兼容**：2026-04-12 前上传的文档 `file_type` 字段可能为 `null`，前端应将 `null` 视为 `"document"`。

---

## 3. 🆕 获取单个文档详情

### `GET /knowledge-base/documents/{doc_id}`

用于获取包含完整 `transcript_json` / `keyframes_json` / `video_summary` 的详情（列表接口同样包含这些字段，单独接口方便定向查询）。

**响应** `200`（视频文档示例）

```json
{
  "document_id": "doc_a1b2c3d4",
  "filename": "lecture.mp4",
  "status": "completed",
  "progress": 100,
  "file_type": "video",
  "duration_sec": 754,
  "process_stage": "done",
  "transcript_json": [
    {"start": 0.0,  "end": 5.2,  "text": "今天我们来学习转动惯量的基本概念。"},
    {"start": 5.2,  "end": 12.8, "text": "转动惯量描述物体对旋转运动的惯性大小。"}
  ],
  "keyframes_json": [
    {
      "filename": "frame_0001.jpg",
      "timestamp_est": 0,
      "description": "PPT封面，标题：《转动惯量》，板书有定义式 I=∫r²dm。"
    },
    {
      "filename": "frame_0002.jpg",
      "timestamp_est": 180,
      "description": "黑板推导，展示均质圆盘转动惯量公式 I=½mR²。"
    }
  ],
  "video_summary": "**主要内容**：本视频系统讲解了转动惯量的定义...\n**核心知识点**：\n- 转动惯量定义\n- 平行轴定理\n**重要公式**：\n- $I = \\int r^2 dm$"
}
```

---

## 4. 🆕 获取关键帧图片

### `GET /knowledge-base/documents/{doc_id}/keyframes/{filename}?token={jwt}`

**特殊说明**：`<img>` 标签无法发送 `Authorization` header，必须通过 `?token=` 查询参数传递 JWT。

**✅ 正确用法**（使用 `getKeyframeUrl` 辅助函数）

```tsx
import { getKeyframeUrl } from '../utils/videoKnowledgeApi';

// 组件中直接使用
{doc.keyframes_json?.map((kf, i) => (
  <img
    key={i}
    src={getKeyframeUrl(doc.document_id, kf.filename)}
    alt={`关键帧 ${i + 1}`}
    style={{ width: 180, height: 100, objectFit: 'cover' }}
  />
))}
```

**❌ 错误用法**（缺少 token，返回 403）

```tsx
// 不要这样写！
<img src={`${API_BASE_URL}/knowledge-base/documents/${docId}/keyframes/${filename}`} />
```

**响应**：直接返回 JPEG 图片流（`Content-Type: image/jpeg`）。

---

## 5. 视频处理进度

### 阶段 → 进度映射

| `process_stage` | `progress` | 展示文案 |
|----------------|-----------|--------|
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

### 轮询建议

- **间隔**：3 秒（语音识别阶段可能停留较久，无需缩短）
- **停止条件**：`status === 'completed'` 或 `status === 'failed'`
- **推荐方式**：使用 `pollVideoProgress()` 辅助函数（自动管理定时器）

```typescript
// 使用 pollVideoProgress（推荐）
const cancel = pollVideoProgress(docId, (doc) => {
  setDoc(doc);
  if (doc.status === 'completed' || doc.status === 'failed') cancel();
});

// 组件卸载时务必调用
useEffect(() => cancel, []);
```

---

## 6. 类型定义速查

```typescript
// 从 videoKnowledgeApi.ts 导入
import type {
  TranscriptSegment,    // {start, end, text}
  KeyframeInfo,         // {filename, timestamp_est, description}
  KBVideoDocument,      // 视频文档完整类型
  KBDocumentBase,       // 通用文档类型
  VideoProcessStage,    // 处理阶段枚举字符串
} from '../utils/videoKnowledgeApi';
```

---

## 7. 常见问题

**Q: 上传视频后列表里没有字幕/关键帧数据？**  
A: 正常现象。视频处理是异步的，需要 3-10 分钟。通过轮询 `status` 字段等待 `completed` 后再读取这些字段。

**Q: 关键帧图片显示 403？**  
A: 必须使用 `getKeyframeUrl()` 函数构建 URL（附带 `?token=`），直接拼接 URL 不带 token 会 403。

**Q: 视频处理失败？**  
A: 调用 `retryKnowledgeDocument(docId)` 重试，无需重新上传文件。失败原因查看 `doc.summary` 字段。

**Q: `file_type` 字段为 null？**  
A: 旧数据（2026-04-12 前上传）缺少此字段，应视为 `"document"`：
```typescript
const fileType = doc.file_type ?? 'document';
```

---

## 8. 完整集成示例

```tsx
import React, { useEffect, useState } from 'react';
import {
  uploadKnowledgeFile,
  getKeyframeUrl,
  pollVideoProgress,
  validateUploadFile,
  formatDuration,
  VIDEO_STAGE_LABELS,
  KBVideoDocument,
  KBDocumentBase,
} from '../utils/videoKnowledgeApi';

function VideoKBDemo() {
  const [doc, setDoc] = useState<KBDocumentBase | KBVideoDocument | null>(null);

  const handleUpload = async (file: File) => {
    // 1. 前端校验
    const err = validateUploadFile(file);
    if (err) { alert(err); return; }

    // 2. 上传
    const result = await uploadKnowledgeFile(file);
    setDoc({ document_id: result.document_id, filename: file.name, status: 'processing', file_type: result.file_type });

    // 3. 轮询（仅视频需要等较长时间）
    const cancel = pollVideoProgress(result.document_id, (updated) => {
      setDoc(updated);
      if (updated.status === 'completed' || updated.status === 'failed') cancel();
    });
  };

  const videoDoc = doc as KBVideoDocument;
  return (
    <div>
      <input type="file" accept=".mp4,.mov,.avi,.webm,.pdf,.docx" onChange={e => e.target.files?.[0] && handleUpload(e.target.files[0])} />

      {doc && (
        <div>
          <p>{doc.filename} — {doc.status} {doc.progress}%</p>

          {/* 进度阶段 */}
          {doc.status === 'processing' && videoDoc.process_stage && (
            <p>{VIDEO_STAGE_LABELS[videoDoc.process_stage] ?? videoDoc.process_stage}</p>
          )}

          {/* 视频处理完成后展示 */}
          {doc.status === 'completed' && doc.file_type === 'video' && (
            <>
              <p>时长：{formatDuration(videoDoc.duration_sec)}</p>

              <h4>AI 摘要</h4>
              <pre>{videoDoc.video_summary}</pre>

              <h4>关键帧</h4>
              {videoDoc.keyframes_json?.map((kf, i) => (
                <img key={i} src={getKeyframeUrl(doc.document_id, kf.filename)} alt={`帧${i+1}`} width={180} />
              ))}

              <h4>字幕</h4>
              {videoDoc.transcript_json?.map((seg, i) => (
                <p key={i}>[{formatDuration(Math.floor(seg.start))}] {seg.text}</p>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
```
