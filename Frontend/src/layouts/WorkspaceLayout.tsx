import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import AssetDrawer, { type AssetTab } from '../components/AssetDrawer';
import styles from './WorkspaceLayout.module.css';

export default function WorkspaceLayout() {
  const [assetOpen, setAssetOpen] = useState(false);
  const [assetTab, setAssetTab] = useState<AssetTab>('knowledge');

  const handleOpenAsset = (tab: AssetTab) => {
    setAssetTab(tab);
    setAssetOpen(true);
  };

  return (
    <div className={styles.layout}>
      <Sidebar onOpenAsset={handleOpenAsset} />
      <main className={styles.mainContent}>
        <Outlet />
      </main>

      {/* Global asset management drawer — sits above everything */}
      <AssetDrawer
        open={assetOpen}
        tab={assetTab}
        onClose={() => setAssetOpen(false)}
        onTabChange={setAssetTab}
      />
    </div>
  );
}
