import uuid
import os
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Request
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from app.api import deps
from app.models.user import User
from app.models.session import SessionContext
from app.models.generation import GenerationTask, Courseware
from app.schemas.generation import GenerateRequest, TaskResponse, TaskStatusResponse, CoursewarePreviewResponse, IterateRequest
from app.services.courseware_generator import run_generation_task, stream_generation
from app.services.ppt_exporter import run_export_task, EXPORT_DIR, PREMIUM_THEMES, LIGHT_THEME_KEYS
from app.services.word_exporter import markdown_to_docx

class IterateWordRequest(BaseModel):
    instruction: str
    selected_text: Optional[str] = None  # 当前选中的文字（可选，作为修改背景）


class ReplaceImageRequest(BaseModel):
    """ PATCH /sessions/{id}/courseware/slides/{page}/elements/{elem}/image 的请求体"""
    image_id: str  # 用户图片库中的 image_id


class ManualSlideEditRequest(BaseModel):
    """
    PUT /sessions/{id}/courseware/slides/{page_index} 的请求体。
    前端手动编辑对话框关闭时调用，将当前页的完整状态持久化到 DB。
    字段均可省略，只传实际改动了的部分。
    """
    title: Optional[str] = None                # 页面标题
    elements: Optional[list] = None            # 完整元素数组（全量替换）
    speaker_notes: Optional[str] = None        # 演讲者注记


class ApplyLayoutRequest(BaseModel):
    """
    POST /sessions/{id}/courseware/slides/{page_index}/apply-layout 的请求体。
    程序化地切换布局模板，不经过 AI（结果确定可靠）。
    """
    layout_type: str  # cover | minimal_list | two_column | stat_callout | timeline | full_content


class AddGameElemRequest(BaseModel):
    """
    POST /sessions/{id}/courseware/slides/{page_index}/elements/game 的请求体。
    game_id 和 game_url 必须至少提供一个。
    """
    game_id:  Optional[str] = None   # 会话内游戏的 game_id（game_xxxxxxxx）
    game_url: Optional[str] = None   # 任意游戏 URL（与 game_id 二选一）
    position: str = "full"           # element position，默认 full

router = APIRouter()

# ---------------- GENERATION ----------------

@router.post("/sessions/{session_id}/generate", response_model=TaskResponse)
def trigger_generation(
    session_id: str,
    body: GenerateRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db)
):
    session_ctx = db.query(SessionContext).filter(SessionContext.id == session_id, SessionContext.user_id == current_user.id).first()
    if not session_ctx:
        raise HTTPException(status_code=404, detail="Session not found")
        
    task_id = "gen_" + uuid.uuid4().hex[:8]
    task = GenerationTask(
        id=task_id,
        session_id=session_id,
        task_type="generate",
        status="generating",
        stage="init"
    )
    db.add(task)
    db.commit()
    
    background_tasks.add_task(run_generation_task, task_id, session_id, body.selected_file_ids, body.generation_mode)
    
    return {"task_id": task_id, "status": "generating"}

@router.post("/sessions/{session_id}/generate/stream")
def trigger_generation_stream(
    session_id: str,
    body: GenerateRequest,
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db)
):
    session_ctx = db.query(SessionContext).filter(SessionContext.id == session_id, SessionContext.user_id == current_user.id).first()
    if not session_ctx:
        raise HTTPException(status_code=404, detail="Session not found")
        
    # Clean up stale "generating" tasks (e.g. from a previous server session/crash)
    # so the user can always retry without hitting a phantom 409.
    stale_tasks = db.query(GenerationTask).filter(
        GenerationTask.session_id == session_id,
        GenerationTask.status == "generating",
        GenerationTask.task_type == "generate"
    ).all()
    for stale in stale_tasks:
        stale.status = "failed"
        stale.result_data = {"error": "Superseded by new generation request"}
    if stale_tasks:
        db.commit()
        
    sse_headers = {
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
        "Connection": "keep-alive",
    }
    
    return StreamingResponse(
        stream_generation(session_id, body.selected_file_ids, body.generation_mode, user_id=current_user.id), 
        media_type="text/event-stream", 
        headers=sse_headers
    )

@router.get("/generate/tasks/{task_id}", response_model=TaskStatusResponse)
def get_generation_status(
    task_id: str,
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db)
):
    task = db.query(GenerationTask).filter(GenerationTask.id == task_id, GenerationTask.task_type == "generate").first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    return {
        "status": task.status,
        "stage": task.stage,
        "progress": task.progress
    }

@router.get("/sessions/{session_id}/courseware/preview", response_model=CoursewarePreviewResponse)
def get_courseware_preview(
    session_id: str,
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db)
):
    cw = db.query(Courseware).filter(Courseware.session_id == session_id).first()
    if not cw or not cw.ppt_data:
        # 兼容性修复：流式生成中可能为空，不要报 404，返回空载体让前端渲染为 0页。
        return {"ppt_data": [], "word_markdown": ""}
        
    raw_data = cw.ppt_data
    if isinstance(raw_data, str):
        import json
        try:
            raw_data = json.loads(raw_data)
        except:
            raw_data = {}
            
    slides_array = raw_data.get("ppt_data", []) if isinstance(raw_data, dict) else raw_data
    if not isinstance(slides_array, list): slides_array = []
    
    theme_data = raw_data.get("theme") if isinstance(raw_data, dict) else None

    return {
        "ppt_data": slides_array,
        "word_markdown": cw.word_markdown or "",
        "theme": theme_data
    }

