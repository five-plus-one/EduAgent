import { streamCoursewareGeneration } from './api';
import type { PPTTheme } from '../hooks/usePPTStream';
import type { PPTPage } from '../hooks/useCourseware';

export interface PPTStreamState {
  isStreaming: boolean;
  streamPages: PPTPage[];
  streamWordDoc: string;
  streamTheme: PPTTheme | null;
  totalHint: number;
  streamError: string | null;
  streamThinking: string;
}

export type PPTStreamListener = (state: PPTStreamState) => void;

class PPTStreamManagerClass {
  private activeStreams = new Map<string, {
    state: PPTStreamState;
    abortController: AbortController;
  }>();

  private sessionListeners = new Map<string, Set<PPTStreamListener>>();

  public subscribe(sessionId: string, listener: PPTStreamListener): () => void {
    if (!this.sessionListeners.has(sessionId)) {
      this.sessionListeners.set(sessionId, new Set());
    }
    const listeners = this.sessionListeners.get(sessionId)!;
    listeners.add(listener);

    const stream = this.activeStreams.get(sessionId);
    if (stream) {
      listener({ ...stream.state });
    } else {
      listener(this.getEmptyState());
    }

    return () => {
      listeners.delete(listener);
      // Cleanup empty listener sets to prevent memory leak
      if (listeners.size === 0) {
        this.sessionListeners.delete(sessionId);
      }
    };
  }

  private notify(sessionId: string, streamState: PPTStreamState) {
    const listeners = this.sessionListeners.get(sessionId);
    if (listeners) {
      const stateCopy = { ...streamState };
      listeners.forEach(l => l(stateCopy));
    }
  }

  private getEmptyState(): PPTStreamState {
    return {
      isStreaming: false,
      streamPages: [],
      streamWordDoc: '',
      streamTheme: null,
      totalHint: 8,
      streamError: null,
      streamThinking: '',
    };
  }

  public stopStream(sessionId: string) {
    const stream = this.activeStreams.get(sessionId);
    if (stream) {
      if (!stream.abortController.signal.aborted) {
        stream.abortController.abort();
      }
      stream.state.isStreaming = false;
      this.notify(sessionId, stream.state);
      this.activeStreams.delete(sessionId);
    }
  }

  /** Reset stream state for a session — called on session switch to avoid stale pages */
  public clearStreamState(sessionId: string) {
    this.activeStreams.delete(sessionId);
    this.clearTheme(); // FIX: Prevent theme leaking across session switch
    this.notify(sessionId, this.getEmptyState());
  }

  public applyTheme(theme: PPTTheme) {
    const root = document.documentElement;
    if (theme.bg_color) root.style.setProperty('--ppt-bg', theme.bg_color);
    if (theme.primary) root.style.setProperty('--ppt-primary', theme.primary);
    if (theme.secondary) root.style.setProperty('--ppt-secondary', theme.secondary);
    if (theme.accent) root.style.setProperty('--ppt-accent', theme.accent);
    if (theme.text_color) root.style.setProperty('--ppt-text', theme.text_color);
  }

  public clearTheme() {
    const root = document.documentElement;
    ['--ppt-bg', '--ppt-primary', '--ppt-secondary', '--ppt-accent', '--ppt-text'].forEach(prop => {
      root.style.removeProperty(prop);
    });
  }

  public async startStream(sessionId: string, selectedFileIds: string[], mode: 'fast' | 'depth' = 'fast') {
    if (this.activeStreams.has(sessionId)) {
      this.stopStream(sessionId);
    }

    this.clearTheme();

    const controller = new AbortController();
    const state = this.getEmptyState();
    state.isStreaming = true;

    this.activeStreams.set(sessionId, { state, abortController: controller });
    this.notify(sessionId, state);

    try {
      await streamCoursewareGeneration(
        sessionId,
        selectedFileIds,
        mode,
        {
          onStart: (theme, hint) => {
            state.streamTheme = theme;
            state.totalHint = hint || 8;
            this.applyTheme(theme);
            this.notify(sessionId, state);
          },
          onPage: (page) => {
            const exists = state.streamPages.some(p => p.page_index === page.page_index);
            if (exists) {
              state.streamPages = state.streamPages.map(p => p.page_index === page.page_index ? page : p);
            } else {
              state.streamPages.push(page);
              state.streamPages.sort((a, b) => a.page_index - b.page_index);
            }
            this.notify(sessionId, state);
          },
          onWordReady: (markdown) => {
            state.streamWordDoc = markdown;
            this.notify(sessionId, state);
          },
          onThinking: (chunk: string) => {
            state.streamThinking += chunk;
            this.notify(sessionId, state);
          },
          onDone: () => {
            state.isStreaming = false;
            
            // Defensive Fallback: Save to localStorage so frontend can recover PPT
            // if backend strictly denies the fetch due to minor LLM schema errors
            try {
              localStorage.setItem(`eduagent_ppt_fallback_${sessionId}`, JSON.stringify({
                pages: state.streamPages,
                wordDoc: state.streamWordDoc,
                theme: state.streamTheme,
                timestamp: Date.now()
              }));
            } catch (e) {}
            
            this.notify(sessionId, state);
            this.activeStreams.delete(sessionId);
            // Fire full completion event to let UI fetch final data from DB
            window.dispatchEvent(new CustomEvent('EduAgent_Refetch_PPT', { detail: { sessionId } }));
            
            // 阿里味底层抓手：彻底斩断 fetch-event-source 的底层静默重连死循环
            controller.abort();
          },
          onError: (err: any) => {
            state.streamError = err.message || 'Stream generation failed';
            state.isStreaming = false;
            this.notify(sessionId, state);
            this.activeStreams.delete(sessionId);
          }
        },
        controller.signal
      );
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        state.streamError = e.message || 'Unknown network error during streaming';
      }
      state.isStreaming = false;
      this.notify(sessionId, state);
      this.activeStreams.delete(sessionId);
    }
  }
}

export const GlobalPPTStreamManager = new PPTStreamManagerClass();
