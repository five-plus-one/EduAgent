import { useState } from 'react';
import { Send, Loader2 } from 'lucide-react';
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

  const renderElement = (el: any) => {
    // Map JSON position (left, right_top) to CSS Module class (pos_left, pos_right_top)
    const positionClass = styles[`pos_${el.position}`] || '';

    if (el.type === 'image') {
      return (
        <div key={el.element_id} className={clsx(styles.imageWrapper, positionClass)}>
          <img src={el.url} alt={el.alt || 'PPT Element'} className={styles.pptImage} />
        </div>
      );
    }

    if (el.type === 'text_block') {
      return (
        <div key={el.element_id} className={clsx(styles.textBlock, positionClass)}>
          {el.content && el.content.length > 1 ? (
            <ul className={styles.contentList}>
              {el.content.map((b: string, i: number) => <li key={i}>{b}</li>)}
            </ul>
          ) : (
             el.content?.map((text: string, i: number) => <p key={i}>{text}</p>)
          )}
        </div>
      );
    }
    return null;
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
      
      {/* Universal Grid/Flex Stage powered by layout_type */}
      <div className={clsx(styles.stage, styles[`layout_${page.layout_type}`])}>
        {page.speaker && page.layout_type === 'cover' && (
           <p className={clsx(styles.textBlock, styles.pos_bottom)} style={{textAlign: 'center', opacity: 0.6}}>
             主讲人: {page.speaker}
           </p>
        )}
        {page.elements?.map(renderElement)}
      </div>

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
