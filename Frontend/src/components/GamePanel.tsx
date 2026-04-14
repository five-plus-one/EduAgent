/**
 * GamePanel v3 — 互动小游戏面板（流式生成版）
 *
 * 核心升级：
 * - 真实 HTML 代码流式渲染（SSE → fetchEventSource → 自动降级轮询）
 * - StreamingCodeWindow：实时展示 LLM 输出的 HTML token
 * - AbortController：组件卸载时安全中断流
 * - 侧边栏折叠 / 全屏模式
 * - Agent 工具调用后自动刷新列表
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { clsx } from 'clsx';
import {
  Gamepad2, Loader2, Trash2, Code2, Eye, RefreshCw,
  ChevronRight, Sparkles, CheckCircle, AlertCircle, Copy, Check,
  X, Zap, PanelLeftClose, PanelLeftOpen, Maximize2, Minimize2,
} from 'lucide-react';
import {
  listSessionGames, generateGame, getGameSource,
  deleteGame, fetchGameHtml, gameShareUrl,
  streamGameTask, GAME_TYPE_DEFAULTS,
  type GameMeta, type GameSpec, type GameSuggestData,
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

const STAGES = ['pending', 'preparing', 'generating', 'writing'];
const STAGE_LABELS: Record<string, string> = {
  pending:    '等待开始',
  preparing:  '准备素材',
  generating: 'AI 生成中',
  writing:    '写入文件',
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
// Sub: 游戏类型卡
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
// Sub: 真实流式代码窗口
// ─────────────────────────────────────────────────────────────────
interface StreamingCodeWindowProps {
  stage: string;
  progress: number;
  stageMessage?: string;
  code: string;         // 实时累积的 HTML 代码
  isStreaming: boolean; // true = SSE 中，false = 轮询降级
}

function StreamingCodeWindow({ stage, progress, stageMessage, code, isStreaming }: StreamingCodeWindowProps) {
  const codeBodyRef = useRef<HTMLDivElement>(null);
  const stageIdx = STAGES.indexOf(stage);
  const pct = Math.max(0, Math.min(100, progress));

  // 自动滚动到代码底部
  useEffect(() => {
    const el = codeBodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [code]);

  const lines = code ? code.split('\n') : [];

  return (
    <div className={styles.typingWrap}>
      {/* 阶段步骤 */}
      <div className={styles.stageRow}>
        {STAGES.map((s, i) => (
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

      {/* 代码窗口 */}
      <div className={styles.codeWindow}>
        <div className={styles.codeWindowBar}>
          <span className={styles.codeDot} style={{ background: '#ff5f57' }} />
          <span className={styles.codeDot} style={{ background: '#febc2e' }} />
          <span className={styles.codeDot} style={{ background: '#28c840' }} />
          <span className={styles.codeWindowTitle}>
            game.html
            {isStreaming
              ? <span className={styles.streamingBadge}>● LIVE</span>
              : <span className={styles.pollingBadge}>↻ 轮询</span>}
          </span>
        </div>
        <div className={styles.codeBody} ref={codeBodyRef}>
          {lines.length === 0 ? (
            <div className={styles.codeWaiting}>
              <Loader2 size={14} className={styles.spin} />
              <span>等待 AI 生成代码...</span>
            </div>
          ) : (
            lines.map((line, i) => (
              <div key={i} className={styles.codeLine}>
                <span className={styles.codeLineNum}>{i + 1}</span>
                <span className={styles.codeLineContent}>{line}</span>
              </div>
            ))
          )}
          {/* 最后一行的光标 */}
          {lines.length > 0 && (
            <div className={styles.codeLine}>
              <span className={styles.codeLineNum}></span>
              <span className={styles.codeLineContent}>
                <span className={styles.cursor}>|</span>
              </span>
            </div>
          )}
        </div>

        {/* 代码字符数统计 */}
        {code.length > 0 && (
          <div className={styles.codeStats}>
            {code.length.toLocaleString()} 字符 · {lines.length} 行
          </div>
        )}
      </div>

      <p className={styles.typingHint}>
        <Sparkles size={12} />
        {stageMessage ?? (STAGE_LABELS[stage] ?? 'AI 生成中...')} · 完成后将自动切换到预览
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Main: GamePanel
// ─────────────────────────────────────────────────────────────────
export default function GamePanel({
  sessionId, pendingSuggest, pendingTrigger,
  onClearSuggest, onClearTrigger, onActiveGameChange,
}: GamePanelProps) {

  // ── 布局 ────────────────────────────────────────────────────
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // ── 游戏列表 ─────────────────────────────────────────────────
  const [games, setGames] = useState<GameMeta[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());

  // ── 选中 / 视图模式 ──────────────────────────────────────────
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewTab, setPreviewTab] = useState<'preview' | 'source'>('preview');

  // ── 预览 HTML（srcdoc 注入，规避跨域/X-Frame-Options）────────
  const [previewHtml, setPreviewHtml]       = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError]     = useState<string | null>(null);

  // ── 源码 ─────────────────────────────────────────────────────
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceCode, setSourceCode]       = useState<string | null>(null);
  const [copied, setCopied]               = useState(false);

  // ── 流式生成状态 ─────────────────────────────────────────────
  const [generating, setGenerating] = useState(false);
  const [genStage, setGenStage] = useState('pending');
  const [genProgress, setGenProgress] = useState(0);
  const [genStageMsg, setGenStageMsg] = useState<string | undefined>();
  const [streamedCode, setStreamedCode] = useState('');   // 实时累积 HTML
  const [isLiveStream, setIsLiveStream] = useState(false); // SSE vs 轮询
  const [genError, setGenError] = useState<string | null>(null);
  const [refreshingList, setRefreshingList] = useState(false); // 生成完成后刷新列表过渡态
  const abortRef = useRef<AbortController | null>(null);

  // ── 手动创建面板 ─────────────────────────────────────────────
  const [showManualPanel, setShowManualPanel] = useState(false);
  const [manualType, setManualType] = useState(GAME_TYPE_DEFAULTS[0].key);
  const [manualTitle, setManualTitle] = useState('');
  const [manualTopics, setManualTopics] = useState('');
  const [manualRequirements, setManualRequirements] = useState('');

  // ── 通知父组件 ───────────────────────────────────────────────
  useEffect(() => { onActiveGameChange(selectedId); }, [selectedId, onActiveGameChange]);

  // ── 拉取游戏列表 ─────────────────────────────────────────────
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

  // ── Agent 工具调用后自动刷新 ──────────────────────────────────
  useEffect(() => {
    const handler = (e: Event) => {
      const ev = e as CustomEvent;
      if (ev.detail?.sessionId === sessionId) {
        setTimeout(() => fetchGames(true), 800);
      }
    };
    window.addEventListener('EduAgent_Generate_End', handler);
    return () => window.removeEventListener('EduAgent_Generate_End', handler);
  }, [sessionId, fetchGames]);

  // ── 组件卸载时中断流 ─────────────────────────────────────────
  useEffect(() => () => { abortRef.current?.abort(); }, []);

  // ── ESC 退出全屏 ─────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreen) setIsFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isFullscreen]);

  // ─────────────────────────────────────────────────────────────
  // 触发生成（接入 streamGameTask）
  // ─────────────────────────────────────────────────────────────
  const triggerGenerate = useCallback(async (spec: GameSpec, refineId?: string | null) => {
    if (sessionId === 'new') return;

    // 中断上次流
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // 重置状态
    setGenerating(true);
    setGenError(null);
    setGenStage('pending');
    setGenProgress(0);
    setGenStageMsg(undefined);
    setStreamedCode('');
    setSelectedId(null); // 清空选中，右侧展示流式窗口

    let sseConnected = false;

    try {
      const result = await generateGame(sessionId, spec, refineId);

      // 接入流（SSE 优先，自动降级轮询）
      await streamGameTask(
        result.task_id,
        {
          onStage(stage, progress, message) {
            setGenStage(stage);
            setGenProgress(progress);
            setGenStageMsg(message);
          },
          onChunk(_chunk, progress, accumulated) {
            if (!sseConnected) { sseConnected = true; setIsLiveStream(true); }
            setStreamedCode(accumulated);
            setGenProgress(progress);
            setGenStage('generating');
          },
          onDone(gameId, _version) {
            // 先展示 100% 进度，延迟 300ms 后刷新列表再切到预览
            setGenProgress(100);
            setGenStageMsg('生成完成！');
            setTimeout(async () => {
              try {
                setRefreshingList(true);
                const list = await listSessionGames(sessionId);
                setGames(list);
                // 如果返回的 gameId 在列表中存在，选中它；否则选第一个
                const target = list.find(g => g.game_id === gameId) ? gameId : list[0]?.game_id ?? null;
                setSelectedId(target);
                setPreviewTab('preview');
                setSourceCode(null);
              } catch (err) {
                console.error('[GamePanel] Failed to refresh list after generation:', err);
                // 即使刷新失败，也要清空 generating
              } finally {
                setGenerating(false);
                setStreamedCode('');
                setIsLiveStream(false);
                setRefreshingList(false);
              }
            }, 300); // 让用户先看到 100% 进度
          },
          onError(message) {
            setGenerating(false);
            setGenError(message);
            setStreamedCode('');
            setIsLiveStream(false);
          },
        },
        controller.signal,
      );
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        setGenerating(false);
        setGenError(e?.message ?? '发起生成失败，请重试');
      }
    }
  }, [sessionId]);

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
    try {
      const d = await getGameSource(gameId);
      // API 返回结构: { html_content } 或 { content } 或 { html_code }
      setSourceCode(d.html_content ?? d.content ?? d.html_code ?? '// 源码为空');
    }
    catch { setSourceCode('// 源码加载失败'); }
    finally { setSourceLoading(false); }
  }, []);

  // ── 选中游戏 / Tab 切换时加载内容 ────────────────────────────────────
  useEffect(() => {
    if (!selectedId) return;
    if (previewTab === 'preview') {
      setPreviewHtml(null);
      setPreviewError(null);
      setPreviewLoading(true);
      fetchGameHtml(selectedId)
        .then(html => setPreviewHtml(html))
        .catch(err => setPreviewError(err?.message ?? '预览加载失败'))
        .finally(() => setPreviewLoading(false));
    } else if (previewTab === 'source' && !sourceCode) {
      loadSource(selectedId);
    }
  }, [selectedId, previewTab]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCopy = () => {
    if (!sourceCode) return;
    navigator.clipboard.writeText(sourceCode).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    });
  };

  const selectedGame = games.find(g => g.game_id === selectedId);

  // ─────────────────────────────────────────────────────────────
  // 渲染
  // ─────────────────────────────────────────────────────────────
  return (
    <div className={clsx(styles.root, isFullscreen && styles.rootFullscreen)}>

      {/* ─── 左栏 ─── */}
      <div className={clsx(styles.sidebar, !sidebarOpen && styles.sidebarCollapsed)}>
        <button
          className={styles.collapseBtn}
          onClick={() => setSidebarOpen(v => !v)}
          title={sidebarOpen ? '折叠侧边栏' : '展开侧边栏'}
        >
          {sidebarOpen ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
        </button>

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

            {/* AI 触发横幅 */}
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
              <button className={styles.refreshBtn} onClick={() => fetchGames()} disabled={loadingList} title="刷新列表">
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
              <div className={styles.listLoading}><Loader2 size={18} className={styles.spin} /></div>
            ) : games.length === 0 && !generating ? (
              <div className={styles.emptyList}>
                <Gamepad2 size={26} className={styles.emptyIcon} />
                <p>暂无游戏</p>
                <small>告诉 AI 你想生成什么游戏，或点击「手动创建」</small>
              </div>
            ) : (
              <div className={styles.gameList}>
                {/* 生成中骨架卡 */}
                {generating && (
                  <div className={clsx(styles.gameItem, styles.gameItemGenerating)}>
                    <div className={styles.generatingPulse} />
                    <div className={styles.gameItemMain}>
                      <span className={styles.gameItemTitle}>
                        {isLiveStream ? '⚡ 实时生成中...' : '⏳ 生成中...'}
                      </span>
                      <span className={styles.gameItemMeta}>
                        {STAGE_LABELS[genStage] ?? '处理中'} · {genProgress}%
                        {streamedCode && ` · ${streamedCode.length.toLocaleString()} 字符`}
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
                        disabled={deletingIds.has(g.game_id)} title="删除"
                      >
                        {deletingIds.has(g.game_id) ? <Loader2 size={11} className={styles.spin} /> : <Trash2 size={11} />}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* ─── 右栏：预览 ─── */}
      <div className={styles.preview}>
        {generating ? (
          /* 实时流式代码窗口 */
          <StreamingCodeWindow
            stage={genStage}
            progress={genProgress}
            stageMessage={genStageMsg}
            code={streamedCode}
            isStreaming={isLiveStream}
          />
        ) : refreshingList ? (
          /* 生成完成，正在拉取列表的过渡态 */
          <div className={styles.previewEmpty}>
            <Loader2 size={36} className={clsx(styles.spin, styles.emptyIcon)} />
            <p>正在加载游戏...</p>
            <small>马上就好，游戏即将可以运行</small>
          </div>
        ) : !selectedId ? (
          <div className={styles.previewEmpty}>
            <Gamepad2 size={40} className={styles.emptyIcon} />
            <p>选择左侧游戏进行预览</p>
            <small>游戏以完全自含 HTML 形式运行，无网络请求</small>
          </div>
        ) : (
          <>
            {/* 预览工具栏 */}
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
                {selectedGame && <span className={styles.previewVersion}>v{selectedGame.version}</span>}
              </div>

              <div className={styles.previewActions}>
                {previewTab === 'source' && (
                  <button className={styles.iconActionBtn} onClick={handleCopy} disabled={!sourceCode} title="复制代码">
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                )}
                <button
                  className={styles.iconActionBtn}
                  onClick={() => setSidebarOpen(v => !v)}
                  title={sidebarOpen ? '隐藏侧边栏，专注游戏' : '显示侧边栏'}
                >
                  {sidebarOpen ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={14} />}
                </button>
                <button
                  className={styles.iconActionBtn}
                  onClick={() => setIsFullscreen(v => !v)}
                  title={isFullscreen ? '退出全屏 (Esc)' : '全屏预览'}
                >
                  {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                </button>
              </div>
            </div>

            {/* 内容区 */}
            {previewTab === 'preview' ? (
              <div className={styles.iframeWrap}>
                {previewLoading && (
                  <div className={styles.previewLoadingOverlay}>
                    <Loader2 size={24} className={styles.spin} />
                    <span>加载预览中...</span>
                  </div>
                )}
                {previewError && !previewLoading && (
                  <div className={styles.previewErrorOverlay}>
                    <AlertCircle size={20} />
                    <p>{previewError}</p>
                    <button
                      className={styles.retryBtn}
                      onClick={() => {
                        if (!selectedId) return;
                        setPreviewError(null);
                        setPreviewLoading(true);
                        fetchGameHtml(selectedId)
                          .then(setPreviewHtml)
                          .catch(e => setPreviewError(e?.message ?? '加载失败'))
                          .finally(() => setPreviewLoading(false));
                      }}
                    >
                      <RefreshCw size={12} /> 重试
                    </button>
                    <a
                      href={gameShareUrl(selectedId!)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.retryBtn}
                      style={{ marginLeft: 6 }}
                    >
                      在新标签页打开
                    </a>
                  </div>
                )}
                {previewHtml && !previewLoading && !previewError && (
                  <iframe
                    key={selectedId}
                    srcDoc={previewHtml}
                    sandbox="allow-scripts allow-same-origin allow-forms"
                    className={styles.iframe}
                    title={selectedGame?.title ?? '游戏预览'}
                  />
                )}
              </div>
            ) : (
              <div className={styles.sourceWrap}>
                {sourceLoading ? (
                  <div className={styles.sourceLoading}>
                    <Loader2 size={22} className={styles.spin} /><span>加载源码...</span>
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
