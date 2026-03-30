import { useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { streamChatCompletion, createSession } from '../utils/api';
import type { MessageProps } from '../components/MessageBubble';

const generateId = () => Math.random().toString(36).substring(2, 11);

export function useChatSession(sessionId: string) {
  const [messages, setMessages] = useState<MessageProps[]>([]);
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const navigate = useNavigate();

  // Holds the resolved real session ID (after lazy creation)
  const resolvedSessionIdRef = useRef<string | null>(
    sessionId !== 'new' ? sessionId : null
  );

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim() || isSynthesizing) return;

    // Add user message
    const teacherMsgId = generateId();
    setMessages(prev => [...prev, { id: teacherMsgId, role: 'teacher', content }]);

    // Create placeholder for AI response
    const aiMsgId = generateId();
    setIsSynthesizing(true);
    setMessages(prev => [...prev, { id: aiMsgId, role: 'ai', content: '', isTyping: true }]);

    try {
      // --- Lazy session creation ---
      // If this is a "new" session, create it on the backend first
      if (!resolvedSessionIdRef.current) {
        const result = await createSession('新建备课会话');
        const newId: string = result?.session_id ?? result;
        resolvedSessionIdRef.current = newId;
        // Update the URL so the user can bookmark / refresh the real session
        navigate(`/chat/${newId}`, { replace: true });
      }

      const activeSessionId = resolvedSessionIdRef.current;

      await streamChatCompletion(
        activeSessionId,
        content,
        (chunk, isFinished) => {
          setMessages(prev => prev.map(m =>
            m.id === aiMsgId
              ? { ...m, content: m.content + chunk, isTyping: !isFinished }
              : m
          ));
          if (isFinished) {
            setIsSynthesizing(false);
          }
        },
        (_err) => {
          setIsSynthesizing(false);
          setMessages(prev => prev.map(m =>
            m.id === aiMsgId
              ? { ...m, content: '⚠️ 连接错误，请检查网络后重试。', isTyping: false }
              : m
          ));
        }
      );
    } catch {
      setIsSynthesizing(false);
      setMessages(prev => prev.map(m =>
        m.id === aiMsgId
          ? { ...m, content: '⚠️ 网络错误，请稍后再试。', isTyping: false }
          : m
      ));
    }
  }, [sessionId, isSynthesizing, navigate]);

  return { messages, isSynthesizing, sendMessage };
}