@router.post("/sessions/{session_id}/courseware/iterate")
def iterate_slide(
    session_id: str,
    body: IterateRequest,
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db)
):
    cw = db.query(Courseware).filter(Courseware.session_id == session_id).first()
    if not cw:
        raise HTTPException(status_code=404, detail="Courseware not found")
        
    import json as _json
    # BUG 3 FIX: SQLite may deserialize JSON column as a raw string in some environments
    cw_data_raw = cw.ppt_data
    if isinstance(cw_data_raw, str):
        try:
            cw_data_raw = _json.loads(cw_data_raw)
        except Exception:
            cw_data_raw = {}

    slides_array = cw_data_raw.get("ppt_data", []) if isinstance(cw_data_raw, dict) else cw_data_raw
    if not isinstance(slides_array, list):
        slides_array = []

    slides_array = list(slides_array)  # mutable copy
    page_to_update = next((p for p in slides_array if p.get("page_index") == body.page_index), None)
    if not page_to_update:
        raise HTTPException(status_code=404, detail="Page not found")

    import requests, json, re
    from app.core.config import settings
    from sqlalchemy.orm.attributes import flag_modified
    
    PAGE_SCHEMA = f"""
【单页数据结构要求】
如果只是修改该页内容，输出一个单独的 JSON 对象：
{{
  "page_index": {page_to_update['page_index']},
  "layout_type": "cover"|"minimal_list"|"two_column"|"stat_callout"|"timeline",
  "title": "（保持与原标题相同，除非用户明确要求修改标题）",
  "speaker_notes": "演讲者注记",
  "elements": [...]
}}

如果需要将该页拆为多页，则输出一个 JSON 数组，每页格式相同：
[
  {{ "page_index": {page_to_update['page_index']}, "title": "原标题（与原页相同）", ... }},
  {{ "page_index": {page_to_update['page_index'] + 1}, "title": "原标题（与原页相同，不要起名为\"新增页\"）", ... }}
]

【重要规则】
- 新增页的 title 必须与原始页标题「{page_to_update.get('title', '')}」保持相同，除非用户明确要求改标题
- content 必须是字符串数组，不能是单个字符串
- elements 必须至少包含 1 个元素
- 每个 element 必须有 element_id, type, position, content, is_accent 五个字段
- position: "left"|"right_top"|"right_bottom"|"center"|"full"
- type: "text_block"|"list"|"huge_number"|"subtitle"|"timeline_item"|"image"|"table"
  - 若 type 为 "image"：必须同时提供 "query"（图片搜索词，10-20字中文描述）和 "alt"（图注文字）
    示例: {{"type": "image", "query": "定轴转动刚体角速度角加速度示意图", "alt": "刚体定轴转动示意图", "element_id": "img_1", "content": [], "is_accent": false}}
  - 若 type 为 "table"：必须同时提供 "headers"（表头列名数组）和 "rows"（数据行二维数组），content 填 []
    示例: {{"type": "table", "headers": ["属性", "公式"], "rows": [["转动惯量", "$\\frac{{1}}{{2}}mR^2$"]], "element_id": "t_1", "position": "full", "content": [], "is_accent": false}}
- 严禁输出 Markdown 围栏、注释、额外文本
- **严禁**在 content 数组里放 Markdown 管道表格行（即 | 列A | 列B | ... | 这种格式），表格数据必须放在 headers/rows 字段

【数学公式规则 - 必须严格遵守】
- 所有数学公式、符号、方程必须使用 LaTeX 语法，用 $ ... $ 包裹
- 联立方程组必须使用 $\\begin{{cases}} x=x(t)\\\\ y=y(t)\\\\ z=z(t) \\end{{cases}}$ 格式，禁止用分号分隔
- 向量使用 $\\vec{{v}}$，分数使用 $\\frac{{a}}{{b}}$，极限使用 $\\lim_{{\\Delta t \\to 0}}$
- 上下标变量如 $a_n$, $v^2$, $\\omega_0$ 都必须用 $ ... $ 包裹
"""

    prompt = (
        "你是一位高级课件排版专家。请根据用户的「局部修改指令」，重新输出覆盖该单页PPT的内容。\n"
        "只输出合法的JSON对象或数组，不要带任何Markdown围栏或开场白！\n\n"
        "【原始该页数据 JSON】\n"
        + json.dumps(page_to_update, ensure_ascii=False, indent=2)
        + "\n\n【用户修改指令】\n"
        + body.instruction
        + "\n\n" + PAGE_SCHEMA
    )

    url = f"{settings.OPENAI_API_BASE.rstrip('/')}/chat/completions"
    headers = {"Authorization": f"Bearer {settings.OPENAI_API_KEY}", "Content-Type": "application/json"}
    payload = {
        "model": settings.LLM_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.3,
        "thinking": {"type": "disabled"}  # 关闭推理模式，单页修改用快速响应
    }

    try:
        resp = requests.post(url, headers=headers, json=payload, timeout=120)
        resp.raise_for_status()
        _resp_choices = resp.json().get("choices", [])
        if not _resp_choices or not isinstance(_resp_choices, list):
            raise HTTPException(status_code=500, detail="LLM 返回了空的 choices，请重试")
        llm_content = _resp_choices[0].get("message", {}).get("content", "")

        # 稳健 JSON 提取：raw_decode 将找到并解析第一个完整 JSON 对象
        llm_content = llm_content.strip()
        if llm_content.startswith("```"):
            llm_content = "\n".join(
                l for l in llm_content.splitlines() if not l.startswith("```")
            ).strip()

        # Fix invalid LaTeX escapes (like \vec, \frac) from LLM output
        def _escape_fixer(m):
            val = m.group(0)
            if val in ['\\"', '\\\\', '\\n'] or val.startswith('\\u'):
                return val
            return '\\\\' + val[1:]
        llm_content = re.sub(r'\\.', _escape_fixer, llm_content)

        # Support both single page JSON object and JSON array (page split)
        decoder = json.JSONDecoder()
        # Try array first (page split case)
        arr_start = llm_content.find("[")
        obj_start = llm_content.find("{")
        
        parsed_result = None
        if arr_start != -1 and (obj_start == -1 or arr_start < obj_start):
            try:
                parsed_result, _ = decoder.raw_decode(llm_content, arr_start)
            except json.JSONDecodeError:
                pass
        
        if parsed_result is None:
            start = obj_start if obj_start != -1 else -1
            if start == -1:
                raise HTTPException(status_code=500, detail="LLM 未返回 JSON 结构，请重试")
            try:
                parsed_result, _ = decoder.raw_decode(llm_content, start)
            except json.JSONDecodeError:
                json_match = re.search(r"\{[\s\S]*\}", llm_content)
                if not json_match:
                    raise HTTPException(status_code=500, detail="LLM 返回内容无法解析，请重试")
                parsed_result = json.loads(json_match.group(0))

        # Handle single page or multi-page (split) results
        if isinstance(parsed_result, list):
            # Page split: replace original with multiple pages, re-index all
            new_pages = parsed_result
            for i, p in enumerate(new_pages):
                p["page_index"] = page_to_update["page_index"] + i
                if not p.get("title"):
                    p["title"] = page_to_update.get("title", "")
            idx = next(i for i, p in enumerate(slides_array) if p.get("page_index") == body.page_index)
            slides_array = slides_array[:idx] + new_pages + slides_array[idx+1:]
            # Re-index all subsequent pages
            for i, p in enumerate(slides_array):
                p["page_index"] = i + 1
            new_page = new_pages[0]  # return first page for response
        else:
            new_page = parsed_result
            new_page["page_index"] = page_to_update["page_index"]  # 强制保持页码不变
            idx = next(i for i, p in enumerate(slides_array) if p.get("page_index") == body.page_index)
            slides_array[idx] = new_page

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"单页修改失败：{str(e)}")

    # ── 图片元素解析（与流式生成保持一致：无匹配则丢弃，有匹配则附加 resolved）──
    from app.services.image_service import search_image_by_query

    # 保存原始页面中用户手动替换的图片（resolved.source == "user"），
    # 迭代后若 AI 生成同 element_id 的图片元素，恢复用户替换，避免手动替换丢失。
    _user_resolved_by_id: dict = {}
    for _oe in page_to_update.get("elements", []):
        if _oe.get("type") == "image":
            _res = _oe.get("resolved") or {}
            if _res.get("source") == "user" and _res.get("image_id"):
                _user_resolved_by_id[_oe.get("element_id", "")] = _res

    def _parse_md_table(content_items: list):
        """
        尝试把 Markdown 管道表格（每行 | A | B | C |）解析为 (headers, rows)。
        成功返回 (list[str], list[list[str]])；失败返回 (None, None)。
        """
        import re as _re
        sep_re = _re.compile(r'^[\|\s:\-]+$')
        pipe_items = [str(c).strip() for c in content_items
                      if str(c).strip().startswith('|')]
        if not pipe_items:
            return None, None

        def _parse_row(row_str: str):
            return [c.strip() for c in row_str.strip().strip('|').split('|')]

        headers = None
        rows: list = []
        for row_str in pipe_items:
            inner = row_str.strip().strip('|')
            if sep_re.match(inner):          # 分隔行（:---:）直接跳过
                continue
            cells = _parse_row(row_str)
            cells = [c for c in cells if c]  # 去掉空格列
            if not cells:
                continue
            if headers is None:
                headers = cells
            else:
                rows.append(cells)
        if not headers:
            return None, None
        return headers, rows

    def _resolve_page_images(page: dict) -> dict:
        """对单页的 elements 做图片向量检索，过滤无匹配的 image 元素。
        对用户手动替换过的图片（source=user），优先恢复原 resolved，不重新检索。
        同时校验 table 元素必须包含合法的 headers 和 rows：
          - 若 AI 把表格数据放在 content（Markdown 管道格式），自动解析恢复
          - 若 type=list/text_block 且 content 全是管道行，转换为 type=table
          - 仍无法恢复的恶意格式才丢弃
        """
        import logging as _log
        filtered = []
        for elem in page.get("elements", []):
            etype = elem.get("type", "")

            if etype == "image":
                eid = elem.get("element_id", "")
                # 1. 优先恢复用户手动替换（element_id 匹配）
                if eid and eid in _user_resolved_by_id:
                    elem["resolved"] = _user_resolved_by_id[eid]
                    filtered.append(elem)
                    continue
                # 2. 向量检索
                query = elem.get("query", "") or elem.get("alt", "")
                if not query:
                    continue  # 无搜索词 → 丢弃
                try:
                    resolved = search_image_by_query(query, current_user.id)
                except Exception:
                    resolved = None
                if resolved is not None:
                    elem["resolved"] = resolved
                    filtered.append(elem)
                # 无匹配 → 丢弃

            elif etype == "table":
                headers = elem.get("headers")
                rows    = elem.get("rows")
                # 情况 A：正常 table（有 headers 和 rows）
                if isinstance(headers, list) and headers and isinstance(rows, list) and rows:
                    elem["content"] = []
                    filtered.append(elem)
                    continue
                # 情况 B：AI 把表格数据放进了 content（Markdown 格式）
                content = elem.get("content") or []
                parsed_h, parsed_r = _parse_md_table(content)
                if parsed_h:
                    elem["headers"] = parsed_h
                    elem["rows"]    = parsed_r or []
                    elem["content"] = []
                    _log.info(f"[iterate] recovered table from content markdown: eid={elem.get('element_id','?')}")
                    filtered.append(elem)
                else:
                    _log.warning(f"[iterate] dropped unrecoverable table: eid={elem.get('element_id','?')}")
                    # 丢弃

            elif etype in ("list", "text_block", "text"):
                # 情况 C：AI 误用 list/text_block 存储 Markdown 管道表格
                content = elem.get("content") or []
                pipe_cnt = sum(1 for c in content if str(c).strip().startswith('|'))
                if content and pipe_cnt >= len(content) * 0.7:  # 70%+ 是管道行
                    parsed_h, parsed_r = _parse_md_table(content)
                    if parsed_h:
                        elem["type"]    = "table"
                        elem["headers"] = parsed_h
                        elem["rows"]    = parsed_r or []
                        elem["content"] = []
                        _log.info(f"[iterate] converted {etype} to table (markdown content): eid={elem.get('element_id','?')}")
                        filtered.append(elem)
                        continue
                # 正常 list/text_block 直接保留
                filtered.append(elem)

            else:
                filtered.append(elem)

        page["elements"] = filtered
        return page

    # 对所有受影响的新页面做图片解析
    if isinstance(parsed_result, list):
        slides_array_pages = [p for p in slides_array if any(
            p.get("page_index") == np.get("page_index") for np in parsed_result
        )]
        for page in slides_array:
            pi = page.get("page_index")
            if any(pi == np.get("page_index") for np in parsed_result):
                _resolve_page_images(page)
        new_page = _resolve_page_images(new_page)
    else:
        _resolve_page_images(new_page)
        if new_page in slides_array:
            pass  # already modified in-place
        else:
            idx2 = next((i for i, p in enumerate(slides_array) if p.get("page_index") == new_page.get("page_index")), None)
            if idx2 is not None:
                slides_array[idx2] = new_page

    # 用 flag_modified 强制触发 SQLAlchemy JSON 变更检测
    new_data = dict(cw_data_raw) if isinstance(cw_data_raw, dict) else {}
    new_data["ppt_data"] = slides_array
    cw.ppt_data = new_data
    flag_modified(cw, "ppt_data")
    db.commit()
    db.refresh(cw)
    # Return all updated pages (frontend will refresh all slides)
    return {"updated_pages": slides_array, "page": new_page}

