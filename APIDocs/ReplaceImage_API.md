# PPT 图片替换接口文档

> 更新时间：2026-04-10  
> 功能：用户在 PPT 预览界面点击图片 → 从素材库选择替换图片 → 预览与导出均更新

---

## 接口：替换幻灯片图片元素

### `PATCH /api/v1/sessions/{session_id}/courseware/slides/{page_index}/elements/{element_id}/image`

#### 路径参数

| 参数 | 类型 | 说明 |
|---|---|---|
| `session_id` | string | 当前会话 ID |
| `page_index` | integer | 幻灯片页码（从 **1** 开始） |
| `element_id` | string | 图片元素的 `element_id`（来自 courseware/preview 响应） |

#### 请求头

```
Authorization: Bearer <token>
Content-Type: application/json
```

#### 请求体

```json
{
  "image_id": "img_a3f8e2b1"
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `image_id` | string | ✅ | 用户图片库中的图片 ID（来自 `GET /users/me/images` 或图片选择弹窗） |

#### 成功响应 `200 OK`

```json
{
  "element_id": "img_202",
  "page_index": 3,
  "image_id": "img_a3f8e2b1",
  "preview_url": "/api/v1/users/me/images/img_a3f8e2b1/preview"
}
```

#### 错误响应

| 状态码 | 原因 |
|---|---|
| 404 | session 不存在 / image 不在用户库中 / 找不到指定页或元素 |
| 400 | 目标元素不是 image 类型 |
| 401 | 未鉴权 |

---

## 前端实现流程

```
用户点击 PPT 预览中的图片
        │
        ▼
前端从预览数据中提取 page_index + element_id
        │
        ▼
打开图片选择弹窗
  └── 调用 GET /api/v1/users/me/images?page=1&size=20
  └── 支持 keyword 搜索（如已实现）
        │  用户选中一张图片
        ▼
PATCH /api/v1/sessions/{session_id}/courseware/slides/{page_index}/elements/{element_id}/image
Body: { "image_id": "xxx" }
        │
        ├─ 成功 → 用响应中的 preview_url 立即替换预览中对应图片的 src
        │         （无需重新请求 /preview 接口，直接局部更新）
        └─ 失败 → 提示用户错误信息
```

---

## 获取 page_index 和 element_id 的来源

来自 `GET /api/v1/sessions/{session_id}/courseware/preview` 的响应结构：

```json
{
  "ppt_data": [
    {
      "page_index": 3,
      "layout_type": "two_column",
      "title": "刚体基本概念",
      "elements": [
        {
          "element_id": "img_202",
          "type": "image",
          "position": "right_top",
          "query": "刚体结构示意图",
          "alt": "刚体结构配图",
          "resolved": {
            "image_id": "img_a3f8e2b1",
            "preview_url": "/api/v1/users/me/images/img_a3f8e2b1/preview",
            "source": "library"
          }
        }
      ]
    }
  ]
}
```

前端渲染时：
- `page_index` = `slide.page_index`
- `element_id` = `element.element_id`
- 当前图片 src = `element.resolved.preview_url`（需带 `Authorization: Bearer <token>` 请求头，或用 `?token=<token>` query 参数）

---

## 权限说明

- `image_id` 必须属于当前登录用户的图片库，否则返回 404（防止跨用户引用）
- 替换操作**持久化**到数据库，再次获取 preview 或导出时均使用新图片

---

## 导出行为

| 导出类型 | 行为 |
|---|---|
| **PPT (PPTX)** | `ppt_exporter` 根据 `resolved.image_id` 读取本地图片文件并插入幻灯片 ✅ |
| **Word (DOCX)** | 讲义为纯文本 Markdown，不含图片，不受此接口影响 |

---

## 完整调用示例（TypeScript）

```typescript
// 替换第 3 页 element_id 为 "img_202" 的图片
async function replaceSlideImage(
  sessionId: string,
  pageIndex: number,
  elementId: string,
  newImageId: string,
  token: string
) {
  const res = await fetch(
    `/api/v1/sessions/${sessionId}/courseware/slides/${pageIndex}/elements/${elementId}/image`,
    {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ image_id: newImageId }),
    }
  );

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.detail || 'Replace image failed');
  }

  const data = await res.json();
  // data.preview_url → 立即更新前端预览中对应图片的 src
  return data;
}
```
