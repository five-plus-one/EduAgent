import React, { useState, useRef } from 'react';
import { UploadCloud, FileText, CheckCircle, Clock } from 'lucide-react';
import { clsx } from 'clsx';
import styles from './KnowledgeBase.module.css';

// Mock Knowledge Base Documents
const initialDocuments = [
  { id: 'doc_1', filename: '高中物理必修一_完整教案.pdf', status: 'completed', date: '2026-03-28' },
  { id: 'doc_2', filename: '力学与运动学_参考实验视频.mp4', status: 'completed', date: '2026-03-29' },
  { id: 'doc_3', filename: '牛顿第二定律深度剖析.docx', status: 'embedding', date: '2026-03-29' },
];

export default function KnowledgeBase() {
  const [documents, setDocuments] = useState(initialDocuments);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleFiles = (files: File[]) => {
    // Mock the upload and embedding process (Module 5.1 & 5.2)
    const newDocs = files.map(file => ({
      id: `doc_${Math.random().toString(36).substring(7)}`,
      filename: file.name,
      status: 'embedding',
      date: new Date().toISOString().split('T')[0]
    }));
    
    setDocuments(prev => [...newDocs, ...prev]);

    // Simulate embedding completion
    setTimeout(() => {
      setDocuments(prev => prev.map(doc => 
        newDocs.find(n => n.id === doc.id) ? { ...doc, status: 'completed' } : doc
      ));
    }, 4000);
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
      </header>

      <section className={styles.contentArea}>
        {/* UPPER: Upload Zone */}
        <div 
          className={clsx(
            styles.uploadZone, 
            'glass-panel', 
            isDragging && styles.dragging
          )}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
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
               <UploadCloud size={48} className={styles.uploadIcon} />
             </div>
             <h3>点击或拖拽文件到这里上传</h3>
             <p>支持 PDF、Word、PPT、MP4 以及纯文本文件</p>
          </div>
        </div>

        {/* LOWER: Data Table */}
        <div className={clsx(styles.tableContainer, 'glass-panel')}>
          <div className={styles.tableHeader}>
            <h3 className={styles.tableTitle}>已入库文档 ({documents.length})</h3>
          </div>
          <div className={styles.tableWrapper}>
            <table className={styles.dataTable}>
              <thead>
                <tr>
                  <th>文件名</th>
                  <th>上传日期</th>
                  <th>解析状态</th>
                </tr>
              </thead>
              <tbody>
                {documents.map(doc => (
                  <tr key={doc.id} className={styles.tableRow}>
                    <td>
                      <div className={styles.cellFile}>
                        <FileText size={16} className={styles.fileIcon} />
                        <span className={styles.filename}>{doc.filename}</span>
                      </div>
                    </td>
                    <td className={styles.cellDate}>{doc.date}</td>
                    <td>
                      {doc.status === 'completed' ? (
                         <div className={clsx(styles.statusBadge, styles.statusSuccess)}>
                           <CheckCircle size={14} /> 解析完成
                         </div>
                      ) : (
                         <div className={clsx(styles.statusBadge, styles.statusPending)}>
                           <Clock size={14} className={styles.rotating} /> 向量化中
                         </div>
                      )}
                    </td>
                  </tr>
                ))}
                {documents.length === 0 && (
                  <tr>
                    <td colSpan={3} className={styles.emptyTable}>
                      尚未上传任何知识库文件
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
