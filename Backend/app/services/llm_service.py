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
            "name": "ProposePPTPlan",
            "description": (
                "【第一步：布局方案提案】当用户首次说出想生成整套PPT时，必须先调用此工具幕出布局方案。"
                "方案要求：每页只需一行，格式为 「页码 [布局] 标题 —— 元素位置概述」，不要堆叠大段文字内容。"
                "元素位置概述示例：「左：3条要点列表；右：配图」、「全幅大标题+副标题」、「顶部引導语；中部大数字卡片×4」。"
                "绝对不需要写具体教学内容，只描述页面的“有什么”和“在哪里”。"
                "提交方案后等待用户确认，用户认可后再调用 GenerateFullPPT 正式生成。"
                "绝对不能在对话文本中直接输出大纲，必须通过此工具提交。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "plan_markdown": {
                        "type": "string",
                        "description": (
                            "PPT布局方案，Markdown格式。每页一行。"
                            "布局类型只能从cover/minimal_list/two_column/stat_callout/timeline这5种中选，禁止使用其他名称。"
                            "示例：\n"
                            "**P1** [cover] 课程大标题 —— 全幅标题+副标题居中\n"
                            "**P2** [minimal_list] 教学目标 —— 左上：标题；全幅：3-4条要点列表\n"
                            "**P3** [two_column] 原理对比 —— 左：3条文字列表；右：配图\n"
                            "**P4** [stat_callout] 核心数据 —— 居中大数字「98%」+说明文字\n"
                            "**P5** [timeline] 发展历程 —— 左到右：4个时间节点卡片\n"
                            "(不需要写具体文字内容，只描述元素数量、位置。禁止使用以上5种之外的布局名)"
                        )
                    },
                    "total_pages": {
                        "type": "integer",
                        "description": "预计生成的幻灯片总页数（建议6-12页）"
                    }
                },
                "required": ["plan_markdown", "total_pages"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "GenerateFullPPT",
            "description": (
                "【第二步：正式生成】仅在用户明确确认 ProposePPTPlan 方案后才调用此工具，启动实际PPT生成流程。"
                "未经用户确认严禁调用。"
            ),
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
            "description": "在指定位置新增一页幻灯片。参数格式与 UpdateSlide 完全一致，必须传入结构化 title 和 new_elements，禁止用 content 字符串。",
            "parameters": {
                "type": "object",
                "properties": {
                    "insert_after_index": {"type": "integer", "description": "在哪一页之后插入（从1开始），0则插到最前"},
                    "title": {"type": "string", "description": "新幻灯片的标题"},
                    "new_elements": {
                        "type": "array",
                        "description": "页面内部元素数组，格式与 UpdateSlide.new_elements 完全相同，包含 type, position, content, is_accent 等字段",
                        "items": {"type": "object"}
                    }
                },
                "required": ["insert_after_index", "title", "new_elements"]
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
    "你是多模态AI互动式教学智能体。你有能力通过调用工具（如 UpdateSlide，ProposePPTPlan，GenerateFullPPT等）直接修改用户的课件或者大纲。\n"
    "CRITICAL RULES:\n"
    "1. NEVER output presentation content, outlines, or slide mockups in Markdown format directly in your conversational response.\n"
    "   Whenever the user asks to create, modify, or format a slide, you MUST ONLY use the provided tools.\n"
    "   Your text response should only be brief conversational acknowledgement.\n"
    "2. AddSlide 工具与 UpdateSlide 工具参数格式完全一致：必须传入 title（标题字符串）和 new_elements（元素对象数组）。\n"
    "   AddSlide 禁止使用 content 字符串参数，必须构造完整的结构化 new_elements 数组。\n"
    "3. 当用户要求'将某页分成两页'时：先调用 UpdateSlide 修改原页，再调用 AddSlide 插入新页，两次调用均使用完整的 new_elements 结构。\n"
    "4. 【两步生成流程（严格遵守）】\n"
    "   当用户首次表示想要生成整套PPT/课件时，必须严格执行以下两步：\n"
    "   ▸ 第一步：调用 ProposePPTPlan 工具，以“布局素描”格式呈现每页方案。\n"
    "   ▸ 布局素描要求：每页一行、格式为「Pn [layout] 页面标题 —— 元素位置描述」。\n"
    "   ▸ 元素位置描述要简洁：指出有几个区块、分别在哪里（左/右/居中/全幅）、是文字列表还是图片，不需要写具体教学内容。\n"
    "   ▸ 示例：P3 [two_column] 量子力学基础 —— 左：3条要点列表；右：配图\n"
    "   ▸ 第二步：等待用户明确确认（如：'好的'/'可以'/'就这样'/'开始生成'/'没问题'等）后，再调用 GenerateFullPPT 正式生成。\n"
    "   ▸ 严禁跳过 ProposePPTPlan 直接调用 GenerateFullPPT，这会导致用户无法预知生成结果。\n"
    "5. 【方案草稿阶段 ★ 最高优先级 ★】\n"
    "   判断方法：查看对话历史，若 ProposePPTPlan 已被调用但 GenerateFullPPT 尚未被调用，即处于方案草稿阶段。\n"
    "   此阶段内用户的任何修改意见（如'把P3改成…'、'去掉P5'、'调换P4和P6'、'多加一页'等），\n"
    "   必须将修改后的完整方案重新调用 ProposePPTPlan 提交，等用户再次确认。\n"
    "   ★ 在此阶段绝对禁止调用 UpdateSlide / AddSlide / DeleteSlide ★\n"
    "   这些工具只有在 GenerateFullPPT 已成功执行之后才能使用。\n"
    "   在草稿阶段调用这些工具会对不存在的PPT发起修改，是严重逻辑错误，必须避免。\n"
    "6. 【PPT已生成阶段规则】\n"
    "   GenerateFullPPT 已被成功调用后，绝对禁止再次调用 GenerateFullPPT 或 ProposePPTPlan。\n"
    "   任何局部调整（修改某页、新增页、删除页）均只能使用 UpdateSlide / AddSlide / DeleteSlide。\n"
    "   违反此规则将导致用户已有的整套课件丢失，是严重错误。"
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
    propose_plan_called = False  # True when ProposePPTPlan runs this turn

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
        if t_name in ["proposepptplan", "propose_ppt_plan"]:
            # ── ProposePPTPlan：将方案文本推送为普通 AI 消息，不触发生成 ─────────
            plan_md   = t_args.get("plan_markdown", "")
            total_pgs = t_args.get("total_pages", 0)
            if plan_md:
                # 将各页行强制拆为 Markdown 段落（\n\n），避免单换行被合并成一行
                page_lines = [l.strip() for l in plan_md.splitlines() if l.strip()]
                plan_md_formatted = "\n\n".join(page_lines)

                _suffix = "如方案满意，请回复「可以」或「开始生成」；若需调整请告诉我修改意见。"
                hint = (
                    f"\n\n{plan_md_formatted}\n\n"
                    f"---\n\n"
                    f"📋 **以上是本次 PPT 生成方案，共计 {total_pgs} 页。**  \n"
                    + _suffix
                )
                plan_evt = json.dumps(
                    {"event_type": "text", "chunk": hint, "is_finished": False},
                    ensure_ascii=False
                )
                yield f"data: {plan_evt}\n\n"
            # 不设置 extracted_intent → 不触发任何生成流程
            propose_plan_called = True  # 记录本轮已进入草稿阶段，阻断兜底意图

        elif t_name in ["generatefullppt", "generate_full_ppt"]:
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
                        import uuid
                        new_elements = t_args.get("new_elements", [])
                        # Ensure all elements have element_id
                        for el in new_elements:
                            if "element_id" not in el:
                                el["element_id"] = f"e_{uuid.uuid4().hex[:8]}"
                        # Fallback: if LLM still passes content string, wrap it
                        if not new_elements and t_args.get("content"):
                            new_elements = [{
                                "element_id": f"e_{uuid.uuid4().hex[:8]}",
                                "type": "list",
                                "position": "full",
                                "content": [t_args.get("content", "")],
                                "is_accent": True
                            }]
                        new_slide = {
                            "page_index": pos + 1,
                            "layout_type": "minimal_list",
                            "title": t_args.get("title", "新增页"),
                            "speaker_notes": "",
                            "elements": new_elements
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
    # SKIP fallback if ProposePPTPlan was called this turn:
    # The user's message may contain "生成"+"ppt" keywords, but we're only at the
    # plan-proposal stage — triggering generation here would bypass user confirmation.
    if not extracted_intent and not propose_plan_called:
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

