import { useState, useEffect, useRef } from 'react';
import {
  X, Pencil, Plus, Trash2, GripVertical, ChevronDown, ChevronUp,
  Check, Sparkles, StickyNote, Type, List, Image as ImageIcon,
  Hash, Clock, AlignLeft, ChevronRight,
} from 'lucide-react';
import { clsx } from 'clsx';
import styles from './PPTPageEditPanel.module.css';
import type { PPTPage, PPTElement } from '../hooks/useCourseware';

/* ─── 工具函数 ─────────────────────────────────────────────── */
const uid = () => Math.random().toString(36).slice(2, 9);

/** 将 content 统一转为字符串数组 */
function toArr(content: unknown): string[] {
  if (Array.isArray(content)) return content.map(String).filter(Boolean);
  if (content == null) return [];
  return [String(content)];
}

/** 将字符串数组合成可编辑文本（换行分隔） */
const arrToText = (arr: string[]) => arr.join('\n');
const textToArr = (text: string) => text.split('\n').filter(s => s.trim() !== '');

/* ─── 元素类型定义 ─────────────────────────────────────────── */
interface ElementTypeDef {
  type: string;
  label: string;
  icon: React.ReactNode;
  defaultContent: string[];
  defaultPosition: string;
  description: string;
  /** 是否为图片占位类型（特殊渲染） */
  isImage?: boolean;
  /** 是否支持 time 字段 */
  hasTime?: boolean;
  /** 是否支持 is_accent 字段 */
  hasAccent?: boolean;
}

const ELEMENT_TYPES: ElementTypeDef[] = [
  {
    type: 'text_block',
    label: '文本块',
    icon: <AlignLeft size={14} />,
    defaultContent: ['新增文本内容'],
    defaultPosition: 'full',
    description: '段落文字，支持 Markdown',
  },
  {
    type: 'list',
    label: '列表',
    icon: <List size={14} />,
    defaultContent: ['要点一', '要点二', '要点三'],
    defaultPosition: 'full',
    description: '多行要点列表，每行一条',
  },
  {
    type: 'subtitle',
    label: '副标题',
    icon: <Type size={14} />,
    defaultContent: ['副标题文字'],
    defaultPosition: 'center',
    description: '页面副标题或说明文字',
  },
  {
    type: 'huge_number',
    label: '数据强调',
    icon: <Hash size={14} />,
    defaultContent: ['98%'],
    defaultPosition: 'center',
    description: '凸显大数字或关键指标',
    hasAccent: true,
  },
  {
    type: 'timeline_item',
    label: '时间节点',
    icon: <Clock size={14} />,
    defaultContent: ['事件说明'],
    defaultPosition: 'left',
    description: '时间轴条目，需填写时间节点',
    hasTime: true,
  },
  {
    type: 'image',
    label: '图片占位',
    icon: <ImageIcon size={14} />,
    defaultContent: [],
    defaultPosition: 'right',
    description: '图片区域，可在预览区点击替换',
    isImage: true,
  },
];

const TYPE_MAP = Object.fromEntries(ELEMENT_TYPES.map(t => [t.type, t]));

/* ─── 类型 ─────────────────────────────────────────────────── */
interface Props {
  open: boolean;
  page: PPTPage;
  onClose: () => void;
  /** 本地立即更新 */
  onSave: (updatedPage: Partial<PPTPage>) => void;
  /** 发送 AI 指令重排此页 */
  onIterate: (instruction: string) => void;
}

/* ─── 可编辑元素行 ─────────────────────────────────────────── */
interface EditableEl {
  element_id: string;
  type: string;
  position: string;
  textLines: string[];   // 用户正在编辑的文本行
  time?: string;         // timeline_item
  is_accent?: boolean;
  alt?: string;          // image: 替代描述
  query?: string;        // image: 搜索关键词
  // 保留原始字段（图片/interactive 不被破坏）
  _raw: PPTElement;
}

