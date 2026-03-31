# EduAgent PPT 流式生成改造方案

> **版本**: v1.1  
> **日期**: 2026-03-31  
> **优先级**: P0 — 当前轮询架构超时率高；增量工具操作触发全屏 Loading 体验割裂  
> **状态**: 待实施

---

## 1. 背景与问题定性

### 1.1 问题 A：全量生成超时

| 阶段 | 现状 | 问题 |
|------|------|------|
| 触发 | `POST /sessions/{id}/generate` → 后端 BackgroundTask | 同步阻塞，无法感知进度 |
| 生成 | LLM 输出完整 JSON（单次 ~90s）| 前端看不到任何中间状态 |
| 等待 | 前端每 3s 轮询 `/generate/tasks/{id}` | 轮询 2min 仍超时则报错，用户白等 |
| 渲染 | 拿到完整 ppt_data 后一次性渲染 | 无预览、无可中断点 |

### 1.2 问题 B：增量工具操作触发全屏 Loading（体验割裂）

用户在聊天框输入"帮我在最后加一页介绍"，AI 调用 `AddSlide` 工具，前端的 `shouldRefetchForTool` 将 `addslide`、`updateslide`、`deleteslide` 与 `generatefullppt` **一视同仁**，全部触发 `EduAgent_Generate_Start`，导致：

1. `useCourseware` 进入 `isGenerating=true` → PPT 区显示"大模型正在深度排版"全屏 Loading
2. `pollUntilReady()` 开始 3s 间隔轮询，等 ppt_data 更新
3. 单页操作本应 3-5s 完成，用户却面对和全量生成完全一样的等待 UI

**根本原因**（`src/utils/streamManager.ts`）：
```typescript
// 所有含 slide/page/update 的工具名被一律视为"全量生成"
private shouldRefetchForTool(toolName: string): boolean {
  const name = (toolName || "").toLowerCase();
  return /generate|slide|page|update|edit|insert|delete/.test(name);
}
```

### 1.3 目标体验

- **全量生成**：第 1 页 PPT 卡片 3-5s 内出现，逐页追加，可随时停止
- **增量操作**（AddSlide / UpdateSlide / DeleteSlide）：静默后台刷新，仅受影响卡片显示 shimmer，**不触发全屏 Loading**
- 主题色板在 `generate_start` 事件到达时立即应用
- 进度条仅全量生成时显示

---

## 2. 新架构设计：逐页 SSE 流

```
前端 POST /generate/stream
  │
  ▼ (SSE 长连接建立)
后端收集历史 + RAG 上下文
  │
  ▼
httpx 流式调用 LLM (NDJSON Prompt)
  │
  ├─ 检测到 __type="theme" → yield SSE: generate_start
  ├─ 检测到 __type="page"  → 写库 + yield SSE: page_chunk
  ├─ 检测到 __type="word_start" → 切换模式收集 markdown
  └─ 检测到 __type="done"  → 写库 word_markdown + yield SSE: generate_done
  │ (任何时刻 AbortController abort)
  └─ CancelledError → 已写入的 pages 保留 → 连接断开
```

---

## 3. 后端改造规范

### 3.1 新增 SSE 端点

```
POST /api/v1/sessions/{session_id}/generate/stream
```

**请求头**: `Accept: text/event-stream`  
**请求体**:
```json
{
  "selected_file_ids": ["f_a1b2", "doc_991"],
  "mode": "fast" | "depth"
}
```

**响应**: `text/event-stream`，每条 SSE 事件格式为标准 `data: {...}\n\n`

> **注意**: 旧的 `POST /sessions/{id}/generate` 和 `GET /generate/tasks/{task_id}` 接口**保留不删**，仍服务于 MCP 工具调用路径（GenerateFullPPT Tool 仍走旧接口）。

---

### 3.2 SSE 事件规范

#### 事件 1: `generate_start` — 开始生成（携带主题色）

**触发时机**: LLM 输出第一个 `__type="theme"` 行后立即推送  
**前端动作**: 切换 Tab 到 PPT 区，应用主题色到全局 CSS variables

```json
{
  "event": "generate_start",
  "data": {
    "theme": {
      "name": "Midnight Galaxy",
      "bg_color": "#0B132B",
      "primary": "#1C2541",
      "secondary": "#3A506B",
      "accent": "#5BC0BE",
      "text_color": "#FFFFFF"
    },
    "total_hint": 8
  }
}
```

#### 事件 2: `page_chunk` — 单页生成完毕

