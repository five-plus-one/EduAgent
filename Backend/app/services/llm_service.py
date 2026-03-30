import json
import logging
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage, AIMessageChunk
from app.core.config import settings
from app.services.llm_tools import GenerateFullPPT, UpdateSlide, AddSlide, DeleteSlide

logger = logging.getLogger(__name__)

def get_chat_llm():
    return ChatOpenAI(
        model=settings.LLM_MODEL,
        openai_api_base=settings.OPENAI_API_BASE,
        openai_api_key=settings.OPENAI_API_KEY,
        streaming=True,
        temperature=0.7
    )

async def stream_chat_response(messages_history: list, new_user_input: str, rag_context: str = "", session_id: str = None):
    llm = get_chat_llm()
    llm_with_tools = llm.bind_tools([GenerateFullPPT, UpdateSlide, AddSlide, DeleteSlide])
    
    messages = [
        SystemMessage(content=(
            "你是多模态AI互动式教学智能体。你有能力通过调用工具（如 update_slide，generate_full_ppt等）直接修改用户的课件或者大纲。\n"
            "CRITICAL RULE:\n"
            "NEVER output presentation content, outlines, or slide mockups in Markdown format directly in your conversational response. \n"
            "Whenever the user asks to create, modify, or format a slide, you MUST ONLY use the provided tools (e.g. `UpdateSlide`). \n"
            "Your text response should only be brief conversational acknowledgement (e.g., '收到，我这就为您翻新第三页内容。', '没问题，即将为您生成整套课件。')."
        ))
    ]
    
    if rag_context:
        messages.append(SystemMessage(content=f"【当前备课空间已挂载了如下知识库原文档片段，回答时请深度结合以下切片进行研判】：\n{rag_context}"))
    
    for msg in messages_history:
        if msg.role == "user":
            messages.append(HumanMessage(content=msg.content))
        else:
            messages.append(AIMessage(content=msg.content))
            
    messages.append(HumanMessage(content=new_user_input))
    
    full_response = AIMessageChunk(content="")
    
    try:
        async for chunk in llm_with_tools.astream(messages):
            full_response += chunk
            if chunk.content:
                data = json.dumps({"event_type": "text", "chunk": chunk.content, "is_finished": False}, ensure_ascii=False)
                yield f"data: {data}\n\n"
    except Exception as e:
        logger.error(f"LLM Streaming error: {e}")
        pass

    extracted_intent = ""
    # 拦截处理完毕的 Tool Calls
    if full_response.tool_calls:
        for tool_call in full_response.tool_calls:
            t_name = tool_call["name"].lower()
            t_args = tool_call["args"]
            
            # 向前端抛出 Tool Call 指令进行 Loading 等交互
            tc_data = json.dumps({
                "event_type": "tool_call",
                "tool_call": {
                    "tool_name": t_name,
                    "arguments": t_args
                },
                "is_finished": False
            }, ensure_ascii=False)
            yield f"data: {tc_data}\n\n"
            
            # 后端执行业务逻辑
            should_refetch = False
            if t_name in ["generatefullppt", "generate_full_ppt"]:
                extracted_intent = "generate_courseware"
            elif t_name in ["updateslide", "update_slide", "addslide", "add_slide", "deleteslide", "delete_slide"]:
                should_refetch = True
                try:
                    from app.db.session import SessionLocal
                    from app.models.session import Courseware
                    db_local = SessionLocal()
                    cw = db_local.query(Courseware).filter(Courseware.session_id == session_id).first()
                    if cw and cw.ppt_data and cw.ppt_data.get('ppt_data'):
                        slides = cw.ppt_data.get('ppt_data')
                        if t_name in ["updateslide", "update_slide"]:
                            idx = t_args.get("page_index", 1) - 1
                            if 0 <= idx < len(slides):
                                slides[idx]["content"] = t_args.get("new_content", "")
                        elif t_name in ["addslide", "add_slide"]:
                            idx = t_args.get("insert_after_index", 0)
                            new_slide = {
                                "page_index": idx + 1,
                                "layout": "content",
                                "title": "新增页",
                                "content": t_args.get("content", "")
                            }
                            slides.insert(idx, new_slide)
                            # resync index
                            for i, s in enumerate(slides):
                                s["page_index"] = i + 1
                        elif t_name in ["deleteslide", "delete_slide"]:
                            idx = t_args.get("page_index", 1) - 1
                            if 0 <= idx < len(slides):
                                slides.pop(idx)
                                for i, s in enumerate(slides):
                                    s["page_index"] = i + 1
                        
                        cw.ppt_data['ppt_data'] = slides
                        # SqlAlchemy 判定 JSON 变更需赋值触发
                        cw.ppt_data = cw.ppt_data.copy()
                        db_local.commit()
                except Exception as e:
                    logger.error(f"Tool Execute Error: {e}")
                finally:
                    # ignore error, close local DB
                    if 'db_local' in locals():
                        db_local.close()

            # 向前端抛出 Tool Result 指令
            tr_data = json.dumps({
                "event_type": "tool_result",
                "tool_result": {
                    "tool_name": t_name,
                    "status": "success",
                    "should_refetch_ppt": should_refetch
                },
                "is_finished": False
            }, ensure_ascii=False)
            yield f"data: {tr_data}\n\n"

    # 若未命中生成意图，则增加兜底启发式正则检测（兼容不支持tool的模型模式）
    if not extracted_intent:
        user_text = new_user_input.lower()
        if ("生成" in user_text or "制作" in user_text) and ("ppt" in user_text or "课件" in user_text):
            extracted_intent = "generate_courseware"

    # 终止报文
    final_data = json.dumps({
        "event_type": "text", 
        "chunk": "", 
        "is_finished": True, 
        "extracted_intent": extracted_intent
    }, ensure_ascii=False)
    yield f"data: {final_data}\n\n"

