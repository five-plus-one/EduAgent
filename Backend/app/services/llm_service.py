import json
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
from app.core.config import settings

def get_chat_llm():
    return ChatOpenAI(
        model=settings.LLM_MODEL,
        openai_api_base=settings.OPENAI_API_BASE,
        openai_api_key=settings.OPENAI_API_KEY,
        streaming=True,
        temperature=0.7
    )

async def stream_chat_response(messages_history: list, new_user_input: str):
    llm = get_chat_llm()
    messages = [
        SystemMessage(content=(
            "你是锐捷网络多模态AI互动式教学智能体。请通过自然、专业的语言引导老师完成课件设计。"
            "你需要理解老师的想法，主动询问不明晰的地方（如教学目标、时长、互动环节等），确认后整理出核心意图。"
            "你的回答应该简洁、结构化，以推动生成PPT或者教案为最终目的。"
        ))
    ]
    
    for msg in messages_history:
        if msg.role == "user":
            messages.append(HumanMessage(content=msg.content))
        else:
            messages.append(AIMessage(content=msg.content))
            
    messages.append(HumanMessage(content=new_user_input))
    
    # Generate Server-Sent Events (SSE) format response
    async for chunk in llm.astream(messages):
        if chunk.content:
            data = json.dumps({"chunk": chunk.content, "is_finished": False}, ensure_ascii=False)
            yield f"data: {data}\n\n"
    # Intent extraction heuristics for MCP (Frontend trigger)
    intent = ""
    user_text = new_user_input.lower()
    if ("生成" in user_text or "做一份" in user_text or "制作" in user_text) and ("ppt" in user_text or "课件" in user_text or "大纲" in user_text):
        intent = "generate_courseware"

    final_data = json.dumps({"chunk": "", "is_finished": True, "extracted_intent": intent}, ensure_ascii=False)
    yield f"data: {final_data}\n\n"
