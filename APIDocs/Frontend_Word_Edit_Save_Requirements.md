# Word 讲义编辑模式持久化 — 前端对接需求

## 背景

后端已新增 `PUT /sessions/{session_id}/courseware/word` 接口，用于将前端编辑器中
修改的讲义 Markdown 直接持久化到数据库（不经过 AI）。

当前前端的"保存"按钮只调用了 `setWordDocLocally(wordDraft)`，仅更新 React 本地
状态，刷新后内容丢失。需要改为同时调用后端接口。

---

## 新增后端接口

### `PUT /sessions/{session_id}/courseware/word`

**请求体**
```json
{
  "word_markdown": "# 讲义标题\n\n正文内容..."
}
```

**响应体（200 OK）**
```json
{
  "word_markdown": "# 讲义标题\n\n正文内容..."
}
```

> 后端会自动将内容中的所有 `---` 分隔线替换为 `***`，响应里返回规范化后的内容。

**错误码**
| 状态码 | 说明 |
|--------|------|
| 404 | Session 不存在或不属于当前用户 |
| 404 | 课件记录不存在 |

---

## 需要修改的文件

### 1. `src/utils/api.ts` — 新增 API 函数

```typescript
/** 直接保存讲义内容（不经过 AI） */
export async function saveWordContent(
  sessionId: string,
  wordMarkdown: string
): Promise<{ word_markdown: string }> {
  const res = await fetch(`/api/v1/sessions/${sessionId}/courseware/word`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),   // 与其他 API 函数保持一致
    },
    body: JSON.stringify({ word_markdown: wordMarkdown }),
  });
  if (!res.ok) throw new Error(`saveWordContent failed: ${res.status}`);
  return res.json();
}
```

---

### 2. `src/hooks/useCourseware.ts` — 添加持久化保存函数

在 import 行引入新函数：
```diff
- import { iterateCoursewarePage, getCoursewarePreview, generateCourseware, saveManualSlideEdit, applySlideLayout } from '../utils/api';
+ import { iterateCoursewarePage, getCoursewarePreview, generateCourseware, saveManualSlideEdit, applySlideLayout, saveWordContent } from '../utils/api';
```

新增 `saveWordDoc` 函数（在 `setWordDocLocally` 之后）：
```typescript
/** 持久化保存讲义内容到后端，同时更新本地状态 */
const saveWordDoc = useCallback(async (content: string): Promise<void> => {
  if (sessionId === 'new') return;
  try {
    const res = await saveWordContent(sessionId, content);
    // 使用后端返回的规范化内容（--- 已替换为 ***）
    setWordDoc(res.word_markdown);
  } catch (err) {
    console.error('[useCourseware] saveWordDoc failed:', err);
    // 即使后端失败也保留本地状态，避免用户内容丢失
    setWordDoc(content);
  }
}, [sessionId]);
```

在 return 中导出：
```diff
- return { pages, wordDoc, updatingPages, iteratePage, fetchPreview, isGenerating, handleGenerate, previewStatus, clearPages, updatePageLocally, applyLayoutAndRefresh, setWordDocLocally };
+ return { pages, wordDoc, updatingPages, iteratePage, fetchPreview, isGenerating, handleGenerate, previewStatus, clearPages, updatePageLocally, applyLayoutAndRefresh, setWordDocLocally, saveWordDoc };
```

---

### 3. `src/pages/Workspace.tsx` — 连接保存按钮

从 `useCourseware` 解构 `saveWordDoc`：
```diff
- const { pages, wordDoc, ... setWordDocLocally } = useCourseware(sessionId);
+ const { pages, wordDoc, ... setWordDocLocally, saveWordDoc } = useCourseware(sessionId);
```

修改保存按钮（约第 836 行）：
```diff
- onClick={() => {
-   setWordDocLocally(wordDraft);
-   setWordEditMode(false);
- }}
+ onClick={async () => {
+   setWordEditMode(false);        // 立即退出编辑模式（乐观式）
+   await saveWordDoc(wordDraft);  // 后台持久化
+ }}
```

> **注意**：先退出编辑模式再调用后端，避免用户感知到保存延迟。
> 如果需要 loading 状态，可以配合 `useState<boolean>` 控制按钮 disabled。

---

## 预览模式内联编辑（可选增强）

如果产品希望在"预览模式"下也可以直接点击段落进行编辑，可以在 `markdownWrapper`
上方添加一个"点击段落进入编辑"的交互。但这属于富文本编辑器范畴，实现复杂度较高，
不在本需求内。

**当前需求仅要求**：在已有的"编辑模式 textarea"保存时，内容能正确持久化到后端。

---

## 验证方法

1. 生成讲义后，切换到"讲义 (Word)"Tab
2. 点击「✏️ 编辑」进入编辑模式，修改一段内容
3. 点击「✓ 保存」
4. 刷新页面，确认修改内容仍然存在
5. 导出 Word，确认导出内容与修改后一致
