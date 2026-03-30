import React, { useState, useRef, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Mic, MicOff, Paperclip, Send, Square, Download, Sparkles } from 'lucide-react';
import styles from './Workspace.module.css';
import { clsx } from 'clsx';
import * as Tabs from '@radix-ui/react-tabs';
import { useChatSession } from '../hooks/useChatSession';
import MessageBubble from '../components/MessageBubble';
import { useCourseware } from '../hooks/useCourseware';
import PPTCard from '../components/PPTCard';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { useExport } from '../hooks/useExport';
import { listKnowledgeDocs, addReferences } from '../utils/api';

export default function Workspace() {
  const { sessionId = 'new' } = useParams();
  const [inputText, setInputText] = useState('');
  const streamEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const [selectionText, setSelectionText] = useState('');
  const [floatPos, setFloatPos] = useState({ top: 0, left: 0 });

  const { isRecording, isSupported: isSpeechSupported, startRecording, stopRecording, error: speechError } =
    useSpeechRecognition((text) => {
      setInputText(prev => prev ? prev + ' ' + text : text);
    });

  const { messages, isSynthesizing, latestIntent, sendMessage, stopGeneration } = useChatSession(sessionId);
  const { pages, wordDoc, updatingPages, iteratePage, isGenerating, handleGenerate } = useCourseware(sessionId);
  const { isExporting, exportCourseware } = useExport(sessionId);

  // RAG Knowledge Base Integration
  const [kbDocs, setKbDocs] = useState<any[]>([]);
  const [linkedDocs, setLinkedDocs] = useState<Set<string>>(new Set());
  
  useEffect(() => {
    let active = true;
    listKnowledgeDocs(1, 50).then(res => {
      if (active) setKbDocs(res?.items || []);
    }).catch(e => console.error("Failed to load KB docs", e));
    return () => { active = false; };
  }, []);

  const handleLinkDoc = async (docId: string) => {
    if (sessionId === 'new') {
      alert('请先创建会话再关联资料');
      return;
    }
    try {
      await addReferences(sessionId, [docId]);
      setLinkedDocs(prev => new Set(prev).add(docId));
    } catch (e) {
      alert('资料关联失败');
    }
  };

  // State cleanup on session switch
  useEffect(() => {
    setLinkedDocs(new Set());
    setInputText('');
    setSelectionText('');
  }, [sessionId]);

  // Auto scroll to bottom
  useEffect(() => {
    streamEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // AI Tool Caller (MCP Proxy)
  useEffect(() => {
    if (latestIntent && !isGenerating && sessionId !== 'new') {
      const intentLower = latestIntent.toLowerCase();
      // If AI's intent suggests UI should create PPT, automatically trigger it.
      if (intentLower.includes('generate_courseware') || intentLower.includes('generate_ppt') || intentLower.includes('mcp_generate')) {
        console.log('[MCP Proxy] AI Intent detected:', latestIntent, '-> Auto-triggering Generate!');
        // We simulate user clicking the '一键生成' button
        // Optional delay for better UI UX
        const timer = setTimeout(() => {
          handleGenerate(Array.from(linkedDocs), 'fast');
        }, 1000);
        return () => clearTimeout(timer);
      }
    }
  }, [latestIntent, isGenerating, sessionId, linkedDocs, handleGenerate]);

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
      <section className={styles.chatPanel}>
        <header className={styles.chatHeader}>
          <div className={styles.sessionInfo}>
            <h2 className={styles.sessionTitle}>
              {sessionId === 'new' ? '新建课件会话' : '持续设计课件'}
            </h2>
            <span className={styles.sessionStatus}>
              {isSynthesizing ? (
                 <><Sparkles size={14} className={clsx(styles.sparkleIcon, styles.rotating)}/> 思考中...</>
              ) : (
                 <><Sparkles size={14} className={styles.sparkleIcon}/> 准备就绪</>
              )}
            </span>
          </div>
        </header>

        <div className={styles.messageStream}>
          {messages.length === 0 ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyIconWrapper}>
                <Sparkles size={32} />
              </div>
              <h3>您想设计什么课程？</h3>
              <p>输入教学思路，或上传参考资料，AI 将自动进行设计与重组。</p>
            </div>
          ) : (
            messages.map((msg) => (
              <MessageBubble 
                key={msg.id}
                id={msg.id} 
                role={msg.role} 
                content={msg.content} 
                isTyping={msg.isTyping} 
              />
            ))
          )}
          <div ref={streamEndRef} />
        </div>

        {/* OMNI-DOCK INPUT */}
        <div className={styles.inputDockContainer}>
          <div className={clsx(styles.omniDock, 'glass-panel')}>
            <button className={styles.iconButton} title="上传参考资料">
              <Paperclip size={20} />
            </button>
            <textarea 
              ref={inputRef}
              className={styles.textarea} 
              placeholder="描述您的教学逻辑，或者选中右侧PPT指定修改..."
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
            />
            <div className={styles.actionsBox}>
              <button 
                className={clsx(styles.micButton, isRecording && styles.recording)}
                onMouseDown={startRecording}
                onMouseUp={stopRecording}
                onTouchStart={startRecording}
                onTouchEnd={stopRecording}
                title={isSpeechSupported ? '长按说话' : '您的浏览器不支持语音识别'}
                disabled={!isSpeechSupported}
              >
                {isRecording ? <MicOff size={20} /> : <Mic size={20} />}
              </button>
              {isSynthesizing ? (
                <button
                  className={clsx('button-primary', styles.sendButton, styles.stopButton)}
                  onClick={stopGeneration}
                  title="停止生成"
                >
                  <Square size={18} fill="currentColor" />
                </button>
              ) : (
                <button
                  className={clsx('button-primary', styles.sendButton)}
                  disabled={!inputText.trim()}
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
      </section>

      {/* DRAG DIVIDER */}
      <div className={styles.divider} />

      {/* RIGHT PANEL: Visual WorkSpace */}
      <section className={styles.visualPanel}>
        <Tabs.Root className={styles.tabsRoot} defaultValue="ppt">
          <header className={styles.visualHeader}>
            <Tabs.List className={styles.tabsList}>
              <Tabs.Trigger className={styles.tabsTrigger} value="files">参考资料</Tabs.Trigger>
              <Tabs.Trigger className={styles.tabsTrigger} value="ppt">课件预览 (PPT)</Tabs.Trigger>
              <Tabs.Trigger className={styles.tabsTrigger} value="word">讲义 (Word)</Tabs.Trigger>
            </Tabs.List>
            <div className={styles.headerActions} style={{ display: 'flex', gap: '8px' }}>
              <button 
                className={clsx('button-primary', styles.generateBtn)}
                onClick={() => handleGenerate([], 'fast')}
                disabled={isGenerating || sessionId === 'new'}
              >
                <Sparkles size={16} className={clsx(isGenerating && styles.rotating)} /> 
                {isGenerating ? 'AI生成中...' : 'AI 一键生成课件'}
              </button>
              <button 
                className={clsx('button-base', styles.exportBtn)}
                onClick={exportCourseware}
                disabled={isExporting || sessionId === 'new'}
              >
                <Download size={16} className={clsx(isExporting && styles.rotating)} /> 
                {isExporting ? '导出中...' : '导出 pptx'}
              </button>
            </div>
          </header>

          <Tabs.Content className={styles.tabsContent} value="files">
            <div className={styles.kbPanel}>
              <div className={styles.kbHeader}>
                <h3>全局知识库核心资料池</h3>
                <p>选择并关联相关资料，作为 AI 生成幻灯片的依据。</p>
              </div>
              {kbDocs.length === 0 ? (
                <div className={styles.placeholderCentric}>知识库尚未上传任何文档</div>
              ) : (
                <div className={styles.kbGrid}>
                  {kbDocs.map(doc => {
                    const isLinked = linkedDocs.has(doc.document_id);
                    return (
                      <div key={doc.document_id} className={clsx(styles.kbCard, 'glass-panel')}>
                        <div className={styles.kbCardInfo}>
                          <h4 className={styles.truncate}>{doc.filename}</h4>
                          <span className={styles.kbMeta}>{doc.subject || '通用'}</span>
                        </div>
                        <button 
                          className={clsx(isLinked ? 'button-base' : 'button-primary', styles.linkBtn)}
                          disabled={isLinked || sessionId === 'new'}
                          onClick={() => handleLinkDoc(doc.document_id)}
                        >
                          {isLinked ? '已关联' : '🔗 关联至当前会话'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </Tabs.Content>
          
          <Tabs.Content className={styles.tabsContent} value="ppt">
            <div className={styles.canvasArea}>
              {pages.length > 0 ? (
                pages.map(page => (
                  <PPTCard 
                    key={page.page_index} 
                    page={page} 
                    isUpdating={updatingPages.has(page.page_index)}
                    onIterate={(instruction) => iteratePage(page.page_index, instruction)}
                  />
                ))
              ) : (
                <div className={styles.emptyStateContainer} style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)', opacity: 0.6 }}>
                  <Sparkles size={48} style={{ marginBottom: '16px' }} />
                  <h3>课件待生成</h3>
                  <p>请点击右上角「✨ AI 一键生成课件」开始</p>
                </div>
              )}
            </div>
          </Tabs.Content>
          
          <Tabs.Content className={styles.tabsContent} value="word">
            <div className={clsx(styles.wordDoc, 'glass-panel')}>
              {wordDoc ? (
                <div className={styles.markdownWrapper} onMouseUp={handleSelection}>
                  <ReactMarkdown 
                    remarkPlugins={[remarkGfm]} 
                    rehypePlugins={[rehypeRaw]}
                  >
                    {wordDoc}
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
      </section>

    </div>
  );
}
