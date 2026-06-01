# 深度对话理解能力增强方案

## 1. 背景与目标

### 1.1 现状分析

当前系统的对话逻辑本质上是 **"带工具调用的单轮问答 + 最近N条历史拼接"** 模式：

- 消息历史：取最近 30 条消息（约 15 轮），超过即丢弃
- System Prompt：硬编码的工具调用规则，无主动追问指示
- 上下文注入：RAG 检索片段 + 课件/游戏状态
- 无教师画像：每次对话从零开始，不记录教师偏好
- 无意图结构化：教学需求隐式存在于对话流中，无显式表示

### 1.2 目标

实现 Goal.md 中要求的 **"通过深度对话理解教师复杂的教学思路与个性化需求"**，具体包括：

1. **教师画像系统**：跨会话记录教师的教学风格与偏好，减少重复沟通
2. **主动澄清/追问**：模型在信息不充分时主动提问，而非盲目执行
3. **教学意图结构化**：将对话中的教学需求提取为结构化快照，指导后续生成
4. **长对话摘要压缩**：突破 30 条消息限制，保留早期重要教学意图
5. **意图驱动 RAG**：用教学意图增强检索精度，而非仅靠当条消息

### 1.3 约束

- **仅后端改动**，不修改前端代码
- 与现有工具调用流程（ProposePPTPlan / GenerateFullPPT 等）完全兼容
- 新增的 LLM 调用使用轻量模型，控制成本和延迟

---

## 2. 整体架构

```
用户消息进入 chat_with_session 端点
    │
    ▼
┌──────────────────────────────┐
│ ① 加载教师画像 (TeacherProfile) │  ← 从 DB 读取长期偏好
│ ② 加载教学意图快照 (Session)    │  ← 当前会话的结构化意图
│ ③ 加载对话摘要 (Session)        │  ← 历史消息的压缩摘要
└────────────┬─────────────────┘
             ▼
┌──────────────────────────────┐
│ ④ 消息拼装                     │  ← 现有逻辑 + 新增上下文注入
│    system_prompt              │  ← 追加追问规则
│    + 教师画像上下文             │
│    + 意图快照上下文             │
│    + 对话摘要上下文             │
│    + RAG (意图增强检索)         │
│    + 最近 N 条历史消息          │
│    + 当前用户输入               │
└────────────┬─────────────────┘
             ▼
┌──────────────────────────────┐
│ ⑤ LLM 流式调用（现有逻辑不变）  │
│    → SSE 流式返回前端           │
└────────────┬─────────────────┘
             ▼
┌──────────────────────────────┐
│ ⑥ 响应后处理（异步，不阻塞）    │
│    - 教师画像增量更新            │
│    - 教学意图快照增量更新        │
│    - 长对话摘要生成/更新         │
└──────────────────────────────┘
```

---

## 3. 实施步骤

### 步骤一：SYSTEM_PROMPT 增加主动追问规则

**优先级：P0**
**改动文件：** `Backend/app/services/llm_service.py`
**改动范围：** 仅修改 `SYSTEM_PROMPT` 常量
**复杂度：** 低

#### 3.1.1 改动内容

在现有 `SYSTEM_PROMPT` 末尾追加追问规则段落：

```
《主动澄清规则》
在调用任何生成工具（ProposePPTPlan / GenerateFullPPT / GenerateGame）之前，
你必须评估以下教学要素的完整性：

必需要素（缺一不可，否则必须追问）：
  ① 课程主题/知识点 — 教师要讲什么
  ② 目标受众 — 面向什么年级/基础的学生

重要要素（缺失 2 项以上时主动询问，但不强制阻断）：
  ③ 教学目标 — 知识目标、能力目标、情感目标
  ④ 重点难点 — 哪些是核心、哪些是易错点
  ⑤ 教学逻辑 — 先讲什么后讲什么、时间分配
  ⑥ 互动设计 — 是否需要课堂互动、游戏、讨论环节

判断规则：
- 如果 ①② 中任何一项缺失，必须主动追问，不得调用生成工具。
- 如果 ③④⑤⑥ 中缺失 2 项以上，主动询问（可一次问多个），但不强制阻断。
- 如果教师已在之前的对话中提及过这些信息（检查历史消息），不要重复询问。
- 追问时使用自然、友好的语气，可一次问 2-3 个相关问题，不要像填表一样逐条问。
- 如果教师明确表示"就这样"、"你看着办"、"不用问了"，则跳过追问直接生成。

示例追问：
"在开始制作之前，我想确认几个关键点：
1. 这节课面向几年级的学生？他们之前学过相关内容吗？
2. 你希望重点讲解哪些知识点？有没有特别需要强调的难点？
3. 课堂上需要安排互动环节吗，比如小测验或讨论？"
```

