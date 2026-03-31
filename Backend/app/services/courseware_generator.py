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

        # LLM Structural Call with Advanced Museum-Quality Anthropics Design Skills
        prompt = f"""
        你是一位顶级设计巨匠、高级教学总监、排版大师和课程设计专家。
        根据下方的聊天记录与知识参考，创作一份极具视觉冲击力和设计感的大纲课件。
        禁止生成其他无关文本，绝对必须且只能返回合法的 JSON 字面量！
        
        【聊天意图上下文】
        {history_str}
        
        【RAG参考材料】
        {rag_context}
        
        【设计哲学 (Canvas Design & PPTX Rules)】
        1. 每一个页面的设计都需要遵循“Minimal Words, Maximum Visual Impact”(字要少而精，视觉冲击力要强)。
        2. 你的设计要如同艺术品般精心计算过留白 (Negative Space)、排版节奏和元素间的引力。绝不可产出千篇一律的白底黑字！
        3. 排版需多样化，至少使用2-3种不同的 layout_type，如左右拼图 (two_column)、数字字号对比突出的金句 (stat_callout)、或者干净极致的列表 (minimal_list)。
        4. Colors (Theme-Factory): 必须选用下列大师级调色板(theme)中的一组，并将其配置到全局：
           - "Midnight Galaxy": 背景 0B132B, 主色 1C2541, 次色 3A506B, 高亮 5BC0BE, 文字背景反差色 FFFFFF
           - "Ocean Depths": 背景 022B3A, 主色 1F7A8C, 次色 BFDBF7, 高亮 E1E5F2, 文字背景反差色 FFFFFF
           - "Sunset Boulevard": 背景 2B2D42, 主色 8D99AE, 次色 EDF2F4, 高亮 EF233C, 文字背景反差色 FFFFFF
           - "Modern Minimalist": 背景 F2F2F2, 主色 36454F, 次色 E5E5E5, 高亮 212121, 文字背景反差色 000000
           
        【期望返回的最外层JSON结构】
        {{
            "design_philosophy": "一段描述这套PPT的美学理念，比如'Chromatic Language'，强调工艺感和信息降噪。",
            "theme": {{
                "name": "选中的主题名称",
                "bg_color": "HEX码",
                "primary": "HEX码",
                "secondary": "HEX码",
                "accent": "HEX码",
                "text_color": "HEX码"
            }},
            "ppt_data": [
                {{
                    "page_index": 1,
                    "layout_type": "title_slide|two_column|stat_callout|minimal_list",
                    "title": "简短而霸气的单行标题",
                    "speaker_notes": "演讲者注记",
                    "elements": [
                        {{
                            "element_id": "e_xxxx",
                            "type": "text_block|huge_number",
                            "position": "center|left|right|top_left|bottom_right",
                            "content": ["短句1", "短句2..."],
                            "is_accent": true|false
                        }}
                    ]
                }}
            ],
            "word_markdown": "# 综合讲义..."
        }}
        请至少生成3页课件内容。严格符合JSON对象格式。
        """
        import requests
        content = ""
        last_e = None
        for _ in range(3):
            try:
                url = f"{settings.OPENAI_API_BASE.rstrip('/')}/chat/completions"
                headers = {"Authorization": f"Bearer {settings.OPENAI_API_KEY}", "Content-Type": "application/json"}
                # Force Advanced Model to handle the massive JSON instruction
                payload = {"model": "doubao-seed-2-0-pro-260215", "messages": [{"role": "user", "content": prompt}], "temperature": 0.4, "stream": True}
                
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
        
        # Save the full structured JSON including theme and philosophy
        courseware.ppt_data = parsed_data
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

import asyncio
from httpx import AsyncClient

