# 知识库文件预览与下载 API — 后端需求文档

> **版本**: v1.0 | **日期**: 2026-04-13  
> **路由前缀**: `/api/v1/knowledge-base/`  
> **鉴权方式**: 所有接口均需 `Authorization: Bearer <access_token>`（`?token=` 参数作为降级方案，专用于 `<img>` / `<a download>` 等无法设置 Header 的场景）

---

## 背景与现状

### 已有接口（后端已实现，前端已对接）

| Method | Path | 说明 |
|--------|------|------|
| `POST`   | `/knowledge-base/documents` | 上传文档/视频 |
| `GET`    | `/knowledge-base/documents` | 获取文档列表 |
| `GET`    | `/knowledge-base/documents/{doc_id}` | 获取单个文档详情（含视频字段）|
| `PUT`    | `/knowledge-base/documents/{doc_id}` | 更新文档 metadata |
| `DELETE` | `/knowledge-base/documents/{doc_id}` | 删除文档 |
| `POST`   | `/knowledge-base/documents/{doc_id}/retry` | 重试失败文档 |
| `GET`    | `/knowledge-base/documents/{doc_id}/keyframes/{filename}` | 获取视频关键帧图片 |

### 缺失接口（本文档需求）

| Method | Path | 说明 |
|--------|------|------|
| `GET`  | `/knowledge-base/documents/{doc_id}/download` | 🆕 下载原始文件 |
| `GET`  | `/knowledge-base/documents/{doc_id}/preview` | 🆕 在线预览原始文件（PDF / 图片直接流，其他跳转下载）|
| `PATCH`| `/knowledge-base/documents/{doc_id}` | 🆕 更新文档描述（description 字段）|

---

## 接口详细说明

---

### 🆕 1. 下载原始文件

**`GET /knowledge-base/documents/{doc_id}/download`**

触发浏览器下载对话框，将原始上传文件（PDF、视频等）以原始文件名提供给用户。

#### 路径参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `doc_id` | string | 文档 ID，如 `doc_a1b2c3d4` |

#### Query 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `token` | string | 否 | JWT Token 降级传参（`<a href="...?token=xxx">` 等无法设置 Header 的场景）|

#### 响应

- **成功 `200`**：返回文件流
  - `Content-Type`: 文件对应 MIME 类型（如 `application/pdf`、`video/mp4`）
  - `Content-Disposition`: `attachment; filename*=UTF-8''<原始文件名>`（强制触发下载）
  - `Content-Length`: 文件字节数

- **失败**

| 状态码 | 说明 |
|--------|------|
| `401` | 未鉴权或 Token 无效 |
| `403` | 该文档不属于当前用户 |
| `404` | 文档不存在或文件已被清理 |

#### 实现要点（后端参考）

```python
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
import os, urllib.parse

@router.get("/documents/{doc_id}/download")
def download_document(
    doc_id: str,
    token: str = Query(default=None),          # 降级 ?token= 鉴权
    current_user: User = Depends(deps.get_current_user_or_token),
    db: Session = Depends(deps.get_db),
):
    doc = db.query(Document).filter(
        Document.id == doc_id, Document.user_id == current_user.id
    ).first()
    if not doc:
        raise HTTPException(404, "Document not found")
    if not doc.file_path or not os.path.exists(doc.file_path):
        raise HTTPException(404, "File not found on disk")

    encoded_name = urllib.parse.quote(doc.filename, safe="")
    return FileResponse(
        path=doc.file_path,
        filename=doc.filename,
        media_type="application/octet-stream",   # 强制下载
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{encoded_name}"
        },
    )
```

> **提示**：`get_current_user_or_token` 应同时支持 `Authorization: Bearer` Header 和 `?token=` Query 参数两种鉴权方式（参考现有 `/keyframes/{filename}` 的实现）。

---

### 🆕 2. 在线预览文件

**`GET /knowledge-base/documents/{doc_id}/preview`**

在浏览器中内联展示文件。对 PDF 和图片直接流式返回（浏览器内联渲染），对 Office/视频等格式重定向到下载接口。

#### 路径参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `doc_id` | string | 文档 ID |

#### Query 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `token` | string | 否 | JWT 降级参数（`<iframe src="...?token=">` 场景）|

#### 各格式响应行为

| 文件格式 | 响应方式 | Content-Type |
|---------|---------|--------------|
| `.pdf` | 内联流式返回 | `application/pdf` |
| `.png` `.jpg` `.jpeg` `.webp` `.gif` | 内联流式返回 | `image/png` / `image/jpeg` 等 |
| `.mp4` `.mov` `.webm` | 内联流式返回（支持 Range） | `video/mp4` / `video/webm` |
| `.docx` `.pptx` `.xlsx` | `302` 重定向至 `/download` | —（由 download 接口触发下载）|
| `.txt` `.md` `.csv` | 内联纯文本 | `text/plain; charset=utf-8` |

- **成功 `200`**：
  - `Content-Disposition`: `inline; filename*=UTF-8''<原始文件名>`（内联展示）
  - PDF/视频支持响应 `Range` 请求（`206 Partial Content`）

