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
            {/* Tool Logs */}
            {showToolPanel && (
              <div className={clsx(styles.thinkBlock, styles.toolBlock)}>
                <button className={styles.thinkHeader} onClick={() => setToolExpanded(v => !v)}>
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

            {/* DeepSeek Thinking */}
            {showThinkPanel && (
              <div className={styles.thinkBlock}>
                <button className={styles.thinkHeader} onClick={() => setThinkExpanded(v => !v)}>
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

            {/* Main Content */}
            {content ? (
              <div className={styles.textContent}>
                <Markdown>{content}</Markdown>
                {isTyping && !isThinking && <span className={styles.cursor} />}
              </div>
            ) : (
              // Empty content but we are live-streaming
              isTyping && !isThinking && !hasThinking && !hasToolLog && (
                <div style={{ minHeight: '20px', display: 'flex', alignItems: 'center' }}>
                  <span className={styles.thinkingDots}>
                    <span /><span /><span />
                  </span>
                </div>
              )
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
