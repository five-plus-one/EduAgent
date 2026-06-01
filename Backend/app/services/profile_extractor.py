import json
import logging
from app.services.llm_service import call_llm_light

logger = logging.getLogger(__name__)

EXTRACTION_PROMPT_TEMPLATE = """你是一个教师偏好分析器。根据本轮对话，提取教师的教学偏好信号。

当前已知画像：
{current_profile}

本轮对话：
教师：{user_message}
AI：{assistant_reply}

请输出 JSON 格式的增量更新（只输出有新发现的字段，无新发现则返回空对象）：
{{
  "teaching_style_tags": ["新增的风格标签"],
  "preferences": {{"新增偏好key": "value"}},
  "subject_domains": ["新增领域"],
  "needs_summary": "用一句话概括教师本轮表达的核心需求"
}}

注意：
- 只提取教师明确表达或强烈暗示的偏好，不要推测
- teaching_style_tags 从以下选项中选取或新增：互动型、案例驱动、视觉化、严谨逻辑、启发式、项目驱动、翻转课堂、讲练结合
- preferences 的 key 应简洁明了，如 "ppt风格"、"布局偏好"、"页数偏好"、"配色偏好"、"内容深度"
- 如果教师否定了之前的某个偏好（如"不要简洁风格"），在 preferences 中标记
- 如果没有新的偏好信号，返回 {{}}
- 只输出 JSON，不要其他文字"""


async def extract_teacher_preferences(
    user_message: str,
    assistant_reply: str,
    current_profile: dict,
) -> dict:
    """用轻量 LLM 从本轮对话中提取教师偏好增量。"""
    prompt = EXTRACTION_PROMPT_TEMPLATE.format(
        current_profile=json.dumps(current_profile, ensure_ascii=False),
        user_message=user_message[:500],
        assistant_reply=assistant_reply[:500],
    )
    try:
        result = await call_llm_light(prompt)
        # 尝试提取 JSON（模型可能包裹在 ```json ``` 中）
        result = result.strip()
        if result.startswith("```"):
            result = result.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
        return json.loads(result)
    except Exception as e:
        logger.warning(f"[ProfileExtractor] Failed to parse: {e}")
        return {}


def merge_profile(base: dict, delta: dict) -> dict:
    """将增量偏好合并到已有画像，不覆盖已有值（除非 delta 明确否定）。"""
    merged = {
        "teaching_style_tags": list(base.get("teaching_style_tags", [])),
        "preferences": dict(base.get("preferences", {})),
        "subject_domains": list(base.get("subject_domains", [])),
        "needs_summary": base.get("needs_summary", ""),
    }

    # tags：去重追加
    if "teaching_style_tags" in delta and delta["teaching_style_tags"]:
        existing = set(merged["teaching_style_tags"])
        for tag in delta["teaching_style_tags"]:
            if isinstance(tag, str) and tag:
                existing.add(tag)
        merged["teaching_style_tags"] = list(existing)

    # preferences：增量覆盖
    if "preferences" in delta and delta["preferences"]:
        merged["preferences"].update(delta["preferences"])

    # domains：去重追加
    if "subject_domains" in delta and delta["subject_domains"]:
        existing = set(merged["subject_domains"])
        for d in delta["subject_domains"]:
            if isinstance(d, str) and d:
                existing.add(d)
        merged["subject_domains"] = list(existing)

    # needs_summary：直接覆盖
    if "needs_summary" in delta and delta["needs_summary"]:
        merged["needs_summary"] = delta["needs_summary"]

    return merged
