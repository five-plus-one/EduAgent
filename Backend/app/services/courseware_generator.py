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
                
                response = requests.post(url, headers=headers, json=payload, stream=True, timeout=600)
                response.raise_for_status()
                for line in response.iter_lines():
                    if line:
                        line_str = line.decode('utf-8')
                        if line_str.startswith("data: ") and line_str != "data: [DONE]":
                            try:
                                chunk_data = json.loads(line_str[6:])
                                _choices = chunk_data.get("choices", [])
                                if _choices and isinstance(_choices, list):
                                    content += _choices[0].get("delta", {}).get("content", "")
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
    def _sync_init():
        db_local = SessionLocal()
        try:
            courseware = db_local.query(Courseware).filter(Courseware.session_id == session_id).first()
            if not courseware:
                courseware = Courseware(id="cw_" + uuid.uuid4().hex[:8], session_id=session_id)
                courseware.ppt_data = {"ppt_data": []}
                db_local.add(courseware)
                db_local.commit()
                
            messages = db_local.query(Message).filter(Message.session_id == session_id).order_by(Message.created_at).all()
            history_str = "\n".join([f"{m.role}: {m.content}" for m in messages])

            rag_context = ""
            if selected_file_ids:
                last_msg = messages[-1].content if messages else "智能大纲提取"
                docs = search_vectors(query=last_msg, filter_document_ids=selected_file_ids, top_k=6)
                rag_context = "\n---\n".join([d.page_content for d in docs])
                
            return history_str, rag_context
        finally:
            db_local.close()

    history_str, rag_context = await asyncio.to_thread(_sync_init)
    db = SessionLocal() # Keep local DB instance for async loop

    def _luma(hex_str: str) -> float:
        """WCAG sRGB luminance, used for contrast gate."""
        try:
            h = str(hex_str).lstrip("#")
            if len(h) == 3: h = "".join(c*2 for c in h)
            r, g, b = int(h[0:2],16), int(h[2:4],16), int(h[4:6],16)
            return (0.2126*r + 0.7152*g + 0.0722*b) / 255.0
        except Exception:
            return 0.5

    try:
        courseware = db.query(Courseware).filter(Courseware.session_id == session_id).first()
        if courseware:
            # 清空旧数据防止追加模式下出现脏数据和页数翻倍
            courseware.ppt_data = {"version": "v1", "ppt_data": []}
            courseware.word_markdown = ""
            await asyncio.to_thread(db.commit)

        prompt = f"""你是一位专业的 PPT 课件 JSON 生成器。严格按照以下格式输出，不能有任何偏差。

# 课程背景
{history_str}

# 参考材料
{rag_context}

# 输出格式（NDJSON，每行一个完整合法 JSON，严禁输出 Markdown 围栏、注释、说明文字）

第1行必须是主题：
{{"__type": "theme", "name": "主题名", "bg_color": "#0F172A", "primary": "#38BDF8", "secondary": "#64748B", "accent": "#F59E0B", "text_color": "#F1F5F9"}}

每页幻灯片单独一行：
{{"__type": "page", "page_index": N, "layout_type": "...", "title": "...", "speaker_notes": "...", "elements": [...]}}

所有页输出完后：
{{"__type": "word_start"}}
（讲义正文 Markdown，可多行）
{{"__type": "done"}}

# layout_type 对照表
- cover：封面（第1页专用）
- minimal_list：要点页（多段落列表）
- two_column：双栏对比页（左右各一组 elements）
- stat_callout：数据强调页（含大号数字）
- timeline：时间线/流程页

# elements 结构
每个 element 是一个 JSON 对象，包含：
- element_id: 字符串，如 "e1" "e2"（每页内唯一）
- type: "text_block" 或 "list" 或 "huge_number" 或 "subtitle" 或 "timeline_item"
- position: "left" 或 "right_top" 或 "right_bottom" 或 "center" 或 "full"
- content: 字符串数组（非空，至少1个元素）
- is_accent: true 或 false

# 完整输出示例（照此结构生成真实内容）：
{{"__type": "theme", "name": "科技蓝", "bg_color": "#0F172A", "primary": "#38BDF8", "secondary": "#475569", "accent": "#F59E0B", "text_color": "#F1F5F9"}}
{{"__type": "page", "page_index": 1, "layout_type": "cover", "title": "人工智能基础", "speaker_notes": "开场介绍", "elements": [{{"element_id": "e1", "type": "subtitle", "position": "center", "content": ["主讲：张老师  |  2024年春季"], "is_accent": false}}]}}
{{"__type": "page", "page_index": 2, "layout_type": "minimal_list", "title": "课程目标", "speaker_notes": "概述本课程三大目标", "elements": [{{"element_id": "e1", "type": "list", "position": "left", "content": ["理解机器学习的基本概念", "掌握主流算法的应用场景", "能够独立完成数据分析任务"], "is_accent": false}}, {{"element_id": "e2", "type": "text_block", "position": "right_top", "content": ["本课程面向零基础学员，强调实践导向，全程辅以真实案例演练。"], "is_accent": false}}]}}
{{"__type": "page", "page_index": 3, "layout_type": "two_column", "title": "传统 vs AI 方法", "speaker_notes": "对比两种方法的差异", "elements": [{{"element_id": "e1", "type": "list", "position": "left", "content": ["规则硬编码，难以扩展", "需要领域专家持续维护", "对新情况适应性差"], "is_accent": false}}, {{"element_id": "e2", "type": "list", "position": "right_top", "content": ["从数据中自动学习规律", "随数据增长持续优化", "可迁移至多个领域"], "is_accent": false}}, {{"element_id": "e3", "type": "huge_number", "position": "right_bottom", "content": ["↑300% 效率"], "is_accent": true}}]}}
{{"__type": "page", "page_index": 4, "layout_type": "stat_callout", "title": "行业数据", "speaker_notes": "用数据说话", "elements": [{{"element_id": "e1", "type": "huge_number", "position": "center", "content": ["87%"], "is_accent": true}}, {{"element_id": "e2", "type": "text_block", "position": "bottom", "content": ["的企业已将 AI 纳入核心生产流程（Gartner 2024）"], "is_accent": false}}]}}
{{"__type": "word_start"}}
## 人工智能基础讲义
详细正文内容...
{{"__type": "done"}}

# 重要规则
1. 必须生成 6-8 页（第1页 cover，最后一页 minimal_list 总结）
2. 每页的 elements 数组必须至少包含 1 个元素，且 content 数组非空
3. 所有字段必须存在，不能缺少 element_id、type、position、content、is_accent
4. 上面的示例仅供格式参考，请生成关于当前课程主题的真实内容
5. 主题色板必须根据课程风格选择，不要照抄示例的颜色
6. 现在开始输出，第一行是 theme JSON"""

        def sse(event: str, data: dict):
            return f"data: {json.dumps({'event': event, 'data': data}, ensure_ascii=False)}\n\n"

        url = f"{settings.OPENAI_API_BASE.rstrip('/')}/chat/completions"
        headers = {
            "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
            "Content-Type": "application/json"
        }
        payload = {
            "model": "doubao-seed-2-0-pro-260215",
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.3,
            "stream": True,
            "thinking": {"type": "disabled"}  # 关闭思考模式，防止生成格式混乱
        }

        buffer = ""
        word_mode = False
        word_lines = []
        page_count = 0
        theme_saved = False
        done_sent = False

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
                            # 安全取 choices — 空 choices:[] 时跳过，防止 IndexError
                            _choices = chunk.get("choices", [])
                            if not _choices or not isinstance(_choices, list):
                                continue
                            chunk_delta = _choices[0].get("delta", {})
                            
                            reasoning = chunk_delta.get("reasoning_content", "") or chunk_delta.get("thinking", "")
                            delta = chunk_delta.get("content", "")
                            
                            # 透传大模型思考过程给前端渲染 Loading Animation
                            if reasoning:
                                yield sse("thinking_chunk", {"text": reasoning})
                                
                            if not delta:
                                continue
                            
                            if word_mode:
                                word_lines.append(delta)
                                word_buffer = "".join(word_lines)
                                if '{"__type": "done"}' in word_buffer or '{"__type":"done"}' in word_buffer:
                                    # Write word markdown
                                    clean_word = word_buffer.replace('{"__type": "done"}', '').replace('{"__type":"done"}', '').strip()
                                    courseware.word_markdown = clean_word
                                    await asyncio.to_thread(db.commit)
                                    yield sse("word_ready", {"word_markdown": clean_word})
                                    yield sse("generate_done", {"total_pages": page_count})
                                    done_sent = True
                                    break
                                continue

                            buffer += delta
                            decoder = json.JSONDecoder()
                            while buffer:
                                buffer = buffer.lstrip()
                                if not buffer:
                                    break
                                
                                try:
                                    obj, idx = decoder.raw_decode(buffer)
                                    t = obj.get("__type")
                                    from sqlalchemy.orm.attributes import flag_modified
                                    
                                    if t == "theme":
                                        obj.pop("__type", None)

                                        # ── 后端配色安全门 ──────────────────────────
                                        bg_luma  = _luma(obj.get("bg_color",  "#ffffff"))
                                        txt_luma = _luma(obj.get("text_color","#000000"))
                                        L1, L2 = max(bg_luma, txt_luma), min(bg_luma, txt_luma)
                                        contrast_ratio = (L1 + 0.05) / (L2 + 0.05)

                                        if contrast_ratio < 3.0:
                                            if bg_luma > 0.5:
                                                obj["text_color"] = "#1E293B"
                                                obj["primary"]    = "#0F172A"
                                            else:
                                                obj["text_color"] = "#F8FAFC"
                                                obj["primary"]    = "#E2E8F0"
                                        # ─────────────────────────────────────────────

                                        ppt_dict = dict(courseware.ppt_data) if isinstance(courseware.ppt_data, dict) else {}
                                        if isinstance(courseware.ppt_data, list):
                                            ppt_dict["ppt_data"] = list(courseware.ppt_data)
                                        ppt_dict["theme"] = obj
                                        courseware.ppt_data = ppt_dict
                                        flag_modified(courseware, "ppt_data")
                                        await asyncio.to_thread(db.commit)
                                        theme_saved = True
                                        yield sse("generate_start", {"theme": obj, "total_hint": 8})
                                    elif t == "page":
                                        obj.pop("__type", None)
                                        ppt_dict = dict(courseware.ppt_data) if isinstance(courseware.ppt_data, dict) else {}
                                        if isinstance(courseware.ppt_data, list):
                                            ppt_dict["ppt_data"] = list(courseware.ppt_data)
                                        current_pages = list(ppt_dict.get("ppt_data", []))
                                        if not isinstance(current_pages, list):
                                            current_pages = []
                                        current_pages.append(obj)
                                        ppt_dict["ppt_data"] = current_pages
                                        courseware.ppt_data = ppt_dict
                                        flag_modified(courseware, "ppt_data")
                                        await asyncio.to_thread(db.commit)
                                        page_count += 1
                                        yield sse("page_chunk", obj)
                                    elif t == "word_start":
                                        word_mode = True
                                        
                                    buffer = buffer[idx:]
                                    
                                    if word_mode:
                                        if buffer:
                                            word_lines.append(buffer)
                                            buffer = ""
                                        break
                                        
                                except json.JSONDecodeError:
                                    # Need more chunks to complete JSON object
                                    break
                        except json.JSONDecodeError:
                            continue
                            
        # Final cleanup for word markdown if it didn't cleanly hit done
        if word_mode and word_lines and not done_sent:
            word_buffer = "".join(word_lines)
            clean_word = word_buffer.replace('{"__type": "done"}', '').replace('{"__type":"done"}', '').strip()
            courseware.word_markdown = clean_word
            await asyncio.to_thread(db.commit)
            yield sse("word_ready", {"word_markdown": clean_word})
            yield sse("generate_done", {"total_pages": page_count})
            
    except asyncio.CancelledError:
        print("[SSE] Client disconnected in stream")
    except Exception as e:
        print(f"[SSE Error] {e}")
        yield f"data: {json.dumps({'event': 'generate_error', 'data': {'message': str(e)}})}\n\n"
    finally:
        db.close()

