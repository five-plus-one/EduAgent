import { useState, useCallback, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { streamChatCompletion, getSession } from '../utils/api';
import type { MessageProps } from '../components/MessageBubble';

const generateId = () => Math.random().toString(36).substring(2, 11);

export function useChatSession(sessionId: string) {
  const [messages, setMessages] = useState<MessageProps[]>([]);
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [latestIntent, setLatestIntent] = useState<string | null>(null);
  const navigate = useNavigate();



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
      if (sessionId === 'new') {
        alert('当前处于未命名初始态，请在左侧侧边栏【新课件设计】创建并命名您的会话。');
        setIsSynthesizing(false);
        setMessages(prev => prev.slice(0, prev.length - 2)); // 撤回刚刚的占位符
        return;
      }

      setLatestIntent(null); // reset intent for new message

      await streamChatCompletion(
        sessionId,
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

  // Handle session switch: wipe out chat state and load history
  useEffect(() => {
    setMessages([]);
    setIsSynthesizing(false);
    setLatestIntent(null);

    if (sessionId && sessionId !== 'new') {
      let active = true;
      getSession(sessionId).then(res => {
        if (!active) return;
        // Compatible mapping for multiple potential backend array names
        const historyData = res?.messages || res?.chat_history || res?.history;
        if (historyData && Array.isArray(historyData)) {
          const mapped = historyData.map((m: any) => ({
            id: m.id || generateId(),
            role: ((m.role === 'assistant' || m.role === 'ai') ? 'ai' : 'teacher') as 'ai' | 'teacher',
            content: m.content || m.text || '',
          }));
          setMessages(mapped);
        } else {
          console.warn('[Session History] Backend did not return an array of messages/chat_history in getSession()', res);
        }
      }).catch(e => {
        console.error('[Session History] Failed to fetch session history:', e);
      });
      return () => { active = false; };
    }
  }, [sessionId]);

  return { messages, isSynthesizing, latestIntent, sendMessage, stopGeneration, clearIntent: () => setLatestIntent(null) };
}
