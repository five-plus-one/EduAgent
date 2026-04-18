import { useEffect, useRef, useState, useCallback, type MouseEvent } from 'react';
import { NavLink, useNavigate, useParams } from 'react-router-dom';
import { createPortal } from 'react-dom';
import {
  MessageSquarePlus,
  History,
  LogOut,
  UserCircle,
  Loader2,
  LayoutGrid,
  Pencil,
  Trash2,
  MoreHorizontal,
  Check,
  X,
  BookOpen,
  Sparkles,
  User,
  Building2,
} from 'lucide-react';
import { clsx } from 'clsx';
import styles from './Sidebar.module.css';
import { useAppStore } from '../store/useAppStore';
import BrandMark from './BrandMark';
import {
  logout,
  listSessions,
  createSession,
  renameSession,
  deleteSession,
  updateProfile,
} from '../utils/api';

interface SessionItem {
  session_id: string;
  course_name?: string | null;
  updated_at: string;
}

const PAGE_SIZE = 20;

interface SidebarProps {
  collapsed?: boolean;
}

export default function Sidebar({ collapsed = false }: SidebarProps) {
  const MODAL_EXIT_MS = 220;
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

  const [showNewModal, setShowNewModal] = useState(false);
  const [closingNewModal, setClosingNewModal] = useState(false);
  const [newSessionName, setNewSessionName] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const [menuSessionId, setMenuSessionId] = useState<string | null>(null);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [isSavingRename, setIsSavingRename] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [closingDeleteModal, setClosingDeleteModal] = useState(false);
  const [isDeletingSession, setIsDeletingSession] = useState(false);

  const [showProfileModal, setShowProfileModal] = useState(false);
  const [closingProfileModal, setClosingProfileModal] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [profileDept, setProfileDept] = useState('');
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  const listContainerRef = useRef<HTMLUListElement>(null);
  const sentinelRef = useRef<HTMLLIElement>(null);
  const modalRoot = typeof document !== 'undefined' ? document.body : null;

  useEffect(() => {
    const handleGlobalNew = () => openNewModal();
    window.addEventListener('EduAgent_Open_NewSession', handleGlobalNew);
    return () => window.removeEventListener('EduAgent_Open_NewSession', handleGlobalNew);
  }, []);

  useEffect(() => {
    const handleRenamed = (e: Event) => {
      const { sessionId: renamedId, courseName } = (e as CustomEvent).detail ?? {};
      if (!renamedId || !courseName) return;
      setSessions((prev) => prev.map((s) => (
        s.session_id === renamedId ? { ...s, course_name: courseName } : s
      )));
    };
    window.addEventListener('EduAgent_Session_Renamed', handleRenamed);
    return () => window.removeEventListener('EduAgent_Session_Renamed', handleRenamed);
  }, []);

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
        // ignore sidebar bootstrap failure
      } finally {
        if (!cancelled) setLoadingSessions(false);
      }
    };
    fetchFirst();
    return () => { cancelled = true; };
  }, []);

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
        const merged = [...prev, ...fresh];
        setHasMore(merged.length < total);
        return merged;
      });
      setPage(nextPage);
    } catch {
      // ignore pagination failure
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loadingMore, page]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore && !loadingSessions) {
          loadMore();
        }
      },
      { root: listContainerRef.current, threshold: 0.1 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, loadingSessions, loadMore]);

  useEffect(() => {
    if (!menuSessionId) return;
    const close = () => setMenuSessionId(null);
    document.addEventListener('click', close, { once: true });
    return () => document.removeEventListener('click', close);
  }, [menuSessionId]);

  useEffect(() => {
    if (renamingId) renameInputRef.current?.focus();
  }, [renamingId]);

  const openNewModal = () => {
    setNewSessionName('');
    setClosingNewModal(false);
    setShowNewModal(true);
  };

  const closeNewModal = () => {
    if (isCreating || closingNewModal) return;
    setClosingNewModal(true);
    window.setTimeout(() => {
      setShowNewModal(false);
      setClosingNewModal(false);
    }, MODAL_EXIT_MS);
  };

  const handleCreateSession = async () => {
    const name = newSessionName.trim() || '未命名课件';
    setIsCreating(true);
    try {
      const result = await createSession(name);
      const newId = result?.session_id ?? result;
      setSessions((prev) => [{
        session_id: newId,
        course_name: name,
        updated_at: new Date().toISOString(),
      }, ...prev]);
      setClosingNewModal(true);
      window.setTimeout(() => {
        setShowNewModal(false);
        setClosingNewModal(false);
        navigate(`/chat/${newId}`);
      }, MODAL_EXIT_MS);
    } catch {
      alert('创建会话失败，请稍后重试。');
    } finally {
      setIsCreating(false);
    }
  };

  const toggleSessionActions = (e: MouseEvent<HTMLButtonElement>, sessionId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuSessionId((prev) => (prev === sessionId ? null : sessionId));
  };

  const startRename = (session: SessionItem) => {
    setMenuSessionId(null);
    setRenamingId(session.session_id);
    setRenameValue(session.course_name ?? '');
  };

  const confirmRename = async () => {
    if (!renamingId || !renameValue.trim()) {
      setRenamingId(null);
      return;
    }
    setIsSavingRename(true);
    try {
      const trimmed = renameValue.trim();
      await renameSession(renamingId, trimmed);
      setSessions((prev) => prev.map((s) => (
        s.session_id === renamingId ? { ...s, course_name: trimmed } : s
      )));
      window.dispatchEvent(new CustomEvent('EduAgent_Session_Renamed', {
        detail: { sessionId: renamingId, courseName: trimmed },
      }));
    } catch {
      alert('重命名失败，请稍后再试。');
    } finally {
      setIsSavingRename(false);
      setRenamingId(null);
    }
  };

  const handleDeleteSession = async () => {
    if (!deleteConfirmId) return;
    setIsDeletingSession(true);
    try {
      const deletingId = deleteConfirmId;
      await deleteSession(deleteConfirmId);
      setSessions((prev) => prev.filter((s) => s.session_id !== deleteConfirmId));
      setClosingDeleteModal(true);
      window.setTimeout(() => {
        if (currentSessionId === deletingId) {
          navigate('/chat/new');
        }
        setDeleteConfirmId(null);
        setClosingDeleteModal(false);
      }, MODAL_EXIT_MS);
    } catch {
      alert('删除会话失败，请稍后再试。');
    } finally {
      setIsDeletingSession(false);
    }
  };

  const closeDeleteModal = () => {
    if (isDeletingSession || closingDeleteModal) return;
    setClosingDeleteModal(true);
    window.setTimeout(() => {
      setDeleteConfirmId(null);
      setClosingDeleteModal(false);
    }, MODAL_EXIT_MS);
  };

  const openProfileModal = () => {
    setProfileName(user?.name ?? '');
    setProfileDept(user?.department ?? '');
    setClosingProfileModal(false);
    setShowProfileModal(true);
  };

  const closeProfileModal = () => {
    if (isSavingProfile || closingProfileModal) return;
    setClosingProfileModal(true);
    window.setTimeout(() => {
      setShowProfileModal(false);
      setClosingProfileModal(false);
    }, MODAL_EXIT_MS);
  };

  const handleOpenAssetsInWorkspace = () => {
    const targetSessionId =
      currentSessionId && currentSessionId !== 'new'
        ? currentSessionId
        : sessions[0]?.session_id ?? 'new';

    navigate(`/chat/${targetSessionId}`);

    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('EduAgent_Open_AssetsPanel'));
    }, 40);
  };

  const handleSaveProfile = async () => {
    setIsSavingProfile(true);
    try {
      await updateProfile({
        name: profileName.trim(),
        department: profileDept.trim(),
      });
      if (user) {
        setUser({
          ...user,
          name: profileName.trim() || user.name,
          department: profileDept.trim(),
        });
      }
      setClosingProfileModal(true);
      window.setTimeout(() => {
        setShowProfileModal(false);
        setClosingProfileModal(false);
      }, MODAL_EXIT_MS);
    } catch {
      alert('保存个人信息失败，请稍后再试。');
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
    } catch {
      // ignore invalid session
    }
    clearUser();
    navigate('/login', { replace: true });
  };

  return (
    <>
      <aside className={clsx(styles.sidebar, 'glass-panel', collapsed && styles.sidebarCollapsed)}>
        <div className={clsx(styles.header, collapsed && styles.headerCollapsed)}>
          <div className={clsx(styles.logoRow, collapsed && styles.logoRowCollapsed)} title="EduAgent 教学工作台">
            <div className={styles.logoIcon}>
              <BrandMark className={styles.logoMark} />
            </div>
            <div className={clsx(collapsed && styles.compactHidden)}>
              <div className={styles.logoText}>EduAgent</div>
              <div className={styles.logoSubtext}>教学工作台</div>
            </div>
          </div>

          <button
            onClick={openNewModal}
            className={clsx('button-primary', styles.newSessionBtn, collapsed && styles.newSessionBtnCollapsed)}
            title="新建课件"
            aria-label="新建课件"
          >
            <MessageSquarePlus size={18} />
            {!collapsed && <span>新建课件</span>}
          </button>
        </div>

        <nav className={clsx(styles.nav, collapsed && styles.navCollapsed)}>
          {!collapsed && (
            <div className={styles.navHeader}>
              <h3 className={styles.navTitle}>最近会话</h3>
              <span className={styles.navCount}>{sessions.length}</span>
            </div>
          )}

          <ul className={clsx(styles.sessionList, collapsed && styles.sessionListCollapsed)} ref={listContainerRef}>
            {loadingSessions ? (
              <li className={styles.feedbackRow}>
                <Loader2 size={14} className={styles.spinner} />
                {!collapsed && <span>正在加载会话...</span>}
              </li>
            ) : sessions.length === 0 ? (
              <li className={styles.emptyState}>
                <Sparkles size={16} />
                {!collapsed && <span>还没有会话，先创建一个课件吧。</span>}
              </li>
            ) : (
              <>
                {sessions.map((session) => (
                  <li key={session.session_id} className={styles.sessionLi}>
                    {renamingId === session.session_id ? (
                      <div className={styles.renameRow}>
                        <input
                          ref={renameInputRef}
                          className={styles.renameInput}
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
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
                          {isSavingRename ? <Loader2 size={13} className={styles.spinner} /> : <Check size={13} />}
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
                      <div className={clsx(styles.sessionCard, collapsed && styles.sessionRowCollapsed)}>
                        <NavLink
                          to={`/chat/${session.session_id}`}
                          className={({ isActive }) => clsx(
                            styles.sessionItem,
                            styles.sessionItemWithMenu,
                            collapsed && styles.sessionItemCollapsed,
                            isActive && styles.active,
                          )}
                          title={session.course_name ?? '未命名课件'}
                          aria-label={session.course_name ?? '未命名课件'}
                        >
                          <History size={15} />
                          <div className={clsx(styles.sessionMeta, collapsed && styles.compactHidden)}>
                            <span className={styles.truncate}>{session.course_name ?? '未命名课件'}</span>
                            <span className={styles.sessionTime}>{new Date(session.updated_at).toLocaleDateString('zh-CN')}</span>
                          </div>
                        </NavLink>
                        {!collapsed && (
                          <button
                            className={styles.menuTrigger}
                            onClick={(e) => toggleSessionActions(e, session.session_id)}
                            title="会话操作"
                            aria-expanded={menuSessionId === session.session_id}
                            aria-label="展开会话操作"
                          >
                            <MoreHorizontal size={12} />
                          </button>
                        )}
                        {!collapsed && menuSessionId === session.session_id && (
                          <div className={styles.contextMenu} onClick={(e) => e.stopPropagation()}>
                            <button
                              className={styles.contextMenuItem}
                              onClick={() => startRename(session)}
                            >
                              <Pencil size={13} /> 重命名
                            </button>
                            <div className={styles.contextDivider} />
                            <button
                              className={clsx(styles.contextMenuItem, styles.contextDanger)}
                              onClick={() => {
                                setDeleteConfirmId(session.session_id);
                                setMenuSessionId(null);
                              }}
                            >
                              <Trash2 size={13} /> 删除会话
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                ))}

                <li ref={sentinelRef} className={styles.sentinel}>
                  {loadingMore && (
                    <span className={styles.loadMoreHint}>
                      <Loader2 size={12} className={styles.spinner} /> 加载更多...
                    </span>
                  )}
                  {!hasMore && sessions.length > PAGE_SIZE && (
                    <span className={styles.allLoadedHint}>已经到底了</span>
                  )}
                </li>
              </>
            )}
          </ul>
        </nav>

        <div className={clsx(styles.footer, collapsed && styles.footerCollapsed)}>
          <div className={clsx(styles.assetEntryGroup, collapsed && styles.assetEntryGroupCollapsed)}>
            <NavLink
              to="/assets"
              id="sidebar-asset-btn"
              className={({ isActive }) => clsx(
                styles.assetButtonRow,
                collapsed && styles.assetButtonRowCollapsed,
                isActive && styles.assetButtonRowActive,
              )}
              aria-label="打开素材管理"
              title="素材管理"
            >
              <LayoutGrid size={16} />
              {!collapsed && (
                <>
                  <span>素材管理</span>
                  <span className={styles.assetBadge}>文档与图片</span>
                </>
              )}
            </NavLink>

            <button
              type="button"
              className={clsx(styles.assetQuickBtn, collapsed && styles.assetQuickBtnCollapsed)}
              aria-label="在当前会话中打开参考资料"
              onClick={handleOpenAssetsInWorkspace}
              title="当前会话资料"
            >
              {collapsed ? <BookOpen size={16} /> : '当前会话资料'}
            </button>
          </div>

          {collapsed ? (
            <div className={styles.compactProfileActions}>
              <button
                type="button"
                className={styles.compactProfileBtn}
                onClick={openProfileModal}
                title="编辑个人信息"
                aria-label="编辑个人信息"
              >
                <UserCircle size={20} />
              </button>
              <button
                type="button"
                className={styles.compactProfileBtn}
                onClick={handleLogout}
                title="退出登录"
                aria-label="退出登录"
              >
                <LogOut size={16} />
              </button>
            </div>
          ) : (
            <button className={styles.profileBtn} onClick={openProfileModal}>
              <UserCircle size={24} />
              <div className={styles.profileInfo}>
                <span className={styles.userName}>{user?.name ?? '未命名教师'}</span>
                <span className={styles.userRole}>{user?.department ?? '点击完善个人信息'}</span>
              </div>
              <span className={styles.profileHint}>编辑</span>
              <span
                className={styles.logoutBtn}
                onClick={(e) => {
                  e.stopPropagation();
                  handleLogout();
                }}
                title="退出登录"
                role="button"
              >
                <LogOut size={16} />
              </span>
            </button>
          )}
        </div>
      </aside>

      {modalRoot && createPortal(
        <>
          {(showNewModal || closingNewModal) && (
            <div className={clsx(styles.modalOverlay, closingNewModal && styles.modalOverlayClosing)} onClick={(e) => e.target === e.currentTarget && closeNewModal()}>
              <div className={clsx(styles.modal, closingNewModal && styles.modalClosing)}>
                <div className={styles.modalHeader}>
                  <div className={styles.modalIcon}><Sparkles size={22} /></div>
                  <h2 className={styles.modalTitle}>新建课件会话</h2>
                  <p className={styles.modalSubtitle}>先起一个名字，后面仍然可以随时修改。</p>
                </div>

                <div className={styles.modalBody}>
                  <label className={styles.modalLabel}>
                    <BookOpen size={14} /> 课件名称
                  </label>
                  <input
                    autoFocus
                    className={styles.modalInput}
                    placeholder="例如：牛顿第二定律、细胞呼吸、离散数学导论"
                    value={newSessionName}
                    onChange={(e) => setNewSessionName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCreateSession();
                      if (e.key === 'Escape') closeNewModal();
                    }}
                    disabled={isCreating}
                    maxLength={60}
                  />
                  <p className={styles.modalHint}>新会话会直接进入工作台，并沿用当前统一的设计系统与编辑流程。</p>
                </div>

                <div className={styles.modalFooter}>
                  <button className={styles.modalCancelBtn} onClick={closeNewModal} disabled={isCreating}>取消</button>
                  <button className={styles.modalSubmitBtn} onClick={handleCreateSession} disabled={isCreating}>
                    {isCreating ? <><Loader2 size={15} className={styles.spinner} /> 创建中...</> : <><Sparkles size={15} /> 开始备课</>}
                  </button>
                </div>
              </div>
            </div>
          )}

          {(deleteConfirmId || closingDeleteModal) && (
            <div className={clsx(styles.modalOverlay, closingDeleteModal && styles.modalOverlayClosing)} onClick={(e) => e.target === e.currentTarget && closeDeleteModal()}>
              <div className={clsx(styles.modal, styles.modalSmall, closingDeleteModal && styles.modalClosing)}>
                <div className={styles.modalHeader}>
                  <div className={clsx(styles.modalIcon, styles.modalIconDanger)}><Trash2 size={20} /></div>
                  <h2 className={styles.modalTitle}>删除会话</h2>
                  <p className={styles.modalSubtitle}>删除后，当前会话的对话、课件和讲义记录都会被永久移除，无法恢复。</p>
                </div>
                <div className={styles.modalFooter}>
                  <button className={styles.modalCancelBtn} onClick={closeDeleteModal} disabled={isDeletingSession}>取消</button>
                  <button className={clsx(styles.modalSubmitBtn, styles.modalSubmitDanger)} onClick={handleDeleteSession} disabled={isDeletingSession}>
                    {isDeletingSession ? <><Loader2 size={15} className={styles.spinner} /> 删除中...</> : <><Trash2 size={15} /> 确认删除</>}
                  </button>
                </div>
              </div>
            </div>
          )}

          {(showProfileModal || closingProfileModal) && (
            <div className={clsx(styles.modalOverlay, closingProfileModal && styles.modalOverlayClosing)} onClick={(e) => e.target === e.currentTarget && closeProfileModal()}>
              <div className={clsx(styles.modal, styles.modalSmall, closingProfileModal && styles.modalClosing)}>
                <div className={styles.modalHeader}>
                  <div className={styles.modalIcon}><UserCircle size={22} /></div>
                  <h2 className={styles.modalTitle}>个人信息</h2>
                  <p className={styles.modalSubtitle}>用于侧栏展示，也会帮助 AI 理解你的教学身份与场景。</p>
                </div>

                <div className={styles.modalBody}>
                  <label className={styles.modalLabel}><User size={13} /> 显示名称</label>
                  <input
                    autoFocus
                    className={styles.modalInput}
                    value={profileName}
                    onChange={(e) => setProfileName(e.target.value)}
                    placeholder="例如：王老师"
                    disabled={isSavingProfile}
                    maxLength={30}
                  />

                  <label className={styles.modalLabel} style={{ marginTop: 12 }}><Building2 size={13} /> 院系 / 单位</label>
                  <input
                    className={styles.modalInput}
                    value={profileDept}
                    onChange={(e) => setProfileDept(e.target.value)}
                    placeholder="例如：物理学院"
                    disabled={isSavingProfile}
                    maxLength={30}
                    onKeyDown={(e) => e.key === 'Enter' && handleSaveProfile()}
                  />
                </div>

                <div className={styles.modalFooter}>
                  <button className={styles.modalCancelBtn} onClick={closeProfileModal} disabled={isSavingProfile}>取消</button>
                  <button className={styles.modalSubmitBtn} onClick={handleSaveProfile} disabled={isSavingProfile}>
                    {isSavingProfile ? <><Loader2 size={15} className={styles.spinner} /> 保存中...</> : <><Check size={15} /> 保存</>}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>,
        modalRoot,
      )}
    </>
  );
}
