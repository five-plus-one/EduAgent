# 互动小游戏 API 文档

> **版本**: v1.0 | **更新日期**: 2026-04-13  
> **鉴权**: 所有接口需 `Authorization: Bearer <access_token>`，预览接口支持 `?token=` 参数  

---

## 目录

| # | Method | 路径 | 说明 |
|---|--------|------|------|
| 1 | `GET`  | `/api/v1/games/types` | 获取所有游戏类型列表 |
| 2 | `POST` | `/api/v1/sessions/{session_id}/games/generate` | 触发游戏生成（新建 or 精炼）|
| 3 | `GET`  | `/api/v1/games/tasks/{task_id}` | 轮询生成任务进度 |
| 4 | `GET`  | `/api/v1/sessions/{session_id}/games` | 列出 session 下所有游戏 |
| 5 | `GET`  | `/api/v1/games/{game_id}/preview` | iframe 预览（返回 HTML）|
| 6 | `GET`  | `/api/v1/games/{game_id}/source` | 获取 HTML 源码（代码预览用）|
| 7 | `DELETE` | `/api/v1/games/{game_id}` | 删除游戏 |

---

## SSE 聊天事件扩展

> 原有 `POST /api/v1/sessions/{session_id}/chat` 接口的 SSE 流新增以下事件类型和字段。

### 请求体扩展

```json
{
  "content": "我想为本课生成一个小游戏",
  "active_game_id": "game_a1b2c3d4"   // 可选：当前正在预览的游戏 ID，传入后 AI 可识别并精炼
}
```

### 新增 SSE 事件类型

#### `game_suggest` — AI 展示游戏类型建议

```json
{
  "event_type": "game_suggest",
  "game_suggest": {
    "suggestions": [
      { "type": "quiz",   "reason": "选择题适合考察受迫振动的概念" },
      { "type": "memory", "reason": "配对翻牌适合物理量名词对应练习" }
    ],
    "pending_question": "您更倾向哪种类型？或者有自己的想法也可以描述。",
    "all_types": [
      { "key": "quiz",      "label": "🎯 选择题闯关" },
      { "key": "memory",    "label": "🃏 记忆配对翻牌" },
      { "key": "fillblank", "label": "✍️ 填空挑战" },
      { "key": "sort",      "label": "📊 拖拽排序" },
      { "key": "match",     "label": "🔗 拖拽连线" },
      { "key": "flashcard", "label": "⚡ 快问快答" },
      { "key": "custom",    "label": "🎨 自定义游戏" }
    ]
  },
  "is_finished": false
}
```

**前端处理建议**：收到此事件时，在聊天气泡下方渲染一排可点击的游戏类型卡片（类似 PPT 布局选型）。

---

#### `game_trigger` — AI 确认游戏需求，等待用户确认生成

```json
{
  "event_type": "game_trigger",
  "game_trigger": {
    "game_type":              "quiz",
    "title":                  "简谐振动知识闯关",
    "key_topics":             ["频率", "受迫振动", "共振条件"],
    "custom_requirements":    "10道题，每题30秒，深色背景",
    "is_refinement":          false,
    "refinement_instruction": ""
  },
  "is_finished": false
}
```

**前端处理建议**：收到此事件时，显示「生成游戏 🎮」确认按钮。用户点击后调用接口 2。

---

#### 终止报文扩展（`is_finished: true`）

```json
{
  "event_type": "text",
  "chunk": "",
  "is_finished": true,
  "extracted_intent": "chat",
  "game_spec": {                        // 非 null 时表示本轮 GenerateGame 已触发
    "game_type":              "quiz",
    "title":                  "简谐振动知识闯关",
    "key_topics":             ["频率", "受迫振动"],
    "custom_requirements":    "",
    "is_refinement":          false,
    "refinement_instruction": ""
  }
}
```

> `game_spec` 与 `game_trigger` 事件内容相同，二选一使用即可。

---

## 接口详情

### 1. 获取游戏类型列表

**`GET /api/v1/games/types`**

无需鉴权（或已登录即可），用于初始化选型 UI。

#### 响应 `200`

