import uuid
import os
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
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
from app.services.ppt_exporter import run_export_task, EXPORT_DIR
from app.services.word_exporter import markdown_to_docx

class IterateWordRequest(BaseModel):
    instruction: str
    selected_text: Optional[str] = None  # 当前选中的文字（可选，作为修改背景）

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
- type: "text_block"|"list"|"huge_number"|"subtitle"|"timeline_item"|"image"
  - 若 type 为 "image"：必须同时提供 "query"（图片搜索词，10-20字中文描述）和 "alt"（图注文字）
  - 示例: {{"type": "image", "query": "定轴转动刚体角速度角加速度示意图", "alt": "刚体定轴转动示意图", "element_id": "img_1", "content": [], "is_accent": false}}
- 严禁输出 Markdown 围栏、注释、额外文本

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

    def _resolve_page_images(page: dict) -> dict:
        """对单页的 elements 做图片向量检索，过滤无匹配的 image 元素。"""
        filtered = []
        for elem in page.get("elements", []):
            if elem.get("type") == "image":
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

# ---------------- EXPORT ----------------

@router.post("/sessions/{session_id}/export")
def trigger_export(
    session_id: str,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db)
):
    session_ctx = db.query(SessionContext).filter(SessionContext.id == session_id, SessionContext.user_id == current_user.id).first()
    if not session_ctx:
        raise HTTPException(status_code=404, detail="Session not found")
        
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
    
    background_tasks.add_task(run_export_task, task_id, session_id)
    return {"task_id": task_id, "status": "generating"}

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
            {"role": "system", "content": "你是一个専业的教育内容编辑器。根据用户修改要求精确修订 Markdown 讲义，保持整体结构不变化。不要输出任何开场白、引言或 markdown 围栏。"},
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
