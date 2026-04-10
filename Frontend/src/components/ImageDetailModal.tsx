import { useState, useEffect, useRef, KeyboardEvent } from 'react';
import {
  X, Tag, Sparkles, Save, Loader2, RefreshCw, Plus, CheckCircle,
  AlertCircle, Clock, Edit3, Info,
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
  /** 初始模式：'upload'（刚上传，暗示填写描述）| 'view'（点击列表查看/编辑） */
  mode?: 'upload' | 'view';
  onClose: () => void;
  /** 图片数据更新后回调，用于同步父组件列表 */
  onUpdate: (updated: UserImage) => void;
}

const STATUS_CONFIG = {
  pending:    { label: '待标注',  icon: Clock,        color: '#f59e0b' },
  processing: { label: '标注中',  icon: Loader2,      color: '#3b82f6' },
  done:       { label: '已就绪',  icon: CheckCircle,  color: '#22c55e' },
  failed:     { label: '失败',    icon: AlertCircle,  color: '#ef4444' },
} as const;

export default function ImageDetailModal({ image, mode = 'view', onClose, onUpdate }: Props) {
  const [labelDraft, setLabelDraft]     = useState('');
  const [tagsDraft, setTagsDraft]       = useState<string[]>([]);
  const [tagInput, setTagInput]         = useState('');
  const [savingLabel, setSavingLabel]   = useState(false);
  const [savingTags, setSavingTags]     = useState(false);
  const [reannotating, setReannotating] = useState(false);
  const [labelDirty, setLabelDirty]     = useState(false);
  const [tagsDirty, setTagsDirty]       = useState(false);
  const [saved, setSaved]               = useState(false);
  const tagInputRef = useRef<HTMLInputElement>(null);

  // 当 image 变更时重置 draft 状态
  useEffect(() => {
    if (!image) return;
    setLabelDraft(image.label ?? '');
    setTagsDraft(image.tags ?? []);
    setTagInput('');
    setLabelDirty(false);
    setTagsDirty(false);
    setSaved(false);
  }, [image]);

  if (!image) return null;

  const cfg = STATUS_CONFIG[image.annotate_status] ?? STATUS_CONFIG.pending;
  const StatusIcon = cfg.icon;
  const isAnnotating = image.annotate_status === 'pending' || image.annotate_status === 'processing';
  const canEditTags  = image.annotate_status === 'done';
  const previewUrl   = getImagePreviewUrl(image.preview_url);

  // ── 保存描述 ──────────────────────────────────────────────
  const handleSaveLabel = async () => {
    if (!labelDirty) return;
    setSavingLabel(true);
    try {
      const updated = await patchImageLabel(image.image_id, labelDraft.trim() || null);
      onUpdate(updated);
      setLabelDirty(false);
      flashSaved();
    } catch (e: any) {
      alert('描述保存失败：' + (e?.response?.data?.detail || e?.message || '未知错误'));
    } finally {
      setSavingLabel(false);
    }
  };

  // ── 标签操作 ──────────────────────────────────────────────
  const addTag = () => {
    const t = tagInput.trim();
    if (!t || tagsDraft.includes(t)) { setTagInput(''); return; }
    const next = [...tagsDraft, t];
    setTagsDraft(next);
    setTagInput('');
    setTagsDirty(true);
  };

  const removeTag = (tag: string) => {
    setTagsDraft(prev => prev.filter(t => t !== tag));
    setTagsDirty(true);
  };

  const handleTagInputKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); addTag(); }
    if (e.key === 'Backspace' && !tagInput && tagsDraft.length > 0) {
      const next = tagsDraft.slice(0, -1);
      setTagsDraft(next);
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
      flashSaved();
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

  const flashSaved = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <aside className={styles.drawer}>
        {/* ── 顶部栏 ─────────────────────────────────── */}
        <header className={styles.drawerHeader}>
          <div className={styles.headerLeft}>
            <Edit3 size={16} />
            <span>{mode === 'upload' ? '上传成功 — 完善图片信息' : '图片详情'}</span>
          </div>
          <div className={styles.headerRight}>
            {saved && (
              <span className={styles.savedHint}>
                <CheckCircle size={12} /> 已保存
              </span>
            )}
            <button className={styles.closeBtn} onClick={onClose} title="关闭">
              <X size={18} />
            </button>
          </div>
        </header>

        {/* ── 预览区 ─────────────────────────────────── */}
        <div className={styles.previewWrap}>
          <img src={previewUrl} alt={image.filename} className={styles.previewImg} />
          <div className={styles.previewMeta}>
            <span className={styles.filename} title={image.filename}>{image.filename}</span>
            <span className={styles.statusBadge} style={{ background: cfg.color }}>
              <StatusIcon
                size={10}
                className={isAnnotating ? styles.spinIcon : undefined}
              />
              {cfg.label}
            </span>
          </div>
        </div>

        <div className={styles.body}>
          {/* ── 描述（label） ───────────────────────── */}
          <section className={styles.section}>
            <label className={styles.sectionLabel}>
              <Edit3 size={13} /> 图片描述
              <span className={styles.sectionHint}>（AI 标注时会作为提示参考）</span>
            </label>
            <div className={styles.textareaWrap}>
              <textarea
                className={styles.textarea}
                value={labelDraft}
                onChange={e => { setLabelDraft(e.target.value); setLabelDirty(true); }}
                placeholder={mode === 'upload'
                  ? '输入描述（例：牛顿第二定律受力分析示意图），有助于提升 AI 标注精度'
                  : '描述图片内容，有助于 AI 精准检索和匹配'}
                rows={3}
              />
            </div>
            <button
              className={clsx(styles.saveBtn, !labelDirty && styles.saveBtnDisabled)}
              onClick={handleSaveLabel}
              disabled={!labelDirty || savingLabel}
            >
              {savingLabel
                ? <><Loader2 size={13} className={styles.spinIcon} /> 保存中...</>
                : <><Save size={13} /> 保存描述</>}
            </button>
          </section>

          {/* ── AI 描述（只读展示） ─────────────────── */}
          {image.description && (
            <section className={styles.section}>
              <label className={styles.sectionLabel}>
                <Sparkles size={13} /> AI 识别内容
              </label>
              <p className={styles.aiDescription}>{image.description}</p>
            </section>
          )}

          {/* ── 标签管理 ───────────────────────────── */}
          <section className={styles.section}>
            <label className={styles.sectionLabel}>
              <Tag size={13} /> 标签管理
              {!canEditTags && (
                <span className={styles.sectionHint}>（标注完成后可编辑）</span>
              )}
            </label>

            {/* 现有标签 */}
            <div className={styles.tagsArea}>
              {tagsDraft.length === 0 && !canEditTags && (
                <span className={styles.tagsEmpty}>
                  {isAnnotating ? 'AI 正在生成标签，请稍候...' : '暂无标签'}
                </span>
              )}
              {tagsDraft.map(tag => (
                <span key={tag} className={styles.tagChip}>
                  {tag}
                  {canEditTags && (
                    <button
                      className={styles.removeTagBtn}
                      onClick={() => removeTag(tag)}
                      title={`删除标签：${tag}`}
                    >
                      <X size={9} />
                    </button>
                  )}
                </span>
              ))}
            </div>

            {/* 添加新标签 */}
            {canEditTags && (
              <div className={styles.tagInputRow}>
                <input
                  ref={tagInputRef}
                  className={styles.tagInput}
                  value={tagInput}
                  onChange={e => setTagInput(e.target.value)}
                  onKeyDown={handleTagInputKey}
                  placeholder="输入新标签，回车添加"
                  maxLength={20}
                />
                <button
                  className={styles.addTagBtn}
                  onClick={addTag}
                  disabled={!tagInput.trim()}
                  title="添加标签"
                >
                  <Plus size={14} />
                </button>
              </div>
            )}

            {canEditTags && (
              <button
                className={clsx(styles.saveBtn, !tagsDirty && styles.saveBtnDisabled)}
                onClick={handleSaveTags}
                disabled={!tagsDirty || savingTags}
              >
                {savingTags
                  ? <><Loader2 size={13} className={styles.spinIcon} /> 保存中...</>
                  : <><Save size={13} /> 保存标签</>}
              </button>
            )}
          </section>

          {/* ── AI 重新标注 ─────────────────────────── */}
          <section className={styles.section}>
            <label className={styles.sectionLabel}>
              <Sparkles size={13} /> AI 标注
            </label>
            <div className={styles.annotateRow}>
              <p className={styles.annotateDesc}>
                {image.annotate_status === 'done'
                  ? '已完成自动图像识别。如内容有偏差，可重新触发 AI 标注。'
                  : image.annotate_status === 'failed'
                  ? '上次标注失败，点击下方按钮重试。'
                  : 'AI 正在识别图像内容、生成语义描述与标签，完成后自动刷新。'}
              </p>
              <button
                className={clsx(styles.reannotateBtn, reannotating && styles.reannotateBtnBusy)}
                onClick={handleReannotate}
                disabled={reannotating || isAnnotating}
                title={isAnnotating ? '标注进行中，请稍候' : 'AI 重新识别图片'}
              >
                <RefreshCw size={14} className={reannotating ? styles.spinIcon : undefined} />
                {reannotating ? '触发中...' : isAnnotating ? '标注进行中...' : 'AI 重新标注'}
              </button>
            </div>
            {(mode === 'upload' && isAnnotating) && (
              <div className={styles.uploadTip}>
                <Info size={12} />
                上传后 AI 会自动开始标注，通常在 30 秒内完成。描述填写后可先关闭此窗口。
              </div>
            )}
          </section>
        </div>
      </aside>
    </div>
  );
}
