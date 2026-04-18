import { useEffect, useRef } from 'react';
import { X, Library, Image as ImageIcon } from 'lucide-react';
import { clsx } from 'clsx';
import { KnowledgeBasePanel } from '../pages/KnowledgeBase';
import ImageUploadPanel from './ImageUploadPanel';
import styles from './AssetDrawer.module.css';

export type AssetTab = 'knowledge' | 'images';

interface AssetDrawerProps {
  open: boolean;
  tab: AssetTab;
  onClose: () => void;
  onTabChange: (tab: AssetTab) => void;
}

const TABS: { key: AssetTab; label: string; icon: typeof Library }[] = [
  { key: 'knowledge', label: '知识库文档', icon: Library },
  { key: 'images', label: '图片素材', icon: ImageIcon },
];

export default function AssetDrawer({ open, tab, onClose, onTabChange }: AssetDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <>
      <div className={clsx(styles.backdrop, open && styles.backdropVisible)} onClick={onClose} aria-hidden="true" />

      <div
        ref={drawerRef}
        className={clsx(styles.drawer, open && styles.drawerOpen)}
        role="dialog"
        aria-modal="true"
        aria-label="素材管理"
      >
        <div className={styles.header}>
          <nav className={styles.tabBar} role="tablist">
            {TABS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                role="tab"
                aria-selected={tab === key}
                className={clsx(styles.tab, tab === key && styles.tabActive)}
                onClick={() => onTabChange(key)}
              >
                <Icon size={15} />
                <span>{label}</span>
              </button>
            ))}
          </nav>

          <button className={styles.closeBtn} onClick={onClose} aria-label="关闭素材管理">
            <X size={18} />
          </button>
        </div>

        <div className={styles.content} role="tabpanel">
          {tab === 'knowledge' && <KnowledgeBasePanel compact />}
          {tab === 'images' && <ImageUploadPanel />}
        </div>
      </div>
    </>
  );
}
