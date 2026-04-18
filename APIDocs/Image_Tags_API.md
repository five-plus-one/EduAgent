# 图片素材库 — 用户描述 & 标签管理 API 文档

> 前缀：`/api/v1/users/me/images`  
> 鉴权：所有接口需 `Authorization: Bearer <access_token>`

---

## 功能一：上传时填写描述

上传接口已支持 `label` 字段，作为用户对图片的自由描述。该描述会在 AI Vision 标注时作为提示提升标注准确度。

### 上传图片（已有接口，含描述字段）

```
POST /api/v1/users/me/images
Content-Type: multipart/form-data
```

| Form 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `file` | File | ✅ | 图片文件（jpg/png/webp/gif，≤10MB） |
| `label` | string | 否 | 用户描述（中文/英文均可，建议 30 字以内，AI 标注时会参考） |

**示例请求（FormData）：**
```
file: [图片文件]
label: 牛顿第二定律 F=ma 受力分析示意图
```

**响应（HTTP 201）：**
```json
{
  "image_id": "img_a3f8e2b1",
  "filename": "img_0003.jpg",
  "label": "牛顿第二定律 F=ma 受力分析示意图",
  "annotate_status": "pending",
  "preview_url": "/api/v1/users/me/images/img_a3f8e2b1/preview",
  "created_at": "2026-04-09T15:00:00Z"
}
```

> ℹ️ 标注为异步，上传后 `annotate_status = "pending"`，轮询列表接口直到变为 `"done"`。

---

### 上传后修改描述 [NEW]

```
PATCH /api/v1/users/me/images/{image_id}
Content-Type: application/json
```

**Body：**
```json
{
  "label": "修改后的描述文字"
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `label` | string \| null | 新描述；传 `null` 则清空 |

**响应（HTTP 200）：**
```json
{
  "image_id": "img_a3f8e2b1",
  "filename": "img_0003.jpg",
  "label": "修改后的描述文字",
  "description": "AI自动生成的视觉描述...",
  "tags": ["标签A", "标签B"],
  "annotate_status": "done",
  "preview_url": "/api/v1/users/me/images/img_a3f8e2b1/preview"
}
```

> ℹ️ 若图片已完成标注（`annotate_status = "done"`），后台会自动将新描述融入向量索引，提升该图片的搜索匹配度。

**错误响应：**
| 状态 | 原因 |
|---|---|
| `404` | 图片不存在或不属于当前用户 |

---

## 功能二：标注完成后管理标签

图片标注完成后，AI 会自动生成 3~5 个中文检索标签存入 `tags` 字段。用户可在此基础上**自由增删标签**。

### 获取当前标签（通过列表接口）

```
GET /api/v1/users/me/images?page=1&size=20
```

每条图片记录中包含：
```json
{
  "image_id": "img_a3f8e2b1",
  "tags": ["力学", "受力分析", "牛顿定律", "物理", "示意图"],
  "description": "三维坐标系中力F与力矩M的几何关系示意图",
  "annotate_status": "done"
}
```

---

### 更新标签列表 [NEW]

```
PUT /api/v1/users/me/images/{image_id}/tags
Content-Type: application/json
```

**Body：**
```json
{
  "tags": ["力学", "受力分析", "牛顿定律", "期中考题"]
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `tags` | string[] | ✅ | 完整目标标签列表（**整体覆盖**，后端自动去重去空） |

**响应（HTTP 200）：**
```json
{
  "image_id": "img_a3f8e2b1",
  "filename": "img_0003.jpg",
  "label": "牛顿第二定律 F=ma 受力分析示意图",
  "description": "AI自动生成的视觉描述...",
  "tags": ["力学", "受力分析", "牛顿定律", "期中考题"],
  "annotate_status": "done",
  "preview_url": "/api/v1/users/me/images/img_a3f8e2b1/preview"
}
```

> ⚠️ **整体覆盖语义**：前端需维护完整标签列表后一次性提交，而不是逐个操作。
> - **添加标签**：把新标签 push 到本地列表 → 提交完整列表
> - **删除标签**：从本地列表 filter 掉 → 提交完整列表

> ℹ️ 标签更新后，系统在后台自动重建向量索引，新标签将参与后续的 AI 图片检索匹配。

**错误响应：**
| 状态 | 原因 |
|---|---|
| `404` | 图片不存在或不属于当前用户 |

---

## 前端集成示例（TypeScript）

```typescript
// 上传时带描述
const uploadWithLabel = async (file: File, label: string) => {
  const form = new FormData();
  form.append('file', file);
  if (label) form.append('label', label);
  const res = await apiClient.post('/users/me/images', form, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
  return res.data?.data ?? res.data;
};

// 修改描述（上传后）
const updateLabel = async (imageId: string, label: string | null) => {
  const res = await apiClient.patch(`/users/me/images/${imageId}`, { label });
  return res.data?.data ?? res.data;
};

// 添加标签
const addTag = async (imageId: string, currentTags: string[], newTag: string) => {
  if (currentTags.includes(newTag)) return;
  const res = await apiClient.put(`/users/me/images/${imageId}/tags`, {
    tags: [...currentTags, newTag]
  });
  return res.data?.data ?? res.data;
};

// 删除标签
const removeTag = async (imageId: string, currentTags: string[], tagToRemove: string) => {
  const res = await apiClient.put(`/users/me/images/${imageId}/tags`, {
    tags: currentTags.filter(t => t !== tagToRemove)
  });
  return res.data?.data ?? res.data;
};
```

---

## 接口总览

| 方法 | 路径 | 功能 |
|---|---|---|
| `POST` | `/users/me/images` | 上传图片（含 `label` 描述字段） |
| `GET` | `/users/me/images` | 列出图片（含 `tags`、`description`） |
| `PATCH` | `/users/me/images/{image_id}` | **[NEW]** 更新用户描述 `label` |
| `PUT` | `/users/me/images/{image_id}/tags` | **[NEW]** 整体替换标签列表 |
| `DELETE` | `/users/me/images/{image_id}` | 删除图片 |
| `POST` | `/users/me/images/{image_id}/annotate` | 重试 AI 标注 |
| `GET` | `/users/me/images/{image_id}/preview` | 图片预览（无需鉴权） |
