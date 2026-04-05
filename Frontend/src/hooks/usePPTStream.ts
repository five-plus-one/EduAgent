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
    
    // We deliberately do NOT call clearStreamState here, 
    // because if a stream is running in the background for this session, 
    // we want to securely resume and reattach to it when the user switches back.

    const unsubscribe = GlobalPPTStreamManager.subscribe(sessionId, (state) => {
      setStreamState(state);
    });

    return () => {
      unsubscribe();
    };
  }, [sessionId]);

  const startStreaming = useCallback(async (selectedFileIds: string[], mode: 'fast' | 'depth' = 'fast', force = false) => {
    if (sessionId === 'new') return;
    await GlobalPPTStreamManager.startStream(sessionId, selectedFileIds, mode, force);
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
