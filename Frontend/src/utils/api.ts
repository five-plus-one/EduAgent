import axios from 'axios';
import { fetchEventSource } from '@microsoft/fetch-event-source';

// ==========================================
// Core Setup
// ==========================================

export const API_BASE_URL = '/api/v1';

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 15000,
});

// Request Interceptor: attach Bearer token if present
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token');
  if (token && !config.url?.includes('/auth/login')) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response Interceptor: handle 401 globally
apiClient.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('access_token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// ==========================================
// Module 1: Auth & Preferences
// ==========================================

/** 1.1 Login and get access token */
export const login = async (username: string, password: string) => {
  const res = await apiClient.post('/auth/login', { username, password });
  return res.data?.data ?? res.data;
};

/** 1.2 Register a new teacher account */
export const register = async (params: {
  username: string;
  password: string;
  name?: string;
  department?: string;
}) => {
  const res = await apiClient.post('/auth/register', params);
  return res.data?.data ?? res.data;
};

/** 1.3 Logout and revoke token */
export const logout = async () => {
  await apiClient.post('/auth/logout');
  localStorage.removeItem('access_token');
};

/** 1.3 Get current user profile */
export const getMe = async () => {
  const res = await apiClient.get('/auth/me');
  return res.data?.data ?? res.data;
};

/** 1.4 Update user preferences (partial) */
export const updatePreferences = async (prefs: Record<string, unknown>) => {
  const res = await apiClient.put('/auth/me/preferences', prefs);
  return res.data?.data ?? res.data;
};

// ==========================================
// Module 2: Session Lifecycle
// ==========================================

/** 2.1 Create a new session */
export const createSession = async (courseName: string, targetAudience?: string, objective?: string) => {
  const res = await apiClient.post('/sessions', { course_name: courseName, target_audience: targetAudience, objective });
  return res.data?.data ?? res.data;
};

/** 2.2 List sessions (paginated) */
export const listSessions = async (page = 1, size = 20, keyword?: string) => {
  const res = await apiClient.get('/sessions', { params: { page, size, keyword } });
  return res.data?.data ?? res.data;
};

/** 2.3 Get single session detail */
export const getSession = async (sessionId: string) => {
  const res = await apiClient.get(`/sessions/${sessionId}`);
  return res.data?.data ?? res.data;
};

/** 2.4 Update session metadata */
export const updateSession = async (sessionId: string, updates: Record<string, unknown>) => {
  await apiClient.put(`/sessions/${sessionId}`, updates);
};

/** 2.5 Delete a session */
export const deleteSession = async (sessionId: string) => {
  await apiClient.delete(`/sessions/${sessionId}`);
};

// ==========================================
// Module 3: Interaction & File References
// ==========================================

/** 3.1 Streaming text & tool calls (SSE) */
export const streamChatCompletion = async (
  sessionId: string,
  content: string,
  onMessage: (chunk: string, isFinished: boolean, intent?: unknown, eventType?: string, eventData?: any) => void,
  onError: (err: unknown) => void,
  signal?: AbortSignal,
  callbacks?: {
    onToolCall?: (tool: { tool_name: string; arguments: any }) => void;
    onToolResult?: (result: { tool_name: string; status: string; should_refetch_ppt?: boolean }) => void;
    onThinking?: (chunk: string) => void;
  }
) => {
  const token = localStorage.getItem('access_token');

  await fetchEventSource(`${API_BASE_URL}/sessions/${sessionId}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ content }),
    signal,
    onmessage(ev) {
      try {
        const data = JSON.parse(ev.data);
        if (data.event_type === 'thinking' && callbacks?.onThinking) {
          // Structured thinking event from backend
          callbacks.onThinking(data.chunk ?? '');
        } else if (data.event_type === 'tool_call' && callbacks?.onToolCall && data.tool_call) {
          callbacks.onToolCall(data.tool_call);
        } else if (data.event_type === 'tool_result' && callbacks?.onToolResult && data.tool_result) {
          callbacks.onToolResult(data.tool_result);
        } else {
          // Default: text chunk (may contain <think> tags for DeepSeek-style streaming)
          onMessage(data.chunk ?? '', data.is_finished, data.extracted_intent);
        }
      } catch {
        console.error('Failed to parse SSE chunk', ev.data);
      }
    },
    onerror(err) {
      // Silently swallow AbortError — this is intentional user cancellation
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw err; // must re-throw to stop fetchEventSource's retry loop
      }
      onError(err);
      throw err;
    },
  });
};

/** 3.2 Audio/voice transcription */
export const transcribeAudio = async (sessionId: string, audioBlob: Blob) => {
  const form = new FormData();
  form.append('audio_file', audioBlob, 'recording.webm');
  const res = await apiClient.post(`/sessions/${sessionId}/audio-chat`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return (res.data?.data ?? res.data) as { text: string };
};

/** 3.3 Upload a reference file */
export const uploadFile = async (sessionId: string, file: File, intentDesc?: string) => {
  const form = new FormData();
  form.append('file', file);
  if (intentDesc) form.append('intent_desc', intentDesc);
  const res = await apiClient.post(`/sessions/${sessionId}/files`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data?.data ?? res.data;
};

/** 3.4 Poll file parsing status */
export const getFileStatus = async (sessionId: string, fileId: string) => {
  const res = await apiClient.get(`/sessions/${sessionId}/files/${fileId}/status`);
  return res.data?.data ?? res.data;
};

/** 3.5 Link RAG knowledge docs to this session */
export const addReferences = async (sessionId: string, referenceIds: string[]) => {
  await apiClient.post(`/sessions/${sessionId}/references`, { reference_ids: referenceIds });
};

/** 3.7 Remove linked document from session */
export const removeReference = async (sessionId: string, docId: string) => {
  await apiClient.delete(`/sessions/${sessionId}/files/${docId}`);
};

/** 3.6 Update file intent description */
export const updateFile = async (sessionId: string, fileId: string, intentDesc: string) => {
  await apiClient.put(`/sessions/${sessionId}/files/${fileId}`, { intent_desc: intentDesc });
};

/** 3.7 Remove a file from session */
export const deleteFile = async (sessionId: string, fileId: string) => {
  await apiClient.delete(`/sessions/${sessionId}/files/${fileId}`);
};

// ==========================================
// Module 4: Courseware Generation
// NOTE: These endpoints are NOT yet implemented on the backend.
// Functions are kept as stubs to avoid build errors.
// ==========================================

/** 4.1 Trigger courseware generation */
export const generateCourseware = async (
  sessionId: string,
  selectedFileIds: string[],
  mode: 'fast' | 'depth' = 'depth'
) => {
  const res = await apiClient.post(`/sessions/${sessionId}/generate`, {
    selected_file_ids: selectedFileIds,
    mode
  });
  return res.data?.data ?? res.data;
};

/** 4.2 Poll generation task progress */
export const getGenerationStatus = async (taskId: string) => {
  const res = await apiClient.get(`/generate/tasks/${taskId}`);
  return res.data?.data ?? res.data;
};

/** 4.3 Get slideshow preview data */
export const getCoursewarePreview = async (sessionId: string) => {
  const res = await apiClient.get(`/sessions/${sessionId}/courseware/preview`);
  return res.data?.data ?? res.data;
};

/** 4.4 Submit a partial re-generation instruction */
export const iterateCoursewarePage = async (
  sessionId: string,
  targetType: 'ppt' | 'word',
  pageIndex: number,
  instruction: string
) => {
  const res = await apiClient.post(`/sessions/${sessionId}/courseware/iterate`, {
    target_type: targetType,
    page_index: pageIndex,
    instruction
  });
  return res.data?.data ?? res.data;
};

/** 4.5 Stream courseware generation using SSE (Step-by-step rendering) */
export const streamCoursewareGeneration = async (
  sessionId: string,
  selectedFileIds: string[],
  mode: 'fast' | 'depth',
  callbacks: {
    onStart: (theme: any, totalHint: number) => void;
    onPage:  (page: any) => void;
    onWordReady: (markdown: string) => void;
    onDone: (totalPages: number) => void;
    onError: (err: any) => void;
  },
  signal?: AbortSignal
) => {
  const token = localStorage.getItem('access_token');

  await fetchEventSource(`${API_BASE_URL}/sessions/${sessionId}/generate/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ selected_file_ids: selectedFileIds, mode }),
    signal,
    onmessage(ev) {
      try {
        const payload = JSON.parse(ev.data);
        const { event, data } = payload;

        switch (event) {
          case 'generate_start':
            callbacks.onStart(data.theme, data.total_hint);
            break;
          case 'page_chunk':
            callbacks.onPage(data);
            break;
          case 'word_ready':
            callbacks.onWordReady(data.word_markdown);
            break;
          case 'generate_done':
            callbacks.onDone(data.total_pages);
            break;
          case 'generate_error':
            callbacks.onError(new Error(data.message));
            break;
        }
      } catch (err) {
        console.error('[streamCoursewareGeneration] Parse error', ev.data, err);
      }
    },
    onerror(err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw err; 
      }
      callbacks.onError(err);
      throw err;
    },
  });
};

