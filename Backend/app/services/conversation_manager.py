import logging
from app.services.llm_service import call_llm_light

logger = logging.getLogger(__name__)

HARD_LIMIT = 30       # 直接送入 LLM 的最大消息数
SUMMARY_THRESHOLD = 20  # 超过此数量时触发摘要

SUMMARY_PROMPT = """请用中文简洁概括以下对话的关键信息。

要求保留：
1. 教师表达的教学需求和偏好
2. 做出的重要决策（如确认了某个PPT方案）
3. 未完成的待办事项

对话内容：
{conversation_text}

已有摘要（如有）：
{existing_summary}

请输出合并后的摘要，200字以内。如果已有摘要，请在其基础上增量更新，不要丢失已有信息。
只输出摘要文本，不要其他文字。"""


def _format_messages_for_summary(messages: list) -> str:
    """将消息列表格式化为摘要用的纯文本。"""
    lines = []
    for msg in messages:
        role = "教师" if msg.role == "user" else "AI"
        content = msg.content[:500] + "..." if len(msg.content) > 500 else msg.content
        # 去除 think 标签
        import re
        content = re.sub(r"<think>.*?</think>", "", content, flags=re.DOTALL).strip()
        if content:
            lines.append(f"{role}：{content}")
    return "\n".join(lines)


async def generate_conversation_summary(
    messages_text: str,
    existing_summary: str | None = None,
) -> str:
    """生成或增量更新对话摘要。"""
    prompt = SUMMARY_PROMPT.format(
        conversation_text=messages_text,
        existing_summary=existing_summary or "无",
    )
    try:
        result = await call_llm_light(prompt)
        return result.strip()
    except Exception as e:
        logger.warning(f"[ConversationManager] Summary generation failed: {e}")
        return existing_summary or ""


async def prepare_messages_with_summary(
    db,
    session_id: str,
) -> tuple[list, str | None]:
    """
    准备消息列表，必要时生成摘要。
    返回 (messages, summary_or_none)。
    messages 已按时间正序排列。
    """
    from app.models.session import SessionContext, Message

    total_count = db.query(Message).filter(
        Message.session_id == session_id
    ).count()

    if total_count <= HARD_LIMIT:
        messages = db.query(Message).filter(
            Message.session_id == session_id
        ).order_by(Message.created_at.asc()).all()
        return messages, None

    # 需要压缩：取最早的消息做摘要
    cutoff = total_count - HARD_LIMIT
    old_messages = db.query(Message).filter(
        Message.session_id == session_id
    ).order_by(Message.created_at.asc()).limit(cutoff).all()

    session_ctx = db.query(SessionContext).get(session_id)
    old_summary = session_ctx.conversation_summary if session_ctx else None

    # 取旧消息的后 10 条做增量摘要
    chunk = old_messages[-10:] if len(old_messages) > 10 else old_messages
    new_summary = await generate_conversation_summary(
        _format_messages_for_summary(chunk),
        old_summary,
    )

    # 保存摘要
    if session_ctx and new_summary:
        session_ctx.conversation_summary = new_summary
        db.commit()

    # 返回最近的消息
    recent_messages = db.query(Message).filter(
        Message.session_id == session_id
    ).order_by(Message.created_at.asc()).offset(cutoff).all()

    return recent_messages, new_summary
