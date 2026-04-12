/**
 * PPTPageWorkbench — 合并后的页面工作台
 *
 * 将「图片替换 (PPTImageEditDrawer)」与「PPT页面编辑 (PPTPageEditPanel)」
 * 统一为一个右侧抽屉，内部以 4 个 Tab 组织：
 *   ✏️  编辑内容   — 标题 / 元素列表 / 演讲注记  (原 PPTPageEditPanel)
 *   🖼️  替换图片   — 搜索 / 浏览图库             (原 PPTImageEditDrawer 换图子面板)
 *   🪄  切换布局   — 6 种版式模板                (原 PPTImageEditDrawer 布局子面板)
 *   ✨  AI 指令   — 针对当前页的自由指令
 *
 * 触发入口：
 *   - 点击卡片上的🖊 铅笔按钮 → defaultTab = 'edit'
 *   - 点击卡片内图片区域   → defaultTab = 'image'，并把 clickedElement 传入
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  X, Pencil, Plus, Trash2, GripVertical, ChevronDown, ChevronUp,
  Check, Sparkles, StickyNote, Type, List, Image as ImageIcon,
  Hash, Clock, AlignLeft, ChevronRight,
  Search, Loader2, LayoutGrid, Maximize2, AlignCenter, Crop,
  Rows, Columns, BarChart2, Star, Grid,
  Wand2,
} from 'lucide-react';
import { clsx } from 'clsx';
import styles from './PPTPageWorkbench.module.css';
import type { PPTPage, PPTElement } from '../hooks/useCourseware';
import { apiClient, resolveImagePreviewUrl } from '../utils/api';

/* ─── 公共类型 ──────────────────────────────────────────────── */

export type ObjectFitMode = 'cover' | 'contain' | 'fill';

export interface ImageElement {
  element_id: string;
  type: 'image';
  position: string;
  url?: string;
  alt?: string;
  query?: string;
  resolved?: { preview_url?: string; image_id?: string; source?: string };
}

export type WorkbenchTab = 'edit' | 'layout' | 'ai';

export interface PPTPageWorkbenchProps {
  open: boolean;
  page: PPTPage;
  sessionId: string;
  /** 初始打开的 Tab（点击铅笔→'edit'，点击图片→'image'） */
  defaultTab?: WorkbenchTab;
  /** 当从图片入口打开时，传入被点击的图片元素 */
  activeImageElement?: ImageElement | null;
  currentFit?: ObjectFitMode;
  onClose: () => void;
  onSave: (updatedPage: Partial<PPTPage>) => void;
  onIterate: (instruction: string) => void;
  onReplaceImage: (elementId: string, imageId: string, newUrl: string, newAlt: string) => void;
  onChangeFit: (elementId: string, fit: ObjectFitMode) => void;
  onApplyLayout?: (layoutType: string) => Promise<boolean>;
}

/* ─── 布局模板 ──────────────────────────────────────────────── */
const LAYOUT_TEMPLATES = [
  { id: 'standard',      name: '标准',     icon: <Rows size={18} />,       description: '内容列表，适用于一般知识点' },
  { id: 'two_column',    name: '双栏',     icon: <Columns size={18} />,    description: '左文右图，视觉均衡对比' },
  { id: 'cover',         name: '封面',     icon: <Star size={18} />,       description: '大标题居中，首页或章节页' },
  { id: 'stat_callout',  name: '数据强调', icon: <BarChart2 size={18} />,  description: '凸显关键数字或统计数据' },
  { id: 'timeline',      name: '时间轴',   icon: <Clock size={18} />,      description: '展示流程步骤或历史事件' },
  { id: 'image_gallery', name: '图片墙',   icon: <LayoutGrid size={18} />, description: '多图并排，视觉展示型页面' },
];

const FIT_OPTIONS: { value: ObjectFitMode; icon: React.ReactNode; label: string }[] = [
  { value: 'cover',   icon: <Maximize2 size={13} />,  label: '裁剪填充' },
  { value: 'contain', icon: <AlignCenter size={13} />, label: '完整显示' },
  { value: 'fill',    icon: <Crop size={13} />,        label: '拉伸填充' },
];

/* ─── 元素类型 ──────────────────────────────────────────────── */
const ELEMENT_TYPES = [
  { type: 'text_block',   label: '文本块',   icon: <AlignLeft size={14} />,  defaultContent: ['新增文本内容'], defaultPosition: 'full',   description: '段落文字，支持 Markdown' },
  { type: 'list',         label: '列表',     icon: <List size={14} />,       defaultContent: ['要点一', '要点二', '要点三'], defaultPosition: 'full', description: '多行要点列表', useItemEditor: true },
  { type: 'subtitle',     label: '副标题',   icon: <Type size={14} />,       defaultContent: ['副标题文字'], defaultPosition: 'center', description: '页面副标题' },
  { type: 'huge_number',  label: '数据强调', icon: <Hash size={14} />,       defaultContent: ['98%'], defaultPosition: 'center', description: '凸显大数字', hasAccent: true },
  { type: 'timeline_item',label: '时间节点', icon: <Clock size={14} />,      defaultContent: ['事件说明'], defaultPosition: 'left', description: '时间轴条目', hasTime: true, useItemEditor: true },
  { type: 'image',        label: '图片占位', icon: <ImageIcon size={14} />,  defaultContent: [], defaultPosition: 'right', description: '图片区域', isImage: true },
  { type: 'table',        label: '表格',     icon: <Grid size={14} />,       defaultContent: [], defaultPosition: 'full', description: '支持 LaTeX 公式的数据表格', isTable: true,
    defaultHeaders: ['列标题1', '列标题2', '列标题3'],
    defaultRows: [['', '', '']],
  },
] as const;

