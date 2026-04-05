import { streamCoursewareGeneration } from './api';
import type { PPTTheme } from '../hooks/usePPTStream';
import type { PPTPage } from '../hooks/useCourseware';

// -------------------------------------------------------------
// P8 兜底：反大模型弱智色系降级处理器 (Luminance Contrast Safety) + Theme Factory
// -------------------------------------------------------------
export const PREMIUM_THEMES = {
  modern_minimalist: { bg_color: '#F8FAFC', primary: '#0F172A', secondary: '#64748B', accent: '#3B82F6', text_color: '#1E293B' },
  sunset_boulevard: { bg_color: '#FFF7F0', primary: '#EA580C', secondary: '#FB923C', accent: '#FACC15', text_color: '#431407' },
  golden_hour: { bg_color: '#FEF3C7', primary: '#B45309', secondary: '#D97706', accent: '#F59E0B', text_color: '#451A03' },
  forest_canopy: { bg_color: '#F0FDF4', primary: '#15803D', secondary: '#166534', accent: '#22C55E', text_color: '#14532D' },
  desert_rose: { bg_color: '#FFF1F2', primary: '#BE123C', secondary: '#E11D48', accent: '#F43F5E', text_color: '#4C0519' },
  arctic_frost: { bg_color: '#F0F9FF', primary: '#0369A1', secondary: '#0284C7', accent: '#38BDF8', text_color: '#082F49' },
  
  ocean_depths: { bg_color: '#0B192C', primary: '#38BDF8', secondary: '#94A3B8', accent: '#10B981', text_color: '#F8FAFC' },
  cyber_neon: { bg_color: '#09090B', primary: '#A855F7', secondary: '#EC4899', accent: '#06B6D4', text_color: '#F1F5F9' },
  midnight_galaxy: { bg_color: '#020617', primary: '#6366F1', secondary: '#4F46E5', accent: '#818CF8', text_color: '#F8FAFC' },
  botanical_garden: { bg_color: '#064E3B', primary: '#A7F3D0', secondary: '#34D399', accent: '#10B981', text_color: '#F0FDF4' }
};

export const simpleHash = (s: string) => {
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash += s.charCodeAt(i);
  return hash;
};

export const getLuminance = (hex: string) => {
  hex = String(hex).replace('#', '').trim();
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  if (hex.length !== 6) return 1; // Default to light if invalid
  const rgb = parseInt(hex, 16);
  const r = (rgb >> 16) & 0xff;
  const g = (rgb >>  8) & 0xff;
  const b = (rgb >>  0) & 0xff;
  // Perceptual luminance formula
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
};

