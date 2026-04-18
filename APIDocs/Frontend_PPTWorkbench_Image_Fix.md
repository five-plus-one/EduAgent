# PPTPageWorkbench 图片替换入口修复 — 前端需求

## 问题描述

在 `PPTPageWorkbench.tsx` 的「编辑内容」Tab 中，每个 `type: 'image'` 元素显示了
一个按钮"切换到「替换图片」Tab 直接换图"（line 484-490）。用户点击后：

- ✅ 切换到了「替换图片」Tab
- ❌ 但 `activeImageElement` 仍为 `null`（从父组件传入，不可变）
- ❌ 导致「应用选中图片」按钮因 `{selectedImageId && activeImageElement && ...}` 而永远隐藏

**结果**：用户在「编辑内容」Tab 添加了图片元素并保存后，无法在『替换图片』Tab
为其指定实际图片。导出的 PPT 只显示占位灰框。

---

## 修改方案

### 方案：在 Workbench 内部维护 `activeImageElement`

在 `PPTPageWorkbench` 内部新增 `localActiveImageElement` 状态，优先使用它，
其初始值来自 `props.activeImageElement`（从预览点击传入）。

当用户在编辑 Tab 点击某个图片元素的"去替换图片"按钮时，将该元素设置为
`localActiveImageElement`。

---

## 需要修改的代码

### `PPTPageWorkbench.tsx`

#### 1. 新增 `localActiveImageElement` 局部状态

在现有的 `const [applyingLayout, setApplyingLayout] = useState(false);`（约 line 169）后添加：

```diff
  const [applyingLayout, setApplyingLayout] = useState(false);
+ /** 图片替换目标元素：来自 props 传入 或 编辑Tab 内点击切换 */
+ const [localActiveImage, setLocalActiveImage] = useState<ImageElement | null>(
+   activeImageElement ?? null
+ );
```

#### 2. 在 `useEffect` 重置时同步 `localActiveImage`

现有 useEffect（约 line 172-190）的重置逻辑改为：

```diff
  useEffect(() => {
    if (!open) return;
    setActiveTab(defaultTab);
    setTitle(page.title ?? '');
    setSpeakerNotes(page.speaker_notes ?? '');
    setElements(page.elements?.map(toEditable) ?? []);
    setIsDirty(false);
    setAiInstruction('');
-   if (activeImageElement) {
-     setSearchQuery(activeImageElement.alt || activeImageElement.query || '');
-     setSelectedImageId(activeImageElement.resolved?.image_id ?? null);
-   }
+   // 来自 props 的图片元素（预览区点击触发）
+   const initImg = activeImageElement ?? null;
+   setLocalActiveImage(initImg);
+   if (initImg) {
+     setSearchQuery(initImg.alt || initImg.query || '');
+     setSelectedImageId(initImg.resolved?.image_id ?? null);
+   } else {
+     setSearchQuery('');
+     setSelectedImageId(null);
+   }
    setSearchResults([]);
    setAllImages([]);
    setAllPage(1);
    setAllTotal(0);
    allLoadedOnce.current = false;
  }, [page.page_index, open, defaultTab]);
```

#### 3. 图片元素编辑区：点击"去替换图片"时设置 `localActiveImage`

现有代码（约 line 484-490）：

```diff
- <button
-   className={styles.goToImageTabBtn}
-   onClick={() => setActiveTab('image')}
- >
-   <ImageIcon size={12} /> 切换到「替换图片」Tab 直接换图
- </button>
+ <button
+   className={styles.goToImageTabBtn}
+   onClick={() => {
+     // 将此图片元素设为替换目标，然后切换 Tab
+     const imgElem: ImageElement = {
+       element_id: el.element_id,
+       type: 'image',
+       position: el.position,
+       alt: el.alt,
+       query: el.query,
+       resolved: (el._raw as any).resolved,
+     };
+     setLocalActiveImage(imgElem);
+     setSearchQuery(el.alt || el.query || '');
+     setSelectedImageId((el._raw as any).resolved?.image_id ?? null);
+     setActiveTab('image');
+   }}
+ >
+   <ImageIcon size={12} /> 切换到「替换图片」Tab 直接换图
+ </button>
```

#### 4. 将 `activeImageElement` 替换为 `localActiveImage`

文件中所有使用 `activeImageElement` 的地方（image Tab 内），改为使用 `localActiveImage`：

| 原代码 | 改为 |
|--------|------|
| `{activeImageElement && (` (line 554) | `{localActiveImage && (` |
| `activeImageElement.alt` | `localActiveImage.alt` |
| `activeImageElement.query` | `localActiveImage.query` |
| `activeImageElement.resolved` | `localActiveImage.resolved` |
| `currentPreviewUrl = activeImageElement?.resolved...` (line 330-332) | 改为 `localActiveImage` |
| `{selectedImageId && activeImageElement && (` (line 642) | `{selectedImageId && localActiveImage && (` |
| `onReplaceImage(activeImageElement.element_id, ...)` (line 305-309) | `onReplaceImage(localActiveImage.element_id, ...)` |
| `!activeImageElement && (` (line 568) | `!localActiveImage && (` |
| `{activeImageElement && (` fitRow (line 576) | `{localActiveImage && (` |
| `activeImageElement && onChangeFit(...)` (line 584) | `localActiveImage && onChangeFit(...)` |

#### 5. `handleApplyImage` 中改为使用 `localActiveImage`

```diff
  const handleApplyImage = () => {
    const displayedResults = imageMode === 'search' ? searchResults : allImages;
    const selected = displayedResults.find(r => r.image_id === selectedImageId);
-   if (!selected || !activeImageElement) return;
+   if (!selected || !localActiveImage) return;
    onReplaceImage(
-     activeImageElement.element_id,
+     localActiveImage.element_id,
      selected.image_id,
      resolveImagePreviewUrl(selected.preview_url),
      selected.label || searchQuery || '图片',
    );
    onClose();
  };
```

#### 6. 其它 activeImageElement 引用（`currentFit` 相关）

`PPTCard.tsx` 里的 `currentFit` 计算基于 `activeImageElement.element_id`，这个不需要改，
因为 `onChangeFit` 的 callback 已经通过 `localActiveImage.element_id` 传入了正确的 id。

---

## 验证方法

1. 生成 PPT，找一页没有图片的幻灯片（如 minimal_list）
2. 点击铅笔按钮 → 「编辑内容」Tab
3. 点击「添加元素」→ 选「图片占位」
4. 在出现的图片元素里，点击"切换到「替换图片」Tab 直接换图"
5. 确认「替换图片」Tab 中**没有**出现"请在预览卡片中点击图片区域…"的提示
6. 在搜索框输入关键词，选中一张图片
7. 确认「应用选中图片」按钮**出现**并可点击
8. 保存 → 导出 PPT → 确认图片出现在导出文件中
