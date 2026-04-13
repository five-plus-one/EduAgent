/**
 * 互动小游戏 API — 完整类型定义与工具函数
 * 后端路由前缀: /api/v1
 */
import { apiClient } from './api';

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export interface GameType {
  key: string;
  label: string;
  hint: string;
}

export interface GameSpec {
  game_type: string;
  title: string;
  key_topics: string[];
  custom_requirements?: string;
  is_refinement: boolean;
  refinement_instruction?: string;
}

export interface GameTask {
  task_id: string;
  status: 'generating' | 'completed' | 'failed';
  stage: string;
  progress: number;
  result?: {
    game_id: string;
    html_file: string;
    version: number;
    error?: string;
  };
}

export interface GameMeta {
  game_id: string;
  title: string;
  game_type: string;
  type_label: string;
  status: 'completed' | 'generating' | 'failed';
  version: number;
  created_at: string;
  updated_at: string;
}

export interface GameSource {
  game_id: string;
  title: string;
  game_type: string;
  version: number;
  html_code: string;
  char_count: number;
}

export interface GameGenerateResult {
  task_id: string;
  game_id: string;
  status: string;
  is_refinement: boolean;
}

// SSE 事件类型
export interface GameSuggestData {
  suggestions: Array<{ type: string; reason: string }>;
  pending_question: string;
  all_types: Array<{ key: string; label: string }>;
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function getToken(): string {
  return localStorage.getItem('access_token') ?? '';
}

function getBaseOrigin(): string {
  // Strip /api/v1/... suffix from API_BASE_URL to get the root origin
  const base = (import.meta as any).env?.VITE_API_BASE_URL ?? '';
  return base.replace(/\/api\/v\d+.*$/, '');
}

// ─────────────────────────────────────────────────────────────────
// API Functions
// ─────────────────────────────────────────────────────────────────

/** 1. 获取所有游戏类型列表 */
export async function getGameTypes(): Promise<GameType[]> {
  const res = await apiClient.get('/games/types');
  const data = res.data?.data ?? res.data;
  return data.types ?? data ?? [];
}

/** 2. 触发游戏生成（新建或精炼） */
export async function generateGame(
  sessionId: string,
  spec: GameSpec,
  refineGameId?: string | null,
): Promise<GameGenerateResult> {
  const res = await apiClient.post(`/sessions/${sessionId}/games/generate`, {
    spec,
    refine_game_id: refineGameId ?? null,
  });
  return res.data?.data ?? res.data;
}

/** 3. 轮询生成任务进度（单次） */
export async function getGameTask(taskId: string): Promise<GameTask> {
  const res = await apiClient.get(`/games/tasks/${taskId}`);
  return res.data?.data ?? res.data;
}

/**
 * 3b. 等待任务完成（轮询封装）
 * @returns game_id when completed
 * @throws Error with message on failure
 */
export async function waitForGame(taskId: string, intervalMs = 2000): Promise<string> {
  while (true) {
    const task = await getGameTask(taskId);
    if (task.status === 'completed') {
      return task.result!.game_id;
    }
    if (task.status === 'failed') {
      throw new Error(task.result?.error ?? '游戏生成失败，请重试');
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
}

/** 4. 列出 session 下所有游戏 */
export async function listSessionGames(sessionId: string): Promise<GameMeta[]> {
  const res = await apiClient.get(`/sessions/${sessionId}/games`);
  const data = res.data?.data ?? res.data;
  return data.games ?? data ?? [];
}

/**
 * 5. 游戏 HTML 预览 URL（用于 <iframe src="...">）
 * 必须附加 ?token= 因为 iframe 无法设置 Authorization header
 */
export function gamePreviewUrl(gameId: string): string {
  const token = getToken();
  const origin = getBaseOrigin();
  const base = origin ? `${origin}/api/v1` : '/api/v1';
  return `${base}/games/${gameId}/preview${token ? `?token=${encodeURIComponent(token)}` : ''}`;
}

/** 6. 获取游戏 HTML 源码 */
export async function getGameSource(gameId: string): Promise<GameSource> {
  const res = await apiClient.get(`/games/${gameId}/source`);
  return res.data?.data ?? res.data;
}

/** 7. 删除游戏 */
export async function deleteGame(gameId: string): Promise<void> {
  await apiClient.delete(`/games/${gameId}`);
}

// ─────────────────────────────────────────────────────────────────
// SSE Event Helpers
// ─────────────────────────────────────────────────────────────────

/**
 * 解析 SSE 聊天流中的游戏事件
 * 在 streamManager 的 onMessage 回调中调用
 */
export function parseGameEvent(
  eventType: string | undefined,
  eventData: any,
  callbacks: {
    onSuggest?: (data: GameSuggestData) => void;
    onTrigger?: (spec: GameSpec) => void;
  },
): boolean {
  if (eventType === 'game_suggest' && eventData?.game_suggest) {
    callbacks.onSuggest?.(eventData.game_suggest as GameSuggestData);
    return true;
  }
  if (eventType === 'game_trigger' && eventData?.game_trigger) {
    callbacks.onTrigger?.(eventData.game_trigger as GameSpec);
    return true;
  }
  // 终止报文中携带 game_spec 时也触发 onTrigger
  if (eventData?.is_finished && eventData?.game_spec) {
    callbacks.onTrigger?.(eventData.game_spec as GameSpec);
    return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────
// Static game type fallback (used before API returns)
// ─────────────────────────────────────────────────────────────────
export const GAME_TYPE_DEFAULTS: GameType[] = [
  { key: 'quiz',      label: '🎯 选择题闯关',   hint: '10道四选一选择题，每题30秒倒计时' },
  { key: 'memory',    label: '🃏 记忆配对翻牌', hint: '8对概念-解释配对翻牌，翻牌动画' },
  { key: 'fillblank', label: '✍️ 填空挑战',     hint: '10道填空题，输入框，即时批改' },
  { key: 'sort',      label: '📊 拖拽排序',     hint: '6~8个步骤/事件，拖拽到正确顺序' },
  { key: 'match',     label: '🔗 拖拽连线',     hint: '左列概念→右列定义，点击连线' },
  { key: 'flashcard', label: '⚡ 快问快答',     hint: '单面问题→翻转→背面答案，循环15张' },
  { key: 'custom',    label: '🎨 自定义游戏',   hint: '完全按照教师要求实现' },
];
