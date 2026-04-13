/**
 * GamePanel — 互动小游戏管理与预览面板
 * 含：游戏列表、iframe 预览、HTML 源码查看、AI 建议卡片、确认生成按钮
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { clsx } from 'clsx';
import {
  Gamepad2, Loader2, Trash2, Code2, Eye, RefreshCw,
  ChevronRight, Sparkles, CheckCircle, AlertCircle, Copy, Check,
  X, Zap,
} from 'lucide-react';
import {
  listSessionGames, generateGame, getGameTask, getGameSource,
  deleteGame, gamePreviewUrl,
  GAME_TYPE_DEFAULTS,
  type GameMeta, type GameSpec, type GameSuggestData, type GameTask,
} from '../utils/gamesApi';
import styles from './GamePanel.module.css';

// ─────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────
interface GamePanelProps {
  sessionId: string;
  /** AI game_suggest 事件数据（从 Workspace 传入）*/
  pendingSuggest: GameSuggestData | null;
  /** AI game_trigger 事件数据（从 Workspace 传入）*/
  pendingTrigger: GameSpec | null;
  onClearSuggest: () => void;
  onClearTrigger: () => void;
  /** 通知 Workspace 当前正在预览的 game_id（用于精炼时传 active_game_id）*/
  onActiveGameChange: (gameId: string | null) => void;
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────
const STAGE_LABELS: Record<string, string> = {
  pending:     '等待开始',
  preparing:   '准备素材',
  generating:  'AI 生成中',
  writing:     '写入文件',
  done:        '完成',
};

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('zh-CN', {
      month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

// ─────────────────────────────────────────────────────────────────
// Sub-component: 单张游戏类型卡
// ─────────────────────────────────────────────────────────────────
function GameTypeCard({
  label, hint, active, onClick,
}: { label: string; hint: string; active: boolean; onClick: () => void }) {
  return (
    <button
      className={clsx(styles.typeCard, active && styles.typeCardActive)}
      onClick={onClick}
      type="button"
      title={hint}
    >
      <span className={styles.typeCardLabel}>{label}</span>
      <span className={styles.typeCardHint}>{hint}</span>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────
export default function GamePanel({
  sessionId,
  pendingSuggest,
  pendingTrigger,
  onClearSuggest,
  onClearTrigger,
  onActiveGameChange,
}: GamePanelProps) {
  // ── 列表状态 ──────────────────────────────────────────────────
  const [games, setGames] = useState<GameMeta[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());

  // ── 选中/预览 ─────────────────────────────────────────────────
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewTab, setPreviewTab] = useState<'preview' | 'source'>('preview');

  // ── 源码查看 ──────────────────────────────────────────────────
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceCode, setSourceCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // ── 游戏生成（任务轮询）──────────────────────────────────────
  const [generating, setGenerating] = useState(false);
  const [generatingMsg, setGeneratingMsg] = useState('');
  const [genError, setGenError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── 手动触发面板（当没有 AI 建议时）─────────────────────────
  const [showManualPanel, setShowManualPanel] = useState(false);
  const [manualType, setManualType] = useState(GAME_TYPE_DEFAULTS[0].key);
  const [manualTitle, setManualTitle] = useState('');
  const [manualTopics, setManualTopics] = useState('');
  const [manualRequirements, setManualRequirements] = useState('');

  // ── 当前预览游戏通知父组件 ────────────────────────────────────
  useEffect(() => {
    onActiveGameChange(selectedId);
  }, [selectedId, onActiveGameChange]);

  // ── 拉取游戏列表 ──────────────────────────────────────────────
  const fetchGames = useCallback(async (silent = false) => {
    if (!silent) setLoadingList(true);
    try {
      const list = await listSessionGames(sessionId);
      setGames(list);
    } catch {
      // non-critical
    } finally {
      setLoadingList(false);
    }
  }, [sessionId]);

  useEffect(() => {
    if (sessionId && sessionId !== 'new') fetchGames();
  }, [sessionId, fetchGames]);

  // ── 轮询任务状态 ──────────────────────────────────────────────
  const startPolling = useCallback((taskId: string, gameId: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const task: GameTask = await getGameTask(taskId);
        setGeneratingMsg(STAGE_LABELS[task.stage] ?? task.stage ?? '生成中...');
        if (task.status === 'completed') {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          setGenerating(false);
          setGeneratingMsg('');
          await fetchGames(true);
          setSelectedId(task.result?.game_id ?? gameId);
          setPreviewTab('preview');
        } else if (task.status === 'failed') {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          setGenerating(false);
          setGenError(task.result?.error ?? '生成失败，请重试');
        }
      } catch {
        // keep polling
      }
    }, 2000);
  }, [fetchGames]);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  // ── 触发生成 ──────────────────────────────────────────────────
  const triggerGenerate = useCallback(async (
    spec: GameSpec,
    refineGameId?: string | null,
  ) => {
    if (sessionId === 'new') return;
    setGenerating(true);
    setGenError(null);
    setGeneratingMsg('AI 生成中...');
    try {
      const result = await generateGame(sessionId, spec, refineGameId);
      startPolling(result.task_id, result.game_id);
    } catch (e: any) {
      setGenerating(false);
      setGenError(e?.message ?? '发起生成失败，请重试');
    }
  }, [sessionId, startPolling]);

  // ── 处理 AI 建议确认 ──────────────────────────────────────────
  const handleConfirmTrigger = useCallback(() => {
    if (!pendingTrigger) return;
    const isRefinement = pendingTrigger.is_refinement;
    triggerGenerate(pendingTrigger, isRefinement ? selectedId : null);
    onClearTrigger();
    onClearSuggest();
  }, [pendingTrigger, selectedId, triggerGenerate, onClearTrigger, onClearSuggest]);

  // ── 手动生成提交 ──────────────────────────────────────────────
  const handleManualGenerate = () => {
    const spec: GameSpec = {
      game_type: manualType,
      title: manualTitle || GAME_TYPE_DEFAULTS.find(t => t.key === manualType)?.label || '互动游戏',
      key_topics: manualTopics.split(/[，,、\n]/).map(s => s.trim()).filter(Boolean),
      custom_requirements: manualRequirements,
      is_refinement: false,
    };
    triggerGenerate(spec, null);
    setShowManualPanel(false);
  };

  // ── 删除游戏 ──────────────────────────────────────────────────
  const handleDelete = async (gameId: string) => {
    if (!confirm('确认删除该游戏？此操作不可撤销。')) return;
    setDeletingIds(prev => new Set(prev).add(gameId));
    try {
      await deleteGame(gameId);
      setGames(prev => prev.filter(g => g.game_id !== gameId));
      if (selectedId === gameId) {
        setSelectedId(null);
        setSourceCode(null);
      }
    } catch {
      alert('删除失败，请重试');
    } finally {
      setDeletingIds(prev => { const n = new Set(prev); n.delete(gameId); return n; });
    }
  };

  // ── 源码加载 ──────────────────────────────────────────────────
  const loadSource = async (gameId: string) => {
    setSourceLoading(true);
    setSourceCode(null);
    try {
      const data = await getGameSource(gameId);
      setSourceCode(data.html_code);
    } catch {
      setSourceCode('// 加载失败');
    } finally {
      setSourceLoading(false);
    }
  };

  useEffect(() => {
    if (previewTab === 'source' && selectedId && !sourceCode) {
      loadSource(selectedId);
    }
  }, [previewTab, selectedId]); // eslint-disable-line

  const handleCopy = () => {
    if (!sourceCode) return;
    navigator.clipboard.writeText(sourceCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const selectedGame = games.find(g => g.game_id === selectedId);

  // ── 渲染 ──────────────────────────────────────────────────────
  return (
    <div className={styles.root}>

      {/* ── 左栏：列表 + 触发 ── */}
      <div className={styles.sidebar}>
        {/* AI 建议横幅 */}
        {pendingSuggest && (
          <div className={styles.suggestBanner}>
            <div className={styles.suggestHeader}>
              <Sparkles size={14} className={styles.suggestIcon} />
              <span>AI 游戏类型建议</span>
              <button className={styles.bannerClose} onClick={onClearSuggest}><X size={13} /></button>
            </div>
            <p className={styles.suggestQuestion}>{pendingSuggest.pending_question}</p>
            <div className={styles.suggestChips}>
              {pendingSuggest.suggestions.map(s => {
                const typeInfo = GAME_TYPE_DEFAULTS.find(t => t.key === s.type);
                return (
                  <div key={s.type} className={styles.suggestChip}>
                    <span className={styles.suggestChipLabel}>{typeInfo?.label ?? s.type}</span>
                    <span className={styles.suggestChipReason}>{s.reason}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* AI 确认生成横幅 */}
        {pendingTrigger && (
          <div className={styles.triggerBanner}>
            <div className={styles.triggerHeader}>
              <Zap size={14} className={styles.triggerIcon} />
              <span>{pendingTrigger.is_refinement ? '应用修改' : '生成游戏'}</span>
              <button className={styles.bannerClose} onClick={onClearTrigger}><X size={13} /></button>
            </div>
            <p className={styles.triggerTitle}>{pendingTrigger.title}</p>
            {pendingTrigger.key_topics?.length > 0 && (
              <div className={styles.triggerTopics}>
                {pendingTrigger.key_topics.slice(0, 5).map(t => (
                  <span key={t} className={styles.topicTag}>{t}</span>
                ))}
              </div>
            )}
            {pendingTrigger.refinement_instruction && (
              <p className={styles.triggerInstr}>修改说明：{pendingTrigger.refinement_instruction}</p>
            )}
            <button
              className={styles.confirmBtn}
              onClick={handleConfirmTrigger}
              disabled={generating}
            >
              {generating ? <Loader2 size={14} className={styles.spin} /> : <Zap size={14} />}
              {pendingTrigger.is_refinement ? '应用修改 🎮' : '生成游戏 🎮'}
            </button>
          </div>
        )}

        {/* 生成进度条 */}
        {generating && (
          <div className={styles.generatingBar}>
            <Loader2 size={14} className={styles.spin} />
            <span>{generatingMsg || 'AI 生成中...'}</span>
          </div>
        )}

        {genError && (
          <div className={styles.errorBar}>
            <AlertCircle size={13} />
            <span>{genError}</span>
            <button className={styles.bannerClose} onClick={() => setGenError(null)}><X size={13} /></button>
          </div>
        )}

        {/* 操作栏：新建 + 刷新 */}
        <div className={styles.listActions}>
          <button
            className={styles.newGameBtn}
            onClick={() => setShowManualPanel(!showManualPanel)}
            disabled={generating || sessionId === 'new'}
          >
            <Gamepad2 size={14} /> 手动创建
          </button>
          <button
            className={styles.refreshBtn}
            onClick={() => fetchGames()}
            disabled={loadingList}
            title="刷新游戏列表"
          >
            <RefreshCw size={13} className={clsx(loadingList && styles.spin)} />
          </button>
        </div>

        {/* 手动创建面板 */}
        {showManualPanel && (
          <div className={styles.manualPanel}>
            <p className={styles.manualLabel}>游戏类型</p>
            <div className={styles.typeGrid}>
              {GAME_TYPE_DEFAULTS.map(t => (
                <GameTypeCard
                  key={t.key}
                  label={t.label}
                  hint={t.hint}
                  active={manualType === t.key}
                  onClick={() => setManualType(t.key)}
                />
              ))}
            </div>
            <input
              className={styles.manualInput}
              placeholder="游戏标题（可选）"
              value={manualTitle}
              onChange={e => setManualTitle(e.target.value)}
            />
            <input
              className={styles.manualInput}
              placeholder="知识点，用逗号分隔"
              value={manualTopics}
              onChange={e => setManualTopics(e.target.value)}
            />
            <textarea
              className={clsx(styles.manualInput, styles.manualTextarea)}
              placeholder="自定义要求（可选）"
              rows={2}
              value={manualRequirements}
              onChange={e => setManualRequirements(e.target.value)}
            />
            <button
              className={styles.confirmBtn}
              onClick={handleManualGenerate}
              disabled={generating}
            >
              <Gamepad2 size={14} /> 开始生成
            </button>
          </div>
        )}

        {/* 游戏列表 */}
        {loadingList && games.length === 0 ? (
          <div className={styles.listLoading}>
            <Loader2 size={20} className={styles.spin} />
          </div>
        ) : games.length === 0 ? (
          <div className={styles.emptyList}>
            <Gamepad2 size={28} className={styles.emptyIcon} />
            <p>暂无游戏</p>
            <small>告诉 AI 你想生成什么类型的游戏，或点击「手动创建」</small>
          </div>
        ) : (
          <div className={styles.gameList}>
            {games.map(g => (
              <div
                key={g.game_id}
                className={clsx(styles.gameItem, selectedId === g.game_id && styles.gameItemActive)}
                onClick={() => { setSelectedId(g.game_id); setSourceCode(null); setPreviewTab('preview'); }}
              >
                <div className={styles.gameItemMain}>
                  <span className={styles.gameItemTitle}>{g.title}</span>
                  <span className={styles.gameItemMeta}>
                    {g.type_label} · v{g.version} · {fmtDate(g.updated_at)}
                  </span>
                </div>
                <div className={styles.gameItemRight}>
                  {g.status === 'completed' && <CheckCircle size={13} className={styles.statusDone} />}
                  {g.status === 'generating' && <Loader2 size={13} className={clsx(styles.spin, styles.statusGen)} />}
                  {g.status === 'failed' && <AlertCircle size={13} className={styles.statusFail} />}
                  {selectedId === g.game_id && <ChevronRight size={13} className={styles.chevron} />}
                  <button
                    className={styles.deleteBtn}
                    onClick={e => { e.stopPropagation(); handleDelete(g.game_id); }}
                    disabled={deletingIds.has(g.game_id)}
                    title="删除游戏"
                  >
                    {deletingIds.has(g.game_id)
                      ? <Loader2 size={12} className={styles.spin} />
                      : <Trash2 size={12} />}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── 右栏：预览 ── */}
      <div className={styles.preview}>
        {!selectedId ? (
          <div className={styles.previewEmpty}>
            <Gamepad2 size={40} className={styles.emptyIcon} />
            <p>选择左侧游戏进行预览</p>
            <small>游戏以完全自含 HTML 形式运行，无需网络</small>
          </div>
        ) : (
          <>
            {/* 预览 Tab Bar */}
            <div className={styles.previewHeader}>
              <div className={styles.previewTabs}>
                <button
                  className={clsx(styles.previewTab, previewTab === 'preview' && styles.previewTabActive)}
                  onClick={() => setPreviewTab('preview')}
                >
                  <Eye size={13} /> 运行预览
                </button>
                <button
                  className={clsx(styles.previewTab, previewTab === 'source' && styles.previewTabActive)}
                  onClick={() => setPreviewTab('source')}
                >
                  <Code2 size={13} /> HTML 源码
                </button>
              </div>
              <div className={styles.previewMeta}>
                <span className={styles.previewTitle}>{selectedGame?.title}</span>
                {selectedGame && (
                  <span className={styles.previewVersion}>v{selectedGame.version}</span>
                )}
              </div>
              {previewTab === 'source' && (
                <button className={styles.copyBtn} onClick={handleCopy} disabled={!sourceCode}>
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                  {copied ? '已复制' : '复制'}
                </button>
              )}
            </div>

            {/* 内容区 */}
            {previewTab === 'preview' ? (
              <iframe
                key={selectedId}
                src={gamePreviewUrl(selectedId)}
                sandbox="allow-scripts"
                className={styles.iframe}
                title={selectedGame?.title ?? '游戏预览'}
              />
            ) : (
              <div className={styles.sourceWrap}>
                {sourceLoading ? (
                  <div className={styles.sourceLoading}>
                    <Loader2 size={24} className={styles.spin} />
                    <span>加载源码...</span>
                  </div>
                ) : (
                  <pre className={styles.sourcePre}>
                    <code>{sourceCode ?? ''}</code>
                  </pre>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
