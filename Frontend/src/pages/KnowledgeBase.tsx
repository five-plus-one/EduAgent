import React, { useState, useRef, useEffect, useCallback } from 'react';
import { UploadCloud, FileText, CheckCircle, Clock, Trash2, RefreshCw } from 'lucide-react';
import { clsx } from 'clsx';
import styles from './KnowledgeBase.module.css';
import { uploadKnowledgeDoc, listKnowledgeDocs, deleteKnowledgeDoc } from '../utils/api';

interface KBDocument {
  document_id: string; // backend field name (NOT doc_id)
  filename: string;
  status: string;
  progress?: number;   // 0-100
  summary?: string;
  created_at?: string;
}

export default function KnowledgeBase() {
  const [documents, setDocuments] = useState<KBDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchDocs = useCallback(async () => {
    try {
      const data = await listKnowledgeDocs(1, 50);
      // Backend returns { total, items: [...] } or raw array
      const items: KBDocument[] = data?.items ?? (Array.isArray(data) ? data : []);
      setDocuments(items);
    } catch {
      console.error('Failed to fetch knowledge base documents');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDocs();
  }, [fetchDocs]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(Array.from(e.dataTransfer.files));
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(Array.from(e.target.files));
    }
  };

  const handleFiles = async (files: File[]) => {
    setUploading(true);
    try {
      await Promise.all(
        files.map((file) =>
          uploadKnowledgeDoc(file, { filename: file.name })
        )
      );
      // Refresh list after upload
      await fetchDocs();
    } catch {
      console.error('Upload failed');
    } finally {
      setUploading(false);
      // Reset file input
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDelete = async (documentId: string) => {
    if (!window.confirm('确认从知识库中删除该文件？此操作不可撤销。')) return;
    try {
      await deleteKnowledgeDoc(documentId);
      setDocuments((prev) => prev.filter((d) => d.document_id !== documentId));
    } catch {
      console.error('Delete failed');
    }
  };

  return (
    <div className={styles.kbContainer}>
      <header className={styles.pageHeader}>
        <div>
          <h1 className={styles.title}>知识库管理 (RAG Admin)</h1>
          <p className={styles.subtitle}>
            上传专业课件资料、教案文档或视频。它们将被自动分析并向量化，用于强化 AI 智能体的领域理解能力。
          </p>
        </div>
        <button
          className={clsx('button-base', styles.refreshBtn)}
          onClick={fetchDocs}
          title="刷新列表"
        >
          <RefreshCw size={16} />
        </button>
      </header>

      <section className={styles.contentArea}>
        {/* UPPER: Upload Zone */}
        <div 
          className={clsx(
            styles.uploadZone, 
            'glass-panel', 
            isDragging && styles.dragging,
            uploading && styles.uploading
          )}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => !uploading && fileInputRef.current?.click()}
        >
          <input 
            type="file" 
            ref={fileInputRef} 
            style={{ display: 'none' }} 
            onChange={handleFileSelect}
            multiple
          />
          <div className={styles.uploadContent}>
             <div className={styles.uploadIconWrapper}>
               <UploadCloud size={48} className={clsx(styles.uploadIcon, uploading && styles.rotating)} />
             </div>
             <h3>{uploading ? '上传中，请稍候...' : '点击或拖拽文件到这里上传'}</h3>
             <p>支持 PDF、Word、PPT、MP4 以及纯文本文件</p>
          </div>
        </div>

        {/* LOWER: Data Table */}
        <div className={clsx(styles.tableContainer, 'glass-panel')}>
          <div className={styles.tableHeader}>
            <h3 className={styles.tableTitle}>
              已入库文档 ({loading ? '…' : documents.length})
            </h3>
          </div>
          <div className={styles.tableWrapper}>
            <table className={styles.dataTable}>
              <thead>
                <tr>
                  <th>文件名</th>
                  <th>上传日期</th>
                  <th>解析状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={4} className={styles.emptyTable}>
                      <Clock size={14} className={styles.rotating} style={{display:'inline', marginRight:6}} />
                      加载中...
                    </td>
                  </tr>
                ) : documents.length === 0 ? (
                  <tr>
                    <td colSpan={4} className={styles.emptyTable}>
                      尚未上传任何知识库文件
                    </td>
                  </tr>
                ) : (
                  documents.map((doc) => (
                    <tr key={doc.document_id} className={styles.tableRow}>
                      <td>
                        <div className={styles.cellFile}>
                          <FileText size={16} className={styles.fileIcon} />
                          <span className={styles.filename}>{doc.filename}</span>
                        </div>
                      </td>
                      <td className={styles.cellDate}>
                        {doc.created_at
                          ? new Date(doc.created_at).toLocaleDateString('zh-CN')
                          : '—'}
                      </td>
                      <td>
                        {doc.status === 'completed' ? (
                           <div className={clsx(styles.statusBadge, styles.statusSuccess)}>
                             <CheckCircle size={14} /> 解析完成
                           </div>
                        ) : doc.status === 'failed' ? (
                           <div className={clsx(styles.statusBadge, styles.statusFailed)}>
                             <Clock size={14} /> 解析失败
                           </div>
                        ) : (
                           <div className={clsx(styles.statusBadge, styles.statusPending)}>
                             <Clock size={14} className={styles.rotating} />
                             向量化中{doc.progress != null ? ` ${doc.progress}%` : ''}
                           </div>
                        )}
                      </td>
                      <td>
                        <button
                          className={styles.deleteBtn}
                          onClick={() => handleDelete(doc.document_id)}
                          title="删除"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
