"""
自动诊断脚本：自动登录、取最新 session，发 PPT 修改指令，打印所有 SSE 事件帧
用法: conda run -n eduagent python diag_tool_auto.py
"""
import requests, json, sys

BASE_URL = "http://127.0.0.1:8000/api/v1"
USER_MSG = "请帮我把第一页PPT的标题改成'深度学习导论'"

# ── 1. 自动登录（取数据库第一个用户）────────────────────────────────
from app.db.session import SessionLocal
from app.models.user import User
from app.models.session import SessionContext

db = SessionLocal()
try:
    user = db.query(User).first()
    if not user:
        print("ERROR: 数据库里没有用户，请先注册一个。"); sys.exit(1)
    print(f"[LOGIN] Using user: {user.username} / {user.id}")

    # 使用 test_token 直接 forge JWT（开发专用）
    from app.core.security import create_access_token
    token = create_access_token(subject=user.id)

    # 取最新 session
    session = db.query(SessionContext).filter(SessionContext.user_id == user.id).order_by(SessionContext.created_at.desc()).first()
    if not session:
        print("ERROR: 该用户没有任何 Session，请先创建一个。"); sys.exit(1)
    session_id = session.id
    print(f"[SESSION] Using session: {session_id} ({session.course_name})\n")
finally:
    db.close()

# ── 2. 向 /chat 发流式请求 ──────────────────────────────────────────
headers = {
    "Authorization": f"Bearer {token}",
    "Content-Type": "application/json",
    "Accept": "text/event-stream",
}
print(f">>> 消息: {USER_MSG!r}\n{'='*60}")

resp = requests.post(
    f"{BASE_URL}/sessions/{session_id}/chat",
    headers=headers,
    json={"content": USER_MSG},
    stream=True,
    timeout=(10, 120),
)
print(f"HTTP Status: {resp.status_code}\n")

text_buf = ""
for raw in resp.iter_lines():
    if not raw:
        continue
    line = raw.decode("utf-8") if isinstance(raw, bytes) else raw
    if not line.startswith("data: "):
        print(f"[RAW] {line}")
        continue
    data_str = line[6:].strip()
    try:
        data = json.loads(data_str)
    except Exception:
        print(f"[PARSE_ERR] {data_str[:120]}")
        continue

    ev = data.get("event_type", "text")
    if ev == "text":
        chunk = data.get("chunk", "")
        if data.get("is_finished"):
            intent = data.get("extracted_intent", "")
            text_preview = text_buf[:80]
            print(f"\n[FINISHED] text_so_far={text_preview!r}")
            print(f"[FINISHED] extracted_intent={intent!r}")
        elif chunk:
            text_buf += chunk
            sys.stdout.write(chunk)
            sys.stdout.flush()
    elif ev == "thinking":
        print(f"\n[THINKING] {data.get('chunk','')[:80]!r}")
    elif ev == "tool_call":
        print(f"\n[TOOL_CALL ↓] {json.dumps(data.get('tool_call'), ensure_ascii=False)}")
    elif ev == "tool_result":
        print(f"\n[TOOL_RESULT ↑] {json.dumps(data.get('tool_result'), ensure_ascii=False)}")
    else:
        print(f"\n[{ev}] {data_str[:120]}")

print(f"\n{'='*60}\n>>> 诊断完成")
