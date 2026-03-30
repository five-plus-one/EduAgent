
import { useState } from 'react';
import Markdown from 'react-markdown';
import { Sparkles, UserCircle, ChevronDown, ChevronUp, Brain, Wrench } from 'lucide-react';
import styles from './MessageBubble.module.css';
import { clsx } from 'clsx';

export interface MessageProps {
  id: string;
  role: 'teacher' | 'ai';
  content: string;
  toolLog?: string;     // Tool call/result log (persisted across session switches)
  thinking?: string;
  isThinking?: boolean;
  isTyping?: boolean;
}

export default function MessageBubble({ role, content, toolLog, thinking, isThinking, isTyping }: MessageProps) {
  const isAI = role === 'ai';
  const [thinkExpanded, setThinkExpanded] = useState(true);
  const [toolExpanded, setToolExpanded] = useState(true);

  const hasThinking = !!thinking;
  const hasToolLog = !!toolLog;
  const showThinkPanel = isAI && (hasThinking || isThinking);
  const showToolPanel = isAI && hasToolLog;

  return (
    <div className={clsx(styles.messageRow, isAI ? styles.rowAI : styles.rowTeacher)}>
      {isAI && (
        <div className={styles.avatar}>
          <Sparkles size={18} />
        </div>
      )}
      
      <div className={clsx(styles.bubble, isAI ? styles.bubbleAI : styles.bubbleTeacher)}>
        {isAI ? (
          <div className={styles.markdownWrapper}>

            {/* ===== Tool Call Log Panel (persisted in GlobalStreamManager singleton) ===== */}
            {showToolPanel && (
              <div className={clsx(styles.thinkBlock, styles.toolBlock)}>
                <button
                  className={styles.thinkHeader}
                  onClick={() => setToolExpanded(v => !v)}
                  aria-expanded={toolExpanded}
                >
                  <Wrench size={14} className={styles.thinkIcon} />
                  <span className={styles.thinkLabel}>工具调用记录</span>
                  {toolExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
                {toolExpanded && (
                  <div className={styles.thinkBody}>
                    <Markdown>{toolLog || ''}</Markdown>
                  </div>
                )}
              </div>
            )}

            {/* ===== DeepSeek-style Thinking Panel ===== */}
            {showThinkPanel && (
              <div className={styles.thinkBlock}>
                <button
                  className={styles.thinkHeader}
                  onClick={() => setThinkExpanded(v => !v)}
                  aria-expanded={thinkExpanded}
                >
                  <Brain size={14} className={clsx(styles.thinkIcon, isThinking && styles.thinkIconPulse)} />
                  <span className={styles.thinkLabel}>
                    {isThinking ? '深度思考中...' : '已完成思考'}
                  </span>
                  {thinkExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
                {thinkExpanded && (
                  <div className={styles.thinkBody}>
                    <Markdown>{thinking || ''}</Markdown>
                    {isThinking && <span className={styles.thinkCursor} />}
                  </div>
                )}
              </div>
            )}

            {/* ===== Main answer content ===== */}
            {content && <Markdown>{content}</Markdown>}

            {/* Blinking cursor while typing main content */}
            {isTyping && !isThinking && <span className={styles.cursor} />}

            {/* Three-dot loader: only when truly idle — no content, no thinking, no tool activity */}
            {isTyping && !isThinking && !content && !hasThinking && !hasToolLog && (
              <span className={styles.thinkingDots}>
                <span /><span /><span />
              </span>
            )}
          </div>
        ) : (
          <div className={styles.textContent}>{content}</div>
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
