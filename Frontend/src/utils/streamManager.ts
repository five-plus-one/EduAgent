import { streamChatCompletion } from './api';

export interface StreamState {
  aiMsgId: string;
  content: string;
  toolLog: string;
  thinking: string;
  isThinking: boolean;
  isSynthesizing: boolean;
  latestIntent: string | null;
  /** 游戏类型建议（来自 game_suggest 事件）*/
  gameSuggest: import('./gamesApi').GameSuggestData | null;
  /** 游戏生成触发规格（来自 game_trigger 事件）*/
  gameTrigger: import('./gamesApi').GameSpec | null;
}

export type StreamListener = (state: StreamState | null) => void;

class StreamManagerClass {
  private activeStreams = new Map<string, {
    state: StreamState;
    buffer: string;
    mode: 'text' | 'think' | 'tool';
    abortController: AbortController;
  }>();

  private sessionListeners = new Map<string, Set<StreamListener>>();
  private messageToolLogs = new Map<string, string>();

  public getMessageToolLog(messageId: string): string {
    return this.messageToolLogs.get(messageId) || '';
  }

  public subscribe(sessionId: string, listener: StreamListener): () => void {
    if (!this.sessionListeners.has(sessionId)) {
      this.sessionListeners.set(sessionId, new Set());
    }
    const listeners = this.sessionListeners.get(sessionId)!;
    listeners.add(listener);
    
    const stream = this.activeStreams.get(sessionId);
    if (stream) {
      console.log(`[StreamManager] Syncing subscriber with active stream ${sessionId}`);
      listener(this.cloneState(stream.state));
    } else {
      listener(null);
    }
    
    return () => {
      listeners.delete(listener);
    };
  }


  private cloneState(state: StreamState): StreamState {
    return JSON.parse(JSON.stringify(state));
  }

  public stopStream(sessionId: string) {
    const stream = this.activeStreams.get(sessionId);
    if (stream) {
      stream.abortController.abort();
      stream.state.isSynthesizing = false;
      this.notify(sessionId, stream);
      this.activeStreams.delete(sessionId);
    }
  }

  public getStream(sessionId: string): StreamState | undefined {
    return this.activeStreams.get(sessionId)?.state;
  }

  private notify(sessionId: string, stream: any) {
    const listeners = this.sessionListeners.get(sessionId);
    if (listeners) {
      const stateCopy = this.cloneState(stream.state);
      listeners.forEach((l: StreamListener) => l(stateCopy));
    }
  }

  private shouldRefetchForTool(toolName: string): boolean {
    const name = (toolName || "").toLowerCase();
    return /generate|slide|page|update|edit|insert|delete/.test(name);
  }

  /**
   * P8 Scrubber 9.0 (Full Transparency Protocol)
   * Guaranteed content propagation even during mode transitions.
   */
  private processTextChunk(stream: any, chunk: string) {
    stream.buffer += chunk;
    console.log(`[Scrubber9] Mode: ${stream.mode}, Buffer: ${stream.buffer.length}`);

    // High-agency loop: process as many tags as we find
    let changed = true;
    while (changed) {
      changed = false;
      
      if (stream.mode === 'text') {
        const thinkIdx = stream.buffer.indexOf('<think>');
        const toolIdx = stream.buffer.search(/<(seed:)?tool_call[^>]*>/);
        
        let startIdx = -1;
        let tagLen = 0;
        let nextMode: 'think' | 'tool' | null = null;

        if (thinkIdx !== -1 && (toolIdx === -1 || thinkIdx < toolIdx)) {
          startIdx = thinkIdx;
          tagLen = 7;
          nextMode = 'think';
        } else if (toolIdx !== -1) {
          const match = stream.buffer.match(/<(seed:)?tool_call[^>]*>/);
          if (match) {
            startIdx = toolIdx;
            tagLen = match[0].length;
            nextMode = 'tool';
          }
        }

        if (nextMode && startIdx !== -1) {
          // Flush conversational text BEFORE the tag
          stream.state.content += stream.buffer.slice(0, startIdx);
          stream.buffer = stream.buffer.slice(startIdx + tagLen);
          stream.mode = nextMode;
          if (nextMode === 'think') stream.state.isThinking = true;
          changed = true;
        } else {
          // Normal conversational text. 
          // We hold the buffer ONLY if it ends with a partial tag start (max 15 chars)
          const lastBracket = stream.buffer.lastIndexOf('<');
          if (lastBracket !== -1 && stream.buffer.length - lastBracket < 15) {
            stream.state.content += stream.buffer.slice(0, lastBracket);
            stream.buffer = stream.buffer.slice(lastBracket);
          } else {
            stream.state.content += stream.buffer;
            stream.buffer = '';
          }
        }
      } else if (stream.mode === 'think') {
        const endIdx = stream.buffer.indexOf('</think>');
        if (endIdx !== -1) {
          stream.state.thinking += stream.buffer.slice(0, endIdx);
          stream.buffer = stream.buffer.slice(endIdx + 8);
          stream.mode = 'text';
          stream.state.isThinking = false;
          changed = true;
        } else {
          // Incrementally flush thinking process to UI
          stream.state.thinking += stream.buffer;
          stream.buffer = '';
        }
      } else if (stream.mode === 'tool') {
        const endIdx = stream.buffer.search(/<\/(seed:)?tool_call>/);
        if (endIdx !== -1) {
          const match = stream.buffer.match(/<\/(seed:)?tool_call>/);
          if (match) {
            stream.buffer = stream.buffer.slice(endIdx + match[0].length);
            stream.mode = 'text';
            changed = true;
          }
        } else {
          // In tool mode, we don't dump JSON to UI, but we don't block.
          // The buffer grows until closing tag or is cleared at end of stream.
          if (stream.buffer.length > 5000) stream.buffer = ''; // Safety valve
          break;
        }
      }
    }
  }

