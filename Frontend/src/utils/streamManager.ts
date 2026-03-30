import { streamChatCompletion } from './api';

export interface StreamState {
  aiMsgId: string;
  content: string;
  toolLog: string;        // Tool call markers — stored separately from AI content
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
    const name = toolName.toLowerCase();
    return name.includes('generate') || 
           name.includes('slide') || 
           name.includes('page') || 
           name.includes('update') || 
           name.includes('edit') || 
           name.includes('insert') ||
           name.includes('delete');
  }

  /** 
   * Robust Stream Scrubber: Strips internal tags and monologues.
   * Ensures content field remains clean while thinking/logs are captured.
   */
  private processTextChunk(sessionId: string, stream: any, newChunk: string) {
    stream.buffer += newChunk;
    
    // Pattern to find complete tags: <think>...</think> or <(seed:)?tool_call>...</(seed:)?tool_call>
    // Note: We use [\s\S]*? for non-greedy multiline matching
    const patterns = [
      { 
        regex: /<think>([\s\S]*?)<\/think>/, 
        handler: (match: string, content: string) => { stream.state.thinking += content; }
      },
      { 
        regex: /<(seed:)?tool_call[^>]*>([\s\S]*?)<\/(seed:)?tool_call>/, 
        handler: (match: string, p1: string, content: string) => { 
          stream.state.toolLog += `\n> 🤖 *模型意图捕捉: \`${match.length} 字符\`*\n`;
        }
      }
    ];

    let changed = true;
    while (changed) {
      changed = false;
      for (const p of patterns) {
        const match = stream.buffer.match(p.regex);
        if (match) {
          p.handler(...(match as any));
          stream.buffer = stream.buffer.replace(p.regex, '');
          changed = true;
          break; 
        }
      }
    }

    // After processing complete tags, we look at what's left in the buffer.
    // We can safely move everything before the LAST UNCLOSED '<' to the displayed content.
    const lastOpenTag = stream.buffer.lastIndexOf('<');
    if (lastOpenTag === -1) {
      // No partial tags, move all
      stream.state.content += stream.buffer;
      stream.buffer = '';
    } else if (lastOpenTag > 0) {
      // Move everything up to the '<'
      stream.state.content += stream.buffer.slice(0, lastOpenTag);
      stream.buffer = stream.buffer.slice(lastOpenTag);
    }
    
    // Also check if we are currently inside an unclosed <think> tag to update 'isThinking' UI state
    stream.state.isThinking = stream.buffer.includes('<think>') && !stream.buffer.includes('</think>');
  }

  public async startStream(sessionId: string, userContent: string) {
    if (this.activeStreams.has(sessionId)) return;

    const controller = new AbortController();
    const streamData: {
      state: StreamState;
      buffer: string;
      abortController: AbortController;
    } = {
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
            streamData.state.latestIntent = intent;
          }

          if (chunk) {
            this.processTextChunk(sessionId, streamData, chunk);
          }

          if (isFinished) {
            // Final flush: anything left in buffer is treated as content (likely a false alarm <)
            if (streamData.buffer) {
              streamData.state.content += streamData.buffer;
              streamData.buffer = '';
            }
            
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
            const isPPTTool = this.shouldRefetchForTool(tool.tool_name);
            if (isPPTTool) {
              window.dispatchEvent(new CustomEvent('EduAgent_Generate_Start', { detail: { sessionId } }));
            }
            streamData.state.toolLog += `\n> 🤖 *正在执行操作: \`${tool.tool_name}\`...*\n`;
            this.notify(sessionId, streamData);
          },
          onToolResult: (result) => {
            window.dispatchEvent(new CustomEvent('EduAgent_Generate_End', { detail: { sessionId } }));
            const isPPTTool = this.shouldRefetchForTool(lastToolName);
            const shouldRefetch = result.should_refetch_ppt === true || isPPTTool;
            if (shouldRefetch) {
              refetchDispatched = true;
              window.dispatchEvent(new CustomEvent('EduAgent_Refetch_PPT', { detail: { sessionId } }));
            }
            const statusIcon = result.status === 'success' ? '✅' : '❌';
            streamData.state.toolLog += `> ${statusIcon} *操作已完成*\n\n`;
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