type ElementTypeDef = typeof ELEMENT_TYPES[number] & { useItemEditor?: boolean; hasTime?: boolean; hasAccent?: boolean; isImage?: boolean; isTable?: boolean; defaultHeaders?: string[]; defaultRows?: string[][] };
const TYPE_MAP = Object.fromEntries((ELEMENT_TYPES as readonly any[]).map(t => [t.type, t])) as Record<string, ElementTypeDef>;
const POSITIONS = ['full', 'center', 'left', 'right', 'top', 'bottom', 'left_top', 'left_bottom', 'right_top', 'right_bottom'];

/* ─── EditableEl ────────────────────────────────────────────── */
interface EditableEl {
  element_id: string; type: string; position: string;
  textLines: string[]; time?: string; is_accent?: boolean;
  alt?: string; query?: string; _raw: PPTElement;
  /** 表格专属字段 */
  headers?: string[];
  rows?: string[][];
}

const uid = () => Math.random().toString(36).slice(2, 9);
const toArr = (content: unknown): string[] => {
  if (Array.isArray(content)) return content.map(String).filter(Boolean);
  if (content == null) return [];
  return [String(content)];
};
function toEditable(el: PPTElement): EditableEl {
  const base: EditableEl = {
    element_id: el.element_id, type: el.type, position: el.position,
    textLines: Array.isArray(el.content) ? el.content.map(String).filter(Boolean) : [],
    time: (el as any).time,
    is_accent: el.is_accent,
    alt: el.alt,
    query: el.query,
    _raw: el,
  };
  if (el.type === 'table') {
    // 优先用接口字段，降级到 _raw 增强兼容（防止 Pydantic strip 后前端导致数据丢失）
    base.headers = Array.isArray(el.headers) ? el.headers
      : Array.isArray((el as any)._raw?.headers) ? (el as any)._raw.headers
      : [];
    base.rows = Array.isArray(el.rows) ? el.rows
      : Array.isArray((el as any)._raw?.rows) ? (el as any)._raw.rows
      : [];
  }
  return base;
}
function fromEditable(e: EditableEl): PPTElement {
  const base: any = { ...(e._raw), element_id: e.element_id, type: e.type,
    position: e.position, time: e.time, is_accent: e.is_accent };
  if (e.type === 'image') {
    base.alt = e.alt; base.query = e.query || e.alt; delete base.content;
  } else if (e.type === 'table') {
    // 表格：直接写 headers/rows，content 保持为空数组
    base.headers = e.headers ?? [];
    base.rows    = e.rows    ?? [];
    base.content = [];
    delete base.alt; delete base.query;
  } else {
    base.content = e.textLines.length > 0 ? e.textLines : undefined;
    delete base.alt; delete base.query;
  }
  return base as PPTElement;
}

/* ─── 图片相关 ──────────────────────────────────────────────── */
interface ImageResult { image_id: string; preview_url: string; label?: string; tags?: string[] }
const PAGE_SIZE = 18;
function normalizeImages(items: any[]): ImageResult[] {
  return items.map((img: any) => ({
    image_id: img.image_id,
    preview_url: img.preview_url ?? img.url ?? '',
    label: img.label ?? img.filename ?? '',
    tags: img.tags ?? [],
  }));
}

/* ══════════════════════════════════════════════════════════════
   主组件
   ══════════════════════════════════════════════════════════════ */
