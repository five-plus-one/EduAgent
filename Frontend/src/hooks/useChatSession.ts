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
    const teacherMsgId = generateId();
    setMessages(prev => [...prev, { id: teacherMsgId, role: 'teacher', content }]);
    GlobalStreamManager.startStream(sessionId, content);
  }, [sessionId, isSynthesizing, navigate]);

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
          const deduplicated = historyData.filter((m: any, i: number, arr: any[]) => {
            if (i === 0) return true;
            const prev = arr[i - 1];
            const contentMatches = (m.content || m.text) === (prev.content || prev.text);
            const roleMatches = m.role === prev.role;
            return !(roleMatches && contentMatches);
          });

          const healMessage = (m: any) => {
            let content = m.content || m.text || '';
            let thinking = '';
            let toolLogs: string[] = [];

            // Pattern for <think>
            const thinkRegex = /<think>([\s\S]*?)<\/think>/g;
            let thinkMatch;
            while ((thinkMatch = thinkRegex.exec(content)) !== null) {
              thinking += (thinkMatch[1] || '').trim() + '\n';
            }
            content = content.replace(thinkRegex, '').trim();

            // Pattern for <tool_call>
            const toolRegex = /<(seed:)?tool_call[^>]*>([\s\S]*?)<\/(seed:)?tool_call>/g;
            let toolMatch;
            while ((toolMatch = toolRegex.exec(content)) !== null) {
              toolLogs.push(`\n> 🤖 *历史意图捕捉: \`${toolMatch[0].length} 字符\`*\n`);
            }
            content = content.replace(toolRegex, '').trim();

            return { content: content || (m.role === 'user' ? '(empty)' : '...'), thinking: thinking.trim(), toolLog: toolLogs.join('\n') };
          };

          const mapped: MessageProps[] = deduplicated.map((m: any) => {
            const id = m.id || generateId();
            const role = ((m.role === 'assistant' || m.role === 'ai') ? 'ai' : 'teacher') as 'ai' | 'teacher';
            
            if (role === 'ai') {
              const healed = healMessage(m);
              const persistedLog = GlobalStreamManager.getMessageToolLog(id);
              return {
                id,
                role,
                content: healed.content,
                thinking: healed.thinking,
                toolLog: [healed.toolLog, persistedLog].filter(Boolean).join('\n'),
              };
            }
            return { id, role, content: m.content || m.text || '' };
          });

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
        }
      }).catch(e => {
        console.error('[Session History] Failed to fetch session history:', e);
      });
    }

    const unsubscribe = GlobalStreamManager.subscribe(sessionId, (state: StreamState | null) => {
      if (!active || !state) return;
      setIsSynthesizing(state.isSynthesizing);
      if (state.latestIntent) setLatestIntent(state.latestIntent);

      setMessages(prev => {
        const idx = prev.findIndex(m => m.id === state.aiMsgId);
        const base = {
          id: state.aiMsgId,
          role: 'ai' as const,
          content: state.content || (state.isSynthesizing ? '' : '...'),
          toolLog: state.toolLog,
          thinking: state.thinking,
          isThinking: state.isThinking,
          isTyping: state.isSynthesizing 
        };
        if (idx !== -1) {
          const newArr = [...prev];
          newArr[idx] = base;
          return newArr;
        } else {
          return [...prev, base];
        }
      });
    });

    return () => { 
      active = false;
      unsubscribe();
    };
  }, [sessionId]);

  return { messages, isSynthesizing, latestIntent, sendMessage, stopGeneration, clearIntent: () => setLatestIntent(null) };
}
