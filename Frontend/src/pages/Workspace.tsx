import React, { useState, useRef, useEffect } from 'react';
import { useParams } from 'react-router-dom';

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
import { listKnowledgeDocs, addReferences, removeReference, getSession } from '../utils/api';
import { FileText, Link, CheckCircle, Loader2, Library, Sparkles, Mic, MicOff, Paperclip, Send, Square, Download, Unlink } from 'lucide-react';

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
  const { pages, wordDoc, updatingPages, iteratePage, isGenerating, handleGenerate, previewStatus } = useCourseware(sessionId);
  const { isExporting, exportCourseware } = useExport(sessionId);

  // RAG Knowledge Base Integration
  const [kbDocs, setKbDocs] = useState<any[]>([]);
  const [linkedDocs, setLinkedDocs] = useState<Set<string>>(new Set());
  const [linkingDocs, setLinkingDocs] = useState<Set<string>>(new Set());
  const [hoveredLinkDoc, setHoveredLinkDoc] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>('files');
  
  useEffect(() => {
    let active = true;
    listKnowledgeDocs(1, 50).then(res => {
      if (active) setKbDocs(res?.items || []);
    }).catch(e => console.error("Failed to load KB docs", e));
    return () => { active = false; };
  }, []);

  const handleToggleLink = async (docId: string, isLinked: boolean) => {
    if (sessionId === 'new') {
      alert('请先创建会话再管理关联资料');
      return;
    }
    
    setLinkingDocs(prev => new Set(prev).add(docId));
    try {
      if (isLinked) {
        await removeReference(sessionId, docId);
        setLinkedDocs(prev => {
          const next = new Set(prev);
          next.delete(docId);
          return next;
        });
      } else {
        await addReferences(sessionId, [docId]);
        setLinkedDocs(prev => new Set(prev).add(docId));
        // Soft focus switch to PPT to implicitly hint next action
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

  // Load linked docs when session changes, then also clear transient state
  useEffect(() => {
    setLinkedDocs(new Set());
    setLinkingDocs(new Set());
    setInputText('');
    setSelectionText('');

    if (sessionId && sessionId !== 'new') {
      let active = true;
      getSession(sessionId).then(res => {
        if (!active) return;
        // API 2.3: associated_files contains the IDs of docs linked to this session
        const associated: string[] = res?.associated_files || [];
        setLinkedDocs(new Set(associated));
      }).catch(e => console.warn('Failed to load linked docs for session', e));
      return () => { active = false; };
    }
  }, [sessionId]);

  // Auto scroll to bottom
  useEffect(() => {
    streamEndRef.current?.scrollIntoView({ behavior: 'smooth' });
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
    window.addEventListener('EduAgent_Generate_Start', handleGenerateStart);
    
    // Intent-based fallback (no handleGenerate triggering anymore!)
    if (latestIntent && sessionId !== 'new') {
      const intentLower = latestIntent.toLowerCase();
      if (intentLower.includes('generate_courseware') || intentLower.includes('generate_ppt')) {
        setActiveTab('ppt');
      }
    }
    
    return () => window.removeEventListener('EduAgent_Generate_Start', handleGenerateStart);
  }, [latestIntent, sessionId]);

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
          <div className={clsx(styles.omniDock, 'glass-panel', isGenerating && styles.dockDisabled)}>
            <button className={styles.iconButton} title="上传参考资料" disabled={isGenerating}>
              <Paperclip size={20} />
            </button>
            <textarea 
              ref={inputRef}
              className={styles.textarea} 
              placeholder={isGenerating ? "后台正在生成课件全局结构，为保证状态一致性，暂缓文字指令..." : "描述您的教学逻辑，或者选中右侧PPT指定修改..."}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
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
      </section>

      {/* DRAG DIVIDER */}
      <div className={styles.divider} />

      {/* RIGHT PANEL: Visual WorkSpace */}
      <section className={styles.visualPanel}>
        <Tabs.Root className={styles.tabsRoot} value={activeTab} onValueChange={setActiveTab}>
          <header className={styles.visualHeader}>
            <Tabs.List className={styles.tabsList}>
              <Tabs.Trigger className={styles.tabsTrigger} value="files">参考资料</Tabs.Trigger>
              <Tabs.Trigger className={styles.tabsTrigger} value="ppt">课件预览 (PPT)</Tabs.Trigger>
              <Tabs.Trigger className={styles.tabsTrigger} value="word">讲义 (Word)</Tabs.Trigger>
            </Tabs.List>
            <div className={styles.headerActions} style={{ display: 'flex', gap: '8px' }}>
              <button 
                className={clsx('button-primary', styles.generateBtn)}
                onClick={() => {
                  setActiveTab('ppt');
                  handleGenerate([], 'fast');
                }}
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
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                  <Library size={20} className={styles.sparkleIcon} />
                  <h3 style={{ margin: 0 }}>知识库资料墙</h3>
                </div>
                <p>在此选取并关联 RAG 知识材料。绑定后，AI 会自动基于这些资料为您提炼并生成 PPT 课件。</p>
              </div>
              
              {kbDocs.length === 0 ? (
                <div className={styles.placeholderCentric}>暂无全局知识库文档，请先在左侧进入「知识库管理」上传</div>
              ) : (
                <div className={styles.kbList}>
                  {kbDocs.map(doc => {
                    const isLinked = linkedDocs.has(doc.document_id);
                    const isLinking = linkingDocs.has(doc.document_id);
                    return (
                      <div key={doc.document_id} className={clsx(styles.kbListItem, 'glass-panel')}>
                        <div className={styles.kbItemInfo}>
                          <FileText size={18} className={styles.docIcon} />
                          <div className={styles.kbItemTextWrap}>
                            <h4 className={styles.kbItemTitle} title={doc.filename}>{doc.filename}</h4>
                            <span className={styles.kbItemMeta}>{doc.subject || '通用类目'}</span>
                          </div>
                        </div>
                        <div className={styles.kbItemActions}>
                          <button 
                            className={clsx(
                              isLinked ? (hoveredLinkDoc === doc.document_id ? styles.btnUnlinkHover : styles.btnLinked) : 'button-primary', 
                              styles.actionBtn
                            )}
                            disabled={isLinking || sessionId === 'new'}
                            onClick={() => handleToggleLink(doc.document_id, isLinked)}
                            onMouseEnter={() => setHoveredLinkDoc(doc.document_id)}
                            onMouseLeave={() => setHoveredLinkDoc(null)}
                            title={isLinked ? '点击解除绑定' : '点击加入会话'}
                          >
                            {isLinking ? (
                              <><Loader2 size={14} className={styles.spinner} /> 变更中</>
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
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </Tabs.Content>
          
          <Tabs.Content className={styles.tabsContent} value="ppt">
            <div className={styles.canvasArea}>
              {isGenerating || previewStatus === 'loading' ? (
                <div className={styles.emptyStateContainer} style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-primary)' }}>
                  <Loader2 size={48} className={styles.rotating} style={{ marginBottom: '16px', color: 'var(--accent-primary)' }} />
                  <h3 style={{ marginBottom: '12px' }}>AI 正在智能排版课件</h3>
                  <p style={{ maxWidth: '420px', textAlign: 'center', lineHeight: '1.6', color: 'var(--text-secondary)' }}>
                    大模型正在深度重组知识架构，并为您渲染多端图元排版。<br/>
                    该过程极其消耗心智，约需 <strong>80-90 秒</strong>。<br/>
                    您可以切回左侧处理其他会话，后台渲染不会中断。
                  </p>
                </div>
              ) : previewStatus === 'error' ? (
                <div className={styles.emptyStateContainer} style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-primary)' }}>
                  <span style={{ fontSize: '48px', marginBottom: '16px' }}>⚠️</span>
                  <h3 style={{ marginBottom: '12px' }}>课件生成超时</h3>
                  <p style={{ maxWidth: '380px', textAlign: 'center', lineHeight: '1.6', color: 'var(--text-secondary)', marginBottom: '20px' }}>
                    后端处理时间过长（已超过 2 分钟）。这可能是后端服务暂时过载。
                  </p>
                  <button
                    className='button-primary'
                    onClick={() => handleGenerate(Array.from(linkedDocs), 'fast')}
                    disabled={sessionId === 'new'}
                    style={{ padding: '10px 24px' }}
                  >
                    🔄 重新生成
                  </button>
                </div>
              ) : pages.length > 0 ? (
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
                  <p>请击右上角「✨ AI 一键生成课件」开始</p>
                </div>
              )}
            </div>
          </Tabs.Content>
          
          <Tabs.Content className={styles.tabsContent} value="word">
            <div className={clsx(styles.wordDoc, 'glass-panel')}>
              {isGenerating ? (
                <div className={styles.emptyStateContainer} style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-primary)' }}>
                  <Loader2 size={48} className={styles.rotating} style={{ marginBottom: '16px', color: 'var(--accent-primary)' }} />
                  <h3 style={{ marginBottom: '12px' }}>AI 正在提炼讲义长文</h3>
                  <p style={{ maxWidth: '420px', textAlign: 'center', lineHeight: '1.6', color: 'var(--text-secondary)' }}>
                    大模型正在为您扩写与课件配套的完整教学讲义文稿。<br/>
                    该并行流处理大约需要 <strong>80-90 秒</strong>。<br/>
                    请稍作等待，全套资料链即可完成闭环。
                  </p>
                </div>
              ) : wordDoc ? (
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
