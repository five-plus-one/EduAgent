"""
深度诊断：打印每一帧 delta 的完整 JSON，包括 reasoning_content 和 tool_calls
"""
import requests, json, sys, os

BASE_URL = "http://127.0.0.1:8000"  # 通过后端代理
# 或者直接打代理
PROXY_URL = "https://api.ai.five-plus-one.com/v1"

key = open('d:\\MyProject\\Repos\\EduAgent\\Backend\\.env').read().split('=')[1].strip().strip('"')

payload = {
    "model": "doubao-seed-2-0-pro-260215",
    "messages": [
        {"role": "system", "content": "你是一个助手。当用户要求修改PPT时，你必须调用 UpdateSlide 工具，不能用文字描述。"},
        {"role": "user", "content": "请帮我把第一页PPT的标题改成'深度学习导论'"}
    ],
    "tools": [
        {
            "type": "function",
            "function": {
                "name": "UpdateSlide",
                "description": "修改某一特定页PPT的内容。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "page_index": {"type": "integer", "description": "页码，从1开始"},
                        "new_content": {"type": "string", "description": "新内容"}
                    },
                    "required": ["page_index", "new_content"]
                }
            }
        }
    ],
    "tool_choice": "required",   # 强制必须调用工具
    "stream": True,
}

resp = requests.post(
    f"{PROXY_URL}/chat/completions",
    headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    json=payload,
    stream=True,
    timeout=(10, 60),
)

print(f"HTTP {resp.status_code}")
print("="*60)

tool_calls_seen = False
thinking_seen = False

for raw in resp.iter_lines():
    if not raw:
        continue
    line = raw.decode("utf-8") if isinstance(raw, bytes) else raw
    if not line.startswith("data: "):
        print(f"[META] {line}")
        continue
    data_str = line[6:]
    if data_str.strip() == "[DONE]":
        print("[DONE]")
        break
    try:
        chunk = json.loads(data_str)
    except Exception:
        print(f"[PARSE_ERR] {data_str[:80]}")
        continue
    
    choices = chunk.get("choices", [])
    if not choices:
        continue
    delta = choices[0].get("delta", {})
    finish_reason = choices[0].get("finish_reason")
    
    # 打印所有非空字段
    summary = {}
    if delta.get("reasoning_content"):
        summary["reasoning_content"] = f"[{len(delta['reasoning_content'])}chars]"
        thinking_seen = True
    if delta.get("content"):
        summary["content"] = delta["content"][:60]
    if delta.get("tool_calls"):
        summary["tool_calls"] = delta["tool_calls"]
        tool_calls_seen = True
    if finish_reason:
        summary["finish_reason"] = finish_reason
    
    if summary:
        print(json.dumps(summary, ensure_ascii=False))

print("="*60)
print(f"thinking_seen={thinking_seen}, tool_calls_seen={tool_calls_seen}")
if not tool_calls_seen:
    print("⚠️  没有收到任何 tool_calls 数组帧！")
    print("   可能原因: 1) 代理不支持此模型的 Function Call  2) 需要关闭思考模式")
