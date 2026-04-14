"""
games.py — 互动小游戏 API 路由
/api/v1/games/...
"""
import os
import json
import uuid
import asyncio
import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from fastapi.responses import HTMLResponse, StreamingResponse
from pydantic import BaseModel, Field
from typing import Optional, List, AsyncGenerator
from sqlalchemy.orm import Session
from sqlalchemy import update as sql_update

from app.api import deps
from app.models.user import User
from app.models.game import Game
from app.models.generation import GenerationTask
from app.models.session import SessionContext
from app.services.game_generator import (
    run_game_task, GAMES_DIR, GAME_TYPE_META,
    _build_prompt, _extract_html, _ppt_summary, _GAME_SYSTEM_PROMPT,
)
from app.db.session import SessionLocal
from app.api.deps import get_current_user_or_token
from app.core.config import settings

logger = logging.getLogger(__name__)

router = APIRouter()

# ─────────────────────────────────────────────────────────────────────────────
# Schemas
# ─────────────────────────────────────────────────────────────────────────────

class GameSpec(BaseModel):
    game_type:              str           = Field(..., description="quiz/memory/fillblank/sort/match/flashcard/custom")
    title:                  str           = Field(..., description="游戏标题")
    key_topics:             List[str]     = Field(default_factory=list)
    custom_requirements:    Optional[str] = None
    is_refinement:          bool          = False
    refinement_instruction: Optional[str] = None   # 仅 is_refinement=true 时填写

class GenerateGameRequest(BaseModel):
    spec:           GameSpec
    refine_game_id: Optional[str] = None   # 若为精炼已有游戏，传入 game_id


# ── SSE 辅助 ──────────────────────────────────────────────────────────────────
def _sse(data: dict) -> str:
    """格式化为 SSE data 行。"""
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


# ─────────────────────────────────────────────────────────────────────────────
# 1. 获取游戏类型列表
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/games/types")
def list_game_types():
    """列出所有支持的游戏类型及说明，供前端展示选型菜单。"""
    return {
        "types": [
            {"key": k, "label": v["label"], "hint": v["hint"]}
            for k, v in GAME_TYPE_META.items()
        ]
    }


# ─────────────────────────────────────────────────────────────────────────────
# 2. 触发游戏生成（首次 or 精炼）
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/sessions/{session_id}/games/generate")
def generate_game(
    session_id: str,
    body: GenerateGameRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db),
):
    """
    创建游戏生成任务，立即返回 task_id / game_id。

    推荐流程：拿到 task_id 后立即接入
    `GET /games/tasks/{task_id}/stream`（SSE 流式生成）。
    若 SSE 无法建立连接，可降级轮询 `GET /games/tasks/{task_id}`，
    此时后台非流式任务会在 3 秒后自动接管。
    """
    session_ctx = db.query(SessionContext).filter(
        SessionContext.id == session_id,
        SessionContext.user_id == current_user.id,
    ).first()
    if not session_ctx:
        raise HTTPException(status_code=404, detail="Session not found")

    spec_dict     = body.spec.model_dump()
    is_refinement = body.spec.is_refinement

    if is_refinement:
        if not body.refine_game_id:
            raise HTTPException(status_code=400, detail="精炼模式需要提供 refine_game_id")
        game = db.query(Game).filter(
            Game.id == body.refine_game_id,
            Game.user_id == current_user.id,
        ).first()
        if not game:
            raise HTTPException(status_code=404, detail="Game not found")
        if game.status == "pending":
            raise HTTPException(status_code=409, detail="游戏正在生成中，请稍后再试")
        game.status    = "pending"    # 重置为 pending，等待 SSE 或后台任务认领
        game.spec_json = spec_dict
        db.commit()
        game_id = game.id
    else:
        game_id = "game_" + uuid.uuid4().hex[:8]
        game = Game(
            id         = game_id,
            session_id = session_id,
            user_id    = current_user.id,
            title      = body.spec.title,
            game_type  = body.spec.game_type,
            status     = "pending",       # SSE 端点或后台任务认领后改为 generating
            spec_json  = spec_dict,
        )
        db.add(game)
        db.commit()

    task_id = "gtask_" + uuid.uuid4().hex[:8]
    task = GenerationTask(
        id          = task_id,
        session_id  = session_id,
        task_type   = "game",
        status      = "pending",
        stage       = "init",
        result_data = {"game_id": game_id},   # 必须存：SSE 端点靠此找到 game
    )
    db.add(task)
    db.commit()

    # 后台非流式任务作为保底（如果 SSE 未连接则 3 秒后自动接管）
    background_tasks.add_task(run_game_task, task_id, game_id, session_id, spec_dict)

    return {
        "task_id":       task_id,
        "game_id":       game_id,
        "status":        "pending",
        "is_refinement": is_refinement,
    }


