import json
import logging
from app.services.llm_service import call_llm_light

logger = logging.getLogger(__name__)

INTENT_EXTRACTION_PROMPT = """你是一个教学意图分析器。根据对话内容，更新教学意图结构化快照。

当前意图快照：
{current_intent}

最近对话摘要：
{conversation_summary}

教师最新消息：{new_message}

请输出更新后的完整意图快照 JSON，结构如下：
{{
  "subject": "课程主题",
  "target_audience": "目标学生群体",
  "knowledge_points": ["知识点1", "知识点2"],
  "teaching_logic": "教学流程描述",
  "key_points": ["重点1"],
  "difficult_points": ["难点1"],
  "interaction_design": "互动设计",
  "duration": "时长",
  "output_format": "产出格式",
  "field_confidence": {{
    "subject": 0.0-1.0,
    "target_audience": 0.0-1.0,
    "knowledge_points": 0.0-1.0,
    "teaching_logic": 0.0-1.0,
    "key_points": 0.0-1.0,
    "difficult_points": 0.0-1.0,
    "interaction_design": 0.0-1.0,
    "duration": 0.0-1.0,
    "output_format": 0.0-1.0
  }}
}}

规则：
1. 保留已有信息，只更新/新增有变化的字段
2. field_confidence 表示该字段信息的明确程度（0=完全未知, 1=非常明确）
3. 如果教师否定了之前的某项理解，更新内容并提高 confidence
4. 新提及但不明确的信息，设较低 confidence（0.3-0.5）
5. 明确确认的信息设高 confidence（0.8-1.0）
6. 如果某个字段在对话中完全没有提及，保持原值和原 confidence
7. 只输出 JSON，不要其他文字"""


async def update_teaching_intent(
    current_intent: dict | None,
    new_message: str,
    conversation_summary: str | None,
) -> dict:
    """增量更新教学意图快照。"""
    prompt = INTENT_EXTRACTION_PROMPT.format(
        current_intent=json.dumps(current_intent or {}, ensure_ascii=False),
        conversation_summary=conversation_summary or "无",
        new_message=new_message[:500],
    )
    try:
        result = await call_llm_light(prompt)
        result = result.strip()
        if result.startswith("```"):
            result = result.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
        parsed = json.loads(result)
        # 基本校验
        if isinstance(parsed, dict) and "subject" in parsed:
            return parsed
        logger.warning("[IntentExtractor] Invalid response structure")
        return current_intent or {}
    except Exception as e:
        logger.warning(f"[IntentExtractor] Failed: {e}")
        return current_intent or {}