**触发时机**: LLM 每输出一行完整的 `__type="page"` JSON 后立即推送  
**前端动作**: `setPages(prev => [...prev, page])`，追加渲染新 PPT 卡片

```json
{
  "event": "page_chunk",
  "data": {
    "page_index": 1,
    "layout_type": "cover",
    "title": "厌氧消化过程监控与软测量",
    "speaker_notes": "开宗明义，说明 FOS/TAC 比值对反应器稳定性的核心作用...",
    "elements": [
      {
        "element_id": "e_0001",
        "type": "text_block",
        "position": "center",
        "content": ["FOS/TAC 智能软测量系统", "基于机器学习的过程状态感知"],
        "is_accent": true
      }
    ]
  }
}
```

#### 事件 3: `word_ready` — Word 讲义生成完毕

**触发时机**: 所有 PPT 页面生成完毕、word_markdown 收集完毕之后  
**前端动作**: `setWordDoc(markdown)`

```json
{
  "event": "word_ready",
  "data": {
    "word_markdown": "# 厌氧消化过程监控\n\n## 第一章 引言\n..."
  }
}
```

#### 事件 4: `generate_done` — 全部完成

**触发时机**: 所有数据写库完毕  
**前端动作**: `setIsStreaming(false)`，显示"生成完成"提示

```json
{
  "event": "generate_done",
  "data": {
    "total_pages": 8
  }
}
```

#### 事件 5: `generate_error` — 发生错误

**触发时机**: LLM 调用失败、JSON 解析异常等  
**前端动作**: `setError(message)`，显示错误提示，保留已生成的页面

```json
{
  "event": "generate_error",
  "data": {
    "message": "LLM upstream timeout after 60s"
  }
}
```

---

### 3.3 LLM Prompt 策略（NDJSON 逐行输出）

在 `courseware_generator.py` 中新增 `async def stream_generation(...)` 函数，使用以下 Prompt 约束输出格式：

```
【输出格式的严格规定】
你必须严格按照以下 NDJSON（换行分隔 JSON）格式逐行输出，每行是一个独立的合法 JSON 对象。
绝对禁止输出任何 Markdown 围栏（```）、解释性文字或前置说明！

第一行，输出主题定义：
{"__type": "theme", "name": "主题名称", "bg_color": "#HEX", "primary": "#HEX", "secondary": "#HEX", "accent": "#HEX", "text_color": "#HEX"}

然后，每一页幻灯片输出一行，以 page_index 升序排列：
{"__type": "page", "page_index": 1, "layout_type": "cover", "title": "...", "speaker_notes": "...", "elements": [...]}
{"__type": "page", "page_index": 2, "layout_type": "two_column", ...}
（以此类推，至少 6 页）

所有幻灯片行输出完毕后，输出此分隔行：
{"__type": "word_start"}

紧接着输出完整的 Word 讲义 Markdown 文本（可跨多行）。

最终以此行结束全部输出：
{"__type": "done"}
```

**流式解析器逻辑**（逐行扫描 LLM SSE 输出）：

```python
buffer = ""
word_mode = False
word_lines = []

async for line in llm_stream:
    if word_mode:
        if line.strip() == '{"__type": "done"}':
            # 完成：写 word_markdown 入库，yield generate_done
            word_markdown = "\n".join(word_lines)
            await save_word_markdown(db, session_id, word_markdown)
            yield sse("generate_done", {"total_pages": page_count})
            break
        else:
            word_lines.append(line)
        continue

    buffer += line
    try:
        obj = json.loads(buffer.strip())
        buffer = ""
        t = obj.get("__type")

        if t == "theme":
            await save_theme(db, session_id, obj)
            yield sse("generate_start", {"theme": obj, "total_hint": 8})

        elif t == "page":
            await append_page(db, session_id, obj)
            page_count += 1
            yield sse("page_chunk", obj)

        elif t == "word_start":
            word_mode = True

    except json.JSONDecodeError:
        pass  # 行尚未完整，继续累积 buffer