# ─────────────────────────────────────────────────────────────────────────────
# 3. SSE 流式生成接口（P0 核心）
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/games/tasks/{task_id}/stream")
async def stream_game_task_sse(
    task_id: str,
    current_user: User = Depends(get_current_user_or_token),
    db: Session = Depends(deps.get_db),
):
    """
    SSE 流式游戏生成接口。

    - 连接后立即开始 LLM 流式生成，实时推送 code_chunk 事件
    - 若游戏已生成完成（reconnect 场景），直接推送 done 事件
    - 支持 ?token=<access_token>（EventSource 无法设 Authorization header）

    事件类型：stage | code_chunk | done | error
    """
    # ── 初始验证（用 FastAPI 注入的 db session） ──────────────────────────────
    task = db.query(GenerationTask).filter(
        GenerationTask.id == task_id,
        GenerationTask.task_type == "game",
    ).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    game_id = (task.result_data or {}).get("game_id")
    if not game_id:
        raise HTTPException(status_code=400, detail="task.result_data 中缺少 game_id")

    game = db.query(Game).filter(
        Game.id == game_id,
        Game.user_id == current_user.id,
    ).first()
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")

    # 若已完成（reconnect），直接返回 done 事件
    if game.status == "completed" and game.html_file:
        async def _done_only():
            yield _sse({
                "event_type": "done",
                "game_id":    game_id,
                "html_file":  game.html_file,
                "version":    game.version,
                "progress":   100,
            })
        return StreamingResponse(
            _done_only(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    # ── 原子认领：将 pending → streaming ────────────────────────────────────
    rows = db.execute(
        sql_update(Game)
        .where(Game.id == game_id, Game.status == "pending")
        .values(status="streaming")
    ).rowcount
    db.commit()
    if rows == 0:
        # 后台任务已先认领（generating），降级为轮询提示
        raise HTTPException(
            status_code=202,
            detail="后台任务已接管生成，请使用轮询接口 GET /games/tasks/{task_id}",
        )

    # 捕获闭包变量（db session 随 FastAPI 生命周期关闭，不在 generator 里使用）
    spec       = game.spec_json or {}
    session_id = game.session_id

    # ── 生成器 ────────────────────────────────────────────────────────────────
    async def event_generator() -> AsyncGenerator[str, None]:
        full_text = ""
        try:
            # Stage 1: preparing
            yield _sse({"event_type": "stage", "stage": "preparing",
                        "progress": 5, "message": "分析知识点，构建 prompt..."})

            # 加载课件摘要（线程）
            ppt_summary = await asyncio.to_thread(_ppt_summary, session_id)

            # 精炼模式：加载已有 HTML
            existing_html: Optional[str] = None
            if spec.get("is_refinement"):
                def _load_html():
                    db2 = SessionLocal()
                    try:
                        g = db2.query(Game).filter(Game.id == game_id).first()
                        if g and g.html_file:
                            fp = os.path.join(GAMES_DIR, g.html_file)
                            if os.path.exists(fp):
                                return open(fp, encoding="utf-8").read()
                    finally:
                        db2.close()
                    return None
                existing_html = await asyncio.to_thread(_load_html)

            user_prompt = _build_prompt(spec, ppt_summary, existing_html)

            # Stage 2: generating
            yield _sse({"event_type": "stage", "stage": "generating",
                        "progress": 8, "message": "AI 正在生成游戏代码..."})

            # ── LLM 流式调用 ─────────────────────────────────────────────────
            headers_llm = {
                "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
                "Content-Type":  "application/json",
            }
            payload = {
                "model":      settings.LLM_MODEL,
                "messages":   [
                    {"role": "system", "content": _GAME_SYSTEM_PROMPT},
                    {"role": "user",   "content": user_prompt},
                ],
                "stream":     True,
                "max_tokens": 8192,
            }
            base_url = settings.OPENAI_API_BASE.rstrip("/")

            ESTIMATED_CHARS = 9000   # 预估 HTML 总长度，用于进度插值

            async with httpx.AsyncClient(
                timeout=httpx.Timeout(connect=10.0, read=300.0, write=10.0, pool=10.0)
            ) as client:
                async with client.stream(
                    "POST", f"{base_url}/chat/completions",
                    headers=headers_llm, json=payload,
                ) as resp:
                    resp.raise_for_status()
                    async for raw_line in resp.aiter_lines():
                        line = raw_line.strip()
                        if not line or not line.startswith("data: "):
                            continue
                        data_str = line[6:].strip()
                        if data_str == "[DONE]":
                            break
                        try:
                            chunk_data = json.loads(data_str)
                            content = (
                                chunk_data.get("choices", [{}])[0]
                                .get("delta", {})
                                .get("content") or ""
                            )
                            if content:
                                full_text += content
                                progress = min(
                                    10 + int(len(full_text) / ESTIMATED_CHARS * 85),
                                    96,
                                )
                                yield _sse({
                                    "event_type": "code_chunk",
                                    "chunk":      content,
                                    "progress":   progress,
                                })
                        except Exception:
                            continue

            # ── 提取 HTML ────────────────────────────────────────────────────
            html_content = _extract_html(full_text)
            if len(html_content) < 200:
                raise ValueError("生成的 HTML 内容过短，可能生成失败，请重试")

            # Stage 3: writing
            yield _sse({"event_type": "stage", "stage": "writing",
                        "progress": 97, "message": "写入文件..."})

            # 写入文件（线程）
            filename = f"{game_id}.html"
            filepath = os.path.join(GAMES_DIR, filename)
            await asyncio.to_thread(
                lambda: open(filepath, "w", encoding="utf-8").write(html_content)
            )

            # 更新数据库
            def _update_db():
                db3 = SessionLocal()
                try:
                    g3 = db3.query(Game).filter(Game.id == game_id).first()
                    t3 = db3.query(GenerationTask).filter(GenerationTask.id == task_id).first()
                    if g3:
                        g3.html_file = filename
                        g3.status    = "completed"
                        if spec.get("is_refinement"):
                            g3.version += 1
                    if t3:
                        t3.status      = "completed"
                        t3.progress    = 100
                        t3.stage       = "done"
                        t3.result_data = {
                            "game_id":   game_id,
                            "html_file": filename,
                            "version":   g3.version if g3 else 1,
                        }
                    db3.commit()
                    return g3.version if g3 else 1
                finally:
                    db3.close()

            version = await asyncio.to_thread(_update_db)
            logger.info(f"[game stream] ✅ {game_id} v{version} ({len(html_content)} chars)")

            # Stage 4: done
            yield _sse({
                "event_type": "done",
                "game_id":    game_id,
                "html_file":  filename,
                "version":    version,
                "progress":   100,
            })

        except Exception as exc:
            import traceback
            logger.error(f"[game stream] ❌ {game_id}: {exc}\n{traceback.format_exc()}")
            # 写入失败状态
            def _mark_failed():
                db_e = SessionLocal()
                try:
                    g_e = db_e.query(Game).filter(Game.id == game_id).first()
                    t_e = db_e.query(GenerationTask).filter(GenerationTask.id == task_id).first()
                    if g_e:
                        g_e.status = "failed"
                        g_e.error  = str(exc)
                    if t_e:
                        t_e.status      = "failed"
                        t_e.result_data = {"error": str(exc)}
                    db_e.commit()
                finally:
                    db_e.close()
            asyncio.create_task(asyncio.to_thread(_mark_failed))
            yield _sse({"event_type": "error", "message": str(exc), "progress": 0})

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ─────────────────────────────────────────────────────────────────────────────
# 4. 查询生成任务进度（轮询降级）
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/games/tasks/{task_id}")
def get_game_task_status(
    task_id: str,
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db),
):
    """轮询游戏生成任务状态（SSE 降级用）。completed 时 result.game_id 可用。"""
    task = db.query(GenerationTask).filter(
        GenerationTask.id == task_id,
        GenerationTask.task_type == "game",
    ).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    return {
        "task_id":  task_id,
        "status":   task.status,
        "stage":    task.stage,
        "progress": task.progress,
        "result":   task.result_data or {},
    }


# ─────────────────────────────────────────────────────────────────────────────
# 5. 列出 session 下所有已生成游戏
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/sessions/{session_id}/games")
def list_session_games(
    session_id: str,
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db),
):
    """返回该对话的所有游戏列表，按创建时间倒序。"""
    games = (
        db.query(Game)
        .filter(Game.session_id == session_id, Game.user_id == current_user.id)
        .order_by(Game.created_at.desc())
        .all()
    )
    return {
        "games": [
            {
                "game_id":    g.id,
                "title":      g.title,
                "game_type":  g.game_type,
                "type_label": GAME_TYPE_META.get(g.game_type, {}).get("label", g.game_type),
                "status":     g.status,
                "version":    g.version,
                "created_at": g.created_at,
                "updated_at": g.updated_at,
            }
            for g in games
        ]
    }