async def stream_generation(session_id: str, selected_file_ids: list, generation_mode: str):
    """
    异步流式生成核心函数，输出 NDJSON 格式供 SSE 使用。
    """
    db = SessionLocal()
    try:
        # Check if already generating
        courseware = db.query(Courseware).filter(Courseware.session_id == session_id).first()
        if not courseware:
            courseware = Courseware(id="cw_" + uuid.uuid4().hex[:8], session_id=session_id)
            courseware.ppt_data = {"ppt_data": []}
            db.add(courseware)
            db.commit()
            
        messages = db.query(Message).filter(Message.session_id == session_id).order_by(Message.created_at).all()
        history_str = "\n".join([f"{m.role}: {m.content}" for m in messages])

        rag_context = ""
        if selected_file_ids:
            last_msg = messages[-1].content if messages else "智能大纲提取"
            docs = search_vectors(query=last_msg, filter_document_ids=selected_file_ids, top_k=6)
            rag_context = "\n---\n".join([d.page_content for d in docs])

        prompt = f"""
        你是一位顶级设计巨匠、高级教学总监、排版大师。
        请根据聊天记录与知识参考创作课程大纲。
        
        【聊天上下文】
        {history_str}
        
        【RAG参考材料】
        {rag_context}
        
        【输出格式的严格规定】
        你必须严格按照以下 NDJSON（换行分隔 JSON）格式逐行输出，每行是一个独立的合法 JSON 对象。
        绝对禁止输出任何 Markdown 围栏（```）、解释性文字或前置说明！

        第一行，输出主题定义：
        {{"__type": "theme", "name": "主题名称", "bg_color": "#HEX", "primary": "#HEX", "secondary": "HEX", "accent": "HEX", "text_color": "#HEX"}}

        然后，每一页幻灯片输出一行，以 page_index 升序排列：
        {{"__type": "page", "page_index": 1, "layout_type": "cover", "title": "...", "speaker_notes": "...", "elements": [...]}}
        {{"__type": "page", "page_index": 2, "layout_type": "two_column", ...}}
        （以此类推，至少生成3页）

        所有幻灯片行输出完毕后，输出此分隔行：
        {{"__type": "word_start"}}

        紧接着输出完整的 Word 讲义 Markdown 文本（可跨多行）。

        最终以此行结束全部输出：
        {{"__type": "done"}}
        """

        def sse(event: str, data: dict):
            return f"data: {json.dumps({{'event': event, 'data': data}}, ensure_ascii=False)}\n\n"

        url = f"{settings.OPENAI_API_BASE.rstrip('/')}/chat/completions"
        headers = {
            "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
            "Content-Type": "application/json"
        }
        payload = {
            "model": "doubao-seed-2-0-pro-260215",
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.4,
            "stream": True
        }

        buffer = ""
        word_mode = False
        word_lines = []
        page_count = 0
        theme_saved = False

        import httpx
        timeout_config = httpx.Timeout(connect=15.0, read=600.0, write=15.0, pool=20.0)
        async with AsyncClient(timeout=timeout_config) as client:
            async with client.stream("POST", url, headers=headers, json=payload) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if line.startswith("data: "):
                        line_content = line[6:]
                        if line_content == "[DONE]":
                            break
                        try:
                            chunk = json.loads(line_content)
                            delta = chunk.get("choices", [{}])[0].get("delta", {}).get("content", "")
                            if not delta:
                                continue
                            
                            if word_mode:
                                word_lines.append(delta)
                                word_buffer = "".join(word_lines)
                                if '{"__type": "done"}' in word_buffer or '{"__type":"done"}' in word_buffer:
                                    # Write word markdown
                                    clean_word = word_buffer.replace('{"__type": "done"}', '').replace('{"__type":"done"}', '').strip()
                                    courseware.word_markdown = clean_word
                                    db.commit()
                                    yield sse("generate_done", {"total_pages": page_count})
                                    break
                                continue

                            buffer += delta
                            # Try to extract lines from buffer
                            while "\n" in buffer:
                                line_str, buffer = buffer.split("\n", 1)
                                line_str = line_str.strip()
                                if not line_str:
                                    continue
                                
                                try:
                                    obj = json.loads(line_str)
                                    t = obj.get("__type")
                                    if t == "theme":
                                        obj.pop("__type", None)
                                        # Set theme logic here if we saved theme to CW
                                        if "theme" in courseware.ppt_data:
                                            courseware.ppt_data["theme"] = obj
                                        else:
                                            # If not dict, initialize
                                            courseware.ppt_data = {**courseware.ppt_data, "theme": obj} 
                                            
                                        db.commit()
                                        theme_saved = True
                                        yield sse("generate_start", {"theme": obj, "total_hint": 8})
                                    elif t == "page":
                                        obj.pop("__type", None)
                                        current_pages = courseware.ppt_data.get("ppt_data", [])
                                        current_pages.append(obj)
                                        courseware.ppt_data = {**courseware.ppt_data, "ppt_data": current_pages}
                                        db.commit()
                                        page_count += 1
                                        yield sse("page_chunk", obj)
                                    elif t == "word_start":
                                        word_mode = True
                                        
                                except json.JSONDecodeError:
                                    # Fallback if line wasn't exactly complete JSON. Reattach to buffer string
                                    buffer = line_str + "\n" + buffer
                                    break # Need more chunks to complete JSON line

                        except json.JSONDecodeError:
                            continue
                            
        # Final cleanup for word markdown if it didn't cleanly hit done
        if word_mode and word_lines:
            word_buffer = "".join(word_lines)
            clean_word = word_buffer.replace('{"__type": "done"}', '').replace('{"__type":"done"}', '').strip()
            courseware.word_markdown = clean_word
            db.commit()
            yield sse("generate_done", {"total_pages": page_count})
            
    except asyncio.CancelledError:
        print("[SSE] Client disconnected in stream")
    except Exception as e:
        print(f"[SSE Error] {e}")
        yield f"data: {json.dumps({{'event': 'generate_error', 'data': {'message': str(e)}}})}\n\n"
    finally:
        db.close()

