# EduAgent 项目说明与讲解

## 一、目标与解决思路

### 1.1 项目目标

EduAgent 旨在构建一套以"教师教学思路"为核心驱动、具备**深度多轮对话**、**多模态文件融合**与**结构化课件端到端生成**能力的 AI 智能体系统：

- **减负增效**：将课件制作时间从数小时缩短至分钟级
- **思路聚焦**：多轮对话主动理解教师意图，而非被动执行单条指令
- **质量提升**：融合 RAG 知识库、参考资料与 AI 创造力，内容有据可查
- **格式标准**：一键导出符合 Office 标准的 .pptx / .docx，支持后续自由编辑

### 1.2 解决思路

```
教师意图（语音/文字）→ 多轮对话澄清 → 结构化教学意图
    → 融合 RAG 知识 + 参考资料 → 课件生成指令集（JSON Schema）
    → 确定性拼装引擎 → .pptx + .docx
    → 教师预览 → 提出修改 → AI 精调 → 最终定稿下载
```

---

## 二、问题分析与解决方案

### 2.1 功能碎片化

**问题**：教师需跨多个软件完成备课，数据孤岛，流程断裂。

**方案**：以"会话（Session）"为核心数据容器，将对话历史、参考文件、RAG 引用、课件数据、图片资源全部归集于同一 `session_id` 之下，单一工作台完成全流程。

### 2.2 意图理解浅层化

**问题**：现有工具仅能响应单条指令，无法主动追问澄清复杂教学需求。

**方案**：
- 后端维护每会话完整对话历史，全部注入大模型系统 Prompt
- 大模型以"教学顾问"身份运作，主动追问教学目标、知识点逻辑、课时安排等
- 大模型每次请求同时获取当前课件全局 JSON 状态，具备上下文感知能力

### 2.3 多模态资料利用率低

**问题**：教师有大量参考 PDF、旧 PPT、Word 讲义，现有工具无法有效消化融合。

**方案**：
- 异步 RAG 文档处理管道，支持 PDF/Word/PPTX/TXT 多格式解析
- `RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=150)` 分块
- `text-embedding-3-large` 向量化，存入 ChromaDB，生成时 Top-K 语义检索注入上下文

### 2.4 AI 生成格式不稳定

**问题**：直接令大模型输出 .pptx 或 Markdown 草稿，面临文件损坏、幻觉内容等问题。

**方案**：智能+确定性双轨解耦：
- **大模型**：仅输出严格 JSON Schema（幻灯片骨架），Pydantic 字段校验
- **引擎**：后端 `ppt_exporter.py` 以纯逻辑调用 python-pptx API 拼装文件，100% 导出成功率

---

## 三、技术路线及实现方案

### 3.1 整体技术架构

**前端（React 18 + Vite + TypeScript）**
- 沉浸式单页工作台（左 40% 对话 + 右 60% 预览）
- Vanilla CSS + CSS Modules（Glassmorphism 设计语言）
- Zustand 状态管理，Axios + fetch-event-source（SSE）

**后端（Python 3.10+ · FastAPI · Uvicorn ASGI）**
- RESTful + SSE 混合通信架构
- SQLite + SQLAlchemy ORM（可无代码切换 MySQL）
- ChromaDB 本地持久向量库（三个独立集合）

**大模型服务（豆包 doubao 系列）**
- 主力对话+生成：`doubao-seed-2-0-pro-260215`
- 图片标注：`doubao-vision-pro-32k`
- 文本向量化：`text-embedding-3-large`

### 3.2 大模型 Tool Calling

对话接口注册四个工具，大模型通过流式 Tool Call 直接操作数据库中的幻灯片数据：

| 工具 | 触发时机 | 后端动作 |
|---|---|---|
| `GenerateFullPPT` | 要求从零生成课件 | 触发前端调用流式生成接口 |
| `UpdateSlide` | 修改某页 | 按 page_index 更新 Courseware.ppt_data |
| `AddSlide` | 新增一页 | 指定位置插入，重排 page_index |
| `DeleteSlide` | 删除某页 | 删除并重排编号 |

工具执行后向前端推送 `tool_result` 事件（含 `should_refetch_ppt: true`），前端自动静默刷新预览。

大模型开启深度思考（`budget_tokens: 1024`），思考内容通过 `thinking` 事件实时流式透出。

### 3.3 RAG 文档处理管道

