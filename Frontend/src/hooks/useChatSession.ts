import { useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { streamChatCompletion } from '../utils/api';
import type { MessageProps } from '../components/MessageBubble';

const generateId = () => Math.random().toString(36).substring(2, 11);

export function useChatSession(sessionId: string) {
  const [messages, setMessages] = useState<MessageProps[]>([]);
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [latestIntent, setLatestIntent] = useState<string | null>(null);
  const navigate = useNavigate();

  // Holds the resolved real session ID (after lazy creation)
  const resolvedSessionIdRef = useRef<string | null>(
    sessionId !== 'new' ? sessionId : null
  );

  // AbortController for the active SSE stream
  const abortControllerRef = useRef<AbortController | null>(null);
  // Track the current AI message id so stopGeneration can finalize it
  const currentAiMsgIdRef = useRef<string | null>(null);

  const stopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    // Finalize the current AI message bubble (stop the typing indicator)
    if (currentAiMsgIdRef.current) {
      const id = currentAiMsgIdRef.current;
      setMessages(prev => prev.map(m =>
        m.id === id ? { ...m, isTyping: false } : m
      ));
      currentAiMsgIdRef.current = null;
    }
    setIsSynthesizing(false);
  }, []);

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim() || isSynthesizing) return;

    // Add user message
    const teacherMsgId = generateId();
    setMessages(prev => [...prev, { id: teacherMsgId, role: 'teacher', content }]);

    // Create placeholder for AI response
    const aiMsgId = generateId();
    currentAiMsgIdRef.current = aiMsgId;
    setIsSynthesizing(true);
    setMessages(prev => [...prev, { id: aiMsgId, role: 'ai', content: '', isTyping: true }]);

    // Create a fresh AbortController for this request
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      // --- Enforce real session ---
      if (!resolvedSessionIdRef.current || resolvedSessionIdRef.current === 'new') {
        alert('当前处于未命名初始态，请在左侧侧边栏【新课件设计】创建并命名您的会话。');
        setIsSynthesizing(false);
        setMessages(prev => prev.slice(0, prev.length - 2)); // 撤回刚刚的占位符
        return;
      }

      const activeSessionId = resolvedSessionIdRef.current;
      setLatestIntent(null); // reset intent for new message

      await streamChatCompletion(
        activeSessionId,
        content,
        (chunk, isFinished, intent) => {
          if (intent && typeof intent === 'string') {
            // Extracted intent detected from backend Agent!
            setLatestIntent(intent);
          }
          setMessages(prev => prev.map(m =>
            m.id === aiMsgId
              ? { ...m, content: m.content + chunk, isTyping: !isFinished }
              : m
          ));
          if (isFinished) {
            currentAiMsgIdRef.current = null;
            abortControllerRef.current = null;
            setIsSynthesizing(false);
          }
        },
        (_err) => {
          // Only handle non-abort errors
          if (!controller.signal.aborted) {
            setIsSynthesizing(false);
            currentAiMsgIdRef.current = null;
            setMessages(prev => prev.map(m =>
              m.id === aiMsgId
                ? { ...m, content: m.content || '⚠️ 连接错误，请检查网络后重试。', isTyping: false }
                : m
            ));
          }
        },
        controller.signal,
      );
    } catch (err) {
      // Ignore AbortError — user-initiated stop is handled by stopGeneration()
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setIsSynthesizing(false);
      currentAiMsgIdRef.current = null;
      setMessages(prev => prev.map(m =>
        m.id === aiMsgId
          ? { ...m, content: m.content || '⚠️ 网络错误，请稍后再试。', isTyping: false }
          : m
      ));
    }
  }, [sessionId, isSynthesizing, navigate]);

  return { messages, isSynthesizing, latestIntent, sendMessage, stopGeneration };
}