#### 3.1.2 预期效果

- 教师说"帮我做个PPT"时，模型会主动追问主题、受众等关键信息
- 教师说"你看着办"时，模型跳过追问直接生成
- 零额外 LLM 调用成本，仅靠 prompt 引导

---

### 步骤二：教师画像系统

**优先级：P1**
**改动文件：**
- 新建 `Backend/app/models/teacher_profile.py`
- 修改 `Backend/app/models/__init__.py`（注册模型）
- 新建 `Backend/app/services/profile_extractor.py`
- 修改 `Backend/app/services/llm_service.py`（注入画像上下文）
- 修改 `Backend/app/api/v1/endpoints/session.py`（SSE 结束后触发提取）

#### 3.2.1 数据模型

```python
# Backend/app/models/teacher_profile.py
from sqlalchemy import Column, String, JSON, DateTime, Text
from datetime import datetime, timezone
from app.db.base_class import Base

class TeacherProfile(Base):
    __tablename__ = "teacher_profile"

    id = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("user.id"), unique=True, index=True)

    # 教学风格标签，如 ["互动型", "案例驱动", "视觉化"]
    teaching_style_tags = Column(JSON, default=list)
    # 偏好记录，如 {"ppt风格": "简洁", "布局偏好": "图文并列", "页数偏好": "8-12页"}
    preferences = Column(JSON, default=dict)
    # 常用学科/课程领域
    subject_domains = Column(JSON, default=list)
    # 历史对话中提取的关键需求摘要（滚动更新）
    needs_summary = Column(Text, default="")
    # 更新时间
    updated_at = Column(DateTime, onupdate=lambda: datetime.now(timezone.utc))
```

#### 3.2.2 画像提取逻辑

```python
# Backend/app/services/profile_extractor.py

EXTRACTION_PROMPT_TEMPLATE = """你是一个教师偏好分析器。根据本轮对话，提取教师的教学偏好信号。

当前已知画像：
{current_profile}

本轮对话：
教师：{user_message}
AI：{assistant_reply}

请输出 JSON 格式的增量更新（只输出有新发现的字段，无新发现则返回空对象）：
{{
  "teaching_style_tags": ["新增的风格标签"],
  "preferences": {{"新增偏好key": "value"}},
  "subject_domains": ["新增领域"],
  "needs_summary": "用一句话概括教师本轮表达的核心需求"
}}

注意：
- 只提取教师明确表达或强烈暗示的偏好，不要推测
- 如果教师否定了之前的某个偏好（如"不要简洁风格"），在 preferences 中标记为否定
- 如果没有新的偏好信号，返回 {{}}"""

async def extract_teacher_preferences(
    user_message: str,
    assistant_reply: str,
    current_profile: dict
) -> dict:
    """用轻量 LLM 从本轮对话中提取教师偏好增量。"""
    prompt = EXTRACTION_PROMPT_TEMPLATE.format(
        current_profile=json.dumps(current_profile, ensure_ascii=False),
        user_message=user_message,
        assistant_reply=assistant_reply
    )
    result = await call_llm_light(prompt)  # 使用轻量模型
    try:
        return json.loads(result)
    except json.JSONDecodeError:
        return {}

def merge_profile(base: dict, delta: dict) -> dict:
    """将增量偏好合并到已有画像。"""
    merged = base.copy()

    # tags：去重追加
    if "teaching_style_tags" in delta:
        existing = set(merged.get("teaching_style_tags", []))
        existing.update(delta["teaching_style_tags"])
        merged["teaching_style_tags"] = list(existing)

    # preferences：增量覆盖
    if "preferences" in delta:
        merged.setdefault("preferences", {}).update(delta["preferences"])

    # domains：去重追加
    if "subject_domains" in delta:
        existing = set(merged.get("subject_domains", []))
        existing.update(delta["subject_domains"])
        merged["subject_domains"] = list(existing)

    # needs_summary：直接覆盖（最新的一句话摘要）
    if "needs_summary" in delta and delta["needs_summary"]:
        merged["needs_summary"] = delta["needs_summary"]

    return merged
```

