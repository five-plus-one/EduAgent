"""
games.py — 互动小游戏 API 路由
/api/v1/games/...
"""
import os
import json
import uuid
import asyncio
import logging
import secrets
import string
from datetime import datetime, timezone, timedelta

import httpx
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Request
from fastapi.responses import HTMLResponse, StreamingResponse
from pydantic import BaseModel, Field
from typing import Optional, List, AsyncGenerator
from sqlalchemy.orm import Session
from sqlalchemy import update as sql_update

from app.api import deps
from app.models.user import User
from app.models.game import Game
from app.models.game_share import GameShare
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
    # ── 初始验证：支持 task_id（gtask_xxx）或 game_id（game_xxx）两种格式 ─────
    task = db.query(GenerationTask).filter(
        GenerationTask.id == task_id,
        GenerationTask.task_type == "game",
    ).first()

    # 前端可能直接传 game_id，按 result_data->game_id 反查对应任务
    if not task and task_id.startswith("game_"):
        from sqlalchemy import cast, String
        tasks = db.query(GenerationTask).filter(
            GenerationTask.task_type == "game",
        ).all()
        for t in tasks:
            if (t.result_data or {}).get("game_id") == task_id:
                task = t
                break

    if not task:
        # 最后兜底：用 game_id 直接查是否存在游戏，若已 completed 直接返回 done
        if task_id.startswith("game_"):
            direct_game = db.query(Game).filter(
                Game.id == task_id,
                Game.user_id == current_user.id,
            ).first()
            if direct_game and direct_game.status == "completed" and direct_game.html_file:
                async def _direct_done():
                    yield _sse({
                        "event_type": "done",
                        "game_id":    direct_game.id,
                        "html_file":  direct_game.html_file,
                        "version":    direct_game.version,
                        "progress":   100,
                    })
                return StreamingResponse(
                    _direct_done(),
                    media_type="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
                )
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

    # ── 纯监视模式：不再做 LLM 生成，只跟踪后台任务进度 ──────────────────────
    # 后台线程已经立即开始（run_game_task 无睡眠），SSE 只需等待 + 转发进度。
    # 断开重连均安全：后台任务不依赖 SSE 连接。
    game_id_cap    = game_id
    task_id_cap    = task_id
    user_id_cap    = current_user.id

    async def event_generator() -> AsyncGenerator[str, None]:
        from app.services.game_generator import _task_chunks, _task_chunks_lock

        yield _sse({"event_type": "stage", "stage": "preparing",
                    "progress": 5, "message": "后台生成任务运行中..."})

        last_chunk_idx = 0
        last_stage     = ""
        hb_tick        = 0
        MAX_TICKS      = 720   # 最长等待 6 分钟（0.5s × 720）

        for tick in range(MAX_TICKS):
            await asyncio.sleep(0.5)

            # ── 读取新的代码块（来自后台线程的 chunk 缓冲区） ────────────────
            with _task_chunks_lock:
                buf = _task_chunks.get(task_id_cap)
                # 在锁内复制一份 list，避免后台线程同时 append 时的 race
                new_chunks = list(buf["chunks"][last_chunk_idx:]) if buf else None
                buf_done   = buf["done"]   if buf else False
                buf_failed = buf.get("failed", False) if buf else False

            if new_chunks is not None:
                # 已有 chunk 缓冲区
                if new_chunks:
                    ESTIMATED = 9000
                    for i, chunk in enumerate(new_chunks):
                        prog = min(10 + int((last_chunk_idx + i + 1) / ESTIMATED * 85), 96)
                        yield _sse({
                            "event_type": "code_chunk",
                            "chunk":      chunk,
                            "progress":   prog,
                        })
                    last_chunk_idx += len(new_chunks)
                else:
                    # 缓冲区存在但为空（LLM 在思考）→ 发送心跳
                    hb_tick += 1
                    yield _sse({
                        "event_type": "thinking_heartbeat",
                        "tick":       hb_tick,
                        "message":    "AI 深度思考中...",
                    })
            else:
                # chunk 缓冲区不存在 → 后台任务还未初始化
                if tick < 10:
                    yield _sse({"event_type": "stage", "stage": "preparing",
                                "progress": 5, "message": "等待后台任务启动..."})


            # ── 轮询 DB 状态 ──────────────────────────────────────────────────
            def _poll_db():
                _db = SessionLocal()
                try:
                    g = _db.query(Game).filter(Game.id == game_id_cap).first()
                    t = _db.query(GenerationTask).filter(
                        GenerationTask.id == task_id_cap).first()
                    return (
                        g.status    if g else None,
                        g.html_file if g else None,
                        g.version   if g else 1,
                        g.error     if g else None,
                        t.stage     if t else None,
                        t.progress  if t else 0,
                    )
                finally:
                    _db.close()

            g_status, g_html, g_ver, g_err, t_stage, t_prog = \
                await asyncio.to_thread(_poll_db)

            if g_status == "completed":
                # 最后刷一次 chunk 缓冲区（后台线程可能刚好同时完成）
                buf2 = _task_chunks.get(task_id_cap)
                if buf2:
                    for chunk in buf2["chunks"][last_chunk_idx:]:
                        yield _sse({"event_type": "code_chunk", "chunk": chunk, "progress": 96})
                yield _sse({
                    "event_type": "done",
                    "game_id":    game_id_cap,
                    "html_file":  g_html,
                    "version":    g_ver,
                    "progress":   100,
                })
                return

            if g_status == "failed":
                yield _sse({
                    "event_type": "error",
                    "message":    g_err or "游戏生成失败，请重试",
                    "progress":   0,
                })
                return

            # 发送阶段进度（避免重复发送同一 stage）
            if t_stage and t_stage != last_stage and t_stage != "done":
                last_stage = t_stage
                label = {
                    "building_prompt":  "构建 prompt...",
                    "generating_html":  "AI 正在生成游戏代码...",
                    "extracting_html":  "提取 HTML...",
                }.get(t_stage, t_stage)
                yield _sse({
                    "event_type": "stage",
                    "stage":      t_stage,
                    "progress":   t_prog,
                    "message":    label,
                })

        # 超时
        yield _sse({"event_type": "error", "message": "生成超时，请稍后刷新查看结果", "progress": 0})

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )




