import { useState, useEffect, useRef, KeyboardEvent } from 'react';
import {
  X, Tag, Sparkles, Save, Loader2, RefreshCw, Plus, CheckCircle,
  AlertCircle, Clock, Edit3,
} from 'lucide-react';
import { clsx } from 'clsx';
import {
  patchImageLabel,
  updateImageTags,
  reannotateUserImage,
  getImagePreviewUrl,
  type UserImage,
} from '../utils/api';
import styles from './ImageDetailModal.module.css';

interface Props {
  image: UserImage | null;
  onClose: () => void;
  onUpdate: (updated: UserImage) => void;
}

const STATUS_CONFIG = {
  pending:    { label: '待标注',  icon: Clock,        color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  processing: { label: '标注中',  icon: Loader2,      color: '#3b82f6', bg: 'rgba(59,130,246,0.12)' },
  done:       { label: '已就绪',  icon: CheckCircle,  color: '#22c55e', bg: 'rgba(34,197,94,0.12)'  },
  failed:     { label: '标注失败',icon: AlertCircle,  color: '#ef4444', bg: 'rgba(239,68,68,0.12)'  },
} as const;

export default function ImageDetailModal({ image, onClose, onUpdate }: Props) {
  const [labelDraft, setLabelDraft]   = useState('');
  const [tagsDraft, setTagsDraft]     = useState<string[]>([]);
  const [tagInput, setTagInput]       = useState('');
  const [savingLabel, setSavingLabel] = useState(false);
  const [savingTags, setSavingTags]   = useState(false);
  const [reannotating, setReannotating] = useState(false);
  const [labelDirty, setLabelDirty]   = useState(false);
  const [tagsDirty, setTagsDirty]     = useState(false);
  const [savedLabel, setSavedLabel]   = useState(false);
  const [savedTags, setSavedTags]     = useState(false);
  const tagInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!image) return;
    setLabelDraft(image.label ?? '');
    setTagsDraft(image.tags ?? []);
    setTagInput('');
    setLabelDirty(false);
    setTagsDirty(false);
    setSavedLabel(false);
    setSavedTags(false);
  }, [image]);

  if (!image) return null;

  const cfg = STATUS_CONFIG[image.annotate_status] ?? STATUS_CONFIG.pending;
  const StatusIcon = cfg.icon;
  const isAnnotating = image.annotate_status === 'pending' || image.annotate_status === 'processing';
  const canEditTags  = image.annotate_status === 'done';
  const previewUrl   = getImagePreviewUrl(image.preview_url);

  // ── 保存描述 ─────────────────────────────────────────────
  const handleSaveLabel = async () => {
    if (!labelDirty) return;
    setSavingLabel(true);
    try {
      const updated = await patchImageLabel(image.image_id, labelDraft.trim() || null);
      onUpdate(updated);
      setLabelDirty(false);
      setSavedLabel(true);
      setTimeout(() => setSavedLabel(false), 2000);
    } catch (e: any) {
      alert('描述保存失败：' + (e?.response?.data?.detail || e?.message || '未知错误'));
    } finally {
      setSavingLabel(false);
    }
  };

  // ── 标签操作 ─────────────────────────────────────────────
  const addTag = () => {
    const t = tagInput.trim();
    if (!t || tagsDraft.includes(t)) { setTagInput(''); return; }
    setTagsDraft(prev => [...prev, t]);
    setTagInput('');
    setTagsDirty(true);
  };

  const removeTag = (tag: string) => {
    setTagsDraft(prev => prev.filter(t => t !== tag));
    setTagsDirty(true);
  };

  const handleTagKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); addTag(); }
    if (e.key === 'Backspace' && !tagInput && tagsDraft.length > 0) {
      setTagsDraft(prev => prev.slice(0, -1));
      setTagsDirty(true);
    }
  };

  const handleSaveTags = async () => {
    if (!tagsDirty) return;
    setSavingTags(true);
    try {
      const updated = await updateImageTags(image.image_id, tagsDraft);
      onUpdate(updated);
      setTagsDirty(false);
      setSavedTags(true);
      setTimeout(() => setSavedTags(false), 2000);
    } catch (e: any) {
      alert('标签保存失败：' + (e?.response?.data?.detail || e?.message || '未知错误'));
    } finally {
      setSavingTags(false);
    }
  };

  // ── AI 重新标注 ───────────────────────────────────────────
  const handleReannotate = async () => {
    setReannotating(true);
    try {
      const res = await reannotateUserImage(image.image_id);
      onUpdate({ ...image, annotate_status: res.annotate_status as UserImage['annotate_status'] });
    } catch (e: any) {
      alert('重新标注失败：' + (e?.response?.data?.detail || e?.message || '未知错误'));
    } finally {
      setReannotating(false);
    }
  };

  return (
    <div className={styles.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <aside className={styles.drawer}>

        {/* ── Header ──────────────────────────────────────── */}
        <header className={styles.drawerHeader}>
          <div className={styles.headerLeft}>
            <Edit3 size={15} />
            <span>图片详情</span>
          </div>
          <button className={styles.closeBtn} onClick={onClose} title="关闭">
            <X size={18} />
          </button>
        </header>

        {/* ── 图片预览 ─────────────────────────────────────── */}
        <div className={styles.previewWrap}>
          <img src={previewUrl} alt={image.filename} className={styles.previewImg} />
          <div className={styles.previewMeta}>
            <span className={styles.filename} title={image.filename}>{image.filename}</span>
          </div>
        </div>

        {/* ══ AI 重新标注 Hero 区域（顶级一级功能） ════════════ */}
        <div className={styles.annotateHero} style={{ background: cfg.bg }}>
          <div className={styles.annotateHeroLeft}>
            <span className={styles.statusPill} style={{ color: cfg.color }}>
              <StatusIcon
                size={12}
                className={isAnnotating ? styles.spinIcon : undefined}
              />
              {cfg.label}
            </span>
            <p className={styles.annotateHeroDesc}>
              {image.annotate_status === 'done'
                ? '已完成 AI 图像识别。如内容有偏差可重新触发。'
                : image.annotate_status === 'failed'
                ? '上次标注失败，点击右侧按钮重试。'
                : 'AI 正在识别图像内容，生成语义描述与检索标签...'}
            </p>
          </div>
          <button
            className={clsx(styles.reannotateHeroBtn, reannotating && styles.busy)}
            onClick={handleReannotate}
            disabled={reannotating || isAnnotating}
            title={isAnnotating ? '标注进行中' : '重新触发 AI 标注'}
          >
            <RefreshCw size={14} className={reannotating ? styles.spinIcon : undefined} />
            {reannotating ? '触发中...' : isAnnotating ? '标注中...' : 'AI 重新标注'}
          </button>
        </div>

        {/* ── 可滚动内容区 ─────────────────────────────────── */}
        <div className={styles.body}>

          {/* ── AI 生成描述（只读） ──────────────────────── */}
          {image.description && (
            <section className={styles.section}>
              <label className={styles.sectionLabel}>
                <Sparkles size={12} /> AI 识别内容
              </label>
              <p className={styles.aiDescription}>{image.description}</p>
            </section>
          )}

          {/* ── 用户描述（label） ─────────────────────────── */}
          <section className={styles.section}>
            <label className={styles.sectionLabel}>
              <Edit3 size={12} /> 用户描述
              <span className={styles.sectionHint}>（作为 AI 标注提示，可随时修改）</span>
            </label>
            <textarea
              className={styles.textarea}
              value={labelDraft}
              onChange={e => { setLabelDraft(e.target.value); setLabelDirty(true); }}
              placeholder="描述图片内容，例：第三章受力分析示意图"
              rows={3}
            />
            <button
              className={clsx(styles.saveBtn, !labelDirty && styles.disabled)}
              onClick={handleSaveLabel}
              disabled={!labelDirty || savingLabel}
            >
              {savingLabel
                ? <><Loader2 size={12} className={styles.spinIcon} /> 保存中...</>
                : savedLabel
                ? <><CheckCircle size={12} /> 已保存</>
                : <><Save size={12} /> 保存描述</>}
            </button>
          </section>

          {/* ── 标签管理 ──────────────────────────────────── */}
          <section className={styles.section}>
            <label className={styles.sectionLabel}>
              <Tag size={12} /> 标签管理
              {!canEditTags && (
                <span className={styles.sectionHint}>（标注完成后可编辑）</span>
              )}
            </label>

            <div className={styles.tagsArea}>
              {tagsDraft.length === 0 && (
                <span className={styles.tagsEmpty}>
                  {isAnnotating ? 'AI 正在生成标签...' : '暂无标签'}
                </span>
              )}
              {tagsDraft.map(tag => (
                <span key={tag} className={styles.tagChip}>
                  {tag}
                  {canEditTags && (
                    <button className={styles.removeTagBtn} onClick={() => removeTag(tag)}>
                      <X size={9} />
                    </button>
                  )}
                </span>
              ))}
            </div>

            {canEditTags && (
              <>
                <div className={styles.tagInputRow}>
                  <input
                    ref={tagInputRef}
                    className={styles.tagInput}
                    value={tagInput}
                    onChange={e => setTagInput(e.target.value)}
                    onKeyDown={handleTagKey}
                    placeholder="输入新标签，回车添加"
                    maxLength={20}
                  />
                  <button
                    className={styles.addTagBtn}
                    onClick={addTag}
                    disabled={!tagInput.trim()}
                  >
                    <Plus size={14} />
                  </button>
                </div>
                <button
                  className={clsx(styles.saveBtn, !tagsDirty && styles.disabled)}
                  onClick={handleSaveTags}
                  disabled={!tagsDirty || savingTags}
                >
                  {savingTags
                    ? <><Loader2 size={12} className={styles.spinIcon} /> 保存中...</>
                    : savedTags
                    ? <><CheckCircle size={12} /> 已保存</>
                    : <><Save size={12} /> 保存标签</>}
                </button>
              </>
            )}
          </section>
        </div>
      </aside>
    </div>
  );
}
