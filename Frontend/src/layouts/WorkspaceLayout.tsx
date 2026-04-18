import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useParams } from 'react-router-dom';
import { FolderOpen, Menu, PanelLeftClose, Sparkles, X } from 'lucide-react';
import { clsx } from 'clsx';
import Sidebar from '../components/Sidebar';
import BrandMark from '../components/BrandMark';
import styles from './WorkspaceLayout.module.css';

export default function WorkspaceLayout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const location = useLocation();
  const { sessionId = 'new' } = useParams();
  const sidebarWidth = sidebarCollapsed ? 'var(--layout-sidebar-collapsed)' : 'var(--layout-sidebar)';
  const isWorkspaceRoute = location.pathname.startsWith('/chat/');

  const pageMeta = useMemo(() => {
    if (location.pathname.startsWith('/assets')) {
      return { title: '素材中心', subtitle: '知识库与图片素材' };
    }
    return { title: 'EduAgent', subtitle: '对话、资料与课件协同工作' };
  }, [location.pathname]);

  useEffect(() => {
    const handleOpenSidebar = () => setMobileSidebarOpen(true);
    window.addEventListener('EduAgent_Open_MobileSidebar', handleOpenSidebar);
    return () => window.removeEventListener('EduAgent_Open_MobileSidebar', handleOpenSidebar);
  }, []);

  return (
    <div
      className={styles.layout}
      style={{ ['--workspace-sidebar-width' as any]: sidebarWidth }}
    >
      <div
        className={clsx(styles.mobileBackdrop, mobileSidebarOpen && styles.mobileBackdropVisible)}
        onClick={() => setMobileSidebarOpen(false)}
      />

      <header className={styles.mobileTopbar}>
        <button
          className={styles.mobileTopbarBtn}
          onClick={() => setMobileSidebarOpen(true)}
          title="打开会话栏"
          aria-label="打开会话栏"
        >
          <Menu size={18} />
        </button>

        <div className={styles.mobileTopbarTitle}>
          <strong>{pageMeta.title}</strong>
          <span>{pageMeta.subtitle}</span>
        </div>

        <NavLink
          to={`/chat/${sessionId}`}
          className={styles.mobileTopbarBtn}
          title="返回工作台"
          aria-label="返回工作台"
        >
          <Sparkles size={18} />
        </NavLink>
      </header>

      <div
        className={clsx(
          styles.sidebarWrap,
          mobileSidebarOpen && styles.sidebarMobileOpen,
        )}
      >
        <div className={styles.mobileSidebarHead}>
          <div className={styles.mobileSidebarBrand}>
            <div className={styles.mobileSidebarLogo}>
              <BrandMark className={styles.mobileSidebarLogoMark} />
            </div>
            <div>
              <strong>EduAgent</strong>
              <span>教学工作台</span>
            </div>
          </div>
          <button
            className={styles.mobileTopbarBtn}
            onClick={() => setMobileSidebarOpen(false)}
            title="关闭会话栏"
            aria-label="关闭会话栏"
          >
            <X size={18} />
          </button>
        </div>
        <Sidebar collapsed={mobileSidebarOpen ? false : sidebarCollapsed} />
      </div>

      <button
        className={styles.collapseBtn}
        onClick={() => setSidebarCollapsed(v => !v)}
        title={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
        aria-label={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
      >
        <PanelLeftClose size={16} className={clsx(sidebarCollapsed && styles.collapseBtnIconCollapsed)} />
      </button>

      <main className={styles.mainContent}>
        <Outlet />
      </main>

      {!isWorkspaceRoute && (
        <nav className={styles.mobileBottomNav}>
          <NavLink
            to={`/chat/${sessionId}`}
            className={({ isActive }) => clsx(styles.mobileNavItem, isActive && styles.mobileNavItemActive)}
          >
            <Sparkles size={18} />
            <span>工作台</span>
          </NavLink>
          <button className={styles.mobileNavItem} onClick={() => setMobileSidebarOpen(true)}>
            <Menu size={18} />
            <span>会话</span>
          </button>
          <NavLink
            to="/assets"
            className={({ isActive }) => clsx(styles.mobileNavItem, isActive && styles.mobileNavItemActive)}
          >
            <FolderOpen size={18} />
            <span>素材</span>
          </NavLink>
        </nav>
      )}
    </div>
  );
}
