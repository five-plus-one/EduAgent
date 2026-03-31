from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, BackgroundTasks, Form
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
import uuid
import json
import os
import shutil

from app.api import deps
from app.models.user import User
from app.models.document import Document
from app.models.session import SessionContext, Message, SessionFile
from app.schemas.session import SessionCreate, SessionResponse, ChatMessage, SessionListResponse, SessionItem, SessionDetailResponse, SessionUpdate
from app.services.llm_service import stream_chat_response
from app.db.session import SessionLocal
from app.services.document_processor_task import process_session_file_task
from app.services.vector_store import delete_document_vectors

router = APIRouter()

SESSION_UPLOAD_DIR = os.path.join(os.getcwd(), "uploads", "sessions")
os.makedirs(SESSION_UPLOAD_DIR, exist_ok=True)

class ReferenceRequest(BaseModel):
    reference_ids: list[str]

class IntentUpdateRequest(BaseModel):
    intent_desc: str

@router.post("", response_model=SessionResponse)
def create_session(
    session_in: SessionCreate,
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db)
):
    """
    1.1 初始化一次备课任务的上下文 (Session)
    """
    new_session = SessionContext(
        id=f"sess_{uuid.uuid4().hex[:8]}",
        user_id=current_user.id,
        course_name=session_in.course_name,
        target_audience=session_in.target_audience
    )
    db.add(new_session)
    db.commit()
    db.refresh(new_session)
    return {
        "session_id": new_session.id,
        "created_at": new_session.created_at
    }

@router.get("", response_model=SessionListResponse)
def list_sessions(
    page: int = 1,
    size: int = 20,
    keyword: str = None,
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db)
):
    query = db.query(SessionContext).filter(SessionContext.user_id == current_user.id)
    if keyword:
        query = query.filter(SessionContext.course_name.contains(keyword))
    
    total = query.count()
    sessions = query.order_by(SessionContext.created_at.desc()).offset((page - 1) * size).limit(size).all()
    
    items = []
    for s in sessions:
        items.append(SessionItem(
            session_id=s.id,
            course_name=s.course_name,
            updated_at=s.created_at
        ))
        
    return {
        "total": total,
        "page": page,
        "has_more": (page * size) < total,
        "items": items
    }

@router.get("/{session_id}", response_model=SessionDetailResponse)
def get_session_detail(
    session_id: str,
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db)
):
    session_ctx = db.query(SessionContext).filter(SessionContext.id == session_id, SessionContext.user_id == current_user.id).first()
    if not session_ctx:
        raise HTTPException(status_code=404, detail="Session not found")
        
    messages = db.query(Message).filter(Message.session_id == session_id).order_by(Message.created_at).all()
    
    session_files = db.query(SessionFile).filter(SessionFile.session_id == session_id, SessionFile.status == "completed").all()
    
    return {
        "session_id": session_ctx.id,
        "course_name": session_ctx.course_name,
        "target_audience": session_ctx.target_audience,
        "messages": [{"role": m.role, "content": m.content} for m in messages],
        "associated_files": [
            {
                "session_file_id": sf.id,
                "document_id": sf.document_id,   # 知识库原始文档 ID，用于前端侧边栏勾选状态还原
                "filename": sf.filename,
                "status": sf.status,
            }
            for sf in session_files
        ]
    }

@router.put("/{session_id}")
def update_session(
    session_id: str,
    update_data: SessionUpdate,
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db)
):
    session_ctx = db.query(SessionContext).filter(SessionContext.id == session_id, SessionContext.user_id == current_user.id).first()
    if not session_ctx:
        raise HTTPException(status_code=404, detail="Session not found")
        
    if update_data.course_name is not None:
        session_ctx.course_name = update_data.course_name
        
    db.commit()
    return None

@router.delete("/{session_id}")
def delete_session(
    session_id: str,
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db)
):
    session_ctx = db.query(SessionContext).filter(SessionContext.id == session_id, SessionContext.user_id == current_user.id).first()
    if not session_ctx:
        raise HTTPException(status_code=404, detail="Session not found")
        
    db.delete(session_ctx)
    db.commit()
    return None