# ─────────────────────────────────────────────────────────────────────────────
# 6. 游戏 HTML 预览（供 <iframe src="...?token="> 直接加载）
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/games/{game_id}/preview")
def preview_game(
    game_id: str,
    current_user: User = Depends(get_current_user_or_token),
    db: Session = Depends(deps.get_db),
):
    """返回游戏 HTML 文件，供 iframe inline 加载。支持 ?token= 参数。"""
    game = db.query(Game).filter(
        Game.id == game_id,
        Game.user_id == current_user.id,
    ).first()
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    if game.status != "completed" or not game.html_file:
        raise HTTPException(status_code=202, detail="游戏尚未生成完成")

    html_path = os.path.join(GAMES_DIR, game.html_file)
    if not os.path.exists(html_path):
        raise HTTPException(status_code=404, detail="游戏文件不存在，可能需要重新生成")

    safe_dir  = os.path.realpath(GAMES_DIR)
    safe_file = os.path.realpath(html_path)
    if not safe_file.startswith(safe_dir):
        raise HTTPException(status_code=403, detail="非法文件路径")

    with open(html_path, encoding="utf-8") as f:
        html_content = f.read()

    return HTMLResponse(
        content=html_content,
        headers={
            "Cache-Control": "private, max-age=300",
            # 不设 X-Frame-Options，允许跨域 <iframe> 嵌入游戏预览
            # 安全性由前端 sandbox="allow-scripts" 保证
        },
    )


