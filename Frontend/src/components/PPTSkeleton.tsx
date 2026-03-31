import { clsx } from 'clsx';
import { Loader2, Sparkles } from 'lucide-react';
import styles from './PPTSkeleton.module.css';

interface Props {
  pageNumber: number;
}

export default function PPTSkeleton({ pageNumber }: Props) {
  return (
    <div className={clsx(styles.skeleton, 'glass-panel')}>
      <div className={styles.header}>
        <div className={styles.pageNumber}>{String(pageNumber).padStart(2, '0')}</div>
        <div className={styles.titleLine} />
      </div>

      <div className={styles.stage}>
        <div className={styles.elementLarge} />
        <div className={styles.elementSmall} />
        <div className={styles.elementMedium} />
        
        <div className={styles.statusOverlay}>
          <div className={styles.spinnerWrapper}>
             <Loader2 size={32} className={styles.rotating} />
             <Sparkles size={16} className={styles.sparkle} />
          </div>
          <p>AI 正在深度重组并渲染第 {pageNumber} 页...</p>
        </div>
      </div>
      
      <div className={styles.shimmerEffect} />
    </div>
  );
}
