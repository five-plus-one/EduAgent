import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Upload, Trash2, RefreshCw, Image as ImageIcon,
  CheckCircle, Loader2, AlertCircle, Clock, X, Edit3,
} from 'lucide-react';
import { clsx } from 'clsx';
import {
  uploadUserImage,
  listUserImages,
  deleteUserImage,
  reannotateUserImage,
  getImagePreviewUrl,
  type UserImage,
} from '../utils/api';
import styles from './ImageUploadPanel.module.css';
import ImageDetailModal from './ImageDetailModal';

// API v2: 图片库已改为用户级，不再绑定会话，无需传 sessionId

const STATUS_CONFIG = {
  pending:    { label: '待标注', icon: Clock,        color: 'var(--color-warning, #f59e0b)' },
  processing: { label: '标注中', icon: Loader2,      color: 'var(--color-info, #3b82f6)'   },
  done:       { label: '已就绪', icon: CheckCircle,  color: 'var(--color-success, #22c55e)' },
  failed:     { label: '失败',   icon: AlertCircle,  color: 'var(--color-danger, #ef4444)'  },
} as const;

/** 轮询间隔（ms） */
const POLL_INTERVAL = 3000;

export default function ImageUploadPanel() {
  const [images, setImages] = useState<UserImage[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [reannotatingIds, setReannotatingIds] = useState<Set<string>>(new Set());
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // ── 模态框状态 ─────────────────────────────────────────────
  const [modalImage, setModalImage] = useState<UserImage | null>(null);
  const [modalMode, setModalMode] = useState<'upload' | 'view'>('view');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── 拉取图片列表 ──────────────────────────────────────────
  const fetchImages = useCallback(async () => {
    try {
      const res = await listUserImages(1, 50);
      setImages(res?.items ?? []);
    } catch {
      // 非关键失败，静默
    }
  }, []);

  useEffect(() => {
    fetchImages();
  }, [fetchImages]);

  // ── 轮询：对 pending/processing 图片定期刷新 ─────────────
  useEffect(() => {
    const hasPending = images.some(
      img => img.annotate_status === 'pending' || img.annotate_status === 'processing'
    );

    if (hasPending) {
      if (!pollTimerRef.current) {
        pollTimerRef.current = setInterval(fetchImages, POLL_INTERVAL);
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

  // 轮询时同步更新模态框内的图片数据（避免模态框内容过时）
  useEffect(() => {
    if (!modalImage) return;
    const updated = images.find(img => img.image_id === modalImage.image_id);
    if (updated) setModalImage(updated);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images]);

  // ── 上传处理 ─────────────────────────────────────────────
  const handleFiles = async (files: FileList | File[]) => {
    const valid = Array.from(files).filter(f =>
      ['image/jpeg', 'image/png', 'image/webp'].includes(f.type) && f.size <= 10 * 1024 * 1024
    );
    const skipped = Array.from(files).length - valid.length;
    if (skipped > 0) {
      setUploadError(`已跳过 ${skipped} 个不支持的文件（仅支持 jpg/png/webp，最大 10MB）`);
    } else {
      setUploadError(null);
    }
    if (!valid.length) return;

    setUploading(true);
    try {
      // 逐一上传，取最后一张（或首张）上传结果打开模态框
      const results: UserImage[] = [];
      for (const f of valid) {
        const img = await uploadUserImage(f);
        results.push(img);
      }
      // 刷新列表
      await fetchImages();
      // 自动打开最后一张图片的模态框（上传模式）
      const lastUploaded = results[results.length - 1];
      setModalImage(lastUploaded);
      setModalMode('upload');
    } catch {
      setUploadError('上传失败，请检查网络后重试。');
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  // ── 点击图片 → 打开模态框 ─────────────────────────────────
  const handleOpenModal = (img: UserImage) => {
    setModalImage(img);
    setModalMode('view');
  };

  const handleCloseModal = () => {
    setModalImage(null);
  };

  // ── 模态框更新回调 → 同步到列表 ──────────────────────────
  const handleModalUpdate = (updated: UserImage) => {
    setImages(prev =>
      prev.map(img => img.image_id === updated.image_id ? { ...img, ...updated } : img)
    );
    setModalImage(updated);
  };

  // ── 删除 ─────────────────────────────────────────────────
  const handleDelete = async (imageId: string) => {
    setDeletingIds(prev => new Set(prev).add(imageId));
    try {
      await deleteUserImage(imageId);
      setImages(prev => prev.filter(img => img.image_id !== imageId));
      // 如果正好是模态框中的图片，关闭模态框
      if (modalImage?.image_id === imageId) setModalImage(null);
    } catch {
      alert('删除失败，请重试。');
    } finally {
      setDeletingIds(prev => { const n = new Set(prev); n.delete(imageId); return n; });
      setConfirmDeleteId(null);
    }
  };

  // ── 重新标注 ─────────────────────────────────────────────
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

  // ── 渲染 ─────────────────────────────────────────────────
  return (
    <>
      <div className={styles.panel}>
        {/* 拖拽/点击上传区 */}
        <div
          className={clsx(styles.dropzone, isDragging && styles.dragging, uploading && styles.uploading)}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={() => setIsDragging(false)}
          onClick={() => !uploading && fileInputRef.current?.click()}
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
          {uploading ? (
            <>
              <Loader2 size={28} className={styles.spinIcon} />
              <span>上传中，请稍候...</span>
            </>
          ) : (
            <>
              <Upload size={28} className={styles.uploadIcon} />
              <span className={styles.dropzoneTitle}>拖拽 / 点击上传图片素材</span>
              <span className={styles.dropzoneHint}>支持 jpg · png · webp，单张最大 10 MB</span>
            </>
          )}
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

        {/* 图片网格 */}
        {images.length === 0 ? (
          <div className={styles.emptyState}>
            <ImageIcon size={36} className={styles.emptyIcon} />
            <p>暂无图片素材</p>
            <small>上传后，AI 会自动识别并为图片生成语义描述与标签，用于 PPT 图文混排匹配。</small>
          </div>
        ) : (
          <div className={styles.grid}>
            {images.map(img => {
              const cfg = STATUS_CONFIG[img.annotate_status] ?? STATUS_CONFIG.pending;
              const StatusIcon = cfg.icon;
              const isDeleting = deletingIds.has(img.image_id);
              const isReannotating = reannotatingIds.has(img.image_id);
              const src = getImagePreviewUrl(img.preview_url);
              const isSelected = modalImage?.image_id === img.image_id;

              return (
                <div
                  key={img.image_id}
                  className={clsx(styles.card, isSelected && styles.cardSelected)}
                >
                  {/* 缩略图 — 点击打开模态框 */}
                  <div
                    className={styles.thumb}
                    onClick={() => handleOpenModal(img)}
                    role="button"
                    tabIndex={0}
                    aria-label={`查看图片：${img.filename}`}
                  >
                    <img src={src} alt={img.filename} className={styles.thumbImg} />

                    {/* 编辑提示遮罩 */}
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

                  {/* 用户描述标签预览（如果有） */}
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
                    {/* 重新标注（仅对 failed） */}
                    {img.annotate_status === 'failed' && (
                      <button
                        className={styles.actionBtn}
                        onClick={() => handleReannotate(img.image_id)}
                        disabled={isReannotating}
                        title="重新触发标注"
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

      {/* 图片详情模态框（Portal at root level via overlay） */}
      <ImageDetailModal
        image={modalImage}
        mode={modalMode}
        onClose={handleCloseModal}
        onUpdate={handleModalUpdate}
      />
    </>
  );
}
