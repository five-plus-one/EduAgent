import requests
import time
from app.core.config import settings

url = f"{settings.OPENAI_API_BASE.rstrip('/')}/chat/completions"
headers = {
    "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
    "Content-Type": "application/json"
}
payload = {
    "model": settings.LLM_MODEL,
    "messages": [{"role": "user", "content": "hello"}],
    "temperature": 0.3
}
start = time.time()
print(f"[{time.strftime('%H:%M:%S')}] Sending request...")
try:
    response = requests.post(url, headers=headers, json=payload, timeout=60)
    print(f"[{time.strftime('%H:%M:%S')}] Got Status:", response.status_code)
except Exception as e:
    print(f"[{time.strftime('%H:%M:%S')}] Error:", str(e))
print(f"Total time: {time.time() - start:.2f}s")
