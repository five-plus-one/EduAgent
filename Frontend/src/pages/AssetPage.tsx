import { useState } from 'react';
import { Library, Image as ImageIcon } from 'lucide-react';
import { clsx } from 'clsx';
import { KnowledgeBasePanel } from './KnowledgeBase';
import ImageUploadPanel from '../components/ImageUploadPanel';
import styles from './AssetPage.module.css';

type AssetTab = 'knowledge' | 'images';

const TABS: { key: AssetTab; label: string; icon: typeof Library; desc: string }[] = [
  { key: 'knowledge', label: '知识库管理', icon: Library,   desc: '上传并管理 RAG 知识文档' },
  { key: 'images',    label: '图片素材库', icon: ImageIcon, desc: '管理课件图片与素材' },
];

export default function AssetPage() {
  const [activeTab, setActiveTab] = useState<AssetTab>('knowledge');

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div className={styles.headerLeft}>
          <h1 className={styles.pageTitle}>素材管理</h1>
          <p className={styles.pageDesc}>统一管理您的知识库文档和图片素材，为 AI 课件生成提供精准原料</p>
        </div>

        <nav className={styles.tabBar} aria-label="素材类型切换">
          {TABS.map(({ key, label, icon: Icon, desc }) => (
            <button
              key={key}
              className={clsx(styles.tabBtn, activeTab === key && styles.tabActive)}
              onClick={() => setActiveTab(key)}
              aria-pressed={activeTab === key}
            >
              <div className={clsx(styles.tabIconWrap, activeTab === key && styles.tabIconActive)}>
                <Icon size={18} />
              </div>
              <div className={styles.tabText}>
                <span className={styles.tabLabel}>{label}</span>
                <span className={styles.tabDesc}>{desc}</span>
              </div>
            </button>
          ))}
        </nav>
      </header>

      <main className={styles.content}>
        {activeTab === 'knowledge' && <KnowledgeBasePanel />}
        {activeTab === 'images'    && <ImageUploadPanel />}
      </main>
    </div>
  );
}