# ─────────────────────────────────────────────────────────────────────────────
# 4. 查询生成任务进度（轮询降级）





@router.get("/games/tasks/{task_id}")
def get_game_task_status(
    task_id: str,
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db),
):
    """轮询游戏生成任务状态（SSE 降级用）。completed 时 result.game_id 可用。

    task_id 支持传 gtask_xxx（任务ID）或 game_xxx（游戏ID）两种格式，兼容旧版前端。
    """
    # 优先按任务ID查
    task = db.query(GenerationTask).filter(
        GenerationTask.id == task_id,
        GenerationTask.task_type == "game",
    ).first()

    # 前端传了 game_id → 按 result_data->game_id 反查对应任务
    if not task and task_id.startswith("game_"):
        tasks = db.query(GenerationTask).filter(
            GenerationTask.task_type == "game",
        ).all()
        for t in tasks:
            if (t.result_data or {}).get("game_id") == task_id:
                task = t
                break

    # 最后兜底：直接查 Game 表，合成一个虚拟任务响应
    if not task and task_id.startswith("game_"):
        game = db.query(Game).filter(
            Game.id == task_id,
            Game.user_id == current_user.id,
        ).first()
        if game:
            # 用 Game 的状态合成轮询响应
            status_map = {
                "completed": "completed",
                "pending":   "generating",
                "generating":"generating",
                "streaming": "generating",
                "failed":    "failed",
            }
            return {
                "task_id":  task_id,
                "status":   status_map.get(game.status, "generating"),
                "stage":    "done" if game.status == "completed" else "generating_html",
                "progress": 100 if game.status == "completed" else 50,
                "result":   {
                    "game_id":   game.id,
                    "html_file": game.html_file or "",
                    "version":   game.version,
                } if game.status == "completed" else {},
            }
        raise HTTPException(status_code=404, detail="Task not found")

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


# ═══════════════════════════════════════════════════════════════════════════════
# 游戏公开分享 & 短链接系统
# ═══════════════════════════════════════════════════════════════════════════════

_SHARE_ALPHABET = string.ascii_letters + string.digits  # Base62

def _generate_code(length: int = 6) -> str:
    """生成 URL-safe Base62 随机短码。"""
    return "".join(secrets.choice(_SHARE_ALPHABET) for _ in range(length))


# ─────────────────────────────────────────────────────────────────────────────
# Schemas（分享）
# ─────────────────────────────────────────────────────────────────────────────

class CreateShareRequest(BaseModel):
    expires_in_days: Optional[int] = Field(None, ge=1, le=3650, description="有效天数；不传表示永不过期")