@router.post("/{session_id}/chat")
async def chat_with_session(
    session_id: str,
    chat_msg: ChatMessage,
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db)
):
    """
    1.2 发送文本消息 (流式交互 SSE)
    前端期望 `Accept: text/event-stream`
    """
    session_ctx = db.query(SessionContext).filter(
        SessionContext.id == session_id,
        SessionContext.user_id == current_user.id
    ).first()
    
    if not session_ctx:
        raise HTTPException(status_code=404, detail="Session not found")
        
    # Retrieve chat history
    history = db.query(Message).filter(Message.session_id == session_id).order_by(Message.created_at).all()
    
    # Append new user message to local DB synchronously
    user_msg_db = Message(
        id=f"msg_{uuid.uuid4().hex[:12]}",
        session_id=session_id,
        role="user",
        content=chat_msg.content
    )
    db.add(user_msg_db)
    db.commit()

    # Pre-computation: Retrieve RAG chunks if any session files exist
    rag_context = ""
    session_files = db.query(SessionFile).filter(SessionFile.session_id == session_id, SessionFile.status == "completed").all()
    file_ids = [sf.document_id if sf.document_id else sf.id for sf in session_files]
    if file_ids:
        from app.services.vector_store import search_vectors
        try:
            # We fetch top 3 highly-correlated chunks against the new user query
            docs = search_vectors(query=chat_msg.content, filter_document_ids=file_ids, top_k=3)
            if docs:
                rag_context = "\n---\n".join([d.page_content for d in docs])
        except Exception:
            pass  # Fallback gracefully if Chroma is empty or disconnected

    async def sse_generator():
        ai_full_text = ""
        async for chunk_sse in stream_chat_response(history, chat_msg.content, rag_context=rag_context, session_id=session_id):
            try:
                chunk_data_str = chunk_sse.replace("data: ", "").strip()
                if chunk_data_str:
                    chunk_data = json.loads(chunk_data_str)
                    ev = chunk_data.get("event_type", "text")
                    # 只将正常对话文本存入 DB，思考内容不入历史
                    if ev == "text" and chunk_data.get("chunk"):
                        ai_full_text += chunk_data["chunk"]
            except Exception:
                pass
            yield chunk_sse

        # 将完整助手回复存入 SQLite
        db_local = SessionLocal()
        try:
            if ai_full_text.strip():   # 如果只调用了工具没有话术也加一个占位记录
                content_to_save = ai_full_text
            else:
                content_to_save = "[工具调用已执行]"
            ai_msg_db = Message(
                id=f"msg_{uuid.uuid4().hex[:12]}",
                session_id=session_id,
                role="assistant",
                content=content_to_save
            )
            db_local.add(ai_msg_db)
            db_local.commit()
        finally:
            db_local.close()

    # 禁用中间代理和服务器的缓冲，确保每一帧立即推送到前端
    sse_headers = {
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",     # 禁止 nginx 缓冲
        "Connection": "keep-alive",
    }
    return StreamingResponse(sse_generator(), media_type="text/event-stream", headers=sse_headers)

@router.post("/{session_id}/audio-chat")
async def audio_chat(
    session_id: str,
    audio_file: UploadFile = File(...),
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db)
):
    """
    1.3 语音输入转文本
    Reads bytes and streams to ASR endpoint.
    """
    import requests
    from app.core.config import settings
    
    url = f"{settings.OPENAI_API_BASE.rstrip('/')}/audio/transcriptions"
    headers = {"Authorization": f"Bearer {settings.OPENAI_API_KEY}"}
    
    try:
        audio_bytes = await audio_file.read()
        files = {
            "file": (audio_file.filename or "audio.wav", audio_bytes, audio_file.content_type or "audio/wav")
        }
        data = {
            "model": "whisper-1" # Generic representation, will be proxy-mapped usually
        }
        resp = requests.post(url, headers=headers, files=files, data=data, timeout=30)
        resp.raise_for_status()
        text = resp.json().get("text", "")
        return {"text": text}
    except Exception as e:
        # Fallback to mock text indicating ASR isn't configured at upstream
        return {
            "text": f"(ASR组件上游调用失败: {str(e)}。无法识别真实的语音内容，请检查大模型通道是否支持 Whisper 协议)"
        }

