import { streamChatCompletion } from './api';

export interface StreamState {
  aiMsgId: string;
  content: string;
  toolLog: string;
  thinking: string;
  isThinking: boolean;
  isSynthesizing: boolean;
  latestIntent: string | null;
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
    this.sessionListeners.get(sessionId)!.add(listener);
    const stream = this.activeStreams.get(sessionId);
    if (stream) listener({ ...stream.state });
    else listener(null);
    return () => this.unsubscribe(sessionId, listener);
  }

  private unsubscribe(sessionId: string, listener: Set<StreamListener> | string | any) {
    if (typeof listener === 'string') {
        this.sessionListeners.get(listener)?.clear();
        return;
    }
    // Standard cleanup logic
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
      listeners.forEach((l: StreamListener) => l({ ...stream.state }));
    }
  }

  private shouldRefetchForTool(toolName: string): boolean {
    const name = (toolName || "").toLowerCase();
    return /generate|slide|page|update|edit|insert|delete/.test(name);
  }

  /**
   * P8 Stream Scrubber (Incremental State Machine)
   * Prevents buffer stalls by processing content character-by-character or via tag markers.
   */
  private processTextChunk(stream: any, chunk: string) {
    stream.buffer += chunk;
    
    let changed = true;
    while (changed) {
      changed = false;
      
      if (stream.mode === 'text') {
        const startThink = stream.buffer.indexOf('<think>');
        const startTool = stream.buffer.search(/<(seed:)?tool_call[^>]*>/);
        
        // Find whichever tag comes first
        const indices = [];
        if (startThink !== -1) indices.push({ type: 'think', idx: startThink, len: 7 });
        if (startTool !== -1) {
            const match = stream.buffer.match(/<(seed:)?tool_call[^>]*>/);
            if (match) indices.push({ type: 'tool', idx: startTool, len: match[0].length });
        }
        indices.sort((a, b) => a.idx - b.idx);

        if (indices.length > 0) {
          const first = indices[0];
          // Flush content before the tag
          stream.state.content += stream.buffer.slice(0, first.idx);
          stream.buffer = stream.buffer.slice(first.idx + first.len);
          stream.mode = first.type;
          if (first.type === 'think') stream.state.isThinking = true;
          changed = true;
        } else {
          // No tag starts in current buffer, but wait... 
          // What if there is a partial '<' at the very end?
          const lastBracket = stream.buffer.lastIndexOf('<');
          if (lastBracket !== -1 && lastBracket > stream.buffer.length - 10) {
            // Potential partial tag at end, flush up to it
            stream.state.content += stream.buffer.slice(0, lastBracket);
            stream.buffer = stream.buffer.slice(lastBracket);
          } else {
            // Safe to flush all
            stream.state.content += stream.buffer;
            stream.buffer = '';
          }
        }
      } else if (stream.mode === 'think') {
        const endThink = stream.buffer.indexOf('</think>');
        if (endThink !== -1) {
          stream.state.thinking += stream.buffer.slice(0, endThink);
          stream.buffer = stream.buffer.slice(endThink + 8);
          stream.mode = 'text';
          stream.state.isThinking = false;
          changed = true;
        } else {
          // Still thinking, flush buffer to thinking field
          stream.state.thinking += stream.buffer;
          stream.buffer = '';
        }
      } else if (stream.mode === 'tool') {
        const endTool = stream.buffer.search(/<\/(seed:)?tool_call>/);
        if (endTool !== -1) {
          const match = stream.buffer.match(/<\/(seed:)?tool_call>/);
          if (match) {
            stream.buffer = stream.buffer.slice(endTool + match[0].length);
            stream.mode = 'text';
            changed = true;
          }
        } else {
          // Discard internal monologue content from display
          stream.buffer = '';
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
      buffer: '',
      mode: 'text',
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
