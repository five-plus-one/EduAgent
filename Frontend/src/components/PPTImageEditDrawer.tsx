import { useState, useEffect, useCallback, useRef } from 'react';
import {
  X, Search, Loader2, Check, Image as ImageIcon,
  LayoutGrid, Maximize2, AlignCenter, Crop,
  RefreshCw, Rows, Columns, BarChart2, Clock, Star, Grid,
} from 'lucide-react';
import { clsx } from 'clsx';
import styles from './PPTImageEditDrawer.module.css';
import { apiClient, resolveImagePreviewUrl } from '../utils/api';

/* ─── 类型定义 ─────────────────────────────────────────────── */

export type ObjectFitMode = 'cover' | 'contain' | 'fill';

export interface ImageElement {
  element_id: string;
  type: 'image';
  position: string;
  url?: string;
  alt?: string;
  query?: string;
  resolved?: {
    preview_url?: string;
    image_id?: string;
    source?: string;
  };
}

export interface PPTLayoutTemplate {
  id: string;
  name: string;
  icon: React.ReactNode;
  description: string;
}

interface Props {
  open: boolean;
  pageIndex: number;
  pageTitle: string;
  element: ImageElement | null;
  currentFit: ObjectFitMode;
  onClose: () => void;
  onIterate: (instruction: string) => void;
  onReplaceImage: (elementId: string, imageId: string, newUrl: string, newAlt: string) => void;
  onChangeFit: (elementId: string, fit: ObjectFitMode) => void;
  /** 切换布局模板（不经过 AI）回调，返回 Promise<boolean> 表示是否成功 */
  onApplyLayout?: (layoutType: string) => Promise<boolean>;
}

/* ─── 布局模板 ─────────────────────────────────────────────── */
const LAYOUT_TEMPLATES: PPTLayoutTemplate[] = [
  { id: 'standard',     name: '标准',     icon: <Rows size={18} />,      description: '内容列表，适用于一般知识点' },
  { id: 'two_column',   name: '双栏',     icon: <Columns size={18} />,   description: '左文右图，视觉均衡对比' },
  { id: 'cover',        name: '封面',     icon: <Star size={18} />,      description: '大标题居中，首页或章节页' },
  { id: 'stat_callout', name: '数据强调', icon: <BarChart2 size={18} />, description: '凸显关键数字或统计数据' },
  { id: 'timeline',     name: '时间轴',   icon: <Clock size={18} />,     description: '展示流程步骤或历史事件' },
  { id: 'image_gallery',name: '图片墙',   icon: <LayoutGrid size={18} />,description: '多图并排，视觉展示型页面' },
];

const FIT_OPTIONS: { value: ObjectFitMode; icon: React.ReactNode; label: string }[] = [
  { value: 'cover',   icon: <Maximize2 size={14} />,  label: '自动裁剪' },
  { value: 'contain', icon: <AlignCenter size={14} />, label: '完整显示' },
  { value: 'fill',    icon: <Crop size={14} />,        label: '拉伸填充' },
];

/* ─── 图片结果类型 ─────────────────────────────────────────── */
interface ImageResult {
  image_id: string;
  preview_url: string;
  label?: string;
  tags?: string[];
}

const PAGE_SIZE = 18; // 每次加载的图片数