- **失败**：同下载接口

#### 实现要点（后端参考）

```python
import mimetypes
from fastapi.responses import FileResponse, RedirectResponse

INLINE_TYPES = {
    ".pdf", ".png", ".jpg", ".jpeg", ".webp", ".gif",
    ".mp4", ".mov", ".webm", ".mkv",
    ".txt", ".md", ".csv",
}

@router.get("/documents/{doc_id}/preview")
def preview_document(
    doc_id: str,
    token: str = Query(default=None),
    current_user: User = Depends(deps.get_current_user_or_token),
    db: Session = Depends(deps.get_db),
):
    doc = db.query(Document).filter(
        Document.id == doc_id, Document.user_id == current_user.id
    ).first()
    if not doc:
        raise HTTPException(404, "Document not found")
    if not doc.file_path or not os.path.exists(doc.file_path):
        raise HTTPException(404, "File not found on disk")

    ext = os.path.splitext(doc.filename)[1].lower()
    if ext not in INLINE_TYPES:
        # 不支持内联预览的格式，重定向到下载
        return RedirectResponse(
            url=f"/api/v1/knowledge-base/documents/{doc_id}/download"
               + (f"?token={token}" if token else ""),
            status_code=302,
        )

    mime_type, _ = mimetypes.guess_type(doc.filename)
    encoded_name = urllib.parse.quote(doc.filename, safe="")
    return FileResponse(
        path=doc.file_path,
        media_type=mime_type or "application/octet-stream",
        headers={
            "Content-Disposition": f"inline; filename*=UTF-8''{encoded_name}",
            "Accept-Ranges": "bytes",     # 支持视频 Range 请求
        },
    )
```

> **视频流注意**：FastAPI 的 `FileResponse` 默认支持 `Range` 请求（需 Starlette ≥ 0.20）。对大视频文件建议配合 `FileResponse` 使用，或在 Nginx 层增加 `proxy_pass` 转发。

---

### 🆕 3. 更新文档描述

**`PATCH /knowledge-base/documents/{doc_id}`**

允许用户为知识库文档补充自定义描述（用途说明、课程关联等）。与现有 `PUT /documents/{doc_id}` 区别：`PUT` 替换整个 `metadata`，`PATCH` 只更新 `description` 字段，不影响其他字段。

#### 路径参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `doc_id` | string | 文档 ID |

#### 请求体 `application/json`

```json
{
  "description": "2024 秋季学期《大学物理》第六章配套课件，涵盖简谐振动与受迫振动内容。"
}
```

| 字段 | 类型 | 必填 | 约束 |
|------|------|------|------|
| `description` | string | 是 | 1–500 字符 |

#### 响应 `200 OK`

```json
{
  "document_id": "doc_94e73474",
  "description": "2024 秋季学期《大学物理》第六章配套课件，涵盖简谐振动与受迫振动内容。"
}
```

#### 失败

| 状态码 | 说明 |
|--------|------|
| `400` | `description` 为空或超过 500 字 |
| `403` | 文档不属于当前用户 |
| `404` | 文档不存在 |

#### 实现要点（后端参考）

```python
from pydantic import BaseModel, Field

class PatchDocumentRequest(BaseModel):
    description: str = Field(..., min_length=1, max_length=500)

@router.patch("/documents/{doc_id}")
def patch_document(
    doc_id: str,
    body: PatchDocumentRequest,
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db),
):
    doc = db.query(Document).filter(
        Document.id == doc_id, Document.user_id == current_user.id
    ).first()
    if not doc:
        raise HTTPException(404, "Document not found")

    # 将 description 写入 metadata_json（如 Document 模型没有独立的 description 列）
    meta = doc.metadata_json or {}
    meta["description"] = body.description
    doc.metadata_json = meta
    db.commit()

    return {"document_id": doc_id, "description": body.description}
```

> **数据库建议**：若 `Document` 模型有独立的 `description` 列，直接写入更优；若只有 `metadata_json` JSON 列，写入 `metadata["description"]` 亦可，前端读取时从 `doc.metadata.description` 取值。

---

## 4. 鉴权辅助函数设计

以上接口均需支持 `?token=` 降级鉴权（`<a href="/download?token=...">` 场景），建议实现一个通用的鉴权依赖：

```python
# app/api/deps.py（新增）
from fastapi import Header, Query, HTTPException, Depends
from typing import Optional

async def get_current_user_or_token(
    authorization: Optional[str] = Header(default=None),
    token: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
) -> User:
    """
    同时支持：
    1. Authorization: Bearer <token>（标准方式）
    2. ?token=<token>（<img>/<a> 降级方式）
    """
    raw = None
    if authorization and authorization.startswith("Bearer "):
        raw = authorization[7:]
    elif token:
        raw = token

    if not raw:
        raise HTTPException(status_code=401, detail="Not authenticated")

    # 复用现有的 token -> user 解析逻辑
    return await _resolve_token_to_user(raw, db)
```

> **说明**：现有 `/keyframes/{filename}` 接口已有 `?token=` 实现，可以复用相同逻辑，封装成上面这个通用依赖。

---

## 5. 前端对接说明

