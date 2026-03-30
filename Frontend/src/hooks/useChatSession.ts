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
    let active = true;
    setMessages([]);
    setIsSynthesizing(false);
    setLatestIntent(null);

    const loadHistory = async () => {
      if (!sessionId || sessionId === 'new') return;
      try {
        const res = await getSession(sessionId);
        if (!active) return;
        const historyData = res?.messages || res?.chat_history || res?.history;
        if (historyData && Array.isArray(historyData)) {
          const deduplicated = historyData.filter((m: any, i: number, arr: any[]) => {
            if (i === 0) return true;
            const prev = arr[i - 1];
            return !((m.role === prev.role) && ((m.content || m.text) === (prev.content || prev.text)));
          });

          const healAI = (m: any) => {
            let rawContent = (m.content || m.text || '').trim();
            let thinking = '';
            let toolLogs: string[] = [];

            const thinkRegex = /<think>([\s\S]*?)<\/think>/g;
            let match;
            while ((match = thinkRegex.exec(rawContent)) !== null) {
              thinking += match[1].trim() + '\n';
            }
            let cleaned = rawContent.replace(thinkRegex, '').trim();

            const toolRegex = /<(seed:)?tool_call[^>]*>([\s\S]*?)<\/(seed:)?tool_call>/g;
            while ((match = toolRegex.exec(cleaned)) !== null) {
              toolLogs.push(`\n> 🤖 *历史意图捕捉: \`${match[0].length} 字符\`*\n`);
            }
            cleaned = cleaned.replace(toolRegex, '').trim();

            return { content: cleaned, thinking: thinking.trim(), toolLog: toolLogs.join('\n') };
          };

          const mapped: MessageProps[] = deduplicated.map((m: any) => {
            const id = m.id || generateId();
            const role = (m.role === 'assistant' || m.role === 'ai') ? 'ai' : 'teacher';
            if (role === 'ai') {
              const healed = healAI(m);
              const managerLog = GlobalStreamManager.getMessageToolLog(id);
              return {
                id,
                role,
                content: healed.content,
                thinking: healed.thinking,
                toolLog: [healed.toolLog, managerLog].filter(Boolean).join('\n'),
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
      } catch (err) {
        console.error('[History Healing] Fail:', err);
      }
    };

    loadHistory();

    const unsubscribe = GlobalStreamManager.subscribe(sessionId, (state: StreamState | null) => {
      if (!active || !state) return;
      setIsSynthesizing(state.isSynthesizing);
      if (state.latestIntent) setLatestIntent(state.latestIntent);

      setMessages(prev => {
        const idx = prev.findIndex(m => m.id === state.aiMsgId);
        const data: MessageProps = {
          id: state.aiMsgId,
          role: 'ai',
          content: state.content,
          toolLog: state.toolLog,
          thinking: state.thinking,
          isThinking: state.isThinking,
          isTyping: state.isSynthesizing
        };
        if (idx !== -1) {
          const updated = [...prev];
          updated[idx] = data;
          return updated;
        }
        return [...prev, data];
      });
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [sessionId]);

  return { messages, isSynthesizing, latestIntent, sendMessage, stopGeneration, clearIntent: () => setLatestIntent(null) };
}
