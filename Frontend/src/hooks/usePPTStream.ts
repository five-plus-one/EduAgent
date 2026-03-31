import { useState, useCallback, useRef } from 'react';
import { streamCoursewareGeneration } from '../utils/api';
import type { PPTPage } from './useCourseware';

export interface PPTTheme {
  name?: string;
  bg_color?: string;
  primary?: string;
  secondary?: string;
  accent?: string;
  text_color?: string;
}

export function usePPTStream(sessionId: string) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamPages, setStreamPages] = useState<PPTPage[]>([]);
  const [streamWordDoc, setStreamWordDoc] = useState('');
  const [streamTheme, setStreamTheme] = useState<PPTTheme | null>(null);
  const [totalHint, setTotalHint] = useState(8);
  const [streamError, setStreamError] = useState<string | null>(null);
  
  const abortControllerRef = useRef<AbortController | null>(null);

  const stopStreaming = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsStreaming(false);
    }
  }, []);

  const applyTheme = (theme: PPTTheme) => {
    const root = document.documentElement;
    if (theme.bg_color) root.style.setProperty('--ppt-bg', theme.bg_color);
    if (theme.primary) root.style.setProperty('--ppt-primary', theme.primary);
    if (theme.secondary) root.style.setProperty('--ppt-secondary', theme.secondary);
    if (theme.accent) root.style.setProperty('--ppt-accent', theme.accent);
    if (theme.text_color) root.style.setProperty('--ppt-text', theme.text_color);
  };

  const startStreaming = useCallback(async (selectedFileIds: string[], mode: 'fast' | 'depth' = 'fast') => {
    if (isStreaming) {
      stopStreaming();
    }
    
    setIsStreaming(true);
    setStreamPages([]);
    setStreamWordDoc('');
    setStreamError(null);
    setStreamTheme(null);
    
    // Clear old theme variables to avoid flickering with old colors
    const root = document.documentElement;
    ['--ppt-bg', '--ppt-primary', '--ppt-secondary', '--ppt-accent', '--ppt-text'].forEach(prop => {
      root.style.removeProperty(prop);
    });
    
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      await streamCoursewareGeneration(
        sessionId,
        selectedFileIds,
        mode,
        {
          onStart: (theme, hint) => {
            setStreamTheme(theme);
            setTotalHint(hint || 8);
            applyTheme(theme);
          },
          onPage: (page) => {
            setStreamPages(prev => {
              // Deduplicate by page_index to handle potential SSE retries/repeats
              const exists = prev.some(p => p.page_index === page.page_index);
              if (exists) {
                return prev.map(p => p.page_index === page.page_index ? page : p);
              }
              const next = [...prev, page];
              return next.sort((a, b) => a.page_index - b.page_index);
            });
          },
          onWordReady: (markdown) => {
            setStreamWordDoc(markdown);
          },
          onDone: () => {
            setIsStreaming(false);
            abortControllerRef.current = null;
          },
          onError: (err: any) => {
            setStreamError(err.message || 'Stream generation failed');
            setIsStreaming(false);
            abortControllerRef.current = null;
          }
        },
        controller.signal
      );
    } catch (e: any) {
      if (e.name === 'AbortError') {
        console.log('[usePPTStream] Stream aborted by user');
      } else {
        setStreamError(e.message || 'Unknown network error during streaming');
      }
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  }, [sessionId, isStreaming, stopStreaming]);

  return { 
    isStreaming, 
    streamPages, 
    streamWordDoc, 
    streamTheme, 
    totalHint, 
    streamError, 
    startStreaming, 
    stopStreaming 
  };
}
