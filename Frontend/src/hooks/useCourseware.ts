import { useState, useCallback } from 'react';

export interface PPTPage {
  page_index: number;
  type: string;
  title: string;
  speaker?: string;
  bullets?: string[];
  suggested_image_prompt?: string;
}

export function useCourseware(sessionId: string) {
  const [pages, setPages] = useState<PPTPage[]>([
    {
      page_index: 1,
      type: "cover",
      title: "牛顿第二定律探讨",
      speaker: "王老师"
    },
    {
      page_index: 2,
      type: "content",
      title: "核心公式推导",
      bullets: ["F = ma", "动量守恒的关联"],
      suggested_image_prompt: "物理实验室，牛顿摆..."
    }
  ]);
  const [updatingPages, setUpdatingPages] = useState<Set<number>>(new Set());
  const [wordDoc] = useState("教学目标：掌握核心定律...\n教学重点：理解力、质量与加速度的关系。\n\n教学过程：\n一、生活情境导入...\n二、公式推导...");

  const iteratePage = useCallback((pageIndex: number, instruction: string) => {
    setUpdatingPages(prev => new Set(prev).add(pageIndex));
    
    // Mock API 3.4
    setTimeout(() => {
      setPages(prev => prev.map(p => {
        if (p.page_index === pageIndex) {
            return {
              ...p,
              title: `${p.title} (已调整)`,
              bullets: p.bullets ? [...p.bullets, `🆕 ${instruction}`] : [`🆕 ${instruction}`]
            };
        }
        return p;
      }));
      setUpdatingPages(prev => {
        const next = new Set(prev);
        next.delete(pageIndex);
        return next;
      });
    }, 2500);
  }, [sessionId]);

  return { pages, wordDoc, updatingPages, iteratePage };
}
