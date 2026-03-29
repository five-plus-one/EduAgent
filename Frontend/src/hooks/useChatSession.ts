import { useState, useCallback } from 'react';
import { streamChatCompletion } from '../utils/api';
import type { MessageProps } from '../components/MessageBubble';

const generateId = () => Math.random().toString(36).substring(2, 11);

export function useChatSession(sessionId: string) {
  const [messages, setMessages] = useState<MessageProps[]>([]);
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  
  // Real endpoint or mock for now
  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim() || isSynthesizing) return;
    
    // Add user message
    const teacherMsgId = generateId();
    setMessages(prev => [...prev, { id: teacherMsgId, role: 'teacher', content }]);
    
    // Create placeholder for AI
    const aiMsgId = generateId();
    setIsSynthesizing(true);
    setMessages(prev => [...prev, { id: aiMsgId, role: 'ai', content: '', isTyping: true }]);

    try {
      // Mocking the SSE behaviour since we have no real Backend running on port 80/3000
      // If the real API works we would use streamChatCompletion(sessionId, content, onMessage...)
      let aiResponseText = '';
      const dummyResponseChunks = [
        "好", "的，", "关于", content.split(' ')[0] || "这个内容", "，",
        "我", "已", "经", "理", "解", "了。", "\n",
        "接", "下", "来", "为", "您", "重", "组", "课", "件", "结构..."
      ];
      
      let chunkIdx = 0;
      const interval = setInterval(() => {
        if (chunkIdx >= dummyResponseChunks.length) {
          clearInterval(interval);
          setMessages(prev => prev.map(m => m.id === aiMsgId ? { ...m, isTyping: false } : m));
          setIsSynthesizing(false);
          return;
        }
        aiResponseText += dummyResponseChunks[chunkIdx];
        setMessages(prev => prev.map(m => m.id === aiMsgId ? { ...m, content: aiResponseText } : m));
        chunkIdx++;
      }, 150);
      
    } catch (err) {
      setIsSynthesizing(false);
      setMessages(prev => prev.map(m => m.id === aiMsgId ? { ...m, content: '网络错误，请稍后再试。', isTyping: false } : m));
    }
  }, [sessionId, isSynthesizing]);

  return { messages, isSynthesizing, sendMessage };
}
