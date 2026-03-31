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
        console.log(`[UseChatSession] Loading data for session ${sessionId}`);
        const res = await getSession(sessionId);
        if (!active) return;
        const historyData = res?.messages || res?.chat_history || res?.history;
        if (historyData && Array.isArray(historyData)) {
          // 1. Deduplicate consecutive identical messages
          const deduplicated = historyData.filter((m: any, i: number, arr: any[]) => {
            if (i === 0) return true;
            const prev = arr[i - 1];
            return !((m.role === prev.role) && ((m.content || m.text) === (prev.content || prev.text)));
          });

          // 2. Heal AI content by stripping <think> and <tool_call> tags safely
          const healAI = (m: any) => {
            const raw = (m.content || m.text || '').trim();
            if (!raw) return { content: '', thinking: '', toolLog: '' };

            let thinking = '';
            let toolLogSegments: string[] = [];
            
            // Extract thinking using a robust pattern
            const thinkRgx = /<think>([\s\S]*?)(?:<\/think>|$)/g;
            let thinkMatch;
            while ((thinkMatch = thinkRgx.exec(raw)) !== null) {
              thinking += thinkMatch[1].trim() + '\n';
            }

            // Extract tool logs
            const toolRgx = /<(?:seed:)?tool_call[^>]*>([\s\S]*?)(?:<\/(?:seed:)?tool_call>|$)/g;
            let toolMatch;
            while ((toolMatch = toolRgx.exec(raw)) !== null) {
              toolLogSegments.push(`\n> 🤖 *历史工具记录: \`${toolMatch[0].length} 字符\`*\n`);
            }

            // Clean the conversational content
            let cleaned = raw.replace(thinkRgx, '').replace(toolRgx, '').trim();
            // PUA Defensive: If cleaning results in empty but raw was non-empty and didn't look like JUST tags
            if (!cleaned && raw && raw.length > 20 && !raw.startsWith('<think')) {
                cleaned = raw;
            }

            return { 
                content: cleaned || (thinking ? '' : ''), 
                thinking: thinking.trim(), 
                toolLog: toolLogSegments.join('\n') 
            };
          };

          const mapped: Array<MessageProps> = deduplicated.map((m: any) => {
            const id = m.id || generateId();
            const role = ((m.role === 'assistant' || m.role === 'ai') ? 'ai' : 'teacher') as 'ai' | 'teacher';
            
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
            return { id, role, content: (m.content || m.text || m.payload?.content || '') };
          });

          setMessages(mapped);
          
          // Check for active resume
          const activeStream = GlobalStreamManager.getStream(sessionId);
          if (activeStream) {
            setMessages(prev => {
                if (prev.some(m => m.id === activeStream.aiMsgId)) return prev;
                return [...prev, {
                    id: activeStream.aiMsgId,
                    role: 'ai',
                    content: activeStream.content,
                    toolLog: activeStream.toolLog,
                    thinking: activeStream.thinking,
                    isThinking: activeStream.isThinking,
                    isTyping: activeStream.isSynthesizing,
                }];
            });
            setIsSynthesizing(activeStream.isSynthesizing);
            if (activeStream.latestIntent) setLatestIntent(activeStream.latestIntent);
          }
        }
      } catch (err) {
        console.error('[History Healing] Error:', err);
      }
    };

    loadHistory();

    const unsubscribe = GlobalStreamManager.subscribe(sessionId, (state: StreamState | null) => {
      if (!active || !state) return;
      console.log(`[UseChatSession] Global Stream UI Tick for ${sessionId}. ContentLen: ${state.content.length}`);
      
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