#### 3.2.3 画像注入到对话上下文

在 `llm_service.py` 的 `stream_chat_response` 函数中，消息拼装阶段插入：

```python
# 在 SYSTEM_PROMPT 之后、RAG 之前注入
if teacher_profile:
    style_str = "、".join(teacher_profile.get("teaching_style_tags", [])) or "暂无"
    prefs_str = json.dumps(teacher_profile.get("preferences", {}), ensure_ascii=False) or "暂无"
    domains_str = "、".join(teacher_profile.get("subject_domains", [])) or "暂无"
    summary_str = teacher_profile.get("needs_summary", "") or "暂无"

    profile_msg = (
        f"【教师画像 — 你的长期记忆】\n"
        f"- 教学风格偏好：{style_str}\n"
        f"- 具体偏好：{prefs_str}\n"
        f"- 常教领域：{domains_str}\n"
        f"- 历史需求摘要：{summary_str}\n\n"
        f"请基于以上了解，提供更贴合该教师风格的建议。"
        f"如果画像中已有相关信息，不要重复询问。"
    )
    messages.append({"role": "system", "content": profile_msg})
```

#### 3.2.4 异步触发提取

在 `session.py` 的 `sse_generator()` 中，流式结束后触发异步提取：

```python
# 在 ai_full_text 写入 DB 之后
if ai_full_text.strip():
    import asyncio
    from app.services.profile_extractor import extract_teacher_preferences, merge_profile
    from app.models.teacher_profile import TeacherProfile

    async def _update_profile():
        db_p = SessionLocal()
        try:
            profile = db_p.query(TeacherProfile).filter(
                TeacherProfile.user_id == current_user.id
            ).first()
            current = {
                "teaching_style_tags": profile.teaching_style_tags if profile else [],
                "preferences": profile.preferences if profile else {},
                "subject_domains": profile.subject_domains if profile else [],
                "needs_summary": profile.needs_summary if profile else "",
            }
            delta = await extract_teacher_preferences(
                chat_msg.content, ai_full_text, current
            )
            if delta:
                merged = merge_profile(current, delta)
                if profile:
                    profile.teaching_style_tags = merged["teaching_style_tags"]
                    profile.preferences = merged["preferences"]
                    profile.subject_domains = merged["subject_domains"]
                    profile.needs_summary = merged["needs_summary"]
                else:
                    db_p.add(TeacherProfile(
                        id=f"tp_{uuid.uuid4().hex[:12]}",
                        user_id=current_user.id,
                        **merged
                    ))
                db_p.commit()
        except Exception as e:
            logger.warning(f"Profile extraction failed: {e}")
        finally:
            db_p.close()

    asyncio.create_task(_update_profile())
```

#### 3.2.5 数据库 Migration

新增表 `teacher_profile`，使用 Alembic 或手动建表：

```sql
CREATE TABLE teacher_profile (
    id VARCHAR PRIMARY KEY,
    user_id VARCHAR NOT NULL UNIQUE REFERENCES "user"(id),
    teaching_style_tags JSON DEFAULT '[]',
    preferences JSON DEFAULT '{}',
    subject_domains JSON DEFAULT '[]',
    needs_summary TEXT DEFAULT '',
    updated_at TIMESTAMP
);
CREATE INDEX ix_teacher_profile_user_id ON teacher_profile(user_id);
```

---

### 步骤三：教学意图结构化快照

**优先级：P1**
**改动文件：**
- 修改 `Backend/app/models/session.py`（新增字段）
- 新建 `Backend/app/services/intent_extractor.py`
- 修改 `Backend/app/services/llm_service.py`（注入意图上下文 + 意图增强 RAG）
- 修改 `Backend/app/api/v1/endpoints/session.py`（触发提取 + 增强检索）

