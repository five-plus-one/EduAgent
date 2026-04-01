import { clsx } from 'clsx';
import { Loader2, Sparkles } from 'lucide-react';
import styles from './PPTSkeleton.module.css';

interface Props {
  pageNumber: number;
  streamThinking?: string;
}

export default function PPTSkeleton({ pageNumber, streamThinking }: Props) {
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
          {streamThinking && (
            <div className={styles.thinkingBox} style={{
              marginTop: '16px',
              padding: '12px',
              background: 'rgba(0,0,0,0.6)',
              borderRadius: '8px',
              border: '1px solid rgba(255,255,255,0.1)',
              maxWidth: '80%',
              maxHeight: '120px',
              overflowY: 'hidden',
              textAlign: 'left',
              backdropFilter: 'blur(4px)'
            }}>
              <p style={{ fontSize: '11px', color: '#10b981', margin: '0 0 4px 0', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <Loader2 size={12} className={styles.rotating}/> [DeepThink] PPO Reasoning
              </p>
              <pre style={{ margin: 0, fontSize: '12px', color: '#d1d5db', whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontFamily: 'monospace' }}>
                {streamThinking.length > 200 ? '...' + streamThinking.slice(-200) : streamThinking}
              </pre>
            </div>
          )}
        </div>
      </div>
      
      <div className={styles.shimmerEffect} />
    </div>
  );
}