# ---- 主题列表 ----

# 主题中文标签表
_THEME_LABELS = {
    "modern_minimalist": "极简现代",
    "sunset_boulevard":  "落日大道",
    "golden_hour":       "黄金时刻",
    "forest_canopy":     "森林林冠",
    "desert_rose":       "沙漠玫瑰",
    "arctic_frost":      "北极霜雪",
    "ocean_depths":      "深海蓝",
    "cyber_neon":        "赛博霍光",
    "midnight_galaxy":   "星河宇宙",
    "botanical_garden":  "菲翠花园",
}

@router.get("/export/themes")
def get_export_themes():
    """
    返回所有可用的 PPT 主题列表，供前端选色 UI 展示。
    每个主题包含：键名、中文标签、背景色、主色、辅助色、强调色、文字色。
    前端选色器和预览渲染均可直接使用这些颜色。
    """
    themes = []
    for key, val in PREMIUM_THEMES.items():
        themes.append({
            "key":        key,
            "label":      _THEME_LABELS.get(key, key),
            "category":   "light" if key in LIGHT_THEME_KEYS else "dark",
            "bg_color":   val["bg_color"],
            "primary":    val["primary"],
            "secondary":  val["secondary"],
            "accent":     val["accent"],
            "text_color": val["text_color"],
        })
    return {"themes": themes}


