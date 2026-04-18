import { useState, useCallback, useEffect, useRef } from 'react';

import { iterateCoursewarePage, getCoursewarePreview, generateCourseware, saveManualSlideEdit, applySlideLayout, saveWordContent } from '../utils/api';
import { safeApplyTheme, GlobalPPTStreamManager } from '../utils/pptStreamManager';

export interface PPTElement {
  element_id: string;
  type: "text_block" | "image" | "timeline_item" | "huge_number" | "stat" | "table" | string;
  position: "center" | "top" | "bottom" | "left" | "right" | "right_top" | "right_bottom" | "full" | string;
  content?: string[];
  url?: string;
  alt?: string;
  query?: string;
  is_accent?: boolean;
  time?: string;
  resolved?: { image_id?: string; preview_url?: string; source?: string };
  /** 表格元素专属字段 */
  headers?: string[];
  rows?: string[][];
}

export interface PPTPage {
  page_index: number;
  layout_type: "cover" | "standard" | "two_column" | "image_gallery" | string;
  title: string;
  speaker?: string;
  speaker_notes?: string;
  elements: PPTElement[];
}

export function useCourseware(sessionId: string) {
  const [pages, setPages] = useState<PPTPage[]>([]);
  const [updatingPages, setUpdatingPages] = useState<Set<number>>(new Set());
  const [wordDoc, setWordDoc] = useState('');

  // Guard against race condition: iteratePage result being overwritten by a
  // concurrent fetchPreview triggered by EduAgent_Slide_Updated.
  const isIteratingRef = useRef(false);

  const [previewStatus, setPreviewStatus] = useState<'idle'|'loading'|'ready'|'error'>('idle');

  const fetchPreview = useCallback(async (withPolling = false) => {
    if (sessionId === 'new') return;
    setPreviewStatus(prev => (prev === 'ready' ? prev : 'loading'));
    try {
      let resp = await getCoursewarePreview(sessionId);
      if (resp) {
        let pptData = resp.ppt_data || resp.pages;
        let hasData = Array.isArray(pptData) && pptData.length > 0;

        if (!hasData && withPolling) {
          // Backend is still processing — keep polling every 3s (up to 120s)
          for (let attempt = 0; attempt < 7 && !hasData; attempt += 1) {
            await new Promise(r => setTimeout(r, 1200));
            resp = await getCoursewarePreview(sessionId);
            pptData = resp?.ppt_data || resp?.pages;
            hasData = Array.isArray(pptData) && pptData.length > 0;
          }
        }
        
        // --- DEFENSIVE DATA RECOVERY FROM LOCAL STORAGE ---
        // Recover the PPT visually if backend silently returns empty arrays due to schema failures
        if (!hasData) {
          try {
            const fallbackDataStr = localStorage.getItem(`eduagent_ppt_fallback_${sessionId}`);
            if (fallbackDataStr) {
              const fallbackData = JSON.parse(fallbackDataStr);
              if (fallbackData && fallbackData.pages && fallbackData.pages.length > 0) {
                setPages(fallbackData.pages);
                if (fallbackData.wordDoc) setWordDoc(fallbackData.wordDoc);
                
                if (fallbackData.theme) {
                  safeApplyTheme(sessionId, fallbackData.theme);
                }
                
                setPreviewStatus('ready');
                console.warn("PPT 预览被后端吞掉 (空数据返回)，前端已从 LocalStorage 沙盒中强行抢救出真实数据 🎯");
                return;
              }
            }
          } catch (e) {}
        }
        // ----------------------------------------------------

        // --- EXTRACT & RESTORE THEME ---
        // Backend now might return the theme directly, we must prioritize resp.theme!
        if (resp.theme) {
          safeApplyTheme(sessionId, resp.theme);
        } else {
          // Fallback legacy behavior if backend validation strips the theme schema
          try {
            const fallbackDataStr = localStorage.getItem(`eduagent_ppt_fallback_${sessionId}`);
            if (fallbackDataStr) {
              const fallbackData = JSON.parse(fallbackDataStr);
              if (fallbackData.theme) {
                safeApplyTheme(sessionId, fallbackData.theme);
              }
            }
          } catch (e) {}
        }

        if (Array.isArray(pptData)) {
          // Robustness: Deduplicate pages by page_index keeping the last one (in case backend aggregates)
          const uniquePagesMap = new Map();
          pptData.forEach(p => uniquePagesMap.set(p.page_index, p));
          let uniquePages = Array.from(uniquePagesMap.values());

          // ⚠️ 保险合并：防止后端 Pydantic schema 将表格的 headers/rows 静默丢弃
          // 如果新数据里某 table element 的 headers/rows 为空，且当前 state 里有值，则保留
          // ⚠ Skip update if a manual iteratePage is in-flight (avoid stale-overwrite race)
          if (!isIteratingRef.current) {
            setPages(prevPages => {
              const prevPageMap = new Map(prevPages.map(p => [p.page_index, p]));
              return uniquePages.map(newPage => {
                const prevPage = prevPageMap.get(newPage.page_index);
                if (!prevPage || !Array.isArray(newPage.elements)) return newPage;
                return {
                  ...newPage,
                  elements: newPage.elements.map((newEl: any) => {
                    if (newEl.type !== 'table') return newEl;
                    const prevEl = prevPage.elements?.find((e: any) => e.element_id === newEl.element_id);
                    if (!prevEl) return newEl;
                    // 若后端返回 headers/rows 为空但本地有值，则保留本地数据
                    return {
                      ...newEl,
                      headers: (Array.isArray(newEl.headers) && newEl.headers.length > 0)
                        ? newEl.headers
                        : (Array.isArray((prevEl as any).headers) ? (prevEl as any).headers : newEl.headers),
                      rows: (Array.isArray(newEl.rows) && newEl.rows.length > 0)
                        ? newEl.rows
                        : (Array.isArray((prevEl as any).rows) ? (prevEl as any).rows : newEl.rows),
                    };
                  }),
                };
              });
            });
          }
        }
        if (resp.word_markdown) setWordDoc(resp.word_markdown);
        else if (resp.word_doc) setWordDoc(resp.word_doc);
        else if (resp.wordDoc) setWordDoc(resp.wordDoc);

        if (hasData) setPreviewStatus('ready');
      } else {
        setPreviewStatus('idle');
      }
    } catch (e: any) {
      if (!withPolling) {
        console.error('Backend courseware fetch failed. Likely a 500 ValidationError due to strict typing schemas in backend.', e);
        
        // --- DEFENSIVE DATA RECOVERY FROM LOCAL STORAGE ---
        // Recover the PPT visually if backend strict schema validation forcibly drops it
        try {
          const fallbackDataStr = localStorage.getItem(`eduagent_ppt_fallback_${sessionId}`);
          if (fallbackDataStr) {
            const fallbackData = JSON.parse(fallbackDataStr);
            if (fallbackData && fallbackData.pages && fallbackData.pages.length > 0) {
              setPages(fallbackData.pages);
              if (fallbackData.wordDoc) setWordDoc(fallbackData.wordDoc);
              
              // Restore CSS theme variables that were lost due to session switch
              if (fallbackData.theme) {
                safeApplyTheme(sessionId, fallbackData.theme);
              }
              
              setPreviewStatus('ready');
              console.warn("PPT 预览受到后端强校验拦截 (500 Error)，前端已从 LocalStorage 沙盒中强行抢救出数据并完成视图重建 🎯");
              return;
            }
          }
        } catch (recoverErr) {
          console.error("Local fallback recovery failed", recoverErr);
        }
        
        setPreviewStatus('error');
      }
      // During polling, 404s are expected — don't warn
    }
  }, [sessionId]);

  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    // Clear old state before fetching new session
    setPages([]);
    setWordDoc('');
    setUpdatingPages(new Set());
    setPreviewStatus('idle');
    setIsGenerating(false);
    
    // Clear the CSS theme variables globally so a previous session's dark theme
    // doesn't bleed into the current session if it lacks a theme (falling back to white).
    GlobalPPTStreamManager.clearTheme();
    
    fetchPreview();
  }, [sessionId, fetchPreview]);


  // Listen for Agent-driven slide modifications & Tool lifecycles
  useEffect(() => {
    const handleStart = (e: Event) => {
      const ev = e as CustomEvent;
      if (ev.detail?.sessionId === sessionId) setIsGenerating(true);
    };
    const handleEnd = (e: Event) => {
      const ev = e as CustomEvent;
      if (ev.detail?.sessionId === sessionId) setIsGenerating(false);
    };
    const handleRefetch = (e: Event) => {
      const ev = e as CustomEvent;
      if (ev.detail?.sessionId === sessionId) {
        // Backend commits every page to DB before yielding the SSE event,
        // but there might be a slight delay. Polling/timeout gives it time.
        setTimeout(() => fetchPreview(true), 1500);
      }
    };

    const handleSlideUpdated = (e: Event) => {
      const ev = e as CustomEvent;
      if (ev.detail?.sessionId !== sessionId) return;
      
      const actualPageIndex = ev.detail?.actualPageIndex;
      if (typeof actualPageIndex === 'number') {
        setPages(prev => {
          if (!prev.some(p => p.page_index === actualPageIndex)) {
            // Optimistic skeleton block for AddSlide scenario
            return [...prev, {
              page_index: actualPageIndex,
              layout_type: 'cover',
              title: '✨ 正在排版新页面...',
              elements: []
            }];
          }
          return prev;
        });
        setUpdatingPages(prev => new Set(prev).add(actualPageIndex));
      }

      // [SILENT REFRESH] Fetch preview without setting isGenerating=true
      // This allows the UI to stay responsive during incremental tool updates.
      // 延迟 1.5s 给后端落库的时间窗口，避免读取到旧数据
      setTimeout(() => {
        fetchPreview(true).finally(() => {
          if (typeof actualPageIndex === 'number') {
            setUpdatingPages(prev => {
              const next = new Set(prev);
              next.delete(actualPageIndex);
              return next;
            });
          }
        });
      }, 1500);
    };

    window.addEventListener('EduAgent_Generate_Start', handleStart);
    window.addEventListener('EduAgent_Generate_End', handleEnd);
    window.addEventListener('EduAgent_Refetch_PPT', handleRefetch);
    window.addEventListener('EduAgent_Slide_Updated', handleSlideUpdated);
    
    return () => {
      window.removeEventListener('EduAgent_Generate_Start', handleStart);
      window.removeEventListener('EduAgent_Generate_End', handleEnd);
      window.removeEventListener('EduAgent_Refetch_PPT', handleRefetch);
      window.removeEventListener('EduAgent_Slide_Updated', handleSlideUpdated);
    };
  }, [sessionId, fetchPreview]);



  const handleGenerate = useCallback(async (selectedFiles: string[] = [], mode: 'fast'|'depth' = 'fast') => {
    if (sessionId === 'new' || isGenerating) return;
    
    // NOTE: This legacy handleGenerate is now a FASTER fallback.
    // Full generation normally goes through usePPTStream.ts.
    // This button will still work but without the step-by-step streaming UI.
    setIsGenerating(true);
    try {
      await generateCourseware(sessionId, selectedFiles, mode);
      // Wait a bit for the first page to be written
      await new Promise(r => setTimeout(r, 2000));
      await fetchPreview();
    } catch (e) {
      console.error('Failed to generate courseware', e);
    } finally {
      setIsGenerating(false);
    }
  }, [sessionId, isGenerating, fetchPreview]);

  const iteratePage = useCallback(async (pageIndex: number, instruction: string) => {
    // Lock: prevent any concurrent fetchPreview from overwriting our result
    isIteratingRef.current = true;
    setUpdatingPages(prev => new Set(prev).add(pageIndex));

    try {
      const result = await iterateCoursewarePage(sessionId, 'ppt', pageIndex, instruction);
      if (result) {
        // New API returns {updated_pages, page} — support both single page and page splits
        if (result.updated_pages && Array.isArray(result.updated_pages)) {
          // Full slide list was updated (supports page splits with re-indexing)
          setPages(result.updated_pages);
        } else {
          // Backward compat: old API returned the page object directly
          const updatedPage = result.page ?? result;
          setPages(prev => prev.map(p => p.page_index === pageIndex ? { ...p, ...updatedPage } : p));
        }
      }
    } catch (e: any) {
      console.error('Failed to iterate page', pageIndex, e);
      // Surface error to user — do NOT silently swallow
      const msg = e?.response?.data?.detail || e?.message || '修改失败，请重试';
      alert(`第 ${pageIndex} 页修改失败：${msg}`);
    } finally {
      // Unlock BEFORE removing from updatingPages so any queued fetchPreview runs after state is stable
      isIteratingRef.current = false;
      setUpdatingPages(prev => {
        const next = new Set(prev);
        next.delete(pageIndex);
        return next;
      });
    }
  }, [sessionId]);

  const clearPages = useCallback(() => {
    setPages([]);
    setWordDoc('');
    setPreviewStatus('idle');
  }, []);

  /**
   * 手动编辑后本地+远端同步（PPTPageEditPanel 保存时调用）
   * 1. 立即更新本地 pages 状态（乐观更新，刷新预览）
   * 2. 异步调用 PUT .../slides/{page} 持久化到 DB（导出时数据正确）
   */
  const updatePageLocally = useCallback((pageIndex: number, updatedPage: Partial<PPTPage>) => {
    // 1. 乐观本地更新
    setPages(prev => prev.map(p =>
      p.page_index === pageIndex ? { ...p, ...updatedPage } : p
    ));
    // 2. 跳过 sessionId === 'new' 防御
    if (sessionId === 'new') return;
    // 3. 异步持久化，失败只记日志（不回滚，用户可再存一次）
    saveManualSlideEdit(sessionId, pageIndex, {
      title: updatedPage.title,
      elements: updatedPage.elements as unknown[] | undefined,
      speaker_notes: updatedPage.speaker_notes,
    }).then(res => {
      // 用后端返回的 slide 再做一次精确覆盖（防止本地与 DB 产生 diff）
      const authoritative = (res as any)?.slide;
      if (authoritative) {
        setPages(prev => prev.map(p =>
          p.page_index === pageIndex ? { ...p, ...authoritative } : p
        ));
      }
    }).catch(err => {
      console.error('[useCourseware] saveManualSlideEdit failed:', err);
    });
  }, [sessionId]);

  /**
   * 切换单页布局（PPTImageEditDrawer 「切换模板」Tab 调用）
   * 不经过 AI，确定性可靠。
   * 1. 调用 POST .../apply-layout 写 DB
   * 2. 用响应的 slide 直接替换本地状态，无需重拉 preview
   */
  const applyLayoutAndRefresh = useCallback(async (
    pageIndex: number,
    layoutType: string
  ): Promise<boolean> => {
    if (sessionId === 'new') return false;
    setUpdatingPages(prev => new Set(prev).add(pageIndex));
    try {
      const res = await applySlideLayout(sessionId, pageIndex, layoutType);
      const slide = (res as any)?.slide;
      if (slide) {
        setPages(prev => prev.map(p =>
          p.page_index === pageIndex ? { ...p, ...slide } : p
        ));
      }
      return true;
    } catch (err) {
      console.error('[useCourseware] applySlideLayout failed:', err);
      return false;
    } finally {
      setUpdatingPages(prev => {
        const next = new Set(prev);
        next.delete(pageIndex);
        return next;
      });
    }
  }, [sessionId]);

  /** 直接修改讲义文本（手动编辑专用） */
  const setWordDocLocally = useCallback((content: string) => {
    setWordDoc(content);
  }, []);

  /**
   * 持久化保存讲义内容到后端，同时更新本地状态
   * 使用后端返回的规范化内容（--- 已替换为 ***）
   * 即使后端失败也保留本地状态，避免用户内容丢失
   */
  const saveWordDoc = useCallback(async (content: string): Promise<void> => {
    if (sessionId === 'new') return;
    try {
      const res = await saveWordContent(sessionId, content);
      setWordDoc(res.word_markdown ?? content);
    } catch (err) {
      console.error('[useCourseware] saveWordDoc failed:', err);
      setWordDoc(content);
    }
  }, [sessionId]);

  /**
   * P1：PATCH /elements/{id}/image 成功后同步更新 pages 里的 resolved 字段
   * 确保下次打开 workbench 时 toEditable(el) 拿到的 _raw.resolved 是最新值
   * 从而避免 save_manual_slide_edit 发送陈旧 image_id 覆盖新图片
   */
  const resolveImageInPage = useCallback(
    (pageIndex: number, elementId: string, imageId: string, previewUrl: string) => {
      setPages(prev =>
        prev.map(p => {
          if (p.page_index !== pageIndex) return p;
          return {
            ...p,
            elements: p.elements?.map(el =>
              el.element_id === elementId
                ? {
                    ...el,
                    resolved: {
                      image_id: imageId,
                      preview_url: previewUrl,
                      source: 'user' as const,
                    },
                  }
                : el
            ),
          };
        })
      );
    },
    []
  );

  return { pages, wordDoc, updatingPages, iteratePage, fetchPreview, isGenerating, handleGenerate, previewStatus, clearPages, updatePageLocally, applyLayoutAndRefresh, setWordDocLocally, saveWordDoc, resolveImageInPage };
}
