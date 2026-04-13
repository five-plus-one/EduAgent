import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  UploadCloud, FileText, CheckCircle, Clock, Trash2, RefreshCw,
  X, Video, FileVideo, Download, Film, AlignLeft, RotateCcw,
  ChevronRight, Image as ImageIcon, Edit2, Loader2,
} from 'lucide-react';
import { clsx } from 'clsx';
import ReactMarkdown from 'react-markdown';
import styles from './KnowledgeBase.module.css';
import { uploadKnowledgeDoc, listKnowledgeDocs, deleteKnowledgeDoc } from '../utils/api';
import {
  getKeyframeUrl, getDownloadUrl, getPreviewUrl, formatDuration,
  retryKnowledgeDocument, patchKnowledgeDocument,
  VIDEO_STAGE_LABELS, VIDEO_STAGE_PROGRESS,
  type KBDocumentBase, type KBVideoDocument, type VideoProcessStage,
} from '../utils/videoKnowledgeApi';

// ─── 合并类型（兼容旧接口的 KBDocument 形状）─────────────────────
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
  file_type?: 'document' | 'video' | null;
  /** 处理中的细粒度阶段码 */
  process_stage?: VideoProcessStage;
  /**
   * ⭐ 后端直接返回的阶段中文文案（API v1.2 新增）
   * 优先用此字段，为空再查本地 VIDEO_STAGE_LABELS
   */
  stage_label?: string | null;
  metadata?: Record<string, unknown>;
  // 视频专属
  duration_sec?: number;
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

/** 优先显示 display_name，fallback 到 filename */
function getDisplayTitle(doc: KBDocument): string {
  return doc.display_name?.trim() || doc.filename;
}

/**
 * 获取当前阶段标签文案：优先用后端 stage_label（API v1.2），再 fallback 到本地映射表
 */
