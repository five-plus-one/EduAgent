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
      return { title: 'Assets', subtitle: 'Knowledge and image materials' };
    }
    return { title: 'EduAgent', subtitle: 'Chat, references, and courseware' };
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
          title="Open sessions"
          aria-label="Open sessions"
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
          title="Back to workspace"
          aria-label="Back to workspace"
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
              <span>Teaching workspace</span>
            </div>
          </div>
          <button
            className={styles.mobileTopbarBtn}
            onClick={() => setMobileSidebarOpen(false)}
            title="Close sessions"
            aria-label="Close sessions"
          >
            <X size={18} />
          </button>
        </div>
        <Sidebar collapsed={sidebarCollapsed} />
      </div>

      <button
        className={styles.collapseBtn}
        onClick={() => setSidebarCollapsed(v => !v)}
        title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
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
            <span>Workspace</span>
          </NavLink>
          <button className={styles.mobileNavItem} onClick={() => setMobileSidebarOpen(true)}>
            <Menu size={18} />
            <span>Sessions</span>
          </button>
          <NavLink
            to="/assets"
            className={({ isActive }) => clsx(styles.mobileNavItem, isActive && styles.mobileNavItemActive)}
          >
            <FolderOpen size={18} />
            <span>Assets</span>
          </NavLink>
        </nav>
      )}
    </div>
  );
}
