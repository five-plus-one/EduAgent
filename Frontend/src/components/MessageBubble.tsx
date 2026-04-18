import { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import { Brain, ChevronDown, ChevronUp, Sparkles, UserCircle, Wrench } from 'lucide-react';
import { clsx } from 'clsx';
import styles from './message-bubble.module.css';

export interface MessageProps {
  id: string;
  role: 'teacher' | 'ai';
  content: string;
  toolLog?: string;
  thinking?: string;
  isThinking?: boolean;
  isTyping?: boolean;
}

export default function MessageBubble({ id, role, content, toolLog, thinking, isThinking, isTyping }: MessageProps) {
  const isAI = role === 'ai';
  const [thinkExpanded, setThinkExpanded] = useState(() => !!isThinking);
  const [toolExpanded, setToolExpanded] = useState(false);

  const thinkBodyRef = useRef<HTMLDivElement>(null);
  const thinkScrollRef = useRef<HTMLDivElement>(null);
  const [thinkBodyHeight, setThinkBodyHeight] = useState<number>(0);

  const hasThinking = !!thinking;
  const hasToolLog = !!toolLog;
  const hasAnyData = !!content || !!thinking || !!toolLog || isThinking || isTyping;

  useEffect(() => {
    if (isThinking) setThinkExpanded(true);
  }, [isThinking]);

  const prevIsThinkingRef = useRef(isThinking);
  useEffect(() => {
    const wasThinking = prevIsThinkingRef.current;
    prevIsThinkingRef.current = isThinking;

    if (wasThinking && !isThinking && hasThinking) {
      const timer = setTimeout(() => setThinkExpanded(false), 400);
      return () => clearTimeout(timer);
    }
  }, [isThinking, hasThinking]);

  useEffect(() => {
    if (!thinkBodyRef.current) return;
    const el = thinkBodyRef.current;
    const ro = new ResizeObserver(() => {
      setThinkBodyHeight(el.scrollHeight);
    });
    ro.observe(el);
    setThinkBodyHeight(el.scrollHeight);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (isThinking && thinkScrollRef.current) {
      const el = thinkScrollRef.current;
      el.scrollTop = el.scrollHeight;
    }
  }, [thinking, isThinking]);

  if (!hasAnyData) return null;

  const thinkingWordCount = thinking ? thinking.length : 0;
  const thinkingSummary = !isThinking && thinkingWordCount > 0 ? `（${thinkingWordCount} 字）` : '';

  return (
    <div
      className={clsx(styles.messageRow, isAI ? styles.rowAI : styles.rowTeacher)}
      data-msg-id={id}
      data-role={role}
    >
      {isAI && (
        <div className={styles.avatar}>
          <Sparkles size={18} />
        </div>
      )}

      <div className={clsx(styles.bubble, isAI ? styles.bubbleAI : styles.bubbleTeacher)} style={{ minWidth: '40px' }}>
        {isAI ? (
          <div className={styles.markdownWrapper}>
            <div className={styles.textContent} style={{ color: '#1e293b' }}>
              {content ? (
                <>
                  <Markdown>{content}</Markdown>
                  {isTyping && !isThinking && <span className={styles.cursor} />}
                </>
              ) : (
                isTyping && !isThinking && !hasThinking && !hasToolLog && (
                  <div className={styles.thinkingDots}>
                    <span /><span /><span />
                  </div>
                )
              )}
            </div>

            {(hasThinking || isThinking) && (
              <div className={clsx(styles.thinkBlock, isThinking && styles.thinkBlockActive)}>
                <button
                  type="button"
                  className={styles.thinkHeader}
                  onClick={() => setThinkExpanded(v => !v)}
                >
                  <Brain
                    size={14}
                    className={clsx(styles.thinkIcon, isThinking && styles.thinkIconPulse)}
                  />
                  <span className={styles.thinkLabel}>
                    {isThinking ? '正在深度思考...' : `深度思考过程${thinkingSummary}`}
                  </span>
                  <span className={clsx(styles.thinkChevron, !thinkExpanded && styles.thinkChevronCollapsed)}>
                    <ChevronUp size={14} />
                  </span>
                </button>

                {isThinking ? (
                  <div ref={thinkScrollRef} className={styles.thinkBodyWrapStreaming}>
                    <div
                      ref={thinkBodyRef}
                      className={styles.thinkBody}
                      style={{ color: '#64748b', fontStyle: 'italic' }}
                    >
                      {thinking
                        ? <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{thinking}</div>
                        : <span className={styles.thinkPlaceholder}>思考脉络生成中...</span>}
                      <span className={styles.thinkCursor} />
                    </div>
                  </div>
                ) : (
                  <div
                    className={styles.thinkBodyWrap}
                    style={{ maxHeight: thinkExpanded ? `${Math.max(thinkBodyHeight, 200)}px` : '0' }}
                  >
                    <div
                      ref={thinkBodyRef}
                      className={styles.thinkBody}
                      style={{ color: '#64748b', fontStyle: 'italic' }}
                    >
                      {thinking
                        ? <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{thinking}</div>
                        : <span className={styles.thinkPlaceholder}>思考脉络生成中...</span>}
                    </div>
                  </div>
                )}
              </div>
            )}

            {hasToolLog && (
              <div className={clsx(styles.thinkBlock, styles.toolBlock)}>
                <button type="button" className={styles.thinkHeader} onClick={() => setToolExpanded(v => !v)}>
                  <Wrench size={14} className={styles.thinkIcon} />
                  <span className={styles.thinkLabel}>工具执行日志</span>
                  <span className={styles.thinkChevron}>
                    {toolExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </span>
                </button>
                <div
                  className={styles.thinkBodyWrap}
                  style={{ maxHeight: toolExpanded ? '9999px' : '0' }}
                >
                  <div className={styles.thinkBody} style={{ color: '#92400e' }}>
                    <Markdown>{toolLog || ''}</Markdown>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className={styles.textContent} style={{ color: '#ffffff' }}>
            {content}
          </div>
        )}
      </div>

      {!isAI && (
        <div className={styles.avatar}>
          <UserCircle size={18} />
        </div>
      )}
    </div>
  );
}
