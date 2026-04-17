import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Clock3,
  Download,
  FileText,
  FileVideo,
  Loader2,
  Pencil,
  RefreshCw,
  RotateCcw,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react';
import { clsx } from 'clsx';
import ReactMarkdown from 'react-markdown';
import styles from './KnowledgeBase.module.css';
import { deleteKnowledgeDoc, listKnowledgeDocs, uploadKnowledgeDoc } from '../utils/api';
import {
  VIDEO_STAGE_LABELS,
  formatDuration,
  getDownloadUrl,
  getKeyframeUrl,
  patchKnowledgeDocument,
  retryKnowledgeDocument,
  type VideoProcessStage,
} from '../utils/videoKnowledgeApi';

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

function getTitle(doc: KBDocument): string {
  return doc.display_name?.trim() || doc.filename;
}

function formatDate(iso?: string) {
  if (!iso) return '未知时间';
  return new Date(iso).toLocaleDateString('zh-CN', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function getStageLabel(processStage?: string, progress?: number): string {
  if (processStage && processStage in VIDEO_STAGE_LABELS) {
    return VIDEO_STAGE_LABELS[processStage as VideoProcessStage];
  }
  return `处理中 ${progress ?? 0}%`;
}

interface DeleteDialogProps {
  docName: string;
  phase: 'confirm' | 'deleting';
  onConfirm: () => void;
  onCancel: () => void;
}

function DeleteDialog({ docName, phase, onConfirm, onCancel }: DeleteDialogProps) {
  return (
    <div className={styles.dialogOverlay} onClick={phase === 'confirm' ? onCancel : undefined}>
      <div className={styles.dialogCard} onClick={(e) => e.stopPropagation()}>
        <div className={clsx(styles.dialogIcon, phase === 'deleting' && styles.dialogIconBusy)}>
          {phase === 'deleting' ? <Loader2 size={20} className={styles.rotating} /> : <Trash2 size={20} />}
        </div>
        <h3 className={styles.dialogTitle}>{phase === 'deleting' ? '正在删除文档' : '确认删除文档'}</h3>
        <p className={styles.dialogBody}>
          {phase === 'deleting'
            ? '请稍候，系统正在从知识库中移除该文件。'
            : <>删除 <strong>{docName}</strong> 后将无法恢复。</>}
        </p>
        {phase === 'confirm' && (
          <div className={styles.dialogActions}>
            <button className={styles.dialogGhostBtn} onClick={onCancel}>取消</button>
            <button className={styles.dialogDangerBtn} onClick={onConfirm}>确认删除</button>
          </div>
        )}
      </div>
    </div>
  );
}

interface PreviewPanelProps {
  doc: KBDocument;
  compact?: boolean;
  onClose: () => void;
  onDelete: (id: string) => void;
  onRetry: (id: string) => void;
  onRename: (id: string, name: string) => void;
}

function PreviewPanel({ doc, compact = false, onClose, onDelete, onRetry, onRename }: PreviewPanelProps) {
  const [tab, setTab] = useState<'summary' | 'frames' | 'transcript'>('summary');
  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState(getTitle(doc));
  const [selectedFrame, setSelectedFrame] = useState<number>(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const isVideo = doc.file_type === 'video';
  const isProcessing = doc.status === 'processing' || doc.status === 'pending';
  const hasFrames = Boolean(doc.keyframes_json?.length);
  const hasTranscript = Boolean(doc.transcript_json?.length);

  useEffect(() => {
    setNameVal(getTitle(doc));
    setTab('summary');
    setSelectedFrame(0);
  }, [doc.document_id, doc.display_name, doc.filename]);

  useEffect(() => {
    if (editingName) {
      setTimeout(() => inputRef.current?.select(), 40);
    }
  }, [editingName]);

  const stageLabel = doc.stage_label ?? getStageLabel(doc.process_stage, doc.progress);

  const tabs = isVideo
    ? [
        { key: 'summary' as const, label: 'AI 摘要' },
        ...(hasFrames ? [{ key: 'frames' as const, label: `关键帧 ${doc.keyframes_json?.length}` }] : []),
        ...(hasTranscript ? [{ key: 'transcript' as const, label: `字幕 ${doc.transcript_json?.length}` }] : []),
      ]
    : [{ key: 'summary' as const, label: '文档摘要' }];

  const commitRename = () => {
    const next = nameVal.trim();
    if (next && next !== getTitle(doc)) {
      onRename(doc.document_id, next);
    }
    setEditingName(false);
  };

  const summaryText = isVideo ? doc.video_summary : doc.summary;

  return (
    <aside className={clsx(styles.previewPanel, compact && styles.previewPanelCompact)}>
      <div className={styles.previewHeader}>
        <div className={styles.previewHeaderMain}>
          <span className={clsx(styles.fileTypePill, isVideo ? styles.fileTypeVideo : styles.fileTypeDoc)}>
            {isVideo ? <FileVideo size={12} /> : <FileText size={12} />}
            {isVideo ? '视频' : '文档'}
          </span>
          {editingName ? (
            <input
              ref={inputRef}
              className={styles.previewNameInput}
              value={nameVal}
              onChange={(e) => setNameVal(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') setEditingName(false);
              }}
            />
          ) : (
            <h3 className={styles.previewTitle} title={getTitle(doc)}>{getTitle(doc)}</h3>
          )}
          <button className={styles.iconBtn} onClick={() => (editingName ? commitRename() : setEditingName(true))} title={editingName ? '保存名称' : '重命名'}>
            {editingName ? <Check size={14} /> : <Pencil size={14} />}
          </button>
        </div>
        <button className={styles.iconBtn} onClick={onClose} title="关闭预览"><X size={16} /></button>
      </div>

      <div className={styles.previewMeta}>
        {doc.status === 'completed' && <span className={clsx(styles.metaBadge, styles.metaSuccess)}><CheckCircle2 size={12} /> 已完成</span>}
        {doc.status === 'failed' && <span className={clsx(styles.metaBadge, styles.metaDanger)}><AlertCircle size={12} /> 失败</span>}
        {isProcessing && <span className={clsx(styles.metaBadge, styles.metaPending)}><Loader2 size={12} className={styles.rotating} /> {stageLabel}</span>}
        <span className={styles.metaBadge}><Clock3 size={12} /> {formatDate(doc.created_at)}</span>
        {isVideo && doc.duration_sec ? <span className={styles.metaBadge}>时长 {formatDuration(doc.duration_sec)}</span> : null}
      </div>

      {isProcessing && (
        <div className={styles.progressWrap}>
          <div className={styles.progressBar}>
            <div className={styles.progressFill} style={{ width: `${doc.progress ?? 0}%` }} />
          </div>
          <span className={styles.progressText}>{doc.progress ?? 0}%</span>
        </div>
      )}

      <div className={styles.previewActions}>
        {doc.status === 'completed' && (
          <a href={getDownloadUrl(doc.document_id)} download={doc.filename} className={styles.secondaryAction}>
            <Download size={14} /> 下载原文件
          </a>
        )}
        {(doc.status === 'failed' || doc.status === 'pending') && (
          <button className={styles.secondaryAction} onClick={() => onRetry(doc.document_id)}>
            <RotateCcw size={14} /> 重新处理
          </button>
        )}
        <button className={styles.dangerAction} onClick={() => onDelete(doc.document_id)}>
          <Trash2 size={14} /> 删除
        </button>
      </div>

      {tabs.length > 1 && (
        <div className={styles.previewTabs}>
          {tabs.map((item) => (
            <button
              key={item.key}
              className={clsx(styles.previewTab, tab === item.key && styles.previewTabActive)}
              onClick={() => setTab(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}

      <div className={styles.previewBody}>
        {tab === 'summary' && (
          <>
            {doc.status === 'completed' && summaryText ? (
              <div className={styles.markdownBody}><ReactMarkdown>{summaryText}</ReactMarkdown></div>
            ) : doc.status === 'failed' ? (
              <div className={styles.previewEmpty}>解析失败，可尝试重新处理。</div>
            ) : isProcessing ? (
              <div className={styles.previewEmpty}>文档正在处理中，完成后会在这里展示摘要。</div>
            ) : (
              <div className={styles.previewEmpty}>暂时还没有可展示的摘要。</div>
            )}
          </>
        )}

        {tab === 'frames' && hasFrames && doc.keyframes_json && (
          <div className={styles.framesLayout}>
            <div className={styles.frameGrid}>
              {doc.keyframes_json.map((frame, index) => (
                <button
                  key={`${frame.filename}-${index}`}
                  className={clsx(styles.frameThumb, selectedFrame === index && styles.frameThumbActive)}
                  onClick={() => setSelectedFrame(index)}
                >
                  <img src={getKeyframeUrl(doc.document_id, frame.filename)} alt={`关键帧 ${index + 1}`} className={styles.frameThumbImg} />
                  <span className={styles.frameTime}>{formatDuration(frame.timestamp_est)}</span>
                </button>
              ))}
            </div>
            {doc.keyframes_json[selectedFrame] && (
              <div className={styles.frameDetail}>
                <img
                  src={getKeyframeUrl(doc.document_id, doc.keyframes_json[selectedFrame].filename)}
                  alt="当前关键帧"
                  className={styles.frameDetailImg}
                />
                <p className={styles.frameDetailText}>{doc.keyframes_json[selectedFrame].description || '暂无关键帧描述。'}</p>
              </div>
            )}
          </div>
        )}

        {tab === 'transcript' && hasTranscript && doc.transcript_json && (
          <div className={styles.transcriptList}>
            {doc.transcript_json.map((segment, index) => (
              <div key={`${segment.start}-${index}`} className={styles.transcriptRow}>
                <span className={styles.transcriptTime}>{formatDuration(segment.start)}</span>
                <span className={styles.transcriptText}>{segment.text}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

export function KnowledgeBasePanel({ compact = false }: { compact?: boolean }) {
  const [documents, setDocuments] = useState<KBDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [selectedDoc, setSelectedDoc] = useState<KBDocument | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string; phase: 'confirm' | 'deleting' } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchDocs = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const data = await listKnowledgeDocs(1, 50);
      const items: KBDocument[] = data?.items ?? (Array.isArray(data) ? data : []);
      setDocuments(items);
      setSelectedDoc((prev) => (prev ? items.find((item) => item.document_id === prev.document_id) ?? prev : items[0] ?? null));
    } catch {
      // keep previous state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDocs();
  }, [fetchDocs]);

  useEffect(() => {
    const hasProcessing = documents.some((doc) => doc.status === 'processing' || doc.status === 'pending');
    if (!hasProcessing) return;
    const timer = setInterval(() => fetchDocs(true), 3000);
    return () => clearInterval(timer);
  }, [documents, fetchDocs]);

  const handleFiles = async (files: File[]) => {
    setUploadError(null);
    for (const file of files) {
      const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
      const isVideo = ['mp4', 'mov', 'avi', 'webm', 'mkv', 'flv'].includes(ext);
      const limitMB = isVideo ? 500 : 100;
      if (file.size > limitMB * 1024 * 1024) {
        setUploadError(`文件 ${file.name} 超过 ${limitMB}MB 大小限制。`);
        return;
      }
    }

    setUploading(true);
    try {
      await Promise.all(files.map((file) => uploadKnowledgeDoc(file, { filename: file.name })));
      await fetchDocs();
    } catch (error: any) {
      setUploadError(error?.message ?? '上传失败，请稍后重试。');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRetry = async (documentId: string) => {
    try {
      await retryKnowledgeDocument(documentId);
      await fetchDocs(true);
    } catch {
      setUploadError('重新处理失败，请稍后再试。');
    }
  };

  const handleRename = async (documentId: string, newName: string) => {
    try {
      await patchKnowledgeDocument(documentId, { display_name: newName });
      setDocuments((prev) => prev.map((doc) => (doc.document_id === documentId ? { ...doc, display_name: newName } : doc)));
      setSelectedDoc((prev) => (prev?.document_id === documentId ? { ...prev, display_name: newName } : prev));
    } catch {
      setUploadError('重命名失败，请稍后再试。');
    }
  };

  const performDelete = async () => {
    if (!confirmDelete) return;
    setConfirmDelete((prev) => (prev ? { ...prev, phase: 'deleting' } : null));
    try {
      await deleteKnowledgeDoc(confirmDelete.id);
      setDocuments((prev) => prev.filter((doc) => doc.document_id !== confirmDelete.id));
      setSelectedDoc((prev) => (prev?.document_id === confirmDelete.id ? null : prev));
      setConfirmDelete(null);
    } catch {
      setUploadError('删除失败，请稍后再试。');
      setConfirmDelete((prev) => (prev ? { ...prev, phase: 'confirm' } : null));
    }
  };

  const summary = useMemo(() => {
    const completed = documents.filter((doc) => doc.status === 'completed').length;
    const processing = documents.filter((doc) => doc.status === 'processing' || doc.status === 'pending').length;
    const failed = documents.filter((doc) => doc.status === 'failed').length;
    return { completed, processing, failed };
  }, [documents]);

  return (
    <div className={clsx(styles.panelRoot, compact && styles.panelCompact, selectedDoc && styles.panelSplit)}>
      <section className={styles.panelMain}>
        {!compact && (
          <header className={styles.pageHeader}>
            <div>
              <div className={styles.eyebrow}>Asset Center</div>
              <h1 className={styles.title}>知识库文档</h1>
              <p className={styles.subtitle}>统一管理文档与视频素材，自动解析摘要、字幕与关键帧，供工作台随时调用。</p>
            </div>
            <div className={styles.headerStats}>
              <div className={styles.statCard}><span>已完成</span><strong>{summary.completed}</strong></div>
              <div className={styles.statCard}><span>处理中</span><strong>{summary.processing}</strong></div>
              <div className={styles.statCard}><span>失败</span><strong>{summary.failed}</strong></div>
            </div>
          </header>
        )}

        <div
          className={clsx('app-dropzone', styles.dropzone, isDragging && styles.dragging, uploading && styles.uploading)}
          onClick={() => !uploading && fileInputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            setIsDragging(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            if (e.dataTransfer.files?.length) handleFiles(Array.from(e.dataTransfer.files));
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            style={{ display: 'none' }}
            accept=".pdf,.docx,.doc,.pptx,.txt,.md,.json,.csv,.mp4,.mov,.avi,.webm,.mkv,.flv"
            onChange={(e) => {
              if (e.target.files?.length) handleFiles(Array.from(e.target.files));
            }}
          />
          <div className={styles.dropzoneIcon}><UploadCloud size={28} className={clsx(uploading && styles.rotating)} /></div>
          <div className={styles.dropzoneBody}>
            <h3>{uploading ? '素材上传中...' : '上传文档或视频到知识库'}</h3>
            <p>支持 PDF / Word / PPT / Markdown / 文本 / 视频。文档上限 100MB，视频上限 500MB。</p>
          </div>
        </div>

        {uploadError && (
          <div className={styles.errorBanner}>
            <AlertCircle size={16} />
            <span>{uploadError}</span>
          </div>
        )}

        <div className={styles.listShell}>
          <div className={styles.listHeader}>
            <div>
              <h2 className={styles.listTitle}>已入库素材</h2>
              <p className={styles.listHint}>{loading ? '正在同步列表...' : `当前共 ${documents.length} 个素材`}</p>
            </div>
            <button className={styles.refreshBtn} onClick={() => fetchDocs(false)}>
              <RefreshCw size={14} /> 刷新
            </button>
          </div>

          <div className={styles.docList}>
            {loading ? (
              <div className={styles.feedbackCard}><Loader2 size={16} className={styles.rotating} /> 正在加载知识库...</div>
            ) : documents.length === 0 ? (
              <div className={styles.emptyCard}>
                <UploadCloud size={20} />
                <div>
                  <strong>还没有素材</strong>
                  <p>先上传文档或视频，系统会自动解析摘要并接入 AI 工作流。</p>
                </div>
              </div>
            ) : (
              documents.map((doc) => {
                const isVideo = doc.file_type === 'video';
                const isProcessing = doc.status === 'processing' || doc.status === 'pending';
                const selected = selectedDoc?.document_id === doc.document_id;
                return (
                  <article
                    key={doc.document_id}
                    className={clsx(styles.docCard, selected && styles.docCardActive)}
                    onClick={() => setSelectedDoc(selected ? null : doc)}
                  >
                    <div className={styles.docIcon}>{isVideo ? <FileVideo size={18} /> : <FileText size={18} />}</div>
                    <div className={styles.docBody}>
                      <div className={styles.docTopRow}>
                        <h3 className={styles.docTitle} title={getTitle(doc)}>{getTitle(doc)}</h3>
                        <span className={clsx(styles.typeBadge, isVideo ? styles.typeBadgeVideo : styles.typeBadgeDoc)}>
                          {isVideo ? '视频' : '文档'}
                        </span>
                      </div>
                      <div className={styles.docMetaRow}>
                        <span>{formatDate(doc.created_at)}</span>
                        {isVideo && doc.duration_sec ? <span>{formatDuration(doc.duration_sec)}</span> : null}
                      </div>
                      <div className={styles.docFooterRow}>
                        {doc.status === 'completed' && <span className={clsx(styles.statusBadge, styles.statusSuccess)}><CheckCircle2 size={12} /> 已完成</span>}
                        {doc.status === 'failed' && <span className={clsx(styles.statusBadge, styles.statusDanger)}><AlertCircle size={12} /> 处理失败</span>}
                        {isProcessing && <span className={clsx(styles.statusBadge, styles.statusPending)}><Loader2 size={12} className={styles.rotating} /> {doc.stage_label ?? getStageLabel(doc.process_stage, doc.progress)}</span>}
                        <div className={styles.docActions} onClick={(e) => e.stopPropagation()}>
                          {(doc.status === 'failed' || doc.status === 'pending') && (
                            <button className={styles.iconBtn} onClick={() => handleRetry(doc.document_id)} title="重新处理">
                              <RotateCcw size={14} />
                            </button>
                          )}
                          <button className={styles.iconBtn} onClick={() => setSelectedDoc(doc)} title="查看详情">
                            <Pencil size={14} />
                          </button>
                          <button
                            className={clsx(styles.iconBtn, styles.iconBtnDanger)}
                            onClick={() => setConfirmDelete({ id: doc.document_id, name: getTitle(doc), phase: 'confirm' })}
                            title="删除"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </div>
      </section>

      {selectedDoc && !compact && (
        <PreviewPanel
          doc={selectedDoc}
          onClose={() => setSelectedDoc(null)}
          onDelete={(id) => setConfirmDelete({ id, name: getTitle(selectedDoc), phase: 'confirm' })}
          onRetry={handleRetry}
          onRename={handleRename}
        />
      )}

      {selectedDoc && compact && (
        <div className={styles.mobilePreviewOverlay} onClick={() => setSelectedDoc(null)}>
          <div className={styles.mobilePreviewCard} onClick={(e) => e.stopPropagation()}>
            <PreviewPanel
              doc={selectedDoc}
              compact
              onClose={() => setSelectedDoc(null)}
              onDelete={(id) => setConfirmDelete({ id, name: getTitle(selectedDoc), phase: 'confirm' })}
              onRetry={handleRetry}
              onRename={handleRename}
            />
          </div>
        </div>
      )}

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

export default function KnowledgeBase() {
  return (
    <div className={styles.kbContainer}>
      <KnowledgeBasePanel compact={false} />
    </div>
  );
}
