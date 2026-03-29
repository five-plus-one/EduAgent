import React, { useState, useRef, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Mic, Paperclip, Send, Download, Sparkles } from 'lucide-react';
import styles from './Workspace.module.css';
import { clsx } from 'clsx';
import * as Tabs from '@radix-ui/react-tabs';
import { useChatSession } from '../hooks/useChatSession';
import MessageBubble from '../components/MessageBubble';

export default function Workspace() {
  const { sessionId = 'new' } = useParams();
  const [inputText, setInputText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const streamEndRef = useRef<HTMLDivElement>(null);

  const { messages, isSynthesizing, sendMessage } = useChatSession(sessionId);

  // Auto scroll to bottom
  useEffect(() => {
    streamEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = () => {
    const text = inputText.trim();
    if (text && !isSynthesizing) {
      sendMessage(text);
      setInputText('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className={styles.workspace}>
      
      {/* LEFT PANEL: Chat Interaction */}
      <section className={styles.chatPanel}>
        <header className={styles.chatHeader}>
          <div className={styles.sessionInfo}>
            <h2 className={styles.sessionTitle}>
              {sessionId === 'new' ? '新建课件会话' : '持续设计课件'}
            </h2>
            <span className={styles.sessionStatus}>
              {isSynthesizing ? (
                 <><Sparkles size={14} className={clsx(styles.sparkleIcon, styles.rotating)}/> 思考中...</>
              ) : (
                 <><Sparkles size={14} className={styles.sparkleIcon}/> 准备就绪</>
              )}
            </span>
          </div>
        </header>

        <div className={styles.messageStream}>
          {messages.length === 0 ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyIconWrapper}>
                <Sparkles size={32} />
              </div>
              <h3>您想设计什么课程？</h3>
              <p>输入教学思路，或上传参考资料，AI 将自动进行设计与重组。</p>
            </div>
          ) : (
            messages.map((msg) => (
              <MessageBubble 
                key={msg.id}
                id={msg.id} 
                role={msg.role} 
                content={msg.content} 
                isTyping={msg.isTyping} 
              />
            ))
          )}
          <div ref={streamEndRef} />
        </div>

        {/* OMNI-DOCK INPUT */}
        <div className={styles.inputDockContainer}>
          <div className={clsx(styles.omniDock, 'glass-panel')}>
            <button className={styles.iconButton} title="上传参考资料">
              <Paperclip size={20} />
            </button>
            <textarea 
              className={styles.textarea} 
              placeholder="描述您的教学逻辑，或者选中右侧PPT指定修改..."
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
            />
            <div className={styles.actionsBox}>
              <button 
                className={clsx(styles.micButton, isRecording && styles.recording)}
                onMouseDown={() => setIsRecording(true)}
                onMouseUp={() => setIsRecording(false)}
                title="长按说话"
              >
                <Mic size={20} />
              </button>
              <button 
                className={clsx('button-primary', styles.sendButton)} 
                disabled={!inputText.trim() || isSynthesizing}
                onClick={handleSubmit}
              >
                <Send size={18} />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* DRAG DIVIDER */}
      <div className={styles.divider} />

      {/* RIGHT PANEL: Visual WorkSpace */}
      <section className={styles.visualPanel}>
        <Tabs.Root className={styles.tabsRoot} defaultValue="ppt">
          <header className={styles.visualHeader}>
            <Tabs.List className={styles.tabsList}>
              <Tabs.Trigger className={styles.tabsTrigger} value="files">参考资料</Tabs.Trigger>
              <Tabs.Trigger className={styles.tabsTrigger} value="ppt">课件预览 (PPT)</Tabs.Trigger>
              <Tabs.Trigger className={styles.tabsTrigger} value="word">讲义 (Word)</Tabs.Trigger>
            </Tabs.List>
            <button className={clsx('button-base', styles.exportBtn)}>
              <Download size={16} /> 导出
            </button>
          </header>

          <Tabs.Content className={styles.tabsContent} value="files">
            <div className={styles.placeholderCentric}>资料解析区暂无数据</div>
          </Tabs.Content>
          
          <Tabs.Content className={styles.tabsContent} value="ppt">
            <div className={styles.canvasArea}>
              <div className={clsx(styles.pptCard, 'glass-panel')}>
                <div className={styles.cardHeader}>
                  <span className={styles.pageNumber}>01</span>
                  <h4>牛顿第二定律导入</h4>
                </div>
                <ul className={styles.bulletList}>
                  <li>生活案例：推空车与重车的区别感受</li>
                  <li>核心问题：力、质量、加速度有何关系？</li>
                </ul>
              </div>
            </div>
          </Tabs.Content>
          
          <Tabs.Content className={styles.tabsContent} value="word">
            <div className={styles.placeholderCentric}>Word教案生成中...</div>
          </Tabs.Content>
        </Tabs.Root>
      </section>

    </div>
  );
}
