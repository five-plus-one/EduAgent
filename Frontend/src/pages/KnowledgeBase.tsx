import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  UploadCloud, FileText, CheckCircle, Clock, Trash2, RefreshCw,
  FileVideo, AlertCircle, X, Download, RotateCcw, Pencil, Check,
  ChevronDown, ChevronUp, Loader2,
} from 'lucide-react';
import { clsx } from 'clsx';
import ReactMarkdown from 'react-markdown';
import styles from './KnowledgeBase.module.css';
import { uploadKnowledgeDoc, listKnowledgeDocs, deleteKnowledgeDoc } from '../utils/api';
import {
  getKeyframeUrl, getDownloadUrl, getPreviewUrl, formatDuration,
  retryKnowledgeDocument, patchKnowledgeDocument,
  VIDEO_STAGE_LABELS,
} from '../utils/videoKnowledgeApi';

// ── 类型 ───────────────────────────────────────────────────────

export interface TranscriptSegment { start: number; end: number; text: string; }
export interface KeyframeInfo { filename: string; timestamp_est: number; description: string; }

export interface KBDocument {
  document_id: string;
  filename: string;
  display_name?: string | null;
  description?: string | null;
  status: string;
  progress?: number;
  summary?: string | null;
  created_at?: string;
  file_type?: 'document' | 'video' | null;
  duration_sec?: number;
  process_stage?: string;
  stage_label?: string | null;
  transcript_json?: TranscriptSegment[];
  keyframes_json?: KeyframeInfo[];
  video_summary?: string;
}

// 获取展示标题（display_name 优先 → filename）
function getTitle(doc: KBDocument): string {
  return doc.display_name?.trim() || doc.filename;
}

