import { useState, useCallback } from 'react';

export interface PPTPage {
  page_index: number;
  type: string;
  title: string;
  speaker?: string;
  bullets?: string[];
  suggested_image_prompt?: string;
  image_url?: string;
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
      suggested_image_prompt: "物理实验室，牛顿摆...",
      // Using a beautiful placeholder
      image_url: "https://images.unsplash.com/photo-1549488344-1f9b8d2bd1f3?auto=format&fit=crop&q=80&w=800&h=400"
    }
  ]);
  const [updatingPages, setUpdatingPages] = useState<Set<number>>(new Set());
  const [wordDoc] = useState(`
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
