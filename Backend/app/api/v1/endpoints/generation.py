import uuid
import os
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.orm import Session
from app.api import deps
from app.models.user import User
from app.models.session import SessionContext
from app.models.generation import GenerationTask, Courseware
from app.schemas.generation import GenerateRequest, TaskResponse, TaskStatusResponse, CoursewarePreviewResponse, IterateRequest
from app.services.courseware_generator import run_generation_task, stream_generation
from app.services.ppt_exporter import run_export_task, EXPORT_DIR

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
        
    active_task = db.query(GenerationTask).filter(
        GenerationTask.session_id == session_id, 
        GenerationTask.status == "generating",
        GenerationTask.task_type == "generate"
    ).first()
    if active_task:
        raise HTTPException(status_code=409, detail="A generation task is already running for this session")
        
    sse_headers = {
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
        "Connection": "keep-alive",
    }
    
    return StreamingResponse(
        stream_generation(session_id, body.selected_file_ids, body.generation_mode), 
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

    prompt = (
        "你是一位高级课件排版专家。请根据用户的\u300c局部修改指令\u300d，重新输出覆盖该单页PPT的内容。\n"
        "只输出单个页面合法的JSON对象，不要带任何Markdown围栏或开场白！\n\n"
        "【原始该页数据 JSON】\n"
        + json.dumps(page_to_update, ensure_ascii=False, indent=2)
        + "\n\n【用户修改指令】\n"
        + body.instruction
        + "\n\n【操作要求】\n输出修改后的全新单页JSON结构。保持 page_index 固定不变，可调整 layout_type、title、speaker_notes 或增删 elements。"
    )

    url = f"{settings.OPENAI_API_BASE.rstrip('/')}/chat/completions"
    headers = {"Authorization": f"Bearer {settings.OPENAI_API_KEY}", "Content-Type": "application/json"}
    payload = {
        "model": settings.LLM_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.3
    }

    try:
        resp = requests.post(url, headers=headers, json=payload, timeout=120)
        resp.raise_for_status()
        llm_content = resp.json().get("choices", [{}])[0].get("message", {}).get("content", "")

        json_match = re.search(r"\{.*\}", llm_content, re.DOTALL)
        if not json_match:
            raise HTTPException(status_code=500, detail="LLM 返回内容无法解析为合法 JSON，请重试")

        new_page = json.loads(json_match.group(0))
        new_page["page_index"] = page_to_update["page_index"]  # 强制保持页码不变

        idx = next(i for i, p in enumerate(slides_array) if p.get("page_index") == body.page_index)
        slides_array[idx] = new_page

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"单页修改失败：{str(e)}")

    # 用 flag_modified 强制触发 SQLAlchemy JSON 变更检测
    # Use cw_data_raw (already guaranteed dict) rather than re-reading cw.ppt_data which may be string
    new_data = dict(cw_data_raw) if isinstance(cw_data_raw, dict) else {}
    new_data["ppt_data"] = slides_array
    cw.ppt_data = new_data
    flag_modified(cw, "ppt_data")
    db.commit()
    db.refresh(cw)
    return new_page

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
    if os.path.exists(file_path):
        return FileResponse(file_path, filename=filename, media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation")
    raise HTTPException(status_code=404, detail="File not found")
