/**
 * GamePanel v2 — 互动小游戏面板（重构版）
 *
 * 新增：
 * - 侧边栏可折叠（让用户专注游戏）
 * - 全屏模式（Fullscreen API + 内部全屏覆盖层）
 * - 实时生成可视化（代码逐字打字动画 + 阶段进度条）
 * - Agent 工具调用后自动刷新列表（监听 isSynthesizing 结束事件）
 * - 500ms 高频轮询 + 生成进度百分比
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { clsx } from 'clsx';
import {
  Gamepad2, Loader2, Trash2, Code2, Eye, RefreshCw,
  ChevronRight, Sparkles, CheckCircle, AlertCircle, Copy, Check,
  X, Zap, PanelLeftClose, PanelLeftOpen, Maximize2, Minimize2,
} from 'lucide-react';
import {
  listSessionGames, generateGame, getGameTask, getGameSource,
  deleteGame, gamePreviewUrl, GAME_TYPE_DEFAULTS,
  type GameMeta, type GameSpec, type GameSuggestData, type GameTask,
} from '../utils/gamesApi';
import styles from './GamePanel.module.css';

// ─────────────────────────────────────────────────────────────────
// Types & Constants
// ─────────────────────────────────────────────────────────────────
interface GamePanelProps {
  sessionId: string;
  pendingSuggest: GameSuggestData | null;
  pendingTrigger: GameSpec | null;
  onClearSuggest: () => void;
  onClearTrigger: () => void;
  onActiveGameChange: (gameId: string | null) => void;
}

const STAGES = ['pending', 'preparing', 'generating', 'writing', 'done'];
const STAGE_LABELS: Record<string, string> = {
  pending:    '等待开始',
  preparing:  '准备素材',
  generating: 'AI 生成中',
  writing:    '写入文件',
  done:       '完成',
};

// 假打字内容 — 仅用于生成动画的视觉效果
const CODE_LINES = [
  '<!DOCTYPE html>',
  '<html lang="zh-CN">',
  '<head>',
  '  <meta charset="UTF-8">',
  '  <title>互动小游戏</title>',
  '  <style>',
  '    body { font-family: "Outfit", sans-serif; }',
  '    .quiz-card { border-radius: 16px; padding: 24px; }',
  '    .option { cursor: pointer; border-radius: 8px; }',
  '    .option:hover { background: rgba(99,102,241,0.1); }',
  '    @keyframes fadeIn { from{opacity:0} to{opacity:1} }',
  '  </style>',
  '</head>',
  '<body>',
  '  <div id="game-root">',
  '    <div class="quiz-card">',
  '      <h2 class="question-text"></h2>',
  '      <div class="options-grid"></div>',
  '      <div class="score-bar"></div>',
  '    </div>',
  '  </div>',
  '  <script>',
  '    const questions = [];',
  '    let current = 0, score = 0;',
  '    function render() {',
  '      const q = questions[current];',
  '      document.querySelector(".question-text")',
  '        .textContent = q.text;',
  '    }',
  '    render();',
  '  </script>',
  '</body>',
  '</html>',
];

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('zh-CN', {
      month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

// ─────────────────────────────────────────────────────────────────
// Sub: 游戏类型选择卡
// ─────────────────────────────────────────────────────────────────
function GameTypeCard({ label, hint, active, onClick }: {
  label: string; hint: string; active: boolean; onClick: () => void;
}) {
  return (
    <button
      className={clsx(styles.typeCard, active && styles.typeCardActive)}
      onClick={onClick} type="button" title={hint}
    >
      <span className={styles.typeCardLabel}>{label}</span>
      <span className={styles.typeCardHint}>{hint}</span>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────
// Sub: 实时代码打字动画（生成中显示）
// ─────────────────────────────────────────────────────────────────
function CodeTypingAnimation({ stage, progress }: { stage: string; progress: number }) {
  const [visibleLines, setVisibleLines] = useState(0);
  const [charIdx, setCharIdx] = useState(0);

  useEffect(() => {
    const totalLines = CODE_LINES.length;
    // drive visible lines based on progress (0-100)
    const targetLine = Math.min(totalLines, Math.floor((progress / 100) * totalLines) + 1);
    setVisibleLines(targetLine);
  }, [progress]);

  // Typewriter for the current partial line
  useEffect(() => {
    if (visibleLines <= 0) return;
    const currentLine = CODE_LINES[visibleLines - 1] ?? '';
    if (charIdx >= currentLine.length) return;
    const t = setTimeout(() => setCharIdx(c => c + 1), 22);
    return () => clearTimeout(t);
  }, [visibleLines, charIdx]);

  useEffect(() => { setCharIdx(0); }, [visibleLines]);

  const stageIdx = STAGES.indexOf(stage);
  const pct = Math.max(0, Math.min(100, progress));

  return (
    <div className={styles.typingWrap}>
      {/* 阶段进度条 */}
      <div className={styles.stageRow}>
        {STAGES.slice(0, -1).map((s, i) => (
          <div key={s} className={clsx(styles.stageStep, i <= stageIdx && styles.stageStepDone)}>
            <div className={styles.stageStepDot} />
            <span className={styles.stageStepLabel}>{STAGE_LABELS[s]}</span>
          </div>
        ))}
      </div>

      {/* 进度条 */}
      <div className={styles.progressBarWrap}>
        <div className={styles.progressBar} style={{ width: `${pct}%` }} />
        <span className={styles.progressPct}>{pct}%</span>
      </div>

      {/* 代码打字区 */}
      <div className={styles.codeWindow}>
        <div className={styles.codeWindowBar}>
          <span className={styles.codeDot} style={{ background: '#ff5f57' }} />
          <span className={styles.codeDot} style={{ background: '#febc2e' }} />
          <span className={styles.codeDot} style={{ background: '#28c840' }} />
          <span className={styles.codeWindowTitle}>game.html — AI 正在生成...</span>
        </div>
        <div className={styles.codeBody}>
          {CODE_LINES.slice(0, visibleLines - 1).map((line, i) => (
            <div key={i} className={styles.codeLine}>
              <span className={styles.codeLineNum}>{i + 1}</span>
              <span className={styles.codeLineContent}>{line}</span>
            </div>
          ))}
          {visibleLines > 0 && (
            <div className={styles.codeLine}>
              <span className={styles.codeLineNum}>{visibleLines}</span>
              <span className={styles.codeLineContent}>
                {CODE_LINES[visibleLines - 1]?.slice(0, charIdx)}
                <span className={styles.cursor}>|</span>
              </span>
            </div>
          )}
        </div>
      </div>

      <p className={styles.typingHint}>
        <Sparkles size={12} /> {STAGE_LABELS[stage] ?? 'AI 生成中...'} · 完成后将自动预览
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────
export default function GamePanel({
  sessionId, pendingSuggest, pendingTrigger,
  onClearSuggest, onClearTrigger, onActiveGameChange,
}: GamePanelProps) {

  // ── 布局控制 ────────────────────────────────────────────────
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const iframeContainerRef = useRef<HTMLDivElement>(null);

  // ── 游戏列表 ────────────────────────────────────────────────
  const [games, setGames] = useState<GameMeta[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());

  // ── 选中 / 视图模式 ─────────────────────────────────────────
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewTab, setPreviewTab] = useState<'preview' | 'source'>('preview');

  // ── 源码 ────────────────────────────────────────────────────
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceCode, setSourceCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // ── 生成任务 ─────────────────────────────────────────────────
  const [generating, setGenerating] = useState(false);
  const [genStage, setGenStage] = useState('pending');
  const [genProgress, setGenProgress] = useState(0);
  const [genError, setGenError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── 手动创建面板 ─────────────────────────────────────────────
  const [showManualPanel, setShowManualPanel] = useState(false);
  const [manualType, setManualType] = useState(GAME_TYPE_DEFAULTS[0].key);
  const [manualTitle, setManualTitle] = useState('');
  const [manualTopics, setManualTopics] = useState('');
  const [manualRequirements, setManualRequirements] = useState('');

  // ── 通知父组件当前预览的 game_id ─────────────────────────────
  useEffect(() => { onActiveGameChange(selectedId); }, [selectedId, onActiveGameChange]);

  // ─────────────────────────────────────────────────────────────
  // 拉取游戏列表
  // ─────────────────────────────────────────────────────────────
  const fetchGames = useCallback(async (silent = false) => {
    if (!silent) setLoadingList(true);
    try {
      const list = await listSessionGames(sessionId);
      setGames(list);
    } catch { /* non-critical */ }
    finally { setLoadingList(false); }
  }, [sessionId]);

  useEffect(() => {
    if (sessionId && sessionId !== 'new') fetchGames();
  }, [sessionId, fetchGames]);

  // ─────────────────────────────────────────────────────────────
  // 监听 AI synthesis 结束事件 → 自动刷新列表
  // 当 Agent 通过工具调用生成游戏时，synthesis 结束后应刷新列表
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const handleSynthEnd = (e: Event) => {
      const ev = e as CustomEvent;
      if (ev.detail?.sessionId === sessionId) {
        // 延迟 800ms 让后端事务提交
        setTimeout(() => fetchGames(true), 800);
      }
    };
    // 复用现有的 EduAgent_Generate_End 事件（streamManager 在 tool_result 时触发）
    window.addEventListener('EduAgent_Generate_End', handleSynthEnd);
    return () => window.removeEventListener('EduAgent_Generate_End', handleSynthEnd);
  }, [sessionId, fetchGames]);

  // ─────────────────────────────────────────────────────────────
  // 任务轮询（500ms 高频）
  // ─────────────────────────────────────────────────────────────
  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  const startPolling = useCallback((taskId: string, gameId: string) => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      try {
        const task: GameTask = await getGameTask(taskId);
        setGenStage(task.stage ?? 'generating');
        setGenProgress(task.progress ?? 0);

        if (task.status === 'completed') {
          stopPolling();
          setGenerating(false);
          setGenProgress(100);
          // 刷新列表然后自动选中新游戏
          const list = await listSessionGames(sessionId);
          setGames(list);
          const finalId = task.result?.game_id ?? gameId;
          setSelectedId(finalId);
          setPreviewTab('preview');
          setSourceCode(null);
        } else if (task.status === 'failed') {
          stopPolling();
          setGenerating(false);
          setGenError(task.result?.error ?? '生成失败，请重试');
        }
      } catch { /* keep polling */ }
    }, 500);
  }, [stopPolling, sessionId]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  // ─────────────────────────────────────────────────────────────
  // 触发生成
  // ─────────────────────────────────────────────────────────────
  const triggerGenerate = useCallback(async (spec: GameSpec, refineId?: string | null) => {
    if (sessionId === 'new') return;
    setGenerating(true);
    setGenError(null);
    setGenStage('pending');
    setGenProgress(0);
    // 在生成时清空选中，让右侧显示动画
    setSelectedId(null);

    try {
      const result = await generateGame(sessionId, spec, refineId);
      startPolling(result.task_id, result.game_id);
    } catch (e: any) {
      setGenerating(false);
      setGenError(e?.message ?? '发起生成失败，请重试');
    }
  }, [sessionId, startPolling]);

  const handleConfirmTrigger = useCallback(() => {
    if (!pendingTrigger) return;
    triggerGenerate(pendingTrigger, pendingTrigger.is_refinement ? selectedId : null);
    onClearTrigger();
    onClearSuggest();
  }, [pendingTrigger, selectedId, triggerGenerate, onClearTrigger, onClearSuggest]);

  const handleManualGenerate = () => {
    const spec: GameSpec = {
      game_type: manualType,
      title: manualTitle || (GAME_TYPE_DEFAULTS.find(t => t.key === manualType)?.label ?? '互动游戏'),
      key_topics: manualTopics.split(/[，,、\n]/).map(s => s.trim()).filter(Boolean),
      custom_requirements: manualRequirements,
      is_refinement: false,
    };
    triggerGenerate(spec, null);
    setShowManualPanel(false);
  };

  // ─────────────────────────────────────────────────────────────
  // 删除
  // ─────────────────────────────────────────────────────────────
  const handleDelete = async (gameId: string) => {
    if (!confirm('确认删除该游戏？此操作不可撤销。')) return;
    setDeletingIds(prev => new Set(prev).add(gameId));
    try {
      await deleteGame(gameId);
      setGames(prev => prev.filter(g => g.game_id !== gameId));
      if (selectedId === gameId) { setSelectedId(null); setSourceCode(null); }
    } catch { alert('删除失败，请重试'); }
    finally {
      setDeletingIds(prev => { const n = new Set(prev); n.delete(gameId); return n; });
    }
  };

  // ─────────────────────────────────────────────────────────────
  // 源码加载
  // ─────────────────────────────────────────────────────────────
  const loadSource = useCallback(async (gameId: string) => {
    setSourceLoading(true); setSourceCode(null);
    try { const d = await getGameSource(gameId); setSourceCode(d.html_code); }
    catch { setSourceCode('// 源码加载失败'); }
    finally { setSourceLoading(false); }
  }, []);

  useEffect(() => {
    if (previewTab === 'source' && selectedId && !sourceCode) loadSource(selectedId);
  }, [previewTab, selectedId, sourceCode, loadSource]);

  const handleCopy = () => {
    if (!sourceCode) return;
    navigator.clipboard.writeText(sourceCode).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    });
  };

  // ─────────────────────────────────────────────────────────────
  // 全屏模式
  // ─────────────────────────────────────────────────────────────
  const toggleFullscreen = useCallback(() => {
    if (!isFullscreen) {
      // 进入全屏：组件内部全屏覆盖层（不使用 Fullscreen API，兼容性更好）
      setIsFullscreen(true);
    } else {
      setIsFullscreen(false);
    }
  }, [isFullscreen]);

  // ESC 退出全屏
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreen) setIsFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isFullscreen]);

  const selectedGame = games.find(g => g.game_id === selectedId);

  // ─────────────────────────────────────────────────────────────
  // 渲染
  // ─────────────────────────────────────────────────────────────
  return (
    <div className={clsx(styles.root, isFullscreen && styles.rootFullscreen)}>

      {/* ─── 左栏：折叠面板 ─── */}
      <div className={clsx(styles.sidebar, !sidebarOpen && styles.sidebarCollapsed)}>

        {/* 折叠按钮 */}
        <button
          className={styles.collapseBtn}
          onClick={() => setSidebarOpen(v => !v)}
          title={sidebarOpen ? '折叠侧边栏' : '展开侧边栏'}
        >
          {sidebarOpen ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
        </button>

        {/* 以下内容仅在展开时显示 */}
        {sidebarOpen && (
          <>
            {/* AI 建议横幅 */}
            {pendingSuggest && (
              <div className={styles.suggestBanner}>
                <div className={styles.suggestHeader}>
                  <Sparkles size={13} className={styles.suggestIcon} />
                  <span>AI 游戏类型建议</span>
                  <button className={styles.bannerClose} onClick={onClearSuggest}><X size={12} /></button>
                </div>
                <p className={styles.suggestQuestion}>{pendingSuggest.pending_question}</p>
                <div className={styles.suggestChips}>
                  {pendingSuggest.suggestions.map(s => {
                    const t = GAME_TYPE_DEFAULTS.find(d => d.key === s.type);
                    return (
                      <div key={s.type} className={styles.suggestChip}>
                        <span className={styles.suggestChipLabel}>{t?.label ?? s.type}</span>
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
                  <Zap size={13} className={styles.triggerIcon} />
                  <span>{pendingTrigger.is_refinement ? '应用修改' : '生成游戏'}</span>
                  <button className={styles.bannerClose} onClick={onClearTrigger}><X size={12} /></button>
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
                  <p className={styles.triggerInstr}>修改：{pendingTrigger.refinement_instruction}</p>
                )}
                <button className={styles.confirmBtn} onClick={handleConfirmTrigger} disabled={generating}>
                  {generating ? <Loader2 size={13} className={styles.spin} /> : <Zap size={13} />}
                  {pendingTrigger.is_refinement ? '应用修改 🎮' : '生成游戏 🎮'}
                </button>
              </div>
            )}

            {/* 错误提示 */}
            {genError && (
              <div className={styles.errorBar}>
                <AlertCircle size={13} />
                <span>{genError}</span>
                <button className={styles.bannerClose} onClick={() => setGenError(null)}><X size={12} /></button>
              </div>
            )}

            {/* 操作栏 */}
            <div className={styles.listActions}>
              <button
                className={styles.newGameBtn}
                onClick={() => setShowManualPanel(v => !v)}
                disabled={generating || sessionId === 'new'}
              >
                <Gamepad2 size={13} /> 手动创建
              </button>
              <button
                className={styles.refreshBtn}
                onClick={() => fetchGames()}
                disabled={loadingList}
                title="刷新列表"
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
                    <GameTypeCard key={t.key} label={t.label} hint={t.hint}
                      active={manualType === t.key} onClick={() => setManualType(t.key)} />
                  ))}
                </div>
                <input className={styles.manualInput} placeholder="游戏标题（可选）"
                  value={manualTitle} onChange={e => setManualTitle(e.target.value)} />
                <input className={styles.manualInput} placeholder="知识点，用逗号分隔"
                  value={manualTopics} onChange={e => setManualTopics(e.target.value)} />
                <textarea className={clsx(styles.manualInput, styles.manualTextarea)}
                  placeholder="自定义要求（可选）" rows={2}
                  value={manualRequirements} onChange={e => setManualRequirements(e.target.value)} />
                <button className={styles.confirmBtn} onClick={handleManualGenerate} disabled={generating}>
                  <Gamepad2 size={13} /> 开始生成
                </button>
              </div>
            )}

            {/* 游戏列表 */}
            {loadingList && games.length === 0 ? (
              <div className={styles.listLoading}>
                <Loader2 size={18} className={styles.spin} />
              </div>
            ) : games.length === 0 ? (
              <div className={styles.emptyList}>
                <Gamepad2 size={26} className={styles.emptyIcon} />
                <p>暂无游戏</p>
                <small>告诉 AI 你想生成什么游戏，或点击「手动创建」</small>
              </div>
            ) : (
              <div className={styles.gameList}>
                {/* 正在生成时显示骨架卡 */}
                {generating && (
                  <div className={clsx(styles.gameItem, styles.gameItemGenerating)}>
                    <div className={styles.generatingPulse} />
                    <div className={styles.gameItemMain}>
                      <span className={styles.gameItemTitle}>正在生成新游戏...</span>
                      <span className={styles.gameItemMeta}>
                        {STAGE_LABELS[genStage] ?? '处理中'} · {genProgress}%
                      </span>
                    </div>
                    <Loader2 size={13} className={clsx(styles.spin, styles.statusGen)} />
                  </div>
                )}
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
                        title="删除"
                      >
                        {deletingIds.has(g.game_id)
                          ? <Loader2 size={11} className={styles.spin} />
                          : <Trash2 size={11} />}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* ─── 右栏：预览区 ─── */}
      <div className={styles.preview} ref={iframeContainerRef}>

        {/* 正在生成：显示实时代码动画 */}
        {generating ? (
          <CodeTypingAnimation stage={genStage} progress={genProgress} />
        ) : !selectedId ? (
          <div className={styles.previewEmpty}>
            <Gamepad2 size={40} className={styles.emptyIcon} />
            <p>选择左侧游戏进行预览</p>
            <small>游戏以完全自含 HTML 形式运行，无网络请求</small>
          </div>
        ) : (
          <>
            {/* 预览头部 */}
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

              <div className={styles.previewActions}>
                {previewTab === 'source' && (
                  <button className={styles.iconActionBtn} onClick={handleCopy} disabled={!sourceCode} title="复制代码">
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                )}
                {/* 侧边栏折叠快捷入口（右侧） */}
                <button
                  className={styles.iconActionBtn}
                  onClick={() => setSidebarOpen(v => !v)}
                  title={sidebarOpen ? '隐藏侧边栏，专注游戏' : '显示侧边栏'}
                >
                  {sidebarOpen ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={14} />}
                </button>
                {/* 全屏 */}
                <button
                  className={styles.iconActionBtn}
                  onClick={toggleFullscreen}
                  title={isFullscreen ? '退出全屏 (Esc)' : '全屏预览'}
                >
                  {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                </button>
              </div>
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
                    <Loader2 size={22} className={styles.spin} />
                    <span>加载源码...</span>
                  </div>
                ) : (
                  <pre className={styles.sourcePre}><code>{sourceCode ?? ''}</code></pre>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
