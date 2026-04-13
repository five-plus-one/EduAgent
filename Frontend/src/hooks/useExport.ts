import { useState, useCallback } from 'react';
import { triggerExport, getExportStatus, downloadExportedFile } from '../utils/api';

/**
 * useExport — 封装 PPT 异步导出流程
 *
 * 1. 调用 triggerExport(sessionId, themeKey?) 触发后台任务
 * 2. 每 2s 轮询 getExportStatus(task_id)
 *    ✅ completed → 解析 result.download_urls.ppt_url 或 result.filename
 *    ❌ failed    → 抛出 result.error
 * 3. 拿到文件名后通过 downloadExportedFile 触发 Blob 下载
 */
export function useExport(sessionId: string) {
  const [isExporting, setIsExporting] = useState(false);

  const exportCourseware = useCallback(async (themeKey?: string) => {
    if (isExporting || !sessionId || sessionId === 'new') return;
    setIsExporting(true);
    try {
      // 1. 触发导出（可选主题）
      const triggerRes = await triggerExport(sessionId, themeKey);
      const taskId: string = triggerRes.task_id;

      if (!taskId) throw new Error('服务端未返回 task_id，请稍后重试');

      // 2. 轮询任务进度
      let downloadTarget = '';
      while (true) {
        await new Promise<void>(resolve => setTimeout(resolve, 2000));
        const statusData = await getExportStatus(taskId);

        if (statusData.status === 'completed') {
          // 优先取 result.download_urls.ppt_url（完整相对路径），降级到 filename
          const pptUrl: string | undefined = statusData.result?.download_urls?.ppt_url;
          const filename: string | undefined = statusData.result?.filename;
          downloadTarget = pptUrl ?? filename ?? '';
          break;
        }

        if (statusData.status === 'failed' || statusData.status === 'error') {
          const errMsg: string = statusData.result?.error ?? statusData.error ?? 'Export task failed on server';
          throw new Error(errMsg);
        }
        // status === 'generating' | 'pending' | 'processing' → 继续轮询
      }

      // 3. 下载 Blob
      if (downloadTarget) {
        const blob = await downloadExportedFile(downloadTarget);
        const url = window.URL.createObjectURL(new Blob([blob]));
        const link = document.createElement('a');
        link.href = url;
        // 文件名：取路径最后一段，去掉 query string
        const actualName = downloadTarget.split('/').pop()?.split('?')[0] || 'export.pptx';
        link.setAttribute('download', actualName);
        document.body.appendChild(link);
        link.click();
        link.parentNode?.removeChild(link);
        window.URL.revokeObjectURL(url);
      }
    } catch (e) {
      console.error('[useExport] Export exception:', e);
      alert(`导出出错: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsExporting(false);
    }
  }, [sessionId, isExporting]);

  return { isExporting, exportCourseware };
}
