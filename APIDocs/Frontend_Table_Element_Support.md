# 前端需求：PPT 工作台表格元素（type: "table"）完整支持

## 背景

后端 PPT 导出器 (`ppt_exporter.py`) 和预览组件 (`PPTCard.tsx`) 均已实现
`type: "table"` 元素的正确渲染，但 **PPTPageWorkbench.tsx** 的编辑面板对表格元素的
处理存在两个问题：
1. `ELEMENT_TYPES` 中缺少 `table` → 用户无法在工作台「添加元素」中插入表格
2. `toEditable` / `fromEditable` 的 textLines 转换丢失了表格结构信息 → 工作台编辑
   面板中表格显示为空白或无法编辑

---

## 数据结构（后端已定义，前端需对齐）

```json
{
  "element_id": "t1",
  "type": "table",
  "position": "full",
  "headers": ["物理量/定理", "表达式", "物理意义"],
  "rows": [
    ["质点角动量", "$\\vec{L} = \\vec{r} \\times \\vec{p}$", "描述质点转动的方向与强度"],
    ["力矩", "$\\vec{M} = \\vec{r} \\times \\vec{F}$", "力对转动的作用效果"]
  ],
  "content": [],
  "is_accent": false
}
```

---

## 修改 1：`ELEMENT_TYPES` 中添加 `table` 类型

**文件：`PPTPageWorkbench.tsx`，约第 80-87 行**

```diff
  const ELEMENT_TYPES = [
    { type: 'text_block',   label: '文本块',   ... },
    { type: 'list',         label: '列表',     ... },
    { type: 'subtitle',     label: '副标题',   ... },
    { type: 'huge_number',  label: '数据强调', ... },
    { type: 'timeline_item',label: '时间节点', ... },
    { type: 'image',        label: '图片占位', ... },
+   {
+     type: 'table',
+     label: '表格',
+     icon: <Grid size={14} />,
+     defaultContent: [],
+     defaultPosition: 'full',
+     description: '支持 LaTeX 公式的数据表格',
+     isTable: true,
+     // 新增时的默认结构
+     defaultHeaders: ['列标题1', '列标题2', '列标题3'],
+     defaultRows: [['单元格', '单元格', '单元格']],
+   },
  ] as const;
```

---

## 修改 2：`EditableEl` 类型 — 增加 table 专属字段

**文件：`PPTPageWorkbench.tsx`，约第 94-98 行**

```diff
  interface EditableEl {
    element_id: string; type: string; position: string;
    textLines: string[]; time?: string; is_accent?: boolean;
    alt?: string; query?: string; _raw: PPTElement;
+   /** 表格专属字段 */
+   headers?: string[];
+   rows?: string[][];
  }
```

---

## 修改 3：`toEditable` — table 类型保留 headers / rows

**文件：`PPTPageWorkbench.tsx`，约第 106-111 行**

```diff
  function toEditable(el: PPTElement): EditableEl {
-   return { element_id: el.element_id, type: el.type, position: el.position,
-     textLines: toArr((el as any).content), time: (el as any).time,
-     is_accent: (el as any).is_accent, alt: (el as any).alt,
-     query: (el as any).query, _raw: el };
+   const base: EditableEl = {
+     element_id: el.element_id, type: el.type, position: el.position,
+     textLines: toArr((el as any).content), time: (el as any).time,
+     is_accent: (el as any).is_accent, alt: (el as any).alt,
+     query: (el as any).query, _raw: el,
+   };
+   if (el.type === 'table') {
+     base.headers = Array.isArray((el as any).headers) ? (el as any).headers : [];
+     base.rows    = Array.isArray((el as any).rows)    ? (el as any).rows    : [];
+   }
+   return base;
  }
```

---

## 修改 4：`fromEditable` — table 类型输出 headers / rows

**文件：`PPTPageWorkbench.tsx`，约第 112-118 行**

```diff
  function fromEditable(e: EditableEl): PPTElement {
    const base: any = { ...(e._raw), element_id: e.element_id, type: e.type,
      position: e.position, time: e.time, is_accent: e.is_accent };
    if (e.type === 'image') {
      base.alt = e.alt; base.query = e.query || e.alt; delete base.content;
-   } else {
+   } else if (e.type === 'table') {
+     // 表格：直接写 headers/rows，content 保持为空数组
+     base.headers = e.headers ?? [];
+     base.rows    = e.rows    ?? [];
+     base.content = [];
+     delete base.alt; delete base.query;
+   } else {
      base.content = e.textLines.length > 0 ? e.textLines : undefined;
      delete base.alt; delete base.query;
    }
    return base as PPTElement;
  }
```

---

## 修改 5：`addElement` — table 类型的默认元素结构

