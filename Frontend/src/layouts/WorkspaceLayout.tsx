import { useCallback, useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { clsx } from 'clsx';
import { FolderOpen, Menu, PanelLeftClose, Sparkles, X } from 'lucide-react';
import Sidebar from '../components/Sidebar';
import BrandMark from '../components/BrandMark';
import styles from './WorkspaceLayout.module.css';

export default function WorkspaceLayout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { sessionId = 'new' } = useParams();
  const sidebarWidth = sidebarCollapsed ? 'var(--layout-sidebar-collapsed)' : 'var(--layout-sidebar)';
  const isWorkspaceRoute = location.pathname.startsWith('/chat/');
  const routeState = (location.state ?? {}) as { fromWorkspace?: boolean; sessionId?: string };
  const hideMobileBottomNav = isWorkspaceRoute || Boolean(location.pathname.startsWith('/assets') && routeState.fromWorkspace);

  const pageMeta = useMemo(() => {
    if (location.pathname.startsWith('/assets')) {
      return { title: '素材中心', subtitle: '统一管理文档、图片与引用素材' };
    }
    return { title: 'EduAgent', subtitle: '对话、资料与课件协同工作' };
  }, [location.pathname]);

  useEffect(() => {
    const handleOpenSidebar = () => setMobileSidebarOpen(true);
    window.addEventListener('EduAgent_Open_MobileSidebar', handleOpenSidebar);
    return () => window.removeEventListener('EduAgent_Open_MobileSidebar', handleOpenSidebar);
  }, []);

  const handleOpenWorkspace = useCallback(() => {
    const targetSessionId = sessionId && sessionId !== 'new' ? sessionId : 'new';
    navigate(`/chat/${targetSessionId}`);
  }, [navigate, sessionId]);

  const handleOpenAssetsWorkspace = useCallback(() => {
    const targetSessionId = sessionId && sessionId !== 'new' ? sessionId : 'new';
    navigate(`/chat/${targetSessionId}`);
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('EduAgent_Open_AssetsPanel'));
    }, 40);
  }, [navigate, sessionId]);

  return (
    <div
      className={styles.layout}
      style={{ ['--workspace-sidebar-width' as never]: sidebarWidth }}
    >
      <div
        className={clsx(styles.mobileBackdrop, mobileSidebarOpen && styles.mobileBackdropVisible)}
        onClick={() => setMobileSidebarOpen(false)}
      />

      <header className={styles.mobileTopbar}>
        <button
          className={styles.mobileTopbarBtn}
          onClick={() => setMobileSidebarOpen(true)}
          title="打开会话侧栏"
          aria-label="打开会话侧栏"
        >
          <Menu size={18} />
        </button>

        <div className={styles.mobileTopbarTitle}>
          <strong>{pageMeta.title}</strong>
          <span>{pageMeta.subtitle}</span>
        </div>

        <button
          className={styles.mobileTopbarBtn}
          onClick={handleOpenWorkspace}
          title="返回对话工作台"
          aria-label="返回对话工作台"
        >
          <Sparkles size={18} />
        </button>
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
            title="关闭会话侧栏"
            aria-label="关闭会话侧栏"
          >
            <X size={18} />
          </button>
        </div>
        <Sidebar collapsed={mobileSidebarOpen ? false : sidebarCollapsed} />
      </div>

      <button
        className={styles.collapseBtn}
        onClick={() => setSidebarCollapsed((value) => !value)}
        title={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
        aria-label={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
      >
        <PanelLeftClose size={16} className={clsx(sidebarCollapsed && styles.collapseBtnIconCollapsed)} />
      </button>

      <main className={styles.mainContent}>
        <Outlet />
      </main>

      {!hideMobileBottomNav && (
        <nav className={styles.mobileBottomNav}>
          <button className={styles.mobileNavItem} onClick={() => setMobileSidebarOpen(true)}>
            <Menu size={18} />
            <span>会话</span>
          </button>
          <button className={styles.mobileNavItem} onClick={handleOpenWorkspace}>
            <Sparkles size={18} />
            <span>对话</span>
          </button>
          <button className={styles.mobileNavItem} onClick={handleOpenAssetsWorkspace}>
            <FolderOpen size={18} />
            <span>素材</span>
          </button>
        </nav>
      )}
    </div>
  );
}
