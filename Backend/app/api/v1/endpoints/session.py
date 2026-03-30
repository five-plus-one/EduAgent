from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
import uuid
import json

from app.api import deps
from app.models.user import User
from app.models.session import SessionContext, Message
from app.schemas.session import SessionCreate, SessionResponse, ChatMessage, SessionListResponse, SessionItem, SessionDetailResponse, SessionUpdate
from app.services.llm_service import stream_chat_response
from app.db.session import SessionLocal

router = APIRouter()

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
    
    return {
        "session_id": session_ctx.id,
        "course_name": session_ctx.course_name,
        "target_audience": session_ctx.target_audience,
        "messages": [{"role": m.role, "content": m.content} for m in messages],
        "associated_files": [] # 留给 Phase 3 完成
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

    async def sse_generator():
        ai_full_text = ""
        # stream the chunks
        async for chunk_sse in stream_chat_response(history, chat_msg.content):
            # Parse chunk internally to build final full AI text for DB persistence
            try:
                chunk_data_str = chunk_sse.replace("data: ", "").strip()
                if chunk_data_str:
                    chunk_data = json.loads(chunk_data_str)
                    if chunk_data.get("chunk"):
                        ai_full_text += chunk_data["chunk"]
            except Exception:
                pass
            yield chunk_sse
            
        # Background: Save the complete assistant string to SQLite via an independent session
        db_local = SessionLocal()
        try:
            ai_msg_db = Message(
                id=f"msg_{uuid.uuid4().hex[:12]}",
                session_id=session_id,
                role="assistant",
                content=ai_full_text
            )
            db_local.add(ai_msg_db)
            db_local.commit()
        finally:
            db_local.close()

    return StreamingResponse(sse_generator(), media_type="text/event-stream")

@router.post("/{session_id}/audio-chat")
async def audio_chat(
    session_id: str,
    audio_file: UploadFile = File(...),
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db)
):
    """
    1.3 语音输入转文本
    目前为 Mock 响应，后期可对接 Whisper ASR
    """
    # ... mock sleep/process ...
    mock_text = f"收到来自 {audio_file.filename} 的语音。我现在想做一份关于牛顿定律的课件，有什么好的想法吗？"
    return {
        "text": mock_text
    }
