import { NavLink, useNavigate } from 'react-router-dom';
import { 
  MessageSquarePlus, 
  History, 
  Library, 
  LogOut,
  UserCircle 
} from 'lucide-react';
import styles from './Sidebar.module.css';
import { clsx } from 'clsx';
import { useAppStore } from '../store/useAppStore';
import { logout } from '../utils/api';

export default function Sidebar() {
  const navigate = useNavigate();
  const user = useAppStore((state) => state.user);
  const clearUser = useAppStore((state) => state.clearUser);

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
          {/* Mock history sessions */}
          <li>
             <NavLink to="/chat/sess_8f9a2b" className={({isActive}) => clsx(styles.sessionItem, isActive && styles.active)}>
               <History size={16} />
               <span className={styles.truncate}>牛顿第二定律备课</span>
             </NavLink>
          </li>
          <li>
             <NavLink to="/chat/sess_xyz123" className={({isActive}) => clsx(styles.sessionItem, isActive && styles.active)}>
               <History size={16} />
               <span className={styles.truncate}>高中语文：文言文解析</span>
             </NavLink>
          </li>
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
