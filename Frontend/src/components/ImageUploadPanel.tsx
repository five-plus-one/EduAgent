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

const STATUS_CONFIG = {
  pending: { label: '待标注', icon: Clock, color: 'var(--warning)' },
  processing: { label: '标注中', icon: Loader2, color: 'var(--brand)' },
  done: { label: '已完成', icon: CheckCircle, color: 'var(--success)' },
  failed: { label: '失败', icon: AlertCircle, color: 'var(--danger)' },
} as const;

const POLL_INTERVAL = 3000;

interface ImageUploadPanelProps {
  variant?: 'workspace' | 'asset';
}

export default function ImageUploadPanel({ variant = 'workspace' }: ImageUploadPanelProps) {
  const [images, setImages] = useState<UserImage[]>([]);
  const [loadingImages, setLoadingImages] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [reannotatingIds, setReannotatingIds] = useState<Set<string>>(new Set());
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);
  const [detailImage, setDetailImage] = useState<UserImage | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchImages = useCallback(async (silent = false) => {
    if (!silent) setLoadingImages(true);
    try {
      const res = await listUserImages(1, 50);
      setImages(res?.items ?? []);
    } finally {
      setLoadingImages(false);
    }
  }, []);

  useEffect(() => { fetchImages(); }, [fetchImages]);

  useEffect(() => {
    const hasPending = images.some(img => img.annotate_status === 'pending' || img.annotate_status === 'processing');
    if (hasPending && !pollTimerRef.current) {
      pollTimerRef.current = setInterval(() => fetchImages(true), POLL_INTERVAL);
    }
    if (!hasPending && pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [images, fetchImages]);

  useEffect(() => {
    if (!detailImage) return;
    const updated = images.find(img => img.image_id === detailImage.image_id);
    if (updated) setDetailImage(updated);
  }, [images, detailImage]);

  const handleFiles = (files: FileList | File[]) => {
    const allFiles = Array.from(files);
    const valid = allFiles.filter(
      f => ['image/jpeg', 'image/png', 'image/webp'].includes(f.type) && f.size <= 10 * 1024 * 1024,
    );
    const skipped = allFiles.length - valid.length;

    if (valid.length === 0) {
      setUploadError('文件格式不支持或超出大小限制，仅支持 jpg / png / webp，单张最大 10MB。');
      return;
    }

    setUploadError(
      skipped > 0
        ? `已跳过 ${skipped} 个不符合要求的文件，仅支持 jpg / png / webp，单张最大 10MB。`
        : null,
    );
    setPendingFiles(valid);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  };

  const handleUploaded = (newImages: UserImage[]) => {
    setImages(prev => [...newImages, ...prev.filter(img => !newImages.some(n => n.image_id === img.image_id))]);
    fetchImages();
    setPendingFiles(null);
  };

  const handleDelete = async (imageId: string) => {
    setDeletingIds(prev => new Set(prev).add(imageId));
    try {
      await deleteUserImage(imageId);
      setImages(prev => prev.filter(img => img.image_id !== imageId));
      if (detailImage?.image_id === imageId) setDetailImage(null);
    } catch {
      alert('删除失败，请重试。');
    } finally {
      setDeletingIds(prev => {
        const next = new Set(prev);
        next.delete(imageId);
        return next;
      });
      setConfirmDeleteId(null);
    }
  };

  const handleReannotate = async (imageId: string) => {
    setReannotatingIds(prev => new Set(prev).add(imageId));
    try {
      const res = await reannotateUserImage(imageId);
      setImages(prev => prev.map(img => (
        img.image_id === imageId
          ? { ...img, annotate_status: res.annotate_status as UserImage['annotate_status'] }
          : img
      )));
    } catch {
      alert('重新标注请求失败，请稍后再试。');
    } finally {
      setReannotatingIds(prev => {
        const next = new Set(prev);
        next.delete(imageId);
        return next;
      });
    }
  };

  const handleDetailUpdate = (updated: UserImage) => {
    setImages(prev => prev.map(img => (img.image_id === updated.image_id ? { ...img, ...updated } : img)));
    setDetailImage(updated);
  };

  const imageContent = loadingImages ? (
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
      <small>上传后，AI 会自动补全标签与描述，方便课件页面快速检索、替换和复用。</small>
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
          <div key={img.image_id} className={clsx(styles.card, isSelected && styles.cardSelected)}>
            <div
              className={styles.thumb}
              onClick={() => setDetailImage(img)}
              role="button"
              tabIndex={0}
              aria-label={`查看图片：${img.filename}`}
            >
              <img src={src} alt={img.filename} className={styles.thumbImg} />
              <div className={styles.thumbOverlay}>
                <Edit3 size={16} />
              </div>
              <span className={styles.statusBadge} style={{ background: cfg.color }}>
                <StatusIcon size={10} className={clsx(cfg.icon === Loader2 && styles.rotating)} />
                {cfg.label}
              </span>
            </div>

            <p className={styles.filename} title={img.filename}>{img.filename}</p>
            <div className={styles.metaPreview}>
              <span className={styles.labelPreview} title={img.label || img.filename}>{img.label || '未命名描述'}</span>
              <span className={styles.tagsCount}>{img.tags?.length ?? 0} 标签</span>
            </div>

            <div className={styles.actionsRow}>
              <button
                className={styles.actionBtn}
                onClick={() => setDetailImage(img)}
              >
                <Edit3 size={13} /> 详情
              </button>
              {img.annotate_status === 'failed' && (
                <button
                  className={styles.actionBtn}
                  onClick={() => handleReannotate(img.image_id)}
                  disabled={isReannotating}
                >
                  {isReannotating ? <Loader2 size={13} className={styles.rotating} /> : <RefreshCw size={13} />}
                  重试
                </button>
              )}
              <button
                className={clsx(styles.actionBtn, styles.actionDanger)}
                onClick={() => setConfirmDeleteId(img.image_id)}
                disabled={isDeleting}
              >
                {isDeleting ? <Loader2 size={13} className={styles.rotating} /> : <Trash2 size={13} />}
                删除
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <>
      <div className={clsx(
        styles.panel,
        variant === 'workspace' && styles.panelWorkspace,
        variant === 'asset' && styles.panelAsset,
      )}>
        <div className={clsx(styles.panelTop, variant === 'workspace' && styles.panelTopWorkspace)}>
          <div
            className={clsx(
              styles.dropzone,
              variant === 'workspace' && styles.dropzoneWorkspace,
              variant === 'asset' && styles.dropzoneAsset,
              'app-dropzone',
              isDragging && styles.dragging,
            )}
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
            <div className={styles.dropzoneText}>
              <span className={styles.dropzoneTitle}>拖拽或点击上传图片素材</span>
              <span className={styles.dropzoneHint}>支持 jpg / png / webp，单张最大 10 MB</span>
            </div>
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
        </div>

        <div className={clsx(styles.panelBody, variant === 'workspace' && styles.panelBodyWorkspace)}>
          {imageContent}
        </div>
      </div>

      {pendingFiles && (
        <PreUploadModal
          files={pendingFiles}
          onClose={() => setPendingFiles(null)}
          onUploaded={handleUploaded}
        />
      )}

      {detailImage && (
        <ImageDetailModal
          image={detailImage}
          onClose={() => setDetailImage(null)}
          onUpdate={handleDetailUpdate}
        />
      )}

      {confirmDeleteId && (
        <div className={styles.confirmOverlay} onClick={() => setConfirmDeleteId(null)}>
          <div className={styles.confirmCard} onClick={e => e.stopPropagation()}>
            <h4>确认删除</h4>
            <p>删除后将无法恢复，这张素材会从图片库中彻底移除。</p>
            <div className={styles.confirmActions}>
              <button className={styles.modalGhostBtn} onClick={() => setConfirmDeleteId(null)}>取消</button>
              <button className={styles.modalDangerBtn} onClick={() => handleDelete(confirmDeleteId)}>确认删除</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
