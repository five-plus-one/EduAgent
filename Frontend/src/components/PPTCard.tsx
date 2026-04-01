import { useState } from 'react';
import { Send, Loader2, Image as ImageIcon } from 'lucide-react';
import { clsx } from 'clsx';
import styles from './PPTCard.module.css';
import type { PPTPage } from '../hooks/useCourseware';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

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
      if (!el.url) {
        return (
          <div key={el.element_id} className={clsx(styles.imagePlaceholder, positionClass)}>
            <div className={styles.placeholderIcon}><ImageIcon size={32} /></div>
            <span className={styles.placeholderText}>视觉影像挂载中...</span>
          </div>
        );
      }
      return (
        <div key={el.element_id} className={clsx(styles.imageWrapper, positionClass)}>
          <img src={el.url} alt={el.alt || 'PPT Image'} className={styles.pptImage} />
        </div>
      );
    }

    if (el.type === 'interactive_game' || el.type === 'animation' || el.type === 'html5') {
      return (
        <div key={el.element_id} className={clsx(styles.interactiveWrapper, positionClass)} style={{ width: '100%', minHeight: '300px', border: '1px solid var(--border-color, #e2e8f0)', borderRadius: '8px', overflow: 'hidden', background: '#fff' }}>
          {el.url ? (
            <iframe src={el.url} title={el.alt || "Interactive Content"} width="100%" height="100%" style={{ minHeight: '300px', border: 'none' }} />
          ) : (
            <iframe srcDoc={el.content?.join('\n') || `<h1>Interactive Block Pending</h1>`} title={el.alt || "Interactive Content"} width="100%" height="100%" style={{ minHeight: '300px', border: 'none' }} />
          )}
        </div>
      );
    }

    const contentArray = Array.isArray(el.content) ? el.content : (typeof el.content === 'string' ? [el.content] : []);

    if (el.type === 'title') {
      return <h2 key={el.element_id} className={clsx(styles.elementTitle, positionClass)}>{contentArray[0]}</h2>;
    }

    if (el.type === 'subtitle') {
      return <h4 key={el.element_id} className={clsx(styles.elementSubtitle, positionClass)}>{contentArray[0]}</h4>;
    }

    if (el.type === 'list' || el.type === 'list_item') {
      return (
        <ul key={el.element_id} className={clsx(styles.contentList, positionClass)}>
          {contentArray.map((b: string, i: number) => <li key={i}><ReactMarkdown remarkPlugins={[remarkGfm]}>{b}</ReactMarkdown></li>)}
        </ul>
      );
    }

    if (el.type === 'text_block') {
      return (
        <div key={el.element_id} className={clsx(styles.textBlock, positionClass)}>
          {contentArray.length > 1 ? (
            <ul className={styles.contentList}>
              {contentArray.map((b: string, i: number) => <li key={i}><ReactMarkdown remarkPlugins={[remarkGfm]}>{b}</ReactMarkdown></li>)}
            </ul>
          ) : (
            contentArray.map((text: string, i: number) => <div key={i} style={{ whiteSpace: 'pre-wrap' }}><ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown></div>)
          )}
        </div>
      );
    }
    
    // Timeline Item Fallback
    if (el.type === 'timeline_item') {
      return (
        <div key={el.element_id} className={clsx(styles.textBlock, positionClass)} style={{ marginBottom: '8px' }}>
          <strong>{el.time}</strong>
          <div style={{ margin: '4px 0 0 0' }}><ReactMarkdown remarkPlugins={[remarkGfm]}>{contentArray[0] || el.content}</ReactMarkdown></div>
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
      {page.layout_type !== 'cover' && (
        <div className={styles.cardHeader}>
          <span className={styles.pageNumber}>{String(page.page_index).padStart(2, '0')}</span>
          <h4>{page.title}</h4>
        </div>
      )}

      {/* ---------------- CANVAS DESIGN DECORATIONS ---------------- */}
      <div className={styles.giantWatermark}>
        {String(page.page_index).padStart(2, '0')}
      </div>
      
      {page.layout_type === 'two_column' && (
        <div className={styles.decorativeSvg}>
          <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
            <path fill="currentColor" d="M42.7,-73.4C55.9,-67.6,67.6,-57.8,77,-45.5C86.4,-33.1,93.5,-18.3,95.1,-2.9C96.7,12.5,92.8,28.4,84.1,41.9C75.4,55.3,61.9,66.1,47,73.1C32.1,80.1,16.1,83.1,-0.1,83.3C-16.2,83.5,-32.5,80.7,-46.8,73.2C-61.1,65.7,-73.5,53.4,-81.4,38.9C-89.2,24.4,-92.5,7.7,-89.2,-7.6C-85.9,-22.8,-76,-36.5,-63.9,-46C-51.8,-55.5,-37.6,-60.7,-24.5,-66.1C-11.4,-71.4,0.6,-76.8,14.4,-78.3C28.2,-79.8,43.9,-77.3,42.7,-73.4Z" transform="translate(100 100)" />
          </svg>
        </div>
      )}
      {/* ----------------------------------------------------------- */}
      
      {/* Universal Grid/Flex Stage powered by layout_type */}
      <div className={clsx(styles.stage, styles[`layout_${page.layout_type}`])}>
        {page.layout_type === 'cover' && (
           <h1 className={styles.coverTitle}>{page.title}</h1>
        )}
        
        {page.elements?.map(renderElement)}
        
        {page.speaker && page.layout_type === 'cover' && (
           <div className={styles.coverSpeaker}>
             <div className={styles.speakerLine} />
             <span>主讲人: {page.speaker}</span>
           </div>
        )}
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
