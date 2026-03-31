import { useState, useCallback, useEffect, useRef } from 'react';
import { iterateCoursewarePage, getCoursewarePreview, generateCourseware, getGenerationStatus } from '../utils/api';

export interface PPTElement {
  element_id: string;
  type: "text_block" | "image" | string;
  position: "center" | "top" | "bottom" | "left" | "right" | "right_top" | "right_bottom" | string;
  content?: string[];
  url?: string;
  alt?: string;
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

  const [previewStatus, setPreviewStatus] = useState<'idle'|'loading'|'ready'|'error'>('idle');

  // Cancel token ref: cancels any in-flight poll when sessionId changes
  const pollCancelRef = useRef<{ cancelled: boolean }>({ cancelled: false });

  const fetchPreview = useCallback(async (withPolling = false) => {
    if (sessionId === 'new') return;
    try {
      const resp = await getCoursewarePreview(sessionId);
      if (resp) {
        const pptData = resp.ppt_data || resp.pages;
        const hasData = Array.isArray(pptData) && pptData.length > 0;

        if (!hasData && withPolling) {
          // Backend is still processing — keep polling every 3s (up to 120s)
          return; // caller handles the retry loop
        }

        if (Array.isArray(pptData)) setPages(pptData);
        if (resp.word_markdown) setWordDoc(resp.word_markdown);
        else if (resp.word_doc) setWordDoc(resp.word_doc);
        else if (resp.wordDoc) setWordDoc(resp.wordDoc);

        if (hasData) setPreviewStatus('ready');
      }
    } catch (e) {
      if (!withPolling) console.warn('Backend courseware not ready yet.', e);
      // During polling, 404s are expected — don't warn
    }
  }, [sessionId]);

  // Polling wrapper used after Tool completion — accepts cancel token for safe session switching
  const pollUntilReady = useCallback(async (cancelToken: { cancelled: boolean }) => {
    const MAX_WAIT_MS = 120_000; // 2 minutes max
    const POLL_INTERVAL = 3000;
    const start = Date.now();

    while (Date.now() - start < MAX_WAIT_MS) {
      if (cancelToken.cancelled) {
        console.log('[useCourseware] Poll aborted — session switched.');
        return;
      }
      try {
        const resp = await getCoursewarePreview(sessionId);
        const pptData = resp?.ppt_data || resp?.pages;
        if (Array.isArray(pptData) && pptData.length > 0) {
          if (cancelToken.cancelled) return; // double-check after async gap
          setPages(pptData);
          if (resp.word_markdown) setWordDoc(resp.word_markdown);
          else if (resp.word_doc) setWordDoc(resp.word_doc);
          setPreviewStatus('ready');
          setIsGenerating(false);
          return;
        }
      } catch {
        // 404 = backend still processing, continue waiting
      }
      await new Promise(r => setTimeout(r, POLL_INTERVAL));
    }

    if (!cancelToken.cancelled) {
      // Timeout — tell user
      setPreviewStatus('error');
      setIsGenerating(false);
    }
  }, [sessionId]);

  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    // Cancel any in-flight poll from prior session
    pollCancelRef.current.cancelled = true;
    pollCancelRef.current = { cancelled: false };

    // Clear old state before fetching new
    setPages([]);
    setWordDoc('');
    setUpdatingPages(new Set());
    setPreviewStatus('idle');
    setIsGenerating(false);
    
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
        // Cancel any previous poll, start a fresh one with a new cancel token
        pollCancelRef.current.cancelled = true;
        const newToken = { cancelled: false };
        pollCancelRef.current = newToken;
        setPreviewStatus('loading');
        pollUntilReady(newToken);
      }
    };

    window.addEventListener('EduAgent_Generate_Start', handleStart);
    window.addEventListener('EduAgent_Generate_End', handleEnd);
    window.addEventListener('EduAgent_Refetch_PPT', handleRefetch);
    
    return () => {
      pollCancelRef.current.cancelled = true; // abort poll on cleanup
      window.removeEventListener('EduAgent_Generate_Start', handleStart);
      window.removeEventListener('EduAgent_Generate_End', handleEnd);
      window.removeEventListener('EduAgent_Refetch_PPT', handleRefetch);
    };
  }, [sessionId, fetchPreview]);


  const handleGenerate = useCallback(async (selectedFiles: string[] = [], mode: 'fast'|'depth' = 'fast') => {
    if (sessionId === 'new' || isGenerating) return;
    setIsGenerating(true);
    try {
      // 1. 发起后端异步生成任务
      const triggerRes = await generateCourseware(sessionId, selectedFiles, mode);
      const taskId = triggerRes.task_id;
      
      if (!taskId) throw new Error("No task_id returned from generation endpoint");

      // 2. 轮询状态直到生成完成
      while (true) {
        await new Promise(r => setTimeout(r, 2000)); // 2s 心跳
        const statusData = await getGenerationStatus(taskId);
        
        if (statusData.status === 'completed') {
          break;
        } else if (statusData.status === 'failed' || statusData.status === 'error') {
          throw new Error(statusData.error || 'Generation task failed on server');
        }
      }

      // 3. 生成完成后，重新抓取最新的 PPT 预览
      await fetchPreview();
      alert('AI 课件生成成功，请在右侧查阅。');
    } catch (e) {
      console.error('Failed to generate courseware', e);
      alert(`生成失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsGenerating(false);
    }
  }, [sessionId, isGenerating, fetchPreview]);

  const iteratePage = useCallback(async (pageIndex: number, instruction: string) => {
    setUpdatingPages(prev => new Set(prev).add(pageIndex));

    try {
      const updatedPage = await iterateCoursewarePage(sessionId, 'ppt', pageIndex, instruction);
      if (updatedPage) {
        setPages(prev => prev.map(p => p.page_index === pageIndex ? { ...p, ...updatedPage } : p));
      }
    } catch {
      // Silently revert on fail
      console.error('Failed to iterate page', pageIndex);
    } finally {
      setUpdatingPages(prev => {
        const next = new Set(prev);
        next.delete(pageIndex);
        return next;
      });
    }
  }, [sessionId]);

  return { pages, wordDoc, updatingPages, iteratePage, fetchPreview, isGenerating, handleGenerate, previewStatus };
}