# ─────────────────────────────────────────────────────────────────────────────
# 7. 获取游戏 HTML 源码（供代码预览组件展示）
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/games/{game_id}/source")
def get_game_source(
    game_id: str,
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db),
):
    """返回游戏 HTML 源码字符串和元信息，供代码预览组件展示。"""
    game = db.query(Game).filter(
        Game.id == game_id,
        Game.user_id == current_user.id,
    ).first()
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    if game.status != "completed" or not game.html_file:
        raise HTTPException(status_code=202, detail="游戏尚未生成完成")

    html_path = os.path.join(GAMES_DIR, game.html_file)
    if not os.path.exists(html_path):
        raise HTTPException(status_code=404, detail="游戏文件不存在")

    with open(html_path, encoding="utf-8") as f:
        html_code = f.read()

    return {
        "game_id":    game_id,
        "title":      game.title,
        "game_type":  game.game_type,
        "version":    game.version,
        "html_code":  html_code,
        "char_count": len(html_code),
    }


# ─────────────────────────────────────────────────────────────────────────────
# 8. 删除游戏
# ─────────────────────────────────────────────────────────────────────────────

@router.delete("/games/{game_id}", status_code=204)
def delete_game(
    game_id: str,
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db),
):
    """删除游戏记录及对应 HTML 文件。"""
    game = db.query(Game).filter(
        Game.id == game_id,
        Game.user_id == current_user.id,
    ).first()
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")

    if game.html_file:
        html_path = os.path.join(GAMES_DIR, game.html_file)
        if os.path.exists(html_path):
            os.remove(html_path)

    db.delete(game)
    db.commit()
    return None
