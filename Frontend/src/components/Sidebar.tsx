import { useEffect, useRef, useState, useCallback } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  MessageSquarePlus,
  History,
  LogOut,
  UserCircle,
  Loader2,
  LayoutGrid,
} from 'lucide-react';
import { clsx } from 'clsx';
import styles from './Sidebar.module.css';
import { useAppStore } from '../store/useAppStore';
import { logout, listSessions, createSession } from '../utils/api';
import type { AssetTab } from './AssetDrawer';

interface SessionItem {
  session_id: string;
  course_name?: string | null;
  updated_at: string;
}

interface SidebarProps {
  onOpenAsset: (tab: AssetTab) => void;
}

const PAGE_SIZE = 20;

export default function Sidebar({ onOpenAsset }: SidebarProps) {
  const navigate = useNavigate();
  const user = useAppStore((state) => state.user);
  const clearUser = useAppStore((state) => state.clearUser);

  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  // New session state
  const [showNewInput, setShowNewInput] = useState(false);
  const [newSessionName, setNewSessionName] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  // Ref to session list container for infinite scroll
  const listContainerRef = useRef<HTMLUListElement>(null);

  // ── Initial load ──────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const fetchFirst = async () => {
      try {
        const data = await listSessions(1, PAGE_SIZE);
        if (!cancelled) {
          const items: SessionItem[] = data?.items ?? [];
          const total: number = data?.total ?? items.length;
          setSessions(items);
          setHasMore(items.length < total);
          setPage(1);
        }
      } catch {
        // Silently fail — token may not be ready
      } finally {
        if (!cancelled) setLoadingSessions(false);
      }
    };
    fetchFirst();
    return () => { cancelled = true; };
  }, []);

  // ── Load next page ────────────────────────────────────────────────────────
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const nextPage = page + 1;
      const data = await listSessions(nextPage, PAGE_SIZE);
      const items: SessionItem[] = data?.items ?? [];
      const total: number = data?.total ?? 0;
      setSessions((prev) => {
        // Deduplicate by session_id
        const existing = new Set(prev.map((s) => s.session_id));
        const fresh = items.filter((s) => !existing.has(s.session_id));
        return [...prev, ...fresh];
      });
      setPage(nextPage);
      setHasMore(sessions.length + items.length < total);
    } catch {
      // Non-critical — user can scroll again to retry
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, page, sessions.length]);

  // ── Infinite scroll via IntersectionObserver ──────────────────────────────
  const sentinelRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore && !loadingSessions) {
          loadMore();
        }
      },
      {
        root: listContainerRef.current,
        threshold: 0.1,
      }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, loadingSessions, loadMore]);

  // ── Create session ────────────────────────────────────────────────────────
  const handleCreateSession = async () => {
    const name = newSessionName.trim() || '未命名会话';
    setIsCreating(true);
    try {
      const result = await createSession(name);
      const newId = result?.session_id ?? result;
      setSessions((prev) => [{
        session_id: newId,
        course_name: name,
        updated_at: new Date().toISOString(),
      }, ...prev]);
      setShowNewInput(false);
      setNewSessionName('');
      navigate(`/chat/${newId}`);
    } catch {
      alert('创建会话失败，请检查网络');
    } finally {
      setIsCreating(false);
    }
  };

  // ── Logout ────────────────────────────────────────────────────────────────
  const handleLogout = async () => {
    try { await logout(); } catch { /* Server may already have invalidated token */ }
    clearUser();
    navigate('/login', { replace: true });
  };

  return (
    <aside className={clsx(styles.sidebar, 'glass-panel')}>
      {/* Logo + New Session ------------------------------------------------ */}
      <div className={styles.header}>
        <div className={styles.logo}>
          <div className={styles.logoIcon} />
          <span className={styles.logoText}>EduAgent</span>
        </div>

        <button
          onClick={() => { setShowNewInput(!showNewInput); if (!showNewInput) setNewSessionName(''); }}
          className={clsx('button-primary', styles.newSessionBtn)}
        >
          <MessageSquarePlus size={18} />
          <span>新课件设计</span>
        </button>

        {showNewInput && (
          <div className={styles.newInputContainer}>
            <input
              autoFocus
              className={styles.newInput}
              placeholder="输入课程名称..."
              value={newSessionName}
              onChange={(e) => setNewSessionName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateSession();
                if (e.key === 'Escape') setShowNewInput(false);
              }}
              disabled={isCreating}
            />
            <button
              className={styles.newSubmitBtn}
              onClick={handleCreateSession}
              disabled={isCreating}
            >
              {isCreating ? '创建中' : '确定'}
            </button>
          </div>
        )}
      </div>

      {/* Sessions list ----------------------------------------------------- */}
      <nav className={styles.nav}>
        <h3 className={styles.navTitle}>近期会话</h3>

        <ul className={styles.sessionList} ref={listContainerRef}>
          {loadingSessions ? (
            <li className={styles.loadingItem}>
              <Loader2 size={14} className={styles.spinner} />
              <span>加载中...</span>
            </li>
          ) : sessions.length === 0 ? (
            <li className={styles.emptyItem}>暂无会话历史记录哦～</li>
          ) : (
            <>
              {sessions.map((s) => (
                <li key={s.session_id}>
                  <NavLink
                    to={`/chat/${s.session_id}`}
                    className={({ isActive }) => clsx(styles.sessionItem, isActive && styles.active)}
                  >
                    <History size={16} />
                    <span className={styles.truncate}>{s.course_name ?? '未命名会话'}</span>
                  </NavLink>
                </li>
              ))}

              {/* Infinite scroll sentinel */}
              <li ref={sentinelRef} className={styles.sentinel}>
                {loadingMore && (
                  <span className={styles.loadMoreHint}>
                    <Loader2 size={12} className={styles.spinner} /> 加载更多...
                  </span>
                )}
                {!hasMore && sessions.length > PAGE_SIZE && (
                  <span className={styles.allLoadedHint}>已加载全部会话</span>
                )}
              </li>
            </>
          )}
        </ul>
      </nav>

      {/* Footer — user info + asset button + logout ------------------------- */}
      <div className={styles.footer}>
        <div className={clsx('button-base', styles.profileBtn)}>
          <UserCircle size={24} />
          <div className={styles.profileInfo}>
            <span className={styles.userName}>{user?.name ?? '未命名教师'}</span>
            <span className={styles.userRole}>{user?.department ?? ''}</span>
          </div>

          {/* Asset management button */}
          <button
            id="sidebar-asset-btn"
            className={styles.assetBtn}
            onClick={() => onOpenAsset('knowledge')}
            title="素材管理（知识库 & 图片）"
            aria-label="打开素材管理"
          >
            <LayoutGrid size={16} />
          </button>

          {/* Logout button */}
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