# ---- 导出触发 ----

class ExportRequest(BaseModel):
    theme_key:     Optional[str]  = None  # 不传 → 用会话主题 or 自动
    custom_colors: Optional[dict] = None  # 自定义颜色（覆盖 theme_key）

@router.post("/sessions/{session_id}/export")
def trigger_export(
    session_id: str,
    background_tasks: BackgroundTasks,
    body: ExportRequest = None,
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db)
):
    """触发 PPT 导出任务。
    主题优先级：请求体 theme_key → 会话已保存主题 → 后端哈希自动选择。
    """
    session_ctx = db.query(SessionContext).filter(
        SessionContext.id == session_id,
        SessionContext.user_id == current_user.id,
    ).first()
    if not session_ctx:
        raise HTTPException(status_code=404, detail="Session not found")

    # ── 主题三级优先级 ──────────────────────────────────────────────────────
    # 1) 请求体显式传入
    theme_key     = (body.theme_key     if body else None) or None
    custom_colors = (body.custom_colors if body else None) or None

    # 2) fallback：会话保存的主题偏好
    if theme_key is None and custom_colors is None:
        import json as _j
        saved_key    = session_ctx.ppt_theme_key
        saved_custom = session_ctx.ppt_custom_colors
        if isinstance(saved_custom, str):
            try:
                saved_custom = _j.loads(saved_custom)
            except Exception:
                saved_custom = None
        theme_key     = saved_key
        custom_colors = saved_custom

    # 3) 若均无，run_export_task 内部按 session_id 哈希自动选色（已有逻辑）

    task_id = "exp_" + uuid.uuid4().hex[:8]
    task = GenerationTask(
        id=task_id,
        session_id=session_id,
        task_type="export",
        status="generating",
        stage="init"
    )
    db.add(task)
    db.commit()

    background_tasks.add_task(run_export_task, task_id, session_id, theme_key, custom_colors)
    return {"task_id": task_id, "status": "generating", "theme_key": theme_key}

@router.get("/export/tasks/{task_id}")
def get_export_status(
    task_id: str,
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db)
):
    task = db.query(GenerationTask).filter(GenerationTask.id == task_id, GenerationTask.task_type == "export").first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
        
    return {
        "status": task.status,
        "stage": task.stage,
        "progress": task.progress,
        "download_urls": task.result_data.get("download_urls") if task.result_data else None,
        "filename": task.result_data.get("filename") if task.result_data else None,
        "error": task.result_data.get("error") if task.result_data else None
    }
    