// ==========================================
// Module 5: Export
// NOTE: These endpoints are NOT yet implemented on the backend.
// ==========================================

/** 5.1 Trigger file export (initiates async task) */
export const triggerExport = async (sessionId: string) => {
  const res = await apiClient.post(`/sessions/${sessionId}/export`);
  return res.data?.data ?? res.data;
};

/** 5.2 Poll export task for download URLs */
export const getExportStatus = async (taskId: string) => {
  const res = await apiClient.get(`/export/tasks/${taskId}`);
  return res.data?.data ?? res.data;
};

/** 5.3 Download exported file directly as blob */
export const downloadExportedFile = async (filename: string) => {
  const res = await apiClient.get(`/download/${filename}`, {
    responseType: 'blob'
  });
  return res.data;
};

// ==========================================
// Module 6: Knowledge Base (RAG Admin)
// ==========================================

/** 6.1 Upload a doc to RAG
 * Backend field: 'metadata_json' (JSON string), not 'metadata'
 */
export const uploadKnowledgeDoc = async (file: File, metadata: Record<string, unknown>) => {
  const form = new FormData();
  form.append('file', file);
  form.append('metadata_json', JSON.stringify(metadata)); // ← correct field name
  const res = await apiClient.post('/knowledge-base/documents', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data?.data ?? res.data;
};

/** 6.2 List knowledge docs (paginated) */
export const listKnowledgeDocs = async (page = 1, size = 20, status?: string, subject?: string) => {
  const res = await apiClient.get('/knowledge-base/documents', { params: { page, size, status, subject } });
  return res.data?.data ?? res.data;
};

/** 6.3 Update knowledge doc metadata */
export const updateKnowledgeDoc = async (docId: string, metadata: Record<string, unknown>) => {
  await apiClient.put(`/knowledge-base/documents/${docId}`, { metadata });
};

/** 6.4 Delete a knowledge doc from RAG */
export const deleteKnowledgeDoc = async (docId: string) => {
  await apiClient.delete(`/knowledge-base/documents/${docId}`);
};

