import { useState, useCallback } from 'react';
import { triggerExport, getExportStatus, downloadExportedFile, API_BASE_URL } from '../utils/api';

/**
 * useExport — 封装 PPT 异步导出流程
 *
 * 1. 调用 triggerExport(sessionId, themeKey?) 触发后台任务
 * 2. 每 2s 轮询 getExportStatus(task_id)
 *    ✅ completed → 解析 download_urls.ppt_url 或 filename
 *    ❌ failed    → 抛出 error
 * 3. 通过 downloadExportedFile (Blob) 触发浏览器下载
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
      let actualFilename = 'export.pptx';

      while (true) {
        await new Promise<void>(resolve => setTimeout(resolve, 2000));
        const statusData = await getExportStatus(taskId);

        if (statusData.status === 'completed') {
          // ── 兼容两种响应结构 ──────────────────────────────────────
          // 结构 A（旧）: { status, result: { download_urls: { ppt_url }, filename } }
          // 结构 B（新）: { status, download_urls: { ppt_url }, filename }
          const pptUrl: string | undefined =
            statusData.download_urls?.ppt_url            // 结构 B (顶层)
            ?? statusData.result?.download_urls?.ppt_url;  // 结构 A (嵌套)

          const filename: string | undefined =
            statusData.filename ?? statusData.result?.filename;

          downloadTarget = pptUrl ?? filename ?? '';
          if (filename) actualFilename = filename;
          break;
        }

        if (statusData.status === 'failed' || statusData.status === 'error') {
          const errMsg: string =
            statusData.error
            ?? statusData.result?.error
            ?? 'Export task failed on server';
          throw new Error(errMsg);
        }
        // status === 'generating' | 'pending' | 'processing' → 继续轮询
      }

      if (!downloadTarget) throw new Error('服务端未返回下载地址');

      // 3. 下载
      try {
        // 优先通过 axios blob 下载（携带 Authorization header）
        const blob = await downloadExportedFile(downloadTarget);
        const objectUrl = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = objectUrl;
        link.setAttribute('download', actualFilename);
        document.body.appendChild(link);
        link.click();
        link.parentNode?.removeChild(link);
        window.URL.revokeObjectURL(objectUrl);
      } catch (downloadErr) {
        // fallback: 直接在新标签打开携带 token 的 URL
        console.warn('[useExport] Blob download failed, falling back to direct URL open:', downloadErr);
        const token = localStorage.getItem('access_token') ?? '';
        // 构建完整 URL
        let fullUrl: string;
        if (downloadTarget.startsWith('http')) {
          fullUrl = downloadTarget;
        } else if (downloadTarget.startsWith('/api/v1/')) {
          const base = API_BASE_URL.replace(/\/api\/v\d+\/?$/, '');
          fullUrl = `${base}${downloadTarget}`;
        } else {
          fullUrl = `${API_BASE_URL}${downloadTarget.startsWith('/') ? '' : '/'}${downloadTarget}`;
        }
        if (token) fullUrl += `${fullUrl.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
        window.open(fullUrl, '_blank');
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
