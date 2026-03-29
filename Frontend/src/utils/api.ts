import axios from 'axios';
import { fetchEventSource } from '@microsoft/fetch-event-source';

export const API_BASE_URL = '/api/v1';

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Interceptor for attaching tokens (Mock logic for now)
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token');
  if (token && config.url !== '/auth/login') {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// API 0.1 Login
export const login = async (username: string, password: string) => {
  // If the backend isn't up, we mock the successful response format
  try {
    const res = await apiClient.post('/auth/login', { username, password });
    return res.data;
  } catch (error) {
    console.warn("Backend not found, using mockup token.");
    return {
      access_token: 'mock_eyJhbGciOiJIUzI1...',
      refresh_token: 'mock_def50200a...',
      expires_in: 3600
    };
  }
};

// Helper for SSE streams based on API 1.2
export const streamChatCompletion = async (
  sessionId: string,
  content: string,
  onMessage: (chunk: string, isFinished: boolean, intent?: any) => void,
  onError: (err: any) => void
) => {
  const token = localStorage.getItem('access_token');
  
  await fetchEventSource(`${API_BASE_URL}/sessions/${sessionId}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    },
    body: JSON.stringify({ content }),
    onmessage(ev) {
      try {
        const data = JSON.parse(ev.data);
        onMessage(data.chunk || '', data.is_finished, data.extracted_intent);
      } catch (e) {
        console.error('Failed to parse SSE data', e);
      }
    },
    onerror(err) {
      onError(err);
      throw err; // Prevents retrying infinitely
    }
  });
};
