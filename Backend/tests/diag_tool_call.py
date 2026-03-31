"""
诊断脚本：直接向后端发送 chat 请求，打印所有 SSE 事件帧
使用方法：python diag_tool_call.py <session_id> <token>
"""
import sys
import requests

# ── 配置区 ────────────────────────────────────────────────────────
BASE_URL = "http://127.0.0.1:8000/api/v1"
SESSION_ID = sys.argv[1] if len(sys.argv) > 1 else input("Session ID: ").strip()
TOKEN      = sys.argv[2] if len(sys.argv) > 2 else input("JWT Token: ").strip()
USER_MSG   = "请帮我把第一页PPT的标题改成'深度学习导论'"
# ─────────────────────────────────────────────────────────────────

headers = {
    "Authorization": f"Bearer {TOKEN}",
    "Content-Type": "application/json",
    "Accept": "text/event-stream",
}

print(f"\n>>> 发送消息: {USER_MSG!r}")
print(f">>> Session : {SESSION_ID}\n")

resp = requests.post(
    f"{BASE_URL}/sessions/{SESSION_ID}/chat",
    headers=headers,
    json={"content": USER_MSG},
    stream=True,
    timeout=(10, 120),
)

print(f"HTTP Status: {resp.status_code}\n{'='*60}")

import json
for raw in resp.iter_lines():
    if not raw:
        continue
    line = raw.decode("utf-8") if isinstance(raw, bytes) else raw
    if not line.startswith("data: "):
        print(f"[RAW NON-DATA] {line}")
        continue
    data_str = line[6:].strip()
    try:
        data = json.loads(data_str)
        ev_type = data.get("event_type", "?")
        if ev_type == "text":
            chunk = data.get("chunk", "")
            is_fin = data.get("is_finished", False)
            if is_fin:
                intent = data.get("extracted_intent", "")
                print(f"\n[FINISHED] extracted_intent={intent!r}")
            elif chunk:
                print(f"[TEXT] {chunk!r}")
        elif ev_type == "thinking":
            print(f"[THINKING] {data.get('chunk','')[:80]!r}...")
        elif ev_type == "tool_call":
            print(f"\n[TOOL_CALL ↓] {json.dumps(data.get('tool_call'), ensure_ascii=False)}")
        elif ev_type == "tool_result":
            print(f"[TOOL_RESULT ↑] {json.dumps(data.get('tool_result'), ensure_ascii=False)}")
        else:
            print(f"[{ev_type}] {data_str[:120]}")
    except json.JSONDecodeError:
        print(f"[PARSE_ERR] {data_str[:120]}")

print(f"\n{'='*60}\n>>> 诊断完成")
