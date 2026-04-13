import { useState, useRef, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';

import styles from './Workspace.module.css';
import { clsx } from 'clsx';
import * as Tabs from '@radix-ui/react-tabs';
import { useChatSession } from '../hooks/useChatSession';
import MessageBubble from '../components/MessageBubble';
import { useCourseware } from '../hooks/useCourseware';
import { usePPTStream } from '../hooks/usePPTStream';
import PPTCard from '../components/PPTCard';
import PPTSkeleton from '../components/PPTSkeleton';
import ImageUploadPanel from '../components/ImageUploadPanel';
import ThemePicker from '../components/ThemePicker';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeRaw from 'rehype-raw';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { useExport } from '../hooks/useExport';
import { listKnowledgeDocs, addReferences, removeReference, getSession, uploadKnowledgeDoc, exportWordDocx, renameSession } from '../utils/api';
import { FileText, Link, CheckCircle, Loader2, Library, Sparkles, Mic, MicOff, Paperclip, Send, Square, Download, Unlink, Image as ImageIcon, UploadCloud, AlertCircle, Clock, Pencil, Check } from 'lucide-react';

export default function Workspace() {
  const { sessionId = 'new' } = useParams();
  const [inputText, setInputText] = useState('');

  // ── 可拖拽分割线 ────────────────────────────────────────
  const CHAT_MIN = 280;
  const CHAT_MAX = 680;
  const CHAT_DEFAULT = 420;
  const [chatWidth, setChatWidth] = useState(CHAT_DEFAULT);
  const isDraggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartWRef = useRef(0);

  const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    dragStartXRef.current = e.clientX;
    dragStartWRef.current = chatWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (ev: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const delta = ev.clientX - dragStartXRef.current;
      const next = Math.min(CHAT_MAX, Math.max(CHAT_MIN, dragStartWRef.current + delta));
      setChatWidth(next);
    };

    const onMouseUp = () => {
      isDraggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [chatWidth]);
  const streamEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const wordDocRef = useRef<HTMLDivElement>(null);
  const kbFileInputRef = useRef<HTMLInputElement>(null);

  const [selectionText, setSelectionText] = useState('');
  const [floatPos, setFloatPos] = useState({ top: 0, left: 0 });

  const { isRecording, isSupported: isSpeechSupported, startRecording, stopRecording, error: speechError } =
    useSpeechRecognition((text) => {
      setInputText(prev => prev ? prev + ' ' + text : text);
    });

  const { messages, isSynthesizing, latestIntent, isLoadingHistory, sendMessage, stopGeneration } = useChatSession(sessionId);
  const { pages, wordDoc, updatingPages, iteratePage, isGenerating, previewStatus, fetchPreview, clearPages, updatePageLocally, applyLayoutAndRefresh, saveWordDoc, resolveImageInPage } = useCourseware(sessionId);
  const { isExporting, exportCourseware } = useExport(sessionId);

  const { 
    isStreaming, 
    streamPages, 
    streamWordDoc, 
    startStreaming, 
    stopStreaming,
    streamError,
    streamThinking
  } = usePPTStream(sessionId);

  useEffect(() => {
    if (!isStreaming && streamPages.length > 0) {
      fetchPreview();
    }
  }, [isStreaming, streamPages, fetchPreview]);

  // RAG Knowledge Base Integration
  const [kbDocs, setKbDocs] = useState<any[]>([]);
  const [linkedDocs, setLinkedDocs] = useState<Set<string>>(new Set());       // Set of document_ids
  const [docToFileId, setDocToFileId] = useState<Map<string, string>>(new Map()); // document_id → session_file_id
  const [linkingDocs, setLinkingDocs] = useState<Set<string>>(new Set());
  const [hoveredLinkDoc, setHoveredLinkDoc] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>('files');
  /** 参考资料 Tab 的子面板切换：docs（知识库文件） | images（会话图片） */
  const [filesSubTab, setFilesSubTab] = useState<'docs' | 'images'>('docs');
  const [isUploadingKb, setIsUploadingKb] = useState(false);
  const [isDraggingKb, setIsDraggingKb] = useState(false);
  const [filesHighlight, setFilesHighlight] = useState(false);
  const [isExportingWord, setIsExportingWord] = useState(false);
  // P2: 任意一张幻灯片正在保存图片，导出按钮短暂禁用防竞态
  const [anyImageSaving, setAnyImageSaving] = useState(false);
  // ── PPT 主题选色器 ─────────────────────────────────────────
  const [showThemePicker, setShowThemePicker] = useState(false);
  /** null 表示「自动」，string 表示选中的 theme_key */
  const [pendingThemeKey, setPendingThemeKey] = useState<string | null>(null);
  // 教案手动编辑模式
  const [wordEditMode, setWordEditMode] = useState(false);
  const [wordDraft, setWordDraft] = useState('');
  const wordEditRef = useRef<HTMLTextAreaElement>(null);

  // ── Session 标题（读取 + 内联编辑）────────────────────
  const [sessionTitle, setSessionTitle] = useState('');
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [titleSaving, setTitleSaving] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);

  /** 点击 Paperclip 按钮：切换到参考资料 Tab 并触发高亮提示 */
  const handleOpenFiles = () => {
    setActiveTab('files');
    setFilesSubTab('docs');
    setFilesHighlight(true);
    setTimeout(() => setFilesHighlight(false), 1800);
  };

  const handleExportWord = async () => {
    if (!wordDoc || isExportingWord || sessionId === 'new') return;
    setIsExportingWord(true);
    try {
      await exportWordDocx(sessionId);
    } catch (e: any) {
      alert('讲义导出失败：' + (e?.message || '未知错误'));
    } finally {
      setIsExportingWord(false);
    }
  };
  
  const fetchKbDocs = useCallback(async () => {
    try {
      const res = await listKnowledgeDocs(1, 50);
      setKbDocs(res?.items || []);
    } catch (e) {
      console.error('Failed to load KB docs', e);
    }
  }, []);

  useEffect(() => {
    fetchKbDocs();
  }, [fetchKbDocs]);

  // Poll while any doc is still being vectorized
  useEffect(() => {
    const hasPending = kbDocs.some((d: any) => d.status === 'pending' || d.status === 'processing');
    if (!hasPending) return;
    const timer = setInterval(fetchKbDocs, 3000);
    return () => clearInterval(timer);
  }, [kbDocs, fetchKbDocs]);

  const handleToggleLink = async (docId: string, isLinked: boolean) => {
    if (sessionId === 'new') {
      alert('请先创建会话再管理关联资料');
      return;
    }
    
    setLinkingDocs(prev => new Set(prev).add(docId));
    try {
      if (isLinked) {
        // Use session_file_id for the DELETE endpoint (not document_id)
        const fileId = docToFileId.get(docId) ?? docId;
        await removeReference(sessionId, fileId);
        setLinkedDocs(prev => {
          const next = new Set(prev);
          next.delete(docId);
          return next;
        });
        setDocToFileId(prev => {
          const next = new Map(prev);
          next.delete(docId);
          return next;
        });
      } else {
        // CRITICAL FIX: /references uses SET semantics on the backend.
        // Passing only [docId] would delete all previously bound documents.
        // We must pass ALL currently linked docs + the new one.
        const allDocIds = [...Array.from(linkedDocs), docId];
        await addReferences(sessionId, allDocIds);
        setLinkedDocs(prev => new Set(prev).add(docId));

        // Refresh docToFileId so the new doc's session_file_id is available for unbinding.
        getSession(sessionId).then(res => {
          const associated: any[] = res?.associated_files || [];
          const mapping = new Map<string, string>();
          associated.forEach((entry: any) => {
            if (typeof entry === 'string') {
              // old plain-string format — no session_file_id available
            } else if (entry?.document_id && entry?.session_file_id) {
              mapping.set(entry.document_id, entry.session_file_id);
            }
          });
          setDocToFileId(mapping);
        }).catch(() => { /* non-critical — document_id fallback still works */ });
      }
    } catch (e) {
      alert(isLinked ? '资料解绑失败，请重试。' : '资料关联失败，请重试。');
    } finally {
      setLinkingDocs(prev => {
        const next = new Set(prev);
        next.delete(docId);
        return next;
      });
    }
  };

  const handleKbUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ''; // reset so same file can be re-selected
    setIsUploadingKb(true);
    try {
      await uploadKnowledgeDoc(file, { subject: '通用类目' });
      await fetchKbDocs();
    } catch {
      alert('上传失败，请检查文件格式或网络（支持 PDF / DOCX / PPTX / TXT / MD）');
    } finally {
      setIsUploadingKb(false);
    }
  };

  const handleKbFilesDrop = async (files: FileList) => {
    const valid = Array.from(files).filter(f =>
      ['.pdf', '.docx', '.doc', '.pptx', '.ppt', '.txt', '.md'].some(ext => f.name.toLowerCase().endsWith(ext))
    );
    if (!valid.length) { alert('仅支持 PDF / DOCX / PPTX / TXT / MD 格式文件'); return; }
    setIsUploadingKb(true);
    try {
      await Promise.all(valid.map(f => uploadKnowledgeDoc(f, { subject: '通用类目' })));
      await fetchKbDocs();
    } catch {
      alert('上传失败，请检查文件格式或网络');
    } finally {
      setIsUploadingKb(false);
    }
  };

  // Load linked docs when session changes, then also clear transient state
  useEffect(() => {
    setLinkedDocs(new Set());
    setDocToFileId(new Map());
    setLinkingDocs(new Set());
    setInputText('');
    setSelectionText('');

    if (sessionId && sessionId !== 'new') {
      let active = true;
      getSession(sessionId).then(res => {
        if (!active) return;
        // API 2.3 (updated): associated_files is an array of objects
        // Each object: { session_file_id, document_id, filename, status }
        const associated: any[] = res?.associated_files || [];
        
        const docIds = new Set<string>();
        const mapping = new Map<string, string>();

        associated.forEach((entry: any) => {
          // Support both old format (plain string id) and new object format
          if (typeof entry === 'string') {
            docIds.add(entry);
          } else if (entry?.document_id) {
            docIds.add(entry.document_id);
            if (entry.session_file_id) {
              mapping.set(entry.document_id, entry.session_file_id);
            }
          }
        });

        setLinkedDocs(docIds);
        setDocToFileId(mapping);
        // 读取 course_name 作为页面标题
        if (res?.course_name) setSessionTitle(res.course_name);
      }).catch(e => console.warn('Failed to load linked docs for session', e));
      return () => { active = false; };
    }
    // 新建模式清除标题
    if (sessionId === 'new') setSessionTitle('');
  }, [sessionId]);

  // 监听 Sidebar 重命名操作，同步更新顶部标题
  useEffect(() => {
    const handleRenamed = (e: Event) => {
      const { sessionId: renamedId, courseName } = (e as CustomEvent).detail ?? {};
      if (renamedId === sessionId && courseName) {
        setSessionTitle(courseName);
      }
    };
    window.addEventListener('EduAgent_Session_Renamed', handleRenamed);
    return () => window.removeEventListener('EduAgent_Session_Renamed', handleRenamed);
  }, [sessionId]);

  // 内联标题编辑 handlers
  const startTitleEdit = () => {
    setTitleDraft(sessionTitle);
    setTitleEditing(true);
    setTimeout(() => titleInputRef.current?.select(), 30);
  };

  const commitTitleEdit = async () => {
    const trimmed = titleDraft.trim();
    if (!trimmed || trimmed === sessionTitle || sessionId === 'new') {
      setTitleEditing(false);
      return;
    }
    setTitleSaving(true);
    try {
      await renameSession(sessionId, trimmed);
      setSessionTitle(trimmed);
      // 通知 Sidebar 同步更新列表标题
      window.dispatchEvent(
        new CustomEvent('EduAgent_Session_Renamed', {
          detail: { sessionId, courseName: trimmed },
        })
      );
    } catch {
      // 失败时保留旧标题
    } finally {
      setTitleSaving(false);
      setTitleEditing(false);
    }
  };

  // Auto scroll to bottom only if user hasn't scrolled up
  const shouldAutoScroll = useRef(true);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const isNearBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 100;
    shouldAutoScroll.current = isNearBottom;
  };

  useEffect(() => {
    if (shouldAutoScroll.current) {
      streamEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Focus Hijacking: Auto-switch to PPT tab when AI is generating it via tools
  useEffect(() => {
    const handleGenerateStart = (e: Event) => {
       const ev = e as CustomEvent;
       if (ev.detail?.sessionId === sessionId) {
          console.log('[Focus Hijack] Tool Call detected, auto-switching to PPT.');
          setActiveTab('ppt');
       }
    };
    const handleStartStreaming = async (e: Event) => {
       const ev = e as CustomEvent;
       if (ev.detail?.sessionId === sessionId) {
          console.log('[Stream Trigger] Tool requested streaming, switching to PPT and starting stream.');
          setActiveTab('ppt');
          // 全量重生成：先清空旧预览，避免新旧页叠加渲染
          clearPages();
          await startStreaming(Array.from(linkedDocs), ev.detail.mode || 'depth');
          fetchPreview();
       }
    };

    window.addEventListener('EduAgent_Generate_Start', handleGenerateStart);
    window.addEventListener('EduAgent_Start_Streaming', handleStartStreaming);
    
    // Auto-stop stream if session changes? (handled by usePPTStream internally but good to be explicit here)
    if (isStreaming && sessionId === 'new') stopStreaming();

    // Intent-based fallback
    if (latestIntent && sessionId !== 'new') {
      const intentLower = latestIntent.toLowerCase();
      if (intentLower.includes('generate_courseware') || intentLower.includes('generate_ppt')) {
        setActiveTab('ppt');
      }
    }
    
    return () => {
       window.removeEventListener('EduAgent_Generate_Start', handleGenerateStart);
       window.removeEventListener('EduAgent_Start_Streaming', handleStartStreaming);
    };
  }, [latestIntent, sessionId, isStreaming, stopStreaming, startStreaming, linkedDocs, fetchPreview]);

  // Bug Fix: Sync Database Changes (like addslide tool execution) to PPT Preview 
  // Triggered when AI finishes talking / executing tools.
  useEffect(() => {
    if (!isSynthesizing && sessionId !== 'new' && sessionId) {
      console.log('[Sync] AI completed synthesis/tools, checking for PPT updates.');
      // Adding a slight delay to ensure DB transaction commits before fetch
      setTimeout(() => fetchPreview(), 500);
    }
  }, [isSynthesizing, fetchPreview, sessionId]);

  const handleSubmit = () => {
    const text = inputText.trim();
    if (text && !isSynthesizing) {
      sendMessage(text);
      setInputText('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleSelection = () => {
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) {
      const text = selection.toString().trim();
      if (text) {
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        setFloatPos({
          top: rect.top - 48, // slightly above the selection
          left: rect.left + rect.width / 2
        });
        setSelectionText(text);
        return;
      }
    }
    setSelectionText('');
  };

  const handleHighlightAsk = () => {
    const brief = selectionText.length > 40 ? selectionText.substring(0, 40) + '...' : selectionText;
    setInputText(`针对内容选段：“${brief}”\n我的修改意见是：`);
    setSelectionText('');
    window.getSelection()?.removeAllRanges();
    setTimeout(() => {
      inputRef.current?.focus();
    }, 50);
  };

  return (
    <div className={styles.workspace}>
      
      {/* LEFT PANEL: Chat Interaction */}
      <section className={styles.chatPanel} style={{ width: chatWidth, minWidth: CHAT_MIN, maxWidth: CHAT_MAX }}>
        <header className={styles.chatHeader}>
          <div className={styles.sessionInfo}>
            {sessionId === 'new' ? (
              <h2 className={styles.sessionTitle}>新建课件会话</h2>
            ) : titleEditing ? (
              /* 内联编辑模式 */
              <div className={styles.titleEditRow}>
                <input
                  ref={titleInputRef}
                  className={styles.titleInput}
                  value={titleDraft}
                  onChange={e => setTitleDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') commitTitleEdit();
                    if (e.key === 'Escape') setTitleEditing(false);
                  }}
                  onBlur={commitTitleEdit}
                  disabled={titleSaving}
                  maxLength={60}
                  autoFocus
                />
                {titleSaving && <Loader2 size={14} className={styles.rotating} />}
              </div>
            ) : (
              /* 展示模式：hover 显示铅笔 */
              <h2
                className={styles.sessionTitle}
                title="点击修改标题"
              >
                <span className={styles.sessionTitleText}>
                  {sessionTitle || '无标题会话'}
                </span>
                <button
                  className={styles.titleEditBtn}
                  onClick={startTitleEdit}
                  title="修改标题"
                >
                  <Pencil size={12} />
                </button>
              </h2>
            )}
            <span className={styles.sessionStatus}>
              {isSynthesizing ? (
                 <><Sparkles size={14} className={clsx(styles.sparkleIcon, styles.rotating)}/> 思考中...</>
              ) : (
                 <><Sparkles size={14} className={styles.sparkleIcon}/> 准备就绪</>
              )}
            </span>
          </div>
        </header>

        {sessionId === 'new' ? (
          <div className={styles.newSessionGuide}>
            <div className={styles.newSessionIconRing}>
              <Sparkles size={36} />
            </div>
            <h3 className={styles.newSessionTitle}>开始你的 AI 创作之旅</h3>
            <p className={styles.newSessionDesc}>
              新建一个会话，告诉 AI 你想设计什么课程，<br />
              即可开启协作备课之旅。
            </p>
            <button
              className={clsx('button-primary', styles.newSessionCta)}
              onClick={() => {
                // 触发 Sidebar 的新建弹窗，通过全局事件传递
                window.dispatchEvent(new CustomEvent('EduAgent_Open_NewSession'));
              }}
            >
              <Sparkles size={16} /> 新建课件会话
            </button>
          </div>
        ) : isLoadingHistory ? (
          /* ── 历史记录加载骨架屏 ── */
          <div className={styles.historyLoadingWrapper}>
            <div className={styles.historyLoadingSpinner}>
              <Loader2 size={36} className={styles.rotating} />
            </div>
            <p className={styles.historyLoadingTitle}>正在恢复会话...</p>
            <p className={styles.historyLoadingHint}>正在从服务器加载历史对话记录</p>
            <div className={styles.loadingSkeletonGroup}>
              <div className={clsx(styles.loadingSkeleton, styles.skeletonAi)} />
              <div className={clsx(styles.loadingSkeleton, styles.skeletonUser)} />
              <div className={clsx(styles.loadingSkeleton, styles.skeletonAiLong)} />
            </div>
          </div>
        ) : (
          <>
            <div className={styles.messageStream} onScroll={handleScroll}>
              {messages.length === 0 && !isSynthesizing ? (
                <div className={styles.emptyState}>
                  <div className={styles.emptyIconWrapper}>
                    <Sparkles size={32} />
                  </div>
                  <h3>您想设计什么课程？</h3>
                  <p>输入教学思路，或上传参考资料，AI 将自动进行设计与重组。</p>
                </div>
              ) : messages.length === 0 && isSynthesizing ? (
                /* AI 请求已发出但响应还未到：显示等待动画 */
                <div className={styles.awaitingResponseWrapper}>
                  <div className={styles.awaitingDots}>
                    <span /><span /><span />
                  </div>
                  <p className={styles.awaitingText}>AI 正在思考中，请稍候...</p>
                </div>
              ) : (
                messages.map((msg) => (
                  <MessageBubble 
                    key={msg.id}
                    id={msg.id} 
                    role={msg.role} 
                    content={msg.content}
                    thinking={msg.thinking}
                    toolLog={msg.toolLog}
                    isThinking={msg.isThinking}
                    isTyping={msg.isTyping} 
                  />
                ))
              )}
              <div ref={streamEndRef} />
            </div>

            {/* OMNI-DOCK INPUT */}
            <div className={styles.inputDockContainer}>
              <div className={clsx(styles.omniDock, 'glass-panel', isGenerating && styles.dockDisabled)}>
                <button
                  className={clsx(styles.iconButton, styles.paperclipBtn)}
                  title="上传参考资料"
                  disabled={isGenerating || sessionId === 'new'}
                  onClick={handleOpenFiles}
                >
                  <Paperclip size={20} />
                </button>
                <textarea 
                  ref={inputRef}
                  className={styles.textarea} 
                  placeholder={isGenerating ? "后台正在生成课件全局结构，为保证状态一致性，暂缓文字指令..." : "描述您的教学逻辑，或者选中右侧PPT指定修改..."}
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  rows={3}
                  disabled={isGenerating}
                />
                <div className={styles.actionsBox}>
                  <button 
                    className={clsx(styles.micButton, isRecording && styles.recording)}
                    onMouseDown={startRecording}
                    onMouseUp={stopRecording}
                    onTouchStart={startRecording}
                    onTouchEnd={stopRecording}
                    title={!isSpeechSupported ? '您的浏览器不支持语音识别' : isGenerating ? '生成期间禁用语音' : '长按说话'}
                    disabled={!isSpeechSupported || isGenerating}
                  >
                    {isRecording ? <MicOff size={20} /> : <Mic size={20} />}
                  </button>
                  {isSynthesizing || isStreaming ? (
                    <button
                      className={clsx('button-primary', styles.sendButton, styles.stopButton)}
                      onClick={() => {
                        stopGeneration();
                        if (isStreaming) stopStreaming();
                      }}
                      title="停止生成"
                    >
                      <Square size={18} fill="currentColor" />
                    </button>
                  ) : (
                    <button
                      className={clsx('button-primary', styles.sendButton)}
                      disabled={!inputText.trim() || isGenerating}
                      onClick={handleSubmit}
                      title="发送消息"
                    >
                      <Send size={18} />
                    </button>
                  )}
                </div>
              </div>
              {speechError && (
                <p className={styles.speechError}>⚠️ {speechError}</p>
              )}
            </div>
          </>
        )}
      </section>

      {/* DRAG DIVIDER */}
      <div
        className={styles.divider}
        onMouseDown={handleDividerMouseDown}
        title="拖拽调整宽度"
      />

      {/* RIGHT PANEL: Visual WorkSpace */}
      <section className={styles.visualPanel}>
        {sessionId === 'new' ? (
          <div className={styles.welcomeHero}>
            <div className={styles.heroContent}>
              <div className={styles.heroBadge}>
                <Sparkles size={14} /> 全新一代智能备课
              </div>
              <h2 className={styles.heroTitle}>
                开启你的 <span>AI 创意空间</span>
              </h2>
              <p className={styles.heroDesc}>
                在这里构建、推演并沉淀你的教学思想。<br/>
                上传语料库，只需一句话即可生成多端图元排版课件与配套讲义。
              </p>
              
              <div className={styles.heroFeatures}>
                <div className={styles.featureCard}>
                  <Library size={24} className={styles.featureIcon} />
                  <h4>全局 RAG 知识库</h4>
                  <p>无缝关联教学材料，确保 AI 提取内容精准、紧贴大纲且绝不发散。</p>
                </div>
                <div className={styles.featureCard}>
                  <Link size={24} className={styles.featureIcon} />
                  <h4>多端物料一致性并行生成</h4>
                  <p>一键提炼 PPT 骨架与 Word 完整串词，告别机械的文档排版与复制黏贴。</p>
                </div>
              </div>
            </div>
          </div>
        ) : (
        <Tabs.Root className={styles.tabsRoot} value={activeTab} onValueChange={setActiveTab}>
          <header className={styles.visualHeader}>
            <Tabs.List className={styles.tabsList}>
              <Tabs.Trigger className={styles.tabsTrigger} value="files">参考资料</Tabs.Trigger>
              <Tabs.Trigger className={styles.tabsTrigger} value="ppt">课件预览 (PPT)</Tabs.Trigger>
              <Tabs.Trigger className={styles.tabsTrigger} value="word">讲义 (Word)</Tabs.Trigger>
            </Tabs.List>
            <div className={styles.headerActions} style={{ display: 'flex', gap: '8px' }}>
              {pages.length > 0 && (
                <>
                  <button
                    className={clsx('button-base', styles.exportBtn)}
                    onClick={() => setShowThemePicker(true)}
                    disabled={isExporting || anyImageSaving || sessionId === 'new'}
                    title={anyImageSaving ? '图片保存中，请稍候再导出' : '选择主题并导出 PPT'}
                  >
                    <Download size={16} className={clsx(isExporting && styles.rotating)} />
                    {isExporting ? '导出 PPT 中...' : '导出 PPT'}
                  </button>
                  {wordDoc && (
                    <button 
                      className={clsx('button-base', styles.exportBtn)}
                      onClick={handleExportWord}
                      disabled={isExportingWord || sessionId === 'new'}
                    >
                      <FileText size={16} className={clsx(isExportingWord && styles.rotating)} /> 
                      {isExportingWord ? '导出中...' : '导出讲义 (.docx)'}
                    </button>
                  )}
                </>
              )}
            </div>
          </header>

          <Tabs.Content className={styles.tabsContent} value="files">
            <div className={clsx(styles.kbPanel, filesHighlight && styles.kbPanelHighlight)}>
              {/* 子 Tab 切换（知识库文档 / 图片素材） */}
              <div className={styles.subTabBar}>
                <button
                  className={clsx(styles.subTabBtn, filesSubTab === 'docs' && styles.subTabActive)}
                  onClick={() => setFilesSubTab('docs')}
                >
                  <Library size={14} /> 知识库文档
                </button>
                <button
                  className={clsx(styles.subTabBtn, filesSubTab === 'images' && styles.subTabActive)}
                  onClick={() => setFilesSubTab('images')}
                >
                  <ImageIcon size={14} /> 图片素材
                </button>
              </div>

              {/* 知识库文档面板 */}
              {filesSubTab === 'docs' && (
                <>
                  {/* 拖拽上传区 */}
                  <div
                    className={clsx(styles.kbDropzone, isDraggingKb && styles.kbDropzoneDragging, isUploadingKb && styles.kbDropzoneUploading)}
                    onDrop={(e) => { e.preventDefault(); setIsDraggingKb(false); if (e.dataTransfer.files.length) handleKbFilesDrop(e.dataTransfer.files); }}
                    onDragOver={(e) => { e.preventDefault(); setIsDraggingKb(true); }}
                    onDragLeave={() => setIsDraggingKb(false)}
                    onClick={() => !isUploadingKb && kbFileInputRef.current?.click()}
                    role="button"
                    tabIndex={0}
                    aria-label="点击或拖拽文档到此处上传"
                  >
                    <input
                      ref={kbFileInputRef}
                      type="file"
                      accept=".pdf,.docx,.doc,.pptx,.ppt,.txt,.md"
                      style={{ display: 'none' }}
                      onChange={handleKbUpload}
                    />
                    {isUploadingKb ? (
                      <><Loader2 size={20} className={styles.spinner} /> <span>上传中...</span></>
                    ) : isDraggingKb ? (
                      <><UploadCloud size={20} /> <span>松开即可上传</span></>
                    ) : (
                      <><UploadCloud size={18} /> <span>拖拽 / 点击上传文档</span><small>PDF · DOCX · PPTX · TXT · MD</small></>
                    )}
                  </div>

                  {kbDocs.length === 0 ? (
                    <div className={styles.placeholderCentric}>
                      暂无知识库文档，拖拽或点击上方区域添加
                    </div>
                  ) : (
                    <div className={styles.kbList}>
                      {kbDocs.map((doc: any) => {
                        const isLinked = linkedDocs.has(doc.document_id);
                        const isLinking = linkingDocs.has(doc.document_id);
                        const isCompleted = doc.status === 'completed' || !doc.status;
                        const isFailed   = doc.status === 'failed';
                        const isProcessing = doc.status === 'processing';
                        const isPending  = doc.status === 'pending';
                        return (
                          <div key={doc.document_id} className={clsx(styles.kbListItem, 'glass-panel')}>
                            <div className={styles.kbItemInfo}>
                              <FileText size={18} className={styles.docIcon} />
                              <div className={styles.kbItemTextWrap}>
                                <h4 className={styles.kbItemTitle} title={doc.filename}>{doc.filename}</h4>
                                <div className={styles.kbItemMetaRow}>
                                  <span className={styles.kbItemMeta}>{doc.subject || '通用类目'}</span>
                                  {isCompleted && (
                                    <span className={clsx(styles.docStatusBadge, styles.statusCompleted)}>
                                      <CheckCircle size={10} /> 已向量化
                                    </span>
                                  )}
                                  {isProcessing && (
                                    <span className={clsx(styles.docStatusBadge, styles.statusProcessing)}>
                                      <Loader2 size={10} className={styles.spinner} /> 向量化中...
                                    </span>
                                  )}
                                  {isPending && (
                                    <span className={clsx(styles.docStatusBadge, styles.statusPending)}>
                                      <Clock size={10} /> 等待处理
                                    </span>
                                  )}
                                  {isFailed && (
                                    <span className={clsx(styles.docStatusBadge, styles.statusFailed)}>
                                      <AlertCircle size={10} /> 失败
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                            <div className={styles.kbItemActions}>
                              {isFailed ? (
                                <span className={styles.failedLabel}>
                                  <AlertCircle size={13} /> 不可关联
                                </span>
                              ) : (
                                <button
                                  className={clsx(
                                    isLinked
                                      ? (hoveredLinkDoc === doc.document_id ? styles.btnUnlinkHover : styles.btnLinked)
                                      : 'button-primary',
                                    styles.actionBtn
                                  )}
                                  disabled={isLinking || sessionId === 'new' || !isCompleted}
                                  onClick={() => handleToggleLink(doc.document_id, isLinked)}
                                  onMouseEnter={() => setHoveredLinkDoc(doc.document_id)}
                                  onMouseLeave={() => setHoveredLinkDoc(null)}
                                  title={!isCompleted ? '向量化完成后方可关联' : isLinked ? '点击解除绑定' : '点击加入会话'}
                                >
                                  {isLinking ? (
                                    <><Loader2 size={14} className={styles.spinner} /> 变更中</>
                                  ) : !isCompleted ? (
                                    <><Clock size={14} /> 处理中</>
                                  ) : isLinked ? (
                                    hoveredLinkDoc === doc.document_id ? (
                                      <><Unlink size={14} /> 取消绑定</>
                                    ) : (
                                      <><CheckCircle size={14} /> 已绑定</>
                                    )
                                  ) : (
                                    <><Link size={14} /> 加入会话</>
                                  )}
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}

              {/* 图片素材面板 */}
              {filesSubTab === 'images' && (
                <ImageUploadPanel />
              )}
            </div>
          </Tabs.Content>
          
          <Tabs.Content className={styles.tabsContent} value="ppt">
            <div className={styles.canvasArea}>
              {/* HEAVY LOADING: Only show full-screen loader if we aren't streaming yet and have no assets */}
              {(isGenerating || previewStatus === 'loading') && !isStreaming && pages.length === 0 && streamPages.length === 0 ? (
                <div className={styles.emptyStateContainer} style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-primary)' }}>
                  <Loader2 size={48} className={styles.rotating} style={{ marginBottom: '16px', color: 'var(--accent-primary)' }} />
                  <h3 style={{ marginBottom: '12px' }}>AI 正在智能排版课件</h3>
                  <p style={{ maxWidth: '420px', textAlign: 'center', lineHeight: '1.6', color: 'var(--text-secondary)' }}>
                    大模型正在深度重组知识架构，并为您渲染多端图元排版。<br/>
                    该过程极其消耗心智，约需 <strong>80-90 秒</strong>。<br/>
                    您可以切回左侧处理其他会话，后台渲染不会中断。
                  </p>
                </div>
              ) : previewStatus === 'error' && !isStreaming && pages.length === 0 ? (
                <div className={styles.emptyStateContainer} style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-primary)' }}>
                  <span style={{ fontSize: '48px', marginBottom: '16px' }}>⚠️</span>
                  <h3 style={{ marginBottom: '12px' }}>课件加载中断</h3>
                  <p style={{ maxWidth: '380px', textAlign: 'center', lineHeight: '1.6', color: 'var(--text-secondary)', marginBottom: '20px' }}>
                    此时无法拉取课件预览。这极大可能是后端发生数据严重异常（Validation Error），或者是由于生成的课件结构缺少必需字段而被后端拒绝。
                  </p>
                  <button
                    className='button-primary'
                    onClick={() => {
                      // 全量重生成：先清空旧预览，避免新旧页叠加渲染
                      clearPages();
                      startStreaming(Array.from(linkedDocs), 'fast', true);
                    }}
                    disabled={sessionId === 'new'}
                    style={{ padding: '10px 24px' }}
                  >
                    🔄 重新生成
                  </button>
                </div>
              ) : (
                <>
                  {/* Render existing stable pages */}
                  {pages.map(page => (
                    <PPTCard 
                      key={page.page_index} 
                      page={page}
                      sessionId={sessionId}
                      isUpdating={updatingPages.has(page.page_index)}
                      isStreaming={isStreaming}
                      onIterate={(instruction) => iteratePage(page.page_index, instruction)}
                      onManualSave={(pageIndex, updated) => updatePageLocally(pageIndex, updated)}
                      onApplyLayout={(layoutType) => applyLayoutAndRefresh(page.page_index, layoutType)}
                      onImageResolved={(elementId, imageId, previewUrl) =>
                        resolveImageInPage(page.page_index, elementId, imageId, previewUrl)
                      }
                      onSavingImageChange={(saving) => setAnyImageSaving(saving)}
                    />
                  ))}
                  
                  {/* Render streaming pages (retain during transition before fetchPreview finishes) */}
                  {streamPages.map(page => {
                     // Deduplicate if pages hasn't synced yet
                     if (pages.some(p => p.page_index === page.page_index)) return null;
                     return (
                       <PPTCard 
                         key={page.page_index} 
                         page={page}
                         sessionId={sessionId}
                         isUpdating={false}
                         isStreaming={true}
                         onIterate={() => {}} // Disabled during stream for stability
                       />
                     );
                  })}
                  
                  {/* Render the next page skeleton */}
                  {isStreaming && (
                    <PPTSkeleton 
                      pageNumber={(streamPages.length || pages.length) + 1} 
                      streamThinking={streamThinking}
                    />
                  )}

                  {/* Empty State */}
                  {pages.length === 0 && !isStreaming && previewStatus !== 'loading' && (
                    <div className={styles.emptyStateContainer} style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)', opacity: 0.6 }}>
                      <Sparkles size={48} style={{ marginBottom: '16px' }} />
                      <h3>课件待生成</h3>
                      <p>请点击右上角「✨ AI 一键生成课件」开始</p>
                    </div>
                  )}
                  
                  {streamError && !isStreaming && (
                    <div className={styles.streamErrorToast}>
                      ⚠️ {streamError}
                    </div>
                  )}
                </>
              )}
            </div>
          </Tabs.Content>
          
          <Tabs.Content className={styles.tabsContent} value="word">
            {/* 教案工具栏 */}
            <div className={styles.wordToolbar}>
              <span className={styles.wordToolbarTitle}>
                讲义文稿
              </span>
              <div className={styles.wordToolbarActions}>
                {(streamWordDoc || wordDoc) && (
                  <>
                    <button
                      className={clsx(styles.wordModeBtn, !wordEditMode && styles.wordModeBtnActive)}
                      onClick={() => setWordEditMode(false)}
                    >
                      预览
                    </button>
                    <button
                      className={clsx(styles.wordModeBtn, wordEditMode && styles.wordModeBtnActive)}
                      onClick={() => {
                        setWordDraft(streamWordDoc || wordDoc);
                        setWordEditMode(true);
                        setTimeout(() => wordEditRef.current?.focus(), 80);
                      }}
                    >
                      <Pencil size={12} /> 编辑
                    </button>
                    {wordEditMode && (
                      <button
                        className={styles.wordSaveBtn}
                        onClick={async () => {
                          setWordEditMode(false);       // 乐观退出，用户不感知延迟
                          await saveWordDoc(wordDraft); // 后台持久化，失败也保留本地
                        }}
                      >
                        <Check size={12} /> 保存
                      </button>
                    )}
                  </>
                )}
                {!wordEditMode && (streamWordDoc || wordDoc) && (
                  <button
                    className={clsx('button-primary', styles.exportWordBtn)}
                    onClick={handleExportWord}
                    disabled={isExportingWord || !wordDoc || sessionId === 'new'}
                  >
                    {isExportingWord ? <><Loader2 size={14} className={styles.spinner} /> 导出中...</> : <><Download size={14} /> 导出 Word</>}
                  </button>
                )}
              </div>
            </div>

            <div className={clsx(styles.wordDoc, 'glass-panel')}>
              {isGenerating && !isStreaming ? (
                <div className={styles.emptyStateContainer} style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-primary)' }}>
                  <Loader2 size={48} className={styles.rotating} style={{ marginBottom: '16px', color: 'var(--accent-primary)' }} />
                  <h3 style={{ marginBottom: '12px' }}>AI 正在提炼讲义长文</h3>
                  <p style={{ maxWidth: '420px', textAlign: 'center', lineHeight: '1.6', color: 'var(--text-secondary)' }}>
                    大模型正在为您扩写与课件配套的完整教学讲义文稿。<br/>
                    该并行流处理大约需要 <strong>80-90 秒</strong>。<br/>
                    请稍作等待，全套资料链即可完成闭环。
                  </p>
                </div>
              ) : wordEditMode ? (
                /* ── 手动编辑模式 */
                <textarea
                  ref={wordEditRef}
                  className={styles.wordEditTextarea}
                  value={wordDraft}
                  onChange={e => setWordDraft(e.target.value)}
                  placeholder="在此处编辑 Markdown 讲义内容..."
                  spellCheck={false}
                />
              ) : (streamWordDoc || wordDoc) ? (
                <div className={styles.markdownWrapper} onMouseUp={handleSelection} ref={wordDocRef}>
                  <ReactMarkdown 
                    remarkPlugins={[remarkGfm, remarkMath]} 
                    rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false }], rehypeRaw]}
                  >
                    {streamWordDoc || wordDoc}
                  </ReactMarkdown>
                </div>
              ) : (
                <div className={styles.emptyStateContainer} style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)', opacity: 0.6 }}>
                  <Sparkles size={48} style={{ marginBottom: '16px' }} />
                  <h3>讲义待生成</h3>
                  <p>随课件一并产出，请先生成课件</p>
                </div>
              )}
            </div>
            
            {/* FLOATING ACTION BUTTON */}
            {selectionText && (
              <button 
                className={clsx(styles.floatActionBtn, 'glass-panel')}
                style={{ top: floatPos.top, left: floatPos.left }}
                onClick={handleHighlightAsk}
              >
                ✨ 针对此划词发起修改
              </button>
            )}
          </Tabs.Content>
        </Tabs.Root>
        )}
      </section>

      {/* ── PPT 主题选色器 Overlay ── */}
      {showThemePicker && (
        <ThemePicker
          selectedKey={pendingThemeKey}
          onSelect={setPendingThemeKey}
          onConfirm={(themeKey) => {
            setShowThemePicker(false);
            exportCourseware(themeKey ?? undefined);
          }}
          onCancel={() => setShowThemePicker(false)}
        />
      )}

    </div>
  );
}

