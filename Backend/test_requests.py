import requests
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
print(f"Testing URL: {url} with model {settings.LLM_MODEL}")
try:
    response = requests.post(url, headers=headers, json=payload, timeout=15)
    print("Status:", response.status_code)
    print("Response:", response.text)
except Exception as e:
    print("Error:", str(e))
