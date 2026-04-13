import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  UploadCloud, FileText, CheckCircle, Clock, Trash2, RefreshCw,
<<<<<<< HEAD
  X, Video, FileVideo, Download, Film, AlignLeft, RotateCcw,
  ChevronRight, Image as ImageIcon,
=======
  Video, Mic, Image as ImageIcon, FileVideo, ChevronDown, ChevronUp,
  AlertCircle,
>>>>>>> origin/backend-dev
} from 'lucide-react';
import { clsx } from 'clsx';
import ReactMarkdown from 'react-markdown';
import styles from './KnowledgeBase.module.css';
import { uploadKnowledgeDoc, listKnowledgeDocs, deleteKnowledgeDoc } from '../utils/api';
import {
  getKeyframeUrl, formatDuration, retryKnowledgeDocument,
  VIDEO_STAGE_LABELS, VIDEO_STAGE_PROGRESS,
  type KBDocumentBase, type KBVideoDocument, type VideoProcessStage,
} from '../utils/videoKnowledgeApi';

<<<<<<< HEAD
// ─── 合并类型（兼容旧接口的 KBDocument 形状）─────────────────────
=======
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

>>>>>>> origin/backend-dev
export interface KBDocument {
  document_id: string;
  filename: string;
  status: string;
  progress?: number;
  summary?: string;
  created_at?: string;
<<<<<<< HEAD
  file_type?: 'document' | 'video' | null;
  // 视频专属
  duration_sec?: number;
  process_stage?: VideoProcessStage;
  transcript_json?: { start: number; end: number; text: string }[];
  keyframes_json?: { filename: string; timestamp_est: number; description: string }[];
  video_summary?: string;
}

// ─── 工具函数 ────────────────────────────────────────────────────
function getFileExt(filename: string) {
  return filename.split('.').pop()?.toLowerCase() ?? '';
}

function isVideo(doc: KBDocument) {
  return (doc.file_type ?? 'document') === 'video';
}

function fileTypeIcon(doc: KBDocument) {
  if (isVideo(doc)) return <FileVideo size={16} className={styles.fileIconVideo} />;
  return <FileText size={16} className={styles.fileIcon} />;
}

