# 前端需求：PPT 表格元素（Table Element）渲染支持

> 文档版本：v1.0 | 2026-04-11  
> 负责人：前端开发  
> 后端状态：✅ 已完成（ppt_exporter、courseware_generator 均已支持）

---

## 背景

AI 生成的 PPT 中，部分页面会包含结构化表格（如属性对比、公式列表等）。  
后端已新增 `type: "table"` 元素类型，**前端目前无法渲染**，会显示为空白或报错。

---

## 新增元素类型：`table`

### 数据结构

后端输出的 `element` 对象格式（`type === "table"` 时）：

```typescript
interface TableElement {
  element_id: string;
  type: "table";
  position: "full" | "left" | "center"; // 一般为 "full"
  content: [];                            // 始终为空数组，忽略
  is_accent: false;

  // 表格专用字段
  headers: string[];          // 表头列名，例如 ["刚体形状", "转轴", "转动惯量"]
  rows: string[][];           // 数据行，例如 [["均质圆柱", "轴心", "$\\frac{1}{2}mR^2$"]]
}
```

### 完整示例

```json
{
  "element_id": "t1",
  "type": "table",
  "position": "full",
  "headers": ["刚体形状", "转轴", "转动惯量"],
  "rows": [
    ["均质薄圆环", "圆环中心，垂直环面", "$mR^2$"],
    ["均质圆柱",   "轴心，垂直底面",    "$\\frac{1}{2}mR^2$"],
    ["均质细杆",   "杆中间",            "$\\frac{1}{12}mL^2$"],
    ["均质球体",   "直径",              "$\\frac{2}{5}mR^2$"],
    ["均质薄球壳", "直径",              "$\\frac{2}{3}mR^2$"]
  ],
  "content": [],
  "is_accent": false
}
```

---

## 前端需要实现的内容

### 1. `renderElement` 中新增 `table` 分支

在 `PPTCard.tsx` 的 `renderElement` 函数中，在现有 `timeline_item` 分支之后、`return null` 之前，新增：

```tsx
if (el.type === 'table') {
  const headers: string[] = Array.isArray(el.headers) ? el.headers : [];
  const rows: string[][] = Array.isArray(el.rows) ? el.rows : [];

  if (headers.length === 0 && rows.length === 0) return null;

  return (
    <div key={el.element_id} className={clsx(styles.tableWrapper, positionClass)}>
      <table className={styles.tableElement}>
        {headers.length > 0 && (
          <thead>
            <tr>
              {headers.map((h, i) => (
                <th key={i}>
                  {/* 表头支持 LaTeX 公式渲染 */}
                  <ReactMarkdown
                    remarkPlugins={REMARK_PLUGINS}
                    rehypePlugins={REHYPE_PLUGINS}
                    components={{ p: React.Fragment as any }}
                  >
                    {preprocessMath(String(h))}
                  </ReactMarkdown>
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {(Array.isArray(row) ? row : []).map((cell, ci) => (
                <td key={ci}>
                  {/* 单元格支持 LaTeX 公式渲染 */}
                  <ReactMarkdown
                    remarkPlugins={REMARK_PLUGINS}
                    rehypePlugins={REHYPE_PLUGINS}
                    components={{ p: React.Fragment as any }}
                  >
                    {preprocessMath(String(cell))}
                  </ReactMarkdown>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

> `REMARK_PLUGINS`、`REHYPE_PLUGINS`、`preprocessMath`、`clsx`、`styles` 均为文件中已有的引用，直接使用即可。

---

### 2. `PPTCard.module.css` 新增表格样式

```css
/* ═══════════════════════════════════════════════════════════
   Table Element — 主题色表头 + 斑马纹 + LaTeX 支持
   ═══════════════════════════════════════════════════════════ */
.tableWrapper {
  width: 100%;
  overflow-x: auto;
  border-radius: 10px;
  border: 1px solid var(--ppt-glass-border, rgba(0, 0, 0, 0.08));
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.06);
  margin-bottom: calc(0.08 * var(--in));
}

.tableElement {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  font-size: calc(min(16, var(--dynamic-font, 16)) * var(--pt));
}

/* 表头 */
.tableElement thead tr {
  background: var(--ppt-accent, #3b82f6);
}

.tableElement thead th {
  padding: calc(0.10 * var(--in)) calc(0.14 * var(--in));
  color: #fff;
  font-weight: 700;
  text-align: center;
  font-size: calc(14 * var(--pt));
  letter-spacing: 0.02em;
  border-right: 1px solid rgba(255, 255, 255, 0.18);
  word-break: break-word;
}

.tableElement thead th:last-child { border-right: none; }
.tableElement thead th:first-child { text-align: left; }

/* 斑马纹 */
.tableElement tbody tr:nth-child(even) {
  background: var(--ppt-glass-bg, rgba(255, 255, 255, 0.35));
}
.tableElement tbody tr:nth-child(odd) { background: transparent; }
.tableElement tbody tr:hover { background: rgba(99, 102, 241, 0.06); }

/* 数据单元格 */
.tableElement tbody td {
  padding: calc(0.08 * var(--in)) calc(0.14 * var(--in));
  border-bottom: 1px solid var(--ppt-glass-border, rgba(0, 0, 0, 0.06));
  border-right: 1px solid var(--ppt-glass-border, rgba(0, 0, 0, 0.04));
  text-align: center;
  color: var(--ppt-text, #1e293b);
  font-size: calc(14 * var(--pt));
  line-height: 1.45;
  word-break: break-word;
  vertical-align: middle;
}

/* 首列：左对齐 + 加粗 */
.tableElement tbody td:first-child {
  text-align: left;
  font-weight: 600;
  color: var(--ppt-primary, #0f172a);
}

.tableElement tbody td:last-child  { border-right: none; }
.tableElement tbody tr:last-child td { border-bottom: none; }

/* KaTeX 在单元格内保持内联 */
.tableElement td .katex,
.tableElement th .katex { font-size: 1em; }

.tableElement td p,
.tableElement th p { margin: 0; }
```

---

## 验收标准

| 场景 | 期望结果 |
|---|---|
| 生成含转动惯量表的物理课 PPT | 预览中显示带主题色表头的真实表格，不再显示 `\| 列 \|` 原始文字 |
| 表格单元格含 LaTeX 公式（如 `$mR^2$`） | 公式正确渲染为数学符号（KaTeX），不显示原始 `$...$` |
| 表格行数 > 5 | 斑马纹zebra striping 正常交替显示 |
| 窗口缩小 / 小屏 | `tableWrapper` 横向滚动，不破坏卡片布局 |
| `headers` 或 `rows` 为空 | 不渲染，不报错（返回 null） |

---

## 注意事项

1. `headers` / `rows` 可能为 `undefined`（LLM 少数情况下遗漏），需做 `Array.isArray()` 防护。
2. `rows` 中的每行长度可能短于 `headers` 长度，渲染时对多余的列格做空白处理。
3. 不要使用 Markdown 的 `| 列 |` 语法来判断是否是表格——直接判断 `el.type === 'table'`。
4. 该元素目前只出现在 `minimal_list` 布局，但代码逻辑不要与布局强绑定，`renderElement` 通用处理即可。
