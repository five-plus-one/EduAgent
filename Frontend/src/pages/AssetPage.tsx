import { useState } from 'react';
import { Library, Image as ImageIcon } from 'lucide-react';
import { clsx } from 'clsx';
import { KnowledgeBasePanel } from './KnowledgeBase';
import ImageUploadPanel from '../components/ImageUploadPanel';
import styles from './AssetPage.module.css';

type AssetTab = 'knowledge' | 'images';

const TABS: { key: AssetTab; label: string; icon: typeof Library; desc: string }[] = [
  { key: 'knowledge', label: '知识库文档', icon: Library, desc: '上传与管理教学文档、视频与 RAG 素材' },
  { key: 'images', label: '图片素材', icon: ImageIcon, desc: '统一管理课件图像、标签与描述信息' },
];

export default function AssetPage() {
  const [activeTab, setActiveTab] = useState<AssetTab>('knowledge');
  const activeTabMeta = TABS.find((item) => item.key === activeTab) ?? TABS[0];

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div className={styles.headerMeta}>
          <span className={styles.pageEyebrow}>Asset Center</span>
          <div className={styles.titleRow}>
            <h1 className={styles.pageTitle}>素材管理</h1>
            <span className={styles.activeHint}>{activeTabMeta.desc}</span>
          </div>
        </div>

        <nav className={styles.tabBar} aria-label="素材类型切换">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              className={clsx(styles.tabBtn, activeTab === key && styles.tabActive)}
              onClick={() => setActiveTab(key)}
              aria-pressed={activeTab === key}
            >
              <Icon size={15} />
              <span className={styles.tabLabel}>{label}</span>
            </button>
          ))}
        </nav>
      </header>

      <main className={styles.content}>
        {activeTab === 'knowledge' && <KnowledgeBasePanel compact />}
        {activeTab === 'images' && <ImageUploadPanel />}
      </main>
    </div>
  );
}