```json
{
  "types": [
    { "key": "quiz",      "label": "🎯 选择题闯关",   "hint": "10道四选一选择题，每题30秒倒计时..." },
    { "key": "memory",    "label": "🃏 记忆配对翻牌", "hint": "8对概念-解释配对翻牌，翻牌动画..." },
    { "key": "fillblank", "label": "✍️ 填空挑战",     "hint": "10道填空题，输入框，即时批改..." },
    { "key": "sort",      "label": "📊 拖拽排序",     "hint": "6~8个步骤/事件，拖拽到正确顺序..." },
    { "key": "match",     "label": "🔗 拖拽连线",     "hint": "左列概念→右列定义，点击连线..." },
    { "key": "flashcard", "label": "⚡ 快问快答",     "hint": "单面问题→翻转→背面答案，循环15张..." },
    { "key": "custom",    "label": "🎨 自定义游戏",   "hint": "完全按照教师要求实现..." }
  ]
}
```

---

### 2. 触发游戏生成

**`POST /api/v1/sessions/{session_id}/games/generate`**  
`Content-Type: application/json`

#### 请求体

```json
{
  "spec": {
    "game_type":              "quiz",
    "title":                  "简谐振动知识闯关",
    "key_topics":             ["频率", "受迫振动", "共振条件"],
    "custom_requirements":    "10道题，每题30秒，深色背景",
    "is_refinement":          false,
    "refinement_instruction": ""
  },
  "refine_game_id": null
}
```

**精炼模式（修改已有游戏）：**

```json
{
  "spec": {
    "game_type":              "quiz",
    "title":                  "简谐振动知识闯关",
    "key_topics":             ["频率"],
    "is_refinement":          true,
    "refinement_instruction": "把计时改成60秒，背景改成浅色"
  },
  "refine_game_id": "game_a1b2c3d4"
}
```

| 字段 | 说明 |
|------|------|
| `spec.game_type` | 游戏类型 key |
| `spec.is_refinement` | `true` = 修改已有游戏（需提供 `refine_game_id`）|
| `spec.refinement_instruction` | 仅 `is_refinement=true` 时填写 |
| `refine_game_id` | 要修改的游戏 ID |

#### 响应 `200`

```json
{
  "task_id":       "gtask_a1b2c3d4",
  "game_id":       "game_a1b2c3d4",
  "status":        "generating",
  "is_refinement": false
}
```

---

### 3. 轮询任务进度

**`GET /api/v1/games/tasks/{task_id}`**

#### 响应 `200`

```json
{
  "task_id":  "gtask_a1b2c3d4",
  "status":   "completed",
  "stage":    "done",
  "progress": 100,
  "result": {
    "game_id":   "game_a1b2c3d4",
    "html_file": "game_a1b2c3d4.html",
    "version":   1
  }
}
```

| `status` | 说明 |
|----------|------|
| `generating` | 生成中（建议 2s 轮询一次）|
| `completed`  | 完成，`result.game_id` 可用 |
| `failed`     | 失败，查看 `result.error` |

---

### 4. 列出 session 的所有游戏

**`GET /api/v1/sessions/{session_id}/games`**

#### 响应 `200`

```json
{
  "games": [
    {
      "game_id":    "game_a1b2c3d4",
      "title":      "简谐振动知识闯关",
      "game_type":  "quiz",
      "type_label": "🎯 选择题闯关",
      "status":     "completed",
      "version":    2,
      "created_at": "2026-04-13T09:00:00Z",
      "updated_at": "2026-04-13T09:05:00Z"
    }
  ]
}
```

> `version` 每次精炼 +1，前端可据此提示「已优化 N 次」。

---

### 5. 游戏 HTML 预览

**`GET /api/v1/games/{game_id}/preview`**  
**支持 `?token=<access_token>` 查询参数（iframe 无法设置 header）**

返回完整 HTML 文件，直接作为 `<iframe src="...">` 的地址使用。

```tsx
// 前端用法
const previewUrl = `${API_BASE}/games/${game_id}/preview?token=${accessToken}`;

<iframe
  src={previewUrl}
  sandbox="allow-scripts"   // 允许 JS 运行，禁止外部请求和弹窗
  style={{ width: '100%', height: 540, border: 'none', borderRadius: 12 }}
  title="游戏预览"
/>
```

> `sandbox="allow-scripts"` 仅允许 JS 执行，不允许外部网络请求（所有游戏为完全自含 HTML）。

---

### 6. 获取 HTML 源码

