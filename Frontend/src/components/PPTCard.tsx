import { useState } from 'react';
import { Send, Image as ImageIcon, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';
import styles from './PPTCard.module.css';
import type { PPTPage } from '../hooks/useCourseware';

interface Props {
  page: PPTPage;
  isUpdating: boolean;
  onIterate: (instruction: string) => void;
}

export default function PPTCard({ page, isUpdating, onIterate }: Props) {
  const [instruction, setInstruction] = useState('');
  const [showIterate, setShowIterate] = useState(false);

  const handleSubmit = () => {
    if (instruction.trim() && !isUpdating) {
      onIterate(instruction.trim());
      setInstruction('');
      setShowIterate(false);
    }
  };

  return (
    <div 
      className={clsx(styles.pptCard, 'glass-panel', isUpdating && styles.updating)}
      onMouseEnter={() => setShowIterate(true)}
      onMouseLeave={() => setShowIterate(false)}
    >
      <div className={styles.cardHeader}>
        <span className={styles.pageNumber}>{String(page.page_index).padStart(2, '0')}</span>
        <h4>{page.title}</h4>
      </div>
      
      {page.type === 'cover' ? (
        <div className={styles.coverBody}>
           <span className={styles.speaker}>主讲人: {page.speaker}</span>
        </div>
      ) : (
        <div className={styles.contentBody}>
          <ul className={styles.bulletList}>
            {page.bullets?.map((b, i) => <li key={i}>{b}</li>)}
          </ul>
          
          {page.image_url ? (
            <div className={styles.imageWrapper}>
              <img src={page.image_url} alt="PPT Illustration" className={styles.pptImage} />
            </div>
          ) : page.suggested_image_prompt && (
            <div className={styles.imagePrompt}>
              <ImageIcon size={14} /> 自动配图参考: {page.suggested_image_prompt}
            </div>
          )}
        </div>
      )}

      {/* Loading Skeleton Overlay for Targeted Modification */}
      {isUpdating && (
        <div className={styles.skeletonOverlay}>
          <div className={styles.scanLine} />
          <Loader2 className={styles.spinner} size={32} />
          <span className={styles.updatingText}>AI 正在针对此页执行局部重塑...</span>
        </div>
      )}

      {/* Floating Action Input */}
      {!isUpdating && showIterate && (
        <div className={clsx(styles.iterateBar, 'glass-panel')}>
          <input 
            type="text" 
            placeholder="例如：少一点文字，加一个公式推导动图..."
            className={styles.iterateInput}
            value={instruction}
            onChange={e => setInstruction(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            autoFocus
          />
          <button 
            className={clsx('button-primary', styles.iterateBtn)} 
            disabled={!instruction.trim()}
            onClick={handleSubmit}
          >
            <Send size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
