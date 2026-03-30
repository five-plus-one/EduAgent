import { useState } from 'react';
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
  const [thinkExpanded, setThinkExpanded] = useState(true);
  const [toolExpanded, setToolExpanded] = useState(true);

  const hasThinking = !!thinking;
  const hasToolLog = !!toolLog;
  
  // High-agency visibility: The bubble should be visible if any content/thinking/log exists
  const hasAnyData = !!content || !!thinking || !!toolLog || isThinking || isTyping;

  if (!hasAnyData) {
    return null; // Don't render ghost bubbles
  }

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
                <button
                  type="button"
                  className={styles.thinkHeader}
                  onClick={() => setToolExpanded(v => !v)}
                >
                  <Wrench size={14} className={styles.thinkIcon} />
                  <span className={styles.thinkLabel}>工具执行日志</span>
                  {toolExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
                {toolExpanded && (
                  <div className={styles.thinkBody} style={{ color: '#92400e' }}>
                    <Markdown>{toolLog || ''}</Markdown>
                  </div>
                )}
              </div>
            )}

            {/* 2. Thinking Process */}
            {(hasThinking || isThinking) && (
              <div className={styles.thinkBlock}>
                <button
                  type="button"
                  className={styles.thinkHeader}
                  onClick={() => setThinkExpanded(v => !v)}
                >
                  <Brain size={14} className={clsx(styles.thinkIcon, isThinking && styles.thinkIconPulse)} />
                  <span className={styles.thinkLabel}>
                    {isThinking ? '正在深度思考...' : '深度思考过程'}
                  </span>
                  {thinkExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>
                {thinkExpanded && (
                  <div className={styles.thinkBody} style={{ color: '#64748b', fontStyle: 'italic' }}>
                    {thinking ? <Markdown>{thinking}</Markdown> : <span className={styles.thinkPlaceholder}>思考脉络生成中...</span>}
                    {isThinking && <span className={styles.thinkCursor} />}
                  </div>
                )}
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
                // Fallback for live streaming where content hasn't started yet
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
