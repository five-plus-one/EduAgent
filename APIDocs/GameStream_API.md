# 游戏生成流式接口文档

> **版本**: v1.1 | **更新**: 2026-04-13  
> **前端对应文件**: `src/utils/gamesApi.ts`（`streamGameTask` 函数）  
> **后端路由**: `/api/v1/games/tasks/{task_id}/stream`

---

## 背景

当前 `POST /sessions/{session_id}/games/generate` 返回 `task_id`，前端轮询  
`GET /games/tasks/{task_id}` 获取进度（500ms 一次）。

本文档定义新的 **SSE 流式接口**，让前端实时接收 LLM 生成的 HTML 代码片段，  
实现代码逐字滚动的"实时生成"效果。

---

## 接口定义

### `GET /api/v1/games/tasks/{task_id}/stream`

| 项目 | 值 |
|------|----|
| Method | `GET` |
| URL | `/api/v1/games/tasks/{task_id}/stream` |
| Auth | `Authorization: Bearer <token>` 或 `?token=<token>` 查询参数 |
| Accept | `text/event-stream` |
| Response | Server-Sent Events 流 |

#### 请求示例

```http
GET /api/v1/games/tasks/gtask_a1b2c3d4/stream HTTP/1.1
Authorization: Bearer eyJ...
Accept: text/event-stream
Cache-Control: no-cache
```

---

## SSE 事件类型

### 1. `stage` — 阶段变更

```json
{
  "event_type": "stage",
  "stage": "generating",
  "progress": 5,
  "message": "正在分析知识点，构建题目结构..."
}
```

| `stage` 值 | 说明 |
|-----------|------|
| `pending`    | 等待开始 |
| `preparing`  | 分析素材、构建 prompt |
| `generating` | LLM 正在生成 HTML 代码 |
| `writing`    | 写入文件系统 |
| `done`       | 完成 |

`progress` 取值 `0~100`，用于进度条显示。

---

### 2. `code_chunk` — HTML 代码片段（核心事件）

```json
{
  "event_type": "code_chunk",
  "chunk": "<!DOCTYPE html>\n<html lang=\"zh-CN\">\n<head>\n  <meta charset=\"UTF-8\">\n",
  "progress": 12
}
```

- `chunk`：LLM 输出的原始文本片段（可能是几个字符到几十行）
- 前端将所有 `chunk` **累积拼接**成完整 HTML 代码实时展示
- `progress`：当前估算进度（0-98，100 由 `done` 事件给出）

> **实现建议**：后端在 LLM streaming callback 中直接将 token 转发给 SSE，  
> 每隔 10-50 个 token 或遇到换行符时刷新一次 SSE 缓冲，确保实时性。

---

### 3. `done` — 生成完成

```json
{
  "event_type": "done",
  "game_id": "game_a1b2c3d4",
  "html_file": "game_a1b2c3d4.html",
  "version": 1,
  "progress": 100
}
```

前端收到 `done` 事件后：
1. 关闭 SSE 连接
2. 刷新游戏列表
3. 自动选中该游戏，切换到 iframe 预览

---

### 4. `error` — 生成失败

```json
{
  "event_type": "error",
  "message": "LLM 超时，请重试",
  "progress": 0
}
```

---

## 完整事件流示例

```
data: {"event_type":"stage","stage":"preparing","progress":3,"message":"分析知识点..."}

data: {"event_type":"stage","stage":"generating","progress":8,"message":"AI 正在生成游戏代码..."}

data: {"event_type":"code_chunk","chunk":"<!DOCTYPE html>\n<html lang=\"zh-CN\">\n","progress":10}

data: {"event_type":"code_chunk","chunk":"<head>\n  <meta charset=\"UTF-8\">\n  <title>","progress":13}

data: {"event_type":"code_chunk","chunk":"简谐振动选择题</title>\n  <style>\n","progress":16}

...（持续 chunk 事件，LLM 每输出若干 token 推一条）...

data: {"event_type":"stage","stage":"writing","progress":97,"message":"写入文件..."}

data: {"event_type":"done","game_id":"game_a1b2c3d4","html_file":"game_a1b2c3d4.html","version":1,"progress":100}
```

---

## 前端行为说明

### 降级策略

若 SSE 连接失败（404 / 网络错误），前端自动降级到 **500ms 轮询模式**  
（即现有 `GET /games/tasks/{task_id}` 轮询逻辑），保证兼容性。

### 前端已实现

`src/utils/gamesApi.ts` 中的 `streamGameTask` 函数：

```typescript
export async function streamGameTask(
  taskId: string,
  callbacks: {
    onStage?: (stage: string, progress: number, message?: string) => void;
    onChunk?: (chunk: string, progress: number) => void;
    onDone?: (gameId: string, version: number) => void;
    onError?: (message: string) => void;
  },
  signal?: AbortSignal,
): Promise<void>
```

调用时机：`generateGame()` 返回 `task_id` 后立即调用。

---

## 后端实现要点

### FastAPI + LangChain / OpenAI Streaming

```python
@router.get("/games/tasks/{task_id}/stream")
async def stream_game_task(
    task_id: str,
    current_user = Depends(get_current_user),
):
    async def event_generator():
        # 1. 发送 preparing 阶段
        yield f'data: {json.dumps({"event_type":"stage","stage":"preparing","progress":5})}\n\n'
        
        # 2. 调用 LLM（流式）
        async for chunk in llm.astream(prompt):
            yield f'data: {json.dumps({"event_type":"code_chunk","chunk":chunk.content,"progress":estimate_progress()})}\n\n'
        
        # 3. 写入文件
        yield f'data: {json.dumps({"event_type":"stage","stage":"writing","progress":97})}\n\n'
        await save_game_html(...)
        
        # 4. 完成
        yield f'data: {json.dumps({"event_type":"done","game_id":game_id,"version":version,"progress":100})}\n\n'
    
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # 禁用 nginx 缓冲，保证实时
        }
    )
```

> **注意**：需在 Nginx 反代配置中禁用 `proxy_buffering` 或添加 `X-Accel-Buffering: no`，  
> 否则 SSE chunks 会被缓冲合并，失去实时效果。

---

## 修改现有接口

`POST /sessions/{session_id}/games/generate` 的响应无需修改，  
只需前端在拿到 `task_id` 后改用 SSE 接口代替轮询。

---

## 实现优先级

| 优先级 | 功能 |
|--------|------|
| P0 | `code_chunk` 事件 — 实时输出 HTML token |
| P0 | `done` 事件 — 包含 `game_id` |
| P1 | `stage` 事件 — 阶段进度 |
| P2 | `progress` 字段精确到 1% |
| P3 | `error` 事件 |
