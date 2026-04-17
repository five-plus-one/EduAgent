/**
 * GamePanel v3 鈥?浜掑姩灏忔父鎴忛潰鏉匡紙娴佸紡鐢熸垚鐗堬級
 *
 * 鏍稿績鍗囩骇锛?
 * - 鐪熷疄 HTML 浠ｇ爜娴佸紡娓叉煋锛圫SE 鈫?fetchEventSource 鈫?鑷姩闄嶇骇杞锛?
 * - StreamingCodeWindow锛氬疄鏃跺睍绀?LLM 杈撳嚭鐨?HTML token
 * - AbortController锛氱粍浠跺嵏杞芥椂瀹夊叏涓柇娴?
 * - 渚ц竟鏍忔姌鍙?/ 鍏ㄥ睆妯″紡
 * - Agent 宸ュ叿璋冪敤鍚庤嚜鍔ㄥ埛鏂板垪行
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { clsx } from 'clsx';
import {
  Gamepad2, Loader2, Trash2, Code2, Eye, RefreshCw,
  ChevronRight, Sparkles, CheckCircle, AlertCircle, Copy, Check,
  X, Zap, PanelLeftClose, PanelLeftOpen, Maximize2, Minimize2, Share2, ExternalLink, Brain,
} from 'lucide-react';
import {
  listSessionGames, getGameSource,
  deleteGame, renameGame, fetchGameHtml, createShareLink, gameShareUrl,
  GAME_TYPE_DEFAULTS,
  type GameMeta, type GameSpec, type GameSuggestData,
} from '../utils/gamesApi';
import { useGameStore } from '../store/useGameStore';
import styles from './GamePanel.module.css';

// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
// Types & Constants
// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
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
  pending: '等待开始',
  preparing: '准备素材',
  generating: 'AI 生成中',
  writing: '写入文件',
};

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('zh-CN', {
      month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
// Sub: 游戏类型鍗?
// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
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

// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
// Sub: 鐪熷疄娴佸紡浠ｇ爜绐楀彛
// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
interface StreamingCodeWindowProps {
  stage: string;
  progress: number;
  stageMessage?: string;
  code: string;         // 瀹炴椂绱Н鐨?HTML 浠ｇ爜
  thinking?: string;    // 娣卞害鎬濊€冭褰?
  isStreaming: boolean; // true = SSE 涓紝false = 杞闄嶇骇
}

function StreamingCodeWindow({ stage, progress, stageMessage, code, thinking, isStreaming }: StreamingCodeWindowProps) {
  const codeBodyRef = useRef<HTMLDivElement>(null);
  const thinkingBodyRef = useRef<HTMLDivElement>(null);
  const stageIdx = STAGES.indexOf(stage);
  const pct = Math.max(0, Math.min(100, progress));

  // 鑷姩婊氬姩鍒颁唬鐮佸簳閮?
  useEffect(() => {
    const el = codeBodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [code]);

  // 鑷姩婊氬姩娣卞害鎬濊€冪殑搴曢儴
  useEffect(() => {
    const el = thinkingBodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thinking]);

  const lines = code ? code.split('\n') : [];

  return (
    <div className={styles.typingWrap}>
      {/* 闃舵姝ラ */}
      <div className={styles.stageRow}>
        {STAGES.map((s, i) => (
          <div key={s} className={clsx(styles.stageStep, i <= stageIdx && styles.stageStepDone)}>
            <div className={styles.stageStepDot} />
            <span className={styles.stageStepLabel}>{STAGE_LABELS[s]}</span>
          </div>
        ))}
      </div>

      {/* 杩涘害鏉?*/}
      <div className={styles.progressBarWrap}>
        <div className={styles.progressBar} style={{ width: `${pct}%` }} />
        <span className={styles.progressPct}>{pct}%</span>
      </div>

      {/* 娣卞害鎬濊€冩 */}
      {thinking && (
        <div className={styles.thinkingBox} ref={thinkingBodyRef}>
          <div className={styles.thinkingHeader}>
            <Brain size={12} /> {STAGE_LABELS[stage] ?? '处理中'} 阶段思考中...
          </div>
          <div className={styles.thinkingText}>{thinking}</div>
        </div>
      )}

      {/* 浠ｇ爜绐楀彛 */}
      <div className={styles.codeWindow}>
        <div className={styles.codeWindowBar}>
          <span className={styles.codeDot} style={{ background: '#ff5f57' }} />
          <span className={styles.codeDot} style={{ background: '#febc2e' }} />
          <span className={styles.codeDot} style={{ background: '#28c840' }} />
          <span className={styles.codeWindowTitle}>
            game.html
            {isStreaming
              ? <span className={styles.streamingBadge}>LIVE</span>
              : <span className={styles.pollingBadge}>轮询</span>}
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
          {/* 鏈€鍚庝竴琛岀殑鍏夋爣 */}
          {lines.length > 0 && (
            <div className={styles.codeLine}>
              <span className={styles.codeLineNum}></span>
              <span className={styles.codeLineContent}>
                <span className={styles.cursor}>|</span>
              </span>
            </div>
          )}
        </div>

        {/* 浠ｇ爜瀛楃鏁扮粺璁?*/}
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

// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
// Main: GamePanel
// 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
export default function GamePanel({
  sessionId, pendingSuggest, pendingTrigger,
  onClearSuggest, onClearTrigger, onActiveGameChange,
}: GamePanelProps) {

  // 鈹€鈹€ 甯冨眬 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // 鈹€鈹€ 鍏ㄥ眬娓告垙鐢熸垚鐘舵€侊紙浠?store 璇伙級 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
  const {
    gameLists, generating, generatingSessionId, generatingRefineId, genStage, genProgress, genStageMsg,
    streamedCode, genThinking, isLiveStream, genError, refreshingList, completedGameId,
    triggerGenerate: storeTrigger, resumeGenerate, setGameList, refreshGames, clearCompletedGameId, clearGenError,
    renameGameInStore,
  } = useGameStore();

  const isCurrentGenerating = generating && generatingSessionId === sessionId;
  const games: GameMeta[] = gameLists[sessionId] ?? [];

  // 鈹€鈹€ 鏈湴 UI 鐘舵€?鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
  const [loadingList, setLoadingList]     = useState(false);
  const [deletingIds, setDeletingIds]     = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId]       = useState<string | null>(null);
  const [previewTab, setPreviewTab]       = useState<'preview' | 'source'>('preview');
  
  const [previewHtml, setPreviewHtml]     = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError]   = useState<string | null>(null);
  // ref 杩借釜銆屽綋鍓嶅凡涓哄摢涓?gameId 鍙戣捣/瀹屾垚浜?preview 璇锋眰銆嶏紝閬垮厤閲嶅 fetch
  const previewLoadedForRef = useRef<string | null>(null);
  const [sourceLoading, setSourceLoading]   = useState(false);
  const [sourceCode, setSourceCode]         = useState<string | null>(null);
  
  const [copied, setCopied]                 = useState(false);
  const [shareCopied, setShareCopied]       = useState(false);
  const [sharingLoading, setSharingLoading] = useState(false);
  const [shareError, setShareError]         = useState<string | null>(null);
  
  const [showManualPanel, setShowManualPanel] = useState(false);
  const [manualType, setManualType]           = useState(GAME_TYPE_DEFAULTS[0].key);
  const [manualTitle, setManualTitle]         = useState('');
  const [manualTopics, setManualTopics]       = useState('');
  const [manualRequirements, setManualRequirements] = useState('');

  // 閲嶅懡鍚嶇姸鎬?
  const [renamingId,  setRenamingId]  = useState<string | null>(null);
  const [renameVal,   setRenameVal]   = useState('');
  const [, setRenameSaving] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // 鈹€鈹€ 閫氱煡鐖剁粍浠?鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
  useEffect(() => { onActiveGameChange(selectedId === 'generating' ? null : selectedId); }, [selectedId, onActiveGameChange]);

  // 鈹€鈹€ 鐢熸垚瀹屾垚鍚庤嚜鍔ㄩ€変腑鏂版父鎴?鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
  useEffect(() => {
    if (completedGameId && generatingSessionId === sessionId) {
      // 鏍囪宸蹭负璇?gameId 鍙戣捣璇锋眰锛岄厤鍚?Effect B 鐨勫幓閲嶉€昏緫
      setPreviewHtml(null);
      setPreviewLoading(true);
      setPreviewError(null);
      (async () => {
        try {
          let html = await fetchGameHtml(completedGameId);
          if (!html || !html.trim()) {
            await new Promise(r => setTimeout(r, 800));
            html = await fetchGameHtml(completedGameId);
          }
          if (!html || !html.trim()) throw new Error('Preview HTML is empty');
          previewLoadedForRef.current = completedGameId;
          setPreviewHtml(html);
        } catch (err: any) {
          previewLoadedForRef.current = null;
          setPreviewHtml(null);
          setPreviewError(err?.message ?? 'Preview load failed');
        } finally {
          setPreviewLoading(false);
        }
      })();

      setSelectedId(completedGameId);
      setPreviewTab('preview');
      setSourceCode(null);
      clearCompletedGameId();
    }
  }, [completedGameId, generatingSessionId, sessionId, clearCompletedGameId]);

  // 褰撳洖鍒扮粍浠舵椂锛屽鏋滄鍦ㄧ敓鎴愪笖娌℃湁閫変腑椤癸紝鑷姩閫変腑 generating
  useEffect(() => {
    if (isCurrentGenerating && !selectedId) {
      setSelectedId('generating');
    }
  }, [isCurrentGenerating, selectedId]);

  // 鑷姩閲嶈繛鍚庡彴鐢熸垚娴侊細濡傛灉鐐瑰嚮浜嗘鍦ㄧ敓鎴愪絾鏈湪褰撳墠娴佷腑杩愯鐨勫崱鐗囷紝鑷姩鍙戝嚭鎭㈠娴佽姹?
  useEffect(() => {
    if (!selectedId || selectedId === 'generating') return;
    const g = games.find(x => x.game_id === selectedId);
    if (g?.status === 'generating') {
      if (!isCurrentGenerating || generatingRefineId !== selectedId) {
        resumeGenerate(sessionId, selectedId);
      }
    }
  }, [selectedId, games, isCurrentGenerating, generatingRefineId, sessionId, resumeGenerate]);

  // 鈹€鈹€ 鎷夊彇娓告垙鍒楄〃 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
  const fetchGames = useCallback(async (silent = false) => {
    if (!silent) setLoadingList(true);
    try {
      const list = await listSessionGames(sessionId);
      setGameList(sessionId, list);
    } catch { /* non-critical */ }
    finally { setLoadingList(false); }
  }, [sessionId, setGameList]);

  useEffect(() => {
    if (sessionId && sessionId !== 'new' && !gameLists[sessionId]) {
      fetchGames();
    }
  }, [sessionId, fetchGames, gameLists]);

  // 鈹€鈹€ Agent 宸ュ叿璋冪敤鍚庤嚜鍔ㄥ埛鏂?鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
  useEffect(() => {
    const handler = (e: Event) => {
      const ev = e as CustomEvent;
      if (ev.detail?.sessionId === sessionId) {
        setTimeout(() => refreshGames(sessionId), 800);
      }
    };
    window.addEventListener('EduAgent_Generate_End', handler);
    return () => window.removeEventListener('EduAgent_Generate_End', handler);
  }, [sessionId, refreshGames]);

  // 鈹€鈹€ ESC 閫€鍑哄叏灞?鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreen) setIsFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isFullscreen]);

  // 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
  // 瑙﹀彂鐢熸垚
  // 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
  const triggerGenerate = useCallback((spec: GameSpec, refineId?: string | null) => {
    storeTrigger(sessionId, spec, refineId);
    setSelectedId('generating');
  }, [sessionId, storeTrigger]);

  const handleConfirmTrigger = useCallback(() => {
    if (!pendingTrigger) return;
    if (pendingTrigger.task_id) {
      // 鍚庣 game_trigger 浜嬩欢鎼哄甫浜?task_id锛氬悗绔凡缁忓湪鐢熸垚浜?
      // 鐩存帴鎺ョ娴佺洃鍚繘搴︼紝涓嶉噸鏂拌皟 generateGame锛堥伩鍏嶉噸澶嶇敓鎴愶級
      const refineId = pendingTrigger.is_refinement
        ? (pendingTrigger.game_id ?? selectedId)
        : null;
      // 閲嶇疆 UI 鐘舵€?
      setSelectedId('generating');
      resumeGenerate(sessionId, refineId, pendingTrigger.task_id);
    } else {
      // 手动创建 / 鏃?task_id锛氬墠绔彂璧风敓鎴愯姹?
      triggerGenerate(pendingTrigger, pendingTrigger.is_refinement ? selectedId : null);
    }
    onClearTrigger();
    onClearSuggest();
  }, [pendingTrigger, selectedId, triggerGenerate, resumeGenerate, sessionId, onClearTrigger, onClearSuggest]);

  useEffect(() => {
    if (!pendingTrigger?.task_id || generating) return;
    handleConfirmTrigger();
  }, [pendingTrigger, generating, handleConfirmTrigger]);

  const handleManualGenerate = () => {
    const spec: GameSpec = {
      game_type: manualType,
      title: manualTitle || (GAME_TYPE_DEFAULTS.find(t => t.key === manualType)?.label ?? '互动游戏'),
      key_topics: manualTopics.split(/[锛?銆乗n]/).map(s => s.trim()).filter(Boolean),
      custom_requirements: manualRequirements,
      is_refinement: false,
    };
    triggerGenerate(spec, null);
    setShowManualPanel(false);
  };

  // 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
  // 閲嶅懡鍚?
  // 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
  const startRename = (gameId: string, currentTitle: string) => {
    setRenamingId(gameId);
    setRenameVal(currentTitle);
    setTimeout(() => renameInputRef.current?.select(), 30);
  };

  const commitRename = async () => {
    if (!renamingId) return;
    const trimmed = renameVal.trim();
    if (!trimmed) { setRenamingId(null); return; }
    const originalTitle = games.find(g => g.game_id === renamingId)?.title ?? trimmed;
    if (trimmed === originalTitle) { setRenamingId(null); return; }
    setRenameSaving(true);
    // 灞呰鍏堟洿鏂帮紝澶辫触鍐嶅洖婊?
    renameGameInStore(sessionId, renamingId, trimmed);
    setRenamingId(null);
    try {
      await renameGame(renamingId, trimmed);
    } catch {
      // 鍥炴粴
      renameGameInStore(sessionId, renamingId ?? '', originalTitle);
    } finally {
      setRenameSaving(false);
    }
  };

  // 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
  // 删除
  // 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
  const handleDelete = async (gameId: string) => {
    if (!confirm('确认删除该游戏？此操作不可撤销。')) return;
    setDeletingIds(prev => new Set(prev).add(gameId));
    try {
      await deleteGame(gameId);
      // 浠?store 鍚屾删除
      setGameList(sessionId, games.filter(g => g.game_id !== gameId));
      if (selectedId === gameId) { setSelectedId(null); setSourceCode(null); }
    } catch { alert('删除失败，请重试'); }
    finally {
      setDeletingIds(prev => { const n = new Set(prev); n.delete(gameId); return n; });
    }
  };

  // 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
  // 婧愮爜鍔犺浇
  // 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
  const loadSource = useCallback(async (gameId: string) => {
    setSourceLoading(true); setSourceCode(null);
    try {
      const d = await getGameSource(gameId);
      // API 杩斿洖缁撴瀯: { html_content } 鎴?{ content } 鎴?{ html_code }
      setSourceCode(d.html_content ?? d.content ?? d.html_code ?? '// 源码为空');
    }
    catch { setSourceCode('// 源码加载失败'); }
    finally { setSourceLoading(false); }
  }, []);

  const loadPreviewHtml = useCallback(async (gameId: string, retry = false) => {
    setPreviewError(null);
    setPreviewLoading(true);
    try {
      const html = await fetchGameHtml(gameId);
      if (!html || !html.trim()) throw new Error('Preview HTML is empty');
      previewLoadedForRef.current = gameId;
      setPreviewHtml(html);
    } catch (err: any) {
      if (retry) {
        try {
          await new Promise(r => setTimeout(r, 800));
          const html = await fetchGameHtml(gameId);
          if (!html || !html.trim()) throw new Error('Preview HTML is empty');
          previewLoadedForRef.current = gameId;
          setPreviewHtml(html);
          setPreviewError(null);
          return;
        } catch (retryErr: any) {
          previewLoadedForRef.current = null;
          setPreviewHtml(null);
          setPreviewError(retryErr?.message ?? 'Preview load failed');
          return;
        }
      }
      previewLoadedForRef.current = null;
      setPreviewHtml(null);
      setPreviewError(err?.message ?? 'Preview load failed');
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  // 鈹€鈹€ 閫変腑娓告垙 / Tab 鍒囨崲鏃跺姞杞藉唴瀹?鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
  useEffect(() => {
    if (!selectedId || selectedId === 'generating') return;
    if (previewTab === 'preview') {
      // 宸茬粡鍦ㄧ骇婕忎负璇?gameId锛堢敓鎴愬畬鎴愭椂鎻愬墠鎷夊彇鎴栧凡缂撳瓨锛夛紝璺宠繃
      if (previewLoadedForRef.current === selectedId && previewHtml) return;
      setPreviewHtml(null);
      loadPreviewHtml(selectedId, true);
    } else if (previewTab === 'source' && !sourceCode) {
      loadSource(selectedId);
    }
  }, [selectedId, previewTab, previewHtml, loadPreviewHtml, loadSource, sourceCode]);

  const handleCopy = () => {
    if (!sourceCode) return;
    navigator.clipboard.writeText(sourceCode).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    });
  };

  // 鈹€鈹€ 分享链接澶嶅埗 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
  const handleCopyShareLink = async () => {
    if (!effectiveGameId || sharingLoading) return;
    setSharingLoading(true);
    setShareError(null);

    let url: string;
    try {
      const link = await createShareLink(effectiveGameId);
      // full_short_url 濡傛灉甯﹀煙鍚嶇敤鍩熷悕锛涢兘涓嶅甫鍒欐嫾褰撳墠椤甸潰 origin
      url = link.full_short_url
        || `${window.location.origin}${link.short_url}`
        || `${window.location.origin}/play/${link.code}`;
    } catch {
      // 鍙湁 API 鐪熸澶辫触鎵嶆姤閿?
      setShareError('生成分享链接失败');
      setTimeout(() => setShareError(null), 3000);
      setSharingLoading(false);
      return;
    }

    // API 鎴愬姛锛屽皾璇曞啓鍏ュ壀璐存澘
    // iframe 鍗犳湁鐒︾偣鏃?clipboard API 浼氭姏 "Document is not focused"锛岀敤 execCommand 闄嶇骇
    let copied = false;
    try {
      await navigator.clipboard.writeText(url);
      copied = true;
    } catch {
      // 闄嶇骇锛氬垱寤轰复鏃?textarea锛屾ā鎷?Ctrl+C
      try {
        const ta = document.createElement('textarea');
        ta.value = url;
        ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        copied = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch { /* ignored */ }
    }

    if (copied) {
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2500);
    } else {
      // 涓ょ鏂规硶閮藉け璐ワ細鎻愮ず鐢ㄦ埛鎵嬪姩澶嶅埗锛圲RL 宸茶幏鍙栵紝涓嶆姤"澶辫触"锛?
      setShareError(`链接已生成，请手动复制：${url}`);
      setTimeout(() => setShareError(null), 8000);
    }

    setSharingLoading(false);
  };

  // previewLoadedForRef.current 鍦?selectedId 杩樻病鍒囨崲鏃朵篃鑳芥壘鍒版父鎴忓厓鏁版嵁
  const effectiveGameId = selectedId === 'generating' ? (previewLoadedForRef.current ?? null) : selectedId;
  const selectedGame = games.find(g => g.game_id === effectiveGameId);

  // 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
  // 娓叉煋
  // 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
  return (
    <div className={clsx(styles.root, isFullscreen && styles.rootFullscreen)}>

      {/* 鈹€鈹€鈹€ 宸︽爮 鈹€鈹€鈹€ */}
      <div className={clsx(styles.sidebar, !sidebarOpen && styles.sidebarCollapsed)}>
        <button
          className={styles.collapseBtn}
          onClick={() => setSidebarOpen(v => !v)}
          title={sidebarOpen ? '折叠侧栏' : '展开侧栏'}
        >
          {sidebarOpen ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
        </button>

        {sidebarOpen && (
          <>
            {/* AI 寤鸿妯箙 */}
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

            {/* AI 瑙﹀彂妯箙 */}
            {pendingTrigger && !pendingTrigger.task_id && (
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
                  {pendingTrigger.is_refinement ? '应用修改' : '生成游戏'}
                </button>
              </div>
            )}

            {/* 閿欒鎻愮ず */}
            {isCurrentGenerating && genError && (
              <div className={styles.errorBar}>
                <AlertCircle size={13} />
                <span>{genError}</span>
                <button className={styles.bannerClose} onClick={clearGenError}><X size={12} /></button>
              </div>
            )}

            {/* 鎿嶄綔鏍?*/}
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

            {/* 手动创建闈㈡澘 */}
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
                <input className={styles.manualInput} placeholder="知识点，使用逗号分隔"
                  value={manualTopics} onChange={e => setManualTopics(e.target.value)} />
                <textarea className={clsx(styles.manualInput, styles.manualTextarea)}
                  placeholder="自定义要求（可选）" rows={2}
                  value={manualRequirements} onChange={e => setManualRequirements(e.target.value)} />
                <button className={styles.confirmBtn} onClick={handleManualGenerate} disabled={isCurrentGenerating}>
                  <Gamepad2 size={13} /> 开始生成
                </button>
              </div>
            )}

            {/* 娓告垙鍒楄〃 */}
            {loadingList && games.length === 0 ? (
              <div className={styles.listLoading}><Loader2 size={18} className={styles.spin} /></div>
            ) : games.length === 0 && !isCurrentGenerating ? (
              <div className={styles.emptyList}>
                <Gamepad2 size={26} className={styles.emptyIcon} />
                <p>暂无游戏</p>
                <small>告诉 AI 你想生成什么游戏，或点击“手动创建”。</small>
              </div>
            ) : (
              <div className={styles.gameList}>
                {/* 鐙珛鐢熸垚涓鏋跺崱锛堜粎褰撳叏鏂扮敓鎴愭椂鏄剧ず锛?*/}
                {isCurrentGenerating && !generatingRefineId && (
                  <div
                    className={clsx(styles.gameItem, styles.gameItemGenerating, selectedId === 'generating' && styles.gameItemActive)}
                    onClick={() => setSelectedId('generating')}
                  >
                    <div className={styles.generatingPulse} />
                    <div className={styles.gameItemMain}>
                      <span className={styles.gameItemTitle}>
                        {isLiveStream ? '实时生成中...' : '生成中...'}
                      </span>
                      <span className={styles.gameItemMeta}>
                        {STAGE_LABELS[genStage] ?? '处理中'} · {genProgress}%
                        {streamedCode && ` · ${streamedCode.length.toLocaleString()} 字符`}
                      </span>
                    </div>
                    {/* 鍙充晶灏忕澶?*/}
                    <div className={styles.gameItemRight}>
                      {selectedId === 'generating' && <ChevronRight size={13} className={styles.chevron} />}
                      <Loader2 size={13} className={clsx(styles.spin, styles.statusGen)} />
                    </div>
                  </div>
                )}
                {games.map(g => {
                  const isRefiningThis = isCurrentGenerating && generatingRefineId === g.game_id;
                  const isActive = isRefiningThis ? selectedId === 'generating' : selectedId === g.game_id;

                  return (
                  <div
                    key={g.game_id}
                    className={clsx(styles.gameItem, isActive && styles.gameItemActive, isRefiningThis && styles.gameItemGenerating)}
                    onClick={() => { 
                      if (isRefiningThis) {
                        setSelectedId('generating');
                      } else {
                        setSelectedId(g.game_id); 
                        setSourceCode(null); 
                        setPreviewTab('preview'); 
                      }
                    }}
                  >
                    {isRefiningThis ? (
                      <>
                        <div className={styles.generatingPulse} />
                        <div className={styles.gameItemMain}>
                          <span className={styles.gameItemTitle}>
                            {isLiveStream ? '实时修改中...' : '修改中...'}
                          </span>
                          <span className={styles.gameItemMeta}>
                            {STAGE_LABELS[genStage] ?? '处理中'} · {genProgress}%
                            {streamedCode && ` · ${streamedCode.length.toLocaleString()} 字符`}
                          </span>
                        </div>
                        {/* 鍙充晶灏忕澶?*/}
                        <div className={styles.gameItemRight}>
                          {selectedId === 'generating' && <ChevronRight size={13} className={styles.chevron} />}
                          <Loader2 size={13} className={clsx(styles.spin, styles.statusGen)} />
                        </div>
                      </>
                    ) : (
                      <>
                        <div className={styles.gameItemMain}>
                          {renamingId === g.game_id ? (
                            <input
                              ref={renameInputRef}
                              className={styles.renameInput}
                              value={renameVal}
                              onClick={e => e.stopPropagation()}
                              onChange={e => setRenameVal(e.target.value)}
                              onBlur={commitRename}
                              onKeyDown={e => {
                                if (e.key === 'Enter') commitRename();
                                if (e.key === 'Escape') setRenamingId(null);
                                e.stopPropagation();
                              }}
                              autoFocus
                            />
                          ) : (
                            <span
                              className={styles.gameItemTitle}
                              onDoubleClick={e => { e.stopPropagation(); startRename(g.game_id, g.title); }}
                              title="双击重命名"
                            >{g.title}</span>
                          )}
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
                      </>
                    )}
                  </div>
                )})}
              </div>
            )}
          </>
        )}
      </div>

      {/* 鈹€鈹€鈹€ 鍙虫爮锛氶瑙?鈹€鈹€鈹€ */}
      <div className={styles.preview}>
        {(selectedId === 'generating' || selectedId === generatingRefineId) && isCurrentGenerating ? (
          /* 瀹炴椂娴佸紡浠ｇ爜绐楀彛 */
          <StreamingCodeWindow
            stage={genStage}
            progress={genProgress}
            stageMessage={genStageMsg}
            code={streamedCode}
            thinking={genThinking}
            isStreaming={isLiveStream}
          />
        ) : refreshingList && selectedId === 'generating' && !previewHtml ? (
          /* 鐢熸垚瀹屾垚锛屾鍦ㄦ媺鍙栧垪琛ㄧ殑杩囨浮鎬侊紙HTML杩樻湭灏辩华鏃舵墠鏄剧ず锛?*/
          <div className={styles.previewEmpty}>
            <Loader2 size={36} className={clsx(styles.spin, styles.emptyIcon)} />
            <p>正在加载游戏...</p>
            <small>马上就好，游戏即将可以运行</small>
          </div>
        ) : selectedGame?.status === 'generating' ? (
          /* 鏈畬鎴愭垨鍚庡彴鐢熸垚涓殑鎸傝捣鐘舵€?*/
          <div className={styles.previewEmpty}>
            <Loader2 size={36} className={clsx(styles.spin, styles.emptyIcon)} />
            <p>后台正在生成中...</p>
            <small>由于页面刷新等原因暂未连上实时进度，生成完成后即可预览</small>
          </div>
        ) : selectedId === 'generating' && (completedGameId || previewLoading) ? (
          /* 杩囨浮甯э細completedGameId 宸茶缃絾鏈湴 Effect 灏氭湭鍒囨崲 selectedId锛屾垨 HTML 姝ｅ湪鍔犺浇 */
          <div className={styles.previewEmpty}>
            <Loader2 size={36} className={clsx(styles.spin, styles.emptyIcon)} />
            <p>游戏生成完成，正在加载预览...</p>
            <small>马上就好</small>
          </div>
        ) : (!selectedId || selectedId === 'generating') ? (
          <div className={styles.previewEmpty}>
            <Gamepad2 size={40} className={styles.emptyIcon} />
            <p>选择左侧游戏进行预览</p>
            <small>游戏以完全自包含 HTML 形式运行，无网络请求</small>
          </div>
        ) : (
          <>
            {/* 棰勮宸ュ叿鏍?*/}
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
                {selectedGame && renamingId === selectedGame.game_id ? (
                  <input
                    ref={renameInputRef}
                    className={styles.previewTitleInput}
                    value={renameVal}
                    onChange={e => setRenameVal(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={e => {
                      if (e.key === 'Enter') commitRename();
                      if (e.key === 'Escape') setRenamingId(null);
                    }}
                    autoFocus
                  />
                ) : (
                  <span
                    className={styles.previewTitle}
                    title="点击重命名"
                    onClick={() => selectedGame && startRename(selectedGame.game_id, selectedGame.title)}
                  >{selectedGame?.title}</span>
                )}
                {selectedGame && <span className={styles.previewVersion}>v{selectedGame.version}</span>}
              </div>

              <div className={styles.previewActions}>
                {/* 鍒嗕韩閿欒鎻愮ず */}
                {shareError && (
                  <span className={styles.shareErrorTip}>{shareError}</span>
                )}
                {previewTab === 'source' && (
                  <button className={styles.iconActionBtn} onClick={handleCopy} disabled={!sourceCode} title="复制代码">
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                )}
                {/* 澶嶅埗分享链接 */}
                <button
                  className={clsx(styles.shareBtn, shareCopied && styles.shareBtnCopied)}
                  onClick={handleCopyShareLink}
                  disabled={sharingLoading || !effectiveGameId}
                  title="生成短链接并复制到剪贴板，可嵌入 PPT"
                >
                  {sharingLoading
                    ? <Loader2 size={13} className={styles.spin} />
                    : shareCopied
                      ? <><Check size={13} /> 已复制</>
                      : <><Share2 size={13} /> 分享链接</>
                  }
                </button>
                {/* 鏂版爣绛鹃〉鎵撳紑 */}
                <a
                  href={effectiveGameId ? gameShareUrl(effectiveGameId) : '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.iconActionBtn}
                  title="在新标签页打开"
                >
                  <ExternalLink size={14} />
                </a>
                <button
                  className={styles.iconActionBtn}
                  onClick={() => setSidebarOpen(v => !v)}
                  title={sidebarOpen ? '隐藏侧栏，专注预览' : '显示侧栏'}
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

            {/* 鍐呭鍖?*/}
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
                        if (!effectiveGameId) return;
                        loadPreviewHtml(effectiveGameId, true);
                      }}
                    >
                      <RefreshCw size={12} /> 重试
                    </button>
                    <a
                          href={gameShareUrl(effectiveGameId ?? '')}
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
                    key={effectiveGameId}
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