export default function PPTImageEditDrawer({
  open, pageIndex, element, currentFit,
  onClose, onIterate, onReplaceImage, onChangeFit, onApplyLayout,
}: Props) {
  const [activeTab, setActiveTab] = useState<'image' | 'layout'>('image');
  /** 换图面板内的子模式：search = 搜索，all = 全部 */
  const [imageMode, setImageMode] = useState<'search' | 'all'>('search');
  /** 布局切换加载状态 */
  const [applyingLayout, setApplyingLayout] = useState(false);

  // ── 搜索状态 ──────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<ImageResult[]>([]);

  // ── 全部图片状态 ───────────────────────────────────────────
  const [allImages, setAllImages] = useState<ImageResult[]>([]);
  const [allPage, setAllPage] = useState(1);
  const [allTotal, setAllTotal] = useState(0);
  const [allLoading, setAllLoading] = useState(false);
  const allLoadedOnce = useRef(false);

  // ── 公共选择态 ─────────────────────────────────────────────
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);

  /* 重置状态 */
  useEffect(() => {
    if (element) {
      setSearchQuery(element.alt || element.query || '');
      setSearchResults([]);
      setSelectedImageId(element.resolved?.image_id ?? null);
      setAllImages([]);
      setAllPage(1);
      setAllTotal(0);
      allLoadedOnce.current = false;
    }
  }, [element?.element_id]);

  /* 切到「全部」时首次加载 */
  useEffect(() => {
    if (imageMode === 'all' && !allLoadedOnce.current) {
      loadAllImages(1, true);
    }
  }, [imageMode]);

  /* ── 搜索 ──────────────────────────────────────────────── */
  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const res = await apiClient.get('/users/me/images', {
        params: { page: 1, size: PAGE_SIZE, keyword: searchQuery.trim() },
      });
      const items = res.data?.data?.items ?? res.data?.items ?? [];
      setSearchResults(normalizeImages(items));
    } catch (e) {
      console.error('Image search failed', e);
    } finally {
      setSearching(false);
    }
  }, [searchQuery]);

  /* ── 全部图片加载（分页） ───────────────────────────────── */
  const loadAllImages = async (page: number, reset = false) => {
    if (allLoading) return;
    setAllLoading(true);
    try {
      const res = await apiClient.get('/users/me/images', {
        params: { page, size: PAGE_SIZE },
      });
      const data = res.data?.data ?? res.data ?? {};
      const items: ImageResult[] = normalizeImages(data.items ?? []);
      setAllTotal(data.total ?? 0);
      setAllImages(prev => reset ? items : [...prev, ...items]);
      setAllPage(page);
      if (reset) allLoadedOnce.current = true;
    } catch (e) {
      console.error('Load all images failed', e);
    } finally {
      setAllLoading(false);
    }
  };

  /* ── 应用选中图片 ──────────────────────────────────────── */
  const displayedResults = imageMode === 'search' ? searchResults : allImages;

  const handleApplyImage = () => {
    const selected = displayedResults.find(r => r.image_id === selectedImageId);
    if (!selected || !element) return;
    const previewUrl = resolveImagePreviewUrl(selected.preview_url);
    // 将 image_id 传给父组件，父组件负责调用后端 PATCH 接口持久化
    onReplaceImage(element.element_id, selected.image_id, previewUrl, selected.label || searchQuery || '图片');
    onClose();
  };

  const handleApplyLayout = async (templateId: string) => {
    // 优先使用后端确定性接口；出错时降级为发送 AI 指令
    if (onApplyLayout) {
      setApplyingLayout(true);
      try {
        const ok = await onApplyLayout(templateId);
        if (ok) {
          onClose();
          return;
        }
        // 后端失败，降级为 AI 指令
        console.warn('[PPTImageEditDrawer] apply-layout failed, falling back to AI iterate');
      } finally {
        setApplyingLayout(false);
      }
    }
    // Fallback: 通过 AI 指令实现（无 onApplyLayout 或后端失败时）
    onIterate(`将这一页的布局切换为“${LAYOUT_TEMPLATES.find(t => t.id === templateId)?.name}”（layout_type: ${templateId}），保持现有内容不变。`);
    onClose();
  };

  if (!open || !element) return null;

  const currentPreviewUrl = element.resolved?.preview_url
    ? resolveImagePreviewUrl(element.resolved.preview_url)
    : element.url ?? null;

  const hasMore = allImages.length < allTotal;

  return (
    <div className={styles.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={styles.drawer}>

        {/* ── Header ─────────────────────────────────────────── */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <ImageIcon size={15} />
            <span>第 {pageIndex} 页 · 图片编辑</span>
          </div>
          <button className={styles.closeBtn} onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {/* ── 当前图片预览 ────────────────────────────────────── */}
        <div className={styles.currentPreview}>
          {currentPreviewUrl ? (
            <img src={currentPreviewUrl} alt={element.alt || '当前图片'} style={{ objectFit: currentFit }} />
          ) : (
            <div className={styles.previewEmpty}>
              <ImageIcon size={36} opacity={0.25} />
              <span>暂无匹配图片</span>
            </div>
          )}
          <div className={styles.previewMeta}>
            <span className={styles.previewAlt}>{element.alt || element.query || '未命名图片'}</span>
          </div>
        </div>

        {/* ── Object-Fit 快速切换 ──────────────────────────── */}
        <div className={styles.fitRow}>
          <span className={styles.fitLabel}>显示方式</span>
          <div className={styles.fitOptions}>
            {FIT_OPTIONS.map(opt => (
              <button
                key={opt.value}
                className={clsx(styles.fitBtn, currentFit === opt.value && styles.fitBtnActive)}
                onClick={() => onChangeFit(element.element_id, opt.value)}
              >
                {opt.icon}
                <span>{opt.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ── Tab 切换（换图 / 切换模板） ───────────────────── */}
        <div className={styles.tabs}>
          <button
            className={clsx(styles.tab, activeTab === 'image' && styles.tabActive)}
            onClick={() => setActiveTab('image')}
          >
            <RefreshCw size={13} /> 换图
          </button>
          <button
            className={clsx(styles.tab, activeTab === 'layout' && styles.tabActive)}
            onClick={() => setActiveTab('layout')}
          >
            <LayoutGrid size={13} /> 切换模板
          </button>
        </div>

        {/* ══════════════════════════════════════════════════════
            换图面板
            ══════════════════════════════════════════════════════ */}
        {activeTab === 'image' && (
          <div className={styles.body}>

            {/* 二级切换：搜索 / 全部 */}
            <div className={styles.imageModeBar}>
              <button
                className={clsx(styles.imageModeBtn, imageMode === 'search' && styles.imageModeBtnActive)}
                onClick={() => setImageMode('search')}
              >
                <Search size={12} /> 搜索
              </button>
              <button
                className={clsx(styles.imageModeBtn, imageMode === 'all' && styles.imageModeBtnActive)}
                onClick={() => setImageMode('all')}
              >
                <Grid size={12} /> 全部图片
                {allTotal > 0 && <span className={styles.totalBadge}>{allTotal}</span>}
              </button>
            </div>

            {/* ── 搜索模式 ──────────────────────────────────── */}
            {imageMode === 'search' && (
              <>
                <div className={styles.searchRow}>
                  <input
                    className={styles.searchInput}
                    placeholder="搜索关键词，例：显微镜、电路图..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSearch()}
                  />
                  <button
                    className={styles.searchBtn}
                    onClick={handleSearch}
                    disabled={searching || !searchQuery.trim()}
                  >
                    {searching ? <Loader2 size={15} className={styles.spin} /> : <Search size={15} />}
                  </button>
                </div>

                <ImageGrid
                  images={searchResults}
                  loading={searching}
                  selectedId={selectedImageId}
                  onSelect={setSelectedImageId}
                  emptyIcon={<Search size={28} opacity={0.2} />}
                  emptyText="输入关键词后按回车搜索图片库"
                />
              </>
            )}

            {/* ── 全部图片模式 ────────────────────────────── */}
            {imageMode === 'all' && (
              <>
                <ImageGrid
                  images={allImages}
                  loading={allLoading && allImages.length === 0}
                  selectedId={selectedImageId}
                  onSelect={setSelectedImageId}
                  emptyIcon={<ImageIcon size={28} opacity={0.2} />}
                  emptyText="图片库暂无内容"
                />

                {/* 加载更多 */}
                {hasMore && (
                  <button
                    className={styles.loadMoreBtn}
                    disabled={allLoading}
                    onClick={() => loadAllImages(allPage + 1)}
                  >
                    {allLoading
                      ? <><Loader2 size={13} className={styles.spin} /> 加载中...</>
                      : <>加载更多 ({allImages.length}/{allTotal})</>
                    }
                  </button>
                )}

                {/* 刷新按钮 */}
                {!hasMore && allImages.length > 0 && (
                  <p className={styles.allLoadedHint}>已加载全部 {allTotal} 张图片</p>
                )}
              </>
            )}

            {/* 应用按钮 */}
            {selectedImageId && (
              <div className={styles.applyRow}>
                <button className={styles.applyBtn} onClick={handleApplyImage}>
                  <Check size={15} /> 应用选中图片
                </button>
              </div>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════
            切换模板面板
            ══════════════════════════════════════════════════════ */}
        {activeTab === 'layout' && (
          <div className={styles.body}>
            <p className={styles.layoutHint}>
              选择一个布局模板，AI 将在保留现有内容的前提下重排版此页
            </p>
            <div className={styles.layoutGrid}>
              {LAYOUT_TEMPLATES.map(tpl => (
                <button
                  key={tpl.id}
                  className={styles.layoutCard}
                  disabled={applyingLayout}
                  onClick={() => handleApplyLayout(tpl.id)}
                >
                  <div className={styles.layoutCardIcon}>{tpl.icon}</div>
                  <div className={styles.layoutCardText}>
                    <span className={styles.layoutCardName}>{tpl.name}</span>
                    <span className={styles.layoutCardDesc}>{tpl.description}</span>
                  </div>
                </button>
              ))}
            </div>

            {applyingLayout && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 0', color: 'var(--text-secondary)', fontSize: '13px' }}>
                <Loader2 size={14} className={styles.spin} />
                <span>正在应用布局...</span>
              </div>
            )}

            <div className={styles.customIterateRow}>
              <p className={styles.customIterateLabel}>自定义指令</p>
              <CustomIterateBox onIterate={(inst) => { onIterate(inst); onClose(); }} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── 图片网格（公共子组件） ──────────────────────────────── */
function ImageGrid({
  images, loading, selectedId, onSelect, emptyIcon, emptyText,
}: {
  images: ImageResult[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  emptyIcon: React.ReactNode;
  emptyText: string;
}) {
  if (loading) {
    return (
      <div className={styles.searchPending}>
        <Loader2 size={28} className={styles.spin} />
        <span>加载中...</span>
      </div>
    );
  }
  if (images.length === 0) {
    return (
      <div className={styles.searchEmpty}>
        {emptyIcon}
        <span>{emptyText}</span>
      </div>
    );
  }
  return (
    <div className={styles.imageGrid}>
      {images.map(img => {
        const url = resolveImagePreviewUrl(img.preview_url);
        const isSelected = selectedId === img.image_id;
        return (
          <button
            key={img.image_id}
            className={clsx(styles.imageThumb, isSelected && styles.imageThumbSelected)}
            onClick={() => onSelect(isSelected ? null : img.image_id)}
          >
            <img src={url} alt={img.label || ''} />
            {isSelected && (
              <div className={styles.imageCheck}>
                <Check size={14} />
              </div>
            )}
            {img.label && (
              <div className={styles.imageLabel}>{img.label}</div>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ─── 工具函数 ─────────────────────────────────────────────── */
function normalizeImages(items: any[]): ImageResult[] {
  return items.map((img: any) => ({
    image_id: img.image_id,
    preview_url: img.preview_url ?? img.url ?? '',
    label: img.label ?? img.filename ?? '',
    tags: img.tags ?? [],
  }));
}

/* ─── 自定义指令 ───────────────────────────────────────────── */
function CustomIterateBox({ onIterate }: { onIterate: (s: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <div className={styles.customBox}>
      <textarea
        className={styles.customInput}
        placeholder="例：改成深色背景，加一张展示分子结构的图片，标题居中对齐..."
        value={value}
        onChange={e => setValue(e.target.value)}
        rows={3}
      />
      <button
        className={styles.customSubmitBtn}
        disabled={!value.trim()}
        onClick={() => { onIterate(value.trim()); setValue(''); }}
      >
        <RefreshCw size={14} /> AI 重排此页
      </button>
    </div>
  );
}
