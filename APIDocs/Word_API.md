# Word 讲义功能 — 前端对接 API 文档

## 概述

| 功能 | 方法 | 路径 |
|---|---|---|
| 修改讲义内容（AI 重写） | `POST` | `/api/v1/sessions/{session_id}/courseware/iterate-word` |
| 导出讲义为 .docx 文件 | `GET` | `/api/v1/sessions/{session_id}/courseware/export-word` |

---

## 1. 修改讲义 — `iterate-word`

### 请求

```
POST /api/v1/sessions/{session_id}/courseware/iterate-word
Authorization: Bearer <access_token>
Content-Type: application/json
```

**Body：**

```json
{
  "instruction": "在第三节末尾添加三道课后练习题",
  "selected_text": "（可选）用户在预览区划选的文字片段，作为修改定位参考"
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `instruction` | string | ✅ | 修改指令（自然语言，如"添加互动环节"） |
| `selected_text` | string | 否 | 当前选中文字（限前 500 字），传入后 AI 会聚焦该区域 |

### 响应（HTTP 200）

```json
{
  "word_markdown": "# 第一章 ...\n\n## 教学目标\n..."
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `word_markdown` | string | 修改后的完整 Markdown 讲义（直接替换前端 wordDoc 状态） |

### 错误响应

| HTTP 状态 | `detail` 示例 | 原因 |
|---|---|---|
| `400` | `"讲义内容为空，请先生成课件"` | 当前 session 无讲义 |
| `404` | `"Courseware not found"` | session_id 不存在 |
| `500` | `"讲义修订失败：..."` | LLM 调用失败 |

### 注意事项

- 超时建议设为 **240 秒**（讲义内容较长时 LLM 耗时较久）
- 返回内容已去掉 Markdown 围栏（无 ` ```markdown ` 前缀）
- 修改结果已写入数据库，`GET /preview` 返回的 `word_markdown` 也同步更新

---

## 2. 导出讲义 — `export-word`

### 请求

```
GET /api/v1/sessions/{session_id}/courseware/export-word
Authorization: Bearer <access_token>
```

无请求体。

### 响应

直接返回 `.docx` 文件流：

```
HTTP 200 OK
Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document
Content-Disposition: attachment; filename="EduAgent_讲义_xxxxxxxx.docx"
```

**前端触发下载（必须用 fetch + blob）：**

```typescript
const handleExportWord = async () => {
  const token = localStorage.getItem('access_token') ?? '';
  const res = await fetch(
    `${API_BASE_URL}/sessions/${sessionId}/courseware/export-word`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`导出失败 (${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `EduAgent讲义_${sessionId.slice(0, 8)}.docx`;
  a.click();
  URL.revokeObjectURL(url);
};
```

> ⚠️ 不能用 axios 默认模式：会把响应当 JSON 解析。
> 如用 axios 须加 `{ responseType: 'blob' }`

### 错误响应

| HTTP 状态 | `detail` 示例 | 原因 |
|---|---|---|
| `404` | `"讲义内容为空，请先生成课件"` | 讲义未生成 |
| `404` | `"Courseware not found"` | session_id 不存在 |
| `500` | `".docx 生成失败：..."` | python-docx 转换失败 |

---

## 3. 前端集成建议

### 推荐状态字段

```typescript
const [wordDoc, setWordDoc] = useState('');                    // 当前讲义 Markdown
const [wordInstruction, setWordInstruction] = useState('');    // 修改指令输入框
const [isIteratingWord, setIsIteratingWord] = useState(false); // 修改加载中
const [isExportingWord, setIsExportingWord] = useState(false); // 导出加载中
```

### 讲义修改调用

```typescript
const iterateWord = async (instruction: string, selectedText?: string) => {
  setIsIteratingWord(true);
  try {
    const res = await apiClient.post(
      `/sessions/${sessionId}/courseware/iterate-word`,
      { instruction, selected_text: selectedText },
      { timeout: 240000 }
    );
    const { word_markdown } = res.data?.data ?? res.data;
    setWordDoc(word_markdown);   // 直接替换整个 wordDoc
  } catch (e: any) {
    alert('修改失败：' + (e?.response?.data?.detail || e?.message));
  } finally {
    setIsIteratingWord(false);
  }
};
```

### 划词定向修改交互建议

1. 用户在讲义预览区选中文字 → 弹出浮动按钮"✨ 针对此划词修改"
2. 点击后把 `selectedText` 预填入指令框（如"针对选中内容：...，修改意见："）
3. 用户输入指令后提交 → 调用 `iterate-word` 传 `instruction` + `selected_text`
4. 返回新 Markdown 后 `setWordDoc(word_markdown)`

### UI 状态建议

| 状态 | 建议 |
|---|---|
| `isIteratingWord = true` | 讲义区覆盖 Loading 遮罩，输入栏禁用 |
| 成功 | 刷新 Markdown 内容（ReactMarkdown 重渲染） |
| 失败 | Toast 提示 `detail` 字段 |

---

## 4. 数据流

```
用户输入修改指令
        │
        ▼
POST /iterate-word {instruction, selected_text?}
        │  AI 读取当前 word_markdown → LLM 重写 → 存 DB
        ▼
返回 {word_markdown: "..."}
        │
        ▼
前端 setWordDoc(...)  →  ReactMarkdown 重渲染


用户点击「导出讲义 .docx」
        │
        ▼
GET /export-word
        │  读 DB word_markdown → python-docx → FileResponse
        ▼
fetch → blob → a.download  →  本地 .docx 保存
```
