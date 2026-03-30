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
    const name = toolName.toLowerCase();
    return /generate|slide|page|update|edit|insert|delete/.test(name);
  }

  /**
   * P8 High-Performance Stream Scrubber
   * Cleans internal tags while strictly preserving user-facing text.
   */
  private processTextChunk(stream: any, newChunk: string) {
    stream.buffer += newChunk;

    // 1. Capture completed thinking blocks
    const thinkRegex = /<think>([\s\S]*?)<\/think>/g;
    let match;
    while ((match = thinkRegex.exec(stream.buffer)) !== null) {
      stream.state.thinking += match[1];
      stream.buffer = stream.buffer.replace(match[0], '');
    }

    // 2. Capture completed tool/monologue tags
    const toolRegex = /<(seed:)?tool_call[^>]*>([\s\S]*?)<\/(seed:)?tool_call>/g;
    while ((match = toolRegex.exec(stream.buffer)) !== null) {
      stream.state.toolLog += `\n> 🤖 *模型意图捕捉: \`${match[0].length} 字符\`*\n`;
      stream.buffer = stream.buffer.replace(match[0], '');
    }

    // 3. Update 'isThinking' state if currently inside unclosed tag
    stream.state.isThinking = stream.buffer.includes('<think>') && !stream.buffer.includes('</think>');

    // 4. Content Flush: Move text that is DEFINITELY not part of an unclosed tag
    // We stop at the first '<' that might start a tag.
    const firstOpenTag = stream.buffer.indexOf('<');
    if (firstOpenTag === -1) {
      // No tags, move everything
      stream.state.content += stream.buffer;
      stream.buffer = '';
    } else if (firstOpenTag > 0) {
      // Move text before the tag
      stream.state.content += stream.buffer.slice(0, firstOpenTag);
      stream.buffer = stream.buffer.slice(firstOpenTag);
    }
    
    // Safety: If buffer gets too large without a closing tag, flush it to content
    // (backend might be using < in text improperly)
    if (stream.buffer.length > 2000) {
      stream.state.content += stream.buffer;
      stream.buffer = '';
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
