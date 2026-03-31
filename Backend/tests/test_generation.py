import sys
from app.db.session import SessionLocal
from app.models.session import Message
from app.core.config import settings
import requests
import json
import re

db = SessionLocal()
session_id = db.query(Message).first().session_id
messages = db.query(Message).filter(Message.session_id == session_id).order_by(Message.created_at).all()
history_str = "\n".join([f"{m.role}: {m.content}" for m in messages])
rag_context = ""
prompt = f"""
你是一位高级教学总监和课程设计专家。根据下方的聊天记录与知识参考，设计一份严谨的课件大纲。
禁止生成其他无关文本，**绝对且只能返回符合要求的JSON字面量**！
        
【聊天意图上下文】
{history_str}
        
【RAG参考材料】
{rag_context}
        
期望返回的最外层是一个对象包含：
"ppt_data": 一个数组，每一项代表一页幻灯片 (page_index, layout_type, title, speaker_notes, elements)。
"word_markdown": "# 综合讲义..."
        
layout_type枚举: cover, standard, two_column, image_gallery
elements对象包含: element_id, type(text_block或image), position(center/left/right/right_top/right_bottom), content(字符串数组)。
        
请至少生成3页课件内容。
"""
db.close()
url = f"{settings.OPENAI_API_BASE.rstrip('/')}/chat/completions"
headers = {"Authorization": f"Bearer {settings.OPENAI_API_KEY}", "Content-Type": "application/json"}
payload = {"model": settings.LLM_MODEL, "messages": [{"role": "user", "content": prompt}], "temperature": 0.3}

import time
print(f"[{time.strftime('%H:%M:%S')}] Sending large prompt (len: {len(prompt)})...")
start = time.time()
try:
    response = requests.post(url, headers=headers, json=payload, timeout=60)
    print(f"[{time.strftime('%H:%M:%S')}] Got Status:", response.status_code)
    try:
        data = response.json()
        content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
        print(f"Content length: {len(content)}")
        json_match = re.search(r"\{.*\}", content, re.DOTALL)
        if json_match:
            print("Successfully extracted JSON!")
            print(json.loads(json_match.group(0)).keys())
        else:
            print("Failed to find JSON in content:", content[:100])
    except Exception as parse_e:
        print("Parse error:", parse_e)
        print("Response text:", response.text[:200])
except Exception as e:
    print(f"[{time.strftime('%H:%M:%S')}] Error:", str(e))
print(f"Total time elapsed: {time.time() - start:.2f}s")
