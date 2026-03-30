import uuid
import json
from sqlalchemy.orm import Session
from app.db.session import SessionLocal
from app.models.generation import GenerationTask, Courseware
from app.models.session import Message
from app.services.vector_store import search_vectors
from langchain_openai import ChatOpenAI
from app.core.config import settings

def _get_llm():
    return ChatOpenAI(
        model=settings.LLM_MODEL,
        api_key=settings.OPENAI_API_KEY,
        base_url=settings.OPENAI_API_BASE,
        temperature=0.3,
        request_timeout=60,
        max_retries=1
    )

def run_generation_task(task_id: str, session_id: str, selected_file_ids: list, generation_mode: str):
    db: Session = SessionLocal()
    task = db.query(GenerationTask).filter(GenerationTask.id == task_id).first()
    if not task:
        db.close()
        return

    try:
        task.stage = "gathering_context"
        task.progress = 10
        db.commit()

        # Gather history
        messages = db.query(Message).filter(Message.session_id == session_id).order_by(Message.created_at).all()
        history_str = "\n".join([f"{m.role}: {m.content}" for m in messages])

        # Gather RAG context
        rag_context = ""
        if selected_file_ids:
            task.stage = "searching_rag"
            task.progress = 30
            db.commit()
            last_msg = messages[-1].content if messages else "智能大纲提取"
            docs = search_vectors(query=last_msg, filter_document_ids=selected_file_ids, top_k=6)
            rag_context = "\n---\n".join([d.page_content for d in docs])

        task.stage = "generating_slides"
        task.progress = 50
        db.commit()

        # LLM Structural Call
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
        import requests
        content = ""
        last_e = None
        for _ in range(3):
            try:
                url = f"{settings.OPENAI_API_BASE.rstrip('/')}/chat/completions"
                headers = {"Authorization": f"Bearer {settings.OPENAI_API_KEY}", "Content-Type": "application/json"}
                payload = {"model": settings.LLM_MODEL, "messages": [{"role": "user", "content": prompt}], "temperature": 0.3, "stream": True}
                
                response = requests.post(url, headers=headers, json=payload, stream=True, timeout=60)
                response.raise_for_status()
                for line in response.iter_lines():
                    if line:
                        line_str = line.decode('utf-8')
                        if line_str.startswith("data: ") and line_str != "data: [DONE]":
                            try:
                                import json
                                chunk_data = json.loads(line_str[6:])
                                content += chunk_data.get("choices", [{}])[0].get("delta", {}).get("content", "")
                            except:
                                pass
                if content:
                    break
            except Exception as e:
                last_e = e
                import time
                time.sleep(2)
        if not content:
            raise Exception(f"Upstream Error after 3 retries: {str(last_e)}")
        
        # Strip markdown syntax if LLM returns it block-wrapped
        if "```" in content:
            content = content.split("```json")[-1].split("```")[0].strip()
        if content.startswith("```"):
            content = content.replace("```", "").strip()
            
        import re
        json_match = re.search(r"\{.*\}", content, re.DOTALL)
        if json_match:
            content = json_match.group(0)
            
        parsed_data = json.loads(content)

        task.stage = "saving_database"
        task.progress = 90
        db.commit()

        courseware = db.query(Courseware).filter(Courseware.session_id == session_id).first()
        if not courseware:
            courseware = Courseware(id="cw_" + uuid.uuid4().hex[:8], session_id=session_id)
            db.add(courseware)
        
        courseware.ppt_data = parsed_data.get("ppt_data", [])
        courseware.word_markdown = parsed_data.get("word_markdown", "")
        
        task.status = "completed"
        task.progress = 100
        db.commit()

    except Exception as e:
        task.status = "failed"
        task.result_data = {"error": str(e)}
        db.commit()
    finally:
        db.close()