export const safeApplyTheme = (sessionId: string, theme: PPTTheme) => {
  const root = document.documentElement;
  
  // 1. Determine LLM's raw intent (light or dark)
  let rawBg = theme.bg_color ? String(theme.bg_color).toLowerCase() : '#ffffff';
  let isLight = true;
  if (rawBg.includes('black') || rawBg.includes('dark')) isLight = false;
  else if (rawBg.includes('white') || rawBg.includes('light')) isLight = true;
  else isLight = getLuminance(rawBg) > 0.5;
  
  // 2. Map to Premium Themes deterministically via Session ID
  const lightThemes = [
    PREMIUM_THEMES.modern_minimalist, PREMIUM_THEMES.sunset_boulevard, 
    PREMIUM_THEMES.golden_hour, PREMIUM_THEMES.forest_canopy, 
    PREMIUM_THEMES.desert_rose, PREMIUM_THEMES.arctic_frost
  ];
  const darkThemes = [
    PREMIUM_THEMES.ocean_depths, PREMIUM_THEMES.cyber_neon, 
    PREMIUM_THEMES.midnight_galaxy, PREMIUM_THEMES.botanical_garden
  ];
  
  const hashVal = sessionId ? simpleHash(sessionId) : 0;
  const selectedTheme = isLight 
    ? lightThemes[hashVal % lightThemes.length] 
    : darkThemes[hashVal % darkThemes.length];

  // 3. Force apply the premium colors, ignoring AI's garbage completely
  root.style.setProperty('--ppt-bg', selectedTheme.bg_color);
  root.style.setProperty('--ppt-text', selectedTheme.text_color);
  root.style.setProperty('--ppt-primary', selectedTheme.primary);
  root.style.setProperty('--ppt-secondary', selectedTheme.secondary);
  root.style.setProperty('--ppt-accent', selectedTheme.accent);
  
  // 4. Apply adaptive glassmorphism variables to prevent unreadable text on dark themes
  root.style.setProperty('--ppt-glass-bg', isLight ? 'rgba(255, 255, 255, 0.4)' : 'rgba(0, 0, 0, 0.3)');
  root.style.setProperty('--ppt-glass-border', isLight ? 'rgba(255, 255, 255, 0.6)' : 'rgba(255, 255, 255, 0.1)');
};
// -------------------------------------------------------------

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
  // Prevent duplicate re-trigger within 10s of last successful generation
  private lastCompletionTime = new Map<string, number>();
  // Throttle counter for thinking chunks per session
  private _thinkCounter = new Map<string, number>();

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

  // P8 兜底：实时高频将流落盘持久化，对抗中途 F5 刷新和异常退出的终极防御
  private saveFallback(sessionId: string, state: PPTStreamState) {
    try {
      localStorage.setItem(`eduagent_ppt_fallback_${sessionId}`, JSON.stringify({
        pages: state.streamPages,
        wordDoc: state.streamWordDoc,
        theme: state.streamTheme,
        timestamp: Date.now()
      }));
    } catch (e) {}
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

  public applyTheme(sessionId: string, theme: PPTTheme) {
    safeApplyTheme(sessionId, theme);
  }

  public clearTheme() {
    const root = document.documentElement;
    ['--ppt-bg', '--ppt-primary', '--ppt-secondary', '--ppt-accent', '--ppt-text'].forEach(prop => {
      root.style.removeProperty(prop);
    });
  }

  public async startStream(sessionId: string, selectedFileIds: string[], mode: 'fast' | 'depth' = 'fast', force = false) {
    // Guard: block re-trigger within 10 seconds of last successful completion (unless forced)
    if (!force) {
      const lastDone = this.lastCompletionTime.get(sessionId) ?? 0;
      if (Date.now() - lastDone < 10000) {
        console.warn(`[PPTStream] Blocking duplicate startStream for ${sessionId} — last completed ${Date.now() - lastDone}ms ago. Use force=true to override.`);
        return;
      }
    }

    if (this.activeStreams.has(sessionId)) {
      // Only interrupt an existing stream when the caller explicitly forces it.
      // Non-forced calls (e.g. auto-triggers from useEffect) must NOT kill an
      // in-progress generation — that's what causes the "stuck after page 1" bug.
      if (!force) {
        console.warn(`[PPTStream] startStream ignored — already streaming for ${sessionId}. Pass force=true to restart.`);
        return;
      }
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
            this.applyTheme(sessionId, theme);
            this.notify(sessionId, state);
            this.saveFallback(sessionId, state);
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
            // 实时写盘：绝不在 onDone 才收割，只要生了一页就强制保存一页
            this.saveFallback(sessionId, state);
          },
          onWordReady: (markdown) => {
            state.streamWordDoc = markdown;
            this.notify(sessionId, state);
            this.saveFallback(sessionId, state);
          },
          onThinking: (chunk: string) => {
            state.streamThinking += chunk;
            // Throttle: notify every 6 chunks to avoid flooding React with re-renders
            const n = (this._thinkCounter.get(sessionId) ?? 0) + 1;
            this._thinkCounter.set(sessionId, n);
            if (n % 6 === 0) this.notify(sessionId, state);
          },
          onDone: () => {
            state.isStreaming = false;
            this.lastCompletionTime.set(sessionId, Date.now()); // record for cooldown guard
            
            // Final backup
            this.saveFallback(sessionId, state);
            
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
