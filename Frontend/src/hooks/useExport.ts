import { useState, useCallback } from 'react';
import { triggerExport, getExportStatus, downloadExportedFile } from '../utils/api';

export function useExport(sessionId: string) {
  const [isExporting, setIsExporting] = useState(false);

  const exportCourseware = useCallback(async () => {
    if (isExporting || !sessionId || sessionId === 'new') return;
    setIsExporting(true);
    try {
      // 1. 触发后台异步导出任务
      const triggerRes = await triggerExport(sessionId);
      const taskId = triggerRes.task_id;
      
      if (!taskId) throw new Error("No task_id returned from export endpoint");

      // 2. 轮询任务状态
      let downloadFilename = '';
      while (true) {
        await new Promise(resolve => setTimeout(resolve, 2000)); // 2s 心跳
        const statusData = await getExportStatus(taskId);
        
        if (statusData.status === 'completed') {
          downloadFilename = statusData.download_urls?.ppt_url || statusData.filename;
          break;
        } else if (statusData.status === 'failed' || statusData.status === 'error') {
          throw new Error(statusData.error || 'Export task failed on server');
        }
        // status === 'pending' | 'processing' 继续轮询
      }

      // 3. 拿到文件名后，直接下载 Blob
      if (downloadFilename) {
        const blob = await downloadExportedFile(downloadFilename);
        const url = window.URL.createObjectURL(new Blob([blob]));
        const link = document.createElement('a');
        link.href = url;
        const actualName = downloadFilename.split('/').pop() || 'export.pptx';
        link.setAttribute('download', actualName);
        document.body.appendChild(link);
        link.click();
        
        // 清理内存
        link.parentNode?.removeChild(link);
        window.URL.revokeObjectURL(url);
      }

    } catch (e) {
      console.error('Export exception:', e);
      alert(`导出出错: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsExporting(false);
    }
  }, [sessionId, isExporting]);

  return { isExporting, exportCourseware };
}
