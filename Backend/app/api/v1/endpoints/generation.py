import uuid
import os
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from app.api import deps
from app.models.user import User
from app.models.session import SessionContext
from app.models.generation import GenerationTask, Courseware
from app.schemas.generation import GenerateRequest, TaskResponse, TaskStatusResponse, CoursewarePreviewResponse, IterateRequest
from app.services.courseware_generator import run_generation_task
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
        raise HTTPException(status_code=404, detail="Courseware not found or not generated yet")
        
    slides_array = cw.ppt_data.get("ppt_data", []) if isinstance(cw.ppt_data, dict) else cw.ppt_data
    if not isinstance(slides_array, list): slides_array = []

    return {
        "ppt_data": slides_array,
        "word_markdown": cw.word_markdown or ""
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
        
    slides_array = cw.ppt_data.get("ppt_data", []) if isinstance(cw.ppt_data, dict) else cw.ppt_data
    if not isinstance(slides_array, list): slides_array = []
    
    page_to_update = next((p for p in slides_array if p.get("page_index") == body.page_index), None)
    if page_to_update:
        import requests, json, re
        from app.core.config import settings
        
        prompt = f"""
        你是一位高级课件排版专家。请根据以下用户的“局部修改指令”，重新输出并覆盖该单页PPT的内容。
        你必须完全遵守原始系统的 JSON Element 格式要求！**只能输出单个页面合法的JSON对象（Dict），不要带任何前后多余的 markdown 或开场白！**
        
        【原始该页数据 JSON】
        {json.dumps(page_to_update, ensure_ascii=False, indent=2)}
        
        【用户修改指令】
        {body.instruction}
        
        【操作要求】
        请结合原先上下文，输出被重修修改后的全新单页 JSON 结构。保持 `page_index` 固定不变。可适度调整 `layout_type`、`title`、`speaker_notes` 或增添/删除 `elements` 来完全响应诉求！
        """
        
        url = f"{settings.OPENAI_API_BASE.rstrip('/')}/chat/completions"
        headers = {"Authorization": f"Bearer {settings.OPENAI_API_KEY}", "Content-Type": "application/json"}
        payload = {"model": "doubao-seed-2-0-pro-260215", "messages": [{"role": "user", "content": prompt}], "temperature": 0.3}
        
        try:
            resp = requests.post(url, headers=headers, json=payload, timeout=40)
            resp.raise_for_status()
            content = resp.json().get("choices", [{}])[0].get("message", {}).get("content", "")
            
            json_match = re.search(r"\{.*\}", content, re.DOTALL)
            if json_match:
                new_page = json.loads(json_match.group(0))
                for k, v in new_page.items():
                    page_to_update[k] = v
        except Exception as e:
            # Fallback mock style if LLM fails
            page_to_update["speaker_notes"] = f"(大模型迭代调用失败: {str(e)})\n" + page_to_update.get("speaker_notes", "")
        
        # Save back the structure
        new_data = dict(cw.ppt_data) if isinstance(cw.ppt_data, dict) else {}
        if isinstance(cw.ppt_data, dict):
            new_data["ppt_data"] = slides_array
        else:
            new_data = slides_array
            
        # SQL core update
        db.query(Courseware).filter(Courseware.id == cw.id).update({"ppt_data": new_data})
        db.commit()
        return page_to_update
        
    raise HTTPException(status_code=404, detail="Page not found")

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
        "download_urls": task.result_data.get("download_urls") if task.result_data else None
    }
    
@router.get("/export/download/{filename}")
def download_export(filename: str):
    file_path = os.path.join(EXPORT_DIR, filename)
    if os.path.exists(file_path):
        return FileResponse(file_path, filename=filename, media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation")
    raise HTTPException(status_code=404, detail="File not found")
