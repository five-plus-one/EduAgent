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
    buffer: string;        // Buffer for partial tag parsing across chunks
    abortController: AbortController;
  }>();

  private sessionListeners = new Map<string, Set<StreamListener>>();

  /**
   * Persists tool call logs across session switches (survives component unmounts).
   * Key: messageId, Value: markdown-formatted tool log text.
   */
  private messageToolLogs = new Map<string, string>();

  /** Read the persisted tool log for a specific message. */
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

  /** Helper to determine if a tool call should trigger a PPT refetch */
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
   * Scrub and Extract: High-resilience tag parser for text streams.
   * Strips XML-like internal monologue/tool tags from the user-visible content.
   */
  private processTextChunk(sessionId: string, stream: any, newChunk: string) {
    stream.buffer += newChunk;
    
    let changed = true;
    while (changed) {
      changed = false;
      
      // Handle <think>...</think>
      const thinkOpenIdx = stream.buffer.indexOf('<think>');
      if (thinkOpenIdx !== -1) {
        // Emit content before the tag
        stream.state.content += stream.buffer.slice(0, thinkOpenIdx);
        stream.buffer = stream.buffer.slice(thinkOpenIdx);
        
        const thinkCloseIdx = stream.buffer.indexOf('</think>');
        if (thinkCloseIdx !== -1) {
          // Extract thinking content
          stream.state.thinking += stream.buffer.slice(7, thinkCloseIdx);
          stream.buffer = stream.buffer.slice(thinkCloseIdx + 8);
          stream.state.isThinking = false;
          changed = true;
          continue;
        } else {
          // Tag not closed yet, mark state
          stream.state.isThinking = true;
          // Note: we don't clear the buffer yet to allow future chunks to complete the tag
          // But we can peek at the partial thinking
          return; 
        }
      }

      // Handle <seed:tool_call>...</seed:tool_call> or similar tool tags
      const toolOpenIdx = stream.buffer.search(/<(seed:)?tool_call[^>]*>/);
      if (toolOpenIdx !== -1) {
        stream.state.content += stream.buffer.slice(0, toolOpenIdx);
        stream.buffer = stream.buffer.slice(toolOpenIdx);
        
        const toolCloseIdx = stream.buffer.search(/<\/(seed:)?tool_call>/);
        if (toolCloseIdx !== -1) {
          // Found closing tag, move internal deliberation to toolLog
          const tagContent = stream.buffer.slice(0, toolCloseIdx + stream.buffer.match(/<\/(seed:)?tool_call>/)![0].length);
          stream.state.toolLog += `\n> 🤖 *模型内部调用尝试: \`${tagContent.length} chars\`*\n`;
          stream.buffer = stream.buffer.slice(tagContent.length);
          changed = true;
          continue;
        } else {
          // Tool tag not closed yet
          return;
        }
      }

      // If no open tags in buffer, flush content that is safe
      // Safe content is anything before a partial '<'
      const lastLeftAngle = stream.buffer.lastIndexOf('<');
      if (lastLeftAngle === -1) {
        stream.state.content += stream.buffer;
        stream.buffer = '';
      } else if (lastLeftAngle > 0) {
        stream.state.content += stream.buffer.slice(0, lastLeftAngle);
        stream.buffer = stream.buffer.slice(lastLeftAngle);
      }
    }
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
            // Flush any remaining buffer if it doesn't look like a partial tag
            if (streamData.buffer && !streamData.buffer.startsWith('<')) {
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