#### 3.3.1 数据模型变更

在 `SessionContext` 上新增两个字段：

```python
# Backend/app/models/session.py - SessionContext 新增
class SessionContext(Base):
    # ... 现有字段 ...

    # 教学意图结构化快照
    teaching_intent = Column(JSON, nullable=True)
    # 对话摘要（用于长对话压缩）
    conversation_summary = Column(Text, nullable=True)
```

意图快照结构示例：

```json
{
  "subject": "量子力学基础",
  "target_audience": "大二物理系",
  "knowledge_points": ["波粒二象性", "薛定谔方程", "不确定性原理"],
  "teaching_logic": "从实验现象引入 → 建立数学模型 → 推导方程 → 应用",
  "key_points": ["薛定谔方程的物理意义"],
  "difficult_points": ["波函数的概率解释"],
  "interaction_design": "每节知识点后配一个思考题",
  "duration": "45分钟",
  "output_format": "PPT + 配套教案",
  "field_confidence": {
    "subject": 0.95,
    "target_audience": 0.8,
    "knowledge_points": 0.7,
    "teaching_logic": 0.4,
    "key_points": 0.3,
    "difficult_points": 0.2,
    "interaction_design": 0.0,
    "duration": 0.0,
    "output_format": 0.6
  }
}
```

#### 3.3.2 意图提取逻辑

```python
# Backend/app/services/intent_extractor.py

INTENT_EXTRACTION_PROMPT = """你是一个教学意图分析器。根据对话内容，更新教学意图结构化快照。

当前意图快照：
{current_intent}

最近对话摘要：
{conversation_summary}

教师最新消息：{new_message}

请输出更新后的完整意图快照 JSON，结构如下：
{{
  "subject": "课程主题",
  "target_audience": "目标学生群体",
  "knowledge_points": ["知识点1", "知识点2"],
  "teaching_logic": "教学流程描述",
  "key_points": ["重点1"],
  "difficult_points": ["难点1"],
  "interaction_design": "互动设计",
  "duration": "时长",
  "output_format": "产出格式",
  "field_confidence": {{
    "subject": 0.0-1.0,
    "target_audience": 0.0-1.0,
    "knowledge_points": 0.0-1.0,
    "teaching_logic": 0.0-1.0,
    "key_points": 0.0-1.0,
    "difficult_points": 0.0-1.0,
    "interaction_design": 0.0-1.0,
    "duration": 0.0-1.0,
    "output_format": 0.0-1.0
  }}
}}

规则：
1. 保留已有信息，只更新/新增有变化的字段
2. field_confidence 表示该字段信息的明确程度（0=完全未知, 1=非常明确）
3. 如果教师否定了之前的某项理解，更新内容并提高 confidence
4. 新提及但不明确的信息，设较低 confidence（0.3-0.5）
5. 明确确认的信息设高 confidence（0.8-1.0）
6. 只输出 JSON，不要其他文字"""

async def update_teaching_intent(
    current_intent: dict | None,
    new_message: str,
    conversation_summary: str | None,
) -> dict:
    """增量更新教学意图快照。"""
    prompt = INTENT_EXTRACTION_PROMPT.format(
        current_intent=json.dumps(current_intent or {}, ensure_ascii=False),
        conversation_summary=conversation_summary or "无",
        new_message=new_message,
    )
    result = await call_llm_light(prompt)
    try:
        return json.loads(result)
    except json.JSONDecodeError:
        return current_intent or {}
```

#### 3.3.3 意图快照注入到对话上下文

