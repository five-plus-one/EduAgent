import { streamChatCompletion } from './api';

export interface StreamState {
  aiMsgId: string;
  content: string;
  thinking: string;       // DeepSeek-style reasoning content
  isThinking: boolean;    // true while <think> block is open
  isSynthesizing: boolean;
  latestIntent: string | null;
}

export type StreamListener = (state: StreamState | null) => void;

class StreamManagerClass {
  private activeStreams = new Map<string, {
    state: StreamState;
    abortController: AbortController;
  }>();

  private sessionListeners = new Map<string, Set<StreamListener>>();

  /**
   * Components subscribe here to receive background updates.
   */
  public subscribe(sessionId: string, listener: StreamListener): () => void {
    if (!this.sessionListeners.has(sessionId)) {
      this.sessionListeners.set(sessionId, new Set());
    }
    this.sessionListeners.get(sessionId)!.add(listener);

    const stream = this.activeStreams.get(sessionId);
    if (stream) {
      listener({ ...stream.state });
    } else {
      listener(null);
    }
    return () => this.unsubscribe(sessionId, listener);
  }

  private unsubscribe(sessionId: string, listener: StreamListener) {
    this.sessionListeners.get(sessionId)?.delete(listener);
  }

  /**
   * Only used if you genuinely want to kill a generating stream.
   */
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
    this.sessionListeners.get(sessionId)?.forEach((l: StreamListener) => l({ ...stream.state }));
  }

  /**
   * Dispatches the underlying API request via SSE. The StreamManager holds the connection.
   */
  public async startStream(sessionId: string, userContent: string) {
    if (this.activeStreams.has(sessionId)) return;

    const controller = new AbortController();
    const streamData: {
      state: StreamState;
      abortController: AbortController;
    } = {
      state: {
        aiMsgId: Math.random().toString(36).substring(2, 11),
        content: '',
        thinking: '',
        isThinking: false,
        isSynthesizing: true,
        latestIntent: null,
      },
      abortController: controller,
    };
    
    this.activeStreams.set(sessionId, streamData);
    this.notify(sessionId, streamData); // Will immediately trigger updates on any active listeners

    let lastToolName = '';

    try {
      await streamChatCompletion(
        sessionId,
        userContent,
        (chunk, isFinished, intent) => {
          if (intent && typeof intent === 'string') {
            streamData.state.latestIntent = intent;
          }

          // --- Thinking block parser (handles <think>...</think> or event_type="thinking") ---
          let remaining = chunk;
          while (remaining.length > 0) {
            if (streamData.state.isThinking) {
              const closeIdx = remaining.indexOf('</think>');
              if (closeIdx !== -1) {
                streamData.state.thinking += remaining.slice(0, closeIdx);
                streamData.state.isThinking = false;
                remaining = remaining.slice(closeIdx + 8);
              } else {
                streamData.state.thinking += remaining;
                remaining = '';
              }
            } else {
              const openIdx = remaining.indexOf('<think>');
              if (openIdx !== -1) {
                // Text before <think> goes to content
                streamData.state.content += remaining.slice(0, openIdx);
                streamData.state.isThinking = true;
                remaining = remaining.slice(openIdx + 7);
              } else {
                streamData.state.content += remaining;
                remaining = '';
              }
            }
          }

          if (isFinished) {
            streamData.state.isSynthesizing = false;
            streamData.state.isThinking = false;
            if (lastToolName.toLowerCase().includes('generate')) {
              console.log('[StreamManager] Stream finished with a generate tool — fallback PPT refetch');
              window.dispatchEvent(new CustomEvent('EduAgent_Refetch_PPT', { detail: { sessionId } }));
            }
          }
          
          this.notify(sessionId, streamData);
          
          if (isFinished) {
            this.activeStreams.delete(sessionId);
          }
        },
        (_err) => {
          if (!controller.signal.aborted) {
            streamData.state.isSynthesizing = false;
            streamData.state.content += '\n⚠️ 发生连接错误或由于页面断开中止请求。';
            this.notify(sessionId, streamData);
            this.activeStreams.delete(sessionId);
          }
        },
        controller.signal,
        {
          onThinking: (chunk) => {
            streamData.state.thinking += chunk;
            this.notify(sessionId, streamData);
          },
          onToolCall: (tool) => {
            lastToolName = tool.tool_name;
            const isGenerateTool = tool.tool_name.toLowerCase().includes('generate');
            if (isGenerateTool) {
               window.dispatchEvent(new CustomEvent('EduAgent_Generate_Start', { detail: { sessionId } }));
            }
            
            const msg = `\n\n> 🤖 *正在执行操作: \`${tool.tool_name}\`...*\n\n`;
            if (!streamData.state.content.includes(msg.trim())) {
              streamData.state.content += msg;
              this.notify(sessionId, streamData);
            }
          },
          onToolResult: (result) => {
            // Always dispatch End so UI unlocks
            window.dispatchEvent(new CustomEvent('EduAgent_Generate_End', { detail: { sessionId } }));

            // Refetch if: backend explicitly says so OR the tool was any generate-type 
            const isGenerateTool = lastToolName.toLowerCase().includes('generate');
            const shouldRefetch = result.should_refetch_ppt === true || isGenerateTool;

            if (shouldRefetch) {
               console.log(`[StreamManager] Tool "${lastToolName}" completed → triggering PPT refetch`);
               window.dispatchEvent(new CustomEvent('EduAgent_Refetch_PPT', { detail: { sessionId } }));
            }
            streamData.state.content += `> ✨ *操作已完成*\n\n`;
            this.notify(sessionId, streamData);
          }
        }
      );
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      streamData.state.isSynthesizing = false;
      streamData.state.content += '\n⚠️ 网络请求遇到问题，会话已终止。';
      this.notify(sessionId, streamData);
      this.activeStreams.delete(sessionId);
    }
  }
}

export const GlobalStreamManager = new StreamManagerClass();
