import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSession } from '../utils/api';
import { GlobalStreamManager, type StreamState } from '../utils/streamManager';
import type { MessageProps } from '../components/MessageBubble';

const generateId = () => Math.random().toString(36).substring(2, 11);

export function useChatSession(sessionId: string) {
  const [messages, setMessages] = useState<MessageProps[]>([]);
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [latestIntent, setLatestIntent] = useState<string | null>(null);
  const navigate = useNavigate();

  const stopGeneration = useCallback(() => {
    GlobalStreamManager.stopStream(sessionId);
    setIsSynthesizing(false);
  }, [sessionId]);

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim() || isSynthesizing) return;

    if (sessionId === 'new') {
      alert('当前处于未命名初始态，请在左侧侧边栏【新课件设计】创建并命名您的会话。');
      return;
    }

    setLatestIntent(null);

    // Optimistically insert user's message
    const teacherMsgId = generateId();
    setMessages(prev => [...prev, { id: teacherMsgId, role: 'teacher', content }]);

    // Hand off SSE networking to the global manager.
    // The view layer will receive updates automatically via subscription.
    GlobalStreamManager.startStream(sessionId, content);
  }, [sessionId, isSynthesizing, navigate]);

  // Handle session switch: load history and subscribe to any background streams
  useEffect(() => {
    setMessages([]);
    setIsSynthesizing(false);
    setLatestIntent(null);

    let active = true;

    if (sessionId && sessionId !== 'new') {
      getSession(sessionId).then(res => {
        if (!active) return;
        const historyData = res?.messages || res?.chat_history || res?.history;
        if (historyData && Array.isArray(historyData)) {
          // Contiguous deduplication to band-aid DB pollution
          const deduplicated = historyData.filter((m: any, i: number, arr: any[]) => {
            if (i === 0) return true;
            const prev = arr[i - 1];
            const contentMatches = (m.content || m.text) === (prev.content || prev.text);
            const roleMatches = m.role === prev.role;
            return !(roleMatches && contentMatches);
          });

          const mapped: MessageProps[] = deduplicated.map((m: any) => ({
            id: m.id || generateId(),
            role: ((m.role === 'assistant' || m.role === 'ai') ? 'ai' : 'teacher') as 'ai' | 'teacher',
            content: m.content || m.text || '',
          }));

          // Inject persisted tool log into the last AI message (survives session switches)
          const persistedToolLog = GlobalStreamManager.getToolLog(sessionId);
          if (persistedToolLog) {
            const lastAiIdx = mapped.reduceRight((acc, m, i) => acc === -1 && m.role === 'ai' ? i : acc, -1);
            if (lastAiIdx !== -1) {
              mapped[lastAiIdx] = { ...mapped[lastAiIdx], toolLog: persistedToolLog };
            }
          }

          // Merge with any currently active global stream for this session
          const activeStream = GlobalStreamManager.getStream(sessionId);
          if (activeStream) {
            mapped.push({
              id: activeStream.aiMsgId,
              role: 'ai',
              content: activeStream.content,
              toolLog: activeStream.toolLog,
              thinking: activeStream.thinking,
              isThinking: activeStream.isThinking,
              isTyping: activeStream.isSynthesizing,
            });
            setIsSynthesizing(activeStream.isSynthesizing);
            if (activeStream.latestIntent) setLatestIntent(activeStream.latestIntent);
          }

          setMessages(mapped);
        } else {
          console.warn('[Session History] Backend did not return an array of messages/chat_history in getSession()', res);
        }
      }).catch(e => {
        console.error('[Session History] Failed to fetch session history:', e);
      });
    }

    // Subscribe to the global stream manager for ongoing updates.
    const unsubscribe = GlobalStreamManager.subscribe(sessionId, (state: StreamState | null) => {
      if (!active || !state) return;
      
      setIsSynthesizing(state.isSynthesizing);
      if (state.latestIntent) setLatestIntent(state.latestIntent);

      setMessages(prev => {
        const idx = prev.findIndex(m => m.id === state.aiMsgId);
        if (idx !== -1) {
          const newArr = [...prev];
          newArr[idx] = { 
            ...newArr[idx], 
            content: state.content,
            toolLog: state.toolLog,
            thinking: state.thinking,
            isThinking: state.isThinking,
            isTyping: state.isSynthesizing 
          };
          return newArr;
        } else {
          return [...prev, {
            id: state.aiMsgId,
            role: 'ai',
            content: state.content,
            toolLog: state.toolLog,
            thinking: state.thinking,
            isThinking: state.isThinking,
            isTyping: state.isSynthesizing
          }];
        }
      });
    });

    // PUA Always-On: 卸载或切换会话时，只取消视图层的监听订阅，不再物理掐断底层的长连接。
    // 让大模型在后方安静地继续产生幻觉（啊不，是价值）！
    return () => { 
      active = false;
      unsubscribe();
    };
  }, [sessionId]);

  return { messages, isSynthesizing, latestIntent, sendMessage, stopGeneration, clearIntent: () => setLatestIntent(null) };
}