```python
# llm_service.py - stream_chat_response 中
if session_id:
    session = db.query(SessionContext).get(session_id)
    if session and session.teaching_intent:
        intent = session.teaching_intent
        confidence = intent.get("field_confidence", {})

        # 构造意图摘要
        intent_lines = []
        field_labels = {
            "subject": "课程主题",
            "target_audience": "目标受众",
            "knowledge_points": "知识点",
            "teaching_logic": "教学逻辑",
            "key_points": "重点",
            "difficult_points": "难点",
            "interaction_design": "互动设计",
            "duration": "时长",
            "output_format": "产出格式",
        }
        for field, label in field_labels.items():
            val = intent.get(field)
            conf = confidence.get(field, 0)
            if val and conf > 0.3:
                if isinstance(val, list):
                    val = "、".join(val)
                intent_lines.append(f"  - {label}：{val}（置信度 {conf:.0%}）")

        if intent_lines:
            intent_msg = (
                f"【已了解的教学意图】\n" + "\n".join(intent_lines) + "\n\n"
                f"以上信息已从之前的对话中提取，不要重复询问已高置信度的字段。"
            )
            messages.append({"role": "system", "content": intent_msg})

        # 低置信度字段提示追问
        low_conf_fields = [
            field_labels[f] for f, c in confidence.items()
            if c < 0.4 and f in field_labels
        ]
        if len(low_conf_fields) >= 2:
            hint_msg = (
                f"【需要补充的信息】以下教学要素尚不明确，"
                f"请在合适时机主动询问：{'、'.join(low_conf_fields)}"
            )
            messages.append({"role": "system", "content": hint_msg})
```

#### 3.3.4 意图驱动的 RAG 增强

修改 `session.py` 中的检索逻辑：

```python
# session.py - chat_with_session 中，RAG 检索部分
enhanced_query = chat_msg.content
if session_ctx.teaching_intent:
    intent = session_ctx.teaching_intent
    context_parts = []
    if intent.get("subject"):
        context_parts.append(intent["subject"])
    kps = intent.get("knowledge_points", [])
    if kps:
        context_parts.extend(kps[:3])  # 最多取 3 个知识点
    if context_parts:
        enhanced_query = f"{' '.join(context_parts)} {chat_msg.content}"

if file_ids:
    docs = search_vectors(query=enhanced_query, filter_document_ids=file_ids, top_k=6)
```

#### 3.3.5 异步触发意图更新

与教师画像提取类似，在 SSE 流结束后异步触发：

```python
async def _update_intent():
    db_i = SessionLocal()
    try:
        session = db_i.query(SessionContext).get(session_id)
        if not session:
            return
        current_intent = session.teaching_intent
        summary = session.conversation_summary

        new_intent = await update_teaching_intent(
            current_intent, chat_msg.content, summary
        )
        if new_intent and new_intent != current_intent:
            session.teaching_intent = new_intent
            db_i.commit()
    except Exception as e:
        logger.warning(f"Intent extraction failed: {e}")
    finally:
        db_i.close()

asyncio.create_task(_update_intent())
```

#### 3.3.6 数据库 Migration

```sql
ALTER TABLE session_context ADD COLUMN teaching_intent JSON;
ALTER TABLE session_context ADD COLUMN conversation_summary TEXT;
```

---

### 步骤四：长对话摘要压缩

**优先级：P2**
**改动文件：**
- 修改 `Backend/app/models/session.py`（复用步骤三新增的 `conversation_summary` 字段）
- 新建 `Backend/app/services/conversation_manager.py`
- 修改 `Backend/app/api/v1/endpoints/session.py`（替换历史加载逻辑）
- 修改 `Backend/app/services/llm_service.py`（注入摘要上下文）

#### 3.4.1 摘要管理器

