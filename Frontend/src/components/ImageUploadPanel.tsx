import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Upload, Trash2, RefreshCw, Image as ImageIcon,
  CheckCircle, Loader2, AlertCircle, Clock, X, Edit3,
} from 'lucide-react';
import { clsx } from 'clsx';
import {
  listUserImages,
  deleteUserImage,
  reannotateUserImage,
  getImagePreviewUrl,
  type UserImage,
} from '../utils/api';
import styles from './ImageUploadPanel.module.css';
import PreUploadModal from './PreUploadModal';
import ImageDetailModal from './ImageDetailModal';

// API v2: 图片库已改为用户级，不再绑定会话，无需传 sessionId

const STATUS_CONFIG = {
  pending:    { label: '待标注', icon: Clock,        color: 'var(--color-warning, #f59e0b)' },
  processing: { label: '标注中', icon: Loader2,      color: 'var(--color-info, #3b82f6)'   },
  done:       { label: '已就绪', icon: CheckCircle,  color: 'var(--color-success, #22c55e)' },
  failed:     { label: '失败',   icon: AlertCircle,  color: 'var(--color-danger, #ef4444)'  },
} as const;

const POLL_INTERVAL = 3000;

export default function ImageUploadPanel() {
  const [images, setImages] = useState<UserImage[]>([]);
  const [loadingImages, setLoadingImages] = useState(true);  // 首次加载骨架屏
  const [isDragging, setIsDragging] = useState(false);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [reannotatingIds, setReannotatingIds] = useState<Set<string>>(new Set());
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // ── 预上传模态框（选文件后弹出，用于编辑 label/tags） ────
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);

  // ── 详情模态框（点击已上传图片弹出） ────────────────────
  const [detailImage, setDetailImage] = useState<UserImage | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── 拉取图片列表 ─────────────────────────────────────────
  const fetchImages = useCallback(async (silent = false) => {
    if (!silent) setLoadingImages(true);
    try {
      const res = await listUserImages(1, 50);
      setImages(res?.items ?? []);
    } catch {
      // 非关键失败，静默
    } finally {
      setLoadingImages(false);
    }
  }, []);

  useEffect(() => { fetchImages(); }, [fetchImages]);

  // ── 轮询：pending/processing 图片定期刷新 ─────────────────
  useEffect(() => {
    const hasPending = images.some(
      img => img.annotate_status === 'pending' || img.annotate_status === 'processing'
    );
    if (hasPending) {
      if (!pollTimerRef.current) {
        pollTimerRef.current = setInterval(() => fetchImages(true), POLL_INTERVAL);
      }
    } else {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    }
    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [images, fetchImages]);

  // 轮询时同步更新详情模态框内的图片数据
  useEffect(() => {
    if (!detailImage) return;
    const updated = images.find(img => img.image_id === detailImage.image_id);
    if (updated) setDetailImage(updated);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images]);

  // ── 文件校验 + 打开预上传模态框（不直接上传！） ─────────
  const handleFiles = (files: FileList | File[]) => {
    const valid = Array.from(files).filter(f =>
      ['image/jpeg', 'image/png', 'image/webp'].includes(f.type) && f.size <= 10 * 1024 * 1024
    );
    const skipped = Array.from(files).length - valid.length;
    if (valid.length === 0) {
      setUploadError('文件格式不支持或超出大小限制（仅支持 jpg/png/webp，最大 10MB）');
      return;
    }
    if (skipped > 0) {
      setUploadError(`已过滤 ${skipped} 个不支持的文件（仅支持 jpg/png/webp，最大 10MB）`);
    } else {
      setUploadError(null);
    }
    // 打开预上传模态框，让用户先编辑 label/tags
    setPendingFiles(valid);
    // 重置 file input，确保同文件可再次触发
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  };

  // ── PreUploadModal 上传完成回调 ───────────────────────────
  const handleUploaded = (newImages: UserImage[]) => {
    // 把新图片插到列表头部，再刷新一次保证与服务器同步
    setImages(prev => [...newImages, ...prev.filter(
      img => !newImages.some(n => n.image_id === img.image_id)
    )]);
    fetchImages();
    setPendingFiles(null);
  };

  // ── 点击卡片 → 打开详情模态框 ─────────────────────────────
  const handleOpenDetail = (img: UserImage) => setDetailImage(img);

  // ── 详情模态框更新回调 ────────────────────────────────────
  const handleDetailUpdate = (updated: UserImage) => {
    setImages(prev =>
      prev.map(img => img.image_id === updated.image_id ? { ...img, ...updated } : img)
    );
    setDetailImage(updated);
  };

  // ── 删除 ─────────────────────────────────────────────────
  const handleDelete = async (imageId: string) => {
    setDeletingIds(prev => new Set(prev).add(imageId));
    try {
      await deleteUserImage(imageId);
      setImages(prev => prev.filter(img => img.image_id !== imageId));
      if (detailImage?.image_id === imageId) setDetailImage(null);
    } catch {
      alert('删除失败，请重试。');
    } finally {
      setDeletingIds(prev => { const n = new Set(prev); n.delete(imageId); return n; });
      setConfirmDeleteId(null);
    }
  };

  // ── 重新标注（卡片上的快捷操作，仅 failed 时显示） ────────
  const handleReannotate = async (imageId: string) => {
    setReannotatingIds(prev => new Set(prev).add(imageId));
    try {
      const res = await reannotateUserImage(imageId);
      setImages(prev =>
        prev.map(img =>
          img.image_id === imageId
            ? { ...img, annotate_status: res.annotate_status as UserImage['annotate_status'] }
            : img
        )
      );
    } catch {
      alert('重新标注请求失败，请重试。');
    } finally {
      setReannotatingIds(prev => { const n = new Set(prev); n.delete(imageId); return n; });
    }
  };

  return (
    <>
      <div className={styles.panel}>
        {/* ── 拖拽/点击上传区 ─────────────────────────────── */}
        <div
          className={clsx(styles.dropzone, isDragging && styles.dragging)}
          onDrop={handleDrop}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          aria-label="点击或拖拽图片到此处上传"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            style={{ display: 'none' }}
            onChange={e => e.target.files && handleFiles(e.target.files)}
          />
          <Upload size={28} className={styles.uploadIcon} />
          <span className={styles.dropzoneTitle}>拖拽 / 点击上传图片素材</span>
          <span className={styles.dropzoneHint}>支持 jpg · png · webp，单张最大 10 MB</span>
        </div>

        {uploadError && (
          <div className={styles.errorBanner}>
            <AlertCircle size={14} />
            <span>{uploadError}</span>
            <button className={styles.closeBannerBtn} onClick={() => setUploadError(null)}>
              <X size={12} />
            </button>
          </div>
        )}

        {/* ── 图片网格 / 骨架屏 / 空状态 ─────────────────── */}
        {loadingImages ? (
          // 骨架屏：4 张占位卡，闪烁动画
          <div className={styles.grid}>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className={styles.skeletonCard} style={{ animationDelay: `${i * 0.12}s` }}>
                <div className={styles.skeletonThumb} />
                <div className={styles.skeletonLine} style={{ width: '70%' }} />
                <div className={styles.skeletonLine} style={{ width: '45%' }} />
              </div>
            ))}
          </div>
        ) : images.length === 0 ? (
          <div className={styles.emptyState}>
            <ImageIcon size={36} className={styles.emptyIcon} />
            <p>暂无图片素材</p>
            <small>上传后，AI 会自动识别并生成语义描述与标签，用于 PPT 图文混排匹配。</small>
          </div>
        ) : (
          <div className={styles.grid}>
            {images.map(img => {
              const cfg = STATUS_CONFIG[img.annotate_status] ?? STATUS_CONFIG.pending;
              const StatusIcon = cfg.icon;
              const isDeleting = deletingIds.has(img.image_id);
              const isReannotating = reannotatingIds.has(img.image_id);
              const src = getImagePreviewUrl(img.preview_url);
              const isSelected = detailImage?.image_id === img.image_id;

              return (
                <div
                  key={img.image_id}
                  className={clsx(styles.card, isSelected && styles.cardSelected)}
                >
                  {/* 缩略图 — 点击打开详情模态框 */}
                  <div
                    className={styles.thumb}
                    onClick={() => handleOpenDetail(img)}
                    role="button"
                    tabIndex={0}
                    aria-label={`查看图片：${img.filename}`}
                  >
                    <img src={src} alt={img.filename} className={styles.thumbImg} />

                    {/* 悬停编辑遮罩 */}
                    <div className={styles.thumbOverlay}>
                      <Edit3 size={16} />
                    </div>

                    {/* 标注状态徽章 */}
                    <span
                      className={styles.statusBadge}
                      style={{ background: cfg.color }}
                      title={cfg.label}
                    >
                      <StatusIcon
                        size={10}
                        className={img.annotate_status === 'processing' ? styles.spinIcon : undefined}
                      />
                      {cfg.label}
                    </span>
                  </div>

                  {/* 文件名 */}
                  <p className={styles.filename} title={img.filename}>
                    {img.filename}
                  </p>

                  {/* 描述/标签预览 */}
                  {(img.label || (img.tags && img.tags.length > 0)) && (
                    <div className={styles.metaPreview}>
                      {img.label && (
                        <span className={styles.labelPreview} title={img.label}>{img.label}</span>
                      )}
                      {img.tags && img.tags.length > 0 && (
                        <span className={styles.tagsCount}>{img.tags.length} 标签</span>
                      )}
                    </div>
                  )}

                  {/* 操作按钮 */}
                  <div className={styles.cardActions}>
                    {/* 重新标注（仅 failed 快捷入口） */}
                    {img.annotate_status === 'failed' && (
                      <button
                        className={styles.actionBtn}
                        onClick={() => handleReannotate(img.image_id)}
                        disabled={isReannotating}
                        title="重新触发 AI 标注"
                      >
                        <RefreshCw size={13} className={isReannotating ? styles.spinIcon : undefined} />
                      </button>
                    )}

                    {/* 删除（二次确认） */}
                    {confirmDeleteId === img.image_id ? (
                      <div className={styles.confirmDelete}>
                        <span>确认删除?</span>
                        <button
                          className={clsx(styles.actionBtn, styles.danger)}
                          onClick={() => handleDelete(img.image_id)}
                          disabled={isDeleting}
                        >
                          {isDeleting ? <Loader2 size={12} className={styles.spinIcon} /> : '删除'}
                        </button>
                        <button
                          className={styles.actionBtn}
                          onClick={() => setConfirmDeleteId(null)}
                        >
                          取消
                        </button>
                      </div>
                    ) : (
                      <button
                        className={clsx(styles.actionBtn, styles.deleteBtn)}
                        onClick={() => setConfirmDeleteId(img.image_id)}
                        title="删除图片"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── 预上传模态框（选文件后，上传前编辑 label/tags） ── */}
      {pendingFiles && (
        <PreUploadModal
          files={pendingFiles}
          onClose={() => setPendingFiles(null)}
          onUploaded={handleUploaded}
        />
      )}

      {/* ── 图片详情模态框（点击已上传图片） ──────────────── */}
      <ImageDetailModal
        image={detailImage}
        onClose={() => setDetailImage(null)}
        onUpdate={handleDetailUpdate}
      />
    </>
  );
}
