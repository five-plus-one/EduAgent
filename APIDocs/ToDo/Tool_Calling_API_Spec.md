# EduAgent 接口更新文档 - 基于 Tool Calling (Function Calling) 的重构方案

## 1. 背景与问题描述
**当前问题**：用户要求 AI 修改或生成 PPT 时，AI 经常会直接在聊天框（SSE 文本流）中吐出 Markdown 格式的内容，而不是更新右侧的 PPT 预览区。这导致对话信息与文档编辑器完全割裂，不符合所见即所得的交互产品预期。

**目标**：
1. **严格禁止**大模型在常规对话中输出 Markdown 格式的幻灯片内容。
2. 赋予后端大模型 **Tool Calling (Function Calling)** 的能力。任何对 PPT 的创建、修改、删除操作，都**必须**通过调用预定义的 tools 来完成。
3. 调整前后端通信协议（主要针对 SSE 接口），使得前端能够解析到工具调用指令，并将其映射为针对右侧预览区的局部或全局更新。

---

## 2. 后端核心架构改造建议 (Agent Loop)

为实现此功能，后端不能再仅仅透传 LLM 的文本输出，而需要引入标准的 Agent Loop 机制（例如使用 LangChain, LlamaIndex, 或直接基于 OpenAI/DeepSeek 等 API 原生的 Tool/Function capabilities）：

1. **注册工具 (Tools)**：在向大模型发起对话请求时，必须在 `tools` 参数中注入定义好的 PPT 修改工具集（例如 `generate_ppt`, `update_slide`, `add_slide`）。
2. **拦截与执行**：当大模型决定调用工具时（返回结果命中 `tool_calls`），后端应当截获该请求，执行相应的业务逻辑（如更新数据库中的状态）。
3. **SSE 流拆分**：后端向前端推送的 SSE 流需要由单一的纯文本流，升级为“结构化事件流”。必须在一对多消息中夹带特定类型的标记，让前端能清楚辨别哪些是“对话文字”，哪些是“动作调用”。

---

## 3. SSE 接口协议升级说明

**接口路径**: `POST /api/v1/sessions/{sessionId}/chat`

目前，前端解析 SSE 数据的核心字段主要依赖：
- `chunk` (部分文本)
- `is_finished` (是否结束)

**升级后，SSE 返回的业务级 Data 负载 (ev.data) 需要新增事件类型字段**：

### 3.1 协议规范示例

```json
{
  "event_type": "text" | "tool_call" | "tool_result",
  
  // 对于 event_type === "text" (普通闲聊文本)
  "chunk": "好的，我已经帮您更新了第三页的标题。",
  
  // 对于 event_type === "tool_call" (AI 开始调用工具，前端可借此实现 Loading UI)
  "tool_call": {
    "tool_name": "update_slide",
    "arguments": {
      "page_index": 2, // 对应第三页
      "field": "title",
      "new_content": "全新的章节解析"
    }
  },

  // (可选) 如果工具调用触发了底层数据更新，通知前端全量/增量拉取
  // 对于 event_type === "tool_result"
  "tool_result": {
    "tool_name": "update_slide",
    "status": "success",
    "should_refetch_ppt": true // 通知前端重新调用 GET /courseware/preview
  },
  
  "is_finished": false,
  "extracted_intent": null
}
```

### 3.2 建议的 Tool 集定义 (后端供给大模型的配置)

| Tool Name | 参数定义 (JSON Schema) | 描述 (Prompt 给大模型的说明) | 前端联动表现 |
|---|---|---|---|
| `generate_full_ppt` | `{"file_ids": ["..."], "mode": "depth"}` | 当用户要求从头生成课件时使用。**绝不要直接输出结构内容。** | 前端从聊天框自动切至右侧 PPT 并显示整局生成 Loading |
| `update_slide` | `{"page_index": Int, "element_id": String, "new_content": String}` | 修改某一特定页的内容（如标题、正文文本）。 | 前端收到通知，触发右侧 UI 数据变更 |
| `add_slide` | `{"insert_after_index": Int, "content": Object}` | 在指定位置新增一页幻灯片。 | 右侧侧边栏大纲自动插入新页 |
| `delete_slide` | `{"page_index": Int}` | 删除某一特定页的幻灯片。 | 右侧侧边栏自动移除该页 |

---

## 4. 给 Backend 同学的 Prompt 调优建议 (System Prompt)

为防止大模型“降智”并坚持输出 Markdown，除了引入 Tool 调用外，System Prompt 中需加入强有力的压制指令（Negative Prompt）：

> "You are an AI teaching assistant. You have access to tools that modify the user's presentation directly.
> 
> **CRITICAL RULE**: 
> NEVER, EVER output presentation content, outlines, or slide mockups in Markdown format directly in your conversational response. 
> Whenever the user asks to create, modify, or format a slide, you MUST ONLY use the provided tools (e.g., `update_slide`, `generate_full_ppt`). 
> Your text response should only be conversational (e.g., 'I have updated the title for you' or 'I am generating the presentation now')."

---

## 5. 前端侧的配套改造 (负责了解)
一旦后端按此协议上线：
1. 前端 `api.ts` 的 `streamChatCompletion` 中将增强 JSON parse 逻辑。允许剥离 `event_type === "tool_call"` 的数据包。
2. 捕获到 `event_type === "tool_call"` 的数据包时，不追加至 Chat Bubble (即不作为文字渲染)。
3. 前端可设计一个事件总线，拦截到 `should_refetch_ppt: true` 时自动发起 `GET /sessions/{sessionId}/courseware/preview` 同步最新幻灯片。
