# 前端需求：图片替换后导出 PPT 仍显示占位框的修复

## 根本原因分析

### 已在后端修复（立即生效）

`save_manual_slide_edit`（`PUT /sessions/{id}/courseware/slides/{page}`）之前只在
`"resolved" not in elem` 时才回填 DB 的 resolved 值。但 `fromEditable()` 会把 `e._raw`
里的旧 `resolved` 带进请求体，触发 `"resolved" in elem` = True，导致旧 image_id 覆盖了
PATCH 端点写进 DB 的新 image_id。

**后端已改为：image 元素的 resolved 始终从 DB 取，忽略前端发来的值。**  
（只有 `PATCH /elements/{id}/image` 可以合法更新 resolved）

---

## 前端仍需修复

### 问题 1：`pages` 状态未同步导致 `_raw.resolved` 陈旧

`handleReplaceImage` 只更新了 `imageOverrides`（PPTCard 本地状态），但没有更新
`useCourseware` 中的 `pages` 状态。下轮 workbench 打开时，`toEditable(el)` 拿到的
`e._raw.resolved` 依然是旧值。

**修复位置：`PPTCard.tsx` 的 `handleReplaceImage`**

```diff
  const handleReplaceImage = (elementId: string, imageId: string, newUrl: string, newAlt: string) => {
    // 1. 乐观更新本地状态，预览立即生效
    setImageOverrides(prev => ({ ...prev, [elementId]: { url: newUrl, alt: newAlt } }));
-   // 2. 调用后端 PATCH 接口将替换写入 DB（导出 PPT 时使用新图片）
-   replaceSlideImage(sessionId, page.page_index, elementId, imageId).catch(err => {
-     console.error('[PPTCard] replaceSlideImage failed:', err);
-   });
+   // 2. 调用后端 PATCH，成功后同步更新 pages 状态，确保 _raw.resolved 指向新图片
+   replaceSlideImage(sessionId, page.page_index, elementId, imageId).then(() => {
+     onImageResolved?.(elementId, imageId, `/api/v1/users/me/images/${imageId}/preview`);
+   }).catch(err => {
+     console.error('[PPTCard] replaceSlideImage failed:', err);
+   });
  };
```

**修复位置：`PPTCard` Props 接口，新增 `onImageResolved` 回调**

```diff
  interface Props {
    // ...existing
+   /** PATCH 成功后同步更新 pages 状态（由 Workspace 注入） */
+   onImageResolved?: (elementId: string, imageId: string, previewUrl: string) => void;
  }
```

**修复位置：`Workspace.tsx`（或 `useCourseware.ts`），提供 `onImageResolved` 实现**

```tsx
// 在 useCourseware 或 Workspace 中：
const handleImageResolved = useCallback(
  (pageIndex: number, elementId: string, imageId: string, previewUrl: string) => {
    // 同步更新 pages 里的 resolved，使 _raw 保持最新
    setPages(prev =>
      prev.map(p => {
        if (p.page_index !== pageIndex) return p;
        return {
          ...p,
          elements: p.elements?.map(el =>
            el.element_id === elementId
              ? { ...el, resolved: { image_id: imageId, preview_url: previewUrl, source: 'user' } }
              : el
          ),
        };
      })
    );
  },
  []
);
```

传给 PPTCard：
```tsx
onImageResolved={(elementId, imageId, previewUrl) =>
  handleImageResolved(page.page_index, elementId, imageId, previewUrl)
}
```

---

### 问题 2：竞态条件 — 用户在 PATCH 响应前点击导出

`handleReplaceImage` 是 fire-and-forget（不 await），如果用户立刻点击导出，后端导出
背景任务可能先于 PATCH commit 读取 DB，导致读到旧数据。

**修复位置：`PPTCard.tsx` — 添加"正在保存"状态，短暂禁用导出按钮**

```diff
+ const [isSavingImage, setIsSavingImage] = useState(false);

  const handleReplaceImage = (...) => {
    setImageOverrides(...)
+   setIsSavingImage(true);
    replaceSlideImage(...).then(() => {
      onImageResolved?.(...)
    }).catch(err => {
      console.error(...)
+   }).finally(() => {
+     setIsSavingImage(false);
    });
  };
```

将 `isSavingImage` 传给 Workspace 的导出按钮，短暂置灰即可：
```tsx
// Workspace.tsx 的导出按钮
disabled={isExporting || pages.some(p => p.__saving)}
```
（或通过全局 context 传递 `isSavingImage`，具体方案由前端决定）

---

## 优先级

| 修复 | 类型 | 优先级 |
|------|------|--------|
| 后端：`save_manual_slide_edit` 始终用 DB resolved | ✅ 已完成 | P0 |
| 前端：`pages` 状态同步（`onImageResolved`） | 前端待做 | P1 |
| 前端：竞态条件防护（`isSavingImage`） | 前端待做 | P2 |

> P1 修复后，workbench 的 `_raw` 将始终最新，save_manual_slide_edit 也会发正确的数据，
> 即使后端回退也不会出问题。
