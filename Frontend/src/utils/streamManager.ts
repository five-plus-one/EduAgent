import { streamChatCompletion } from './api';

export interface StreamState {
  aiMsgId: string;
  content: string;
  toolLog: string;        // Tool call markers
  thinking: string;
  isThinking: boolean;
  isSynthesizing: boolean;
  latestIntent: string | null;
}

export type StreamListener = (state: StreamState | null) => void;

class StreamManagerClass {
  private activeStreams = new Map<string, {
    state: StreamState;
    inThinking: boolean;
    inToolCall: boolean;
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
    this.sessionListeners.get(sessionId)!.add(listener);
    const stream = this.activeStreams.get(sessionId);
    if (stream) listener({ ...stream.state });
    else listener(null);
    return () => this.unsubscribe(sessionId, listener);
  }

  private unsubscribe(sessionId: string, listener: StreamListener) {
    this.sessionListeners.get(sessionId)?.delete(listener);
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
    this.sessionListeners.get(sessionId)?.forEach((l: StreamListener) => l({ ...stream.state }));
  }

  private shouldRefetchForTool(toolName: string): boolean {
    const name = (toolName || "").toLowerCase();
    return /generate|slide|page|update|edit|insert|delete/.test(name);
  }

  /**
   * P8 Real-Time Streaming Scrubber (Scrubber 4.0)
   * Prevents content washout by handling partial tag states across chunks.
   * Immediately streams tag-wrapped content to the right fields.
   */
  private processTextChunk(stream: any, newChunk: string) {
    let remaining = newChunk;
    
    while (remaining.length > 0) {
      if (stream.inThinking) {
        const closeIdx = remaining.indexOf('</think>');
        if (closeIdx !== -1) {
          stream.state.thinking += remaining.slice(0, closeIdx);
          stream.inThinking = false;
          stream.state.isThinking = false;
          remaining = remaining.slice(closeIdx + 8);
        } else {
          stream.state.thinking += remaining;
          remaining = '';
        }
      } else if (stream.inToolCall) {
        const closeIdx = remaining.search(/<\/(seed:)?tool_call>/);
        if (closeIdx !== -1) {
          // Monologues/Seed logic captured but hidden from main bubble
          stream.inToolCall = false;
          remaining = remaining.slice(remaining.indexOf('>', closeIdx) + 1);
        } else {
          remaining = '';
        }
      } else {
        const thinkOpenIdx = remaining.indexOf('<think>');
        const toolOpenIdx = remaining.search(/<(seed:)?tool_call[^>]*>/);
        
        // Find the earliest starting tag
        const finders = [
          { idx: thinkOpenIdx, tag: '<think>', set: () => { stream.inThinking = true; stream.state.isThinking = true; } },
          { idx: toolOpenIdx, tag: remaining.match(/<(seed:)?tool_call[^>]*>/)?.[0] || '', set: () => { stream.inToolCall = true; } }
        ].filter(f => f.idx !== -1).sort((a, b) => a.idx - b.idx);

        if (finders.length > 0) {
          const first = finders[0];
          stream.state.content += remaining.slice(0, first.idx);
          first.set();
          remaining = remaining.slice(first.idx + first.tag.length);
        } else {
          // No unclosed tags in this chunk
          stream.state.content += remaining;
          remaining = '';
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
      },
      inThinking: false,
      inToolCall: false,
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
          if (intent && typeof intent === 'string') streamData.state.latestIntent = intent;
          if (chunk) this.processTextChunk(streamData, chunk);

          if (isFinished) {
            streamData.state.isSynthesizing = false;
            streamData.state.isThinking = false;
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
        (_err) => {
          streamData.state.isSynthesizing = false;
          this.notify(sessionId, streamData);
          this.activeStreams.delete(sessionId);
        },
        controller.signal,
        {
          onThinking: (chunk) => {
            streamData.state.thinking += chunk;
            this.notify(sessionId, streamData);
          },
          onToolCall: (tool) => {
            lastToolName = tool.tool_name;
            if (this.shouldRefetchForTool(tool.tool_name)) {
              window.dispatchEvent(new CustomEvent('EduAgent_Generate_Start', { detail: { sessionId } }));
            }
            streamData.state.toolLog += `\n> 🤖 *正在执行操作: \`${tool.tool_name}\`...*\n`;
            this.notify(sessionId, streamData);
          },
          onToolResult: (result) => {
            window.dispatchEvent(new CustomEvent('EduAgent_Generate_End', { detail: { sessionId } }));
            if (result.should_refetch_ppt || this.shouldRefetchForTool(lastToolName)) {
              refetchDispatched = true;
              window.dispatchEvent(new CustomEvent('EduAgent_Refetch_PPT', { detail: { sessionId } }));
            }
            const icon = result.status === 'success' ? '✅' : '❌';
            streamData.state.toolLog += `> ${icon} *操作已完成*\n\n`;
            this.notify(sessionId, streamData);
          }
        }
      );
    } catch (e) {
      this.activeStreams.delete(sessionId);
    }
  }
}

export const GlobalStreamManager = new StreamManagerClass();
