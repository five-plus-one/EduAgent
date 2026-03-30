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
        
    return {
        "ppt_data": cw.ppt_data,
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
        
    page_to_update = next((p for p in cw.ppt_data if p.get("page_index") == body.page_index), None)
    if page_to_update:
        page_to_update["speaker_notes"] = f"(Updated by iterate: {body.instruction})\n" + page_to_update.get("speaker_notes", "")
        db.query(Courseware).filter(Courseware.id == cw.id).update({"ppt_data": cw.ppt_data})
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
