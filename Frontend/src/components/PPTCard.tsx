import React, { useState } from 'react';
import { Send, Loader2, Image as ImageIcon, Pencil } from 'lucide-react';
import { clsx } from 'clsx';
import styles from './PPTCard.module.css';
import type { PPTPage } from '../hooks/useCourseware';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { resolveImagePreviewUrl, replaceSlideImage } from '../utils/api';
import PPTPageWorkbench, { type ImageElement, type ObjectFitMode, type WorkbenchTab } from './PPTPageWorkbench';

// ── Error isolation: one bad card must NOT crash siblings ─────────────────
class PPTCardErrorBoundary extends React.Component<
  { page: PPTPage; children: React.ReactNode },
  { hasError: boolean; error?: Error }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className={styles.errorFallback}>
          <span>⚠️ 第 {this.props.page.page_index} 页渲染异常</span>
          <small style={{ opacity: 0.5, fontSize: '11px' }}>{this.state.error?.message?.slice(0, 80)}</small>
        </div>
      );
    }
    return this.props.children;
  }
}
// ─────────────────────────────────────────────────────────────────────────

const REMARK_PLUGINS = [remarkGfm, remarkMath];
const REHYPE_PLUGINS = [[rehypeKatex, { throwOnError: false, strict: false }] as any];

/** Coerce any content value to a string array safe for ReactMarkdown */
function toStringArray(content: unknown): string[] {
  if (Array.isArray(content)) return content.map(c => (c == null ? '' : String(c))).filter(Boolean);
  if (content == null) return [];
  return [String(content)];
}

/**
 * Pre-process markdown text:
 * 1. Wrap bare \begin{cases}...\end{cases} (no dollar signs) in $$...$$
 * 2. Upgrade inline $...$ containing multi-line LaTeX environments to $$...$$
 * This allows KaTeX to render them in block mode with proper line breaks.
 */
function preprocessMath(text: string): string {
  // Step 1: Wrap bare \begin{cases}...\end{cases} with no surrounding $ in $$...$$
  let result = text.replace(
    /(?<!\$)\\begin\{(cases|aligned|align|array|pmatrix|bmatrix|vmatrix|matrix)\}[\s\S]*?\\end\{\1\}(?!\$)/g,
    (match) => `$$${match}$$`
  );

  // Step 2: Upgrade INLINE $...$ (not $$...$$) containing \begin{...} to $$...$$
  // Match single $ not preceded/followed by another $ 
  result = result.replace(/(?<!\$)\$(?!\$)([\s\S]+?)(?<!\$)\$(?!\$)/g, (full, inner) => {
    if (/\\begin\{(cases|aligned|align|array|pmatrix|bmatrix|vmatrix|matrix)\}/.test(inner)) {
      return `$$${inner}$$`;
    }
    return full;
  });

  return result;
}

/**
 * Two-pass merge for list items:
 *
 * Pass 1 – Tail-fragment stitch.
 *   The LLM sometimes splits a \begin{cases}...\end{cases} block across two
 *   consecutive list items, e.g.:
 *     ["...联立方程组：$$\begin{cases}", "x=x(t) \\ y=y(t)\\end{cases}$$"]
 *   Any item that contains \end{cases} (or \end{aligned}) but NOT the matching
 *   \begin is a stray tail — append it back to the preceding item so KaTeX gets
 *   a complete expression.
 *
 * Pass 2 – Standalone math merge.
 *   Items that are ONLY a complete math environment are merged into the preceding
 *   item to avoid a card that shows nothing but a bare equation.
 */
const ENV_OPEN_RE  = /\\begin\{(?:cases|aligned|align)\}/;
const ENV_CLOSE_RE = /\\end\{(?:cases|aligned|align)\}/;
const STANDALONE_MATH_RE = /^\s*(\$\$?)\s*\\begin\{(cases|aligned|align)\}[\s\S]*?\\end\{\2\}\s*\1\s*$|^\s*\\begin\{(cases|aligned|align)\}[\s\S]*?\\end\{\3\}\s*$/;

