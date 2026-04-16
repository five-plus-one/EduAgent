# PPT 会话主题偏好持久化 API

> **版本**: v1.0 | **日期**: 2026-04-15
> **路由前缀**: `/api/v1`
> **鉴权**: 所有接口均需 `Authorization: Bearer <access_token>`

---

## 背景与动机

当前 `PPTExport_Theme_API.md` 已定义：
- `GET /export/themes` — 获取主题列表
- `POST /sessions/{session_id}/export` — 导出时支持传 `theme_key`

**现存问题**：主题选择仅存在于前端内存中，页面刷新后丢失。用户每次进入会话均需重新选主题，体验差。

**解决方案**：在 Session 维度增加主题偏好字段，支持：
1. 保存/更新当前会话的主题选择（预设主题 or 自定义颜色）
2. 会话加载时自动携带已保存的主题，前端直接恢复预览
3. 导出时若无显式 `theme_key`，后端使用会话保存的主题作为 fallback

---

## 目录

| # | Method | 路径 | 说明 |
|---|--------|------|------|
| 1 | `PATCH` | `/sessions/{session_id}/theme` | 保存/更新会话的主题偏好（新增接口）|
| 2 | `GET`   | `/sessions/{session_id}` | **扩展**响应，新增 `ppt_theme` 字段 |
| 3 | `POST`  | `/sessions/{session_id}/export` | **扩展**：无 `theme_key` 时 fallback 到会话保存主题 |

---

## 1. 保存/更新会话主题偏好（新增接口）

**`PATCH /sessions/{session_id}/theme`**
`Content-Type: application/json`

用户在前端「应用主题」后，前端立即调用此接口将选择持久化到后端。

### 场景 A：选择预设主题