@router.post("/{session_id}/files")
async def upload_session_file(
    session_id: str,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    intent_desc: str = Form(default=""),
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db)
):
    session_ctx = db.query(SessionContext).filter(SessionContext.id == session_id, SessionContext.user_id == current_user.id).first()
    if not session_ctx:
        raise HTTPException(status_code=404, detail="Session not found")
        
    file_id = "sf_" + uuid.uuid4().hex[:8]
    ext = os.path.splitext(file.filename)[1].lower() if file.filename else ""
    safe_filename = f"{file_id}{ext}"
    file_path = os.path.join(SESSION_UPLOAD_DIR, safe_filename)
    
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    sf = SessionFile(
        id=file_id,
        session_id=session_id,
        filename=file.filename,
        file_path=file_path,
        intent_desc=intent_desc,
        status="pending"
    )
    db.add(sf)
    db.commit()
    
    background_tasks.add_task(process_session_file_task, file_id)
    return {"file_id": file_id, "status": "processing"}

@router.get("/{session_id}/files/{file_id}/status")
def get_session_file_status(
    session_id: str,
    file_id: str,
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db)
):
    sf = db.query(SessionFile).filter(SessionFile.id == file_id, SessionFile.session_id == session_id).first()
    if not sf:
        raise HTTPException(status_code=404, detail="Session File not found")
        
    return {"status": sf.status, "progress": sf.progress}

@router.post("/{session_id}/references")
def mount_documents_to_session(
    session_id: str,
    body: ReferenceRequest,
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db)
):
    session_ctx = db.query(SessionContext).filter(SessionContext.id == session_id, SessionContext.user_id == current_user.id).first()
    if not session_ctx:
        raise HTTPException(status_code=404, detail="Session not found")
    
    # Get current globally mounted files
    existing_mounts = db.query(SessionFile).filter(
        SessionFile.session_id == session_id,
        SessionFile.document_id.isnot(None)
    ).all()
    
    existing_doc_ids = {sf.document_id for sf in existing_mounts}
    new_doc_ids = set(body.reference_ids)
    
    # 1. Delete removed mounts
    for sf in existing_mounts:
        if sf.document_id not in new_doc_ids:
            db.delete(sf)
            
    # 2. Add new mounts
    for doc_id in new_doc_ids - existing_doc_ids:
        doc = db.query(Document).filter(Document.id == doc_id).first()
        if doc and doc.status == "completed":
            sf = SessionFile(
                id="sf_" + uuid.uuid4().hex[:8],
                session_id=session_id,
                document_id=doc.id,
                filename=doc.filename,
                file_path=doc.file_path, 
                status="completed", 
                progress=100
            ) 
            db.add(sf)
            
    db.commit()
    return None

@router.put("/{session_id}/files/{file_id}")
def update_session_file_intent(
    session_id: str,
    file_id: str,
    body: IntentUpdateRequest,
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db)
):
    sf = db.query(SessionFile).filter(SessionFile.id == file_id, SessionFile.session_id == session_id).first()
    if sf:
        sf.intent_desc = body.intent_desc
        db.commit()
    return None

@router.delete("/{session_id}/files/{file_id}")
def delete_session_file(
    session_id: str,
    file_id: str,
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db)
):
    from sqlalchemy import or_
    sf = db.query(SessionFile).filter(
        SessionFile.session_id == session_id,
        or_(SessionFile.id == file_id, SessionFile.document_id == file_id)
    ).first()
    if not sf:
        raise HTTPException(status_code=404, detail="File mount not found")
    
    # If not a global document mount, we delete actual vectors and local file
    if not sf.document_id:
        delete_document_vectors(file_id)
        if sf.file_path and os.path.exists(sf.file_path):
            os.remove(sf.file_path)
            
    db.delete(sf)
    db.commit()
    return None
