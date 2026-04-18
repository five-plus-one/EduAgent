# 前端需求：支持 .pptx 文件上传

## 背景

后端 `document_parser.py` 已经完整支持 `.pptx` 解析（`parse_pptx` 函数），  
知识库上传接口 (`POST /knowledge-base/documents`) 也无类型限制。  
**唯一的拦截在前端**，需要修改两个位置。

---

## 需要修改的文件：`src/pages/Workspace.tsx`

### 修改 1：会话侧栏 KB 拖拽上传过滤（约 line 191-194）

```diff
- const valid = Array.from(files).filter(f =>
-   ['.pdf', '.docx', '.doc', '.txt', '.md'].some(ext => f.name.toLowerCase().endsWith(ext))
- );
- if (!valid.length) { alert('仅支持 PDF / DOCX / TXT / MD 格式文件'); return; }
+ const valid = Array.from(files).filter(f =>
+   ['.pdf', '.docx', '.doc', '.txt', '.md', '.pptx'].some(ext => f.name.toLowerCase().endsWith(ext))
+ );
+ if (!valid.length) { alert('仅支持 PDF / DOCX / PPTX / TXT / MD 格式文件'); return; }
```

### 修改 2：会话侧栏 KB file input accept 属性（约 line 609）

```diff
- accept=".pdf,.docx,.doc,.txt,.md"
+ accept=".pdf,.docx,.doc,.txt,.md,.pptx"
```

---

## 说明

| 上传入口 | 需改？ | 原因 |
|---------|--------|------|
| `KnowledgeBase.tsx` 的全局知识库页 | **不需要** | file input 已没有 `accept` 限制（line 110），拖拽时直接调 `uploadKnowledgeDoc` 无过滤 |
| `Workspace.tsx` 的会话侧栏 KB 上传 | **需要** | 有 `accept` + 显式过滤，会把 `.pptx` 拦截在前端 |

---

## 额外说明：关于 PDF "不可关联"

"不可关联" = 该文档在后端处理时 **status = "failed"**。  
常见失败原因（后端日志中可看到 `doc.summary` 字段的错误信息）：

| 原因 | 错误示例 | 解决方案 |
|------|----------|----------|
| PDF 加密/有密码 | `PDF 文件已加密（有密码保护）` | 用 Adobe 或 Chrome 打印为新 PDF 后重传 |
| 扫描版图片 PDF | `PDF 不包含可提取的文字` | 需 OCR 工具处理，或上传带文字层的版本 |
| 文件损坏 | `无法读取 PDF 文件（文件可能已损坏）` | 重新导出 PDF |

**后端已新增重试接口**：`POST /api/v1/knowledge-base/documents/{doc_id}/retry`  
可在失败文档旁边加一个"重试"按钮，调用该接口（无需重新上传文件）。  
接口会将状态重置为 `pending` 并重新启动解析流程。

### 前端可在知识库文档列表中添加重试按钮（可选）

在 `KnowledgeBase.tsx` 中，失败状态旁边加一个"重试"按钮：

```diff
  } : doc.status === 'failed' ? (
-   <div className={clsx(styles.statusBadge, styles.statusFailed)}><Clock size={14} /> 解析失败</div>
+   <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
+     <div className={clsx(styles.statusBadge, styles.statusFailed)}><Clock size={14} /> 解析失败</div>
+     <button
+       className={styles.deleteBtn}
+       title={doc.summary || '点击重新解析'}
+       onClick={() => retryDoc(doc.document_id)}
+     >↺ 重试</button>
+   </div>
  ) : (
```

并在组件内添加 `retryDoc` 函数（参考 `handleDelete`）：

```ts
const retryDoc = async (documentId: string) => {
  try {
    await apiClient.post(`/knowledge-base/documents/${documentId}/retry`);
    await fetchDocs(true);
  } catch (e) {
    console.error('Retry failed', e);
    alert('重试失败，请检查原始文件是否存在');
  }
};
```

另外，可以在鼠标悬停在"解析失败"badge 时通过 `title={doc.summary}` 显示具体失败原因。
