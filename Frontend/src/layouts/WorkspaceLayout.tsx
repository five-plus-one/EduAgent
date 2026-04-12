import { useState, useCallback } from 'react';
import { Outlet } from 'react-router-dom';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import Sidebar from '../components/Sidebar';
import styles from './WorkspaceLayout.module.css';

export default function WorkspaceLayout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const toggle = useCallback(() => setSidebarCollapsed(v => !v), []);

  return (
    <div className={styles.layout}>
      {/* ── 侧边栏 ──────────────────────────────────────── */}
      <div className={`${styles.sidebarWrap} ${sidebarCollapsed ? styles.sidebarCollapsed : ''}`}>
        <Sidebar />
      </div>

      {/* ── 收起/展开按钮 ────────────────────────────────── */}
      <button
        className={`${styles.collapseBtn} ${sidebarCollapsed ? styles.collapseBtnCollapsed : ''}`}
        onClick={toggle}
        title={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
        aria-label={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
      >
        {sidebarCollapsed
          ? <PanelLeftOpen size={16} />
          : <PanelLeftClose size={16} />
        }
      </button>

      {/* ── 主内容区 ─────────────────────────────────────── */}
      <main className={styles.mainContent}>
        <Outlet />
      </main>
    </div>
  );
}
