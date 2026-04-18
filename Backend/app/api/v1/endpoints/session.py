from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, BackgroundTasks, Form
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
import uuid
import json
import os
import re
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
from app.services.ppt_exporter import PREMIUM_THEMES

router = APIRouter()

SESSION_UPLOAD_DIR = os.path.join(os.getcwd(), "uploads", "sessions")
os.makedirs(SESSION_UPLOAD_DIR, exist_ok=True)

_HEX_RE = re.compile(r'^#[0-9A-Fa-f]{6}$')

class ReferenceRequest(BaseModel):
    reference_ids: list[str]

class IntentUpdateRequest(BaseModel):
    intent_desc: str

class ThemeUpdateRequest(BaseModel):
    theme_key:     str | None = None   # 预设主题 key；None = 自定义或重置
    custom_colors: dict | None = None  # 当 theme_key=None 且有此字段时视为自定义


_CUSTOM_COLOR_FIELDS = ("bg_color", "primary", "secondary", "accent", "text_color")


def _build_ppt_theme(session_ctx: SessionContext) -> dict | None:
    """从 session 记录构造 ppt_theme 响应对象（含 resolved_colors）。"""
    key = session_ctx.ppt_theme_key
    custom = session_ctx.ppt_custom_colors
    if isinstance(custom, str):
        try:
            import json as _j
            custom = _j.loads(custom)
        except Exception:
            custom = None

    updated_at = session_ctx.ppt_theme_updated_at
    if updated_at is None and key is None and custom is None:
        return None   # 从未设置过，返回 null

    # 解析 resolved_colors
    if key and key in PREMIUM_THEMES:
        t = PREMIUM_THEMES[key]
        resolved = {
            "bg_color":   t["bg_color"],
            "primary":    t["primary"],
            "secondary":  t["secondary"],
            "accent":     t["accent"],
            "text_color": t["text_color"],
        }
    elif custom and isinstance(custom, dict):
        resolved = {f: custom.get(f, "") for f in _CUSTOM_COLOR_FIELDS}
    else:
        resolved = None   # 将触发「自动」

    return {
        "theme_key":       key,
        "custom_colors":   custom,
        "resolved_colors": resolved,
        "updated_at":      updated_at,
    }


router = APIRouter()

# ─────────────────────────────────────────────────────────────────────────────
# PATCH /sessions/{session_id}/theme — 保存/更新主题偏好
# ─────────────────────────────────────────────────────────────────────────────