@router.get("/export/download/{filename}")
def download_export(filename: str):
    file_path = os.path.join(EXPORT_DIR, filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")
    # 根据文件后缀选择 MIME 类型
    if filename.endswith(".docx"):
        media_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    else:
        media_type = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    return FileResponse(file_path, filename=filename, media_type=media_type)


# ---------------- WORD ITERATE ----------------

@router.post("/sessions/{session_id}/courseware/iterate-word")
def iterate_word(
    session_id: str,
    body: IterateWordRequest,
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db)
):
    """根据用户指令对课件订 word_markdown 进行智能修订，将新内容存入 DB 并返回。"""
    import json
    import re
    import requests
    from app.core.config import settings
    from sqlalchemy.orm.attributes import flag_modified

    cw = db.query(Courseware).filter(Courseware.session_id == session_id).first()
    if not cw:
        raise HTTPException(status_code=404, detail="Courseware not found")

    current_markdown = cw.word_markdown or ""
    if not current_markdown.strip():
        raise HTTPException(status_code=400, detail="讲义内容为空，请先生成课件")

    # 构建修改 Prompt
    selected_hint = ""
    if body.selected_text:
        selected_hint = f"\n\n【用户库选中的文字（修改重点）】\n{body.selected_text[:500]}"

    prompt = (
        "你是一价高级教育内容编辑少少。请根据用户指令对以下 Markdown 格式的课件讲义进行修订。\n"
        "【重要】只输出修改后的完整 Markdown 文本，不要包含任何开场白或围栏。\n\n"
        f"【原始讲义文本】\n{current_markdown}\n\n"
        f"【用户修改指令】\n{body.instruction}"
        + selected_hint
    )

    url = f"{settings.OPENAI_API_BASE.rstrip('/')}/chat/completions"
    headers = {"Authorization": f"Bearer {settings.OPENAI_API_KEY}", "Content-Type": "application/json"}
    payload = {
        "model": settings.LLM_MODEL,
        "messages": [
            {"role": "system", "content": "你是一个専业的教育内容编辑器。根据用户修改要求精确修订 Markdown 讲义，保持整体结构不变化。不要输出任何开场白、引言或 markdown 围栏。分隔线必须使用 ***，禁止使用 ---。"},
            {"role": "user", "content": prompt}
        ],
        "temperature": 0.3,
        "thinking": {"type": "disabled"}
    }

    try:
        resp = requests.post(url, headers=headers, json=payload, timeout=180)
        resp.raise_for_status()
        choices = resp.json().get("choices", [])
        if not choices:
            raise HTTPException(status_code=500, detail="LLM 返回了空的 choices")
        new_markdown = choices[0].get("message", {}).get("content", "")
        # 去除可能的 markdown 围栏
        new_markdown = re.sub(r"^```[a-z]*\n?", "", new_markdown.strip(), flags=re.MULTILINE)
        new_markdown = re.sub(r"```$", "", new_markdown.strip(), flags=re.MULTILINE).strip()
        # 将所有单行 "---" 分隔线替换为 "***"
        new_markdown = re.sub(r"(?m)^-{3,}\s*$", "***", new_markdown)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"讲义修订失败：{str(e)}")

    # 存入 DB
    cw.word_markdown = new_markdown
    flag_modified(cw, "word_markdown")
    db.commit()
    db.refresh(cw)

    return {"word_markdown": new_markdown}

# ──────────────────────────────────────────────────────────────────────────────
# 讲义直存：PUT /sessions/{id}/courseware/word
# ──────────────────────────────────────────────────────────────────────────────

class SaveWordRequest(BaseModel):
    """讲义手动保存请求体"""
    word_markdown: str


@router.put("/sessions/{session_id}/courseware/word")
def save_word_content(
    session_id: str,
    body: SaveWordRequest,
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db),
):
    """
    讲义直存接口——前端编辑模式保存使用。

    不过 AI，直接将 word_markdown 内容写入 DB。
    内容中所有 --- 分隔线自动替换为 ***。
    导出 word 时 word_exporter 直接读取已存储的 word_markdown，无需额外处理。
    """
    import re as _re
    from sqlalchemy.orm.attributes import flag_modified

    # 1. 验证会话归属
    session_ctx = db.query(SessionContext).filter(
        SessionContext.id == session_id,
        SessionContext.user_id == current_user.id
    ).first()
    if not session_ctx:
        raise HTTPException(status_code=404, detail="Session not found")

    # 2. 加载课件
    cw = db.query(Courseware).filter(Courseware.session_id == session_id).first()
    if not cw:
        raise HTTPException(status_code=404, detail="Courseware not found")

    # 3. 规范化分隔线 --- → ***
    content = body.word_markdown
    content = _re.sub(r"(?m)^-{3,}\s*$", "***", content)

    # 4. 写入 DB
    cw.word_markdown = content
    flag_modified(cw, "word_markdown")
    db.commit()

    return {"word_markdown": content}


# ---------------- WORD DOCX EXPORT ----------------

@router.get("/sessions/{session_id}/courseware/export-word")
def export_word_docx(
    session_id: str,
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db)
):
    """将当前会话的 word_markdown 导出为标准 .docx 文件并返回下载。"""
    cw = db.query(Courseware).filter(Courseware.session_id == session_id).first()
    if not cw:
        raise HTTPException(status_code=404, detail="Courseware not found")
    if not cw.word_markdown or not cw.word_markdown.strip():
        raise HTTPException(status_code=404, detail="讲义内容为空，请先生成课件")

    # 取课程名称作标题
    session_ctx = db.query(SessionContext).filter(SessionContext.id == session_id).first()
    doc_title = getattr(session_ctx, "course_name", "") or "课件讲义"

    filename = f"EduAgent_讲义_{session_id[:8]}.docx"
    output_path = os.path.join(EXPORT_DIR, filename)
    os.makedirs(EXPORT_DIR, exist_ok=True)

    try:
        markdown_to_docx(cw.word_markdown, output_path, title=doc_title)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f".docx 生成失败：{str(e)}")

    return FileResponse(
        output_path,
        filename=filename,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )


# ──────────────────────────────────────────────────────────────────────────────
# 图片替换：PATCH /sessions/{id}/courseware/slides/{page}/elements/{elem}/image
# ──────────────────────────────────────────────────────────────────────────────