# ─────────────────────────────────────────────────────────────────────────────
# 9. 创建分享短链接（需登录）
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/games/{game_id}/share")
def create_share_link(
    game_id: str,
    body: CreateShareRequest = CreateShareRequest(),
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db),
    request: Request = None,
):
    """
    为指定游戏生成一个公开短链接（无需登录即可访问）。

    - 同一 game_id 最多允许 10 个有效分享链接
    - 若用户已有永久有效链接且未传 expires_in_days，直接复用
    - 短码 6 位 Base62，碰撞时自动重试
    """
    game = db.query(Game).filter(
        Game.id == game_id,
        Game.user_id == current_user.id,
    ).first()
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")
    if game.status != "completed":
        raise HTTPException(status_code=400, detail="游戏尚未生成完成，无法分享")

    # 若调用方没有传过期天数，尝试复用已有的永久链接
    if body.expires_in_days is None:
        existing = db.query(GameShare).filter(
            GameShare.game_id == game_id,
            GameShare.created_by == current_user.id,
            GameShare.is_active == True,
            GameShare.expires_at == None,
        ).first()
        if existing:
            short_url = f"/s/{existing.code}"
            return {
                "code":           existing.code,
                "short_url":      short_url,
                "full_short_url": f"{settings.SERVER_URL}{short_url}",
                "game_id":        game_id,
                "game_title":     game.title,
                "created_at":     existing.created_at,
                "expires_at":     existing.expires_at,
            }

    # 检查有效分享数量上限（10 条）
    active_count = db.query(GameShare).filter(
        GameShare.game_id == game_id,
        GameShare.created_by == current_user.id,
        GameShare.is_active == True,
    ).count()
    if active_count >= 10:
        raise HTTPException(status_code=429, detail="同一游戏最多创建 10 个有效分享链接")

    # 生成唯一短码（碰撞重试）
    for _ in range(10):
        code = _generate_code()
        if not db.query(GameShare).filter(GameShare.code == code).first():
            break
    else:
        raise HTTPException(status_code=500, detail="短码生成失败，请重试")

    expires_at = None
    if body.expires_in_days:
        expires_at = datetime.now(timezone.utc) + timedelta(days=body.expires_in_days)

    share = GameShare(
        code       = code,
        game_id    = game_id,
        created_by = current_user.id,
        expires_at = expires_at,
    )
    db.add(share)
    db.commit()

    short_url = f"/s/{code}"
    return {
        "code":           code,
        "short_url":      short_url,
        "full_short_url": f"{settings.SERVER_URL}{short_url}",
        "game_id":        game_id,
        "game_title":     game.title,
        "created_at":     share.created_at,
        "expires_at":     expires_at,
    }


# ─────────────────────────────────────────────────────────────────────────────
# 10. 获取游戏的分享链接列表（需登录）
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/games/{game_id}/shares")
def list_share_links(
    game_id: str,
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db),
):
    """返回该游戏所有分享链接（仅创建者可见），包括已停用的。"""
    game = db.query(Game).filter(
        Game.id == game_id,
        Game.user_id == current_user.id,
    ).first()
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")

    shares = (
        db.query(GameShare)
        .filter(GameShare.game_id == game_id, GameShare.created_by == current_user.id)
        .order_by(GameShare.created_at.desc())
        .all()
    )
    return {
        "shares": [
            {
                "code":       s.code,
                "short_url":  f"/s/{s.code}",
                "created_at": s.created_at,
                "expires_at": s.expires_at,
                "view_count": s.view_count,
                "is_active":  s.is_active,
            }
            for s in shares
        ]
    }


# ─────────────────────────────────────────────────────────────────────────────
# 11. 停用分享链接（需登录）
# ─────────────────────────────────────────────────────────────────────────────

@router.delete("/games/shares/{code}", status_code=200)
def deactivate_share_link(
    code: str,
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db),
):
    """停用（软删除）指定短码。停用后 /s/{code} 返回 410。"""
    share = db.query(GameShare).filter(
        GameShare.code == code,
        GameShare.created_by == current_user.id,
    ).first()
    if not share:
        raise HTTPException(status_code=404, detail="Share link not found")

    share.is_active = False
    db.commit()
    return {"ok": True}


# ─────────────────────────────────────────────────────────────────────────────
# 12. 公开接口：通过短码获取游戏内容（无需登录，落地页用）
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/public/games/share/{code}")
def get_public_game_by_code(
    code: str,
    db: Session = Depends(deps.get_db),
):
    """
    公开接口，无需鉴权。
    前端 `/play/:code` 落地页调用此接口获取游戏标题 + 完整 HTML。
    返回的 html_content 直接用 srcdoc 注入 <iframe>。
    """
    share = db.query(GameShare).filter(GameShare.code == code).first()
    if not share:
        raise HTTPException(status_code=404, detail="链接不存在或已被删除")
    if not share.is_active:
        raise HTTPException(status_code=410, detail="该分享链接已被创建者停用")
    if share.expires_at:
        exp = share.expires_at
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        if exp < datetime.now(timezone.utc):
            raise HTTPException(status_code=410, detail="该分享链接已超过有效期")

    game = db.query(Game).filter(Game.id == share.game_id).first()
    if not game or game.status != "completed" or not game.html_file:
        raise HTTPException(status_code=404, detail="游戏内容尚未就绪")

    html_path = os.path.join(GAMES_DIR, game.html_file)
    if not os.path.exists(html_path):
        raise HTTPException(status_code=404, detail="游戏文件不存在，可能需要重新生成")

    # 路径穿越防护
    safe_dir  = os.path.realpath(GAMES_DIR)
    safe_file = os.path.realpath(html_path)
    if not safe_file.startswith(safe_dir):
        raise HTTPException(status_code=403, detail="非法文件路径")

    with open(html_path, encoding="utf-8") as f:
        html_content = f.read()

    return {
        "code":         code,
        "game_id":      game.id,
        "title":        game.title,
        "game_type":    game.game_type,
        "html_content": html_content,
        "created_at":   share.created_at,
    }