function toEditable(el: PPTElement): EditableEl {
  return {
    element_id: el.element_id,
    type: el.type,
    position: el.position,
    textLines: toArr((el as any).content),
    time: (el as any).time,
    is_accent: (el as any).is_accent,
    alt: (el as any).alt,
    query: (el as any).query,
    _raw: el,
  };
}

function fromEditable(e: EditableEl): PPTElement {
  const base: any = {
    ...(e._raw),
    element_id: e.element_id,
    type: e.type,
    position: e.position,
    time: e.time,
    is_accent: e.is_accent,
  };
  if (e.type === 'image') {
    base.alt = e.alt;
    base.query = e.query || e.alt;
    // 图片不设 content
    delete base.content;
  } else {
    base.content = e.textLines.length > 0 ? e.textLines : undefined;
    delete base.alt;
    delete base.query;
  }
  return base as PPTElement;
}

const POSITIONS = ['full', 'center', 'left', 'right', 'top', 'bottom', 'left_top', 'left_bottom', 'right_top', 'right_bottom'];

/* ─── 添加元素 Dropdown ────────────────────────────────────── */
function AddElementDropdown({ onAdd }: { onAdd: (type: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
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
            <button
              key={t.type}
              className={styles.addDropdownItem}
              onClick={() => { onAdd(t.type); setOpen(false); }}
            >
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

/* ─── 主组件 ─────────────────────────────────────────────────  */
export default function PPTPageEditPanel({ open, page, onClose, onSave, onIterate }: Props) {
  const [title, setTitle] = useState(page.title ?? '');
  const [speakerNotes, setSpeakerNotes] = useState(page.speaker_notes ?? '');
  const [elements, setElements] = useState<EditableEl[]>([]);
  const [aiInstruction, setAiInstruction] = useState('');
  const [notesOpen, setNotesOpen] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  // drag-to-reorder state
  const dragIdx = useRef<number | null>(null);

  // 每次页面变化重置
  useEffect(() => {
    setTitle(page.title ?? '');
    setSpeakerNotes(page.speaker_notes ?? '');
    setElements(page.elements?.map(toEditable) ?? []);
    setIsDirty(false);
    setAiInstruction('');
  }, [page.page_index, open]);

  const markDirty = () => setIsDirty(true);

  /* 元素更新 */
  const updateElement = (idx: number, patch: Partial<EditableEl>) => {
    setElements(prev => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
    markDirty();
  };

  /* 添加新元素 */
  const addElement = (type: string) => {
    const def = TYPE_MAP[type] ?? ELEMENT_TYPES[0];
    const id = uid();
    setElements(prev => [
      ...prev,
      {
        element_id: id,
        type: def.type,
        position: def.defaultPosition,
        textLines: def.defaultContent,
        alt: def.isImage ? '请在预览区点击替换图片' : undefined,
        query: def.isImage ? '' : undefined,
        _raw: {
          element_id: id,
          type: def.type,
          position: def.defaultPosition,
          content: def.isImage ? undefined : def.defaultContent,
          alt: def.isImage ? '请在预览区点击替换图片' : undefined,
        } as any,
      },
    ]);
    markDirty();
  };

  const removeElement = (idx: number) => {
    setElements(prev => prev.filter((_, i) => i !== idx));
    markDirty();
  };

  /* 保存 */
  const handleSave = () => {
    onSave({
      title,
      speaker_notes: speakerNotes,
      elements: elements.map(fromEditable),
    });
    setIsDirty(false);
    onClose();
  };

  /* 拖拽排序 */
  const handleDragStart = (idx: number) => { dragIdx.current = idx; };
  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIdx.current === null || dragIdx.current === idx) return;
    setElements(prev => {
      const next = [...prev];
      const [moved] = next.splice(dragIdx.current!, 1);
      next.splice(idx, 0, moved);
      dragIdx.current = idx;
      return next;
    });
    markDirty();
  };
  const handleDragEnd = () => { dragIdx.current = null; };

  if (!open) return null;

  return (
    <div className={styles.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={styles.panel}>

        {/* ── Header ─────────────────────────────────────────── */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <Pencil size={14} />
            <span>手动编辑 · 第 {page.page_index} 页</span>
          </div>
          <div className={styles.headerRight}>
            {isDirty && (
              <span className={styles.dirtyBadge}>● 未保存</span>
            )}
            <button className={styles.closeBtn} onClick={onClose}>
              <X size={18} />
            </button>
          </div>
        </div>

        {/* ── 可滚动主体 ─────────────────────────────────────── */}
        <div className={styles.body}>

          {/* 标题 */}
          <section className={styles.section}>
            <label className={styles.sectionLabel}>
              <Type size={13} /> 页面标题
            </label>
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
                <List size={13} /> 内容模块 <span className={styles.elementCount}>{elements.length}</span>
              </label>
              <AddElementDropdown onAdd={addElement} />
            </div>

            {elements.length === 0 && (
              <div className={styles.emptyHint}>
                <Plus size={20} strokeWidth={1.5} className={styles.emptyHintIcon} />
                <p>此页暂无内容模块，点击右侧「添加元素」开始构建</p>
              </div>
            )}

            <div className={styles.elementList}>
              {elements.map((el, idx) => {
                const def = TYPE_MAP[el.type];
                const isImage = el.type === 'image';
                const isInteractive = ['interactive_game', 'animation', 'html5'].includes(el.type);

                if (isInteractive) {
                  return (
                    <div key={el.element_id} className={clsx(styles.elementRow, styles.elementReadonly)}>
                      <span className={styles.elementTypeBadge} style={{ color: '#94a3b8', borderColor: 'rgba(148,163,184,0.25)', background: 'rgba(148,163,184,0.07)' }}>{el.type}</span>
                      <span className={styles.elementReadonlyHint}>交互/动画元素，暂不支持文本编辑</span>
                    </div>
                  );
                }

                return (
                  <div
                    key={el.element_id}
                    className={styles.elementRow}
                    draggable
                    onDragStart={() => handleDragStart(idx)}
                    onDragOver={e => handleDragOver(e, idx)}
                    onDragEnd={handleDragEnd}
                  >
                    <div className={styles.elementDragHandle} title="拖拽排序">
                      <GripVertical size={14} />
                    </div>

                    <div className={styles.elementMain}>
                      {/* 类型 + 位置徽章 */}
                      <div className={styles.elementMeta}>
                        {/* 类型选择 */}
                        <select
                          className={styles.typeSelect}
                          value={el.type}
                          onChange={e => {
                            const newDef = TYPE_MAP[e.target.value];
                            updateElement(idx, {
                              type: e.target.value,
                              // 切换到图片时清空文字内容
                              textLines: newDef?.isImage ? [] : (el.textLines.length ? el.textLines : newDef?.defaultContent ?? []),
                              alt: newDef?.isImage ? (el.alt || '') : undefined,
                              query: newDef?.isImage ? (el.query || '') : undefined,
                              position: newDef?.defaultPosition ?? el.position,
                            });
                          }}
                        >
                          {ELEMENT_TYPES.map(t => (
                            <option key={t.type} value={t.type}>{t.label}</option>
                          ))}
                        </select>

                        {/* 位置选择 */}
                        <select
                          className={styles.positionSelect}
                          value={el.position}
                          onChange={e => updateElement(idx, { position: e.target.value })}
                        >
                          {POSITIONS.map(p => (
                            <option key={p} value={p}>{p}</option>
                          ))}
                        </select>

                        {/* is_accent 开关（数据强调） */}
                        {def?.hasAccent && (
                          <button
                            className={clsx(styles.accentToggle, el.is_accent && styles.accentToggleOn)}
                            onClick={() => updateElement(idx, { is_accent: !el.is_accent })}
                            title="设为强调色"
                          >
                            强调
                          </button>
                        )}
                      </div>

                      {/* timeline time 字段 */}
                      {el.type === 'timeline_item' && (
                        <input
                          className={styles.timeInput}
                          placeholder="时间节点（如 2024）"
                          value={el.time ?? ''}
                          onChange={e => updateElement(idx, { time: e.target.value })}
                        />
                      )}

                      {/* 图片元素：alt + query 编辑 */}
                      {isImage ? (
                        <div className={styles.imageEditArea}>
                          <div className={styles.imageEditIcon}>
                            <ImageIcon size={18} strokeWidth={1.5} />
                          </div>
                          <div className={styles.imageEditFields}>
                            <input
                              className={styles.imageAltInput}
                              placeholder="描述文字 / alt 属性"
                              value={el.alt ?? ''}
                              onChange={e => updateElement(idx, { alt: e.target.value })}
                            />
                            <input
                              className={styles.imageQueryInput}
                              placeholder="搜索关键词（AI 自动匹配图库）"
                              value={el.query ?? ''}
                              onChange={e => updateElement(idx, { query: e.target.value })}
                            />
                            <p className={styles.imageHint}>
                              图片文件请在预览卡片中点击图片区域进行替换
                            </p>
                          </div>
                        </div>
                      ) : (
                        /* 文本内容编辑区 */
                        <AutoResizeTextarea
                          className={styles.elementTextarea}
                          value={arrToText(el.textLines)}
                          placeholder={
                            el.type === 'list'
                              ? '每行一条要点，回车分隔...'
                              : el.type === 'huge_number'
                              ? '输入数据（如 98%、3.5亿）'
                              : el.type === 'timeline_item'
                              ? '输入事件描述...'
                              : '输入内容，支持 Markdown...'
                          }
                          onChange={v => updateElement(idx, { textLines: textToArr(v) })}
                        />
                      )}
                    </div>

                    <button
                      className={styles.elementDeleteBtn}
                      onClick={() => removeElement(idx)}
                      title="删除此模块"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                );
              })}
            </div>
          </section>

          {/* 演讲注记（折叠） */}
          <section className={styles.section}>
            <button
              className={styles.collapseTrigger}
              onClick={() => setNotesOpen(v => !v)}
            >
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

          {/* AI 精修 */}
          <section className={styles.section}>
            <label className={styles.sectionLabel}>
              <Sparkles size={13} /> AI 精修此页
            </label>
            <div className={styles.aiRow}>
              <AutoResizeTextarea
                className={styles.aiTextarea}
                value={aiInstruction}
                placeholder="可选：描述你对这页的调整意图，AI 将结合上方手动编辑结果再优化..."
                onChange={setAiInstruction}
              />
              <button
                className={styles.aiIterateBtn}
                disabled={!aiInstruction.trim()}
                onClick={() => {
                  // 先把手动内容保存，再发 AI 指令
                  onSave({ title, speaker_notes: speakerNotes, elements: elements.map(fromEditable) });
                  onIterate(aiInstruction.trim());
                  setAiInstruction('');
                  onClose();
                }}
              >
                <Sparkles size={14} /> AI 精修
              </button>
            </div>
          </section>
        </div>

        {/* ── Footer ─────────────────────────────────────────── */}
        <div className={styles.footer}>
          <button className={styles.cancelBtn} onClick={onClose}>
            取消
          </button>
          <button
            className={styles.saveBtn}
            onClick={handleSave}
            disabled={!isDirty}
          >
            <Check size={15} /> 保存修改
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── 自动高度 Textarea ────────────────────────────────────── */
function AutoResizeTextarea({
  value, onChange, placeholder, className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    ref.current.style.height = 'auto';
    ref.current.style.height = `${ref.current.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      className={className}
      value={value}
      placeholder={placeholder}
      rows={2}
      onChange={e => onChange(e.target.value)}
    />
  );
}