export default function PPTPageWorkbench({
  open, page, defaultTab = 'edit', activeImageElement = null, currentFit = 'cover',
  onClose, onSave, onIterate, onReplaceImage, onChangeFit, onApplyLayout,
}: PPTPageWorkbenchProps) {

  const [activeTab, setActiveTab] = useState<WorkbenchTab>(defaultTab);

  /* ── 内容编辑状态 ─────────────────────────────────────────── */
  const [title, setTitle] = useState(page.title ?? '');
  const [speakerNotes, setSpeakerNotes] = useState(page.speaker_notes ?? '');
  const [elements, setElements] = useState<EditableEl[]>([]);
  const [isDirty, setIsDirty] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  /** 被拖动元素的索引（不触发 re-render，只用于 drop 时读取） */
  const dragSrcIdx = useRef<number | null>(null);
  /** 当前 hover 的放置目标索引（触发 re-render 以显示动画） */
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  /** 当前打开自定义类型下拉的元素索引，-1 表示全部关闭 */
  const [typeMenuOpenIdx, setTypeMenuOpenIdx] = useState<number>(-1);
  /** 当前打开的菜单 DOM 引用，用于判断点击是否在菜单内部 */
  const typeMenuRef = useRef<HTMLDivElement | null>(null);

  /* ── AI 指令状态 ────────────────────────────────────────── */
  const [aiInstruction, setAiInstruction] = useState('');

  /* ── 图片选择器弹窗状态 */
  /** 当前打开的图片选择器 */
  const [pickerOpen, setPickerOpen] = useState(false);
  /** 正在操作的图片元素 */
  const [pickerEl, setPickerEl] = useState<EditableEl | null>(null);
  const [imageMode, setImageMode] = useState<'search' | 'all'>('search');
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<ImageResult[]>([]);
  const [allImages, setAllImages] = useState<ImageResult[]>([]);
  const [allPage, setAllPage] = useState(1);
  const [allTotal, setAllTotal] = useState(0);
  const [allLoading, setAllLoading] = useState(false);
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const allLoadedOnce = useRef(false);

  /* ── 布局面板状态 ────────────────────────────────────────── */
  const [applyingLayout, setApplyingLayout] = useState(false);

  /**
   * 当前打开的 ImagePickerModal 里「显示方式」的 fit 值。
   * 独立于 props.currentFit（后者只代表从预览区点击进来时的图片 fit），
   * 由打开 picker 时从 _raw.fit 初始化，避免与 activeImageElement 产生绑定。
   */
  const [pickerFit, setPickerFit] = useState<ObjectFitMode>('cover');

  /* ── 重置（换页时）───────────────────────────────────────────── */
  useEffect(() => {
    if (!open) return;
    setActiveTab(defaultTab);
    setTitle(page.title ?? '');
    setSpeakerNotes(page.speaker_notes ?? '');
    setElements(page.elements?.map(toEditable) ?? []);
    setIsDirty(false);
    setAiInstruction('');
    // 图片面板重置：有 activeImageElement 时预填搜索词，否则清空
    setSearchQuery(activeImageElement?.alt || activeImageElement?.query || '');
    setSelectedImageId(activeImageElement?.resolved?.image_id ?? null);
    setSearchResults([]);
    setAllImages([]);
    setAllPage(1);
    setAllTotal(0);
    allLoadedOnce.current = false;
    setTypeMenuOpenIdx(-1); // 换页时关闭菜单
  }, [page.page_index, open, defaultTab]);

  /* ── 点击外部关闭类型下拉菜单 ──────────────────────────────── */
  useEffect(() => {
    if (typeMenuOpenIdx === -1) return;
    const close = (e: MouseEvent) => {
      // 点击在菜单内部时不关闭，让 onClick 正常触发
      if (typeMenuRef.current?.contains(e.target as Node)) return;
      setTypeMenuOpenIdx(-1);
    };
    // 泡氯阶段（不用捕获阶段），防止在 onClick 前卸载菜单
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [typeMenuOpenIdx]);

  /* ── 全部图片首次加载（picker 打开时触发） */
  useEffect(() => {
    if (pickerOpen && imageMode === 'all' && !allLoadedOnce.current) {
      loadAllImages(1, true);
    }
  }, [pickerOpen, imageMode]);

  const markDirty = () => setIsDirty(true);

  /* ── 内容编辑操作 ─────────────────────────────────────────── */
  const updateElement = (idx: number, patch: Partial<EditableEl>) => {
    setElements(prev => { const next = [...prev]; next[idx] = { ...next[idx], ...patch }; return next; });
    markDirty();
  };
  const addElement = (type: string) => {
    const def = TYPE_MAP[type] ?? ELEMENT_TYPES[0];
    const id = uid();
    const isImg   = (def as any).isImage;
    const isTable = (def as any).isTable;
    const newEl: EditableEl = {
      element_id: id, type: def.type, position: def.defaultPosition,
      textLines: isImg ? [] : [...(def.defaultContent as any)],
      alt:   isImg   ? '' : undefined,
      query: isImg   ? '' : undefined,
      time:  (def as any).hasTime ? '' : undefined,
      _raw: { element_id: id, type: def.type, position: def.defaultPosition,
        content: isImg ? undefined : def.defaultContent,
        alt: isImg ? '' : undefined } as any,
    };
    // 表格元素预填默认结构
    if (isTable) {
      newEl.headers = (def as any).defaultHeaders ?? ['共1', '共2', '共3'];
      newEl.rows    = (def as any).defaultRows    ?? [['', '', '']];
    }
    setElements(prev => [...prev, newEl]);
    markDirty();
  };
  const removeElement = (idx: number) => { setElements(prev => prev.filter((_, i) => i !== idx)); markDirty(); };

  const handleSave = () => {
    onSave({ title, speaker_notes: speakerNotes, elements: elements.map(fromEditable) });
    setIsDirty(false);
    onClose();
  };

  const handleDragStart = (idx: number, e: React.DragEvent) => {
    dragSrcIdx.current = idx;
    // 用整行卡片作为拖影，而不是只截取小小的 handle
    const row = (e.currentTarget as HTMLElement).closest('[data-element-row]') as HTMLElement | null;
    if (row) {
      // offset 让光标大致在卡片中央偏上，体验更自然
      e.dataTransfer.setDragImage(row, 24, row.offsetHeight / 2);
    }
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragSrcIdx.current === null || dragSrcIdx.current === idx) return;
    if (dragOverIdx !== idx) setDragOverIdx(idx);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    // 只有真正离开整行时才清除指示，避免子元素触发误清
    const row = (e.currentTarget as HTMLElement);
    if (!row.contains(e.relatedTarget as Node)) {
      setDragOverIdx(null);
    }
  };

  const handleDrop = (idx: number) => {
    const src = dragSrcIdx.current;
    if (src === null || src === idx) { setDragOverIdx(null); return; }
    setElements(prev => {
      const next = [...prev];
      const [moved] = next.splice(src, 1);
      next.splice(idx, 0, moved);
      return next;
    });
    markDirty();
    dragSrcIdx.current = null;
    setDragOverIdx(null);
  };

  const handleDragEnd = () => {
    dragSrcIdx.current = null;
    setDragOverIdx(null);
  };

  /* ── 图片操作 ─────────────────────────────────────────────── */
  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const res = await apiClient.get('/users/me/images', {
        params: { page: 1, size: PAGE_SIZE, keyword: searchQuery.trim() },
      });
      setSearchResults(normalizeImages(res.data?.data?.items ?? res.data?.items ?? []));
    } catch (e) { console.error('Image search failed', e); }
    finally { setSearching(false); }
  }, [searchQuery]);

  const loadAllImages = async (page: number, reset = false) => {
    if (allLoading) return;
    setAllLoading(true);
    try {
      const res = await apiClient.get('/users/me/images', { params: { page, size: PAGE_SIZE } });
      const data = res.data?.data ?? res.data ?? {};
      const items = normalizeImages(data.items ?? []);
      setAllTotal(data.total ?? 0);
      setAllImages(prev => reset ? items : [...prev, ...items]);
      setAllPage(page);
      if (reset) allLoadedOnce.current = true;
    } catch (e) { console.error('Load all images failed', e); }
    finally { setAllLoading(false); }
  };

  const handleApplyImage = (elementId: string) => {
    const displayedResults = imageMode === 'search' ? searchResults : allImages;
    const selected = displayedResults.find(r => r.image_id === selectedImageId);
    if (!selected) return;
    const newUrl = resolveImagePreviewUrl(selected.preview_url);
    const newAlt = selected.label || searchQuery || '图片';

    // 1. 通知父组件执行实际换图
    onReplaceImage(elementId, selected.image_id, newUrl, newAlt);

    // 2. 同步更新本地 elements 状态，让缩略图立刻刻刷新
    setElements(prev => prev.map(el => {
      if (el.element_id !== elementId) return el;
      return {
        ...el,
        alt: newAlt,
        _raw: {
          ...(el._raw as any),
          url: newUrl,
          alt: newAlt,
          resolved: { preview_url: selected.preview_url, image_id: selected.image_id, source: 'library' },
        } as any,
      };
    }));
    markDirty();

    // 3. 关闭选择器弹窗
    setPickerOpen(false);
    setPickerEl(null);
    setSelectedImageId(null);
  };

  /* ── 布局操作 ─────────────────────────────────────────────── */
  const handleApplyLayout = async (templateId: string) => {
    if (onApplyLayout) {
      setApplyingLayout(true);
      try {
        const ok = await onApplyLayout(templateId);
        if (ok) { onClose(); return; }
      } finally { setApplyingLayout(false); }
    }
    onIterate(`将这一页的布局切换为"${LAYOUT_TEMPLATES.find(t => t.id === templateId)?.name}"（layout_type: ${templateId}），保持现有内容不变。`);
    onClose();
  };

  if (!open) return null;

  const hasMore = allImages.length < allTotal;

  const TAB_DEFS: { key: WorkbenchTab; label: string; icon: React.ReactNode }[] = [
    { key: 'edit',   label: '编辑内容', icon: <Pencil size={13} /> },
    { key: 'layout', label: '切换布局', icon: <LayoutGrid size={13} /> },
    { key: 'ai',     label: 'AI 指令',  icon: <Wand2 size={13} /> },
  ];

  return (
    <div className={styles.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={styles.panel}>

        {/* ── Header ─────────────────────────────────────────── */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <span className={styles.headerPageNum}>P{page.page_index}</span>
            <span className={styles.headerTitle}>{page.title || '幻灯片编辑'}</span>
          </div>
          <div className={styles.headerRight}>
            {isDirty && (
              <button className={styles.headerSaveBtn} onClick={handleSave}>
                <Check size={14} /> 保存
              </button>
            )}
            <button className={styles.closeBtn} onClick={onClose}><X size={18} /></button>
          </div>
        </div>

        {/* ── Tab Bar ────────────────────────────────────────── */}
        <div className={styles.tabBar}>
          {TAB_DEFS.map(tab => (
            <button
              key={tab.key}
              className={clsx(styles.tab, activeTab === tab.key && styles.tabActive)}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {/* ══════════════════════════════════════════════════════
            Tab: 编辑内容
            ══════════════════════════════════════════════════════ */}
        {activeTab === 'edit' && (
          <div className={styles.body}>

            {/* 标题 */}
            <section className={styles.section}>
              <label className={styles.sectionLabel}><Type size={13} /> 页面标题</label>
              <input
                className={styles.titleInput}
                value={title}
                onChange={e => { setTitle(e.target.value); markDirty(); }}
                placeholder="输入标题..."
              />
            </section>

            {/* 元素列表 */}
            <section className={styles.section}>
              <div className={styles.sectionLabelRow}>
                <label className={styles.sectionLabel}>
                  <List size={13} /> 内容模块
                  <span className={styles.elementCount}>{elements.length}</span>
                </label>
                <AddElementDropdown onAdd={addElement} />
              </div>

              {elements.length === 0 && (
                <div className={styles.emptyHint}>
                  <Plus size={20} strokeWidth={1.5} className={styles.emptyHintIcon} />
                  <p>此页暂无内容，点击「添加元素」开始构建</p>
                </div>
              )}

              <div className={styles.elementList}>
                {elements.map((el, idx) => {
                  const def = TYPE_MAP[el.type];
                  const isInteractive = ['interactive_game', 'animation', 'html5'].includes(el.type);
                  const useItemEditor = (def as any)?.useItemEditor ?? false;

                  if (isInteractive) {
                    return (
                      <div key={el.element_id} className={clsx(styles.elementRow, styles.elementReadonly)}>
                        <span className={styles.elementTypeBadge}>{el.type}</span>
                        <span className={styles.elementReadonlyHint}>交互/动画元素，暂不支持文本编辑</span>
                      </div>
                    );
                  }
                  return (
                    <div
                      key={el.element_id}
                      data-element-row
                      className={clsx(
                        styles.elementRow,
                        dragOverIdx === idx && styles.elementRowDropTarget,
                        dragSrcIdx.current === idx && styles.elementRowDragging,
                      )}
                      onDragOver={e => handleDragOver(e, idx)}
                      onDragLeave={handleDragLeave}
                      onDrop={() => handleDrop(idx)}
                    >
                      {/* 拖动 handle */}
                      <div
                        className={styles.elementDragHandle}
                        draggable
                        onDragStart={e => handleDragStart(idx, e)}
                        onDragEnd={handleDragEnd}
                        title="拖拽排序"
                      >
                        <GripVertical size={14} />
                      </div>

                      <div className={styles.elementMain}>
                        {/* 类型 / 位置 / 强调 选择器 */}
                        <div className={styles.elementMeta}>
                        {/* 自定义类型 Pill 下拉 */}
                          <div className={styles.typePillWrap}>
                            <button
                              className={styles.typePill}
                              onClick={() => setTypeMenuOpenIdx(typeMenuOpenIdx === idx ? -1 : idx)}
                              type="button"
                            >
                              {def?.icon ?? <AlignLeft size={12} />}
                              <span>{def?.label ?? el.type}</span>
                              <ChevronDown size={11} className={clsx(styles.typePillChevron, typeMenuOpenIdx === idx && styles.typePillChevronOpen)} />
                            </button>
                            {typeMenuOpenIdx === idx && (
                              <div className={styles.typeMenu} ref={typeMenuRef}>
                                {(ELEMENT_TYPES as readonly any[]).map(t => (
                                  <button
                                    key={t.type}
                                    className={clsx(styles.typeMenuItem, el.type === t.type && styles.typeMenuItemActive)}
                                    onClick={() => {
                                      setTypeMenuOpenIdx(-1);
                                      if (t.type === el.type) return;
                                      const patch: Partial<EditableEl> = {
                                        type: t.type,
                                        position: t.defaultPosition ?? el.position,
                                        // 图片字段
                                        alt:   t.isImage  ? (el.alt   ?? '') : undefined,
                                        query: t.isImage  ? (el.query ?? '') : undefined,
                                        // 时间轴时间字桵
                                        time:  t.hasTime  ? (el.time  ?? '') : undefined,
                                        // 文本内容
                                        textLines: t.isImage || t.isTable ? []
                                          : (el.textLines.length ? el.textLines : (t.defaultContent ?? [])),
                                        // 表格字桵
                                        headers: t.isTable
                                          ? (t.defaultHeaders ?? ['列标题1', '列标题2', '列标题3'])
                                          : undefined,
                                        rows: t.isTable
                                          ? (el.type === 'list' && el.textLines.length > 0
                                              // 智能转换：list 每条变一行数据行
                                              ? el.textLines.map(line => [line, '', ''])
                                              : (t.defaultRows ?? [['', '', '']]))
                                          : undefined,
                                      };
                                      updateElement(idx, patch);
                                    }}
                                    type="button"
                                  >
                                    <span className={styles.typeMenuItemIcon}>{t.icon}</span>
                                    <span className={styles.typeMenuItemLabel}>{t.label}</span>
                                    <span className={styles.typeMenuItemDesc}>{t.description}</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                          <select className={styles.positionSelect} value={el.position}
                            onChange={e => updateElement(idx, { position: e.target.value })}>
                            {POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
                          </select>
                          {(def as any)?.hasAccent && (
                            <button
                              className={clsx(styles.accentToggle, el.is_accent && styles.accentToggleOn)}
                              onClick={() => updateElement(idx, { is_accent: !el.is_accent })}
                            >强调</button>
                          )}
                        </div>

                        {/* 时间线时间字段 */}
                        {el.type === 'timeline_item' && (
                          <div className={styles.timeRow}>
                            <Clock size={12} className={styles.timeIcon} />
                            <input className={styles.timeInput} placeholder="时间节点（如 2024、第一阶段）"
                              value={el.time ?? ''} onChange={e => updateElement(idx, { time: e.target.value })} />
                          </div>
                        )}

                        {/* 内容区：按元素类型分支 */}
                        {el.type === 'image' ? (() => {
                          const rawEl = el._raw as any;
                          const rawUrl = rawEl?.resolved?.preview_url || rawEl?.url;
                          const thumbUrl = rawUrl ? resolveImagePreviewUrl(rawUrl) : null;
                          return (
                            <div className={styles.imageElementRow}>
                              <div className={styles.imageThumbPreview}>
                                {thumbUrl
                                  ? <img src={thumbUrl} alt={el.alt || ''} />
                                  : <div className={styles.imageThumbEmpty}><ImageIcon size={20} opacity={0.3} /></div>
                                }
                              </div>
                              <div className={styles.imageElementFields}>
                                <input className={styles.imageAltInput} placeholder="图片描述 / alt 文字"
                                  value={el.alt ?? ''} onChange={e => updateElement(idx, { alt: e.target.value })} />
                                <input className={styles.imageQueryInput} placeholder="AI 自动搜图关键词"
                                  value={el.query ?? ''} onChange={e => updateElement(idx, { query: e.target.value })} />
                                <button className={styles.openPickerBtn} onClick={() => {
                                  // 从元素的 _raw 读历史 fit，新元素默认 cover
                                  const rawEl = el._raw as any;
                                  const initFit: ObjectFitMode = rawEl?.fit ?? 'cover';
                                  setPickerFit(initFit);
                                  setSearchQuery(el.alt || el.query || '');
                                  setSelectedImageId(null);
                                  setSearchResults([]);
                                  setImageMode('search');
                                  allLoadedOnce.current = false;
                                  setPickerEl(el);
                                  setPickerOpen(true);
                                }}>
                                  <ImageIcon size={12} /> 选择图片
                                </button>
                              </div>
                            </div>
                          );
                        })() : el.type === 'table' ? (
                          /* ── 表格编辑器 ── */
                          <div className={styles.tableEditor}>
                            {/* Header 行 */}
                            <div className={styles.tableEditorHeaderRow}>
                              {(el.headers ?? []).map((h, ci) => (
                                <input
                                  key={ci}
                                  className={styles.tableEditorCell}
                                  value={h}
                                  placeholder={`列1${ci + 1}`}
                                  onChange={ev => {
                                    const newH = [...(el.headers ?? [])];
                                    newH[ci] = ev.target.value;
                                    updateElement(idx, { headers: newH });
                                  }}
                                />
                              ))}
                              {/* 增列按鈕，最多 6 列 */}
                              {(el.headers?.length ?? 0) < 6 && (
                                <button
                                  className={styles.tableAddColBtn}
                                  onClick={() => updateElement(idx, {
                                    headers: [...(el.headers ?? []), `列1${(el.headers?.length ?? 0) + 1}`],
                                    rows: (el.rows ?? []).map(row => [...row, '']),
                                  })}
                                  title="添加列"
                                >
                                  <Plus size={11} />
                                </button>
                              )}
                              {/* 删列按鈕 */}
                              {(el.headers?.length ?? 0) > 1 && (
                                <button
                                  className={styles.tableDelColBtn}
                                  onClick={() => {
                                    const len = (el.headers?.length ?? 1) - 1;
                                    updateElement(idx, {
                                      headers: (el.headers ?? []).slice(0, len),
                                      rows: (el.rows ?? []).map(row => row.slice(0, len)),
                                    });
                                  }}
                                  title="删除最后一列"
                                >
                                  <Trash2 size={11} />
                                </button>
                              )}
                            </div>

                            {/* 数据行 */}
                            {(el.rows ?? []).map((row, ri) => (
                              <div key={ri} className={styles.tableEditorRow}>
                                {row.map((cell, ci) => (
                                  <input
                                    key={ci}
                                    className={styles.tableEditorCell}
                                    value={cell}
                                    placeholder={`单元格(支持 $LaTeX$)`}
                                    onChange={ev => {
                                      const newRows = (el.rows ?? []).map((r, i) =>
                                        i === ri ? r.map((c, j) => j === ci ? ev.target.value : c) : r
                                      );
                                      updateElement(idx, { rows: newRows });
                                    }}
                                  />
                                ))}
                                <button
                                  className={styles.tableDelRowBtn}
                                  onClick={() => updateElement(idx, {
                                    rows: (el.rows ?? []).filter((_, i) => i !== ri),
                                  })}
                                  title="删除此行"
                                >
                                  <Trash2 size={11} />
                                </button>
                              </div>
                            ))}

                            {/* 增行按鈕 */}
                            <button
                              className={styles.tableAddRowBtn}
                              onClick={() => updateElement(idx, {
                                rows: [...(el.rows ?? []), new Array(el.headers?.length ?? 3).fill('')],
                              })}
                            >
                              <Plus size={11} /> 添加行
                            </button>
                          </div>
                        ) : useItemEditor ? (
                          <InlineListEditor
                            items={el.textLines.length ? el.textLines : ['']}
                            onChange={lines => updateElement(idx, { textLines: lines })}
                            placeholder={el.type === 'timeline_item' ? '事件说明...' : '输入要点内容...'}
                            addLabel={el.type === 'timeline_item' ? '添加说明行' : '添加要点'}
                          />
                        ) : (
                          <AutoResizeTextarea
                            className={styles.elementTextarea}
                            value={el.textLines.join('\n')}
                            placeholder={
                              el.type === 'huge_number' ? '输入数据（如 98%、3.5亿）'
                                : el.type === 'subtitle' ? '输入副标题...'
                                : '输入内容，支持 Markdown...'
                            }
                            onChange={v => updateElement(idx, { textLines: v.split('\n').filter(s => s.trim() !== '') })}
                          />
                        )}
                      </div>

                      <button className={styles.elementDeleteBtn} onClick={() => removeElement(idx)} title="删除此模块">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* 演讲注记 */}
            <section className={styles.section}>
              <button className={styles.collapseTrigger} onClick={() => setNotesOpen(v => !v)}>
                <StickyNote size={13} />
                <span>演讲注记</span>
                {notesOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              </button>
              {notesOpen && (
                <AutoResizeTextarea
                  className={styles.notesTextarea}
                  value={speakerNotes}
                  placeholder="输入演讲提示、备注..."
                  onChange={v => { setSpeakerNotes(v); markDirty(); }}
                />
              )}
            </section>

          </div>
        )}

        {/* ─── 图片选择器弹窗（二级） ───────────────────────────────────── */}
        {pickerOpen && pickerEl && (
          <ImagePickerModal
            el={pickerEl}
            currentFit={pickerFit}
            imageMode={imageMode}
            setImageMode={(m) => { setImageMode(m); }}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            searching={searching}
            onSearch={handleSearch}
            searchResults={searchResults}
            allImages={allImages}
            allLoading={allLoading}
            allTotal={allTotal}
            hasMore={hasMore}
            onLoadMore={() => loadAllImages(allPage + 1)}
            selectedImageId={selectedImageId}
            onSelect={setSelectedImageId}
            onChangeFit={(fit) => {
              setPickerFit(fit);
              // 同时通知父组件（用于导出时的 fit 持久化）
              onChangeFit(pickerEl.element_id, fit);
            }}
            onApply={() => handleApplyImage(pickerEl.element_id)}
            onClose={() => { setPickerOpen(false); setPickerEl(null); }}
          />
        )}

        {/* ══════════════════════════════════════════════════════
            Tab: 切换布局
            ══════════════════════════════════════════════════════ */}
        {activeTab === 'layout' && (
          <div className={styles.body}>
            <p className={styles.layoutHint}>
              选择一个布局模板，AI 将在保留现有内容的前提下重排版此页
            </p>
            <div className={styles.layoutGrid}>
              {LAYOUT_TEMPLATES.map(tpl => (
                <button key={tpl.id} className={styles.layoutCard} disabled={applyingLayout} onClick={() => handleApplyLayout(tpl.id)}>
                  <div className={styles.layoutCardIcon}>{tpl.icon}</div>
                  <div className={styles.layoutCardText}>
                    <span className={styles.layoutCardName}>{tpl.name}</span>
                    <span className={styles.layoutCardDesc}>{tpl.description}</span>
                  </div>
                </button>
              ))}
            </div>
            {applyingLayout && (
              <div className={styles.applyingRow}>
                <Loader2 size={14} className={styles.spin} /><span>正在应用布局...</span>
              </div>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════
            Tab: AI 指令
            ══════════════════════════════════════════════════════ */}
        {activeTab === 'ai' && (
          <div className={styles.body}>
            <section className={styles.section}>
              <label className={styles.sectionLabel}><Sparkles size={13} /> 针对此页的 AI 指令</label>
              <p className={styles.aiHint}>
                描述你对这一页的调整意图，AI 将智能修改内容、布局或样式。
              </p>
              <AutoResizeTextarea
                className={styles.aiTextarea}
                value={aiInstruction}
                placeholder="例：少一点文字，把第二点改成公式推导，加一张展示分子结构的图..."
                onChange={setAiInstruction}
              />
              <div className={styles.aiSuggestions}>
                {['精简文字，保留核心要点', '换成双栏布局，右边放图', '加一个数据强调元素', '将列表改为时间轴形式'].map(s => (
                  <button key={s} className={styles.suggestionChip} onClick={() => setAiInstruction(s)}>{s}</button>
                ))}
              </div>
              <button
                className={styles.aiIterateBtn}
                disabled={!aiInstruction.trim()}
                onClick={() => {
                  if (isDirty) onSave({ title, speaker_notes: speakerNotes, elements: elements.map(fromEditable) });
                  onIterate(aiInstruction.trim());
                  setAiInstruction('');
                  onClose();
                }}
              >
                <Sparkles size={14} /> 发送 AI 指令
              </button>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── 内联图片网格 ──────────────────────────────────────────── */
function ImageGrid({ images, loading, selectedId, onSelect, emptyIcon, emptyText, styles }: {
  images: ImageResult[]; loading: boolean; selectedId: string | null;
  onSelect: (id: string | null) => void; emptyIcon: React.ReactNode;
  emptyText: string; styles: Record<string, string>;
}) {
  if (loading) return <div className={styles.searchPending}><Loader2 size={28} className={styles.spin} /><span>加载中...</span></div>;
  if (images.length === 0) return <div className={styles.searchEmpty}>{emptyIcon}<span>{emptyText}</span></div>;
  return (
    <div className={styles.imageGrid}>
      {images.map(img => {
        const url = resolveImagePreviewUrl(img.preview_url);
        const isSelected = selectedId === img.image_id;
        return (
          <button key={img.image_id} className={clsx(styles.imageThumb, isSelected && styles.imageThumbSelected)}
            onClick={() => onSelect(isSelected ? null : img.image_id)}>
            <img src={url} alt={img.label || ''} />
            {isSelected && <div className={styles.imageCheck}><Check size={14} /></div>}
            {img.label && <div className={styles.imageLabel}>{img.label}</div>}
          </button>
        );
      })}
    </div>
  );
}

/* ─── 逐条列表编辑器 ────────────────────────────────────────── */
function InlineListEditor({ items, onChange, placeholder, addLabel }: {
  items: string[]; onChange: (items: string[]) => void; placeholder?: string; addLabel?: string;
}) {
  // 先声明，供 handleKeyDown 内的 RAF 回调使用
  const inlineStyles = styles;

  const updateItem = (idx: number, value: string) => { const next = [...items]; next[idx] = value; onChange(next); };
  const removeItem = (idx: number) => onChange(items.filter((_, i) => i !== idx));
  const addItem = () => onChange([...items, '']);
  const handleKeyDown = (idx: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const next = [...items]; next.splice(idx + 1, 0, ''); onChange(next);
      requestAnimationFrame(() => {
        const inputs = document.querySelectorAll<HTMLInputElement>(`.${inlineStyles.inlineItemInput}`);
        (inputs[idx + 1] as HTMLInputElement | undefined)?.focus();
      });
    }
    if (e.key === 'Backspace' && items[idx] === '' && items.length > 1) {
      e.preventDefault(); removeItem(idx);
      requestAnimationFrame(() => {
        const inputs = document.querySelectorAll<HTMLInputElement>(`.${inlineStyles.inlineItemInput}`);
        const target = inputs[Math.max(0, idx - 1)] as HTMLInputElement | undefined;
        target?.focus(); if (target) { const len = target.value.length; target.setSelectionRange(len, len); }
      });
    }
  };

  return (
    <div className={inlineStyles.inlineListEditor}>
      {items.map((item, idx) => (
        <div key={idx} className={inlineStyles.inlineItemRow}>
          <span className={inlineStyles.inlineItemDot} />
          <input className={inlineStyles.inlineItemInput} value={item}
            placeholder={placeholder ?? `条目 ${idx + 1}`}
            onChange={e => updateItem(idx, e.target.value)}
            onKeyDown={e => handleKeyDown(idx, e)} />
          <button className={inlineStyles.inlineItemDelete} onClick={() => removeItem(idx)} tabIndex={-1}><X size={11} /></button>
        </div>
      ))}
      <button className={inlineStyles.inlineItemAdd} onClick={addItem}><Plus size={11} /><span>{addLabel ?? '添加条目'}</span></button>
    </div>
  );
}

/* ─── 添加元素下拉 ──────────────────────────────────────────── */
function AddElementDropdown({ onAdd }: { onAdd: (type: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);
  return (
    <div className={styles.addDropdownWrap} ref={ref}>
      <button className={styles.addBtn} onClick={() => setOpen(v => !v)}>
        <Plus size={12} /> 添加元素 <ChevronRight size={11} className={clsx(styles.addChevron, open && styles.addChevronOpen)} />
      </button>
      {open && (
        <div className={styles.addDropdown}>
          {ELEMENT_TYPES.map(t => (
            <button key={t.type} className={styles.addDropdownItem} onClick={() => { onAdd(t.type); setOpen(false); }}>
              <span className={styles.addDropdownIcon}>{t.icon}</span>
              <div className={styles.addDropdownText}>
                <span className={styles.addDropdownLabel}>{t.label}</span>
                <span className={styles.addDropdownDesc}>{t.description}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── 自动高度 Textarea ─────────────────────────────────────── */
function AutoResizeTextarea({ value, onChange, placeholder, className }: {
  value: string; onChange: (v: string) => void; placeholder?: string; className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.style.height = 'auto';
    ref.current.style.height = `${ref.current.scrollHeight}px`;
  }, [value]);
  return <textarea ref={ref} className={className} value={value} placeholder={placeholder} rows={2} onChange={e => onChange(e.target.value)} />;
}

/* ─── 图片选择器弹窗（二级 Modal）────────────────────────── */
interface ImagePickerModalProps {
  el: EditableEl;
  currentFit: ObjectFitMode;
  imageMode: 'search' | 'all';
  setImageMode: (m: 'search' | 'all') => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  searching: boolean;
  onSearch: () => void;
  searchResults: ImageResult[];
  allImages: ImageResult[];
  allLoading: boolean;
  allTotal: number;
  hasMore: boolean;
  onLoadMore: () => void;
  selectedImageId: string | null;
  onSelect: (id: string | null) => void;
  onChangeFit: (fit: ObjectFitMode) => void;
  onApply: () => void;
  onClose: () => void;
}

function ImagePickerModal({
  el,
  currentFit,
  imageMode, setImageMode,
  searchQuery, setSearchQuery, searching, onSearch, searchResults,
  allImages, allLoading, allTotal, hasMore, onLoadMore,
  selectedImageId, onSelect,
  onChangeFit, onApply, onClose,
}: ImagePickerModalProps) {
  const displayedResults = imageMode === 'search' ? searchResults : allImages;

  return (
    <div className={styles.pickerOverlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={styles.pickerDialog}>

        {/* 弹窗头部：当前图 + 标题 */}
        {(() => {
          const rawEl = el._raw as any;
          const curUrl = rawEl?.resolved?.preview_url || rawEl?.url;
          const curThumb = curUrl ? resolveImagePreviewUrl(curUrl) : null;
          return (
            <div className={styles.pickerHeader}>
              <div className={styles.pickerCurrentImg}>
                {curThumb
                  ? <img src={curThumb} alt={el.alt || ''} />
                  : <div className={styles.pickerCurrentImgEmpty}><ImageIcon size={22} opacity={0.25} /></div>
                }
              </div>
              <div className={styles.pickerHeaderInfo}>
                <span className={styles.pickerHeaderTitle}>选择图片</span>
                <span className={styles.pickerHeaderSub}>{el.alt || el.query || '无描述'}</span>
              </div>
              <button className={styles.pickerCloseBtn} onClick={onClose}><X size={16} /></button>
            </div>
          );
        })()}

        <div className={styles.pickerBody}>
          {/* 显示方式 */}
          <div className={styles.fitRow}>
            <span className={styles.fitLabel}>显示方式</span>
            <div className={styles.fitOptions}>
              {FIT_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  className={clsx(styles.fitBtn, currentFit === opt.value && styles.fitBtnActive)}
                  onClick={() => onChangeFit(opt.value)}
                >
                  {opt.icon}<span>{opt.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 搜索 / 全部 切换 */}
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

          {/* 搜索输入 */}
          {imageMode === 'search' && (
            <div className={styles.searchRow}>
              <input
                className={styles.searchInput}
                placeholder="关键词，按回车搜索..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && onSearch()}
                autoFocus
              />
              <button className={styles.searchBtn} onClick={onSearch} disabled={searching || !searchQuery.trim()}>
                {searching ? <Loader2 size={14} className={styles.spin} /> : <Search size={14} />}
              </button>
            </div>
          )}

          {/* 图片网格 */}
          <div className={styles.pickerGrid}>
            <ImageGrid
              images={displayedResults}
              loading={(imageMode === 'search' && searching) || (imageMode === 'all' && allLoading && allImages.length === 0)}
              selectedId={selectedImageId}
              onSelect={onSelect}
              emptyIcon={imageMode === 'search' ? <Search size={28} opacity={0.2} /> : <ImageIcon size={28} opacity={0.2} />}
              emptyText={imageMode === 'search' ? '输入关键词后按回车搜索' : '图片库暂无内容'}
              styles={styles}
            />

            {/* 加载更多 */}
            {imageMode === 'all' && hasMore && (
              <button className={styles.loadMoreBtn} disabled={allLoading} onClick={onLoadMore}>
                {allLoading
                  ? <><Loader2 size={13} className={styles.spin} /> 加载中...</>
                  : <>加载更多 ({allImages.length}/{allTotal})</>}
              </button>
            )}
          </div>
        </div>

        {/* 弹窗底部 */}
        <div className={styles.pickerFooter}>
          <button className={styles.cancelBtn} onClick={onClose}>取消</button>
          <button className={styles.applyBtn} disabled={!selectedImageId} onClick={onApply}>
            <Check size={15} /> 应用选中图片
          </button>
        </div>
      </div>
    </div>
  );
}