// ─── 右侧预览面板 ────────────────────────────────────────────────
function KBDocPreviewPanel({
  doc,
  onClose,
  onDelete,
  onRetry,
}: {
  doc: KBDocument;
  onClose: () => void;
  onDelete: (id: string) => void;
  onRetry?: (id: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<'summary' | 'keyframes' | 'transcript'>('summary');
  const [selectedFrame, setSelectedFrame] = useState<number | null>(null);
  const isVid = isVideo(doc);

  // 当切换 doc 时重置 tab
  useEffect(() => {
    setActiveTab('summary');
    setSelectedFrame(null);
  }, [doc.document_id]);

  const tabs = [
    { id: 'summary' as const,    label: 'AI 摘要',    show: true },
    { id: 'keyframes' as const,  label: '关键帧',     show: isVid && (doc.keyframes_json?.length ?? 0) > 0 },
    { id: 'transcript' as const, label: '字幕',       show: isVid && (doc.transcript_json?.length ?? 0) > 0 },
  ].filter(t => t.show);

  const stageLabel = doc.process_stage ? (VIDEO_STAGE_LABELS[doc.process_stage] ?? doc.process_stage) : '';
  const stageProgress = doc.process_stage ? (VIDEO_STAGE_PROGRESS[doc.process_stage] ?? doc.progress ?? 0) : (doc.progress ?? 0);

  return (
    <div className={styles.preview}>
      {/* ── 头部 ── */}
      <div className={styles.previewHeader}>
        <div className={styles.previewHeaderLeft}>
          {isVid
            ? <span className={styles.previewTypeTag}><Film size={12} /> 视频</span>
            : <span className={styles.previewTypeTagDoc}><FileText size={12} /> 文档</span>
          }
          <span className={styles.previewFilename} title={doc.filename}>{doc.filename}</span>
        </div>
        <button className={styles.previewClose} onClick={onClose} title="关闭预览">
          <X size={16} />
        </button>
      </div>

      {/* ── 元信息栏 ── */}
      <div className={styles.previewMeta}>
        {doc.created_at && (
          <span className={styles.previewMetaItem}>
            📅 {new Date(doc.created_at).toLocaleDateString('zh-CN', { year:'numeric', month:'long', day:'numeric' })}
          </span>
        )}
        {isVid && doc.duration_sec != null && (
          <span className={styles.previewMetaItem}>⏱ {formatDuration(doc.duration_sec)}</span>
        )}
        {doc.status === 'completed' && (
          <span className={clsx(styles.previewMetaItem, styles.previewMetaSuccess)}>
            <CheckCircle size={12} /> 已完成
          </span>
        )}
        {doc.status === 'failed' && (
          <span className={clsx(styles.previewMetaItem, styles.previewMetaFailed)}>
            ✕ 解析失败
          </span>
        )}
        {doc.status === 'processing' && (
          <span className={clsx(styles.previewMetaItem, styles.previewMetaPending)}>
            <Clock size={12} className={styles.rotating} /> 处理中
          </span>
        )}
      </div>

      {/* ── 视频处理进度条 ── */}
      {isVid && doc.status === 'processing' && (
        <div className={styles.progressWrap}>
          <div className={styles.progressBar}>
            <div className={styles.progressFill} style={{ width: `${stageProgress}%` }} />
          </div>
          <span className={styles.progressLabel}>{stageLabel || `${stageProgress}%`}</span>
        </div>
      )}

      {/* ── 操作栏 ── */}
      <div className={styles.previewActions}>
        {doc.status === 'failed' && onRetry && (
          <button className={styles.actionBtnRetry} onClick={() => onRetry(doc.document_id)}>
            <RotateCcw size={13} /> 重新解析
          </button>
        )}
        <button
          className={styles.actionBtnDanger}
          onClick={() => onDelete(doc.document_id)}
        >
          <Trash2 size={13} /> 删除
        </button>
      </div>

      {/* ── Tab 切换 ── */}
      {tabs.length > 1 && (
        <div className={styles.previewTabs}>
          {tabs.map(t => (
            <button
              key={t.id}
              className={clsx(styles.previewTab, activeTab === t.id && styles.previewTabActive)}
              onClick={() => setActiveTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* ── 内容区 ── */}
      <div className={styles.previewBody}>

        {/* AI 摘要 Tab */}
        {activeTab === 'summary' && (
          <div className={styles.summarySection}>
            {doc.video_summary ? (
              <div className={styles.markdownBody}>
                <ReactMarkdown>{doc.video_summary}</ReactMarkdown>
              </div>
            ) : doc.summary ? (
              <p className={styles.summaryText}>{doc.summary}</p>
            ) : (
              <p className={styles.summaryEmpty}>
                {doc.status === 'processing' ? '🔄 AI 摘要生成中，请稍候...' : '暂无摘要内容'}
              </p>
            )}
          </div>
        )}

        {/* 关键帧 Tab */}
        {activeTab === 'keyframes' && (
          <div className={styles.keyframesSection}>
            <div className={styles.keyframeGrid}>
              {doc.keyframes_json?.map((kf, i) => (
                <button
                  key={i}
                  className={clsx(styles.keyframeCard, selectedFrame === i && styles.keyframeCardActive)}
                  onClick={() => setSelectedFrame(selectedFrame === i ? null : i)}
                >
                  <div className={styles.keyframeImgWrap}>
                    <img
                      src={getKeyframeUrl(doc.document_id, kf.filename)}
                      alt={`关键帧 ${i + 1}`}
                      className={styles.keyframeImg}
                      loading="lazy"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                    <span className={styles.keyframeTimestamp}>{formatDuration(kf.timestamp_est)}</span>
                  </div>
                  <span className={styles.keyframeIndex}>帧 {i + 1}</span>
                </button>
              ))}
            </div>

            {/* 选中帧详情 */}
            {selectedFrame !== null && doc.keyframes_json?.[selectedFrame] && (
              <div className={styles.keyframeDetail}>
                <img
                  src={getKeyframeUrl(doc.document_id, doc.keyframes_json[selectedFrame].filename)}
                  alt={`关键帧 ${selectedFrame + 1} 大图`}
                  className={styles.keyframeDetailImg}
                />
                <p className={styles.keyframeDescription}>
                  {doc.keyframes_json[selectedFrame].description}
                </p>
              </div>
            )}
          </div>
        )}

        {/* 字幕 Tab */}
        {activeTab === 'transcript' && (
          <div className={styles.transcriptSection}>
            {doc.transcript_json?.map((seg, i) => (
              <div key={i} className={styles.transcriptLine}>
                <span className={styles.transcriptTime}>
                  {formatDuration(Math.floor(seg.start))}
                </span>
                <span className={styles.transcriptText}>{seg.text}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
=======
  file_type?: 'document' | 'video';
  // 视频专用
  duration_sec?: number;
  process_stage?: string;
  transcript_json?: TranscriptSegment[];
  keyframes_json?: KeyframeInfo[];
  video_summary?: string;
>>>>>>> origin/backend-dev
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
<<<<<<< HEAD
  const [uploading, setUploading] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<KBDocument | null>(null);
=======
  const [uploading,  setUploading]  = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
>>>>>>> origin/backend-dev
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

<<<<<<< HEAD
  // Poll every 3s while any doc is processing / video still pending
=======
  // 每 3s 轮询处理中的文档
>>>>>>> origin/backend-dev
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

  const handleDelete = async (documentId: string) => {
    if (!window.confirm('确认从知识库中删除该文件？此操作不可撤销。')) return;
    try {
      await deleteKnowledgeDoc(documentId);
<<<<<<< HEAD
      setDocuments((prev) => prev.filter((d) => d.document_id !== documentId));
      if (selectedDoc?.document_id === documentId) setSelectedDoc(null);
=======
      setDocuments(prev => prev.filter(d => d.document_id !== documentId));
>>>>>>> origin/backend-dev
    } catch {
      console.error('Delete failed');
    }
  };

<<<<<<< HEAD
  /** 重试解析失败的文档 */
  const handleRetry = async (documentId: string) => {
    try {
      // 乐观更新本地状态，让用户立即看到【处理中】
      const patch = (prev: KBDocument[]) =>
        prev.map(d =>
          d.document_id === documentId
            ? { ...d, status: 'processing', progress: 0, process_stage: undefined }
            : d
        );
      setDocuments(patch);
      setSelectedDoc(prev =>
        prev?.document_id === documentId
          ? { ...prev, status: 'processing', progress: 0 }
          : prev
      );
      // 调用后端接口
      await retryKnowledgeDocument(documentId);
      // 刷新列表，让轮询接管理剩余状态
      await fetchDocs(true);
    } catch {
      console.error('[handleRetry] failed, refreshing list');
      fetchDocs(true);
    }
  };

  const handleRowClick = (doc: KBDocument) => {
    setSelectedDoc(prev => prev?.document_id === doc.document_id ? null : doc);
  };

  return (
    <div className={clsx(styles.panelRoot, compact && styles.panelCompact, selectedDoc && styles.panelWithPreview)}>

      {/* ── 左侧主内容区 ── */}
      <div className={styles.panelMain}>
        {/* Header */}
        {!compact && (
          <header className={styles.pageHeader}>
            <div>
              <h1 className={styles.title}>知识库管理</h1>
              <p className={styles.subtitle}>
                上传专业课件资料、教案文档或学习视频。它们将被自动分析并向量化，强化 AI 智能体的领域理解能力。
              </p>
            </div>
            <button className={clsx('button-base', styles.refreshBtn)} onClick={() => fetchDocs(false)} title="刷新列表">
              <RefreshCw size={16} />
=======
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
          <button className={clsx('button-base', styles.refreshBtn)} onClick={() => fetchDocs(false)} title="刷新列表">
            <RefreshCw size={16} />
          </button>
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
>>>>>>> origin/backend-dev
            </button>
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
            accept=".pdf,.docx,.doc,.pptx,.ppt,.txt,.md,.json,.csv,.mp4,.mov,.avi,.webm,.mkv,.flv"
          />
          <div className={styles.uploadContent}>
            <div className={styles.uploadIconWrapper}>
              <UploadCloud size={compact ? 32 : 42} className={clsx(uploading && styles.rotating)} />
            </div>
            <h3>{uploading ? '上传中，请稍候...' : '点击或拖拽文件到这里上传'}</h3>
            <p>文档（PDF / Word / PPT）或视频（MP4 / MOV / AVI 等）· 视频最大 500 MB</p>
          </div>
        </div>
<<<<<<< HEAD

        {/* Document Table */}
        <div className={clsx(styles.tableContainer, 'glass-panel')}>
          <div className={styles.tableHeader}>
            <h3 className={styles.tableTitle}>
              已入库文档 ({loading ? '…' : documents.length})
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
                  <th>类型</th>
                  <th>上传日期</th>
                  <th>解析状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={5} className={styles.emptyTable}><Clock size={14} className={styles.rotating} style={{display:'inline', marginRight:6}} />加载中...</td></tr>
                ) : documents.length === 0 ? (
                  <tr><td colSpan={5} className={styles.emptyTable}>尚未上传任何知识库文件</td></tr>
                ) : (
                  documents.map((doc) => {
                    const isVid = isVideo(doc);
                    const isSelected = selectedDoc?.document_id === doc.document_id;
                    return (
                      <tr
                        key={doc.document_id}
                        className={clsx(styles.tableRow, isSelected && styles.tableRowSelected)}
                        onClick={() => handleRowClick(doc)}
                        style={{ cursor: 'pointer' }}
                      >
                        <td>
                          <div className={styles.cellFile}>
                            {fileTypeIcon(doc)}
                            <span className={styles.filename}>{doc.filename}</span>
                            {isSelected && <ChevronRight size={13} className={styles.rowSelectedArrow} />}
                          </div>
                        </td>
                        <td>
                          <span className={clsx(styles.typeBadge, isVid ? styles.typeBadgeVideo : styles.typeBadgeDoc)}>
                            {isVid ? <><Video size={11} /> 视频</> : <><FileText size={11} /> 文档</>}
                          </span>
                        </td>
                        <td className={styles.cellDate}>
                          {doc.created_at ? new Date(doc.created_at).toLocaleDateString('zh-CN') : '—'}
                        </td>
                        <td>
                          {doc.status === 'completed' ? (
                            <div className={clsx(styles.statusBadge, styles.statusSuccess)}><CheckCircle size={13} /> 解析完成</div>
                          ) : doc.status === 'failed' ? (
                            <div className={clsx(styles.statusBadge, styles.statusFailed)}>✕ 解析失败</div>
                          ) : (
                            <div className={clsx(styles.statusBadge, styles.statusPending)}>
                              <Clock size={13} className={styles.rotating} />
                              {doc.process_stage
                                ? (VIDEO_STAGE_LABELS[doc.process_stage] ?? '处理中')
                                : `向量化中${doc.progress != null ? ` ${doc.progress}%` : ''}`
                              }
                            </div>
                          )}
                        </td>
                        <td onClick={e => e.stopPropagation()}>
                          <button className={styles.deleteBtn} onClick={() => handleDelete(doc.document_id)} title="删除">
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
=======
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
>>>>>>> origin/backend-dev
        </div>
      </div>

      {/* ── 右侧预览面板 ── */}
      {selectedDoc && (
        <KBDocPreviewPanel
          doc={selectedDoc}
          onClose={() => setSelectedDoc(null)}
          onDelete={handleDelete}
          onRetry={handleRetry}
        />
      )}
    </div>
  );
}

<<<<<<< HEAD
// ─────────────────────────────────────────────────────────────────────────────
// KnowledgeBase — route-level page wrapper
// ─────────────────────────────────────────────────────────────────────────────
=======
// ── KnowledgeBase 路由页 ──────────────────────────────────────────────────────

>>>>>>> origin/backend-dev
export default function KnowledgeBase() {
  return (
    <div className={styles.kbContainer}>
      <KnowledgeBasePanel compact={false} />
    </div>
  );
}
