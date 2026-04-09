# 用户图片素材库 API — 前端对接文档

> **版本**：v2（2026-04-08）  
> **变更说明**：原「会话图片库」（绑定 `session_id`）已重构为「用户图片库」（绑定登录用户），图片在所有对话中共享，无需重复上传。  
> **旧路由前缀**：`/api/v1/sessions/{session_id}/images`  
> **新路由前缀**：`/api/v1/users/me/images`

---

## 鉴权说明

所有接口均需在请求头中携带 JWT：

```
Authorization: Bearer <access_token>
```

**特例 — 图片预览**：`<img>` 标签无法设置 Header，改用 Query 参数传 token：

```html
<img src="/api/v1/users/me/images/{image_id}/preview?token=<access_token>" />
```

---

## 接口列表

| # | 方法 | 路径 | 说明 |
|---|------|------|------|
| 1 | POST | `/api/v1/users/me/images` | 上传图片 |
| 2 | GET | `/api/v1/users/me/images` | 获取图片列表 |
| 3 | GET | `/api/v1/users/me/images/{image_id}/preview` | 预览图片 |
| 4 | DELETE | `/api/v1/users/me/images/{image_id}` | 删除图片 |
| 5 | POST | `/api/v1/users/me/images/{image_id}/annotate` | 重新触发标注 |

---

## 1. 上传图片

**旧**：`POST /api/v1/sessions/{session_id}/images`  
**新**：`POST /api/v1/users/me/images`

### 请求

- Content-Type: `multipart/form-data`
- **不再需要** `session_id` 路径参数

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `file` | File | ✅ | 图片文件（JPEG/PNG/WebP/GIF，≤10 MB） |
| `label` | string | ❌ | 用户自填备注（帮助提升标注质量） |

### 响应 `201 Created`

```json
{
  "image_id": "img_a1b2c3d4",
  "filename": "fourier_transform.png",
  "file_size": 204800,
  "label": "傅里叶变换示意图",
  "annotate_status": "pending",
  "preview_url": "/api/v1/users/me/images/img_a1b2c3d4/preview",
  "created_at": "2026-04-08T04:30:00Z"
}
```

> 上传后，后台异步自动标注（约 2–5 秒）。前端可轮询列表接口查看 `annotate_status`。

### 前端示例（React）

```jsx
const upload = async (file, label) => {
  const form = new FormData();
  form.append('file', file);
  if (label) form.append('label', label);

  const res = await fetch('/api/v1/users/me/images', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  return res.json();
};
```

---

## 2. 获取图片列表

**旧**：`GET /api/v1/sessions/{session_id}/images`  
**新**：`GET /api/v1/users/me/images`

### Query 参数

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `page` | int | 1 | 页码 |
| `size` | int | 20 | 每页数量 |

### 响应 `200 OK`

```json
{
  "total": 42,
  "items": [
    {
      "image_id": "img_a1b2c3d4",
      "filename": "fourier_transform.png",
      "label": "傅里叶变换示意图",
      "preview_url": "/api/v1/users/me/images/img_a1b2c3d4/preview",
      "annotate_status": "done",
      "tags": ["傅里叶变换", "信号处理", "频域分析", "数学教学"],
      "description": "展示连续信号与其频域表示的傅里叶变换示意图",
      "created_at": "2026-04-08T04:30:00Z"
    }
  ]
}
```

### `annotate_status` 枚举值

| 值 | 含义 |
|----|------|
| `pending` | 等待标注 |
| `processing` | 标注中 |
| `done` | 标注完成（有 `description` 和 `tags`） |
| `failed` | 标注失败（极少发生，可手动重试） |

### 前端渲染图片建议

```jsx
// preview_url 需要手动拼接 token（<img> 不支持 Header）
const getPreviewUrl = (previewUrl) =>
  `${previewUrl}?token=${localStorage.getItem('access_token')}`;

<img src={getPreviewUrl(item.preview_url)} alt={item.filename} />;
```

---

## 3. 预览图片

**旧**：`GET /api/v1/sessions/{session_id}/images/{image_id}/preview`  
**新**：`GET /api/v1/users/me/images/{image_id}/preview`

### 鉴权（二选一）

| 方式 | 场景 | 示例 |
|------|------|------|
| Header | fetch/XHR | `Authorization: Bearer <token>` |
| Query | `<img src>` / 直链 | `?token=<token>` |

### 响应

直接返回图片二进制流，`Content-Type` 与原始文件一致（`image/jpeg` / `image/png` 等）。

---

## 4. 删除图片

**旧**：`DELETE /api/v1/sessions/{session_id}/images/{image_id}`  
**新**：`DELETE /api/v1/users/me/images/{image_id}`

### 响应 `204 No Content`

无响应体。

---

## 5. 重新触发标注

**旧**：`POST /api/v1/sessions/{session_id}/images/{image_id}/annotate`  
**新**：`POST /api/v1/users/me/images/{image_id}/annotate`

用于 `annotate_status === 'failed'` 时手动重试。

### 响应 `200 OK`

```json
{
  "image_id": "img_a1b2c3d4",
  "annotate_status": "processing"
}
```

---

## 前端需要修改的位置汇总

### ① 图片上传组件

```diff
- POST /api/v1/sessions/${sessionId}/images
+ POST /api/v1/users/me/images
  
- // 移除 sessionId 依赖（上传时不再需要）
```

### ② 图片列表组件

```diff
- GET /api/v1/sessions/${sessionId}/images
+ GET /api/v1/users/me/images

- <img src={item.preview_url} />
+ <img src={`${item.preview_url}?token=${token}`} />
```

### ③ 图片删除

```diff
- DELETE /api/v1/sessions/${sessionId}/images/${imageId}
+ DELETE /api/v1/users/me/images/${imageId}
```

### ④ 图片素材选项卡的挂载时机

原来图片库在打开某个 Session 时加载，现在应该在**登录后全局加载一次**，或在「图片素材」Tab 首次展开时懒加载。

```diff
- // 进入某个 session 时触发
- useEffect(() => { fetchImages(sessionId) }, [sessionId])

+ // 登录后或 Tab 首次打开时触发（与 sessionId 无关）
+ useEffect(() => { fetchImages() }, [])
```

### ⑤ 图片 URL 工具函数（推荐封装）

```ts
// utils/image.ts

export function getImagePreviewUrl(previewPath: string): string {
  const token = localStorage.getItem('access_token') ?? '';
  // previewPath 示例: "/api/v1/users/me/images/img_xxx/preview"
  return `${previewPath}?token=${encodeURIComponent(token)}`;
}
```

---

## 标注机制说明（供前端参考）

标注不再依赖多模态 Vision 模型，改为**文本推断式标注**：

- 后端根据**文件名** + **用户自填 label** 调用主文本模型推断图片内容
- 生成结构化的 `description`（30字以内描述）和 `tags`（5–8个检索标签）
- 标注结果用于 PPT 生成时的语义图片检索
- 有三级保障（LLM → JSON解析 → 本地 fallback），`annotate_status` 最终必为 `done`

> **建议**：在上传时引导用户填写 `label`，描述越准确，PPT 生成时图片匹配越精准。  
> 例如上传一张正弦波图，label 填「正弦波示意图」，比仅凭文件名 `img_001.png` 标注效果好得多。

---

## 不变的接口（无需修改）

- 管理员图片库接口（`/api/v1/admin/image-library/*`）**保持不变**
- PPT 生成接口（`/api/v1/sessions/{session_id}/generate/stream`）**保持不变**
  - 图片检索已在后端自动从用户个人库 + 管理员图库中搜索，前端无感知
