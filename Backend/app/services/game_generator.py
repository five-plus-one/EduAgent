"""
game_generator.py
─────────────────
Background task that uses the LLM to produce a self-contained HTML game.
Supports both first-time generation and subsequent refinements (version bumps).
"""
import os
import re
import json
import logging
import threading
import httpx
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

GAMES_DIR = os.path.join(os.getcwd(), "uploads", "games")
os.makedirs(GAMES_DIR, exist_ok=True)

# ── 实时代码块缓冲区（后台线程写，SSE监视器读）────────────────────────────────
# key: task_id → {"chunks": List[str], "done": bool, "failed": bool}
_task_chunks: dict = {}
_task_chunks_lock = threading.Lock()

# ── Game type → Chinese label + design hints ────────────────────────────────
GAME_TYPE_META = {
    "quiz":      {"label": "选择题闯关",   "hint": "10道四选一选择题，每题30秒倒计时，得分展示，答题动效"},
    "memory":    {"label": "记忆配对翻牌", "hint": "8对概念-解释配对翻牌，翻牌动画，移动次数计数"},
    "fillblank": {"label": "填空挑战",     "hint": "10道填空题，输入框，即时批改并高亮正误"},
    "sort":      {"label": "拖拽排序",     "hint": "6~8个步骤/事件，拖拽到正确顺序，提交检验"},
    "match":     {"label": "连线配对",     "hint": "左列概念→右列定义，点击左再点击右完成连线，动效"},
    "flashcard": {"label": "快问快答",     "hint": "单面问题→点击翻转→背面答案，循环15张，自评"},
    "custom":    {"label": "自定义游戏",   "hint": "完全按照教师要求实现，充分发挥创意"},
}

# ── System prompt for HTML game generation ──────────────────────────────────
_GAME_SYSTEM_PROMPT = """你是一位教学游戏开发专家，能够使用纯 HTML/CSS/JavaScript 实现精美、高度可交互的教学小游戏。

## 硬性约束（违反则游戏无法在沙盒中运行）
1. 只输出一个完整的 HTML 文件，从 <!DOCTYPE html> 开始，到 </html> 结束
2. 禁止引用任何外部资源——无 CDN、无外部字体 URL、无 API 调用
3. 所有样式写在 <style> 标签内，所有脚本写在 <script> 标签内
4. 游戏必须能在 <iframe sandbox="allow-scripts"> 中独立运行
5. 不要在 HTML 外输出任何 Markdown 文字或代码块标记（不要 ```html）

## 设计要求
- 现代美观的界面，建议使用深色学术主题或清新渐变主题
- 使用 CSS 动效增加趣味感（按钮悬停、答题反馈、完成动画）
- 界面文字全部使用中文，使用 system font 栈（避免外部字体）
- 支持移动端（弹性布局，触摸友好按钮）
- 游戏必须有明确的：开始界面 → 游戏中 → 结束/得分界面

## 输出格式
直接输出 HTML 代码，第一个字符必须是 <，最后一个字符必须是 >。"""


def _build_prompt(spec: dict, ppt_summary: str, existing_html: str = None) -> str:
    """Build the user-turn prompt for HTML generation or refinement."""
    game_type = spec.get("game_type", "quiz")
    title     = spec.get("title", "教学小游戏")
    topics    = spec.get("key_topics", [])
    custom    = spec.get("custom_requirements", "")
    meta      = GAME_TYPE_META.get(game_type, GAME_TYPE_META["custom"])

    topics_str = "、".join(topics) if topics else "（根据以下课件内容自动提取）"

    if existing_html:
        refinement_instr = spec.get("refinement_instruction", "根据教师最新要求改进")
        return (
            f"以下是当前版本的游戏 HTML 代码：\n\n{existing_html}\n\n"
            f"---\n"
            f"【修改要求】{refinement_instr}\n\n"
            f"【游戏基础信息】\n"
            f"- 类型：{meta['label']}（{game_type}）\n"
            f"- 标题：{title}\n"
            f"- 知识主题：{topics_str}\n\n"
            f"请在保留原有游戏结构的基础上，根据修改要求输出完整的新版 HTML 文件。"
        )

    prompt = (
        f"【课件内容摘要】\n{ppt_summary[:3000] if ppt_summary else '（无课件内容，请自行发挥）'}\n\n"
        f"---\n"
        f"【游戏生成要求】\n"
        f"- 游戏类型：{meta['label']}（{game_type}）\n"
        f"  ↳ 设计提示：{meta['hint']}\n"
        f"- 游戏标题：{title}\n"
        f"- 考察知识点：{topics_str}\n"
    )
    if custom:
        prompt += f"- 额外要求：{custom}\n"
    prompt += "\n请直接输出完整的 HTML 文件。"
    return prompt


