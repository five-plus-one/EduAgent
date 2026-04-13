import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  UploadCloud, FileText, CheckCircle, Clock, Trash2, RefreshCw,
  Video, Mic, Image as ImageIcon, FileVideo, ChevronDown, ChevronUp,
  AlertCircle,
} from 'lucide-react';
import { clsx } from 'clsx';
import ReactMarkdown from 'react-markdown';
import styles from './KnowledgeBase.module.css';
import { uploadKnowledgeDoc, listKnowledgeDocs, deleteKnowledgeDoc } from '../utils/api';
import {
  getKeyframeUrl, getDownloadUrl, getPreviewUrl, formatDuration,
  retryKnowledgeDocument, patchKnowledgeDocument,
  VIDEO_STAGE_LABELS, VIDEO_STAGE_PROGRESS,
  type VideoProcessStage,
} from '../utils/videoKnowledgeApi';

// ── 类型定义 ──────────────────────────────────────────────────────────────────

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface KeyframeInfo {
  filename: string;
  timestamp_est: number;
  description: string;
}

export interface KBDocument {
  document_id: string;
  filename: string;
  /** 用户自定义显示名（展示时优先，为空 fallback 到 filename）*/
  display_name?: string | null;
  /** 用户自定义描述 */
  description?: string | null;
  status: string;
  progress?: number;
  summary?: string | null;
  created_at?: string;
  file_type?: 'document' | 'video';
  // 视频专用
  duration_sec?: number;
  process_stage?: string;
  transcript_json?: TranscriptSegment[];
  keyframes_json?: KeyframeInfo[];
  video_summary?: string;
}