```python
# Backend/app/services/conversation_manager.py

HARD_LIMIT = 30       # 直接送入 LLM 的最大消息数
SUMMARY_THRESHOLD = 20  # 超过此数量时触发摘要

def format_messages_for_summary(messages: list) -> str:
    """将消息列表格式化为摘要用的纯文本。"""
    lines = []
    for msg in messages:
        role = "教师" if msg.role == "user" else "AI"
        # 截断过长的消息
        content = msg.content[:500] + "..." if len(msg.content) > 500 else msg.content
        lines.append(f"{role}：{content}")
    return "\n".join(lines)

SUMMARY_PROMPT = """请用中文简洁概括以下对话的关键信息。

要求保留：
1. 教师表达的教学需求和偏好
2. 做出的重要决策（如确认了某个PPT方案）
3. 未完成的待办事项

对话内容：
{conversation_text}

已有摘要（如有）：
{existing_summary}

请输出合并后的摘要，200字以内。如果已有摘要，请在其基础上增量更新，不要丢失已有信息。"""

async def generate_conversation_summary(
    messages_text: str,
    existing_summary: str | None = None,
) -> str:
    """生成或增量更新对话摘要。"""
    prompt = SUMMARY_PROMPT.format(
        conversation_text=messages_text,
        existing_summary=existing_summary or "无",
    )
    return await call_llm_light(prompt)

async def prepare_messages_with_summary(
    db,
    session_id: str,
) -> tuple[list, str | None]:
    """
    准备消息列表，必要时生成摘要。
    返回 (messages_to_send, summary_or_none)。
    """
    from app.models.session import SessionContext, Message

    total_count = db.query(Message).filter(
        Message.session_id == session_id
    ).count()

    if total_count <= HARD_LIMIT:
        # 消息不多，直接取全部
        messages = db.query(Message).filter(
            Message.session_id == session_id
        ).order_by(Message.created_at.asc()).all()
        return messages, None

    # 需要压缩：取最早的消息做摘要
    cutoff = total_count - HARD_LIMIT
    old_messages = db.query(Message).filter(
        Message.session_id == session_id
    ).order_by(Message.created_at.asc()).limit(cutoff).all()

    session = db.query(SessionContext).get(session_id)
    old_summary = session.conversation_summary if session else None

    # 生成摘要（取旧消息的后 10 条做增量）
    chunk = old_messages[-10:] if len(old_messages) > 10 else old_messages
    new_summary = await generate_conversation_summary(
        format_messages_for_summary(chunk),
        old_summary,
    )

    # 保存摘要
    if session and new_summary:
        session.conversation_summary = new_summary
        db.commit()

    # 返回最近的消息
    recent_messages = db.query(Message).filter(
        Message.session_id == session_id
    ).order_by(Message.created_at.asc()).offset(cutoff).all()

    return recent_messages, new_summary
```

#### 3.4.2 替换历史加载逻辑

修改 `session.py` 中的历史消息加载：

```python
# 原来的：
# history = db.query(Message).filter(...).order_by(...).limit(30).all()[::-1]

# 改为：
from app.services.conversation_manager import prepare_messages_with_summary

history, conversation_summary = await prepare_messages_with_summary(db, session_id)
# history 已经是时间正序，无需翻转
```

#### 3.4.3 摘要注入到对话上下文

```python
# llm_service.py - stream_chat_response 签名新增参数
async def stream_chat_response(
    messages_history: list,
    new_user_input: str,
    rag_context: str = "",
    session_id: str = None,
    user_id: str = None,
    active_game_id: str = None,
    conversation_summary: str = None,  # 新增
    teacher_profile: dict = None,       # 新增
):

# 在消息拼装时注入摘要
if conversation_summary:
    messages.append({
        "role": "system",
        "content": (
            f"【此前对话摘要】\n{conversation_summary}\n\n"
            f"以上是更早对话的关键信息摘要，请在此基础上继续。"
            f"不要重复询问摘要中已包含的信息。"
        )
    })
```

---

## 4. 技术选型说明

### 4.1 轻量 LLM 调用

画像提取、意图提取、摘要生成均使用轻量模型，要求：
- 低延迟（< 1s）
- 低成本（单次 100-300 token）
- JSON 输出能力强

推荐方案：
- 主模型如果使用的是 Claude/GPT-4 级别，轻量调用可用 GPT-4o-mini / Claude Haiku
- 如果使用国内模型，可用 qwen-turbo / glm-4-flash
- 在 `settings.py` 中新增 `LLM_LIGHT_MODEL` 配置项，与主模型分开

### 4.2 轻量 LLM 调用封装

```python
# Backend/app/services/llm_service.py 新增

async def call_llm_light(prompt: str) -> str:
    """调用轻量模型，用于画像提取、意图提取等辅助任务。"""
    headers = {
        "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": settings.LLM_LIGHT_MODEL,  # 如 "gpt-4o-mini"
        "messages": [{"role": "user", "content": prompt}],
        "stream": False,
        "temperature": 0.3,  # 低温度，输出更稳定
        "max_tokens": 500,
    }
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            f"{settings.OPENAI_API_BASE.rstrip('/')}/chat/completions",
            headers=headers,
            json=payload,
        )
        resp.raise_for_status()
        data = resp.json()
        return data["choices"][0]["message"]["content"]
```