```
文件上传（立即返回 file_id）
    ↓ BackgroundTask 异步处理
文件格式分发（PDF/DOCX/PPTX/TXT）
    ↓ document_parser.py
文本提取 → RecursiveCharacterTextSplitter 分块
    ↓ text-embedding-3-large
向量化 → ChromaDB eduagent_global 集合（含 document_id metadata）
    ↓ 前端轮询 /files/{id}/status
展示 completed（进度 100%）
```

生成时：对最后一条对话消息做语义检索，Top-6 结果注入大模型上下文（RAG 增强生成）。

### 3.4 图片 Vision RAG 系统

**上传阶段（异步后台）**：
1. 图片存储 → Vision LLM 自动生成中文描述（≤30字）+ 5-8 个标签
2. 描述+标签拼接 → Embedding → 存入 ChromaDB `images_session` 集合（含 session_id 过滤字段）

**PPT 生成阶段（同步检索）**：
1. 大模型输出 `type: "image"` element，携带自然语言 `query` 字段
2. 后端对 query 做 Embedding → `images_session` 余弦检索（阈值 0.75）
3. 未命中 → fallback 至 `images_library`（阈值 0.70）
4. 命中后追加 `resolved` 字段（preview_url + source + similarity）推送前端

两级图库架构（会话图库、系统默认图库），导出时重新检索，图片二进制嵌入 PPTX（文件自包含）。

### 3.5 SSE 流式生成协议

`POST /sessions/{id}/generate/stream` 返回 NDJSON 格式 SSE 流，前端逐事件处理：

| 事件类型 | 时机 | 前端动作 |
|---|---|---|
| `generate_start` | 主题确定后 | 应用主题 CSS 变量 |
| `page_chunk` | 每生成一页 | append 到 pages 数组，渲染新卡片 |
| `word_ready` | 讲义文本完成 | 更新 Word 预览 Tab |
| `generate_done` | 全部完成 | 关闭流式状态 |
| `generate_error` | 任何异常 | 显示错误，保留已生成页面 |
| `thinking_chunk` | 模型思考中 | 显示思考过程气泡 |

前端断开连接后，已写入数据库的页面不清除（支持断点续生成）。

### 3.6 PPT 导出引擎

`ppt_exporter.py`（2301 行）核心能力：

**主题系统**：10 套 Premium 主题，按 `session_id` Hash 确定性选取，与前端完全镜像同步。

**LaTeX → OMML 转换**：将 `$...$` LaTeX 公式转为 Office Math（OMML）XML 对象：
- `\frac{}{}`（分数）、`\sqrt[]{}`（根号）、`\sum \int \prod`（n元算子+上下限）
- `\lim_{}`（极限）、`^{} _{}` （上下标）
- `\begin{cases}...\end{cases}` 方程组
- `\begin{aligned}` 对齐公式、矩阵（pmatrix/bmatrix/vmatrix）
- 完整希腊字母表、数学符号集

导出的 PPTX 中数学公式为真正的 Office Math 对象，可在 PowerPoint 中自由编辑。

---

## 四、业务模式与可行性分析

### 4.1 业务模式

| 版本 | 定位 | 核心差异 |
|---|---|---|
| 基础版（免费） | 个人教师 | 基础生成额度，会话存储 |
| 专业版（订阅） | 重度用户 | 更多 AI 额度，更大知识库，优先队列 |
| 机构版（私有化） | 高校/K12 机构 | 私有云部署，专属知识库与图库 |

### 4.2 可行性分析

**技术可行性**：核心技术栈全部为成熟组件，当前 MVP 已实现全部核心功能，ORM 层保证架构平滑演进。

**商业可行性**：国内教师规模超千万，备课痛点普遍；通过锐捷云课堂业务线具备 B 端快速打入渠道；AI API 成本持续下降。

**合规可行性**：JWT + bcrypt 账户安全，用户数据本地化存储，仅调用合规公有 API。

---

## 五、项目演进路线

| 阶段 | 状态 | 内容 |
|---|---|---|
| Phase 1 | ✅ 已完成 | 核心 MVP：对话、RAG、流式生成、Tool Calling、导出 |
| Phase 2 | ✅ 已完成 | 图片 Vision RAG、OMML 数学公式、主题一致性引擎 |
| Phase 3 | 🔄 规划中 | 教学场景数字人、互动小游戏生成（HTML5）、视频关键帧分析 |