**`GET /api/v1/games/{game_id}/source`**

#### 响应 `200`

```json
{
  "game_id":    "game_a1b2c3d4",
  "title":      "简谐振动知识闯关",
  "game_type":  "quiz",
  "version":    1,
  "html_code":  "<!DOCTYPE html>\n<html>...",
  "char_count": 8432
}
```

前端代码预览组件用法：

```tsx
const { html_code } = await fetchGameSource(game_id);

// 代码高亮展示（只读）
<pre style={{ overflow: 'auto', maxHeight: 400 }}>
  <code>{html_code}</code>
</pre>
```

---

### 7. 删除游戏

**`DELETE /api/v1/games/{game_id}`**

返回 `204 No Content`。同时删除服务器上的 HTML 文件。

---

## 完整前端集成流程

```
用户发消息 "帮我生成一个关于受迫振动的游戏"
 ↓
收到 SSE event_type=game_suggest
 → 渲染游戏类型卡片供点击选择

用户选 "选择题闯关" 并回复
 ↓
收到 SSE event_type=game_trigger + 终止报文 game_spec 非 null
 → 显示「生成游戏 🎮」确认按钮

用户点确认
 ↓
POST /sessions/{id}/games/generate  → 拿到 task_id, game_id

轮询 GET /games/tasks/{task_id}
 → status=completed

切换到"游戏预览"标签页
 → <iframe src="/games/{game_id}/preview?token=...">   （实时运行效果）
 → 代码标签页：GET /games/{game_id}/source             （HTML 源码展示）

用户说 "把计时改成60秒"（传 active_game_id）
 ↓
收到 SSE event_type=game_trigger（is_refinement=true）
 → 显示「应用修改」确认按钮

用户确认
 ↓
POST /sessions/{id}/games/generate
  { spec: { is_refinement: true, refinement_instruction: "计时改60秒" }, refine_game_id: game_id }
 → 同一 game_id，version +1，iframe 刷新
```

---

## TypeScript 示例

```typescript
// api/games.ts

const API_BASE = '/api/v1';

function getToken() { return localStorage.getItem('access_token') ?? ''; }

/** 获取游戏类型列表 */
export async function getGameTypes() {
  const r = await fetch(`${API_BASE}/games/types`, {
    headers: { Authorization: `Bearer ${getToken()}` }
  });
  return (await r.json()).types;
}

/** 触发游戏生成（新建或精炼）*/
export async function generateGame(
  sessionId: string,
  spec: GameSpec,
  refineGameId?: string
) {
  const r = await fetch(`${API_BASE}/sessions/${sessionId}/games/generate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getToken()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ spec, refine_game_id: refineGameId ?? null }),
  });
  return r.json(); // { task_id, game_id, status }
}

/** 等待任务完成 */
export async function waitForGame(taskId: string): Promise<string> {
  while (true) {
    const d = await fetch(`${API_BASE}/games/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${getToken()}` }
    }).then(r => r.json());

    if (d.status === 'completed') return d.result.game_id;
    if (d.status === 'failed') throw new Error(d.result?.error ?? 'Game generation failed');
    await new Promise(r => setTimeout(r, 2000));
  }
}

/** 游戏预览 URL（用于 iframe src）*/
export function gamePreviewUrl(gameId: string) {
  return `${API_BASE}/games/${gameId}/preview?token=${getToken()}`;
}

/** 获取 HTML 源码 */
export async function getGameSource(gameId: string) {
  const r = await fetch(`${API_BASE}/games/${gameId}/source`, {
    headers: { Authorization: `Bearer ${getToken()}` }
  });
  return r.json(); // { html_code, version, ... }
}

/** 解析 SSE 聊天流中的游戏事件 */
export function handleGameEvent(event: any, callbacks: {
  onSuggest?: (data: GameSuggestData) => void;
  onTrigger?: (spec: GameSpec) => void;
}) {
  if (event.event_type === 'game_suggest') {
    callbacks.onSuggest?.(event.game_suggest);
  }
  if (event.event_type === 'game_trigger') {
    callbacks.onTrigger?.(event.game_trigger);
  }
  if (event.is_finished && event.game_spec) {
    // 终止报文携带 game_spec，与 game_trigger 等价
    callbacks.onTrigger?.(event.game_spec);
  }
}
```
