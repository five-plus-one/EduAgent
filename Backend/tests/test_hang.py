import time
import sys
import threading
from app.core.config import settings
from app.services.courseware_generator import _get_llm
from langchain_openai import ChatOpenAI
from httpx import ReadTimeout

def test_llm():
    print("Testing ChatOpenAI with doubao-seed-1-8...")
    llm = ChatOpenAI(
        model=settings.LLM_MODEL,
        api_key=settings.OPENAI_API_KEY,
        base_url=settings.OPENAI_API_BASE,
        temperature=0.3,
        timeout=10, 
        max_retries=0
    )
    start_time = time.time()
    try:
        response = llm.invoke("respond with the word HI only")
        print("Success! output:", response.content)
    except Exception as e:
        print("Exception caught:", str(e))
    finally:
        print(f"Time taken: {time.time() - start_time:.2f}s")
        
test_llm()