```json
{
  "theme_key": "ocean_depths"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `theme_key` | string \| null | ✅ | 来自 `GET /export/themes` 的 `key` 字段；传 `null` 表示重置为「自动」 |
| `custom_colors` | object | ❌ | 使用预设主题时不传 |

### 场景 B：用户完全自定义颜色

```json
{
  "theme_key": null,
  "custom_colors": {
    "bg_color":   "#1A1A2E",
    "primary":    "#E94560",
    "secondary":  "#533483",
    "accent":     "#F5A623",
    "text_color": "#EAEAEA"
  }
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `theme_key` | null | ✅ | 自定义时必须为 `null` |
| `custom_colors.bg_color` | string (hex) | ✅ | 幻灯片背景色 |
| `custom_colors.primary` | string (hex) | ✅ | 主色：标题、页码、横线 |
| `custom_colors.secondary` | string (hex) | ✅ | 辅助色：副标题、次要文字 |
| `custom_colors.accent` | string (hex) | ✅ | 强调色：装饰线、圆点、高亮 |
| `custom_colors.text_color` | string (hex) | ✅ | 正文文字色 |

### 场景 C：重置为「自动」（由后端按 session 哈希自动选择）

```json
{
  "theme_key": null
}
```

### 响应 `200`

```json
{
  "session_id": "sess_5e5c3a5c",
  "ppt_theme": {
    "theme_key": "ocean_depths",
    "custom_colors": null,
    "updated_at": "2026-04-15T12:05:00Z"
  }
}
```

### 错误响应

| HTTP | code | 说明 |
|------|------|------|
| `404` | 4041 | session 不存在或无权访问 |
| `400` | 4001 | `theme_key` 不在已知主题列表中 |
| `400` | 4002 | `custom_colors` 字段缺失或颜色值格式不合法（非 `#RRGGBB`）|

```json
{
  "code": 4001,
  "message": "theme_key 不合法",
  "data": {
    "error_ref": "ERR-TH001",
    "details": [{ "field": "theme_key", "issue": "unknown theme: invalid_key" }]
  }
}
```

---

## 2. 获取会话详情（扩展 ppt_theme 字段）

**`GET /sessions/{session_id}`**（现有接口，扩展响应结构）

### 响应 `200`（新增 `ppt_theme` 字段）

```json
{
  "session_id": "sess_5e5c3a5c",
  "course_name": "牛顿第二定律",
  "target_audience": "大一新生",
  "messages": [...],
  "associated_files": ["f_a1b2"],
  "ppt_theme": {
    "theme_key": "ocean_depths",
    "custom_colors": null,
    "resolved_colors": {
      "bg_color":   "#0B192C",
      "primary":    "#38BDF8",
      "secondary":  "#94A3B8",
      "accent":     "#10B981",
      "text_color": "#F8FAFC"
    },
    "updated_at": "2026-04-15T12:05:00Z"
  }
}
```

> **关键字段说明**：
> - `ppt_theme` 为 `null` 时，表示该会话未设置主题，使用「自动」模式
> - `resolved_colors` 是后端根据 `theme_key` 解析出的完整颜色对象
>   - 对于**预设主题**：后端从主题配置表查出颜色，避免前端重复查询 `GET /export/themes`
>   - 对于**自定义颜色**：`resolved_colors` 等同于 `custom_colors`
>   - 前端直接用 `resolved_colors` 注入 CSS 变量，无需任何额外逻辑

### 前端使用示例

```typescript
// 加载会话时，直接恢复主题 CSS 变量
const session = await getSession(sessionId);
if (session.ppt_theme?.resolved_colors) {
  const c = session.ppt_theme.resolved_colors;
  setAppliedThemeColors(c);  // 注入 CSS --ppt-* 变量
  setAppliedThemeName(session.ppt_theme.theme_key ?? '自定义');
  setPendingThemeKey(session.ppt_theme.theme_key);
}
```

---

## 3. 触发 PPT 导出（扩展 fallback 逻辑）

**`POST /sessions/{session_id}/export`**（现有接口，行为变更）

### Fallback 优先级

```
用户本次传的 theme_key        [最高优先级]
  ↓ 若未传
session 已保存的 ppt_theme    [中等优先级]
  ↓ 若也未设置
后端按 session_id 哈希自动选  [兜底]
```

### 请求体（无变化，`theme_key` 仍为可选）

```json
{
  "theme_key": "ocean_depths"
}
```

> 若前端用户已在「切换主题」步骤应用并保存了主题，导出时可不传 `theme_key`，后端自动复用已保存的偏好。

---

## 数据库建议（后端实现参考）

在 `sessions` 表新增字段，或建独立的 `session_ppt_theme` 表：

### 方案 A：在 sessions 表新增 JSON 列（简单推荐）

```sql
ALTER TABLE sessions
  ADD COLUMN ppt_theme_key    VARCHAR(64)  DEFAULT NULL,
  ADD COLUMN ppt_custom_colors JSON        DEFAULT NULL,
  ADD COLUMN ppt_theme_updated_at DATETIME DEFAULT NULL;
```

### 方案 B：独立表（可扩展为多端主题）

```sql
CREATE TABLE session_ppt_themes (
  session_id      VARCHAR(64) PRIMARY KEY REFERENCES sessions(session_id),
  theme_key       VARCHAR(64),           -- NULL = 自定义
  custom_colors   JSON,                  -- NULL = 使用预设
  updated_at      DATETIME NOT NULL,
  INDEX idx_session (session_id)
);
```

---

## 前端完整联动流程

```
用户点击「切换主题」
  → ThemePicker 弹出（mode='apply'）
  → 用户选择/自定义颜色，点「应用主题」
  → onConfirm(themeKey, customColors, resolvedColors) 回调触发
  → ① 立即注入 CSS 变量（实时预览生效）
  → ② 调用 PATCH /sessions/{session_id}/theme（后端持久化）
  → ③ 本地 localStorage 作为离线 cache（可选，刷新前快速恢复防闪烁）

用户刷新页面 / 重新进入会话
  → GET /sessions/{session_id} 返回 ppt_theme.resolved_colors
  → 前端直接应用 resolved_colors 到 CSS 变量
  → 主题恢复完成（无感知）
```

---

## 前端 API 调用代码（TypeScript）

在 `src/utils/api.ts` 新增：

```typescript
/** 保存会话 PPT 主题偏好到后端 */
export async function saveSessionTheme(
  sessionId: string,
  themeKey: string | null,
  customColors?: {
    bg_color: string; primary: string; secondary: string;
    accent: string; text_color: string;
  }
): Promise<void> {
  const body: Record<string, unknown> = { theme_key: themeKey };
  if (themeKey === null && customColors) {
    body.custom_colors = customColors;
  }
  const res = await fetch(`${API_BASE}/sessions/${sessionId}/theme`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${getToken()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Failed to save theme: ${res.status}`);
}
```

在 `Workspace.tsx` 的 `onConfirm` 中调用：

```typescript
onConfirm={(themeKey, customColors, resolvedColors) => {
  setShowThemePicker(false);
  if (themePickerMode === 'apply') {
    // ① 立即注入 CSS 变量
    if (resolvedColors) setAppliedThemeColors(resolvedColors);
    setAppliedThemeName(themeKey === CUSTOM_KEY ? '自定义' : (themeKey ?? '自动'));
    setPendingCustomColors(customColors);

    // ② 持久化到后端（fire-and-forget，失败不阻断预览）
    if (sessionId !== 'new') {
      const keyToSave = themeKey === CUSTOM_KEY ? null : themeKey;
      saveSessionTheme(sessionId, keyToSave, themeKey === CUSTOM_KEY ? customColors : undefined)
        .catch(err => console.warn('[Theme] Failed to persist theme:', err));
    }
  } else {
    // 导出流
    setPendingCustomColors(customColors);
    const keyToSend = themeKey === CUSTOM_KEY ? undefined : (themeKey ?? undefined);
    exportCourseware(keyToSend, customColors);
  }
}}
```

在 `useCourseware` 或 Workspace 的 `useEffect` 中恢复：

```typescript
// 加载会话时恢复主题
useEffect(() => {
  if (sessionId === 'new') return;
  getSession(sessionId).then(session => {
    // ... 现有逻辑 ...
    if (session.ppt_theme?.resolved_colors) {
      setAppliedThemeColors(session.ppt_theme.resolved_colors);
      setAppliedThemeName(session.ppt_theme.theme_key ?? '自定义');
      setPendingThemeKey(session.ppt_theme.theme_key);
    }
  });
}, [sessionId]);
```

---

## 验收标准

| 场景 | 期望行为 |
|------|---------|
| 用户选择预设主题并点「应用主题」| `PATCH /sessions/{id}/theme` 返回 200，`ppt_theme.theme_key` 已更新 |
| 用户自定义 5 个颜色并应用 | `PATCH` 返回 200，`ppt_theme.theme_key=null`，`ppt_theme.custom_colors` 有值 |
| 刷新页面后进入会话 | `GET /sessions/{id}` 返回 `ppt_theme.resolved_colors`，前端 CSS 变量自动恢复 |
| 用户「重置主题」| `PATCH { theme_key: null }` 无 `custom_colors`，后端恢复「自动」状态 |
| 导出时不传 `theme_key` | 后端使用 `ppt_theme.theme_key` 作为 fallback，或自动哈希选择 |
| 传非法 `theme_key` | 返回 `400`，`code: 4001`，`details` 中说明具体字段错误 |
