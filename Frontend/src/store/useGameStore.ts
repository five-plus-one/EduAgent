/**
 * useGameStore — 全局互动游戏生成状态
 *
 * 为什么要提升到全局：
 *   - 用户切换页面（Tab、会话）时，GamePanel 会 unmount
 *   - 原先 AbortController 在 unmount effect 里调 abort()，直接杀死流
 *   - 生成状态（streamedCode、stage、progress）也随组件销毁
 *
 * 现在：
 *   - 流在 store 内持续运行，不受组件生命周期影响
 *   - GamePanel 只消费 store，挂载即可继续看到当前进度
 *   - 切换其他游戏/页面 → 回来后仍显示实时/完成状态
 */
import { create } from 'zustand';
import {
  generateGame, streamGameTask, listSessionGames,
  type GameMeta, type GameSpec,
} from '../utils/gamesApi';

export interface GameGenState {
  /** 当前正在生成的 sessionId（null = 无任务） */
  generatingSessionId: string | null;
  /** 当前正在修改的游戏ID（如果是全新生成则为null） */
  generatingRefineId: string | null;
  generating: boolean;
  genStage: string;
  genProgress: number;
  genStageMsg: string | undefined;
  streamedCode: string;
  isLiveStream: boolean;
  genError: string | null;
  refreshingList: boolean;
  /** 生成完成后选中的 gameId */
  completedGameId: string | null;

  /** 每个 session 的游戏列表（key=sessionId） */
  gameLists: Record<string, GameMeta[]>;

  /** 内部 abort controller，不暴露给组件 */
  _abortController: AbortController | null;
}

export interface GameGenActions {
  /** 触发生成 */
  triggerGenerate: (sessionId: string, spec: GameSpec, refineId?: string | null) => Promise<void>;
  /** 强制中止当前流（用户主动取消） */
  abortGenerate: () => void;
  /** 手动刷新某 session 的游戏列表 */
  refreshGames: (sessionId: string) => Promise<void>;
  /** 更新某 session 的游戏列表（外部设置，如刷新后） */
  setGameList: (sessionId: string, list: GameMeta[]) => void;
  /** 清除生成完成标记（组件读取后清除，避免重复 select） */
  clearCompletedGameId: () => void;
  /** 重置错误 */
  clearGenError: () => void;
}

type GameStore = GameGenState & GameGenActions;

export const useGameStore = create<GameStore>((set, get) => ({
  // ── 初始状态 ────────────────────────────────────────────────
  generatingSessionId: null,
  generatingRefineId: null,
  generating: false,
  genStage: 'pending',
  genProgress: 0,
  genStageMsg: undefined,
  streamedCode: '',
  isLiveStream: false,
  genError: null,
  refreshingList: false,
  completedGameId: null,
  gameLists: {},
  _abortController: null,

  // ── Actions ─────────────────────────────────────────────────
  abortGenerate: () => {
    get()._abortController?.abort();
    set({ _abortController: null });
  },

  clearCompletedGameId: () => set({ completedGameId: null }),
  clearGenError: () => set({ genError: null }),

  setGameList: (sessionId, list) =>
    set(s => ({ gameLists: { ...s.gameLists, [sessionId]: list } })),

  refreshGames: async (sessionId) => {
    try {
      const list = await listSessionGames(sessionId);
      set(s => ({ gameLists: { ...s.gameLists, [sessionId]: list } }));
    } catch { /* non-critical */ }
  },

  triggerGenerate: async (sessionId, spec, refineId) => {
    if (sessionId === 'new') return;

    // 中止上次流（如果有）
    get()._abortController?.abort();
    const controller = new AbortController();

    // 重置生成状态
    set({
      generating: true,
      generatingSessionId: sessionId,
      generatingRefineId: refineId ?? null,
      genError: null,
      genStage: 'pending',
      genProgress: 0,
      genStageMsg: undefined,
      streamedCode: '',
      isLiveStream: false,
      completedGameId: null,
      _abortController: controller,
    });

    let sseConnected = false;

    try {
      const result = await generateGame(sessionId, spec, refineId ?? null);

      await streamGameTask(
        result.task_id,
        {
          onStage(stage, progress, message) {
            set({ genStage: stage, genProgress: progress, genStageMsg: message });
          },
          onChunk(_chunk, progress, accumulated) {
            if (!sseConnected) { sseConnected = true; set({ isLiveStream: true }); }
            set({ streamedCode: accumulated, genProgress: progress, genStage: 'generating' });
          },
          async onDone(gameId) {
            set({ genProgress: 100, genStageMsg: '生成完成！' });
            await new Promise(r => setTimeout(r, 300));
            try {
              set({ refreshingList: true });
              const list = await listSessionGames(sessionId);
              const target = list.find(g => g.game_id === gameId) ? gameId : list[0]?.game_id ?? null;
              set(s => ({
                gameLists: { ...s.gameLists, [sessionId]: list },
                completedGameId: target,
                generating: false,
                streamedCode: '',
                isLiveStream: false,
                generatingSessionId: null,
                generatingRefineId: null,
              }));
            } catch {
              set({ generating: false, streamedCode: '', generatingSessionId: null, generatingRefineId: null });
            } finally {
              set({ refreshingList: false, _abortController: null });
            }
          },
          onError(message) {
            set({ generating: false, genError: message, streamedCode: '', isLiveStream: false, generatingSessionId: null, generatingRefineId: null, _abortController: null });
          },
        },
        controller.signal,
      );
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        set({ generating: false, genError: e?.message ?? '发起生成失败，请重试', _abortController: null });
      }
      // AbortError = 用户主动取消，不显示错误
    }
  },
}));
