import { useState, useEffect, useRef, KeyboardEvent } from 'react';
import {
  X, Plus, Upload, Loader2, Sparkles, ChevronLeft, ChevronRight,
  Image as ImageIcon, Tag, Edit3, CheckCircle,
} from 'lucide-react';
import { clsx } from 'clsx';
import { uploadUserImage, updateImageTags } from '../utils/api';
import type { UserImage } from '../utils/api';
import styles from './PreUploadModal.module.css';

// ── 每张图片的本地编辑状态 ──────────────────────────────────
interface FileMetadata {
  label: string;
  tags: string[];
  tagInput: string;
}

const makeDefault = (): FileMetadata => ({ label: '', tags: [], tagInput: '' });

interface Props {
  files: File[];
  onClose: () => void;
  /** 上传完成后把新图片列表回传给父组件 */
  onUploaded: (images: UserImage[]) => void;
}

export default function PreUploadModal({ files, onClose, onUploaded }: Props) {
  // ── 当前选中的图片下标 ──────────────────────────────────
  const [currentIdx, setCurrentIdx] = useState(0);
  // ── 每张图片的 label / tags 草稿 ───────────────────────
  const [metaMap, setMetaMap] = useState<FileMetadata[]>(() =>
    files.map(() => makeDefault())
  );
  // ── 本地预览 URL（由 File 对象生成） ───────────────────
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0); // 0-100
  const [error, setError] = useState<string | null>(null);

  const tagInputRef = useRef<HTMLInputElement>(null);

  // 生成本地预览 URL
  useEffect(() => {
    const urls = files.map(f => URL.createObjectURL(f));
    setPreviewUrls(urls);
    return () => { urls.forEach(u => URL.revokeObjectURL(u)); };
  }, [files]);

  // files 变化时重置 meta（防御）
  useEffect(() => {
    setMetaMap(files.map(() => makeDefault()));
    setCurrentIdx(0);
  }, [files]);

  const current = metaMap[currentIdx];
  const setCurrent = (patch: Partial<FileMetadata>) => {
    setMetaMap(prev => prev.map((m, i) => i === currentIdx ? { ...m, ...patch } : m));
  };

  // ── 标签操作（当前图片） ─────────────────────────────────
  const addTag = () => {
    const t = current.tagInput.trim();
    if (!t || current.tags.includes(t)) {
      setCurrent({ tagInput: '' });
      return;
    }
    setCurrent({ tags: [...current.tags, t], tagInput: '' });
  };

  const removeTag = (tag: string) => {
    setCurrent({ tags: current.tags.filter(t => t !== tag) });
  };

  const handleTagKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); addTag(); }
    if (e.key === 'Backspace' && !current.tagInput && current.tags.length > 0) {
      setCurrent({ tags: current.tags.slice(0, -1) });
    }
  };

  // ── 提交：上传 + 设置 tags（AI 标注随上传自动触发） ────────
  const handleSubmit = async () => {
    setUploading(true);
    setError(null);
    const results: UserImage[] = [];
    try {
      for (let i = 0; i < files.length; i++) {
        const meta = metaMap[i];
        // 1. 带 label 上传（上传后后端自动触发 AI 标注 → annotate_status = 'pending'）
        const img = await uploadUserImage(files[i], meta.label.trim() || undefined);
        results.push(img);
        // 2. 如果用户提前填了 tags，立刻设置
        if (meta.tags.length > 0) {
          const updated = await updateImageTags(img.image_id, meta.tags);
          results[results.length - 1] = updated;
        }
        setUploadProgress(Math.round(((i + 1) / files.length) * 100));
      }
      onUploaded(results);
      onClose();
    } catch (e: any) {
      setError(
        `第 ${results.length + 1} 张图片上传失败：${e?.response?.data?.detail || e?.message || '未知错误'}`
      );
    } finally {
      setUploading(false);
    }
  };

  const totalFiles = files.length;
  const canPrev = currentIdx > 0;
  const canNext = currentIdx < totalFiles - 1;

  return (
    <div className={styles.overlay} onClick={e => e.target === e.currentTarget && !uploading && onClose()}>
      <aside className={styles.drawer}>

        {/* ── Header ───────────────────────────────────────── */}
        <header className={styles.header}>
          <div className={styles.headerLeft}>
            <Upload size={15} />
            <span>上传图片素材</span>
            {totalFiles > 1 && (
              <span className={styles.countBadge}>{totalFiles} 张</span>
            )}
          </div>
          <button
            className={styles.closeBtn}
            onClick={onClose}
            disabled={uploading}
            title="取消"
          >
            <X size={18} />
          </button>
        </header>

        {/* ── 多图缩略图导航条（仅多张时显示） ───────────────── */}
        {totalFiles > 1 && (
          <div className={styles.filmstrip}>
            {previewUrls.map((url, i) => (
              <button
                key={i}
                className={clsx(styles.filmThumb, i === currentIdx && styles.filmThumbActive)}
                onClick={() => setCurrentIdx(i)}
                title={files[i].name}
              >
                <img src={url} alt={files[i].name} />
                {metaMap[i].label && (
                  <span className={styles.filmDot} title="已填写描述" />
                )}
              </button>
            ))}
          </div>
        )}

        {/* ── 当前图片预览 ─────────────────────────────────── */}
        <div className={styles.previewSection}>
          <div className={styles.previewWrap}>
            {previewUrls[currentIdx] ? (
              <img
                src={previewUrls[currentIdx]}
                alt={files[currentIdx]?.name}
                className={styles.previewImg}
              />
            ) : (
              <div className={styles.previewPlaceholder}>
                <ImageIcon size={36} opacity={0.3} />
              </div>
            )}

            {/* 多图切换箭头 */}
            {totalFiles > 1 && (
              <>
                <button
                  className={clsx(styles.arrowBtn, styles.arrowLeft, !canPrev && styles.arrowDisabled)}
                  onClick={() => canPrev && setCurrentIdx(i => i - 1)}
                >
                  <ChevronLeft size={18} />
                </button>
                <button
                  className={clsx(styles.arrowBtn, styles.arrowRight, !canNext && styles.arrowDisabled)}
                  onClick={() => canNext && setCurrentIdx(i => i + 1)}
                >
                  <ChevronRight size={18} />
                </button>
                <span className={styles.pageIndicator}>
                  {currentIdx + 1} / {totalFiles}
                </span>
              </>
            )}
          </div>
          <p className={styles.filename} title={files[currentIdx]?.name}>
            {files[currentIdx]?.name}
          </p>
        </div>

        {/* ── 可滚动编辑区 ─────────────────────────────────── */}
        <div className={styles.body}>

          {/* ── 描述 ──────────────────────────────────────── */}
          <section className={styles.section}>
            <label className={styles.sectionLabel}>
              <Edit3 size={12} />
              图片描述
              <span className={styles.hint}>（可选，AI 标注时作为提示参考）</span>
            </label>
            <textarea
              className={styles.textarea}
              value={current.label}
              onChange={e => setCurrent({ label: e.target.value })}
              placeholder="例：牛顿第二定律 F=ma 受力分析示意图（建议 30 字内）"
              rows={3}
              disabled={uploading}
            />
          </section>

          {/* ── 标签 ──────────────────────────────────────── */}
          <section className={styles.section}>
            <label className={styles.sectionLabel}>
              <Tag size={12} />
              预设标签
              <span className={styles.hint}>（可选，AI 完成标注后将与 AI 标签合并）</span>
            </label>

            {/* 标签展示区 */}
            <div className={styles.tagsArea}>
              {current.tags.length === 0 && (
                <span className={styles.tagsPlaceholder}>暂未添加标签</span>
              )}
              {current.tags.map(tag => (
                <span key={tag} className={styles.tagChip}>
                  {tag}
                  <button
                    className={styles.removeTagBtn}
                    onClick={() => removeTag(tag)}
                    disabled={uploading}
                  >
                    <X size={9} />
                  </button>
                </span>
              ))}
            </div>

            {/* 标签输入 */}
            <div className={styles.tagInputRow}>
              <input
                ref={tagInputRef}
                className={styles.tagInput}
                value={current.tagInput}
                onChange={e => setCurrent({ tagInput: e.target.value })}
                onKeyDown={handleTagKey}
                placeholder="输入标签后按回车"
                maxLength={20}
                disabled={uploading}
              />
              <button
                className={styles.addTagBtn}
                onClick={addTag}
                disabled={!current.tagInput.trim() || uploading}
              >
                <Plus size={14} />
              </button>
            </div>
          </section>

          {/* ── 多图说明 ─────────────────────────────────── */}
          {totalFiles > 1 && (
            <div className={styles.multiHint}>
              <CheckCircle size={12} />
              描述和标签按图片独立设置，点击上方缩略图切换编辑
            </div>
          )}

          {/* ── 错误提示 ─────────────────────────────────── */}
          {error && (
            <div className={styles.errorBanner}>
              {error}
            </div>
          )}
        </div>

        {/* ── AI 标注说明横幅 ──────────────────────────────── */}
        <div className={styles.annotateInfoBar}>
          <Sparkles size={13} />
          <span>提交后 AI 将自动分析每张图片，生成语义描述与检索标签（约 30 秒）</span>
        </div>

        {/* ── 底部操作区 ───────────────────────────────────── */}
        <footer className={styles.footer}>
          {/* 上传进度 */}
          {uploading && (
            <div className={styles.progressWrap}>
              <div className={styles.progressBar}>
                <div className={styles.progressFill} style={{ width: `${uploadProgress}%` }} />
              </div>
              <span className={styles.progressText}>
                {uploadProgress < 100 ? `上传中... ${uploadProgress}%` : '处理中...'}
              </span>
            </div>
          )}

          <div className={styles.footerActions}>
            <button
              className={styles.cancelBtn}
              onClick={onClose}
              disabled={uploading}
            >
              取消
            </button>

            {/* 主按钮：上传并提交 AI 标注 */}
            <button
              className={styles.submitBtn}
              onClick={handleSubmit}
              disabled={uploading}
            >
              {uploading ? (
                <><Loader2 size={15} className={styles.spinIcon} /> 上传中...</>
              ) : (
                <><Sparkles size={15} /> 上传并提交 AI 标注{totalFiles > 1 ? `（${totalFiles} 张）` : ''}</>
              )}
            </button>
          </div>
        </footer>
      </aside>
    </div>
  );
}