function mergeStandaloneMath(items: string[]): string[] {
  if (items.length <= 1) return items;

  // ── Pass 1: stitch tail fragments ────────────────────────────────────────
  const patched: string[] = [];
  for (const item of items) {
    const hasOpen  = ENV_OPEN_RE.test(item);
    const hasClose = ENV_CLOSE_RE.test(item);
    if (!hasOpen && hasClose && patched.length > 0) {
      // Tail fragment: belongs to the math block opened in the previous item.
      patched[patched.length - 1] += ' ' + item;
    } else {
      patched.push(item);
    }
  }

  // ── Pass 2: merge standalone complete equations ───────────────────────────
  const merged: string[] = [];
  for (const item of patched) {
    if (STANDALONE_MATH_RE.test(item) && merged.length > 0) {
      merged[merged.length - 1] = merged[merged.length - 1] + '\n' + item;
    } else {
      merged.push(item);
    }
  }
  return merged;
}

interface Props {
  page: PPTPage;
  sessionId: string;               // 用于调用后端 PATCH 接口持久化图片替换
  isUpdating: boolean;
  isStreaming?: boolean;
  onIterate: (instruction: string) => void;
  /** 手动编辑保存回调（不经过 AI） */
  onManualSave?: (pageIndex: number, updatedPage: Partial<PPTPage>) => void;
  /** 布局切换回调（不经过 AI） */
  onApplyLayout?: (layoutType: string) => Promise<boolean>;
}