function getStageLabelText(doc: KBDocument): string {
  if (doc.stage_label) return doc.stage_label;
  if (doc.process_stage) return VIDEO_STAGE_LABELS[doc.process_stage] ?? doc.process_stage;
  return '';
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
  onRename,
}: {
  doc: KBDocument;
  onClose: () => void;
  onDelete: (id: string) => void;
  onRetry?: (id: string) => void;
  onRename?: (id: string, displayName: string) => Promise<void>;
}) {
  const [activeTab, setActiveTab] = useState<'summary' | 'keyframes' | 'transcript'>('summary');
  const [selectedFrame, setSelectedFrame] = useState<number | null>(null);
  // ── 重命名编辑状态 ──
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [isSavingName, setIsSavingName] = useState(false);
  const editInputRef = useRef<HTMLInputElement>(null);
  const isVid = isVideo(doc);

  // 切换 doc 时重置 tab & 编辑状态
  useEffect(() => {
    setActiveTab('summary');
    setSelectedFrame(null);
    setIsEditing(false);
  }, [doc.document_id]);

  // 进入编辑模式时自动聚焦
  useEffect(() => {
    if (isEditing) {
      editInputRef.current?.select();
    }
  }, [isEditing]);

  const startEdit = () => {
    setEditValue(doc.display_name?.trim() || doc.filename);
    setIsEditing(true);
  };

  const cancelEdit = () => { setIsEditing(false); };

  const commitEdit = async () => {
    const trimmed = editValue.trim();
    if (!trimmed || trimmed === getDisplayTitle(doc)) {
      setIsEditing(false);
      return;
    }
    if (!onRename) { setIsEditing(false); return; }
    setIsSavingName(true);
    try {
      await onRename(doc.document_id, trimmed);
    } finally {
      setIsSavingName(false);
      setIsEditing(false);
    }
  };

  const handleEditKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
    if (e.key === 'Escape') { cancelEdit(); }
  };

  const tabs = [
    { id: 'summary' as const,    label: 'AI 摘要',    show: true },
    { id: 'keyframes' as const,  label: '关键帧',     show: isVid && (doc.keyframes_json?.length ?? 0) > 0 },
    { id: 'transcript' as const, label: '字幕',       show: isVid && (doc.transcript_json?.length ?? 0) > 0 },
  ].filter(t => t.show);

  // v1.2: 优先用后端 stage_label，fallback 到本地映射
  const stageLabel = getStageLabelText(doc);
  // v1.2: 优先用后端 progress，fallback 到本地阶段表
  const stageProgress = doc.progress ?? (
    doc.process_stage ? (VIDEO_STAGE_PROGRESS[doc.process_stage] ?? 0) : 0
  );
  // 下载/预览 URL（token 自动注入）
  const downloadUrl = getDownloadUrl(doc.document_id);
  const previewUrl  = getPreviewUrl(doc.document_id);
  const canPreview  = doc.status === 'completed';

  return (
    <div className={styles.preview}>
      {/* ── 头部 ── */}
      <div className={styles.previewHeader}>
        <div className={styles.previewHeaderLeft}>
          {isVid
            ? <span className={styles.previewTypeTag}><Film size={12} /> 视频</span>
            : <span className={styles.previewTypeTagDoc}><FileText size={12} /> 文档</span>
          }
          {isEditing ? (
            <input
              ref={editInputRef}
              className={styles.previewFilenameInput}
              value={editValue}
              onChange={e => setEditValue(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={handleEditKeyDown}
              disabled={isSavingName}
              maxLength={100}
              autoFocus
            />
          ) : (
            <span
              className={styles.previewFilename}
              title={doc.display_name ? `原始文件名: ${doc.filename}` : doc.filename}
            >
              {getDisplayTitle(doc)}
            </span>
          )}
          {onRename && !isEditing && (
            <button
              className={styles.renameBtn}
              onClick={startEdit}
              title="重命名"
            >
              <Edit2 size={12} />
            </button>
          )}
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
        {canPreview && (
          <a
            className={styles.actionBtnDownload}
            href={downloadUrl}
            download={doc.filename}
            title="下载原始文件"
          >
            <Download size={13} /> 下载
          </a>
        )}
        {(doc.status === 'failed' || doc.status === 'pending') && onRetry && (
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

// ─────────────────────────────────────────────────────────────────────────────
// KnowledgeBasePanel — reusable content component (used in both route + drawer)
// ─────────────────────────────────────────────────────────────────────────────
export function KnowledgeBasePanel({ compact = false }: { compact?: boolean }) {
  const [documents, setDocuments] = useState<KBDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<KBDocument | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 删除确认弹窗
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);
  // 弹窗退出动画状态
  const [dialogExiting, setDialogExiting] = useState(false);
  // 行删除状态: loading = API中 | exiting = 行退出动画中
  const [deletingRow, setDeletingRow] = useState<{ id: string; phase: 'loading' | 'exiting' } | null>(null);
  // 表格行内重命名编辑状态
  const [editingRow, setEditingRow] = useState<{ id: string; value: string } | null>(null);
  const rowEditInputRef = useRef<HTMLInputElement>(null);

  // 行内编辑 input 出现时自动聚焦
  useEffect(() => {
    if (editingRow) rowEditInputRef.current?.select();
  }, [editingRow?.id]);

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
      (doc) => doc.status === 'processing' || doc.status === 'pending'
    );
    if (!hasProcessing) return;
    const timer = setInterval(() => fetchDocs(true), 3000);
    return () => clearInterval(timer);
  }, [documents, fetchDocs]);

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files?.length) handleFiles(Array.from(e.dataTransfer.files));
  };
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) handleFiles(Array.from(e.target.files));
  };

  const handleFiles = async (files: File[]) => {
    setUploading(true);
    try {
      await Promise.all(files.map((f) => uploadKnowledgeDoc(f, { filename: f.name })));
      await fetchDocs();
    } catch {
      console.error('Upload failed');
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
      await deleteKnowledgeDoc(id);
      // 阶段 2: 切换到“删除成功”
      setConfirmDelete(prev => prev ? { ...prev, phase: 'success' } : null);
      // 带动列表更新
      setDocuments(prev => prev.filter(d => d.document_id !== id));
      if (selectedDoc?.document_id === id) setSelectedDoc(null);
      // 1.2 秒后自动关闭弹窗
      setTimeout(() => setConfirmDelete(null), 1200);
    } catch {
      console.error('Delete failed');
      // 失败时回到确认状态
      setConfirmDelete(prev => prev ? { ...prev, phase: 'confirm' } : null);
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

  /** 修改文档显示名（重命名） */
  const handleRename = async (documentId: string, displayName: string): Promise<void> => {
    // 乐观更新，让用户立即看到新名字
    const applyName = (d: KBDocument): KBDocument =>
      d.document_id === documentId ? { ...d, display_name: displayName } : d;
    setDocuments(prev => prev.map(applyName));
    setSelectedDoc(prev => prev?.document_id === documentId ? applyName(prev) : prev);
    try {
      await patchKnowledgeDocument(documentId, { display_name: displayName });
    } catch {
      console.error('[handleRename] failed, rolling back');
      // 回滚：重新拉列表
      fetchDocs(true);
    }
  };

  /** 表格行重命名提交 */
  const commitRowRename = async () => {
    if (!editingRow) return;
    const { id, value } = editingRow;
    setEditingRow(null);
    const doc = documents.find(d => d.document_id === id);
    const trimmed = value.trim();
    if (trimmed && trimmed !== getDisplayTitle(doc ?? { document_id: '', filename: id, status: '', progress: 0, file_type: null })) {
      await handleRename(id, trimmed);
    }
  };

  const handleRowClick = (doc: KBDocument) => {
    if (editingRow?.id === doc.document_id) return; // 重命名中不干扰选中状态
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
                      className={clsx(
                        styles.tableRow,
                        isSelected && styles.tableRowSelected,
                        deletingRow?.id === doc.document_id && deletingRow.phase === 'exiting' && styles.tableRowExiting,
                      )}
                      onClick={() => handleRowClick(doc)}
                      style={{ cursor: 'pointer' }}
                    >
                      <td>
                        <div className={styles.cellFile}>
                          {fileTypeIcon(doc)}
                          {editingRow?.id === doc.document_id ? (
                            <input
                              ref={rowEditInputRef}
                              className={styles.rowRenameInput}
                              value={editingRow.value}
                              onChange={e => setEditingRow(r => r ? { ...r, value: e.target.value } : r)}
                              onBlur={commitRowRename}
                              onKeyDown={e => {
                                if (e.key === 'Enter') { e.preventDefault(); commitRowRename(); }
                                if (e.key === 'Escape') setEditingRow(null);
                              }}
                              maxLength={100}
                              autoFocus
                              onClick={e => e.stopPropagation()}
                            />
                          ) : (
                            <span className={styles.filename} title={doc.display_name ? doc.filename : undefined}>
                              {getDisplayTitle(doc)}
                            </span>
                          )}
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
                        {/* 删除中：显示覆盖状态 */}
                        {deletingRow?.id === doc.document_id ? (
                          <div className={clsx(styles.statusBadge, styles.statusPending)}>
                            <Loader2 size={13} className={styles.rotating} />
                            {deletingRow.phase === 'loading' ? '删除中…' : '清理中…'}
                          </div>
                        ) : doc.status === 'completed' ? (
                          <div className={clsx(styles.statusBadge, styles.statusSuccess)}><CheckCircle size={13} /> 解析完成</div>
                        ) : doc.status === 'failed' ? (
                          <div className={clsx(styles.statusBadge, styles.statusFailed)}>✕ 解析失败</div>
                        ) : doc.status === 'pending' ? (
                          <div className={clsx(styles.statusBadge, styles.statusPending)}>
                            <Clock size={13} className={styles.rotating} /> 排队中
                          </div>
                        ) : (
                          <div className={clsx(styles.statusBadge, styles.statusPending)}>
                            <Clock size={13} className={styles.rotating} />
                            {getStageLabelText(doc) || `处理中${doc.progress != null ? ` ${doc.progress}%` : ''}`}
                          </div>
                        )}
                      </td>
                      <td onClick={e => e.stopPropagation()} className={styles.cellActions}>
                        <button
                          className={styles.actionIconBtn}
                          title="重命名"
                          disabled={!!deletingRow && deletingRow.id === doc.document_id}
                          onClick={() => setEditingRow({ id: doc.document_id, value: getDisplayTitle(doc) })}
                        >
                          <Edit2 size={13} />
                        </button>
                        <button
                          className={clsx(styles.actionIconBtn, styles.actionIconBtnDanger)}
                          title="删除"
                          disabled={!!deletingRow && deletingRow.id === doc.document_id}
                          onClick={() => handleDelete(doc.document_id)}
                        >
                          <Trash2 size={13} />
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
          onRename={handleRename}
        />
      )}

      {/* ── 删除确认弹窗 ── */}
      {confirmDelete && (
        <div
          className={clsx(styles.dialogOverlay, dialogExiting && styles.dialogOverlayExiting)}
          onClick={() => !dialogExiting && setConfirmDelete(null)}
        >
          <div
            className={clsx(styles.dialogCard, dialogExiting && styles.dialogCardExiting)}
            onClick={e => e.stopPropagation()}
          >
            <div className={styles.dialogIcon}><Trash2 size={22} /></div>
            <h3 className={styles.dialogTitle}>确认删除</h3>
            <p className={styles.dialogBody}>
              将从知识库中删除
              <span className={styles.dialogFileName}>「{confirmDelete.name}」</span>，
              包括向量索引、原始文件及视频工作目录。
              <br /><strong>此操作不可撤销。</strong>
            </p>
            <div className={styles.dialogActions}>
              <button className={styles.dialogBtnCancel} onClick={() => setConfirmDelete(null)}>取消</button>
              <button className={styles.dialogBtnConfirm} onClick={performDelete}>确认删除</button>
            </div>
          </div>
        </div>
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
