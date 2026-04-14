/**
 * 互动小游戏 API — 完整类型定义与工具函数
 * 后端路由前缀: /api/v1
 */
import { fetchEventSource } from '@microsoft/fetch-event-source';
import { apiClient, API_BASE_URL } from './api';

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
 * 5a. 获取游戏 HTML 内容（用于 srcdoc 注入 iframe，规避跨域/X-Frame-Options）
 * 通过 axios 代理请求，携带 Authorization header，不暴露 token 到 URL
 */
export async function fetchGameHtml(gameId: string): Promise<string> {
  // 优先用 /preview 接口（返回完整 HTML 页面），降级用 /source
  try {
    const res = await apiClient.get(`/games/${gameId}/preview`, {
      responseType: 'text',
      headers: { Accept: 'text/html,application/xhtml+xml,*/*' },
    });
    // 如果返回的是 JSON（说明 preview 接口返回结构体），降级取 source
    const raw = typeof res.data === 'string' ? res.data : null;
    if (raw && raw.trim().startsWith('<')) return raw;
  } catch (previewErr) {
    console.warn('[fetchGameHtml] /preview failed, falling back to /source:', previewErr);
  }
  // 降级：/source 接口返回 { html_content: string }
  const src = await getGameSource(gameId);
  return src.html_content ?? src.content ?? '';
}

/**
 * 5b. 游戏外链分享 URL（在新标签页打开用，不用于 iframe src）
 * 直接带 token，供「在新标签页打开」按钮使用
 */
export function gameShareUrl(gameId: string): string {
  const token = getToken();
  const origin = getBaseOrigin();
  const base = origin ? `${origin}/api/v1` : '/api/v1';
  return `${base}/games/${gameId}/preview${token ? `?token=${encodeURIComponent(token)}` : ''}`;
}

// 向后兼容别名（以防其他地方有引用）
export { gameShareUrl as gamePreviewUrl };

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
// 分享短链接 API
// ─────────────────────────────────────────────────────────────────

export interface ShareLink {
  code: string;
  short_url: string;           // e.g. /s/a3f8kz
  full_short_url: string;      // 带域名的完整短链接
  game_id: string;
  game_title: string;
  created_at: string;
  expires_at: string | null;
  view_count?: number;
  is_active?: boolean;
}

/** 公开游戏信息（无需登录） */
export interface PublicGameInfo {
  code: string;
  game_id: string;
  title: string;
  game_type: string;
  html_content: string;
  created_at: string;
}

/**
 * 8. 为指定游戏创建分享短链接（需登录）
 * POST /api/v1/games/{game_id}/share
 */
export async function createShareLink(
  gameId: string,
  expiresInDays?: number,
): Promise<ShareLink> {
  const body = expiresInDays ? { expires_in_days: expiresInDays } : undefined;
  const res = await apiClient.post(`/games/${gameId}/share`, body);
  return res.data?.data ?? res.data;
}

/**
 * 9. 获取游戏的分享链接列表（需登录）
 * GET /api/v1/games/{game_id}/shares
 */
export async function getShareLinks(gameId: string): Promise<ShareLink[]> {
  const res = await apiClient.get(`/games/${gameId}/shares`);
  const data = res.data?.data ?? res.data;
  return data.shares ?? data ?? [];
}

/**
 * 10. 停用分享链接（需登录）
 * DELETE /api/v1/games/shares/{code}
 */
export async function deleteShareLink(code: string): Promise<void> {
  await apiClient.delete(`/games/shares/${code}`);
}

/**
 * 11. 获取公开游戏内容（无需登录）
 * GET /api/v1/public/games/share/{code}
 * 用于落地页 /play/:code
 */
