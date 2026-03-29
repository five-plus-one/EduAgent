import { useState, useCallback } from 'react';
import { streamChatCompletion } from '../utils/api';
import type { MessageProps } from '../components/MessageBubble';

const generateId = () => Math.random().toString(36).substring(2, 11);

export function useChatSession(sessionId: string) {
  const [messages, setMessages] = useState<MessageProps[]>([]);
  const [isSynthesizing, setIsSynthesizing] = useState(false);

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
      await streamChatCompletion(
        sessionId,
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
  }, [sessionId, isSynthesizing]);

  return { messages, isSynthesizing, sendMessage };
}