  public async startStream(sessionId: string, userContent: string) {
    if (this.activeStreams.has(sessionId)) return;

    const controller = new AbortController();
    const streamData = {
      state: {
        aiMsgId: Math.random().toString(36).substring(2, 11),
        content: '',
        toolLog: '',
        thinking: '',
        isThinking: false,
        isSynthesizing: true,
        latestIntent: null,
        gameSuggest: null,
        gameTrigger: null,
      },
      buffer: '',
      mode: 'text' as 'text' | 'think' | 'tool',
      abortController: controller,
    };
    
    this.activeStreams.set(sessionId, streamData);
    this.notify(sessionId, streamData);

    let lastToolName = '';
    let refetchDispatched = false;

    try {
      await streamChatCompletion(
        sessionId,
        userContent,
        (chunk, isFinished, intent) => {
        if (intent && typeof intent === 'string') {
          (streamData.state as any).latestIntent = intent;
        }
          if (chunk) this.processTextChunk(streamData, chunk);

          if (isFinished) {
            // End of stream cleanup
            if (streamData.buffer && streamData.mode === 'text') {
              streamData.state.content += streamData.buffer;
            } else if (streamData.buffer && streamData.mode === 'think') {
              streamData.state.thinking += streamData.buffer;
            }
            streamData.buffer = '';
            streamData.state.isSynthesizing = false;
            streamData.state.isThinking = false;
            
            // Save tool logs for persistence within current component lifecycle
            if (streamData.state.toolLog) {
                this.messageToolLogs.set(streamData.state.aiMsgId, streamData.state.toolLog);
            }
            
            if (!refetchDispatched && this.shouldRefetchForTool(lastToolName)) {
              window.dispatchEvent(new CustomEvent('EduAgent_Refetch_PPT', { detail: { sessionId } }));
            }
          }
          this.notify(sessionId, streamData);
          if (isFinished) this.activeStreams.delete(sessionId);
        },
        (err) => {
          console.error('[StreamManager] Error:', err);
          streamData.state.isSynthesizing = false;
          this.notify(sessionId, streamData);
          this.activeStreams.delete(sessionId);
        },
        controller.signal,
        {
          onThinking: (chunk) => {
            streamData.state.isThinking = true;
            streamData.state.thinking += chunk;
            this.notify(sessionId, streamData);
          },
          onToolCall: (tool) => {
            lastToolName = tool.tool_name;
            // Only trigger full-screen loading for the heavy generation tool
            const isFullGen = tool.tool_name.toLowerCase().includes('generatefullppt');
            if (isFullGen) {
              // Instead of waiting and polling, we actively trigger the streaming process from the frontend
              window.dispatchEvent(new CustomEvent('EduAgent_Start_Streaming', { detail: { sessionId, mode: 'depth' } }));
            }
            streamData.state.toolLog += `\n> 🤖 *正在执行操作: \`${tool.tool_name}\`...*\n`;
            this.notify(sessionId, streamData);
          },
          onToolResult: (result: any) => {
            // Determine if we should treat this as a full generation (Heavy) or silent update (Light)
            // Fallback to legacy regex if result doesn't provide the explicit flags
            const isFullGen = result.trigger_full_generation ?? this.shouldRefetchForTool(lastToolName);

            if (isFullGen) {
              // The generation is handled by the streaming UI now. We don't need to refetch and poll.
              // Just mark the tool as success.
            } else if (result.should_refetch_ppt) {
              // Light operation: Silent refresh, influenced card should show shimmer
              window.dispatchEvent(new CustomEvent('EduAgent_Slide_Updated', { 
                detail: { sessionId, actualPageIndex: result.actual_page_index } 
              }));
            }

            window.dispatchEvent(new CustomEvent('EduAgent_Generate_End', { detail: { sessionId } }));
            const icon = result.status === 'success' ? '✅' : '❌';
            streamData.state.toolLog += `> ${icon} *操作已完成*\n\n`;
            this.notify(sessionId, streamData);
          },
          onGameEvent: (eventType, data) => {
            if (eventType === 'game_suggest') {
              streamData.state.gameSuggest = data.game_suggest ?? null;
              this.notify(sessionId, streamData);
              window.dispatchEvent(new CustomEvent('EduAgent_Game_Suggest', {
                detail: { sessionId, data: data.game_suggest }
              }));
            } else if (eventType === 'game_trigger') {
              const spec = data.game_trigger ?? data;
              streamData.state.gameTrigger = spec;
              this.notify(sessionId, streamData);
              window.dispatchEvent(new CustomEvent('EduAgent_Game_Trigger', {
                detail: { sessionId, spec }
              }));
            }
          },
        }
      );
    } catch (e) {
      this.activeStreams.delete(sessionId);
    }
  }
}

export const GlobalStreamManager = new StreamManagerClass();