def _extract_html(text: str) -> str:
    """Extract the HTML document from the LLM raw response."""
    # Try to find a proper doctype block
    m = re.search(r'(<!DOCTYPE html>.*</html>)', text, re.IGNORECASE | re.DOTALL)
    if m:
        return m.group(1).strip()
    # Fallback: extract everything between first < and last >
    start = text.find('<')
    end   = text.rfind('>')
    if start != -1 and end != -1 and end > start:
        return text[start:end + 1].strip()
    return text.strip()


def _ppt_summary(session_id: str) -> str:
    """Load and flatten courseware JSON into a concise text summary."""
    try:
        from app.db.session import SessionLocal
        from app.models.generation import Courseware
        db = SessionLocal()
        try:
            cw = db.query(Courseware).filter(Courseware.session_id == session_id).first()
            if not cw or not cw.ppt_data:
                return ""
            ppt_data = cw.ppt_data
            if isinstance(ppt_data, str):
                ppt_data = json.loads(ppt_data)
            slides = ppt_data.get("ppt_data", []) if isinstance(ppt_data, dict) else []
            lines = []
            for page in slides:
                lines.append(f"【{page.get('title', '')}】")
                for elem in page.get("elements", []):
                    for item in (elem.get("content") or []):
                        if isinstance(item, str) and item.strip():
                            lines.append(f"  - {item.strip()}")
            return "\n".join(lines)
        finally:
            db.close()
    except Exception as e:
        logger.warning(f"[game] failed to load ppt summary: {e}")
        return ""