```

---

### 3.4 取消与部分成果保留

当前端断开 SSE 连接（`AbortController.abort()`）时：

- FastAPI 的 `StreamingResponse` 会触发 `asyncio.CancelledError`
- 后端捕获后**不清除**已写入数据库的 pages
- 下次用户进入该 session，`GET /courseware/preview` 返回已生成的部分页面
- 前端显示"已停止，共生成 N 页"并渲染已有的页面

---

### 3.5 并发安全

- 同一 `session_id` 最多允许一个流式生成任务
- 新请求进来时检查 DB 中是否有 `status=generating` 的任务，如有则拒绝并返回 `409 Conflict`
- 使用数据库行锁（`SELECT FOR UPDATE`）避免并发写入 ppt_data

---

## 4. 前端改造规范

### 4.1 新增 API 函数

**文件**: `Frontend/src/utils/api.ts`

```typescript
export const streamCoursewareGeneration = async (
  sessionId: string,
  selectedFileIds: string[],
  mode: 'fast' | 'depth',
  callbacks: {
    onStart: (theme: PPTTheme, totalHint: number) => void;
    onPage:  (page: PPTPage) => void;
    onWordReady: (markdown: string) => void;
    onDone:| `app/services/courseware_generator.py` | 新增函数 | `async def stream_generation(...)` — async generator |
| `app/api/v1/endpoints/generation.py` | 新增端点 | `POST /sessions/{id}/generate/stream` |
| `app/schemas/generation.py` | 可选新增 | `StreamGenerateRequest` schema |
| `app/services/llm_service.py` | 修改 | `tool_result` 新增 `trigger_full_generation` 字段 |

### 前端

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/utils/api.ts` | 新增函数 | `streamCoursewareGeneration` |
| `src/utils/streamManager.ts` | 修改 | 移除 `shouldRefetchForTool`，按 `trigger_full_generation` 字段分发事件 |
| `src/hooks/usePPTStream.ts` | 新建文件 | 全量流式生成状态机 Hook |
| `src/hooks/useCourseware.ts` | 修改 | 新增 `EduAgent_Slide_Updated` 处理器，移除旧轮询逻辑 |
| `src/pages/Workspace.tsx` | 修改 | 接入 `usePPTStream`，重写 PPT 区渲染逻辑 |
| `src/components/PPTSkeleton.tsx` | 新建文件 | 全量生成/增量 AddSlide 的骨架占位卡片 |

---

## 5. 增量工具操作的正确事件模型（问题 B 修复方案）

### 5.1 事件分级：重型 vs 轻型

将工具触发的前端事件拆分为两个独立 CustomEvent，彻底消除混淆：

| CustomEvent | 触发条件 | 前端响应 |
|-------------|----------|----------|
| `EduAgent_Generate_Start` | 仅 `GenerateFullPPT` 工具 | 全屏 Loading + `pollUntilReady()` |
| `EduAgent_Slide_Updated` | `AddSlide` / `UpdateSlide` / `DeleteSlide` | 静默 `fetchPreview()` + 受影响卡片 shimmer |

### 5.2 后端改造（`llm_service.py`）

在 Tool 执行完毕推送 `tool_result` 事件时，新增 `trigger_full_generation` 字段做明确标记：

```python
# GenerateFullPPT
yield sse_event("tool_result", {
    "tool_name": t_name,
    "status": "success",
    "should_refetch_ppt": False,
    "trigger_full_generation": True   # 新增：通知前端进入全屏 Loading
})

# AddSlide / UpdateSlide / DeleteSlide
yield sse_event("tool_result", {
    "tool_name": t_name,
    "status": "success",
    "should_refetch_ppt": True,
    "trigger_full_generation": False  # 新增：通知前端只做静默刷新
})
```

`tool_result` SSE 事件完整格式更新：
```json
{
  "event_type": "tool_result",
  "tool_result": {
    "tool_name": "addslide",
    "status": "success",
    "should_refetch_ppt": true,
    "trigger_full_generation": false
  }
}
```

### 5.3 前端改造（`streamManager.ts`）

废弃 `shouldRefetchForTool` 方法，改为根据 `trigger_full_generation` 字段决策：

```typescript
onToolResult: (result) => {
  const isFullGen = result.trigger_full_generation === true
    ?? this.shouldRefetchForTool(lastToolName); // 旧后端兼容降级

  if (isFullGen) {
    // 重型：全屏 Loading + 轮询
    window.dispatchEvent(new CustomEvent('EduAgent_Generate_Start', { detail: { sessionId } }));
    window.dispatchEvent(new CustomEvent('EduAgent_Refetch_PPT', { detail: { sessionId } }));
  } else if (result.should_refetch_ppt) {
    // 轻型：静默刷新，不进 Loading
    window.dispatchEvent(new CustomEvent('EduAgent_Slide_Updated', { detail: { sessionId } }));
  }

  const icon = result.status === 'success' ? '✅' : '❌';
  streamData.state.toolLog += `> ${icon} *操作已完成*\n\n`;
  this.notify(sessionId, streamData);
}
```

### 5.4 前端改造（`useCourseware.ts`）

新增 `EduAgent_Slide_Updated` 事件处理器，**不改变 `isGenerating`**：

```typescript
const handleSlideUpdated = (e: Event) => {
  const ev = e as CustomEvent;
  if (ev.detail?.sessionId !== sessionId) return;
  // 先追加占位骨架给用户即时反馈（仅 AddSlide 场景有意义）
  // 再静默拉取真实数据
  fetchPreview();
};

window.addEventListener('EduAgent_Slide_Updated', handleSlideUpdated);
// cleanup: removeEventListener
```

### 5.5 UX：增量操作的卡片级 shimmer

| 工具 | 视觉反馈 | 实现方式 |
|------|----------|----------|
| `AddSlide` | 列表末尾出现骨架卡片，fetchPreview 后替换为真实卡片 | `setPages(prev => [...prev, skeletonPage])` → `fetchPreview()` 覆盖 |
| `UpdateSlide` | 目标 page_index 卡片上叠加 shimmer overlay | 现有 `updatingPages` Set 机制，保留不动 |
| `DeleteSlide` | 目标卡片淡出，fetchPreview 后移除 | fetchPreview 返回后 setPages 自动移除 |

操作期间输入框和其他卡片**不被禁用**，用户可继续对话。

### 5.6 `AddSlide` 的 `insert_after_index` 处理

当前 AI 倾向于用超大值（如 999）表示"插到最后"。后端应做 clamp 处理：

```python
# generation.py - iterate_slide 或 llm_tools.py
pos = min(t_args.get("insert_after_index", 0), len(slides))
```

并在 `tool_result` 中回传实际插入的索引，便于前端精确定位 shimmer：
```json
{
  "trigger_full_generation": false,
  "should_refetch_ppt": true,
  "actual_page_index": 9
}
```

---

## 6. 验证方案

### 6.1 后端单测

```bash
# 手动 curl 验证 SSE 端点（全量流式生成）
curl -N -X POST \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{"selected_file_ids": [], "mode": "fast"}' \
  "http://localhost:8000/api/v1/sessions/<session_id>/generate/stream"

# 期望逐行输出：
# data: {"event":"generate_start","data":{"theme":{...},"total_hint":8}}
# data: {"event":"page_chunk","data":{"page_index":1,...}}
# ...
# data: {"event":"generate_done","data":{"total_pages":8}}
```

### 6.2 前端验证清单

**全量生成（问题 A）**
- [ ] 点击"AI 一键生成课件" → 自动切换到 PPT Tab
- [ ] 5s 内出现骨架占位卡片
- [ ] 第 1 页卡片渲染后可立即点击"迭代修改"
- [ ] 进度条随页面追加实时更新
- [ ] 点击"停止生成" → 流中断 → 已生成页面保留
- [ ] 切换会话再切回 → 已生成部分页面仍显示
- [ ] 生成完毕 → 进度条消失 → "生成完成"提示

**增量操作（问题 B）**
- [ ] 聊天框"帮我在最后加一页介绍" → AI 调用 `AddSlide` → PPT 区**不出现**全屏 Loading
- [ ] 列表末尾出现骨架 shimmer，3-5s 后替换为真实卡片
- [ ] "把第二页标题改一下" → AI 调用 `UpdateSlide` → 仅第 2 张卡片出现 shimmer
- [ ] 上述操作期间输入框和其他卡片**不被禁用**
- [ ] `tool_result.trigger_full_generation=false` 时，控制台不出现 `EduAgent_Generate_Start`

---

## 7. 兼容性与降级策略

| 场景 | 处理方式 |
|------|---------|
| doubao 模型不遵守 NDJSON 格式 | 后端 fallback：1min 后无 `page_chunk`，切回完整 JSON 一次性推送 |
| 浏览器不支持 SSE | `@microsoft/fetch-event-source` 内置 polyfill，项目已安装 |
| 网络中断 | `fetchEventSource` retry 机制，自动重连（最多 3 次） |
| 重连后重复渲染 | 每个 `page_index` 追加前去重 |
| 旧版后端无 `trigger_full_generation` 字段 | 前端 fallback 到 `shouldRefetchForTool` 旧逻辑（保守降级） |

---

## 8. 开放问题（需确认）

1. **NDJSON Prompt 实测**：需用 doubao-seed-2-0-pro-260215 模型验证是否能稳定按格式输出。

2. **新端点路径**：使用 `POST /generate/stream`，body 传 `selected_file_ids` 和 `mode`。

3. **MCP GenerateFullPPT 工具路径**：该工具触发的生成当前仍走旧轮询路径，两套并存。未来可统一为流式路径。

4. **`actual_page_index` 回传**：后端在 AddSlide `tool_result` 中回传实际插入位置，便于前端精确定位骨架卡片（非必须，可作为后续优化）。
�� isStreaming 且 pages.length > 0 时渲染
<PPTSkeleton pageNumber={pages.length + 1} />
```

---

### 4.5 主题色板应用

收到 `generate_start` 事件后，向页面注入 CSS variables：

```typescript
const applyTheme = (theme: PPTTheme) => {
  const root = document.documentElement;
  root.style.setProperty('--ppt-bg', theme.bg_color);
  root.style.setProperty('--ppt-primary', theme.primary);
  root.style.setProperty('--ppt-secondary', theme.secondary);
  root.style.setProperty('--ppt-accent', theme.accent);
  root.style.setProperty('--ppt-text', theme.text_color);
};
```

---

## 5. 文件改动一览

### 后端

| 文件 | 操作 | 说明 |
|------|------|------|
| `app/services/courseware_generator.py` | 新增函数 | `async def stream_generation(...)` — async generator |
| `app/api/v1/endpoints/generation.py` | 新增端点 | `POST /sessions/{id}/generate/stream` |
| `app/schemas/generation.py` | 可选新增 | `StreamGenerateRequest` schema |

### 前端

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/utils/api.ts` | 新增函数 | `streamCoursewareGeneration` |
| `src/hooks/usePPTStream.ts` | 新建文件 | 流式生成状态机 Hook |
| `src/hooks/useCourseware.ts` | 删除逻辑 | 移除 `handleGenerate` 中的轮询逻辑 |
| `src/pages/Workspace.tsx` | 修改 | 接入 `usePPTStream`，重写 PPT 区渲染 |
| `src/components/PPTSkeleton.tsx` | 新建文件 | 流式骨架占位卡片 |

---

## 6. 验证方案

### 6.1 后端单测

```bash
# 手动 curl 验证 SSE 端点
curl -N -X POST \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{"selected_file_ids": [], "mode": "fast"}' \
  "http://localhost:8000/api/v1/sessions/<session_id>/generate/stream"

# 期望输出（逐行出现）：
# data: {"event":"generate_start","data":{"theme":{...},"total_hint":8}}
# data: {"event":"page_chunk","data":{"page_index":1,...}}
# data: {"event":"page_chunk","data":{"page_index":2,...}}
# ...
# data: {"event":"word_ready","data":{"word_markdown":"..."}}
# data: {"event":"generate_done","data":{"total_pages":8}}
```

### 6.2 前端验证清单

- [ ] 点击"AI 一键生成课件" → 自动切换到 PPT Tab
- [ ] 5s 内出现"正在生成第 1 页..."骨架卡片
- [ ] 第 1 页卡片渲染后可立即点击"迭代修改"
- [ ] 进度条随页面追加实时更新
- [ ] 点击"停止生成" → 流中断 → 已生成页面全部保留
- [ ] 切换其他会话再切回 → 已生成的部分页面仍然显示
- [ ] 全部生成完毕 → 进度条消失 → "生成完成"提示

---

## 7. 兼容性与降级策略

| 场景 | 处理方式 |
|------|---------|
| doubao 模型不遵守 NDJSON 格式 | 后端 fallback：检测如果 1min 后无 `page_chunk` 事件，切回完整 JSON 解析并一次性推送所有页面 |
| 浏览器不支持 SSE | `@microsoft/fetch-event-source` 内置 polyfill，项目已安装 |
| 网络中断 | `fetchEventSource` 的 `retry` 机制，自动重连（最多 3 次） |
| 重连后重复渲染 | 每个 `page_index` 在追加前去重（`pages.find(p => p.page_index === page.page_index)`） |

---

## 8. 开放问题（需确认）

1. **NDJSON Prompt 实测**：需要用 doubao-seed-2-0-pro-260215 模型实测是否能稳定按格式输出。如不稳定，备选方案是后端用 SSE 推进度阶段事件，完成后一次性推完整 JSON（体验略差但更稳定）。

2. **新端点路径**：本方案使用 `POST /generate/stream` 而非 GET，因为需要在 body 中传递 `selected_file_ids` 数组和 `mode`。

3. **MCP GenerateFullPPT 工具路径**：AI 聊天中 MCP 调用 `GenerateFullPPT` 工具时，是否也切换为新的流式路径？当前方案保持旧路径不变，两套并存。如需统一，可进一步讨论。
