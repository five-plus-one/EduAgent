
import Markdown from 'react-markdown';
import { Sparkles, UserCircle } from 'lucide-react';
import styles from './MessageBubble.module.css';
import { clsx } from 'clsx';

export interface MessageProps {
  id: string;
  role: 'teacher' | 'ai';
  content: string;
  isTyping?: boolean;
}

export default function MessageBubble({ role, content, isTyping }: MessageProps) {
  const isAI = role === 'ai';

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
            <Markdown>{content}</Markdown>
            {isTyping && <span className={styles.cursor} />}
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
