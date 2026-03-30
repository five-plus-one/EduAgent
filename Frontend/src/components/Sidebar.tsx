import { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { 
  MessageSquarePlus, 
  History, 
  Library, 
  LogOut,
  UserCircle,
  Loader2
} from 'lucide-react';
import styles from './Sidebar.module.css';
import { clsx } from 'clsx';
import { useAppStore } from '../store/useAppStore';
import { logout, listSessions } from '../utils/api';

interface SessionItem {
  session_id: string;
  course_name?: string | null;
  updated_at: string;
}

export default function Sidebar() {
  const navigate = useNavigate();
  const user = useAppStore((state) => state.user);
  const clearUser = useAppStore((state) => state.clearUser);

  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const fetch = async () => {
      try {
        const data = await listSessions(1, 20);
        if (!cancelled) {
          setSessions(data?.items ?? []);
        }
      } catch {
        // Token may not be ready yet; silently fail
      } finally {
        if (!cancelled) setLoadingSessions(false);
      }
    };
    fetch();
    return () => { cancelled = true; };
  }, []);

  const handleLogout = async () => {
    try {
      await logout();
    } catch {
      // Server may already have invalidated token; proceed anyway
    }
    clearUser();
    navigate('/login', { replace: true });
  };

  return (
    <aside className={clsx(styles.sidebar, 'glass-panel')}>
      <div className={styles.header}>
        <div className={styles.logo}>
          <div className={styles.logoIcon} />
          <span className={styles.logoText}>EduAgent</span>
        </div>
        
        <NavLink to="/chat/new" className={clsx('button-primary', styles.newSessionBtn)}>
          <MessageSquarePlus size={18} />
          <span>新课件设计</span>
        </NavLink>
      </div>

      <nav className={styles.nav}>
        <h3 className={styles.navTitle}>近期会话</h3>
        <ul className={styles.sessionList}>
          {loadingSessions ? (
            <li className={styles.loadingItem}>
              <Loader2 size={14} className={styles.spinner} />
              <span>加载中...</span>
            </li>
          ) : sessions.length === 0 ? (
            <li className={styles.emptyItem}>暂无会话历史记录哦～</li>
          ) : (
            sessions.map((s) => (
              <li key={s.session_id}>
                <NavLink
                  to={`/chat/${s.session_id}`}
                  className={({ isActive }) => clsx(styles.sessionItem, isActive && styles.active)}
                >
                  <History size={16} />
                  <span className={styles.truncate}>
                    {s.course_name ?? '未命名会话'}
                  </span>
                </NavLink>
              </li>
            ))
          )}
        </ul>
        
        <h3 className={styles.navTitle} style={{marginTop: '24px'}}>管理空间</h3>
        <ul className={styles.sessionList}>
          <li>
             <NavLink to="/knowledge" className={({isActive}) => clsx(styles.sessionItem, isActive && styles.active)}>
               <Library size={16} />
               <span>知识库管理</span>
             </NavLink>
          </li>
        </ul>
      </nav>

      <div className={styles.footer}>
        <div className={clsx('button-base', styles.profileBtn)}>
          <UserCircle size={24} />
          <div className={styles.profileInfo}>
            <span className={styles.userName}>{user?.name ?? '未命名教师'}</span>
            <span className={styles.userRole}>{user?.department ?? ''}</span>
          </div>
          <button 
            className={styles.logoutBtn}
            onClick={handleLogout}
            title="退出登录"
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </aside>
  );
}
