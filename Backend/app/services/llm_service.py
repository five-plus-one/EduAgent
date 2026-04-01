import json
import logging
import httpx
from app.core.config import settings
from app.services.llm_tools import GenerateFullPPT, UpdateSlide, AddSlide, DeleteSlide

logger = logging.getLogger(__name__)

# Tool schemas for the API request body
TOOLS_SCHEMA = [
    {
        "type": "function",
        "function": {
            "name": "GenerateFullPPT",
            "description": "当用户明确要求从头智能生成课件大纲或整套PPT时调用。绝不要直接将PPT内容大纲在对话框里输出，必须调用此工具！",
            "parameters": {
                "type": "object",
                "properties": {
                    "mode": {"type": "string", "description": "生成深度模式，通常为 'depth'"}
                },
                "required": ["mode"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "UpdateSlide",
            "description": "【核心工具】局部更新幻灯片页。当用户要求修改某页时，重新生成该页完整的标题与布局组件，精准覆盖。",
            "parameters": {
                "type": "object",
                "properties": {
                    "page_index": {"type": "integer", "description": "幻灯片页码（从1开始）"},
                    "new_title": {"type": "string", "description": "幻灯片单行大标题"},
                    "new_elements": {
                        "type": "array",
                        "description": "全新的一整套页面内部元素数组，替换旧元素。包含 type(text_block/content/list), position, content(字符串数组), is_accent 等。",
                        "items": { "type": "object" }
                    }
                },
                "required": ["page_index", "new_title", "new_elements"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "AddSlide",
            "description": "在指定位置新增一页幻灯片。",
            "parameters": {
                "type": "object",
                "properties": {
                    "insert_after_index": {"type": "integer", "description": "在哪一页之后插入（从1开始），0则插到最前"},
                    "content": {"type": "string", "description": "新页面的核心内容"}
                },
                "required": ["insert_after_index", "content"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "DeleteSlide",
            "description": "删除某一特定页的幻灯片。",
            "parameters": {
                "type": "object",
                "properties": {
                    "page_index": {"type": "integer", "description": "要删除的幻灯片页码（从1开始）"}
                },
                "required": ["page_index"]
            }
        }
    }
]

SYSTEM_PROMPT = (
    "你是多模态AI互动式教学智能体。你有能力通过调用工具（如 UpdateSlide，GenerateFullPPT等）直接修改用户的课件或者大纲。\n"
    "CRITICAL RULE:\n"
    "NEVER output presentation content, outlines, or slide mockups in Markdown format directly in your conversational response.\n"
    "Whenever the user asks to create, modify, or format a slide, you MUST ONLY use the provided tools.\n"
    "Your text response should only be brief conversational acknowledgement."
)


async def stream_chat_response(
    messages_history: list,
    new_user_input: str,
    rag_context: str = "",
    session_id: str = None
):
    # 构造消息列表
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]

    if rag_context:
        messages.append({
            "role": "system",
            "content": f"【当前备课空间已挂载了如下知识库原文档片段，回答时请深度结合以下切片进行研判】：\n{rag_context}"
        })

    if session_id:
        def _get_cw():
            from app.db.session import SessionLocal
            from app.models.generation import Courseware
            db = SessionLocal()
            try:
                cw = db.query(Courseware).filter(Courseware.session_id == session_id).first()
                if cw and cw.ppt_data and cw.ppt_data.get("ppt_data"):
                    pages = []
                    for page in cw.ppt_data.get("ppt_data"):
                        pages.append({
                            "page_index": page.get("page_index"),
                            "title": page.get("title"),
                            "elements": page.get("elements", [])
                        })
                    return json.dumps(pages, ensure_ascii=False)
            except Exception:
                pass
            finally:
                db.close()
            return None
            
        import asyncio
        cw_json = await asyncio.to_thread(_get_cw)
        if cw_json:
            messages.append({
                "role": "system",
                "content": f"【当前已有课件全局状态（JSON数组，包含所有幻灯片与元素）】：\n{cw_json}\n\n注意：你要基于以上全局视角进行精确工具修改操作！"
            })

    for msg in messages_history:
        role = "user" if msg.role == "user" else "assistant"
        messages.append({"role": role, "content": msg.content})

    messages.append({"role": "user", "content": new_user_input})

    headers = {
        "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": settings.LLM_MODEL,
        "messages": messages,
        "tools": TOOLS_SCHEMA,
        "tool_choice": "auto",
        "stream": True,
        # 开启快速思考（low 档位，约 1000 token 内完成思考后触发工具调用）
        # 若需要完全关闭思考以获得最快响应，改为 {"type": "disabled"}
        "thinking": {"type": "enabled", "budget_tokens": 1024},
    }

    base_url = settings.OPENAI_API_BASE.rstrip("/")
    tool_calls_buffer: dict[int, dict] = {}
    extracted_intent = ""

    try:
        # 使用 async httpx 避免阻塞事件循环（深度思考可能需要较长时间）
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(connect=10.0, read=600.0, write=10.0, pool=10.0)
        ) as client:
            async with client.stream(
                "POST",
                f"{base_url}/chat/completions",
                headers=headers,
                json=payload,
            ) as resp:
                resp.raise_for_status()

                async for raw_line in resp.aiter_lines():
                    line = raw_line.strip()
                    if not line or not line.startswith("data: "):
                        continue
                    data_str = line[6:].strip()
                    if data_str == "[DONE]":
                        break

                    try:
                        chunk = json.loads(data_str)
                    except json.JSONDecodeError:
                        continue

                    choices = chunk.get("choices", [])
                    if not choices:
                        continue

                    delta = choices[0].get("delta", {})

                    # ── 1. 深度思考内容 (reasoning_content) ──────────────────
                    reasoning = delta.get("reasoning_content") or delta.get("thinking") or ""
                    if reasoning:
                        evt = json.dumps(
                            {"event_type": "thinking", "chunk": reasoning, "is_finished": False},
                            ensure_ascii=False
                        )
                        yield f"data: {evt}\n\n"

                    # ── 2. 普通文本内容 ────────────────────────────────────────
                    text_content = delta.get("content") or ""
                    if text_content:
                        evt = json.dumps(
                            {"event_type": "text", "chunk": text_content, "is_finished": False},
                            ensure_ascii=False
                        )
                        yield f"data: {evt}\n\n"

                    # ── 3. Tool Calls（流式拼装）─────────────────────────────
                    for tc in delta.get("tool_calls") or []:
                        idx = tc.get("index", 0)
                        if idx not in tool_calls_buffer:
                            tool_calls_buffer[idx] = {
                                "id": tc.get("id", ""),
                                "name": tc.get("function", {}).get("name", ""),
                                "args_str": ""
                            }
                        fn = tc.get("function", {})
                        if fn.get("name"):
                            tool_calls_buffer[idx]["name"] = fn["name"]
                        tool_calls_buffer[idx]["args_str"] += fn.get("arguments", "")

    except Exception as e:
        logger.error(f"LLM Streaming error: {e}")

    # ── 4. 执行已拼装完毕的 Tool Calls ──────────────────────────────────────
    for tc_info in tool_calls_buffer.values():
        t_name = tc_info["name"].lower()
        try:
            t_args = json.loads(tc_info["args_str"]) if tc_info["args_str"] else {}
        except Exception:
            t_args = {}

        logger.info(f"[TOOL_EXEC] name={t_name} args={t_args}")

        # 向前端推送 tool_call 事件
        tc_data = json.dumps({
            "event_type": "tool_call",
            "tool_call": {"tool_name": t_name, "arguments": t_args},
            "is_finished": False
        }, ensure_ascii=False)
        yield f"data: {tc_data}\n\n"

        should_refetch = False
        if t_name in ["generatefullppt", "generate_full_ppt"]:
            extracted_intent = "generate_courseware"

        elif t_name in ["updateslide", "update_slide", "addslide", "add_slide", "deleteslide", "delete_slide"]:
            should_refetch = True
            try:
                from app.db.session import SessionLocal
                from app.models.generation import Courseware   # 正确路径：generation.py
                db_local = SessionLocal()
                cw = db_local.query(Courseware).filter(Courseware.session_id == session_id).first()
                if cw and cw.ppt_data and cw.ppt_data.get("ppt_data"):
                    slides = list(cw.ppt_data.get("ppt_data"))
                    if t_name in ["updateslide", "update_slide"]:
                        page_idx = t_args.get("page_index", 1) - 1
                        if 0 <= page_idx < len(slides):
                            target_slide = slides[page_idx]
                            new_title = t_args.get("new_title")
                            new_elements = t_args.get("new_elements")
                            
                            # Fallback compatibility if LLM still uses old new_content format
                            if "new_content" in t_args and not new_title and not new_elements:
                                new_val = t_args.get("new_content", "")
                                target_slide["title"] = new_val
                                if "elements" in target_slide and len(target_slide["elements"]) > 0:
                                    for elem in target_slide["elements"]:
                                        if elem.get("type") in ["text_block", "content", "list"]:
                                            elem["content"] = [new_val] if isinstance(elem.get("content"), list) else new_val
                                            break
                            else:
                                if new_title:
                                    target_slide["title"] = new_title
                                if new_elements is not None and isinstance(new_elements, list):
                                    import uuid
                                    for el in new_elements:
                                        if "element_id" not in el:
                                            el["element_id"] = f"e_{uuid.uuid4().hex[:8]}"
                                    target_slide["elements"] = new_elements
                                        
                    elif t_name in ["addslide", "add_slide"]:
                        pos = t_args.get("insert_after_index", 0)
                        pos = max(0, min(pos, len(slides)))
                        new_slide = {
                            "page_index": pos + 1,
                            "layout_type": "minimal_list",
                            "title": "新增页",
                            "speaker_notes": "",
                            "elements": [
                                {
                                    "element_id": f"e_{uuid.uuid4().hex[:6]}",
                                    "type": "text_block",
                                    "position": "left",
                                    "content": [t_args.get("content", "")],
                                    "is_accent": False
                                }
                            ]
                        }
                        slides.insert(pos, new_slide)
                        for i, s in enumerate(slides):
                            s["page_index"] = i + 1
                    elif t_name in ["deleteslide", "delete_slide"]:
                        pos = t_args.get("page_index", 1) - 1
                        if 0 <= pos < len(slides):
                            slides.pop(pos)
                            for i, s in enumerate(slides):
                                s["page_index"] = i + 1
                    # 触发 SQLAlchemy JSON 变更检测
                    from sqlalchemy.orm.attributes import flag_modified
                    cw.ppt_data = {**cw.ppt_data, "ppt_data": slides}
                    flag_modified(cw, "ppt_data")
                    db_local.commit()
                    logger.info(f"[TOOL_EXEC] DB updated for session {session_id}")
            except Exception as e:
                logger.error(f"Tool Execute Error: {e}")
            finally:
                if "db_local" in locals():
                    db_local.close()

        # 重要：每个工具执行完后立即推送 tool_result，触发前端事件刷新
        is_full_gen = (t_name.lower() in ["generatefullppt"])
        tr_data = json.dumps({
            "event_type": "tool_result",
            "tool_result": {
                "tool_name": t_name, 
                "status": "success", 
                "should_refetch_ppt": should_refetch,
                "trigger_full_generation": is_full_gen
            },
            "is_finished": False
        }, ensure_ascii=False)
        yield f"data: {tr_data}\n\n"

    # ── 5. 兜底意图识别 ───────────────────────────────────────────────────────
    if not extracted_intent:
        user_text = new_user_input.lower()
        if ("生成" in user_text or "制作" in user_text) and ("ppt" in user_text or "课件" in user_text):
            extracted_intent = "generate_courseware"

    # ── 6. 终止报文 ───────────────────────────────────────────────────────────
    final_data = json.dumps({
        "event_type": "text",
        "chunk": "",
        "is_finished": True,
        "extracted_intent": extracted_intent
    }, ensure_ascii=False)
    yield f"data: {final_data}\n\n"
