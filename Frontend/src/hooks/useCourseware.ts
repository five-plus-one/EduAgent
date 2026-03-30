import { useState, useCallback, useEffect } from 'react';
import { iterateCoursewarePage, getCoursewarePreview } from '../utils/api';

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
  const [pages, setPages] = useState<PPTPage[]>([
    {
      page_index: 1,
      layout_type: "cover",
      title: "力学模型溯源",
      speaker: "王老师",
      speaker_notes: "在这个阶段讲一下摩擦力的前置推导...",
      elements: [
        {
          element_id: "txt_101",
          type: "text_block",
          position: "center",
          content: [
            "牛顿定律的边界情况",
            "在非惯性系中如何看待科里奥利力"
          ]
        }
      ]
    },
    {
      page_index: 2,
      layout_type: "two_column",
      title: "微观粒子的摩擦学表现",
      speaker_notes: "引导学生通过右侧双图对比玻璃板和木板的光滑度极差。",
      elements: [
        {
          element_id: "txt_201",
          type: "text_block",
          position: "left",
          content: [
            "接触面越粗糙，滚动阻力和附着力呈指数放大。",
            "下面这是我们在高倍显微镜下的晶体解理面结构抓拍图，大家可以看到巨大的间隙沟壑："
          ]
        },
        {
          element_id: "img_202",
          type: "image",
          position: "right_top",
          url: "https://images.unsplash.com/photo-1549488344-1f9b8d2bd1f3?auto=format&fit=crop&q=80&w=800&h=400",
          alt: "玻璃解理面微观示意图"
        },
        {
          "element_id": "img_203",
          type: "image",
          position: "right_bottom",
          url: "https://images.unsplash.com/photo-1596496338006-03bf475fc605?auto=format&fit=crop&q=80&w=800&h=400",
          alt: "木材切面微观示意图"
        }
      ]
    }
  ]);
  const [updatingPages, setUpdatingPages] = useState<Set<number>>(new Set());
  const [wordDoc, setWordDoc] = useState(`
# 第一节：牛顿第二定律

**教学目标**：深度掌握核心定律，并能够通过公式推导解决实际物理问题。
**教学重点**：理解 <mark>力(F)</mark>、质量(m)与加速度(a)之间的动态比例关系。

## 核心公式展示与推导

根据实验验证，当物体的质量一定时，其加速度与所受外力的合力成正比，方向与外力一致。这就是牛顿第二定律的精髓：

<center>
  <h1>F = ma</h1>
</center>

### 经典实验数据对比验证表

| 实验组别 | 施加外力 (N) | 物体质量 (kg) | 测量加速度 (m/s²) |
|:---:|:---:|:---:|:---:|
| 组 1 | 10 | 2 | 5.0 |
| 组 2 | 20 | 2 | 10.0 |
| 组 3 | 10 | 5 | 2.0 |

> 从上表可以非常直观地看出，在质量一定的情况下，力与加速度成**完全的正比关系**。

## 课堂物理演示配图

这里我们用真实的牛顿摆动装置进行模拟展示。你可以看到碰撞过程中的动量传递与受力情况：

![动态受力分析图](https://images.unsplash.com/photo-1549488344-1f9b8d2bd1f3?auto=format&fit=crop&q=80&w=800&h=400)

---
*注：本讲义由多模态AI教学智能体辅助生成并持续优化排版。*
`);

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
      console.warn('Failed to fetch real courseware preview, using fallback mocks.', e);
    }
  }, [sessionId]);

  useEffect(() => {
    fetchPreview();
  }, [fetchPreview]);

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

  return { pages, wordDoc, updatingPages, iteratePage, fetchPreview };
}
