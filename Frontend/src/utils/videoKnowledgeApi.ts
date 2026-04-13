/**
 * 视频知识库 API — v1.2
 *
 * 路由前缀：/api/v1/knowledge-base/
 * 本文件仅新增，不修改任何已有文件（api.ts 的旧接口不受影响）。
 *
 * 快速导入：
 *   import {
 *     uploadKnowledgeFile, listKnowledgeDocuments, patchKnowledgeDocument,
 *     deleteKnowledgeDocument, retryKnowledgeDocument,
 *     getKeyframeUrl, getDownloadUrl, getPreviewUrl, pollVideoProgress,
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

/** 所有文档共有字段（API v1.2） */
export interface KBDocumentBase {
  document_id: string;
  /** 原始物理文件名（不可修改） */
  filename: string;
  /** 用户自定义显示名（可通过 PATCH 修改），展示时优先用此字段，为空则 fallback 到 filename */
  display_name?: string | null;
  /** 用户自定义描述 */
  description?: string | null;
  /**
   * 文档状态：pending / processing / completed / failed
   * ⚠️ 新增 'pending' 状态（排队中，尚未开始处理）
   */
  status: 'pending' | 'processing' | 'completed' | 'failed' | string;
  /** 处理进度 0-100 */
  progress: number;
  /**
   * 文件类型。
   * ⚠️ 旧数据（2026-04-12 前）可能为 null，应视为 'document'：
   *   const fileType = doc.file_type ?? 'document';
   */
  file_type: 'document' | 'video' | null;
  /** 处理中的细粒度阶段码（completed/failed 后为 null） */
  process_stage?: VideoProcessStage | string | null;
  /**
   * ⭐ 后端直接提供的阶段中文文案，直接用于 UI 展示。
   * 优先使用此字段，本地 VIDEO_STAGE_LABELS 仅作 fallback。
   */
  stage_label?: string | null;
  /** 内容摘要 / 失败原因 */
  summary?: string | null;
  /** 原始 metadata 对象 */
  metadata?: Record<string, unknown>;
  created_at?: string;
}

/** 视频文档（type === 'video'）附加字段 */
export interface KBVideoDocument extends KBDocumentBase {
  file_type: 'video';
  /** 视频时长（秒） */
  duration_sec?: number | null;
  /** 字幕片段列表（status=completed 后可用） */
  transcript_json?: TranscriptSegment[] | null;
  /** 关键帧列表（status=completed 后可用） */
  keyframes_json?: KeyframeInfo[] | null;
  /** AI 生成的视频内容摘要（Markdown，status=completed 后可用） */
  video_summary?: string | null;
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

/** PATCH 接口响应 */
export interface KBPatchResponse {
  document_id: string;
  display_name: string | null;
  description: string | null;
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

/** 提取 origin（去除 /api/v1 后缀） */
function _getOrigin(): string {
  return API_BASE_URL.replace(/\/api\/v\d+.*$/, '');
}

/** 获取当前 token */
function _getToken(): string {
  return localStorage.getItem('access_token') ?? '';
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
  const token  = _getToken();
  const origin = _getOrigin();
  const path   = `/api/v1/knowledge-base/documents/${docId}/keyframes/${encodeURIComponent(filename)}`;
  const query  = token ? `?token=${encodeURIComponent(token)}` : '';
  return `${origin}${path}${query}`;
}

/**
 * 构建文档下载 URL（触发浏览器下载对话框）。
 * 适合用于 <a href={url} download> ，支持大文件，无需 fetch。
 *
 * @example
 * <a href={getDownloadUrl(doc.document_id)} download={doc.filename}>下载</a>
 */
export function getDownloadUrl(docId: string): string {
  const token  = _getToken();
  const origin = _getOrigin();
  const path   = `/api/v1/knowledge-base/documents/${docId}/download`;
  const query  = token ? `?token=${encodeURIComponent(token)}` : '';
  return `${origin}${path}${query}`;
}

/**
 * 构建文档在线预览 URL（在浏览器内联展示，不弹下载框）。
 * - PDF  → 浏览器内嵌 PDF 渲染
 * - MP4/WebM → 支持 Range 请求，进度条可拖
 * - DOCX/PPTX → 302 重定向到 /download
 *
 * @example
 * <iframe src={getPreviewUrl(docId)} />          // PDF
 * <video src={getPreviewUrl(docId)} controls />  // 视频
 */
export function getPreviewUrl(docId: string): string {
  const token  = _getToken();
  const origin = _getOrigin();
  const path   = `/api/v1/knowledge-base/documents/${docId}/preview`;
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
 * 更新文档的显示名 / 描述（至少传一个字段）。
 * 对应 PATCH /documents/{doc_id}（API v1.2 新增）。
 *
 * @example
 * await patchKnowledgeDocument(docId, { display_name: '第六章配套视频' });
 */
export async function patchKnowledgeDocument(
  docId: string,
  data: { display_name?: string; description?: string },
): Promise<KBPatchResponse> {
  const res = await apiClient.patch(`/knowledge-base/documents/${docId}`, data);
  return (res.data as any)?.data ?? res.data;
}

/**
 * 删除文档（视频会同时清理工作目录）。
 */
export async function deleteKnowledgeDocument(docId: string): Promise<void> {
  await apiClient.delete(`/knowledge-base/documents/${docId}`);
}

/**
 * 重试失败/pending 的文档处理（无需重新上传文件）。
 * 返回最新 {document_id, status}。
 */
export async function retryKnowledgeDocument(
  docId: string,
): Promise<{ document_id: string; status: string }> {
  const res = await apiClient.post(`/knowledge-base/documents/${docId}/retry`);
  return (res.data as any)?.data ?? res.data;
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
      // v1.2 无单文档详情接口，通过列表接口轮询并过滤
      const listRes = await listKnowledgeDocuments(1, 100);
      if (!active) return;
      const doc = listRes.items.find(d => d.document_id === docId);
      if (!doc) return; // 文档可能已被删除
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
