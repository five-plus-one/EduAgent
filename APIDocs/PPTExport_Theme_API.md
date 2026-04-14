# PPT 导出 & 主题色 API 文档

> **版本**: v1.1 | **更新日期**: 2026-04-13
> **路由前缀**: `/api/v1/generation`
> **鉴权**: 所有接口均需 `Authorization: Bearer <access_token>`

---

## 目录

| # | Method | 路径 | 说明 |
|---|--------|------|------|
| 1 | `GET`  | `/export/themes` | 获取所有主题（颜色、标签）|
| 2 | `POST` | `/sessions/{session_id}/export` | 触发 PPT 导出（支持指定主题）|
| 3 | `GET`  | `/export/tasks/{task_id}` | 查询导出任务进度 |
| 4 | `GET`  | `/export/download/{filename}` | 下载 .pptx 文件 |

---

## 1. 获取主题列表

**`GET /export/themes`**（无需 session，任意已登录用户可调）

### 响应 `200`

```json
{
  "themes": [
    {
      "key":        "modern_minimalist",
      "label":      "极简现代",
      "category":   "light",
      "bg_color":   "#F8FAFC",
      "primary":    "#0F172A",
      "secondary":  "#64748B",
      "accent":     "#3B82F6",
      "text_color": "#1E293B"
    },
    {
      "key":        "ocean_depths",
      "label":      "深海蓝",
      "category":   "dark",
      "bg_color":   "#0B192C",
      "primary":    "#38BDF8",
      "secondary":  "#94A3B8",
      "accent":     "#10B981",
      "text_color": "#F8FAFC"
    }
  ]
}
```

### 字段说明

| 字段 | 说明 |
|------|------|
| `key` | 传给导出接口的唯一键名 |
| `label` | 中文显示名（用于选色 UI） |
| `category` | `"light"` \| `"dark"` |
| `bg_color` | 幻灯片背景色 |
| `primary` | 主色：标题、页码、横线 |
| `secondary` | 辅助色：副标题、次要文字 |
| `accent` | 强调色：装饰线、圆点、高亮 |
| `text_color` | 正文文字色 |

### 全部主题一览

| key | 标签 | 类别 | bg | primary | accent |
|-----|------|------|----|---------|--------|
| `modern_minimalist` | 极简现代 | light | `#F8FAFC` | `#0F172A` | `#3B82F6` |
| `sunset_boulevard` | 落日大道 | light | `#FFF7F0` | `#EA580C` | `#FACC15` |
| `golden_hour` | 黄金时刻 | light | `#FEF3C7` | `#B45309` | `#F59E0B` |
| `forest_canopy` | 森林林冠 | light | `#F0FDF4` | `#15803D` | `#22C55E` |
| `desert_rose` | 沙漠玫瑰 | light | `#FFF1F2` | `#BE123C` | `#F43F5E` |
| `arctic_frost` | 北极霜雪 | light | `#F0F9FF` | `#0369A1` | `#38BDF8` |
| `ocean_depths` | 深海蓝 | dark | `#0B192C` | `#38BDF8` | `#10B981` |
| `cyber_neon` | 赛博霓光 | dark | `#09090B` | `#A855F7` | `#06B6D4` |
| `midnight_galaxy` | 星河宇宙 | dark | `#020617` | `#6366F1` | `#818CF8` |
| `botanical_garden` | 翡翠花园 | dark | `#064E3B` | `#A7F3D0` | `#10B981` |

---

## 2. 触发 PPT 导出

**`POST /sessions/{session_id}/export`**
`Content-Type: application/json`

### 请求体（可选，不传 body 则自动选主题）

```json
{
  "theme_key": "ocean_depths"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `theme_key` | string | ❌ | 主题键名，来自接口 1 的 `key` 字段；不传则自动按 session 哈希选择 |

### 响应 `200`

```json
{
  "task_id": "exp_a1b2c3d4",
  "status": "generating",
  "theme_key": "ocean_depths"
}
```

> 返回后立即用接口 3 轮询进度。

### 代码示例

```typescript
// src/api/generation.ts

/** 获取主题列表 */
export async function getThemes() {
  const res = await fetch(`${API_BASE}/export/themes`, {
    headers: { Authorization: `Bearer ${getToken()}` }
  });
  return (await res.json()).themes;
}