@router.patch("/sessions/{session_id}/courseware/slides/{page_index}/elements/{element_id}/image")
def replace_slide_image(
    session_id: str,
    page_index: int,
    element_id: str,
    body: ReplaceImageRequest,
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db),
):
    """
    替换 PPT 某一页某一图片元素的图源。

    效果：更新数据库中该 element 的 resolved 字段为指定用户图片。
    - 预览：前端立即用返回的 preview_url 刷新预览显示
    - 导出 PPT：ppt_exporter 已根据 resolved.image_id 读取本地文件  ✅
    - 导出 Word：word_exporter 不包含图片（讲义文本），无需处理

    权限验证：
    - session_id 必须属于当前用户
    - image_id 必须属于当前用户的图片库
    """
    from sqlalchemy.orm.attributes import flag_modified
    from app.models.image import UserImage

    # 1. 验证会话归属当前用户
    session_ctx = db.query(SessionContext).filter(
        SessionContext.id == session_id,
        SessionContext.user_id == current_user.id
    ).first()
    if not session_ctx:
        raise HTTPException(status_code=404, detail="Session not found")

    # 2. 验证目标图片属于当前用户
    img = db.query(UserImage).filter(
        UserImage.id == body.image_id,
        UserImage.user_id == current_user.id
    ).first()
    if not img:
        raise HTTPException(status_code=404, detail="Image not found in your library")

    # 3. 加载课件数据
    cw = db.query(Courseware).filter(Courseware.session_id == session_id).first()
    if not cw or not cw.ppt_data:
        raise HTTPException(status_code=404, detail="No courseware found for this session")

    cw_data = cw.ppt_data if isinstance(cw.ppt_data, dict) else {}
    slides: list = cw_data.get("ppt_data", [])

    # 4. 定位目标页面
    slide = next((s for s in slides if s.get("page_index") == page_index), None)
    if not slide:
        raise HTTPException(status_code=404, detail=f"Slide {page_index} not found")

    # 5. 定位目标元素
    element = next(
        (e for e in slide.get("elements", []) if e.get("element_id") == element_id),
        None
    )
    if not element:
        raise HTTPException(status_code=404, detail=f"Element '{element_id}' not found on slide {page_index}")
    if element.get("type") != "image":
        raise HTTPException(status_code=400, detail="Target element is not an image type")

    # 6. 更新 resolved 字段
    preview_url = f"/api/v1/users/me/images/{body.image_id}/preview"
    element["resolved"] = {
        "image_id": body.image_id,
        "preview_url": preview_url,
        "source": "user",   # UserImage 表（用户个人素材库）；"library" 是管理员公共库
    }

    # 7. 强制触发 SQLAlchemy JSON 变更检测并提交
    new_data = dict(cw_data)
    new_data["ppt_data"] = slides
    cw.ppt_data = new_data
    flag_modified(cw, "ppt_data")
    db.commit()

    import logging as _logging
    _logging.getLogger(__name__).info(
        f"[replace_slide_image] session={session_id} page={page_index} "
        f"element={element_id} -> image_id={body.image_id} committed OK"
    )

    return {
        "element_id": element_id,
        "page_index": page_index,
        "image_id": body.image_id,
        "preview_url": preview_url,
    }


# ──────────────────────────────────────────────────────────────────────────────
# 手动编辑单页保存：PUT /sessions/{id}/courseware/slides/{page_index}
# ──────────────────────────────────────────────────────────────────────────────

@router.put("/sessions/{session_id}/courseware/slides/{page_index}")
def save_manual_slide_edit(
    session_id: str,
    page_index: int,
    body: ManualSlideEditRequest,
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db),
):
    """
    手动编辑单页并保存到 DB。

    前端在手动编辑对话框中修改标题 / 内容块 / 演讲者注记后，
    关闭对话框前调用此接口将最新状态写入 DB。
    后续导出 PPT 时 ppt_exporter 直接读取已存储的 elements，无需额外处理。

    - title        : 更新页标题（可选）
    - elements     : 全量替换当前页元素（可选，不传则保持原元素不变）
    - speaker_notes: 演讲者注记（可选）

    图片元素的 resolved 字段会被自动保留，防止手动编辑时丢失已替换的图片信息。
    """
    from sqlalchemy.orm.attributes import flag_modified
    import json as _json

    # 1. 验证会话归属当前用户
    session_ctx = db.query(SessionContext).filter(
        SessionContext.id == session_id,
        SessionContext.user_id == current_user.id
    ).first()
    if not session_ctx:
        raise HTTPException(status_code=404, detail="Session not found")

    # 2. 加载课件
    cw = db.query(Courseware).filter(Courseware.session_id == session_id).first()
    if not cw or not cw.ppt_data:
        raise HTTPException(status_code=404, detail="No courseware found for this session")

    cw_data = cw.ppt_data
    if isinstance(cw_data, str):
        try:
            cw_data = _json.loads(cw_data)
        except Exception:
            cw_data = {}
    if not isinstance(cw_data, dict):
        cw_data = {}

    slides: list = list(cw_data.get("ppt_data", []))

    # 3. 定位目标页
    idx = next((i for i, s in enumerate(slides) if s.get("page_index") == page_index), None)
    if idx is None:
        raise HTTPException(status_code=404, detail=f"Slide {page_index} not found")

    slide = dict(slides[idx])  # shallow copy

    # 4. 应用修改（仅更新已传入的字段）
    if body.title is not None:
        slide["title"] = body.title

    if body.elements is not None:
        # 保留原图片元素的 resolved 字段，防止手动编辑时丢失已替换的图片
        # NOTE: resolved 只能通过 PATCH /elements/{id}/image 修改。
        #       前端 fromEditable() 会把 _raw.resolved（可能是旧值）一并 spread 进来，
        #       所以这里必须始终用 DB 当前的 resolved 覆盖前端发来的值，而不是仅在"not in elem"时才回填。
        old_resolved: dict = {
            e["element_id"]: e.get("resolved")
            for e in slide.get("elements", [])
            if e.get("type") == "image"
        }
        new_elements = []
        for elem in body.elements:
            elem = dict(elem)
            # 确保每个 element 有 element_id
            if not elem.get("element_id"):
                import uuid as _uuid
                elem["element_id"] = f"e_{_uuid.uuid4().hex[:8]}"
            # 图片元素：resolved 字段始终以 DB 当前值为准（忽略前端发来的 resolved）
            if elem.get("type") == "image":
                db_res = old_resolved.get(elem["element_id"])
                if db_res:
                    elem["resolved"] = db_res          # 用 DB 中已替换的图片信息
                elif "resolved" in elem:
                    del elem["resolved"]               # 移除前端带来的过时 resolved
            new_elements.append(elem)
        slide["elements"] = new_elements


    if body.speaker_notes is not None:
        slide["speaker_notes"] = body.speaker_notes

    slides[idx] = slide

    # 5. 强制触发 SQLAlchemy JSON 变更检测并提交
    new_data = dict(cw_data)
    new_data["ppt_data"] = slides
    cw.ppt_data = new_data
    flag_modified(cw, "ppt_data")
    db.commit()

    return {
        "page_index": page_index,
        "slide": slide,
    }


