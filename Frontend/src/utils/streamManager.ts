import { streamChatCompletion } from './api';

export interface StreamState {
  aiMsgId: string;
  content: string;
  isSynthesizing: boolean;
  latestIntent: string | null;
}

export type StreamListener = (state: StreamState | null) => void;

class StreamManagerClass {
  private activeStreams = new Map<string, {
    state: StreamState;
    abortController: AbortController;
    listeners: Set<StreamListener>;
  }>();

  /**
   * Components subscribe here to receive background updates.
   */
  public subscribe(sessionId: string, listener: StreamListener): () => void {
    let stream = this.activeStreams.get(sessionId);
    if (stream) {
      stream.listeners.add(listener);
      listener({ ...stream.state });
    } else {
      listener(null);
    }
    return () => this.unsubscribe(sessionId, listener);
  }

  private unsubscribe(sessionId: string, listener: StreamListener) {
    const stream = this.activeStreams.get(sessionId);
    if (stream) {
      stream.listeners.delete(listener);
    }
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

  private notify(_sessionId: string, stream: any) {
    stream.listeners.forEach((l: StreamListener) => l({ ...stream.state }));
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
      listeners: Set<StreamListener>;
    } = {
      state: {
        aiMsgId: Math.random().toString(36).substring(2, 11),
        content: '',
        isSynthesizing: true,
        latestIntent: null,
      },
      abortController: controller,
      listeners: new Set<StreamListener>(),
    };
    
    this.activeStreams.set(sessionId, streamData);
    this.notify(sessionId, streamData); // Will immediately trigger updates on any active listeners

    try {
      await streamChatCompletion(
        sessionId,
        userContent,
        (chunk, isFinished, intent) => {
          if (intent && typeof intent === 'string') {
            streamData.state.latestIntent = intent;
          }
          streamData.state.content += chunk;
          if (isFinished) streamData.state.isSynthesizing = false;
          
          this.notify(sessionId, streamData);
          
          if (isFinished) {
            // Un-register this from being an "active" background process.
            // Future UI mounts will simply load history from DB instead.
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
          onToolCall: (tool) => {
            const msg = `\n\n> 🤖 *正在执行操作: \`${tool.tool_name}\`...*\n\n`;
            if (!streamData.state.content.includes(msg.trim())) {
              streamData.state.content += msg;
              this.notify(sessionId, streamData);
            }
          },
          onToolResult: (result) => {
            if (result.status === 'success' && result.should_refetch_ppt) {
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