export async function getPublicGame(code: string): Promise<PublicGameInfo> {
  // 注意：此接口无需 Authorization，直接用 fetch 不带 header
  const base = (import.meta as any).env?.VITE_API_BASE_URL ?? '/api/v1';
  const url = `${base}/public/games/share/${code}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (res.status === 404) throw new Error('SHARE_NOT_FOUND');
  if (res.status === 410) throw new Error('SHARE_EXPIRED');
  if (!res.ok) throw new Error(`SHARE_ERROR_${res.status}`);
  const json = await res.json();
  return json.data ?? json;
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

// ─────────────────────────────────────────────────────────────────
// 游戏代码流式生成
// ─────────────────────────────────────────────────────────────────

export interface GameStreamCallbacks {
  /** 阶段变更（preparing / generating / writing / done）*/
  onStage?: (stage: string, progress: number, message?: string) => void;
  /** 实际 HTML 代码片段（来自 LLM token 流）*/
  onChunk?: (chunk: string, progress: number, accumulated: string) => void;
  /** 生成完成 */
  onDone?: (gameId: string, version: number) => void;
  /** 生成失败 */
  onError?: (message: string) => void;
}

/**
 * 连接游戏生成 SSE 流。
 *
 * 优先尝试 `GET /games/tasks/{task_id}/stream`（SSE 流式），
 * 若后端尚未实现（返回 404/405），自动降级到 500ms 轮询模式，
 * 保证向后兼容。
 *
 * @param taskId  generateGame 返回的 task_id
 * @param callbacks  事件回调
 * @param signal  AbortSignal（可在组件卸载时中断）
 */
export async function streamGameTask(
  taskId: string,
  callbacks: GameStreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const token = localStorage.getItem('access_token') ?? '';
  const url = `${API_BASE_URL}/games/tasks/${taskId}/stream`;
  let streamFailed = false;
  let accumulated = '';

  try {
    await fetchEventSource(url, {
      method: 'GET',
      headers: {
        Accept: 'text/event-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal,
      // fetchEventSource 会在非 2xx 时 throw，我们捕获后降级
      async onopen(response) {
        if (!response.ok) {
          // 404 = 后端未实现，降级到轮询
          streamFailed = true;
          throw new Error(`SSE_NOT_SUPPORTED:${response.status}`);
        }
      },
      onmessage(ev) {
        if (!ev.data || ev.data === '[DONE]') return;
        try {
          const data = JSON.parse(ev.data);
          switch (data.event_type) {
            case 'stage':
              callbacks.onStage?.(data.stage, data.progress ?? 0, data.message);
              break;
            case 'code_chunk':
              accumulated += data.chunk ?? '';
              callbacks.onChunk?.(data.chunk ?? '', data.progress ?? 0, accumulated);
              break;
            case 'done':
              callbacks.onDone?.(data.game_id, data.version ?? 1);
              break;
            case 'error':
              callbacks.onError?.(data.message ?? '生成失败');
              break;
          }
        } catch { /* malformed JSON — skip */ }
      },
      onerror(err) {
        if (err instanceof DOMException && err.name === 'AbortError') throw err;
        // 非 abort 错误：标记 SSE 失败，中断重试循环
        streamFailed = true;
        throw err;
      },
    });
  } catch (e: any) {
    // AbortError = 用户手动取消，直接返回
    if (e instanceof DOMException && e.name === 'AbortError') return;
    // SSE 不支持 → 降级轮询
    if (streamFailed || String(e?.message ?? '').startsWith('SSE_NOT_SUPPORTED')) {
      await _pollFallback(taskId, callbacks, signal);
      return;
    }
    // 其他网络错误也降级轮询
    console.warn('[GameStream] SSE error, falling back to polling:', e);
    await _pollFallback(taskId, callbacks, signal);
  }
}

/** 内部：轮询降级实现（500ms） */
async function _pollFallback(
  taskId: string,
  callbacks: GameStreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  let lastStage = '';
  while (true) {
    if (signal?.aborted) return;
    try {
      const task = await getGameTask(taskId);
      // 阶段变更时通知
      if (task.stage && task.stage !== lastStage) {
        lastStage = task.stage;
        callbacks.onStage?.(task.stage, task.progress ?? 0);
      } else if (task.progress != null) {
        callbacks.onStage?.(task.stage ?? lastStage, task.progress);
      }
      if (task.status === 'completed') {
        callbacks.onDone?.(task.result!.game_id, task.result!.version ?? 1);
        return;
      }
      if (task.status === 'failed') {
        callbacks.onError?.(task.result?.error ?? '生成失败，请重试');
        return;
      }
    } catch { /* keep going */ }
    await new Promise(r => setTimeout(r, 500));
  }
}