# ──────────────────────────────────────────────────────────────────────────────
# 布局模板切换：POST /sessions/{id}/courseware/slides/{page_index}/apply-layout
# ──────────────────────────────────────────────────────────────────────────────

# 布局 → element position 分配规则
#
# ppt_exporter.render_two_column: 按 position 字段分栏（含 "left" → 左，含 "right" → 右）
# ppt_exporter.render_minimal_list: 按 type 分区（image → 右，其他 → 左），不看 position
# 其他布局：不看 position，按 elements 顺序渲染

SUPPORTED_LAYOUTS = {"cover", "minimal_list", "two_column",
                     "stat_callout", "timeline", "full_content"}
# 不支持的布局映射到最接近的支持布局
LAYOUT_ALIAS = {
    "standard":      "minimal_list",
    "image_gallery": "two_column",
    "full_content":  "minimal_list",
    "card_grid":     "minimal_list",
    "title_slide":   "cover",
}


def _reassign_positions(elements: list, layout_type: str) -> list:
    """
    根据目标布局重新分配元素的 position 字段。

    two_column:
      image 元素 → right_{top|mid|bottom}
      其他元素 → left_{top|mid|bottom}
    cover:
      第一个 subtitle/text_block → subtitle，其他左居中
    其他布局：不调整 position（exporter 按 type 分区，使用现有字段即可）
    """
    if not elements:
        return elements

    # 不修改 position 的布局（exporter 按 type 分区， position 不影响结果）
    if layout_type in ("minimal_list", "stat_callout", "timeline",
                      "full_content", "cover"):
        return elements

    # two_column: image 元素 → right，table 元素 → full（保持全宽），其他 → left
    if layout_type == "two_column":
        img_elems   = [e for e in elements if e.get("type") == "image"]
        tbl_elems   = [e for e in elements if e.get("type") == "table"]
        text_elems  = [e for e in elements
                       if e.get("type") not in ("image", "table")]

        # position slot names: top/mid/bottom 连续分配
        def _position_slots(prefix: str, n: int) -> list:
            if n == 1:
                return [f"{prefix}"]
            if n == 2:
                return [f"{prefix}_top", f"{prefix}_bottom"]
            return [f"{prefix}_top"] + [f"{prefix}_mid"] * (n - 2) + [f"{prefix}_bottom"]

        for e, pos in zip(text_elems, _position_slots("left", max(len(text_elems), 1))):
            e["position"] = pos
        for e, pos in zip(img_elems, _position_slots("right", max(len(img_elems), 1))):
            e["position"] = pos
        # Table elements keep "full" so render_two_column places them at full width
        for e in tbl_elems:
            e["position"] = "full"

        # 如果没有图片元素，把最后一个文字元素放右列作占位
        if not img_elems and len(text_elems) >= 2:
            half = len(text_elems) // 2
            for i, e in enumerate(text_elems):
                e["position"] = "left" if i < half else "right"

        return elements

    return elements  # 满足未知布局


@router.post("/sessions/{session_id}/courseware/slides/{page_index}/apply-layout")
def apply_layout_template(
    session_id: str,
    page_index: int,
    body: ApplyLayoutRequest,
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db),
):
    """
    程序化切换单页布局模板，不过 AI。

    操作：
    1. 把 layout_type 改为目标布局
    2. 按布局规则重新分配 elements 的 position 字段
    3. 写入 DB（导出 PPT 时 ppt_exporter 直接读取已存储数据）

    ppt_exporter 支持的布局（其他会自动映射到最接近的）：
      cover | minimal_list | two_column | stat_callout | timeline
    """
    from sqlalchemy.orm.attributes import flag_modified
    import json as _json

    # 1. 验证会话
    session_ctx = db.query(SessionContext).filter(
        SessionContext.id == session_id,
        SessionContext.user_id == current_user.id
    ).first()
    if not session_ctx:
        raise HTTPException(status_code=404, detail="Session not found")

    # 2. 加载课件
    cw = db.query(Courseware).filter(Courseware.session_id == session_id).first()
    if not cw or not cw.ppt_data:
        raise HTTPException(status_code=404, detail="No courseware found for this session")

    cw_data = cw.ppt_data
    if isinstance(cw_data, str):
        try:
            cw_data = _json.loads(cw_data)
        except Exception:
            cw_data = {}
    if not isinstance(cw_data, dict):
        cw_data = {}

    slides: list = list(cw_data.get("ppt_data", []))

    # 3. 定位目标页
    idx = next((i for i, s in enumerate(slides) if s.get("page_index") == page_index), None)
    if idx is None:
        raise HTTPException(status_code=404, detail=f"Slide {page_index} not found")

    slide = dict(slides[idx])

    # 4. 布局映射（不支持的映射到最接近的）
    target_layout = LAYOUT_ALIAS.get(body.layout_type, body.layout_type)
    if target_layout not in SUPPORTED_LAYOUTS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported layout_type: {body.layout_type}. "
                   f"Supported: {sorted(SUPPORTED_LAYOUTS | set(LAYOUT_ALIAS.keys()))}"
        )

    # 5. 应用布局：修改布局类型 + 重分配 positions
    slide["layout_type"] = target_layout
    elements = list(slide.get("elements", []))
    slide["elements"] = _reassign_positions(elements, target_layout)

    slides[idx] = slide

    # 6. 写入 DB
    new_data = dict(cw_data)
    new_data["ppt_data"] = slides
    cw.ppt_data = new_data
    flag_modified(cw, "ppt_data")
    db.commit()

    return {
        "page_index": page_index,
        "layout_type": target_layout,         # 实际应用的布局（可能已被映射）
        "original_layout_type": body.layout_type,  # 前端请求的布局
        "slide": slide,                       # 完整更新后的页面数据
    }


