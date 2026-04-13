"""
games.py — 互动小游戏 API 路由
/api/v1/games/...
"""
import os
import re
import uuid
import logging

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Query
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel, Field
from typing import Optional, List
from sqlalchemy.orm import Session

from app.api import deps
from app.models.user import User
from app.models.game import Game
from app.models.generation import GenerationTask
from app.models.session import SessionContext
from app.services.game_generator import run_game_task, GAMES_DIR, GAME_TYPE_META
from app.db.session import SessionLocal
from app.api.deps import get_current_user_or_token   # supports ?token= for iframe

logger = logging.getLogger(__name__)

router = APIRouter()

# ─────────────────────────────────────────────────────────────────────────────
# Schemas
# ─────────────────────────────────────────────────────────────────────────────

class GameSpec(BaseModel):
    game_type:              str             = Field(..., description="quiz/memory/fillblank/sort/match/flashcard/custom")
    title:                  str             = Field(..., description="游戏标题")
    key_topics:             List[str]       = Field(default_factory=list)
    custom_requirements:    Optional[str]   = None
    is_refinement:          bool            = False
    refinement_instruction: Optional[str]  = None   # 仅 is_refinement=true 时填写

class GenerateGameRequest(BaseModel):
    spec:           GameSpec
    refine_game_id: Optional[str] = None   # 若为精炼已有游戏，传入 game_id


# ─────────────────────────────────────────────────────────────────────────────
# 1. 获取游戏类型列表（选色 UI 用）
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/types")
def list_game_types():
    """列出所有支持的游戏类型及说明，供前端展示选型菜单。"""
    return {
        "types": [
            {
                "key":   k,
                "label": v["label"],
                "hint":  v["hint"],
            }
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
    触发游戏 HTML 生成任务。

    - `body.spec.is_refinement=false`（默认）：生成全新游戏
    - `body.spec.is_refinement=true` + `body.refine_game_id`：改进已有游戏（版本号 +1）

    立即返回 `task_id` 和 `game_id`，前端轮询 `/games/tasks/{task_id}` 查询进度。
    """
    # 验证 session 归属
    session_ctx = db.query(SessionContext).filter(
        SessionContext.id == session_id,
        SessionContext.user_id == current_user.id,
    ).first()
    if not session_ctx:
        raise HTTPException(status_code=404, detail="Session not found")

    spec_dict = body.spec.model_dump()
    is_refinement = body.spec.is_refinement

    if is_refinement:
        # 改进模式：复用已有 Game 记录
        if not body.refine_game_id:
            raise HTTPException(status_code=400, detail="精炼模式需要提供 refine_game_id")
        game = db.query(Game).filter(
            Game.id == body.refine_game_id,
            Game.user_id == current_user.id,
        ).first()
        if not game:
            raise HTTPException(status_code=404, detail="Game not found")
        if game.status == "generating":
            raise HTTPException(status_code=409, detail="游戏正在生成中，请稍后再试")
        game.status   = "generating"
        game.spec_json = spec_dict
        db.commit()
        game_id = game.id
    else:
        # 首次生成：新建 Game 记录
        game_id = "game_" + uuid.uuid4().hex[:8]
        game = Game(
            id         = game_id,
            session_id = session_id,
            user_id    = current_user.id,
            title      = body.spec.title,
            game_type  = body.spec.game_type,
            status     = "generating",
            spec_json  = spec_dict,
        )
        db.add(game)
        db.commit()

    # 创建 GenerationTask（复用既有任务系统）
    task_id = "gtask_" + uuid.uuid4().hex[:8]
    task = GenerationTask(
        id         = task_id,
        session_id = session_id,
        task_type  = "game",
        status     = "generating",
        stage      = "init",
    )
    db.add(task)
    db.commit()

    background_tasks.add_task(run_game_task, task_id, game_id, session_id, spec_dict)

    return {
        "task_id": task_id,
        "game_id": game_id,
        "status":  "generating",
        "is_refinement": is_refinement,
    }


# ─────────────────────────────────────────────────────────────────────────────
# 3. 查询生成任务进度
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/games/tasks/{task_id}")
def get_game_task_status(
    task_id: str,
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(deps.get_db),
):
    """轮询游戏生成任务状态。completed 时 result.game_id 可用于加载预览。"""
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
# 4. 列出 session 下所有已生成游戏
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
# 5. 游戏 HTML 预览（供 <iframe src="...?token="> 直接加载）
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/games/{game_id}/preview")
def preview_game(
    game_id: str,
    current_user: User = Depends(get_current_user_or_token),
    db: Session = Depends(deps.get_db),
):
    """
    返回游戏 HTML 文件，供 iframe inline 加载。
    支持 ?token= 参数（iframe 无法设置 Authorization header）。
    """
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

    # 路径穿越保护
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
            "X-Frame-Options": "SAMEORIGIN",
        },
    )


# ─────────────────────────────────────────────────────────────────────────────
# 6. 获取游戏 HTML 源码（供代码预览组件展示）
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
        "game_id":   game_id,
        "title":     game.title,
        "game_type": game.game_type,
        "version":   game.version,
        "html_code": html_code,
        "char_count": len(html_code),
    }


# ─────────────────────────────────────────────────────────────────────────────
# 7. 删除游戏
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