def run_game_task(task_id: str, game_id: str, session_id: str, spec_json: dict):
    """
    Background task (polling fallback): generate a game HTML file non-streaming.

    只在 SSE 端点未接管时运行——通过原子 status 锁实现：
    - SSE 端点连接后会将 Game.status 从 'pending' 改为 'streaming'（<1 秒内）
    - 本任务等待 3 秒后检查状态，若非 'pending' 则退出，避免重复生成
    """
    import time
    from app.db.session import SessionLocal
    from app.models.generation import GenerationTask
    from app.models.game import Game
    from app.core.config import settings
    from sqlalchemy import update as sql_update

    # 不再等待 SSE——后台线程立即抢先认领，SSE 变为纯监视器

    db = SessionLocal()
    try:
        task = db.query(GenerationTask).filter(GenerationTask.id == task_id).first()
        game = db.query(Game).filter(Game.id == game_id).first()
        if not task or not game:
            return

        # 原子认领：只有 status == 'pending' 时才接管
        rows = db.execute(
            sql_update(Game)
            .where(Game.id == game_id, Game.status == "pending")
            .values(status="generating")
        ).rowcount
        db.commit()
        if rows == 0:
            # SSE 已经认领（streaming/generating/completed），静默退出
            logger.info(f"[game bg] task {task_id} skipped — SSE already claimed {game_id}")
            task.status = "skipped"
            db.commit()
            return

        task.stage    = "building_prompt"
        task.status   = "generating"
        task.progress = 10
        db.commit()

        # Load existing HTML if this is a refinement
        existing_html = None
        if spec_json.get("is_refinement") and game.html_file:
            html_path = os.path.join(GAMES_DIR, game.html_file)
            if os.path.exists(html_path):
                with open(html_path, encoding="utf-8") as f:
                    existing_html = f.read()

        ppt_summary = _ppt_summary(session_id)
        user_prompt = _build_prompt(spec_json, ppt_summary, existing_html)

        task.stage = "generating_html"
        task.progress = 30
        db.commit()

        headers_llm = {
            "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": settings.LLM_MODEL,
            "messages": [
                {"role": "system", "content": _GAME_SYSTEM_PROMPT},
                {"role": "user",   "content": user_prompt},
            ],
            "stream":     True,   # 流式：实时产出 chunk，SSE 可边生边推
            "max_tokens": 8192,
            "thinking":   {"type": "enabled", "budget_tokens": 2048},
        }
        base_url = settings.OPENAI_API_BASE.rstrip("/")
        ESTIMATED_CHARS = 9000

        # 初始化 chunk 缓冲区，SSE 监视器会从这里读
        with _task_chunks_lock:
            _task_chunks[task_id] = {"chunks": [], "done": False, "failed": False}

        full_text = ""
        task.stage    = "generating_html"
        task.progress = 15
        db.commit()

        with httpx.stream(
            "POST",
            f"{base_url}/chat/completions",
            headers=headers_llm,
            json=payload,
            timeout=httpx.Timeout(connect=10.0, read=300.0, write=10.0, pool=10.0),
        ) as stream_resp:
            stream_resp.raise_for_status()
            for raw_line in stream_resp.iter_lines():
                line = raw_line.strip()
                if not line or not line.startswith("data: "):
                    continue
                data_str = line[6:].strip()
                if data_str == "[DONE]":
                    break
                try:
                    chunk_data = json.loads(data_str)
                    delta = (
                        chunk_data.get("choices", [{}])[0]
                        .get("delta", {})
                    )
                    # ── 深度思考内容（reasoning_content / thinking） ──────────
                    reasoning = (
                        delta.get("reasoning_content")
                        or delta.get("thinking")
                        or ""
                    )
                    if reasoning:
                        with _task_chunks_lock:
                            # 思考内容以 dict 形式存储，区别于代码字符串
                            _task_chunks[task_id]["chunks"].append(
                                {"t": "thinking", "v": reasoning}
                            )

                    # ── 实际代码内容 ─────────────────────────────────────────
                    content = delta.get("content") or ""
                    if content:
                        full_text += content
                        with _task_chunks_lock:
                            _task_chunks[task_id]["chunks"].append(content)
                        # 更新进度（约每 500 char 更新一次，减少 DB 写次数）
                        if len(full_text) % 500 < len(content):
                            progress = min(15 + int(len(full_text) / ESTIMATED_CHARS * 70), 85)
                            task.progress = progress
                            db.commit()
                except Exception:
                    continue

        task.stage = "extracting_html"
        task.progress = 88
        db.commit()

        html_content = _extract_html(full_text)
        if len(html_content) < 200:
            raise ValueError("生成的 HTML 内容过短，可能生成失败")

        # 保存 HTML 文件
        filename = f"{game_id}.html"
        filepath = os.path.join(GAMES_DIR, filename)
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(html_content)

        # 更新 Game 记录
        game.html_file = filename
        game.status    = "completed"
        if spec_json.get("is_refinement"):
            game.version  += 1
            game.updated_at = datetime.now(timezone.utc)

        task.status   = "completed"
        task.progress = 100
        task.stage    = "done"
        task.result_data = {
            "game_id":   game_id,
            "html_file": filename,
            "version":   game.version,
        }
        db.commit()
        logger.info(f"[game] ✅ {game_id} v{game.version} generated ({len(html_content)} chars)")

        # 标记 chunk 流结束
        with _task_chunks_lock:
            if task_id in _task_chunks:
                _task_chunks[task_id]["done"] = True

        # 60 秒后清理缓冲区（给延迟重连的 SSE 客户端留时间）
        def _cleanup():
            import time as _t
            _t.sleep(60)
            with _task_chunks_lock:
                _task_chunks.pop(task_id, None)
        threading.Thread(target=_cleanup, daemon=True).start()

    except Exception as e:
        import traceback
        logger.error(f"[game] ❌ generation failed: {e}\n{traceback.format_exc()}")
        db2 = SessionLocal()
        try:
            task2 = db2.query(GenerationTask).filter(GenerationTask.id == task_id).first()
            game2 = db2.query(Game).filter(Game.id == game_id).first()
            if task2:
                task2.status      = "failed"
                task2.result_data = {"error": str(e)}
            if game2:
                orig_html = (spec_json or {}).get("_orig_html_file")
                if spec_json.get("is_refinement") and orig_html:
                    # 精炼失败 → 回滚旧版本，保住用户的数据
                    game2.status    = "completed"
                    game2.html_file = orig_html
                    game2.error     = str(e)
                    logger.info(f"[game] rolled back {game_id} → {orig_html}")
                else:
                    game2.status = "failed"
                    game2.error  = str(e)
            db2.commit()
        finally:
            db2.close()

    finally:
        db.close()