/** 触发导出，可选指定主题 */
export async function triggerExport(sessionId: string, themeKey?: string) {
  const res = await fetch(`${API_BASE}/sessions/${sessionId}/export`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getToken()}`,
      'Content-Type': 'application/json',
    },
    // body 可以不传（后端 default=None）
    body: themeKey ? JSON.stringify({ theme_key: themeKey }) : undefined,
  });
  return res.json(); // { task_id, status, theme_key }
}
```

---

## 3. 查询导出进度

**`GET /export/tasks/{task_id}`**

### 响应 `200`

```json
{
  "task_id":   "exp_a1b2c3d4",
  "status":    "completed",
  "stage":     "saving_file",
  "progress":  100,
  "result": {
    "download_urls": { "ppt_url": "/api/v1/generation/export/download/export_xxx.pptx" },
    "filename": "export_xxx.pptx",
    "error": null
  }
}
```

| `status` | 含义 |
|----------|------|
| `generating` | 处理中 |
| `completed` | 完成，可下载 |
| `failed` | 失败，`result.error` 有描述 |

### 进度轮询示例

```typescript
async function waitForExport(taskId: string): Promise<string> {
  while (true) {
    const data = await fetch(`${API_BASE}/export/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${getToken()}` }
    }).then(r => r.json());

    if (data.status === 'completed') {
      return `${API_BASE}${data.result.download_urls.ppt_url}`;
    }
    if (data.status === 'failed') {
      throw new Error(data.result?.error ?? 'Export failed');
    }
    await new Promise(r => setTimeout(r, 2000)); // 每 2s 轮询
  }
}
```

---

## 4. 下载 .pptx 文件

**`GET /export/download/{filename}`**

直接触发浏览器下载，无需 Authorization header（URL 本身即鉴权令牌）。

```typescript
const downloadUrl = `${API_BASE}/export/download/${filename}`;
window.open(downloadUrl, '_blank');
// 或
// <a href={downloadUrl} download>下载 PPT</a>
```

---

## 前端选色 UI 集成方案

### 选色器组件思路

```tsx
import { useEffect, useState } from 'react';

function ThemePicker({ onSelect }: { onSelect: (key: string) => void }) {
  const [themes, setThemes] = useState([]);

  useEffect(() => {
    getThemes().then(setThemes);
  }, []);

  const light = themes.filter(t => t.category === 'light');
  const dark  = themes.filter(t => t.category === 'dark');

  return (
    <div>
      <h4>浅色主题</h4>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {light.map(t => (
          <ThemeChip key={t.key} theme={t} onClick={() => onSelect(t.key)} />
        ))}
      </div>
      <h4>深色主题</h4>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {dark.map(t => (
          <ThemeChip key={t.key} theme={t} onClick={() => onSelect(t.key)} />
        ))}
      </div>
    </div>
  );
}

/** 色块卡片：展示背景色、主色、强调色的色条 */
function ThemeChip({ theme, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        width: 80, borderRadius: 8, overflow: 'hidden',
        cursor: 'pointer', border: '2px solid transparent',
      }}
    >
      <div style={{ height: 40, background: theme.bg_color }} />
      <div style={{ height: 8,  background: theme.primary }} />
      <div style={{ height: 6,  background: theme.accent }} />
      <div style={{ fontSize: 10, padding: '2px 4px',
                    background: theme.bg_color, color: theme.text_color }}>
        {theme.label}
      </div>
    </div>
  );
}
```

---

## PPT 预览中同步背景图形

### 背景装饰层规则（供前端 preview 复现）

每张幻灯片（除封面外）有以下背景装饰层，颜色均为 `blend(src, bg, ratio)` 预混合：

```
blend(src, bg, ratio) = {
  r: Math.round(src.r * ratio + bg.r * (1 - ratio)),
  g: Math.round(src.g * ratio + bg.g * (1 - ratio)),
  b: Math.round(src.b * ratio + bg.b * (1 - ratio)),
}
```

| 层 | 形状 | 位置 (% of 1333×750 canvas) | 颜色 | ratio |
|----|------|------|------|-------|
| A | 圆形 | 左上角 `(-9%, -16%)` 宽高 `27%×48%` | accent | 0.24 |
| B | 圆形 | 右下角 `(95.5%, 92%)` 宽高 `34%×60%`（大部分裁掉）| primary | 0.15 |
| C | 矩形 | `(40%, 42%)` 宽高 `65%×62%` | primary（深色）/ white（浅色）| 0.10 / 0.22 |
| E | 圆形（偶数页）| 左下 `(0.4%, 84%)` 宽高 `13.5%×24%` | secondary | 0.20 |

**布局特定层 D：**

| 布局 | 额外图形 |
|------|---------|
| `cover` | 右侧大圆（accent）+ 右下小圆（secondary）|
| `two_column` | 中线处 3 个等距小圆点（accent, 各 0.3"×0.3"，ratio依次 0.25/0.21/0.17）|
| `minimal_list` / `standard` | 右上角小圆（accent 或 secondary，隔页交替）|
| `stat_callout` | 中央双层晕圈（accent）|
| `timeline` | 横向色带 + 左侧竖色条 |

### CSS 实现建议

```css
/* 用 radial-gradient 模拟圆形装饰 */
.slide-bg {
  background-color: var(--bg);
  /* Layer A: 左上角渐变圆 */
  background-image:
    radial-gradient(circle 15% at -9% -16%, var(--accent-blend-a) 0%, transparent 70%),
    /* Layer B: 右下角（大部分出画面）*/
    radial-gradient(circle 17% at 109% 108%, var(--primary-blend-b) 0%, transparent 70%);
}
```

---

## 完整导出流程示例

```typescript
// 1. 展示选色器，用户选择主题
const themeKey = await showThemePicker(); // e.g. 'ocean_depths'

// 2. 触发导出
const { task_id } = await triggerExport(sessionId, themeKey);

// 3. 轮询等待完成
const downloadUrl = await waitForExport(task_id);

// 4. 下载
window.open(downloadUrl, '_blank');
```