# ──────────────────────────────────────────────────────────────────────────────
# 游戏占位符插入：POST /sessions/{id}/courseware/slides/{page_index}/elements/game
# ──────────────────────────────────────────────────────────────────────────────

@router.post("/sessions/{session_id}/courseware/slides/{page_index}/elements/game")
def add_game_placeholder(
    session_id: str,
    page_index: int,
    body: AddGameElemRequest,
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db),
):
    """
    向指定 PPT 页面插入一个 game_placeholder 元素。

    - 传 game_id（会话内游戏）：自动解析游戏标题/类型，并创建或复用永久公开分享链接
    - 传 game_url（任意 URL）：尝试从 URL 提取 game_id，若无法提取则直接使用 URL
    - game_id 和 game_url 至少提供一个

    返回值：
      element_id  — 新插入元素的 ID（game_xxxxxxxx）
      element     — 完整元素对象
      slide       — 更新后的完整页面数据（含所有元素）
    """
    import re as _re
    import secrets
    import string
    import json as _json
    from sqlalchemy.orm.attributes import flag_modified
    from app.models.game import Game
    from app.models.game_share import GameShare
    from app.services.game_generator import GAME_TYPE_META
    from app.core.config import settings

    if not body.game_id and not body.game_url:
        raise HTTPException(status_code=400, detail="game_id 或 game_url 至少提供一个")

    # 1. 验证会话归属
    session_ctx = db.query(SessionContext).filter(
        SessionContext.id == session_id,
        SessionContext.user_id == current_user.id,
    ).first()
    if not session_ctx:
        raise HTTPException(status_code=404, detail="Session not found")

    # 2. 解析 game_id（若仅传入了 URL）
    resolved_game_id = body.game_id
    resolved_game_url = body.game_url or ""

    if not resolved_game_id and body.game_url:
        m = _re.search(r'/games/(game_[a-f0-9]{8})/(?:preview|play)', body.game_url)
        if m:
            resolved_game_id = m.group(1)

    # 3. 查询游戏元数据 & 创建/复用公开分享链接
    game_title = "互动游戏"
    game_type  = "custom"
    type_label = "互动游戏"

    if resolved_game_id:
        game = db.query(Game).filter(
            Game.id == resolved_game_id,
            Game.user_id == current_user.id,
        ).first()
        if game:
            game_title = game.title
            game_type  = game.game_type
            type_label = GAME_TYPE_META.get(game_type, {}).get("label", game_type)

            if game.status == "completed":
                # 复用已有的永久分享链接，或新建一个
                _ALPHA = string.ascii_letters + string.digits
                existing = db.query(GameShare).filter(
                    GameShare.game_id == resolved_game_id,
                    GameShare.created_by == current_user.id,
                    GameShare.is_active == True,
                    GameShare.expires_at == None,  # noqa: E711
                ).first()
                if existing:
                    resolved_game_url = f"{settings.SERVER_URL}/s/{existing.code}"
                else:
                    for _ in range(10):
                        code = "".join(secrets.choice(_ALPHA) for _ in range(6))
                        if not db.query(GameShare).filter(GameShare.code == code).first():
                            break
                    share = GameShare(
                        code=code,
                        game_id=resolved_game_id,
                        created_by=current_user.id,
                        expires_at=None,
                    )
                    db.add(share)
                    db.commit()
                    resolved_game_url = f"{settings.SERVER_URL}/s/{code}"
            else:
                # 游戏尚未完成，记录 preview URL 作占位
                if not resolved_game_url:
                    resolved_game_url = f"{settings.SERVER_URL}/api/v1/games/{resolved_game_id}/preview"

    # 4. 构造 game_placeholder 元素
    elem_id = f"game_{uuid.uuid4().hex[:8]}"
    new_elem = {
        "element_id": elem_id,
        "type":       "game_placeholder",
        "position":   body.position,
        "content":    [],
        "is_accent":  False,
        "game_id":    resolved_game_id or "",
        "game_url":   resolved_game_url,
        "game_title": game_title,
        "game_type":  game_type,
        "type_label": type_label,
    }

    # 5. 追加元素到目标 slide
    cw = db.query(Courseware).filter(Courseware.session_id == session_id).first()
    if not cw or not cw.ppt_data:
        raise HTTPException(status_code=404, detail="No courseware found for this session")

    cw_data = cw.ppt_data
    if isinstance(cw_data, str):
        try:
            cw_data = _json.loads(cw_data)
        except Exception:
            cw_data = {}
    if not isinstance(cw_data, dict):
        cw_data = {}

    slides: list = list(cw_data.get("ppt_data", []))
    idx = next((i for i, s in enumerate(slides) if s.get("page_index") == page_index), None)
    if idx is None:
        raise HTTPException(status_code=404, detail=f"Slide {page_index} not found")

    slide = dict(slides[idx])
    slide["elements"] = list(slide.get("elements", [])) + [new_elem]
    slides[idx] = slide

    new_data = dict(cw_data)
    new_data["ppt_data"] = slides
    cw.ppt_data = new_data
    flag_modified(cw, "ppt_data")
    db.commit()

    import logging as _log
    _log.getLogger(__name__).info(
        f"[game_placeholder] inserted elem={elem_id} into session={session_id} page={page_index} "
        f"game_id={resolved_game_id} url={resolved_game_url}"
    )

    return {
        "page_index": page_index,
        "element_id": elem_id,
        "element":    new_elem,
        "slide":      slide,
    }
