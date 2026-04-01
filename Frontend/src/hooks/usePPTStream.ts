import { useEffect, useState, useCallback } from 'react';
import { GlobalPPTStreamManager, type PPTStreamState } from '../utils/pptStreamManager';

export interface PPTTheme {
  name?: string;
  bg_color?: string;
  primary?: string;
  secondary?: string;
  accent?: string;
  text_color?: string;
}

export function usePPTStream(sessionId: string) {
  const [streamState, setStreamState] = useState<PPTStreamState>({
    isStreaming: false,
    streamPages: [],
    streamWordDoc: '',
    streamTheme: null,
    totalHint: 8,
    streamError: null,
    streamThinking: '',
  });

  useEffect(() => {
    if (!sessionId || sessionId === 'new') return;
    
    // Clear stale stream state from any previous session immediately
    GlobalPPTStreamManager.clearStreamState(sessionId);

    const unsubscribe = GlobalPPTStreamManager.subscribe(sessionId, (state) => {
      setStreamState(state);
    });

    return () => {
      unsubscribe();
    };
  }, [sessionId]);

  const startStreaming = useCallback(async (selectedFileIds: string[], mode: 'fast' | 'depth' = 'fast') => {
    if (sessionId === 'new') return;
    await GlobalPPTStreamManager.startStream(sessionId, selectedFileIds, mode);
  }, [sessionId]);

  const stopStreaming = useCallback(() => {
    if (sessionId === 'new') return;
    GlobalPPTStreamManager.stopStream(sessionId);
  }, [sessionId]);

  return {
    isStreaming: streamState.isStreaming,
    streamPages: streamState.streamPages,
    streamWordDoc: streamState.streamWordDoc,
    streamTheme: streamState.streamTheme,
    totalHint: streamState.totalHint,
    streamError: streamState.streamError,
    streamThinking: streamState.streamThinking,
    startStreaming,
    stopStreaming
  };
}