function fmtDate(iso?: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── 删除确认弹窗 ───────────────────────────────────────────────

interface DeleteDialogProps {
  docName: string;
  phase: 'confirm' | 'deleting';
  onConfirm: () => void;
  onCancel: () => void;
}

function DeleteDialog({ docName, phase, onConfirm, onCancel }: DeleteDialogProps) {
  return (
    <div className={styles.dialogOverlay} onClick={phase === 'confirm' ? onCancel : undefined}>
      <div className={styles.dialogCard} onClick={e => e.stopPropagation()}>
        <div className={clsx(styles.dialogIcon, phase === 'deleting' && styles.dialogIconDeleting)}>
          {phase === 'deleting'
            ? <Loader2 size={22} className={styles.dialogSpinner} />
            : <Trash2 size={22} />}
        </div>
        <p className={styles.dialogTitle}>
          {phase === 'deleting' ? '正在删除...' : '确认删除'}
        </p>
        <p className={styles.dialogBody}>
          {phase === 'deleting'
            ? '请稍候，正在从知识库移除该文件。'
            : <>将永久删除 <span className={styles.dialogFileName}>「{docName}」</span>，无法恢复。</>}
        </p>
        {phase === 'confirm' && (
          <div className={styles.dialogActions}>
            <button className={styles.dialogBtnCancel} onClick={onCancel}>取消</button>
            <button className={styles.dialogBtnConfirm} onClick={onConfirm}>确认删除</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── 右侧预览抽屉 ────────────────────────────────────────────────

interface PreviewPanelProps {
  doc: KBDocument;
  apiBase: string;
  onClose: () => void;
  onDelete: (id: string) => void;
  onRetry: (id: string) => void;
  onRename: (id: string, name: string) => void;
}

function PreviewPanel({ doc, apiBase, onClose, onDelete, onRetry, onRename }: PreviewPanelProps) {
  const [tab, setTab] = useState<'summary' | 'frames' | 'transcript'>('summary');
  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState(getTitle(doc));
  const [selectedFrame, setSelectedFrame] = useState<number | null>(null);
  const [showFrames, setShowFrames] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const isVideo = doc.file_type === 'video';
  const isProcessing = doc.status === 'processing' || doc.status === 'pending';
  const hasFrames = (doc.keyframes_json?.length ?? 0) > 0;
  const hasTranscript = (doc.transcript_json?.length ?? 0) > 0;
  const hasSummary = !!(isVideo ? doc.video_summary : doc.summary);

  // Sync display name when doc changes
  useEffect(() => { setNameVal(getTitle(doc)); }, [doc.document_id, doc.display_name, doc.filename]);

  // Auto-select first frame
  useEffect(() => {
    if (hasFrames && doc.keyframes_json) setSelectedFrame(0);
  }, [doc.document_id]);

  // Pick available tabs for video
  const tabs = isVideo
    ? [
        { key: 'summary' as const,    label: 'AI 摘要' },
        ...(hasFrames     ? [{ key: 'frames'     as const, label: `关键帧 (${doc.keyframes_json!.length})` }] : []),
        ...(hasTranscript ? [{ key: 'transcript' as const, label: `字幕 (${doc.transcript_json!.length})` }] : []),
      ]
    : [{ key: 'summary' as const, label: '摘要' }];

  const commitRename = () => {
    const trimmed = nameVal.trim();
    if (trimmed && trimmed !== getTitle(doc)) onRename(doc.document_id, trimmed);
    setEditingName(false);
  };

  const stageLabel =
    doc.stage_label
    ?? (doc.process_stage ? VIDEO_STAGE_LABELS[doc.process_stage as any] ?? `处理中 ${doc.progress ?? 0}%` : `处理中 ${doc.progress ?? 0}%`);

  return (
    <div className={styles.preview}>
      {/* ── 头部 ── */}
      <div className={styles.previewHeader}>
        <div className={styles.previewHeaderLeft}>
          {isVideo
            ? <span className={styles.previewTypeTag}><FileVideo size={11} /> 视频</span>
            : <span className={styles.previewTypeTagDoc}><FileText size={11} /> 文档</span>}

          {editingName ? (
            <input
              ref={nameInputRef}
              className={styles.previewFilenameInput}
              value={nameVal}
              onChange={e => setNameVal(e.target.value)}
              onBlur={commitRename}
              onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setEditingName(false); }}
              autoFocus
            />
          ) : (
            <span className={styles.previewFilename} title={getTitle(doc)}>{getTitle(doc)}</span>
          )}

          {!editingName && (
            <button
              className={styles.renameBtn}
              onClick={() => { setEditingName(true); setTimeout(() => nameInputRef.current?.select(), 30); }}
              title="重命名"
            >
              <Pencil size={13} />
            </button>
          )}
          {editingName && (
            <button className={styles.renameBtn} style={{opacity:1}} onClick={commitRename} title="确认">
              <Check size={13} />
            </button>
          )}
        </div>
        <button className={styles.previewClose} onClick={onClose} title="关闭"><X size={16} /></button>
      </div>

      {/* ── 元信息 ── */}
      <div className={styles.previewMeta}>
        {doc.status === 'completed' && (
          <span className={clsx(styles.previewMetaItem, styles.previewMetaSuccess)}>
            <CheckCircle size={12} /> 已就绪
          </span>
        )}
        {doc.status === 'failed' && (
          <span className={clsx(styles.previewMetaItem, styles.previewMetaFailed)}>
            <AlertCircle size={12} /> 处理失败
          </span>
        )}
        {isProcessing && (
          <span className={clsx(styles.previewMetaItem, styles.previewMetaPending)}>
            <Loader2 size={12} className={styles.rotating} /> {stageLabel}
          </span>
        )}
        {doc.created_at && (
          <span className={styles.previewMetaItem}>
            <Clock size={12} /> {fmtDate(doc.created_at)}
          </span>
        )}
        {isVideo && doc.duration_sec && (
          <span className={styles.previewMetaItem}>
            🕐 {formatDuration(doc.duration_sec)}
          </span>
        )}
      </div>

      {/* ── 进度条（处理中） ── */}
      {isProcessing && (
        <div className={styles.progressWrap}>
          <div className={styles.progressBar}>
            <div className={styles.progressFill} style={{ width: `${doc.progress ?? 0}%` }} />
          </div>
          <span className={styles.progressLabel}>{doc.progress ?? 0}%</span>
        </div>
      )}

      {/* ── 操作栏 ── */}
      <div className={styles.previewActions}>
        {doc.status === 'completed' && (
          <a
            href={getDownloadUrl(doc.document_id)}
            download={doc.filename}
            className={styles.actionBtnDownload}
          >
            <Download size={13} /> 下载
          </a>
        )}
        {(doc.status === 'failed' || doc.status === 'pending') && (
          <button className={styles.actionBtnRetry} onClick={() => onRetry(doc.document_id)}>
            <RotateCcw size={13} /> 重试
          </button>
        )}
        <button className={styles.actionBtnDanger} onClick={() => onDelete(doc.document_id)}>
          <Trash2 size={13} /> 删除
        </button>
      </div>

      {/* ── 内容区（视频 Tab / 文档摘要） ── */}
      {isVideo && doc.status === 'completed' && (
        <>
          <div className={styles.previewTabs}>
            {tabs.map(t => (
              <button
                key={t.key}
                className={clsx(styles.previewTab, tab === t.key && styles.previewTabActive)}
                onClick={() => setTab(t.key)}
              >{t.label}</button>
            ))}
          </div>
          <div className={styles.previewBody}>
            {tab === 'summary' && (
              <div className={styles.summarySection}>
                {doc.video_summary
                  ? <div className={styles.markdownBody}><ReactMarkdown>{doc.video_summary}</ReactMarkdown></div>
                  : <p className={styles.summaryEmpty}>暂无 AI 摘要</p>}
              </div>
            )}
            {tab === 'frames' && hasFrames && (
              <div className={styles.keyframesSection}>
                <div className={styles.keyframeGrid}>
                  {doc.keyframes_json!.map((kf, i) => (
                    <button
                      key={i}
                      className={clsx(styles.keyframeCard, selectedFrame === i && styles.keyframeCardActive)}
                      onClick={() => setSelectedFrame(i)}
                    >
                      <div className={styles.keyframeImgWrap}>
                        <img src={getKeyframeUrl(doc.document_id, kf.filename)} alt={`帧${i+1}`} className={styles.keyframeImg} />
                        <span className={styles.keyframeTimestamp}>{formatDuration(kf.timestamp_est)}</span>
                      </div>
                      <div className={styles.keyframeIndex}>帧 {i + 1}</div>
                    </button>
                  ))}
                </div>
                {selectedFrame !== null && doc.keyframes_json![selectedFrame] && (
                  <div className={styles.keyframeDetail}>
                    <img
                      src={getKeyframeUrl(doc.document_id, doc.keyframes_json![selectedFrame].filename)}
                      alt={`帧${selectedFrame+1} 详情`}
                      className={styles.keyframeDetailImg}
                    />
                    {doc.keyframes_json![selectedFrame].description && (
                      <p className={styles.keyframeDescription}>{doc.keyframes_json![selectedFrame].description}</p>
                    )}
                  </div>
                )}
              </div>
            )}
            {tab === 'transcript' && hasTranscript && (
              <div className={styles.transcriptSection}>
                {doc.transcript_json!.map((seg, i) => (
                  <div key={i} className={styles.transcriptLine}>
                    <span className={styles.transcriptTime}>{formatDuration(Math.floor(seg.start))}</span>
                    <span className={styles.transcriptText}>{seg.text}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* 文档摘要 */}
      {!isVideo && (
        <div className={styles.previewBody}>
          {doc.status === 'completed' ? (
            hasSummary
              ? <div className={styles.markdownBody}><ReactMarkdown>{doc.summary!}</ReactMarkdown></div>
              : <p className={styles.summaryEmpty}>暂无摘要内容</p>
          ) : isProcessing ? (
            <p className={styles.summaryEmpty}>⏳ 正在解析文档，完成后将显示摘要...</p>
          ) : doc.status === 'failed' ? (
            <p className={styles.summaryEmpty}>❌ 文档解析失败，可点击上方「重试」按钮重试。</p>
          ) : (
            <p className={styles.summaryEmpty}>暂无内容</p>
          )}
        </div>
      )}

      {/* 视频处理中占位 */}
      {isVideo && isProcessing && (
        <div className={styles.previewBody}>
          <p className={styles.summaryEmpty}>⏳ 视频正在分析中，完成后将显示摘要、关键帧和字幕...</p>
        </div>
      )}
      {isVideo && doc.status === 'failed' && (
        <div className={styles.previewBody}>
          <p className={styles.summaryEmpty}>❌ 视频处理失败，可点击上方「重试」按钮重试。</p>
        </div>
      )}
    </div>
  );
}

// ── KnowledgeBasePanel ─────────────────────────────────────────

export function KnowledgeBasePanel({ compact = false }: { compact?: boolean }) {
  const [documents, setDocuments] = useState<KBDocument[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading,  setUploading]  = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [selectedDoc, setSelectedDoc] = useState<KBDocument | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string; phase: 'confirm' | 'deleting' } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const apiBase = (import.meta as any).env?.VITE_API_BASE_URL ?? 'http://localhost:8000/api/v1';

  // ── 拉取列表 ──────────────────────────────────────────────────
  const fetchDocs = useCallback(async (isSilent = false) => {
    try {
      if (!isSilent) setLoading(true);
      const data = await listKnowledgeDocs(1, 50);
      const items: KBDocument[] = data?.items ?? (Array.isArray(data) ? data : []);
      setDocuments(items);
      // 同步刷新当前预览文档
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

  // 处理中自动轮询
  useEffect(() => {
    const hasProcessing = documents.some(d => d.status === 'processing' || d.status === 'pending');
    if (!hasProcessing) return;
    const timer = setInterval(() => fetchDocs(true), 3000);
    return () => clearInterval(timer);
  }, [documents, fetchDocs]);

  // ── 上传 ──────────────────────────────────────────────────────
  const handleDragOver  = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); };
  const handleDrop      = (e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    if (e.dataTransfer.files?.length) handleFiles(Array.from(e.dataTransfer.files));
  };
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) handleFiles(Array.from(e.target.files));
  };

  const handleFiles = async (files: File[]) => {
    setUploadError(null);
    for (const f of files) {
      const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
      const isVideo = ['mp4', 'mov', 'avi', 'webm', 'mkv', 'flv'].includes(ext);
      const limitMB = isVideo ? 500 : 100;
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

  // ── 删除 ──────────────────────────────────────────────────────
  const handleDelete = (documentId: string) => {
    const doc = documents.find(d => d.document_id === documentId);
    setConfirmDelete({ id: documentId, name: getTitle(doc ?? { document_id: documentId, filename: documentId, status: '' }), phase: 'confirm' });
  };

  const performDelete = async () => {
    if (!confirmDelete) return;
    const { id } = confirmDelete;
    setConfirmDelete(prev => prev ? { ...prev, phase: 'deleting' } : null);
    try {
      await deleteKnowledgeDoc(id);
      setDocuments(prev => prev.filter(d => d.document_id !== id));
      if (selectedDoc?.document_id === id) setSelectedDoc(null);
      setConfirmDelete(null);
    } catch {
      console.error('Delete failed');
      setConfirmDelete(prev => prev ? { ...prev, phase: 'confirm' } : null);
    }
  };

  // ── 重试 ──────────────────────────────────────────────────────
  const handleRetry = async (documentId: string) => {
    try {
      await retryKnowledgeDocument(documentId);
      await fetchDocs(true);
    } catch (err) {
      console.error('Retry failed', err);
    }
  };

  // ── 重命名 ────────────────────────────────────────────────────
  const handleRename = async (documentId: string, newName: string) => {
    try {
      await patchKnowledgeDocument(documentId, { display_name: newName });
      setDocuments(prev => prev.map(d =>
        d.document_id === documentId ? { ...d, display_name: newName } : d
      ));
      setSelectedDoc(prev =>
        prev?.document_id === documentId ? { ...prev, display_name: newName } : prev
      );
    } catch (err) {
      console.error('Rename failed', err);
    }
  };

  // ── 渲染 ──────────────────────────────────────────────────────
  const hasPreview = !!selectedDoc;

  return (
    <div className={clsx(styles.panelRoot, hasPreview && styles.panelWithPreview, compact && styles.panelCompact)}>
      {/* ── 左侧主区 ── */}
      <div className={styles.panelMain}>
        {!compact && (
          <header className={styles.pageHeader}>
            <div>
              <h1 className={styles.title}>知识库管理</h1>
              <p className={styles.subtitle}>
                上传课件、教案或视频，自动解析向量化，强化 AI 领域理解能力。
              </p>
            </div>
          </header>
        )}

        {/* 上传区 */}
        <div
          className={clsx(styles.uploadZone, 'glass-panel', isDragging && styles.dragging, uploading && styles.uploading)}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => !uploading && fileInputRef.current?.click()}
        >
          <input
            type="file" ref={fileInputRef} style={{ display: 'none' }}
            onChange={handleFileSelect} multiple
            accept=".pdf,.docx,.doc,.pptx,.txt,.md,.json,.csv,.mp4,.mov,.avi,.webm,.mkv,.flv"
          />
          <div className={styles.uploadContent}>
            <div className={styles.uploadIconWrapper}>
              <UploadCloud size={compact ? 28 : 40} className={clsx(uploading && styles.rotating)} />
            </div>
            <h3>{uploading ? '上传中，请稍候...' : '点击或拖拽文件上传'}</h3>
            <p>文档（PDF / Word / PPT，≤ 100 MB）&nbsp;|&nbsp;视频（MP4 / MOV，≤ 500 MB）</p>
          </div>
        </div>

        {uploadError && (
          <div className={styles.uploadError}>
            <AlertCircle size={15} /> {uploadError}
          </div>
        )}

        {/* 文件列表 */}
        <div className={clsx(styles.tableContainer, 'glass-panel')}>
          <div className={styles.tableHeader}>
            <h3 className={styles.tableTitle}>
              已入库文件 ({loading ? '…' : documents.length})
            </h3>
            <button className={clsx('button-base', styles.refreshBtn)} onClick={() => fetchDocs(false)} title="刷新">
              <RefreshCw size={14} />
            </button>
          </div>
          <div className={styles.tableWrapper}>
            <table className={styles.dataTable}>
              <thead>
                <tr>
                  <th>文件名</th>
                  <th>类型</th>
                  <th>上传日期</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={5} className={styles.emptyTable}>
                    <Clock size={14} className={styles.rotating} style={{ display: 'inline', marginRight: 6 }} />加载中...
                  </td></tr>
                ) : documents.length === 0 ? (
                  <tr><td colSpan={5} className={styles.emptyTable}>尚未上传任何知识库文件</td></tr>
                ) : (
                  documents.map(doc => {
                    const isVideo = doc.file_type === 'video';
                    const isProcessing = doc.status === 'processing' || doc.status === 'pending';
                    const isSelected = selectedDoc?.document_id === doc.document_id;
                    return (
                      <tr
                        key={doc.document_id}
                        className={clsx(styles.tableRow, isSelected && styles.tableRowSelected)}
                        onClick={() => setSelectedDoc(isSelected ? null : doc)}
                        style={{ cursor: 'pointer' }}
                      >
                        <td>
                          <div className={styles.cellFile}>
                            {isVideo
                              ? <FileVideo size={16} className={styles.fileIconVideo} />
                              : <FileText size={16} className={styles.fileIcon} />}
                            <span className={styles.filename} title={getTitle(doc)}>{getTitle(doc)}</span>
                          </div>
                        </td>
                        <td>
                          <span className={clsx(styles.typeBadge, isVideo ? styles.typeBadgeVideo : styles.typeBadgeDoc)}>
                            {isVideo ? '视频' : '文档'}
                          </span>
                        </td>
                        <td className={styles.cellDate}>{fmtDate(doc.created_at)}</td>
                        <td>
                          {doc.status === 'completed' ? (
                            <div className={clsx(styles.statusBadge, styles.statusSuccess)}><CheckCircle size={13} /> 已就绪</div>
                          ) : doc.status === 'failed' ? (
                            <div className={clsx(styles.statusBadge, styles.statusFailed)}><AlertCircle size={13} /> 失败</div>
                          ) : (
                            <div className={clsx(styles.statusBadge, styles.statusPending)}>
                              <Loader2 size={13} className={styles.rotating} />
                              {isProcessing
                                ? (doc.stage_label ?? (doc.process_stage ? (VIDEO_STAGE_LABELS[doc.process_stage as any] ?? '处理中') : '处理中'))
                                : '等待中'}
                              {doc.progress != null && ` ${doc.progress}%`}
                            </div>
                          )}
                        </td>
                        <td>
                          <div className={styles.cellActions} onClick={e => e.stopPropagation()}>
                            {(doc.status === 'failed' || doc.status === 'pending') && (
                              <button
                                className={styles.actionIconBtn}
                                title="重试"
                                onClick={() => handleRetry(doc.document_id)}
                              ><RotateCcw size={14} /></button>
                            )}
                            <button
                              className={clsx(styles.actionIconBtn, styles.actionIconBtnDanger)}
                              title="删除"
                              onClick={() => handleDelete(doc.document_id)}
                            ><Trash2 size={14} /></button>
                          </div>
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

      {/* ── 右侧预览抽屉（非 compact 模式才显示） ── */}
      {selectedDoc && !compact && (
        <PreviewPanel
          doc={selectedDoc}
          apiBase={apiBase}
          onClose={() => setSelectedDoc(null)}
          onDelete={handleDelete}
          onRetry={handleRetry}
          onRename={handleRename}
        />
      )}

      {/* ── 删除确认弹窗 ── */}
      {confirmDelete && (
        <DeleteDialog
          docName={confirmDelete.name}
          phase={confirmDelete.phase}
          onConfirm={performDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

// ── 路由页 ─────────────────────────────────────────────────────

export default function KnowledgeBase() {
  return (
    <div className={styles.kbContainer}>
      <KnowledgeBasePanel compact={false} />
    </div>
  );
}
