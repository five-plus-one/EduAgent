import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  UploadCloud, FileText, CheckCircle, Clock, Trash2, RefreshCw,
  X, Video, FileVideo, RotateCcw, ChevronRight, AlertCircle,
  Film, ChevronUp, ChevronDown,
} from 'lucide-react';
import { clsx } from 'clsx';
import ReactMarkdown from 'react-markdown';
import styles from './KnowledgeBase.module.css';
import { uploadKnowledgeDoc, listKnowledgeDocs, deleteKnowledgeDoc } from '../utils/api';
import {
  getKeyframeUrl, formatDuration, retryKnowledgeDocument,
  VIDEO_STAGE_LABELS, VIDEO_STAGE_PROGRESS,
  type VideoProcessStage,
} from '../utils/videoKnowledgeApi';

// ─── 合并类型（兼容旧接口的 KBDocument 形状）─────────────────────
export interface KBDocument {
  document_id: string;
  filename: string;
  status: string;
  progress?: number;
  summary?: string;
  created_at?: string;
  file_type?: 'document' | 'video' | null;
  // 视频专属
  duration_sec?: number;
  process_stage?: VideoProcessStage;
  transcript_json?: { start: number; end: number; text: string }[];
  keyframes_json?: { filename: string; timestamp_est: number; description: string }[];
  video_summary?: string;
}

// ─── 工具函数 ────────────────────────────────────────────────────
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
}

// ── KnowledgeBasePanel ────────────────────────────────────────────────────────

export function KnowledgeBasePanel({ compact = false }: { compact?: boolean }) {
  const [documents, setDocuments] = useState<KBDocument[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<KBDocument | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);


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
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDelete = async (documentId: string) => {
    if (!window.confirm('确认从知识库中删除该文件？此操作不可撤销。')) return;
    try {
      await deleteKnowledgeDoc(documentId);
      setDocuments((prev) => prev.filter((d) => d.document_id !== documentId));
      if (selectedDoc?.document_id === documentId) setSelectedDoc(null);
    } catch {
      console.error('Delete failed');
    }
  };

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

// ─────────────────────────────────────────────────────────────────────────────
// KnowledgeBase — route-level page wrapper
// ─────────────────────────────────────────────────────────────────────────────
export default function KnowledgeBase() {
  return (
    <div className={styles.kbContainer}>
      <KnowledgeBasePanel compact={false} />
    </div>
  );
}
