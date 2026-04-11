# EduAgent PPT 布局逻辑分析报告

> 分析时间：2026-04-11  
> 覆盖范围：生成 Prompt → 流式解析 → 前端预览 → 后端导出

---

## 一、全链路数据流

```
① 用户发送消息
② LLM 生成 NDJSON 流（一行一个 JSON 对象）
③ 后端实时解析 → 图片语义检索 → 逐页存 DB
④ 前端 SSE 接收 page_chunk → React 渲染预览
⑤ 用户导出 → ppt_exporter 从 DB 读取 → 生成 .pptx
```

---

## 二、5 种布局类型

| layout_type | 含义 | 页面结构 |
|---|---|---|
| `cover` | 封面页 | 全宽大标题居中 |
| `minimal_list` | 要点页 | 左: 内容卡片列表；右: 图片/数字 |
| `two_column` | 双栏对比页 | 左右各一组元素，由 `position` 分栏 |
| `stat_callout` | 数据强调页 | 超大数字居中；其他文字在下方 |
| `timeline` | 时间线页 | 竖轴时间线 + 各时间点内容 |

---

## 三、Element 结构

LLM 每页输出若干 element，结构为：
```json
{
  "element_id": "e1",
  "type": "list | text_block | huge_number | subtitle | timeline_item | image",
  "position": "left | right | right_top | right_bottom | center | full | bottom",
  "content": ["..."],
  "is_accent": false,
  
  // 仅 type=image 时使用：
  "query": "图片语义搜索词",
  "alt": "图片说明文字",
  "resolved": {           // 后端检索完成后注入
    "image_id": "...",
    "source": "library | user",
    "preview_url": "..."
  }
}
```

---

## 四、生成流程详解（`stream_generation`）

```
LLM 输出 NDJSON 流
    │
    ├─ {__type: "theme"} → 存主题色到 ppt_data.theme，发 generate_start SSE
    │
    ├─ {__type: "page"} → 对每个 element:
    │       若 type == "image":
    │           search_image_by_query(query, user_id)
    │           ├─ 找到 → 注入 elem["resolved"]，保留 element
    │           └─ 找不到 → 丢弃该 element（不产生空占位）
    │       else: 直接保留
    │       → 写入 DB (ppt_data.ppt_data[] append)
    │       → 发 page_chunk SSE
    │
    ├─ {__type: "word_start"} → 切换为 word_mode，后续文本为讲义 Markdown
    │
    └─ {__type: "done"} → 存 word_markdown，发 generate_done SSE
```

**关键设计**：图片过滤在 DB commit **之前**完成，避免空占位框写入 DB。

---

## 五、前端渲染逻辑（PPTCard.tsx）

```
layout_type
├─ "cover"       → 直接渲染 <h1>{page.title}</h1>，所有 elements 不参与
│
├─ "timeline"    → 渲染竖轴时间线，每个 element 作为一个时间点
│
├─ "stat_callout" → 两区分法（按 type/is_accent）:
│      is_accent || type in ["huge_number","stat"] → 大号数字区
│      其余 → 副文案区
│
├─ "two_column"  │
└─ "minimal_list" → 两列分法（按 position 字符串）:
       position 中含 "right" → 右列 (columnRight)
       其余(left/full/center/无) → 左列 (columnLeft)
       若无任何 element 含 "right" → 只渲染左列（单列模式）
```

**CSS 动态列数**：`--col-count` CSS 变量驱动，two_column/minimal_list 若有右侧内容则 2，否则 1。

---

## 六、后端导出逻辑（ppt_exporter.py）

```
LAYOUT_RENDERERS = {
    "cover":        render_cover,
    "title_slide":  render_cover,
    "two_column":   render_two_column,
    "stat_callout": render_stat_callout,
    "timeline":     render_timeline,
    "minimal_list": render_minimal_list,
    "image_focus":  render_default,
}
```

各 renderer 分元素的规则：

| renderer | 分类依据 | 说明 |
|---|---|---|
| `render_cover` | 无 | 只使用 title、elements 前3个作副标题 |
| `render_two_column` | **position 字段** | 含 "left" → 左栏；含 "right" → 右栏；无→平分 |
| `render_minimal_list` | **type 字段** | `image` → 右列；`huge_number/stat`(短)→右accent区；其余 → 左侧卡片 |
| `render_stat_callout` | **type 字段** | `huge_number/stat`(短) → 超大字；其余 → 下方文案 |
| `render_timeline` | 顺序 | 按 elements 顺序渲染时间线节点 |
| `render_default` | 顺序 | 全宽卡片列表 |

---

## 七、⚠️ 前后端不一致之处（当前已知问题）

### 问题 1：`minimal_list` 分栏逻辑不统一

| 端 | 分类依据 |
|---|---|
| **前端** (PPTCard.tsx 第402行) | `position` 字段含 "right" → 右列 |
| **后端** (ppt_exporter) | `type == "image"` → 右列；忽略 `position` |

**影响**：若 LLM 给文字 element 赋 `position: "right"`，前端右栏显示，导出 PPT 左栏显示。

### 问题 2：`position` 取值不统一

| 来源 | 实际使用的 position 值 |
|---|---|
| LLM Prompt 规定 | `left / right_top / right_bottom / center / full` |
| LLM 实际输出 | 还可能出现 `right / bottom / left_top / left_bottom` |
| 前端识别 | 字符串包含 "right" 即为右列（容错） |
| 后端 `two_column` | 字符串包含 "left"/"right"（容错，与前端一致✅） |
| 后端 `minimal_list` | **完全不看 position**（❌ 与前端不一致） |

### 问题 3：`cover` 页 elements 被前端忽略

前端 `cover` 直接渲染 `page.title`，elements 中定义的 subtitle 等**完全不渲染**。  
后端 `render_cover` 则会渲染 elements 前3个作副标题。  
**影响**：cover 预览与导出可能不一致。

---

## 八、主题系统

```json
{
  "theme": {
    "name": "...",
    "bg_color":    "#0F172A",  // 背景
    "primary":     "#38BDF8",  // 主色（标题、线条）
    "secondary":   "#64748B",  // 次色（副文字）
    "accent":      "#F59E0B",  // 强调色（高亮条、is_accent 背景）
    "text_color":  "#F1F5F9"   // 正文字色
  }
}
```

主题在生成时对背景/文字对比度有 WCAG 检查（对比度 < 3.0 时自动修正），  
导出时所有 renderer 均读取 `colors` dict（`bg/pri/sec/acc/txt`）进行配色。  
**前端**则通过 CSS 变量和 inline style 应用主题颜色。

---

## 九、总结图

```
LLM Prompt 规定
  5种 layout_type ──────────────────────────────────────────────────────┐
  position: left/right_top/right_bottom/center/full                     │
  type: list/text_block/huge_number/subtitle/timeline_item/image        │
        ↓                                                               │
stream_generation                                                       │
  解析 NDJSON → 图片resolve → 写DB                                       │
        ↓                                                               │
前端预览 (PPTCard.tsx)              后端导出 (ppt_exporter.py)            │
  cover:      大标题，不渲染element   render_cover: 标题+elements副标题   │
  two_column: position含right→右     render_two_column: 同上(一致✅)     │
  minimal_list:position含right→右    render_minimal_list: type==image→右 │
               ~~~不一致❌~~~                                             │
  stat_callout:is_accent/huge→大字   render_stat_callout: 同上(一致✅)   │
  timeline:   顺序竖轴               render_timeline: 同上(一致✅)       │
        ↓                                                               │
    .pptx 导出 ←────────────────────────────────────────────────────────┘
```
