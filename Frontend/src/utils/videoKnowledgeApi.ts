/**
 * 视频知识库 API — v1.0
 *
 * 路由前缀：/api/v1/knowledge-base/
 * 本文件仅新增，不修改任何已有文件（api.ts 的旧接口不受影响）。
 *
 * 快速导入：
 *   import {
 *     uploadKnowledgeFile, listKnowledgeDocs, getKnowledgeDocument,
 *     deleteKnowledgeDocument, retryKnowledgeDocument,
 *     getKeyframeUrl, pollVideoProgress,
 *     validateUploadFile, formatDuration, VIDEO_STAGE_LABELS,
 *   } from '../utils/videoKnowledgeApi';
 */

import { apiClient, API_BASE_URL } from './api';

// ─────────────────────────────────────────────────────────────
// § 1. 视频处理阶段
// ─────────────────────────────────────────────────────────────

export type VideoProcessStage =
  | 'reading_metadata'
  | 'extracting_audio'
  | 'transcribing'
  | 'transcribing_done'
  | 'extracting_frames'
  | 'extracting_frames_done'
  | 'analyzing_frames'
  | 'analyzing_frames_done'
  | 'summarizing'
  | 'summarizing_done'
  | 'indexing'
  | 'done';

/** 阶段 → 用户可读文案映射 */
export const VIDEO_STAGE_LABELS: Record<VideoProcessStage, string> = {
  reading_metadata:        '🎬 读取视频信息...',
  extracting_audio:        '🔊 提取音频...',
  transcribing:            '🎵 语音识别中...',
  transcribing_done:       '✅ 语音识别完成',
  extracting_frames:       '🖼 提取关键帧...',
  extracting_frames_done:  '✅ 关键帧提取完成',
  analyzing_frames:        '🤖 AI 分析画面...',
  analyzing_frames_done:   '✅ 画面分析完成',
  summarizing:             '📋 生成摘要...',
  summarizing_done:        '✅ 摘要生成完成',
  indexing:                '📦 向量化索引中...',
  done:                    '✅ 处理完成',
};

/** 阶段对应的预期进度百分比（用于本地进度条估算） */
export const VIDEO_STAGE_PROGRESS: Record<VideoProcessStage, number> = {
  reading_metadata:       5,
  extracting_audio:      10,
  transcribing:          15,
  transcribing_done:     30,
  extracting_frames:     35,
  extracting_frames_done:50,
  analyzing_frames:      52,
  analyzing_frames_done: 75,
  summarizing:           78,
  summarizing_done:      88,
  indexing:              90,
  done:                 100,
};

// ─────────────────────────────────────────────────────────────
// § 2. 文档类型定义
// ─────────────────────────────────────────────────────────────

export interface TranscriptSegment {
  /** 片段开始时间（秒） */
  start: number;
  /** 片段结束时间（秒） */
  end: number;
  /** 识别文字 */
  text: string;
}

export interface KeyframeInfo {
  /** 关键帧文件名，配合 getKeyframeUrl() 使用 */
  filename: string;
  /** 时间戳估算（秒） */
  timestamp_est: number;
  /** AI 对该帧内容的描述 */
  description: string;
}

/** 所有文档共有字段 */
export interface KBDocumentBase {
  document_id: string;
  filename: string;
  /** 文档状态 */
  status: 'processing' | 'completed' | 'failed' | string;
  /** 处理进度 0-100 */
  progress: number;
  /**
   * 文件类型。
   * ⚠️ 旧数据（2026-04-12 前）可能为 null，应视为 'document'：
   *   const fileType = doc.file_type ?? 'document';
   */
  file_type: 'document' | 'video' | null;
  /** 内容摘要 / 失败原因 */
  summary?: string;
  created_at?: string;
}

/** 视频文档（type === 'video'）附加字段 */
export interface KBVideoDocument extends KBDocumentBase {
  file_type: 'video';
  /** 视频时长（秒） */
  duration_sec?: number;
  /** 当前处理阶段 */
  process_stage?: VideoProcessStage;
  /** 字幕片段列表（status=completed 后可用） */
  transcript_json?: TranscriptSegment[];
  /** 关键帧列表（status=completed 后可用） */
  keyframes_json?: KeyframeInfo[];
  /** AI 生成的视频内容摘要（Markdown，status=completed 后可用） */
  video_summary?: string;
}

/** 列表响应体 */
export interface KBDocumentListResponse {
  total: number;
  page: number;
  size: number;
  has_more: boolean;
  items: (KBDocumentBase | KBVideoDocument)[];
}

/** 上传接口响应 */
export interface KBUploadResponse {
  document_id: string;
  status: string;
  file_type: 'document' | 'video' | null;
}

// ─────────────────────────────────────────────────────────────
// § 3. 文件格式 & 大小限制
// ─────────────────────────────────────────────────────────────

const DOCUMENT_EXTS = ['.pdf', '.docx', '.doc', '.pptx', '.txt', '.md', '.json', '.csv'];
const VIDEO_EXTS    = ['.mp4', '.mov', '.avi', '.webm', '.mkv', '.flv'];
const ALL_EXTS      = [...DOCUMENT_EXTS, ...VIDEO_EXTS];

const DOCUMENT_MAX_BYTES = 100 * 1024 * 1024;  // 100 MB
const VIDEO_MAX_BYTES    = 500 * 1024 * 1024;  // 500 MB

/**
 * 前端上传前校验文件格式和大小。
 * @returns 错误提示字符串（null 表示校验通过）
 *
 * @example
 * const err = validateUploadFile(file);
 * if (err) { alert(err); return; }
 */
