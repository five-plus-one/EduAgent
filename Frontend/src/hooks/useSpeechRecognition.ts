/**
 * useSpeechRecognition
 * 
 * A hook to handle browser-native Web Speech API (SpeechRecognition).
 * When recording starts, it listens for speech and returns the transcript.
 * Falls back gracefully if the browser doesn't support it.
 * 
 * After the backend /sessions/{id}/audio-chat endpoint is ready,
 * this hook can be swapped out for a MediaRecorder + FormData approach.
 */

import { useState, useEffect, useRef, useCallback } from 'react';

// TypeScript declaration for Web Speech API (not yet in standard lib)
interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: (event: SpeechRecognitionEvent) => void;
  onerror: (event: SpeechRecognitionErrorEvent) => void;
  onend: () => void;
  onstart: () => void;
}

interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message: string;
}

declare global {
  interface Window {
    SpeechRecognition: { new(): SpeechRecognition };
    webkitSpeechRecognition: { new(): SpeechRecognition };
  }
}

interface UseSpeechRecognitionResult {
  isRecording: boolean;
  isSupported: boolean;
  startRecording: () => void;
  stopRecording: () => void;
  transcript: string;
  error: string | null;
}

export function useSpeechRecognition(onTranscript: (text: string) => void): UseSpeechRecognitionResult {
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
  const isSupported = !!SpeechRecognitionAPI;

  useEffect(() => {
    if (!isSupported) return;

    const recognition = new SpeechRecognitionAPI();
    recognition.continuous = false;      // stop after first pause
    recognition.interimResults = true;   // show words as we speak
    recognition.lang = 'zh-CN';

    recognition.onstart = () => {
      setIsRecording(true);
      setError(null);
      setTranscript('');
    };

    recognition.onresult = (event) => {
      let finalTranscript = '';
      for (let i = 0; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        }
      }
      if (finalTranscript) {
        setTranscript(finalTranscript);
        onTranscript(finalTranscript);
      }
    };

    recognition.onerror = (event) => {
      setError(event.error === 'not-allowed'
        ? '麦克风权限被拒绝，请在浏览器地址栏允许麦克风访问'
        : `识别出错: ${event.error}`
      );
      setIsRecording(false);
    };

    recognition.onend = () => {
      setIsRecording(false);
    };

    recognitionRef.current = recognition;

    return () => {
      recognition.abort();
    };
  }, [isSupported]);

  const startRecording = useCallback(() => {
    if (!isSupported) {
      setError('您的浏览器不支持语音识别（建议使用 Chrome 或 Edge）');
      return;
    }
    try {
      recognitionRef.current?.start();
    } catch {
      // Already started
    }
  }, [isSupported]);

  const stopRecording = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  return { isRecording, isSupported, startRecording, stopRecording, transcript, error };
}