function PPTCardInner({ page, sessionId, isUpdating, isStreaming = false, onIterate, onManualSave, onApplyLayout }: Props) {
  const [instruction, setInstruction] = useState('');

  // ── 统一工作台状态 ──────────────────────────────────────────
  const [workbenchOpen, setWorkbenchOpen] = useState(false);
  const [workbenchTab, setWorkbenchTab] = useState<WorkbenchTab>('edit');
  const [activeImageElement, setActiveImageElement] = useState<ImageElement | null>(null);
  // 局部覆盖图片 URL（换图后立即生效，无需等待 AI）
  const [imageOverrides, setImageOverrides] = useState<Record<string, { url: string; alt: string }>>({}); 
  // Each element can have its own fit mode
  const [fitModes, setFitModes] = useState<Record<string, ObjectFitMode>>({}); 

  const handleSubmit = () => {
    if (instruction.trim() && !isUpdating) {
      onIterate(instruction.trim());
      setInstruction('');
    }
  };

  // 点击图片 → 打开工作台 「编辑内容」Tab，图片选择器在元素行内自动展开
  const handleImageClick = (el: any) => {
    if (isUpdating || isStreaming) return;
    setActiveImageElement(el as ImageElement);
    setWorkbenchTab('edit');
    setWorkbenchOpen(true);
  };

  // 点击铅笔按钮 → 打开工作台 「编辑内容」Tab
  const handleEditPageClick = () => {
    setActiveImageElement(null);
    setWorkbenchTab('edit');
    setWorkbenchOpen(true);
  };

  const handleReplaceImage = (elementId: string, imageId: string, newUrl: string, newAlt: string) => {
    // 1. 乐观更新本地状态，预览立即生效
    setImageOverrides(prev => ({ ...prev, [elementId]: { url: newUrl, alt: newAlt } }));
    // 2. 调用后端 PATCH 接口将替换写入 DB（导出 PPT 时使用新图片）
    replaceSlideImage(sessionId, page.page_index, elementId, imageId).catch(err => {
      console.error('[PPTCard] replaceSlideImage failed:', err);
    });
  };

  const handleChangeFit = (elementId: string, fit: ObjectFitMode) => {
    setFitModes(prev => ({ ...prev, [elementId]: fit }));
  };

  const renderElement = (el: any) => {
    const positionClass = styles[`pos_${el.position}`] || '';
    const contentArray = toStringArray(el.content);

    if (el.type === 'image') {
      // 优先使用本地换图覆盖
      const override = imageOverrides[el.element_id];
      const resolved = el.resolved;
      const previewUrl = override
        ? override.url
        : resolved?.preview_url
        ? resolveImagePreviewUrl(resolved.preview_url)
        : el.url ?? null;

      const fitMode = fitModes[el.element_id] ?? 'cover';

      if (!previewUrl) {
        // 图片检索无匹配 → 可点击占位框
        return (
          <div
            key={el.element_id}
            className={clsx(styles.imagePlaceholder, positionClass, styles.imageClickable)}
            onClick={() => handleImageClick(el)}
            title="点击更换图片"
          >
            <div className={styles.placeholderIcon}><ImageIcon size={32} /></div>
            <span className={styles.placeholderText}>
              {el.alt || el.query || '图片检索无匹配'}
            </span>
            <span className={styles.imageEditHint}>点击更换图片</span>
          </div>
        );
      }

      return (
        <div
          key={el.element_id}
          className={clsx(styles.imageWrapper, positionClass, styles.imageClickable)}
          onClick={() => handleImageClick(el)}
          title="点击编辑图片"
        >
          <img
            src={previewUrl}
            alt={override?.alt || el.alt || 'PPT 图片'}
            className={styles.pptImage}
            style={{ objectFit: fitMode }}
          />
          {/* 悬停时显示编辑提示 */}
          <div className={styles.imageEditOverlay}>
            <ImageIcon size={18} />
            <span>点击编辑图片</span>
          </div>
          {/* 系统图库来源徽章 */}
          {resolved?.source === 'library' && !override && (
            <span className={styles.libraryBadge} title="来自系统教学图库">📚 图库</span>
          )}
        </div>
      );
    }

    if (el.type === 'interactive_game' || el.type === 'animation' || el.type === 'html5') {
      return (
        <div key={el.element_id} className={clsx(styles.interactiveWrapper, positionClass)} style={{ width: '100%', minHeight: '300px', border: '1px solid var(--border-color, #e2e8f0)', borderRadius: '8px', overflow: 'hidden', background: '#fff' }}>
          {el.url ? (
            <iframe src={el.url} title={el.alt || "Interactive Content"} width="100%" height="100%" style={{ minHeight: '300px', border: 'none' }} />
          ) : (
            <iframe srcDoc={el.content?.join('\n') || `<h1>Interactive Block Pending</h1>`} title={el.alt || "Interactive Content"} width="100%" height="100%" style={{ minHeight: '300px', border: 'none' }} />
          )}
        </div>
      );
    }

    if (el.type === 'title') {
      return <h2 key={el.element_id} className={clsx(styles.elementTitle, positionClass)}>{contentArray[0]}</h2>;
    }

    if (el.type === 'subtitle') {
      return <h4 key={el.element_id} className={clsx(styles.elementSubtitle, positionClass)}>{contentArray[0]}</h4>;
    }

    if (el.type === 'list' || el.type === 'list_item') {
      const mergedItems = mergeStandaloneMath(contentArray);
      return (
        <ul key={el.element_id} className={clsx(styles.contentList, positionClass)}>
          {mergedItems.map((b, i) => (
            <li key={i}>
              <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS}>{preprocessMath(b)}</ReactMarkdown>
            </li>
          ))}
        </ul>
      );
    }

    if (el.type === 'text_block') {
      if (contentArray.length > 1) {
        return (
          <ul key={el.element_id} className={clsx(styles.contentList, positionClass)}>
            {contentArray.map((item, idx) => (
              <li key={idx}>
                <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS}>{preprocessMath(item)}</ReactMarkdown>
              </li>
            ))}
          </ul>
        );
      }
      const singleText = contentArray[0] ?? '';
      return (
        <div key={el.element_id} className={clsx(styles.textBlock, positionClass)}>
          <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS}>{preprocessMath(singleText)}</ReactMarkdown>
        </div>
      );
    }

    // huge_number / stat: render anywhere, not just in stat_callout pages
    if (el.type === 'huge_number' || el.type === 'stat') {
      const numText = contentArray[0] ?? '';
      return (
        <div key={el.element_id} className={clsx(styles.hugeNumber, positionClass)}>
          <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS} components={{ p: React.Fragment as any }}>{numText}</ReactMarkdown>
        </div>
      );
    }

    // Timeline Item
    if (el.type === 'timeline_item') {
      const text = contentArray[0] ?? '';
      return (
        <div key={el.element_id} className={clsx(styles.textBlock, positionClass)} style={{ marginBottom: '8px' }}>
          <strong>{el.time}</strong>
          <div style={{ margin: '4px 0 0 0' }}>
            <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS}>{text}</ReactMarkdown>
          </div>
        </div>
      );
    }

    return null;
  };

  return (
    <>
      <div 
        className={clsx(styles.pptCard, isUpdating && styles.updating)}
      >
        {page.layout_type !== 'cover' && (
          <div className={styles.cardHeader}>
            <span className={styles.pageNumber}>{String(page.page_index).padStart(2, '0')}</span>
            <h4>{page.title}</h4>
            {/* 手动编辑按钮 → 统一工作台 */}
            {!isUpdating && !isStreaming && onManualSave && (
              <button
                className={styles.editPageBtn}
                onClick={handleEditPageClick}
                title="编辑此页（内容 / 图片 / 布局 / AI 指令）"
              >
                <Pencil size={13} />
              </button>
            )}
          </div>
        )}

        {/* ---------------- CANVAS DESIGN DECORATIONS ---------------- */}
        <div className={styles.giantWatermark}>
          {String(page.page_index).padStart(2, '0')}
        </div>
        
        {page.layout_type === 'two_column' && (
          <div className={styles.decorativeSvg}>
            <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
              <path fill="currentColor" d="M42.7,-73.4C55.9,-67.6,67.6,-57.8,77,-45.5C86.4,-33.1,93.5,-18.3,95.1,-2.9C96.7,12.5,92.8,28.4,84.1,41.9C75.4,55.3,61.9,66.1,47,73.1C32.1,80.1,16.1,83.1,-0.1,83.3C-16.2,83.5,-32.5,80.7,-46.8,73.2C-61.1,65.7,-73.5,53.4,-81.4,38.9C-89.2,24.4,-92.5,7.7,-89.2,-7.6C-85.9,-22.8,-76,-36.5,-63.9,-46C-51.8,-55.5,-37.6,-60.7,-24.5,-66.1C-11.4,-71.4,0.6,-76.8,14.4,-78.3C28.2,-79.8,43.9,-77.3,42.7,-73.4Z" transform="translate(100 100)" />
            </svg>
          </div>
        )}
        {/* ----------------------------------------------------------- */}
        
        {/* Universal Grid/Flex Stage powered by layout_type */}
        <div 
          className={clsx(styles.stage, styles[`layout_${page.layout_type}`] || styles.layout_standard)}
          style={{
            '--col-count':
              page.layout_type === 'two_column' || page.layout_type === 'minimal_list'
                ? (page.elements?.some((e: any) => e.position && String(e.position).includes('right')) ? 2 : 1)
                : Math.min(page.elements?.length || 2, 4)
          } as React.CSSProperties}
        >
          {/* Cover Archetype */}
          {page.layout_type === 'cover' && (
             <h1 className={styles.coverTitle}>{page.title}</h1>
          )}

          {/* Timeline Archetype */}
          {page.layout_type === 'timeline' ? (
            <>
               <div className={styles.timelineSpine} />
               {page.elements?.map((el: any, idx) => (
                 <div key={el.element_id || idx} className={styles.timelineItem}>
                   <div className={styles.timelineDot} />
                   <div className={styles.timelineTime}>{el.time || String(idx+1).padStart(2, '0')}</div>
                   <div className={styles.timelineContent}>
                      {renderElement({...el, type: 'text_block'})}
                   </div>
                 </div>
               ))}
            </>
          ) : page.layout_type === 'stat_callout' ? (
            <>
               {/* Stat Callout Archetype */}
               <div className={styles.hugeNumberContainer}>
                 {page.elements?.filter(e => e.is_accent || e.type === 'huge_number' || e.type === 'stat').map((el: any) => {
                    const text = toStringArray(el.content)[0] ?? '';
                    return (
                      <div key={el.element_id} className={styles.hugeNumber}>
                        <ReactMarkdown
                          remarkPlugins={REMARK_PLUGINS}
                          rehypePlugins={REHYPE_PLUGINS}
                          components={{ p: React.Fragment as any }}
                        >
                          {text}
                        </ReactMarkdown>
                      </div>
                    );
                 })}
               </div>
               <div className={styles.statSubtitle}>
                 {page.elements?.filter(e => !(e.is_accent || e.type === 'huge_number' || e.type === 'stat')).map(renderElement)}
               </div>
            </>
          ) : page.layout_type === 'two_column' || page.layout_type === 'minimal_list' ? (
            /* Proper Columnar Layout Mapping via Position */
            (() => {
              const hasRight = page.elements?.some((e: any) => e.position && String(e.position).includes('right'));
              return (
                <>
                  <div className={styles.columnLeft}>
                    {page.elements?.filter((e: any) => !e.position || String(e.position).includes('left') || e.position === 'center' || e.position === 'full' || (!String(e.position).includes('right'))).map(renderElement)}
                  </div>
                  {hasRight && (
                    <div className={styles.columnRight}>
                      {page.elements?.filter((e: any) => e.position && String(e.position).includes('right')).map(renderElement)}
                    </div>
                  )}
                </>
              );
            })()
          ) : (
            /* Default Fallback */
            page.elements?.map(renderElement)
          )}
          
          {page.speaker && page.layout_type === 'cover' && (
             <div className={styles.coverSpeaker}>
               <div className={styles.speakerLine} />
               <span>主讲人: {page.speaker}</span>
             </div>
          )}
        </div>

        {/* Loading Skeleton Overlay for Targeted Modification */}
        {isUpdating && (
          <div className={styles.skeletonOverlay}>
            <div className={styles.scanLine} />
            <Loader2 className={styles.spinner} size={32} />
            <span className={styles.updatingText}>AI 正在针对此页执行局部重塑...</span>
          </div>
        )}

        {/* Floating Action Input — hidden during streaming or per-page update */}
        {!isUpdating && !isStreaming && (
          <div className={clsx(styles.iterateBar, 'glass-panel')}>
            <input 
              type="text" 
              placeholder="例如：少一点文字，加一个公式推导动图..."
              className={styles.iterateInput}
              value={instruction}
              onChange={e => setInstruction(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            />
            <button 
              className={clsx('button-primary', styles.iterateBtn)} 
              disabled={!instruction.trim()}
              onClick={handleSubmit}
            >
              <Send size={14} />
            </button>
          </div>
        )}

        {/* AI 修改中 overlay ── 扫光动画 + 胶囊标签 */}
        {isUpdating && (
          <div className={styles.updatingOverlay}>
            <div className={styles.scanLine} />
            <div className={styles.updatingBadge}>
              <Loader2 size={14} className={styles.spinner} />
              <span>AI 修改中...</span>
            </div>
          </div>
        )}
      </div>

      {/* ── 统一页面工作台（合并了图片替换 + 内容编辑 + 布局 + AI 指令） */}
      {onManualSave && (
        <PPTPageWorkbench
          open={workbenchOpen}
          page={page}
          sessionId={sessionId}
          defaultTab={workbenchTab}
          activeImageElement={activeImageElement}
          currentFit={activeImageElement ? (fitModes[activeImageElement.element_id] ?? 'cover') : 'cover'}
          onClose={() => setWorkbenchOpen(false)}
          onSave={(updated) => onManualSave(page.page_index, updated)}
          onIterate={onIterate}
          onReplaceImage={handleReplaceImage}
          onChangeFit={handleChangeFit}
          onApplyLayout={onApplyLayout}
        />
      )}
    </>
  );
}

/** Exported PPTCard wraps the inner implementation with an error boundary
 *  so a render crash in one card doesn't take down the whole preview list. */
export default function PPTCard(props: Props) {
  return (
    <PPTCardErrorBoundary page={props.page}>
      <PPTCardInner {...props} />
    </PPTCardErrorBoundary>
  );
}