export function validateUploadFile(file: File): string | null {
  const name = file.name.toLowerCase();
  const ext  = `.${name.split('.').pop()}`;

  if (!ALL_EXTS.includes(ext)) {
    return `不支持的文件格式 "${ext}"。支持：${ALL_EXTS.join(', ')}`;
  }

  const isVideo = VIDEO_EXTS.includes(ext);
  const limit   = isVideo ? VIDEO_MAX_BYTES : DOCUMENT_MAX_BYTES;
  const limitMB = isVideo ? 500 : 100;

  if (file.size > limit) {
    const actualMB = (file.size / 1024 / 1024).toFixed(1);
    return `文件过大（${actualMB} MB），${isVideo ? '视频' : '文档'}上限为 ${limitMB} MB`;
  }

  return null;
}

// ─────────────────────────────────────────────────────────────
// § 4. 辅助函数
// ─────────────────────────────────────────────────────────────

/**
 * 将秒数格式化为 mm:ss 或 hh:mm:ss。
 * @example formatDuration(754) → "12:34"
 */
export function formatDuration(seconds?: number): string {
  if (seconds == null || isNaN(seconds)) return '--:--';
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/**
 * 构建关键帧图片 URL（自动附加 ?token= JWT）。
 *
 * ⚠️ <img> 标签不能发 Authorization Header，必须用此函数构建 URL。
 *
 * @example
 * <img src={getKeyframeUrl(doc.document_id, kf.filename)} />
 */
export function getKeyframeUrl(docId: string, filename: string): string {
  const token  = localStorage.getItem('access_token') ?? '';
  const origin = API_BASE_URL.replace(/\/api\/v\d+.*$/, '');
  const path   = `/api/v1/knowledge-base/documents/${docId}/keyframes/${encodeURIComponent(filename)}`;
  const query  = token ? `?token=${encodeURIComponent(token)}` : '';
  return `${origin}${path}${query}`;
}

// ─────────────────────────────────────────────────────────────
// § 5. API 端点封装
// ─────────────────────────────────────────────────────────────

/**
 * 上传文档或视频到知识库。
 *
 * 推荐先调用 `validateUploadFile(file)` 进行前端校验。
 *
 * @example
 * const result = await uploadKnowledgeFile(file);
 * if (result.file_type === 'video') {
 *   const cancel = pollVideoProgress(result.document_id, ...);
 * }
 */
export async function uploadKnowledgeFile(
  file: File,
  metadata: Record<string, unknown> = {},
): Promise<KBUploadResponse> {
  const form = new FormData();
  form.append('file', file);
  form.append('metadata_json', JSON.stringify(metadata));
  const res = await apiClient.post<{ data?: KBUploadResponse } | KBUploadResponse>(
    '/knowledge-base/documents',
    form,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  );
  return (res.data as any)?.data ?? res.data;
}

/**
 * 获取知识库文档列表（含视频专属字段）。
 */
export async function listKnowledgeDocuments(
  page = 1,
  size = 20,
  status?: string,
): Promise<KBDocumentListResponse> {
  const res = await apiClient.get('/knowledge-base/documents', {
    params: { page, size, ...(status ? { status } : {}) },
  });
  return (res.data as any)?.data ?? res.data;
}

/**
 * 🆕 获取单个文档详情（含完整 transcript_json / keyframes_json / video_summary）。
 */
export async function getKnowledgeDocument(
  docId: string,
): Promise<KBDocumentBase | KBVideoDocument> {
  const res = await apiClient.get(`/knowledge-base/documents/${docId}`);
  return (res.data as any)?.data ?? res.data;
}

/**
 * 删除文档（视频会同时清理工作目录）。
 */
export async function deleteKnowledgeDocument(docId: string): Promise<void> {
  await apiClient.delete(`/knowledge-base/documents/${docId}`);
}

/**
 * 重试失败的文档处理（无需重新上传文件）。
 */
export async function retryKnowledgeDocument(docId: string): Promise<void> {
  await apiClient.post(`/knowledge-base/documents/${docId}/retry`);
}

// ─────────────────────────────────────────────────────────────
// § 6. 视频处理进度轮询
// ─────────────────────────────────────────────────────────────

/**
 * 轮询单个文档的处理进度（建议间隔 3s）。
 *
 * 返回一个 cancel 函数，在组件卸载或处理结束时调用。
 *
 * @param docId       文档 ID
 * @param onProgress  每次轮询回调，接收最新文档数据
 * @param intervalMs  轮询间隔（默认 3000ms）
 * @returns           cancel 函数（调用后停止轮询）
 *
 * @example
 * const cancel = pollVideoProgress(docId, (doc) => {
 *   setDoc(doc);
 *   if (doc.status === 'completed' || doc.status === 'failed') cancel();
 * });
 *
 * // 组件卸载时务必调用：
 * useEffect(() => cancel, []);
 */
export function pollVideoProgress(
  docId: string,
  onProgress: (doc: KBDocumentBase | KBVideoDocument) => void,
  intervalMs = 3000,
): () => void {
  let active = true;

  const tick = async () => {
    if (!active) return;
    try {
      const doc = await getKnowledgeDocument(docId);
      if (!active) return;
      onProgress(doc);
      // 终止状态时不再继续
      if (doc.status === 'completed' || doc.status === 'failed') {
        active = false;
        return;
      }
    } catch (err) {
      console.warn('[pollVideoProgress] fetch failed, will retry:', err);
    }
    if (active) {
      setTimeout(tick, intervalMs);
    }
  };

  // 首次立即执行，之后按间隔轮询
  tick();

  return () => { active = false; };
}
