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

/** 3.1 Streaming text chat (SSE) */
export const streamChatCompletion = async (
  sessionId: string,
  content: string,
  onMessage: (chunk: string, isFinished: boolean, intent?: unknown) => void,
  onError: (err: unknown) => void,
  signal?: AbortSignal,
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
        onMessage(data.chunk ?? '', data.is_finished, data.extracted_intent);
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

/** 4.1 Trigger courseware generation [STUB - backend not implemented] */
export const generateCourseware = async (
  _sessionId: string,
  _selectedFileIds: string[],
  _mode: 'fast' | 'depth' = 'depth'
) => {
  throw new Error('generateCourseware: backend endpoint not yet implemented');
};

/** 4.2 Poll generation task progress [STUB - backend not implemented] */
export const getGenerationStatus = async (_taskId: string) => {
  throw new Error('getGenerationStatus: backend endpoint not yet implemented');
};

/** 4.3 Get slideshow preview data [STUB - backend not implemented] */
export const getCoursewarePreview = async (_sessionId: string) => {
  throw new Error('getCoursewarePreview: backend endpoint not yet implemented');
};

/** 4.4 Submit a partial re-generation instruction [STUB - backend not implemented] */
export const iterateCoursewarePage = async (
  _sessionId: string,
  _targetType: 'ppt' | 'word',
  _pageIndex: number,
  _instruction: string
) => {
  throw new Error('iterateCoursewarePage: backend endpoint not yet implemented');
};

// ==========================================
// Module 5: Export
// NOTE: These endpoints are NOT yet implemented on the backend.
// ==========================================

/** 5.1 Trigger file export [STUB - backend not implemented] */
export const triggerExport = async (_sessionId: string) => {
  throw new Error('triggerExport: backend endpoint not yet implemented');
};

/** 5.2 Poll export task for download URLs [STUB - backend not implemented] */
export const getExportStatus = async (_exportTaskId: string) => {
  throw new Error('getExportStatus: backend endpoint not yet implemented');
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