@router.patch("/{session_id}/theme")
def update_session_theme(
    session_id: str,
    body: ThemeUpdateRequest,
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db),
):
    """
    保存会话的 PPT 主题选择。

    场景 A — 选择预设主题：{"theme_key": "ocean_depths"}
    场景 B — 自定义颜色：{"theme_key": null, "custom_colors": {...5 色}}
    场景 C — 重置为自动：{"theme_key": null}
    """
    from datetime import datetime, timezone

    session_ctx = db.query(SessionContext).filter(
        SessionContext.id == session_id,
        SessionContext.user_id == current_user.id,
    ).first()
    if not session_ctx:
        raise HTTPException(status_code=404, detail="Session not found")

    # 验证 theme_key
    if body.theme_key is not None and body.theme_key not in PREMIUM_THEMES:
        raise HTTPException(
            status_code=400,
            detail={
                "code": 4001,
                "message": "theme_key 不合法",
                "data": {
                    "error_ref": "ERR-TH001",
                    "details": [{"field": "theme_key", "issue": f"unknown theme: {body.theme_key}"}],
                },
            },
        )

    # 验证 custom_colors
    custom = None
    if body.theme_key is None and body.custom_colors:
        missing = [f for f in _CUSTOM_COLOR_FIELDS if f not in body.custom_colors]
        if missing:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": 4002,
                    "message": "custom_colors 字段缺失",
                    "data": {"details": [{"field": f, "issue": "missing"} for f in missing]},
                },
            )
        invalid = [
            f for f in _CUSTOM_COLOR_FIELDS
            if not _HEX_RE.match(body.custom_colors.get(f, ""))
        ]
        if invalid:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": 4002,
                    "message": "颜色值格式不合法（需要 #RRGGBB）",
                    "data": {"details": [{"field": f, "issue": "invalid hex color"} for f in invalid]},
                },
            )
        custom = {f: body.custom_colors[f] for f in _CUSTOM_COLOR_FIELDS}

    # 写入 DB
    session_ctx.ppt_theme_key        = body.theme_key
    session_ctx.ppt_custom_colors    = custom
    session_ctx.ppt_theme_updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(session_ctx)

    return {
        "session_id": session_id,
        "ppt_theme":  _build_ppt_theme(session_ctx),
    }


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
                "document_id": sf.document_id,
                "filename": sf.filename,
                "status": sf.status,
            }
            for sf in session_files
        ],
        "ppt_theme": _build_ppt_theme(session_ctx),
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
        
    # Retrieve chat history — 只取最近 30 条，防止历史过长撞上模型 context window 上限
    # 30 条 ≈ 15 轮对话，足够维持上下文连贯性
    history = (
        db.query(Message)
        .filter(Message.session_id == session_id)
        .order_by(Message.created_at.desc())   # 取最新的
        .limit(30)
        .all()
    )[::-1]   # 翻转回时间正序
    
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
    
    if session_files:
        mounted_files_str = "\n".join([f"- 【文档名】{sf.filename} (文档内部ID: {sf.id}, 意图或主题: {sf.intent_desc or '无'})" for sf in session_files])
        rag_context += f"【重要提示：当前会话已挂载了如下的资料全览清单。这是你的上帝视角！你可以知道用户传了什么！】\n{mounted_files_str}\n\n"
        
    if file_ids:
        from app.services.vector_store import search_vectors
        try:
            docs = search_vectors(query=chat_msg.content, filter_document_ids=file_ids, top_k=6)
            if docs:
                rag_context += "【相关文档段落的切片检索结果】\n" + "\n---\n".join([d.page_content for d in docs])
        except Exception:
            pass  # Fallback gracefully if Chroma is empty or disconnected

    async def sse_generator():
        ai_full_text = ""
        is_thinking = False
        async for chunk_sse in stream_chat_response(history, chat_msg.content, rag_context=rag_context, session_id=session_id, user_id=current_user.id, active_game_id=chat_msg.active_game_id):
            try:
                chunk_data_str = chunk_sse.replace("data: ", "").strip()
                if chunk_data_str:
                    chunk_data = json.loads(chunk_data_str)
                    ev = chunk_data.get("event_type", "text")
                    
                    if ev == "thinking":
                        if not is_thinking:
                            ai_full_text += "<think>\n"
                            is_thinking = True
                        if chunk_data.get("chunk"):
                            ai_full_text += chunk_data["chunk"]
                    else:
                        if is_thinking:
                            ai_full_text += "\n</think>\n"
                            is_thinking = False
                            
                        if ev == "text" and chunk_data.get("chunk"):
                            ai_full_text += chunk_data["chunk"]
                        elif ev == "tool_call" and chunk_data.get("tool_call"):
                            tc = chunk_data["tool_call"]
                            tc_info = f'\n<tool_call>{json.dumps(tc, ensure_ascii=False)}</tool_call>\n'
                            ai_full_text += tc_info
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
    将音频文件发送到 ASR 端点，返回识别文本。
    """
    import logging
    import requests
    from fastapi.concurrency import run_in_threadpool
    from app.core.config import settings

    log = logging.getLogger(__name__)

    # ── 1. 校验 session 归属 ─────────────────────────────────────────────
    session_ctx = db.query(SessionContext).filter(
        SessionContext.id == session_id,
        SessionContext.user_id == current_user.id,
    ).first()
    if not session_ctx:
        raise HTTPException(status_code=404, detail="Session not found")

    # ── 2. 检查 ASR 是否启用 ─────────────────────────────────────────────
    model = settings.WHISPER_MODEL
    if not model:
        raise HTTPException(
            status_code=501,
            detail="ASR 未配置（WHISPER_MODEL 为空），请联系管理员启用语音识别。"
        )

    # ── 3. 读取音频字节（在 async 上下文中安全）────────────────────────────
    audio_bytes = await audio_file.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="上传的音频文件为空")

    content_type = (audio_file.content_type or "").lower()
    original_name = audio_file.filename or "audio.wav"

    # ── 4. WebM → WAV 转码（浏览器 MediaRecorder 输出 webm/opus，上游不支持）──
    # 用 ffmpeg 管道：stdin 传 webm 字节，stdout 收 wav 字节，无需临时文件
    send_bytes    = audio_bytes
    send_filename = original_name
    send_mime     = content_type or "audio/wav"

    if "webm" in content_type or original_name.lower().endswith(".webm"):
        def _convert_webm():
            import subprocess
            try:
                # 优先 imageio-ffmpeg，回退到系统 ffmpeg
                try:
                    import imageio_ffmpeg
                    ffmpeg_bin = imageio_ffmpeg.get_ffmpeg_exe()
                except Exception:
                    import shutil
                    ffmpeg_bin = shutil.which("ffmpeg") or "ffmpeg"

                proc = subprocess.run(
                    [
                        ffmpeg_bin,
                        "-hide_banner", "-loglevel", "warning",
                        "-i", "pipe:0",
                        "-ar", "16000",
                        "-ac", "1",
                        "-q:a", "2",    # MP3 VBR 质量
                        "-f", "mp3",   # MP3 帧格式，管道输出无需文件大小头（WAV 有此问题）
                        "pipe:1",
                    ],
                    input=audio_bytes,
                    capture_output=True,
                    timeout=30,
                )
                if proc.returncode != 0:
                    log.warning(
                        f"[audio-chat] ffmpeg 转码失败 returncode={proc.returncode} "
                        f"stderr={proc.stderr.decode(errors='replace')[:300]}"
                    )
                    return None
                if not proc.stdout:
                    log.warning("[audio-chat] ffmpeg 输出为空")
                    return None
                return proc.stdout
            except Exception as conv_err:
                log.warning(f"[audio-chat] WebM 转码异常，将直接上传原始字节: {conv_err}")
            return None

        converted = await run_in_threadpool(_convert_webm)
        if converted:
            send_bytes    = converted
            send_filename = original_name.rsplit(".", 1)[0] + ".mp3"
            send_mime     = "audio/mpeg"
            log.info(f"[audio-chat] WebM→MP3 转码完成 {len(audio_bytes)}→{len(send_bytes)} bytes")
        else:
            log.warning(f"[audio-chat] 转码失败，直接上传 {content_type} 原始字节")

    url = f"{settings.OPENAI_API_BASE.rstrip('/')}/audio/transcriptions"
    req_headers = {
        "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
        "Connection":    "close",   # 禁用 keep-alive，避免连接状态复用
    }
    data = {
        "model":           model,
        "language":        "zh",
        "response_format": "json",
    }

    log.info(
        f"[audio-chat] 准备上传 session={session_id} "
        f"filename={send_filename} mime={send_mime} size={len(send_bytes)}"
    )

    # ── 5. 写入临时文件后通过文件句柄发送 ─────────────────────────────────────
    # 不直接传内存 bytes：requests 无法对内存 bytes 做 seek，在某些情况下
    # 无法正确设置 Content-Length，导致上游看到不完整的 multipart body（NextPart: EOF）。
    # 用文件句柄后 requests 会 seek() 精确算出长度，始终发出正确的 Content-Length。
    import tempfile, os as _os

    def _do_asr():
        tmp_fd, tmp_path = tempfile.mkstemp(suffix=f"_{send_filename}")
        try:
            with _os.fdopen(tmp_fd, "wb") as f:
                f.write(send_bytes)
            sess = requests.Session()
            try:
                with open(tmp_path, "rb") as audio_fp:
                    _files = {"file": (send_filename, audio_fp, send_mime or "audio/wav")}
                    return sess.post(url, headers=req_headers, files=_files, data=data, timeout=30)
            finally:
                sess.close()
        finally:
            try:
                _os.unlink(tmp_path)
            except OSError:
                pass

    try:
        resp = await run_in_threadpool(_do_asr)
    except Exception as e:
        log.error(
            f"[audio-chat] ASR 上游请求异常 session={session_id} url={url} "
            f"exc_type={type(e).__name__} exc={e}"
        )
        raise HTTPException(
            status_code=502,
            detail=f"ASR 上游连接失败（{type(e).__name__}），请检查代理网关是否支持 Whisper 协议。"
        )

    if resp.status_code != 200:
        log.warning(
            f"[audio-chat] ASR 上游返回错误 session={session_id} "
            f"status={resp.status_code} body={resp.text[:300]}"
        )
        raise HTTPException(
            status_code=502,
            detail=f"ASR 上游返回 {resp.status_code}：{resp.text[:200]}"
        )

    text = resp.json().get("text", "")
    log.info(f"[audio-chat] ASR 成功 session={session_id} chars={len(text)}")
    return {"text": text}


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