### 4.3 异步任务执行

画像提取和意图提取使用 `asyncio.create_task()` 在 SSE 流结束后异步执行：

- **优点**：不阻塞流式响应，用户无感知
- **风险**：如果 FastAPI 进程在任务完成前关闭，任务会丢失
- **兜底**：这些任务是"有则更好，没有也不影响核心功能"的增强型任务，丢失可接受

### 4.4 数据库 Migration

新增字段和表，兼容 SQLite（项目当前使用）：

```sql
-- 步骤二：教师画像表
CREATE TABLE IF NOT EXISTS teacher_profile (
    id VARCHAR PRIMARY KEY,
    user_id VARCHAR NOT NULL UNIQUE REFERENCES "user"(id),
    teaching_style_tags JSON DEFAULT '[]',
    preferences JSON DEFAULT '{}',
    subject_domains JSON DEFAULT '[]',
    needs_summary TEXT DEFAULT '',
    updated_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_teacher_profile_user_id ON teacher_profile(user_id);

-- 步骤三：会话表新增字段
ALTER TABLE session_context ADD COLUMN teaching_intent JSON;
ALTER TABLE session_context ADD COLUMN conversation_summary TEXT;
```

---

## 5. 配置项变更

`Backend/app/core/config.py` 新增：

```python
# 轻量模型，用于画像提取、意图提取、摘要生成
LLM_LIGHT_MODEL: str = "gpt-4o-mini"

# 是否启用深度对话增强功能
DEEP_DIALOGUE_ENABLED: bool = True

# 画像提取触发频率（每 N 轮对话触发一次，0=每轮都触发）
PROFILE_EXTRACT_INTERVAL: int = 1

# 意图提取触发频率
INTENT_EXTRACT_INTERVAL: int = 1

# 摘要触发阈值（消息数）
SUMMARY_THRESHOLD: int = 20
```

---

## 6. 改动文件总览

| 步骤 | 文件 | 操作 | 说明 |
|------|------|------|------|
| 一 | `services/llm_service.py` | 修改 | SYSTEM_PROMPT 追加追问规则 |
| 二 | `models/teacher_profile.py` | **新建** | 教师画像数据模型 |
| 二 | `models/__init__.py` | 修改 | 注册新模型 |
| 二 | `services/profile_extractor.py` | **新建** | 画像提取逻辑 |
| 二 | `services/llm_service.py` | 修改 | 注入画像上下文 + `call_llm_light` |
| 二 | `api/v1/endpoints/session.py` | 修改 | SSE 结束后异步触发画像提取 |
| 二 | `core/config.py` | 修改 | 新增配置项 |
| 三 | `models/session.py` | 修改 | 新增 `teaching_intent`、`conversation_summary` 字段 |
| 三 | `services/intent_extractor.py` | **新建** | 意图快照提取逻辑 |
| 三 | `services/llm_service.py` | 修改 | 注入意图上下文 |
| 三 | `api/v1/endpoints/session.py` | 修改 | 意图增强 RAG + 异步触发意图提取 |
| 四 | `services/conversation_manager.py` | **新建** | 摘要压缩逻辑 |
| 四 | `api/v1/endpoints/session.py` | 修改 | 替换历史加载逻辑 |
| 四 | `services/llm_service.py` | 修改 | 接收并注入摘要上下文 |

---

## 7. 风险与应对

| 风险 | 影响 | 应对 |
|------|------|------|
| 轻量 LLM 调用失败 | 画像/意图/摘要不更新 | 捕获异常，降级为无画像/意图/摘要模式，不影响主流程 |
| 意图提取 JSON 解析失败 | 快照不更新 | 保留上一次有效快照，日志记录失败 |
| 异步任务堆积 | 内存占用增加 | 每个会话同一时间最多一个提取任务，用锁或标志位控制 |
| 摘要丢失关键信息 | 后续对话遗漏需求 | 摘要 prompt 强调保留"教学需求、决策、待办"三类信息 |
| 教师画像污染 | 注入错误偏好 | 画像提取 prompt 要求"只提取明确表达的偏好"，不推测 |
