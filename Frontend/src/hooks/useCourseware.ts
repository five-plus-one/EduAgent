import { useState, useCallback, useEffect } from 'react';
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

  const fetchPreview = useCallback(async () => {
    if (sessionId === 'new') return;
    try {
      const resp = await getCoursewarePreview(sessionId);
      if (resp) {
        if (resp.pages && Array.isArray(resp.pages)) setPages(resp.pages);
        if (resp.word_doc) setWordDoc(resp.word_doc);
        else if (resp.wordDoc) setWordDoc(resp.wordDoc);
      }
    } catch (e) {
      console.warn('Backend courseware not ready yet.', e);
    }
  }, [sessionId]);

  useEffect(() => {
    // Clear old state before fetching new
    setPages([]);
    setWordDoc('');
    setUpdatingPages(new Set());
    
    fetchPreview();
  }, [sessionId, fetchPreview]);

  const [isGenerating, setIsGenerating] = useState(false);

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

  return { pages, wordDoc, updatingPages, iteratePage, fetchPreview, isGenerating, handleGenerate };
}
