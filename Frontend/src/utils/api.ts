import axios from 'axios';
import { fetchEventSource } from '@microsoft/fetch-event-source';

// ==========================================
// Core Setup
// ==========================================

// 从 Vite 环境变量读取，回退到本地开发默认值
// 配置方式：在 Frontend/.env 中设置 VITE_API_BASE_URL
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL as string ?? 'http://localhost:8000/api/v1';

/** API 请求超时（ms）。可通过 VITE_API_TIMEOUT 环境变量覆盖 */
const API_TIMEOUT = Number(import.meta.env.VITE_API_TIMEOUT) || 120000;

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: API_TIMEOUT, // 2分钟长超时，保证深度思考能力（可通过 VITE_API_TIMEOUT 覆盖）
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

/** 2.4b Rename session (convenience wrapper) */
export const renameSession = async (sessionId: string, courseName: string) => {
  await apiClient.put(`/sessions/${sessionId}`, { course_name: courseName });
};

/** 2.5 Delete a session */
export const deleteSession = async (sessionId: string) => {
  await apiClient.delete(`/sessions/${sessionId}`);
};

/** 1.5 Update user profile (name / department) */
export const updateProfile = async (params: { name?: string; department?: string }) => {
  const res = await apiClient.put('/auth/me/preferences', params);
  return res.data?.data ?? res.data;
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
  const res = await apiClient.get(`/sessions/${sessionId}/courseware/preview?t=${Date.now()}`);
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
    onPage: (page: any) => void;
    onWordReady: (markdown: string) => void;
    onDone: (totalPages: number) => void;
    onError: (err: any) => void;
    onThinking?: (text: string) => void;
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
    // CRITICAL: prevent fetch-event-source from closing the SSE connection
    // when the browser tab loses focus or visibility (which is the default behavior).
    // Without this, switching windows/tabs kills the stream after page 1.
    openWhenHidden: true,
    onmessage(ev) {
      try {
        const payload = JSON.parse(ev.data);
        const { event, data } = payload;

        switch (event) {
          case 'thinking_chunk':
            callbacks.onThinking?.(data.text);
            break;
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
export const downloadExportedFile = async (urlOrFilename: string) => {
  const path = urlOrFilename.startsWith('/')
    ? urlOrFilename.replace('/api/v1', '')
    : `/export/download/${urlOrFilename}`;
  const res = await apiClient.get(path, {
    responseType: 'blob'
  });
  return res.data;
};

// ==========================================
// Module 5b: Word 讲义
// ==========================================

/**
 * 5b.1 AI 修改讲义内容
 * POST /sessions/{session_id}/courseware/iterate-word
 * 超时设为 240 秒（LLM 重写长文耗时较久）
 */
export const iterateWord = async (
  sessionId: string,
  instruction: string,
  selectedText?: string
): Promise<{ word_markdown: string }> => {
  const res = await apiClient.post(
    `/sessions/${sessionId}/courseware/iterate-word`,
    { instruction, selected_text: selectedText },
    { timeout: 240000 }
  );
  return res.data?.data ?? res.data;
};

/**
 * 5b.2 导出讲义为 .docx 文件（后端 python-docx 渲染，非 HTML 伪装）
 * GET /sessions/{session_id}/courseware/export-word
 * 必须用 fetch + blob，不能用 axios 默认模式（会把响应当 JSON 解析）。
 */
export const exportWordDocx = async (sessionId: string): Promise<void> => {
  const token = localStorage.getItem('access_token') ?? '';
  const res = await fetch(
    `${API_BASE_URL}/sessions/${sessionId}/courseware/export-word`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) {
    // 尝试解析错误 detail
    let detail = `导出失败 (${res.status})`;
    try {
      const json = await res.json();
      detail = json?.detail || detail;
    } catch { /* ignore */ }
    throw new Error(detail);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `EduAgent讲义_${sessionId.slice(0, 8)}.docx`;
  a.click();
  URL.revokeObjectURL(url);
};

/**
 * 5b.3 直接保存讲义内容（不经过 AI，手动编辑持久化）
 * PUT /sessions/{session_id}/courseware/word
 *
 * 后端会将所有 `---` 替换为 `***`，响应里返回规范化后的 word_markdown。
 */
export const saveWordContent = async (
  sessionId: string,
  wordMarkdown: string
): Promise<{ word_markdown: string }> => {
  const res = await apiClient.put(
    `/sessions/${sessionId}/courseware/word`,
    { word_markdown: wordMarkdown }
  );
  return res.data?.data ?? res.data;
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

/** 6.2 List knowledge docs (paginated)
 * @deprecated Prefer `listKnowledgeDocuments` from videoKnowledgeApi.ts (supports v1.2 response shape)
 */
export const listKnowledgeDocs = async (page = 1, size = 20, status?: string) => {
  const res = await apiClient.get('/knowledge-base/documents', { params: { page, size, ...(status ? { status } : {}) } });
  return res.data?.data ?? res.data;
};

/** 6.3 Replace all metadata for a knowledge doc (PUT semantics: full overwrite)
 * ⚠️ Sends metadata object directly — do NOT wrap in { metadata: {...} }.
 * To update display_name/description, use `patchKnowledgeDocument` from videoKnowledgeApi.ts instead.
 */
export const updateKnowledgeDoc = async (docId: string, metadata: Record<string, unknown>) => {
  await apiClient.put(`/knowledge-base/documents/${docId}`, metadata);
};

/** 6.4 Delete a knowledge doc from RAG */
export const deleteKnowledgeDoc = async (docId: string) => {
  await apiClient.delete(`/knowledge-base/documents/${docId}`);
};

// ==========================================
// Module 7: 用户图片素材库 (API v2)
// 原「会话图片库」已重构为「用户图片库」，图片跨会话共享。
// 旧路由: /api/v1/sessions/{session_id}/images
// 新路由: /api/v1/users/me/images
// ==========================================

export interface UserImage {
  image_id: string;
  filename: string;
  label?: string;
  /** 后端返回的相对路径，如 /api/v1/users/me/images/{id}/preview */
  preview_url: string;
  /** pending | processing | done | failed */
  annotate_status: 'pending' | 'processing' | 'done' | 'failed';
  tags?: string[];
  description?: string;
  file_size?: number;
  created_at: string;
}

export interface UserImageListResponse {
  total: number;
  items: UserImage[];
}

/** @deprecated 使用 UserImage 替代 */
export type SessionImage = UserImage;
/** @deprecated 使用 UserImageListResponse 替代 */
export type SessionImageListResponse = UserImageListResponse;

/**
 * 获取图片预览完整 URL（自动附加 token query 参数）
 * <img> 标签无法设置 Authorization Header，改用 ?token= 传递。
 * @param previewPath 后端返回的 preview_url 字段（相对路径）
 */
export const getImagePreviewUrl = (previewPath: string): string => {
  if (!previewPath) return '';
  const token = localStorage.getItem('access_token') ?? '';
  // 如果已经是完整 URL（含 http），直接拼 token
  if (previewPath.startsWith('http')) {
    const url = new URL(previewPath);
    if (token) url.searchParams.set('token', token);
    return url.toString();
  }
  // 相对路径：从 API_BASE_URL 提取 origin 后拼接
  const origin = API_BASE_URL.replace(/\/api\/v\d+.*$/, '');
  const encoded = token ? `?token=${encodeURIComponent(token)}` : '';
  return `${origin}${previewPath}${encoded}`;
};

/** @deprecated 使用 getImagePreviewUrl 替代（旧版不带 token，已失效） */
export const resolveImagePreviewUrl = getImagePreviewUrl;

/** 7.1 上传图片到用户素材库（jpg/png/webp/gif，单张最大 10MB） */
export const uploadUserImage = async (
  file: File,
  label?: string
): Promise<UserImage> => {
  const form = new FormData();
  form.append('file', file);
  if (label) form.append('label', label);
  const res = await apiClient.post('/users/me/images', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data?.data ?? res.data;
};

/**
 * @deprecated 使用 uploadUserImage(file, label) 替代（已移除 sessionId 参数）
 */
export const uploadSessionImage = async (
  _sessionId: string,
  file: File,
  label?: string
): Promise<UserImage> => uploadUserImage(file, label);

/** 7.2 获取用户图片库列表（分页，与会话无关） */
export const listUserImages = async (
  page = 1,
  size = 20
): Promise<UserImageListResponse> => {
  const res = await apiClient.get('/users/me/images', {
    params: { page, size },
  });
  return res.data?.data ?? res.data;
};

/**
 * @deprecated 使用 listUserImages(page, size) 替代（已移除 sessionId 参数）
 */
export const listSessionImages = async (
  _sessionId: string,
  page = 1,
  size = 20
): Promise<UserImageListResponse> => listUserImages(page, size);

/** 7.3 删除用户图片 */
export const deleteUserImage = async (imageId: string): Promise<void> => {
  await apiClient.delete(`/users/me/images/${imageId}`);
};

/**
 * @deprecated 使用 deleteUserImage(imageId) 替代（已移除 sessionId 参数）
 */
export const deleteSessionImage = async (
  _sessionId: string,
  imageId: string
): Promise<void> => deleteUserImage(imageId);

/** 7.4 重新触发图片标注（对 annotate_status === 'failed' 的图片手动重试） */
export const reannotateUserImage = async (
  imageId: string
): Promise<{ image_id: string; annotate_status: string }> => {
  const res = await apiClient.post(`/users/me/images/${imageId}/annotate`);
  return res.data?.data ?? res.data;
};

/**
 * @deprecated 使用 reannotateUserImage(imageId) 替代（已移除 sessionId 参数）
 */
export const reannotateSessionImage = async (
  _sessionId: string,
  imageId: string
): Promise<{ image_id: string; annotate_status: string }> =>
  reannotateUserImage(imageId);

/**
 * 7.5 修改图片用户描述（label）
 * PATCH /users/me/images/{image_id}
 * 传 null 则清空描述
 */
export const patchImageLabel = async (
  imageId: string,
  label: string | null
): Promise<UserImage> => {
  const res = await apiClient.patch(`/users/me/images/${imageId}`, { label });
  return res.data?.data ?? res.data;
};

/**
 * 7.6 整体覆盖图片标签列表
 * PUT /users/me/images/{image_id}/tags
 * ⚠️ 整体覆盖语义：传入完整目标标签数组，后端去重去空
 */
export const updateImageTags = async (
  imageId: string,
  tags: string[]
): Promise<UserImage> => {
  const res = await apiClient.put(`/users/me/images/${imageId}/tags`, { tags });
  return res.data?.data ?? res.data;
};

// ==========================================
// Module 8: PPT 课件图片替换 & 手动编辑
// ==========================================

/**
 * 8.1 替换 PPT 某页某图片元素的图源（持久化到 DB）
 * PATCH /sessions/{session_id}/courseware/slides/{page_index}/elements/{element_id}/image
 *
 * 前端在图片选择弹窗中确认新图片后调用此接口。
 * 调用成功后，preview 和 导出 PPT 均使用新图片。
 *
 * @returns { element_id, page_index, image_id, preview_url }
 */
export const replaceSlideImage = async (
  sessionId: string,
  pageIndex: number,
  elementId: string,
  imageId: string
): Promise<{ element_id: string; page_index: number; image_id: string; preview_url: string }> => {
  const res = await apiClient.patch(
    `/sessions/${sessionId}/courseware/slides/${pageIndex}/elements/${elementId}/image`,
    { image_id: imageId }
  );
  return res.data?.data ?? res.data;
};

/**
 * 8.2 手动编辑单页并保存到 DB
 * PUT /sessions/{session_id}/courseware/slides/{page_index}
 *
 * 手动编辑对话框关闭/保存时调用，将当前页最新状态写入 DB。
 * 字段均可省略，只传实际改动了的部分。
 */
export const saveManualSlideEdit = async (
  sessionId: string,
  pageIndex: number,
  edits: {
    title?: string;
    elements?: unknown[];
    speaker_notes?: string;
  }
): Promise<{ page_index: number; slide: unknown }> => {
  const res = await apiClient.put(
    `/sessions/${sessionId}/courseware/slides/${pageIndex}`,
    edits
  );
  return res.data?.data ?? res.data;
};

/**
 * 8.3 获取用户图片库列表（支持关键词搜索）
 * GET /users/me/images?page=1&size=20&keyword=xxx
 *
 * 替代旧版 listUserImages（新增 keyword 参数，用于图片选择弹窗搜索）
 */
export const searchUserImages = async (
  page = 1,
  size = 20,
  keyword?: string
): Promise<UserImageListResponse> => {
  const res = await apiClient.get('/users/me/images', {
    params: { page, size, ...(keyword ? { keyword } : {}) },
  });
  return res.data?.data ?? res.data;
};

/**
 * 8.4 切换单页布局模板（不经过 AI，确定性可靠）
 * POST /sessions/{session_id}/courseware/slides/{page_index}/apply-layout
 *
 * 支持的 layout_type: cover / minimal_list / two_column / stat_callout / timeline
 * 以及映射值: standard / image_gallery / full_content / card_grid / title_slide
 *
 * 返回的 slide 可直接替换本地状态，无需重新拉取 preview 接口。
 */
export const applySlideLayout = async (
  sessionId: string,
  pageIndex: number,
  layoutType: string
): Promise<{
  page_index: number;
  layout_type: string;
  original_layout_type: string;
  slide: unknown;
}> => {
  const res = await apiClient.post(
    `/sessions/${sessionId}/courseware/slides/${pageIndex}/apply-layout`,
    { layout_type: layoutType }
  );
  return res.data?.data ?? res.data;
};
