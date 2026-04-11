import { useEffect, useRef, useState, useCallback } from 'react';
import { NavLink, useNavigate, useParams } from 'react-router-dom';
import {
  MessageSquarePlus, History, LogOut, UserCircle, Loader2,
  LayoutGrid, Pencil, Trash2, MoreHorizontal, Check, X,
  BookOpen, Sparkles, User, Building2,
} from 'lucide-react';
import { clsx } from 'clsx';
import styles from './Sidebar.module.css';
import { useAppStore } from '../store/useAppStore';
import {
  logout, listSessions, createSession, renameSession, deleteSession, updateProfile,
} from '../utils/api';

interface SessionItem {
  session_id: string;
  course_name?: string | null;
  updated_at: string;
}

const PAGE_SIZE = 20;

export default function Sidebar() {
  const navigate = useNavigate();
  const { sessionId: currentSessionId } = useParams();
  const user = useAppStore((state) => state.user);
  const setUser = useAppStore((state) => state.setUser);
  const clearUser = useAppStore((state) => state.clearUser);

  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  // ── 新建话题弹窗 ─────────────────────────────────────
  const [showNewModal, setShowNewModal] = useState(false);
  const [newSessionName, setNewSessionName] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  // ── Session 上下文菜单 ─────────────────────────────────
  const [menuSessionId, setMenuSessionId] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });

  // ── Session 重命名 ────────────────────────────────────
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [isSavingRename, setIsSavingRename] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // ── Session 删除确认 ──────────────────────────────────
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [isDeletingSession, setIsDeletingSession] = useState(false);

  // ── 个人信息编辑 ──────────────────────────────────────
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [profileDept, setProfileDept] = useState('');
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  const listContainerRef = useRef<HTMLUListElement>(null);
  const sentinelRef = useRef<HTMLLIElement>(null);

  // ── 监听来自 Workspace 引导页的新建会话事件 ───────────────
  useEffect(() => {
    const handleGlobalNew = () => openNewModal();
    window.addEventListener('EduAgent_Open_NewSession', handleGlobalNew);
    return () => window.removeEventListener('EduAgent_Open_NewSession', handleGlobalNew);
  }, []);

  // ── 监听 Workspace 标题修改，同步更新侧边栏列表 ──────────
  useEffect(() => {
    const handleRenamed = (e: Event) => {
      const { sessionId: renamedId, courseName } = (e as CustomEvent).detail ?? {};
      if (!renamedId || !courseName) return;
      setSessions(prev =>
        prev.map(s =>
          s.session_id === renamedId ? { ...s, course_name: courseName } : s
        )
      );
    };
    window.addEventListener('EduAgent_Session_Renamed', handleRenamed);
    return () => window.removeEventListener('EduAgent_Session_Renamed', handleRenamed);
  }, []);

  // ── Initial load ─────────────────────────────────────
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
      } catch { /* Silently fail */ } finally {
        if (!cancelled) setLoadingSessions(false);
      }
    };
    fetchFirst();
    return () => { cancelled = true; };
  }, []);

  // ── Load next page ────────────────────────────────────
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const nextPage = page + 1;
      const data = await listSessions(nextPage, PAGE_SIZE);
      const items: SessionItem[] = data?.items ?? [];
      const total: number = data?.total ?? 0;
      setSessions((prev) => {
        const existing = new Set(prev.map((s) => s.session_id));
        const fresh = items.filter((s) => !existing.has(s.session_id));
        return [...prev, ...fresh];
      });
      setPage(nextPage);
      setHasMore(sessions.length + items.length < total);
    } catch { /* Non-critical */ } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, page, sessions.length]);

  // ── Infinite scroll ────────────────────────────────────
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore && !loadingSessions) {
          loadMore();
        }
      },
      { root: listContainerRef.current, threshold: 0.1 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, loadingSessions, loadMore]);

  // ── 关闭上下文菜单（点击外部） ─────────────────────────
  useEffect(() => {
    if (!menuSessionId) return;
    const close = () => setMenuSessionId(null);
    document.addEventListener('click', close, { once: true });
    return () => document.removeEventListener('click', close);
  }, [menuSessionId]);

  // ── 重命名 input autoFocus ────────────────────────────
  useEffect(() => {
    if (renamingId) renameInputRef.current?.focus();
  }, [renamingId]);

  // ── 新建话题 ──────────────────────────────────────────
  const openNewModal = () => {
    setNewSessionName('');
    setShowNewModal(true);
  };

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
      setShowNewModal(false);
      navigate(`/chat/${newId}`);
    } catch {
      alert('创建会话失败，请检查网络');
    } finally {
      setIsCreating(false);
    }
  };

  // ── 打开上下文菜单 ─────────────────────────────────────
  const openMenu = (e: React.MouseEvent, sessionId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuSessionId(sessionId);
    setMenuPos({ x: e.clientX, y: e.clientY });
  };

  // ── 开始重命名 ────────────────────────────────────────
  const startRename = (s: SessionItem) => {
    setMenuSessionId(null);
    setRenamingId(s.session_id);
    setRenameValue(s.course_name ?? '');
  };

  const confirmRename = async () => {
    if (!renamingId || !renameValue.trim()) {
      setRenamingId(null);
      return;
    }
    setIsSavingRename(true);
    try {
      await renameSession(renamingId, renameValue.trim());
      setSessions(prev =>
        prev.map(s => s.session_id === renamingId
          ? { ...s, course_name: renameValue.trim() }
          : s
        )
      );
    } catch {
      alert('重命名失败，请重试');
    } finally {
      setIsSavingRename(false);
      setRenamingId(null);
    }
  };

  // ── 删除 Session ──────────────────────────────────────
  const handleDeleteSession = async () => {
    if (!deleteConfirmId) return;
    setIsDeletingSession(true);
    try {
      await deleteSession(deleteConfirmId);
      setSessions(prev => prev.filter(s => s.session_id !== deleteConfirmId));
      // 如果删除的是当前活跃 session，跳转到首页
      if (currentSessionId === deleteConfirmId) {
        navigate('/chat/new');
      }
    } catch {
      alert('删除失败，请重试');
    } finally {
      setIsDeletingSession(false);
      setDeleteConfirmId(null);
    }
  };

  // ── 个人信息更新 ──────────────────────────────────────
  const openProfileModal = () => {
    setProfileName(user?.name ?? '');
    setProfileDept(user?.department ?? '');
    setShowProfileModal(true);
  };

  const handleSaveProfile = async () => {
    setIsSavingProfile(true);
    try {
      await updateProfile({ name: profileName.trim(), department: profileDept.trim() });
      // 更新本地状态
      if (user) {
        setUser({
          ...user,
          name: profileName.trim() || user.name,
          department: profileDept.trim(),
        });
      }
      setShowProfileModal(false);
    } catch {
      alert('保存个人信息失败，请重试');
    } finally {
      setIsSavingProfile(false);
    }
  };

  // ── Logout ──────────────────────────────────────────
  const handleLogout = async () => {
    try { await logout(); } catch { /* Already invalid */ }
    clearUser();
    navigate('/login', { replace: true });
  };

  return (
    <>
      <aside className={clsx(styles.sidebar, 'glass-panel')}>
        {/* Logo ---------------------------------------------------------------- */}
        <div className={styles.header}>
          <div className={styles.logo}>
            <div className={styles.logoIcon} />
            <span className={styles.logoText}>EduAgent</span>
          </div>

          <button
            onClick={openNewModal}
            className={clsx('button-primary', styles.newSessionBtn)}
          >
            <MessageSquarePlus size={18} />
            <span>新课件设计</span>
          </button>
        </div>

        {/* Sessions list ------------------------------------------------------- */}
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
                  <li key={s.session_id} className={styles.sessionLi}>
                    {renamingId === s.session_id ? (
                      /* 重命名输入框 */
                      <div className={styles.renameRow}>
                        <input
                          ref={renameInputRef}
                          className={styles.renameInput}
                          value={renameValue}
                          onChange={e => setRenameValue(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') confirmRename();
                            if (e.key === 'Escape') setRenamingId(null);
                          }}
                          disabled={isSavingRename}
                        />
                        <button
                          className={styles.renameConfirmBtn}
                          onClick={confirmRename}
                          disabled={isSavingRename}
                          title="确认"
                        >
                          {isSavingRename
                            ? <Loader2 size={13} className={styles.spinner} />
                            : <Check size={13} />}
                        </button>
                        <button
                          className={styles.renameCancelBtn}
                          onClick={() => setRenamingId(null)}
                          disabled={isSavingRename}
                          title="取消"
                        >
                          <X size={13} />
                        </button>
                      </div>
                    ) : (
                      /* 正常 session 行 */
                      <div className={styles.sessionRow}>
                        <NavLink
                          to={`/chat/${s.session_id}`}
                          className={({ isActive }) =>
                            clsx(styles.sessionItem, isActive && styles.active)
                          }
                        >
                          <History size={15} />
                          <span className={styles.truncate}>
                            {s.course_name ?? '未命名会话'}
                          </span>
                        </NavLink>
                        <button
                          className={styles.menuTrigger}
                          onClick={(e) => openMenu(e, s.session_id)}
                          title="更多操作"
                        >
                          <MoreHorizontal size={14} />
                        </button>
                      </div>
                    )}
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

        {/* Footer: asset + profile -------------------------------------------- */}
        <div className={styles.footer}>
          <NavLink
            to="/assets"
            id="sidebar-asset-btn"
            className={({ isActive }) =>
              clsx(styles.assetButtonRow, isActive && styles.assetButtonRowActive)
            }
            aria-label="打开素材管理"
          >
            <LayoutGrid size={16} />
            <span>素材管理</span>
            <span className={styles.assetBadge}>知识库 & 图片</span>
          </NavLink>

          {/* Profile row */}
          <div className={clsx('button-base', styles.profileBtn)} onClick={openProfileModal}>
            <UserCircle size={24} />
            <div className={styles.profileInfo}>
              <span className={styles.userName}>{user?.name ?? '未命名教师'}</span>
              <span className={styles.userRole}>{user?.department ?? ''}</span>
            </div>
            <button
              className={styles.logoutBtn}
              onClick={(e) => { e.stopPropagation(); handleLogout(); }}
              title="退出登录"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      {/* ══ 新建话题弹窗 ══════════════════════════════════════════════════════ */}
      {showNewModal && (
        <div className={styles.modalOverlay} onClick={e => e.target === e.currentTarget && !isCreating && setShowNewModal(false)}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <div className={styles.modalIcon}>
                <Sparkles size={22} />
              </div>
              <h2 className={styles.modalTitle}>新建课件会话</h2>
              <p className={styles.modalSubtitle}>为这次备课起一个名字，之后随时可以修改</p>
            </div>

            <div className={styles.modalBody}>
              <label className={styles.modalLabel}>
                <BookOpen size={14} /> 课程名称
              </label>
              <input
                autoFocus
                className={styles.modalInput}
                placeholder="例：牛顿第二定律、细胞分裂与遗传..."
                value={newSessionName}
                onChange={e => setNewSessionName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleCreateSession();
                  if (e.key === 'Escape') setShowNewModal(false);
                }}
                disabled={isCreating}
                maxLength={60}
              />
              <p className={styles.modalHint}>
                AI 将根据名称理解教学背景，生成更贴合的课件结构
              </p>
            </div>

            <div className={styles.modalFooter}>
              <button
                className={styles.modalCancelBtn}
                onClick={() => setShowNewModal(false)}
                disabled={isCreating}
              >
                取消
              </button>
              <button
                className={styles.modalSubmitBtn}
                onClick={handleCreateSession}
                disabled={isCreating}
              >
                {isCreating
                  ? <><Loader2 size={15} className={styles.spinner} /> 创建中...</>
                  : <><Sparkles size={15} /> 开始备课</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ 上下文菜单 ════════════════════════════════════════════════════════ */}
      {menuSessionId && (
        <div
          className={styles.contextMenu}
          style={{ top: menuPos.y, left: menuPos.x }}
          onClick={e => e.stopPropagation()}
        >
          <button
            className={styles.contextMenuItem}
            onClick={() => {
              const s = sessions.find(s => s.session_id === menuSessionId);
              if (s) startRename(s);
            }}
          >
            <Pencil size={13} /> 重命名
          </button>
          <div className={styles.contextDivider} />
          <button
            className={clsx(styles.contextMenuItem, styles.contextDanger)}
            onClick={() => {
              setDeleteConfirmId(menuSessionId);
              setMenuSessionId(null);
            }}
          >
            <Trash2 size={13} /> 删除会话
          </button>
        </div>
      )}

      {/* ══ 删除确认弹窗 ═════════════════════════════════════════════════════ */}
      {deleteConfirmId && (
        <div className={styles.modalOverlay} onClick={e => e.target === e.currentTarget && !isDeletingSession && setDeleteConfirmId(null)}>
          <div className={clsx(styles.modal, styles.modalSmall)}>
            <div className={styles.modalHeader}>
              <div className={clsx(styles.modalIcon, styles.modalIconDanger)}>
                <Trash2 size={20} />
              </div>
              <h2 className={styles.modalTitle}>删除会话</h2>
              <p className={styles.modalSubtitle}>
                删除后，该会话的所有对话记录和课件数据将<strong>永久消失</strong>，无法恢复。
              </p>
            </div>
            <div className={styles.modalFooter}>
              <button
                className={styles.modalCancelBtn}
                onClick={() => setDeleteConfirmId(null)}
                disabled={isDeletingSession}
              >
                取消
              </button>
              <button
                className={clsx(styles.modalSubmitBtn, styles.modalSubmitDanger)}
                onClick={handleDeleteSession}
                disabled={isDeletingSession}
              >
                {isDeletingSession
                  ? <><Loader2 size={15} className={styles.spinner} /> 删除中...</>
                  : <><Trash2 size={15} /> 确认删除</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ 个人信息弹窗 ═════════════════════════════════════════════════════ */}
      {showProfileModal && (
        <div className={styles.modalOverlay} onClick={e => e.target === e.currentTarget && !isSavingProfile && setShowProfileModal(false)}>
          <div className={clsx(styles.modal, styles.modalSmall)}>
            <div className={styles.modalHeader}>
              <div className={styles.modalIcon}>
                <UserCircle size={22} />
              </div>
              <h2 className={styles.modalTitle}>个人信息</h2>
              <p className={styles.modalSubtitle}>修改后将在侧边栏与全局 AI 对话中生效</p>
            </div>

            <div className={styles.modalBody}>
              <label className={styles.modalLabel}>
                <User size={13} /> 显示名称
              </label>
              <input
                autoFocus
                className={styles.modalInput}
                value={profileName}
                onChange={e => setProfileName(e.target.value)}
                placeholder="例：王老师"
                disabled={isSavingProfile}
                maxLength={30}
              />

              <label className={styles.modalLabel} style={{ marginTop: 12 }}>
                <Building2 size={13} /> 院系 / 单位
              </label>
              <input
                className={styles.modalInput}
                value={profileDept}
                onChange={e => setProfileDept(e.target.value)}
                placeholder="例：物理系"
                disabled={isSavingProfile}
                maxLength={30}
                onKeyDown={e => e.key === 'Enter' && handleSaveProfile()}
              />
            </div>

            <div className={styles.modalFooter}>
              <button
                className={styles.modalCancelBtn}
                onClick={() => setShowProfileModal(false)}
                disabled={isSavingProfile}
              >
                取消
              </button>
              <button
                className={styles.modalSubmitBtn}
                onClick={handleSaveProfile}
                disabled={isSavingProfile}
              >
                {isSavingProfile
                  ? <><Loader2 size={15} className={styles.spinner} /> 保存中...</>
                  : <><Check size={15} /> 保存</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
