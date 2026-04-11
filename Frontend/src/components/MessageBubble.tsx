import { useState, useEffect, useRef } from 'react';
import Markdown from 'react-markdown';
import { Sparkles, UserCircle, ChevronDown, ChevronUp, Brain, Wrench } from 'lucide-react';
import styles from './message-bubble.module.css';
import { clsx } from 'clsx';

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

  // 思考中默认展开；思考完成后自动折叠
  const [thinkExpanded, setThinkExpanded] = useState(true);
  const [toolExpanded, setToolExpanded] = useState(true);

  // thinkBody 的真实高度，用于 max-height 动画
  const thinkBodyRef = useRef<HTMLDivElement>(null);
  const [thinkBodyHeight, setThinkBodyHeight] = useState<number>(0);

  const hasThinking = !!thinking;
  const hasToolLog = !!toolLog;
  const hasAnyData = !!content || !!thinking || !!toolLog || isThinking || isTyping;

  // ── 关键逻辑：思考完成时自动折叠 ────────────────────────────
  const prevIsThinkingRef = useRef(isThinking);
  useEffect(() => {
    const wasThinking = prevIsThinkingRef.current;
    prevIsThinkingRef.current = isThinking;

    // isThinking: true → false  表示刚完成
    if (wasThinking && !isThinking && hasThinking) {
      // 延迟 400ms 让用户感知到"完成了"再折叠
      const timer = setTimeout(() => setThinkExpanded(false), 400);
      return () => clearTimeout(timer);
    }
  }, [isThinking, hasThinking]);

  // ── 测量 thinkBody 高度，支持 max-height 过渡 ─────────────────
  useEffect(() => {
    if (!thinkBodyRef.current) return;
    const el = thinkBodyRef.current;
    // ResizeObserver 跟踪内容撑高（流式输出时内容在增长）
    const ro = new ResizeObserver(() => {
      setThinkBodyHeight(el.scrollHeight);
    });
    ro.observe(el);
    setThinkBodyHeight(el.scrollHeight);
    return () => ro.disconnect();
  }, []);

  if (!hasAnyData) return null;

  // 折叠时在 header 末尾显示思考字数，让用户知道有内容
  const thinkingWordCount = thinking ? thinking.length : 0;
  const thinkingSummary = !isThinking && thinkingWordCount > 0
    ? `（${thinkingWordCount} 字）`
    : '';

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

            {/* 1. Tool Execution Logs */}
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

            {/* 2. Thinking Process ───────────────────────────── */}
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

                {/* max-height 过渡，不使用条件渲染避免内容跳变 */}
                <div
                  className={styles.thinkBodyWrap}
                  style={{
                    maxHeight: thinkExpanded
                      ? `${Math.max(thinkBodyHeight, 200)}px`
                      : '0',
                  }}
                >
                  <div
                    ref={thinkBodyRef}
                    className={styles.thinkBody}
                    style={{ color: '#64748b', fontStyle: 'italic' }}
                  >
                    {thinking
                      ? <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{thinking}</div>
                      : <span className={styles.thinkPlaceholder}>思考脉络生成中...</span>
                    }
                    {isThinking && <span className={styles.thinkCursor} />}
                  </div>
                </div>
              </div>
            )}

            {/* 3. Conversational Response */}
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
