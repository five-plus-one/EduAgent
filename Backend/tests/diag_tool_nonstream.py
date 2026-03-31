"""
非流式 Tool Calling 快速验证
对比两个模型：doubao-seed-1-8 vs doubao-seed-2-0-pro
"""
import requests, json

key = open('.env').read().strip().split('=', 1)[1].strip().strip('"')
PROXY = "https://api.ai.five-plus-one.com/v1"
HEADERS = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}

TOOLS = [{
    "type": "function",
    "function": {
        "name": "UpdateSlide",
        "description": "修改PPT某页内容",
        "parameters": {
            "type": "object",
            "properties": {
                "page_index": {"type": "integer"},
                "new_content": {"type": "string"}
            },
            "required": ["page_index", "new_content"]
        }
    }
}]

MESSAGES = [
    {"role": "system", "content": "你是助手，当用户要求修改PPT时必须调用 UpdateSlide 工具。"},
    {"role": "user",   "content": "把第1页标题改成'深度学习导论'"}
]

def test_model(model_id, use_thinking=False):
    print(f"\n{'='*60}")
    print(f"测试模型: {model_id}  thinking={use_thinking}")
    payload = {
        "model": model_id,
        "messages": MESSAGES,
        "tools": TOOLS,
        "tool_choice": "auto",
        "stream": False,       # 非流式，直接拿完整 JSON
        "max_tokens": 512,
    }
    if use_thinking:
        payload["thinking"] = {"type": "enabled", "budget_tokens": 1000}
    
    try:
        r = requests.post(f"{PROXY}/chat/completions",
                          headers=HEADERS, json=payload, timeout=120)
        print(f"HTTP: {r.status_code}")
        data = r.json()
        
        if "error" in data:
            print(f"[API ERROR] {data['error']}")
            return
        
        choice = data["choices"][0]
        msg = choice["message"]
        finish = choice.get("finish_reason")
        print(f"finish_reason: {finish}")
        
        if msg.get("tool_calls"):
            print(f"[✅ TOOL_CALLS 存在!]")
            for tc in msg["tool_calls"]:
                print(f"  tool_name : {tc['function']['name']}")
                print(f"  arguments : {tc['function']['arguments']}")
        else:
            print(f"[❌ 没有 tool_calls]")
        
        if msg.get("reasoning_content"):
            rc = msg["reasoning_content"]
            print(f"reasoning_content: [{len(rc)} chars] {rc[:100]!r}...")
        
        if msg.get("content"):
            print(f"content: {msg['content'][:150]!r}")
    
    except requests.exceptions.Timeout:
        print("[TIMEOUT] 请求超时")
    except Exception as e:
        print(f"[EXCEPTION] {e}")

# 测试 1：seed-1-8（之前能工作的）
test_model("doubao-seed-1-8-251228")

# 测试 2：seed-2-0-pro 无思考
test_model("doubao-seed-2-0-pro-260215", use_thinking=False)

# 测试 3：seed-2-0-pro 带思考（看思考和 tool_call 是否并存）
test_model("doubao-seed-2-0-pro-260215", use_thinking=True)
