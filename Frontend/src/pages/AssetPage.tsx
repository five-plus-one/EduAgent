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

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div className={styles.headerLeft}>
          <span className={styles.pageEyebrow}>Asset Center</span>
          <h1 className={styles.pageTitle}>素材管理</h1>
          <p className={styles.pageDesc}>
            将知识库文档与图片素材收拢到同一套资产中心里，减少跳转，提升备课与生成效率。
          </p>
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
        {activeTab === 'images' && <ImageUploadPanel />}
      </main>
    </div>
  );
}