/** 将秒数转为 mm:ss 或 hh:mm:ss */
function fmtDuration(sec?: number): string {
  if (!sec) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

/** 阶段 → 中文描述 */
const STAGE_LABEL: Record<string, string> = {
  reading_metadata:     '🎬 读取视频信息...',
  extracting_audio:     '🔊 提取音频...',
  transcribing:         '🎵 语音识别中...',
  transcribing_done:    '✅ 语音识别完成',
  extracting_frames:    '🖼 提取关键帧...',
  extracting_frames_done: '✅ 关键帧提取完成',
  analyzing_frames:     '🤖 AI 分析画面...',
  analyzing_frames_done: '✅ 画面分析完成',
  summarizing:          '📋 生成摘要...',
  summarizing_done:     '✅ 摘要生成完成',
  indexing:             '📦 向量化索引中...',
  done:                 '✅ 处理完成',
};

// ── 视频文档卡片 ─────────────────────────────────────────────────────────────

function VideoDocCard({ doc, apiBase }: { doc: KBDocument; apiBase: string }) {
  const [showTranscript, setShowTranscript] = useState(false);
  const [showFrames,     setShowFrames]     = useState(false);
  const [showSummary,    setShowSummary]    = useState(false);

  const token = localStorage.getItem('token') || '';
  const frameBaseUrl = `${apiBase}/knowledge/documents/${doc.document_id}/keyframes`;

  const hasTranscript = (doc.transcript_json?.length ?? 0) > 0;
  const hasFrames     = (doc.keyframes_json?.length ?? 0) > 0;

  return (
    <div className={styles.videoCard}>
      {/* 视频头部 */}
      <div className={styles.videoCardHeader}>
        <FileVideo size={18} className={styles.videoIcon} />
        <div className={styles.videoCardMeta}>
          <span className={styles.videoFilename}>{doc.filename}</span>
          {doc.duration_sec && (
            <span className={styles.videoDuration}>{fmtDuration(doc.duration_sec)}</span>
          )}
        </div>
        {doc.status === 'completed' && (
          <span className={clsx(styles.statusBadge, styles.statusSuccess)}>
            <CheckCircle size={13} /> 已就绪
          </span>
        )}
        {doc.status === 'failed' && (
          <span className={clsx(styles.statusBadge, styles.statusFailed)}>
            <AlertCircle size={13} /> 处理失败
          </span>
        )}
      </div>

      {/* 处理中进度 */}
      {doc.status === 'processing' && (
        <div className={styles.videoProgress}>
          <div className={styles.progressBarBg}>
            <div
              className={styles.progressBarFill}
              style={{ width: `${doc.progress ?? 0}%` }}
            />
          </div>
          <span className={styles.stageLabel}>
            {STAGE_LABEL[doc.process_stage ?? ''] ?? `处理中 ${doc.progress ?? 0}%`}
          </span>
        </div>
      )}

      {/* 完成后的展示面板 */}
      {doc.status === 'completed' && (
        <div className={styles.videoCardBody}>

          {/* AI 摘要 */}
          {doc.video_summary && (
            <div className={styles.videoSection}>
              <button
                className={styles.videoSectionToggle}
                onClick={() => setShowSummary(s => !s)}
              >
                <span>📋 AI 摘要</span>
                {showSummary ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
              </button>
              {showSummary && (
                <pre className={styles.summaryText}>{doc.video_summary}</pre>
              )}
            </div>
          )}

          {/* 关键帧画廊 */}
          {hasFrames && (
            <div className={styles.videoSection}>
              <button
                className={styles.videoSectionToggle}
                onClick={() => setShowFrames(f => !f)}
              >
                <span>🖼 关键帧 ({doc.keyframes_json!.length} 帧)</span>
                {showFrames ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
              </button>
              {showFrames && (
                <div className={styles.framesGallery}>
                  {doc.keyframes_json!.map((kf, i) => (
                    <div key={i} className={styles.frameItem}>
                      <img
                        src={`${frameBaseUrl}/${kf.filename}`}
                        alt={`帧 ${i + 1}`}
                        className={styles.frameImg}
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                        // Token 认证 via headers 不支持 img src，需代理或直接静态服务
                        // 若后端已配置静态服务可直接访问
                      />
                      <div className={styles.frameTimestamp}>
                        {fmtDuration(kf.timestamp_est)}
                      </div>
                      {kf.description && (
                        <p className={styles.frameDesc}>{kf.description}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 字幕 */}
          {hasTranscript && (
            <div className={styles.videoSection}>
              <button
                className={styles.videoSectionToggle}
                onClick={() => setShowTranscript(t => !t)}
              >
                <span>📝 字幕 ({doc.transcript_json!.length} 段)</span>
                {showTranscript ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
              </button>
              {showTranscript && (
                <div className={styles.transcriptList}>
                  {doc.transcript_json!.map((seg, i) => (
                    <div key={i} className={styles.transcriptSeg}>
                      <span className={styles.transcriptTs}>{fmtDuration(Math.floor(seg.start))}</span>
                      <span className={styles.transcriptText}>{seg.text}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── KnowledgeBasePanel ────────────────────────────────────────────────────────

export function KnowledgeBasePanel({ compact = false }: { compact?: boolean }) {
  const [documents, setDocuments] = useState<KBDocument[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading,  setUploading]  = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const apiBase = (import.meta as any).env?.VITE_API_BASE_URL ?? 'http://localhost:8000/api/v1';

  const fetchDocs = useCallback(async (isSilent = false) => {
    try {
      if (!isSilent) setLoading(true);
      const data = await listKnowledgeDocs(1, 50);
      const items: KBDocument[] = data?.items ?? (Array.isArray(data) ? data : []);
      setDocuments(items);
      // 如果当前选中的 doc 有更新，同步刷新预览
      setSelectedDoc(prev => {
        if (!prev) return null;
        return items.find(d => d.document_id === prev.document_id) ?? null;
      });
    } catch {
      console.error('Failed to fetch knowledge base documents');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchDocs(); }, [fetchDocs]);

  // Poll every 3s while any doc is processing / video still pending
  // 每 3s 轮询处理中的文档
  useEffect(() => {
    const hasProcessing = documents.some(
      d => d.status === 'processing' || d.status === 'pending'
    );
    if (!hasProcessing) return;
    const timer = setInterval(() => fetchDocs(true), 3000);
    return () => clearInterval(timer);
  }, [documents, fetchDocs]);

  const handleDragOver  = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    if (e.dataTransfer.files?.length) handleFiles(Array.from(e.dataTransfer.files));
  };
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) handleFiles(Array.from(e.target.files));
  };

  const MAX_VIDEO_MB = 500;
  const MAX_DOC_MB   = 100;

  const handleFiles = async (files: File[]) => {
    setUploadError(null);
    // 前端大小校验
    for (const f of files) {
      const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
      const isVideo = ['mp4', 'mov', 'avi', 'webm', 'mkv', 'flv'].includes(ext);
      const limitMB = isVideo ? MAX_VIDEO_MB : MAX_DOC_MB;
      if (f.size > limitMB * 1024 * 1024) {
        setUploadError(`文件「${f.name}」超过 ${limitMB} MB 限制。`);
        return;
      }
    }

    setUploading(true);
    try {
      await Promise.all(files.map(f => uploadKnowledgeDoc(f, { filename: f.name })));
      await fetchDocs();
    } catch (err: any) {
      setUploadError(err?.message ?? '上传失败，请重试。');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDelete = (documentId: string) => {
    const doc = documents.find(d => d.document_id === documentId);
    setConfirmDelete({ id: documentId, name: getDisplayTitle(doc ?? { document_id: documentId, filename: documentId, status: '', progress: 0, file_type: null }), phase: 'confirm' });
  };

  const performDelete = async () => {
    if (!confirmDelete) return;
    const { id } = confirmDelete;
    // 阶段 1: 切换到“删除中”
    setConfirmDelete(prev => prev ? { ...prev, phase: 'deleting' } : null);
    try {
      await deleteKnowledgeDoc(documentId);
      setDocuments(prev => prev.filter(d => d.document_id !== documentId));
    } catch {
      console.error('Delete failed');
      // 失败时回到确认状态
      setConfirmDelete(prev => prev ? { ...prev, phase: 'confirm' } : null);
    }
  };

  // 将文档按类型分组
  const videoDocs = documents.filter(d => d.file_type === 'video');
  const fileDocs  = documents.filter(d => d.file_type !== 'video');

  return (
    <div className={clsx(styles.panelRoot, compact && styles.panelCompact)}>
      {/* Header */}
      {!compact && (
        <header className={styles.pageHeader}>
          <div>
            <h1 className={styles.title}>知识库管理 (RAG Admin)</h1>
            <p className={styles.subtitle}>
              上传专业课件、教案或视频。文档自动解析向量化；视频将提取字幕、关键帧并生成 AI 摘要，用于强化智能体领域理解能力。
            </p>
          </div>
        </header>
      )}

      {/* Upload Zone */}
      <div
        className={clsx(styles.uploadZone, 'glass-panel', isDragging && styles.dragging, uploading && styles.uploading)}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => !uploading && fileInputRef.current?.click()}
      >
        <input
          type="file"
          ref={fileInputRef}
          style={{ display: 'none' }}
          onChange={handleFileSelect}
          multiple
          accept=".pdf,.docx,.doc,.pptx,.txt,.md,.json,.csv,.mp4,.mov,.avi,.webm,.mkv,.flv"
        />
        <div className={styles.uploadContent}>
          <div className={styles.uploadIconWrapper}>
            <UploadCloud size={compact ? 32 : 48} className={clsx(uploading && styles.rotating)} />
          </div>
          <h3>{uploading ? '上传中，请稍候...' : '点击或拖拽文件到这里上传'}</h3>
          <p>文档：PDF / Word / PPT（≤ 100 MB）&nbsp;&nbsp;|&nbsp;&nbsp;视频：MP4 / MOV / AVI / WebM（≤ 500 MB）</p>
        </div>
      </div>

      {/* 上传错误提示 */}
      {uploadError && (
        <div className={styles.uploadError}>
          <AlertCircle size={15} /> {uploadError}
        </div>
      )}

      {/* ── 视频文档区 ── */}
      {videoDocs.length > 0 && (
        <div className={clsx(styles.tableContainer, 'glass-panel')}>
          <div className={styles.tableHeader}>
            <h3 className={styles.tableTitle}>
              <Video size={16} style={{ marginRight: 6 }} />
              视频资料 ({videoDocs.length})
            </h3>
          </div>
          <div className={styles.videoList}>
            {videoDocs.map(doc => (
              <div key={doc.document_id} className={styles.videoCardWrapper}>
                <VideoDocCard doc={doc} apiBase={apiBase} />
                <button
                  className={styles.deleteBtn}
                  style={{ alignSelf: 'flex-start', marginTop: 8 }}
                  onClick={() => handleDelete(doc.document_id)}
                  title="删除"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── 普通文档表格 ── */}
      <div className={clsx(styles.tableContainer, 'glass-panel')}>
        <div className={styles.tableHeader}>
          <h3 className={styles.tableTitle}>
            已入库文档 ({loading ? '…' : fileDocs.length})
          </h3>
          {compact && (
            <button className={clsx('button-base', styles.refreshBtn)} onClick={() => fetchDocs(false)} title="刷新">
              <RefreshCw size={14} />
            </button>
          )}
        </div>
        <div className={styles.tableWrapper}>
          <table className={styles.dataTable}>
            <thead>
              <tr>
                <th>文件名</th>
                <th>上传日期</th>
                <th>解析状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={4} className={styles.emptyTable}><Clock size={14} className={styles.rotating} style={{ display: 'inline', marginRight: 6 }} />加载中...</td></tr>
              ) : fileDocs.length === 0 ? (
                <tr><td colSpan={4} className={styles.emptyTable}>尚未上传任何知识库文件</td></tr>
              ) : (
                fileDocs.map(doc => (
                  <tr key={doc.document_id} className={styles.tableRow}>
                    <td>
                      <div className={styles.cellFile}>
                        <FileText size={16} className={styles.fileIcon} />
                        <span className={styles.filename}>{doc.filename}</span>
                      </div>
                    </td>
                    <td className={styles.cellDate}>{doc.created_at ? new Date(doc.created_at).toLocaleDateString('zh-CN') : '—'}</td>
                    <td>
                      {doc.status === 'completed' ? (
                        <div className={clsx(styles.statusBadge, styles.statusSuccess)}><CheckCircle size={14} /> 解析完成</div>
                      ) : doc.status === 'failed' ? (
                        <div className={clsx(styles.statusBadge, styles.statusFailed)}><AlertCircle size={14} /> 解析失败</div>
                      ) : (
                        <div className={clsx(styles.statusBadge, styles.statusPending)}>
                          <Clock size={14} className={styles.rotating} />
                          向量化中{doc.progress != null ? ` ${doc.progress}%` : ''}
                        </div>
                      )}
                    </td>
                    <td>
                      <button className={styles.deleteBtn} onClick={() => handleDelete(doc.document_id)} title="删除">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── KnowledgeBase 路由页 ──────────────────────────────────────────────────────

export default function KnowledgeBase() {
  return (
    <div className={styles.kbContainer}>
      <KnowledgeBasePanel compact={false} />
    </div>
  );
}