### 5.1 在 `videoKnowledgeApi.ts` 中新增辅助函数

```typescript
// src/utils/videoKnowledgeApi.ts
import { API_BASE_URL } from './api';

/** 构建下载 URL（附加 ?token=，触发浏览器下载） */
export function getDocumentDownloadUrl(docId: string): string {
  const token = localStorage.getItem('access_token') ?? '';
  const origin = API_BASE_URL.replace(/\/api\/v\d+.*$/, '');
  const query  = token ? `?token=${encodeURIComponent(token)}` : '';
  return `${origin}/api/v1/knowledge-base/documents/${docId}/download${query}`;
}

/** 构建预览 URL（PDF/图片内联，其他跳转下载） */
export function getDocumentPreviewUrl(docId: string): string {
  const token = localStorage.getItem('access_token') ?? '';
  const origin = API_BASE_URL.replace(/\/api\/v\d+.*$/, '');
  const query  = token ? `?token=${encodeURIComponent(token)}` : '';
  return `${origin}/api/v1/knowledge-base/documents/${docId}/preview${query}`;
}

/** 更新文档描述 */
export async function patchDocumentDescription(
  docId: string,
  description: string,
): Promise<{ document_id: string; description: string }> {
  const res = await apiClient.patch(
    `/knowledge-base/documents/${docId}`,
    { description }
  );
  return (res.data as any)?.data ?? res.data;
}
```

### 5.2 下载 / 预览按钮示例

```tsx
import { getDocumentDownloadUrl, getDocumentPreviewUrl } from '../utils/videoKnowledgeApi';
import { Download, Eye } from 'lucide-react';

// ✅ 下载按钮（使用 <a href download> 无需 JS fetch）
<a
  href={getDocumentDownloadUrl(doc.document_id)}
  download={doc.filename}
  onClick={e => e.stopPropagation()}
  className={styles.actionBtn}
>
  <Download size={13} /> 下载
</a>

// ✅ 在新标签页预览（PDF / 图片内联，其他跳转下载）
<a
  href={getDocumentPreviewUrl(doc.document_id)}
  target="_blank"
  rel="noopener noreferrer"
  onClick={e => e.stopPropagation()}
  className={styles.actionBtn}
>
  <Eye size={13} /> 预览
</a>

// ✅ PDF 内嵌预览（在预览面板中用 <iframe>）
{ext === 'pdf' && (
  <iframe
    src={getDocumentPreviewUrl(doc.document_id)}
    title={doc.filename}
    style={{ width: '100%', height: 480, border: 'none', borderRadius: 8 }}
  />
)}
```

---

## 6. 接口汇总（含新增）

| Method | Path | 已实现 | 说明 |
|--------|------|:------:|------|
| `POST`   | `/knowledge-base/documents` | ✅ | 上传文档/视频 |
| `GET`    | `/knowledge-base/documents` | ✅ | 获取文档列表 |
| `GET`    | `/knowledge-base/documents/{doc_id}` | ✅ | 获取单个文档详情 |
| `PUT`    | `/knowledge-base/documents/{doc_id}` | ✅ | 替换文档 metadata |
| `PATCH`  | `/knowledge-base/documents/{doc_id}` | ❌ **新增** | 更新文档描述（description）|
| `DELETE` | `/knowledge-base/documents/{doc_id}` | ✅ | 删除文档 |
| `POST`   | `/knowledge-base/documents/{doc_id}/retry` | ✅ | 重试失败文档 |
| `GET`    | `/knowledge-base/documents/{doc_id}/download` | ❌ **新增** | 下载原始文件 |
| `GET`    | `/knowledge-base/documents/{doc_id}/preview`  | ❌ **新增** | 在线预览文件 |
| `GET`    | `/knowledge-base/documents/{doc_id}/keyframes/{filename}` | ✅ | 获取视频关键帧图片 |

---

## 7. 安全性注意事项

1. **路径穿越防护**：`doc.file_path` 存入 DB 时应校验路径在 `UPLOAD_DIR` 内，防止恶意 `../../../../etc/passwd` 攻击。建议使用 `os.path.realpath()` 做规范化后比较：
   ```python
   assert os.path.realpath(doc.file_path).startswith(os.path.realpath(UPLOAD_DIR))
   ```
2. **用户隔离**：所有读取接口必须同时过滤 `Document.user_id == current_user.id`，防止越权访问他人文件。
3. **Token 有效期**：`?token=` 方式与 `Authorization` Header 共享同一套 JWT 验证逻辑，过期策略相同，无额外安全风险。
4. **大文件流**：视频文件建议启用 `Accept-Ranges` 支持，让浏览器可以分段请求（进度条 / 跳转时间轴）。
5. **Content-Type 严格性**：`preview` 接口对 PDF 返回 `application/pdf`，避免浏览器当成下载；对 Office 格式返回 302 重定向而非直接返回字节，防止出现乱码。
6. **文件不存在兜底**：若 `doc.file_path` 记录在 DB 但文件已被清理（如磁盘故障），应返回 `404` 而非 `500`，需在返回文件前加 `os.path.exists()` 判断。
