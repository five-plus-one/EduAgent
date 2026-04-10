import { useState, useEffect, useRef } from 'react';
import {
  X, Pencil, Plus, Trash2, GripVertical, ChevronDown, ChevronUp,
  Check, Loader2, Sparkles, StickyNote, Type, List,
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
    _raw: el,
  };
}

function fromEditable(e: EditableEl): PPTElement {
  return {
    ...(e._raw),
    element_id: e.element_id,
    type: e.type,
    position: e.position,
    content: e.textLines.length > 0 ? e.textLines : undefined,
    time: e.time,
    is_accent: e.is_accent,
  } as PPTElement;
}

const EDITABLE_TYPES = ['text_block', 'list', 'list_item', 'title', 'subtitle', 'huge_number', 'stat', 'timeline_item'];

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

  const addTextBlock = () => {
    setElements(prev => [
      ...prev,
      {
        element_id: uid(),
        type: 'text_block',
        position: 'center',
        textLines: ['新增文本内容'],
        _raw: { element_id: uid(), type: 'text_block', position: 'center', content: ['新增文本内容'] } as any,
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
                <List size={13} /> 内容模块
              </label>
              <button className={styles.addBtn} onClick={addTextBlock}>
                <Plus size={12} /> 添加文本块
              </button>
            </div>

            {elements.length === 0 && (
              <p className={styles.emptyHint}>暂无可编辑的文本元素，点击右侧「添加文本块」</p>
            )}

            <div className={styles.elementList}>
              {elements.map((el, idx) => {
                const isEditable = EDITABLE_TYPES.includes(el.type);
                if (!isEditable) {
                  return (
                    <div key={el.element_id} className={clsx(styles.elementRow, styles.elementReadonly)}>
                      <span className={styles.elementTypeBadge}>{el.type}</span>
                      <span className={styles.elementReadonlyHint}>（图片/交互元素，在 PPT 预览区点击编辑）</span>
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
                        <span className={styles.elementTypeBadge}>{el.type}</span>
                        <select
                          className={styles.positionSelect}
                          value={el.position}
                          onChange={e => updateElement(idx, { position: e.target.value })}
                        >
                          {['center','left','right','top','bottom','right_top','right_bottom','full'].map(p => (
                            <option key={p} value={p}>{p}</option>
                          ))}
                        </select>
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

                      {/* 内容编辑区 */}
                      <AutoResizeTextarea
                        className={styles.elementTextarea}
                        value={arrToText(el.textLines)}
                        placeholder="输入内容，多行文本请换行分隔..."
                        onChange={v => updateElement(idx, { textLines: textToArr(v) })}
                      />
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