**文件：`PPTPageWorkbench.tsx`，`addElement` 函数中**（按 typeDef 添加元素时）

```diff
  const addElement = (typeDef: ElementTypeDef) => {
    const newEl: EditableEl = {
      element_id: uid(),
      type: typeDef.type,
      position: typeDef.defaultPosition,
      textLines: [...typeDef.defaultContent],
      _raw: { element_id: '', type: typeDef.type, position: typeDef.defaultPosition,
               content: typeDef.defaultContent } as any,
    };
+   if (typeDef.type === 'table') {
+     newEl.headers = (typeDef as any).defaultHeaders ?? ['列1', '列2', '列3'];
+     newEl.rows    = (typeDef as any).defaultRows    ?? [['', '', '']];
+   }
    setElements(prev => [...prev, newEl]);
    setIsDirty(true);
  };
```

---

## 修改 6：编辑面板元素行 — table 类型的 UI

当 `el.type === 'table'` 时，在编辑面板中渲染一个简单的表格编辑器，支持：
- 编辑每个 header 文字
- 编辑每个 cell 文字（支持 LaTeX 公式，直接输入 `$...$`）
- 增删行、增删列（列数不超过 5）

**UI 示意（伪代码）：**

```tsx
// 在 ElementRow 组件（或内联 JSX）内，当 el.type === 'table' 时：
<div className={styles.tableEditor}>
  {/* Header 行 */}
  <div className={styles.tableEditorHeaderRow}>
    {el.headers?.map((h, ci) => (
      <input
        key={ci}
        className={styles.tableEditorCell}
        value={h}
        placeholder={`列${ci + 1}`}
        onChange={e => {
          const newHeaders = [...(el.headers ?? [])];
          newHeaders[ci] = e.target.value;
          updateElement(idx, { headers: newHeaders });
        }}
      />
    ))}
    {/* 增列按钮（最多5列） */}
    {(el.headers?.length ?? 0) < 5 && (
      <button onClick={() => {
        updateElement(idx, {
          headers: [...(el.headers ?? []), `列${(el.headers?.length ?? 0) + 1}`],
          rows: (el.rows ?? []).map(row => [...row, '']),
        });
      }}>+ 列</button>
    )}
  </div>

  {/* 数据行 */}
  {el.rows?.map((row, ri) => (
    <div key={ri} className={styles.tableEditorRow}>
      {row.map((cell, ci) => (
        <input
          key={ci}
          className={styles.tableEditorCell}
          value={cell}
          placeholder="单元格内容（支持 $LaTeX$）"
          onChange={e => {
            const newRows = (el.rows ?? []).map((r, i) =>
              i === ri ? r.map((c, j) => (j === ci ? e.target.value : c)) : r
            );
            updateElement(idx, { rows: newRows });
          }}
        />
      ))}
      {/* 删除行按钮 */}
      <button onClick={() => {
        updateElement(idx, { rows: (el.rows ?? []).filter((_, i) => i !== ri) });
      }}><Trash2 size={12} /></button>
    </div>
  ))}

  {/* 增行按钮 */}
  <button onClick={() => {
    updateElement(idx, {
      rows: [...(el.rows ?? []), new Array(el.headers?.length ?? 3).fill('')],
    });
  }}>+ 行</button>
</div>
```

---

## 修改 7（可选）：编辑面板图标

`lucide-react` 中 `Grid` 图标已在 imports 中（`import { ..., Grid } from 'lucide-react'`），
可直接用作 table 类型的图标。若没有导入，添加：
```diff
- import { ..., Wand2 } from 'lucide-react';
+ import { ..., Wand2, Table2 } from 'lucide-react';
```

---

## CSS 补充（`PPTPageWorkbench.module.css`）

```css
/* 表格编辑器 */
.tableEditor {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow-x: auto;
}
.tableEditorHeaderRow,
.tableEditorRow {
  display: flex;
  gap: 4px;
  align-items: center;
}
.tableEditorCell {
  flex: 1;
  min-width: 80px;
  padding: 4px 6px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 4px;
  font-size: 12px;
  color: inherit;
}
.tableEditorHeaderRow .tableEditorCell {
  font-weight: 600;
  background: rgba(99, 102, 241, 0.12);
}
```

---

## 总结

| 问题 | 修改位置 | 优先级 |
|------|----------|--------|
| 无法添加表格元素 | `ELEMENT_TYPES` + `addElement` | P0 |
| `toEditable` 丢失 headers/rows | `toEditable` 函数 | P0 |
| `fromEditable` 未输出 headers/rows | `fromEditable` 函数 | P0 |
| 工作台无表格编辑 UI | 编辑面板 ElementRow | P1 |
| 增删行/列 | 编辑面板 UI 按钮 | P1 |
