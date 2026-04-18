import { useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import styles from './Workspace.module.css';
import { clsx } from 'clsx';
import { useChatSession } from '../hooks/useChatSession';
import MessageBubble from '../components/MessageBubble';
import { useCourseware } from '../hooks/useCourseware';
import { usePPTStream } from '../hooks/usePPTStream';
import PPTCard from '../components/PPTCard';
import PPTSkeleton from '../components/PPTSkeleton';
import ImageUploadPanel from '../components/ImageUploadPanel';
import ThemePicker, { CUSTOM_KEY, type ThemeCustomColors } from '../components/ThemePicker';
import GamePanel from '../components/GamePanel';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeRaw from 'rehype-raw';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { useExport } from '../hooks/useExport';
import { useNotificationStore } from '../store/useNotificationStore';
import { listKnowledgeDocs, addReferences, removeReference, getSession, uploadKnowledgeDoc, exportWordDocx, renameSession, saveSessionTheme, getThemes } from '../utils/api';
import type { GameSuggestData, GameSpec } from '../utils/gamesApi';
import { Gamepad2, FileText, Link, CheckCircle, Loader2, Library, Sparkles, Mic, Paperclip, Send, Square, Download, Unlink, Image as ImageIcon, UploadCloud, AlertCircle, Clock, Pencil, Check, Palette, Eye, Menu, FolderOpen } from 'lucide-react';

export default function Workspace() {
  const { sessionId = 'new' } = useParams();
  const navigate = useNavigate();
  const workspaceRef = useRef<HTMLDivElement>(null);
  const visualPanelRef = useRef<HTMLElement>(null);
  const [inputText, setInputText] = useState('');

  // 鈹€鈹€ 鍙嫋鎷藉垎鍓茬嚎 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
  const CHAT_MIN = 280;
  const CHAT_MAX = 680;
  const CHAT_DEFAULT = 420;
  const [chatWidth, setChatWidth] = useState(CHAT_DEFAULT);
  const isDraggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartWRef = useRef(0);

  const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    dragStartXRef.current = e.clientX;
    dragStartWRef.current = chatWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (ev: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const delta = ev.clientX - dragStartXRef.current;
      const next = Math.min(CHAT_MAX, Math.max(CHAT_MIN, dragStartWRef.current + delta));
      setChatWidth(next);
    };

    const onMouseUp = () => {
      isDraggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [chatWidth]);
  const streamEndRef = useRef<HTMLDivElement>(null);
  const messageStreamRef = useRef<HTMLDivElement>(null);
  const filesTabRef = useRef<HTMLDivElement>(null);
  const pptTabRef = useRef<HTMLDivElement>(null);
  const wordTabRef = useRef<HTMLDivElement>(null);
  const gamesTabRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const wordDocRef = useRef<HTMLDivElement>(null);
  const kbFileInputRef = useRef<HTMLInputElement>(null);
  const micPointerIdRef = useRef<number | null>(null);
  const isMicPressActiveRef = useRef(false);
  const lastSpeechErrorRef = useRef<string | null>(null);

  const [selectionText, setSelectionText] = useState('');
  const [floatPos, setFloatPos] = useState({ top: 0, left: 0 });
  const [isMicPressed, setIsMicPressed] = useState(false);

  const {
    isSupported: isSpeechSupported,
    isTranscribing,
    startRecording,
    stopRecording,
    error: speechError,
  } = useSpeechRecognition(sessionId, (text) => {
    setInputText(prev => prev.trim() ? `${prev.trim()} ${text}` : text);
  });
  const pushNotification = useNotificationStore((state) => state.pushNotification);

  useEffect(() => {
    if (!speechError) {
      lastSpeechErrorRef.current = null;
      return;
    }

    if (lastSpeechErrorRef.current === speechError) {
      return;
    }

    lastSpeechErrorRef.current = speechError;
    pushNotification({
      tone: 'error',
      title: '语音转写失败',
      message: speechError,
    });
  }, [pushNotification, speechError]);

  const beginMicPress = useCallback((reason: string, pointerId?: number) => {
    if (isMicPressActiveRef.current) {
      return;
    }

    isMicPressActiveRef.current = true;
    micPointerIdRef.current = pointerId ?? null;
    console.log('[voice] press mic', { reason, pointerId });
    setIsMicPressed(true);
    void startRecording();
  }, [startRecording]);

  const releaseMicPress = useCallback((reason: string, pointerId?: number) => {
    if (!isMicPressActiveRef.current) {
      return;
    }

    if (pointerId != null && micPointerIdRef.current != null && pointerId !== micPointerIdRef.current) {
      return;
    }

    isMicPressActiveRef.current = false;
    console.log('[voice] release mic', { reason, pointerId });
    micPointerIdRef.current = null;
    setIsMicPressed(false);
    stopRecording();
  }, [stopRecording]);

  useEffect(() => {
    if (!isMicPressed) return;

    const handlePointerRelease = (event: PointerEvent) => {
      releaseMicPress('window', event.pointerId);
    };
    const handleMouseUp = () => {
      releaseMicPress('window-mouse');
    };
    const handleTouchEnd = () => {
      releaseMicPress('window-touch');
    };
    const handleWindowBlur = () => {
      releaseMicPress('blur');
    };

    window.addEventListener('pointerup', handlePointerRelease);
    window.addEventListener('pointercancel', handlePointerRelease);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('touchend', handleTouchEnd);
    window.addEventListener('touchcancel', handleTouchEnd);
    window.addEventListener('blur', handleWindowBlur);

    return () => {
      window.removeEventListener('pointerup', handlePointerRelease);
      window.removeEventListener('pointercancel', handlePointerRelease);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchend', handleTouchEnd);
      window.removeEventListener('touchcancel', handleTouchEnd);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [isMicPressed, releaseMicPress]);

  const { messages, isSynthesizing, latestIntent, isLoadingHistory, sendMessage, stopGeneration } = useChatSession(sessionId);
  const { pages, wordDoc, updatingPages, iteratePage, isGenerating, previewStatus, fetchPreview, clearPages, updatePageLocally, applyLayoutAndRefresh, saveWordDoc, resolveImageInPage } = useCourseware(sessionId);
  const { isExporting, exportCourseware } = useExport(sessionId);

  const { 
    isStreaming, 
    streamPages, 
    streamWordDoc, 
    startStreaming, 
    stopStreaming,
    streamError,
    streamThinking
  } = usePPTStream(sessionId);

  useEffect(() => {
    if (!isStreaming && streamPages.length > 0) {
      fetchPreview(true);
    }
  }, [isStreaming, streamPages, fetchPreview]);

  // RAG Knowledge Base Integration
  const [kbDocs, setKbDocs] = useState<any[]>([]);
  const [linkedDocs, setLinkedDocs] = useState<Set<string>>(new Set());       // Set of document_ids
  const [docToFileId, setDocToFileId] = useState<Map<string, string>>(new Map()); // document_id 鈫?session_file_id
  const [linkingDocs, setLinkingDocs] = useState<Set<string>>(new Set());
  const [hoveredLinkDoc, setHoveredLinkDoc] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>('files');
  const [mobilePane, setMobilePane] = useState<'chat' | 'files' | 'ppt' | 'more'>('chat');
  /** 鍙傝€冭祫鏂?Tab 鐨勫瓙闈㈡澘鍒囨崲锛歞ocs锛堢煡璇嗗簱鏂囦欢锛?| images锛堜細璇濆浘鐗囷級 */
  const [filesSubTab, setFilesSubTab] = useState<'docs' | 'images'>('docs');
  const [isUploadingKb, setIsUploadingKb] = useState(false);
  const [isDraggingKb, setIsDraggingKb] = useState(false);
  const [filesHighlight, setFilesHighlight] = useState(false);
  const [isExportingWord, setIsExportingWord] = useState(false);
  // P2: 浠绘剰涓€寮犲够鐏墖姝ｅ湪淇濆瓨鍥剧墖锛屽鍑烘寜閽煭鏆傜鐢ㄩ槻绔炴€?
  const [anyImageSaving, setAnyImageSaving] = useState(false);
  // 鈹€鈹€ PPT 涓婚閫夎壊鍣?鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
  // localStorage key锛氭寜浼氳瘽绾ч殧绂伙紝閬垮厤璺ㄤ細璇濇薄鏌?
  const [showThemePicker, setShowThemePicker] = useState(false);
  const [themeLabelMap, setThemeLabelMap] = useState<Map<string, string>>(new Map());
  /** null 琛ㄧず銆岃嚜鍔ㄣ€嶏紝string 琛ㄧず閫変腑鐨?theme_key锛孋USTOM_KEY 琛ㄧず鑷畾涔?*/
  const [pendingThemeKey, setPendingThemeKey] = useState<string | null>(null);
  /** 褰撳墠搴旂敤鍒?PPT 棰勮鍖虹殑涓婚棰滆壊锛堢敤浜?CSS 鍙橀噺娉ㄥ叆锛?*/
  const [appliedThemeColors, setAppliedThemeColors] = useState<ThemeCustomColors | null>(() => {
    // localStorage 闃查棯鐑侊細鍚庣杩斿洖鍓嶅揩閫熷崰浣?
    try {
      const key = sessionId !== 'new' ? `eduagent_ppt_colors_${sessionId}` : null;
      const raw = key ? localStorage.getItem(key) : null;
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  });
  /** 搴旂敤鐨勪富棰樺悕绉帮紙涓嶅鍑猴紝浠呯敤浜庢樉绀猴級 */
  const [appliedThemeName, setAppliedThemeName] = useState<string | null>(() => {
    try {
      const key = sessionId !== 'new' ? `eduagent_ppt_name_${sessionId}` : null;
      return key ? localStorage.getItem(key) : null;
    } catch { return null; }
  });
  const [wordMode, setWordMode] = useState<'preview' | 'edit'>('preview');
  const [wordDraft, setWordDraft] = useState('');
  const [wordSavedSnapshot, setWordSavedSnapshot] = useState('');
  const [isSavingWord, setIsSavingWord] = useState(false);
  const wordEditRef = useRef<HTMLTextAreaElement>(null);

  // 鈹€鈹€ 浜掑姩灏忔父鎴?鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
  const [pendingSuggest, setPendingSuggest] = useState<GameSuggestData | null>(null);
  const [pendingTrigger, setPendingTrigger] = useState<GameSpec | null>(null);
  const [activeGameId, setActiveGameId] = useState<string | null>(null);
  const lastGameTriggerSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    if (!pendingTrigger) {
      lastGameTriggerSignatureRef.current = null;
    }
  }, [pendingTrigger]);

  // 鈹€鈹€ Session 鏍囬锛堣鍙?+ 鍐呰仈缂栬緫锛夆攢鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
  const [sessionTitle, setSessionTitle] = useState('');
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [titleSaving, setTitleSaving] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const persistedWordDoc = streamWordDoc || wordDoc;
  const hasWordContent = Boolean(persistedWordDoc);
  const wordDirty = wordDraft !== wordSavedSnapshot;
  const displayedWordDoc = wordDirty ? wordDraft : persistedWordDoc;
  const resolveThemeDisplayName = useCallback((themeKey: string | null, isCustomTheme = false) => {
    if (isCustomTheme) return '自定义';
    if (!themeKey) return '自动';
    return themeLabelMap.get(themeKey) ?? themeKey;
  }, [themeLabelMap]);
  const isCustomThemeActive =
    pendingThemeKey === CUSTOM_KEY ||
    (pendingThemeKey === null && appliedThemeName === '自定义' && !!appliedThemeColors);
  const currentThemeDisplayName = isCustomThemeActive
    ? '自定义'
    : resolveThemeDisplayName(pendingThemeKey, false);
  const hasVisualTools =
    (activeTab === 'ppt' && pages.length > 0) ||
    (activeTab === 'word' && (persistedWordDoc || wordDirty));

  useEffect(() => {
    let alive = true;
    getThemes()
      .then((themes) => {
        if (!alive) return;
        setThemeLabelMap(new Map(themes.map(theme => [theme.key, theme.label])));
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  useLayoutEffect(() => {
    const tabMap: Record<string, HTMLDivElement | null> = {
      files: filesTabRef.current,
      ppt: pptTabRef.current,
      word: wordTabRef.current,
      games: gamesTabRef.current,
    };

    const target = tabMap[activeTab];

    const resetScroll = () => {
      window.scrollTo({ top: 0, behavior: 'auto' });
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
      workspaceRef.current?.scrollTo({ top: 0, behavior: 'auto' });
      visualPanelRef.current?.scrollTo({ top: 0, behavior: 'auto' });
      target?.scrollTo({ top: 0, behavior: 'auto' });
    };

    resetScroll();
    requestAnimationFrame(() => {
      resetScroll();
      requestAnimationFrame(resetScroll);
    });
  }, [activeTab, filesSubTab, sessionId, pages.length, persistedWordDoc]);

  /** 鐐瑰嚮 Paperclip 鎸夐挳锛氬垏鎹㈠埌鍙傝€冭祫鏂?Tab 骞惰Е鍙戦珮浜彁绀?*/
  const handleOpenFiles = (subTab: 'docs' | 'images' = 'docs') => {
    setActiveTab('files');
    setMobilePane('files');
    setFilesSubTab(subTab);
    setFilesHighlight(true);
    setTimeout(() => setFilesHighlight(false), 1800);
  };

  useEffect(() => {
    const handleOpenAssetsPanel = (event: Event) => {
      const detail = (event as CustomEvent<{ subTab?: 'docs' | 'images' }>).detail;
      setActiveTab('files');
      setMobilePane('files');
      setFilesSubTab(detail?.subTab === 'images' ? 'images' : 'docs');
      setFilesHighlight(true);
      setTimeout(() => setFilesHighlight(false), 1800);
    };

    window.addEventListener('EduAgent_Open_AssetsPanel', handleOpenAssetsPanel);
    return () => window.removeEventListener('EduAgent_Open_AssetsPanel', handleOpenAssetsPanel);
  }, []);

  const handleExportWord = async () => {
    if (!wordDoc || isExportingWord || sessionId === 'new') return;
    setIsExportingWord(true);
    try {
      await exportWordDocx(sessionId);
    } catch (e: any) {
      alert('讲义导出失败：' + (e?.message || '未知错误'));
    } finally {
      setIsExportingWord(false);
    }
  };

  useEffect(() => {
    setWordMode('preview');
    setWordDraft('');
    setWordSavedSnapshot('');
    setIsSavingWord(false);
  }, [sessionId]);

  useEffect(() => {
    if (wordDirty) return;
    setWordDraft(persistedWordDoc);
    setWordSavedSnapshot(persistedWordDoc);
  }, [persistedWordDoc, wordDirty]);

  useEffect(() => {
    if (wordMode === 'edit') {
      setTimeout(() => wordEditRef.current?.focus(), 80);
    }
  }, [wordMode]);

  const handleWordPreview = useCallback(() => {
    setWordMode('preview');
  }, []);

  const handleEnterWordEdit = useCallback(() => {
    if (!hasWordContent && !wordDraft) return;
    if (!wordDirty) {
      setWordDraft(persistedWordDoc);
      setWordSavedSnapshot(persistedWordDoc);
    }
    setWordMode('edit');
  }, [hasWordContent, persistedWordDoc, wordDirty, wordDraft]);

  const handleSaveWord = useCallback(async () => {
    if (sessionId === 'new' || isSavingWord || !wordDirty) return;
    setIsSavingWord(true);
    try {
      await saveWordDoc(wordDraft);
      setWordSavedSnapshot(wordDraft);
      setWordMode('preview');
    } finally {
      setIsSavingWord(false);
    }
  }, [sessionId, isSavingWord, wordDirty, saveWordDoc, wordDraft]);

  const handleExportPpt = useCallback(() => {
    if (sessionId === 'new' || isExporting || anyImageSaving || pages.length === 0) return;

    const isCustomTheme =
      pendingThemeKey === CUSTOM_KEY ||
      (pendingThemeKey === null && appliedThemeName === '自定义' && !!appliedThemeColors);

    const themeKeyToSend = !isCustomTheme && pendingThemeKey ? pendingThemeKey : undefined;
    const customColorsToSend = isCustomTheme ? (appliedThemeColors ?? undefined) : undefined;
    exportCourseware(themeKeyToSend, customColorsToSend);
  }, [
    sessionId,
    isExporting,
    anyImageSaving,
    pages.length,
    pendingThemeKey,
    appliedThemeName,
    appliedThemeColors,
    exportCourseware,
  ]);
  
  const fetchKbDocs = useCallback(async () => {
    try {
      const res = await listKnowledgeDocs(1, 50);
      setKbDocs(res?.items || []);
    } catch (e) {
      console.error('Failed to load KB docs', e);
    }
  }, []);

  useEffect(() => {
    fetchKbDocs();
  }, [fetchKbDocs]);

  // Poll while any doc is still being vectorized
  useEffect(() => {
    const hasPending = kbDocs.some((d: any) => d.status === 'pending' || d.status === 'processing');
    if (!hasPending) return;
    const timer = setInterval(fetchKbDocs, 3000);
    return () => clearInterval(timer);
  }, [kbDocs, fetchKbDocs]);

  const handleToggleLink = async (docId: string, isLinked: boolean) => {
    if (sessionId === 'new') {
      alert('请先创建会话，再管理关联资料');
      return;
    }
    
    setLinkingDocs(prev => new Set(prev).add(docId));
    try {
      if (isLinked) {
        // Use session_file_id for the DELETE endpoint (not document_id)
        const fileId = docToFileId.get(docId) ?? docId;
        await removeReference(sessionId, fileId);
        setLinkedDocs(prev => {
          const next = new Set(prev);
          next.delete(docId);
          return next;
        });
        setDocToFileId(prev => {
          const next = new Map(prev);
          next.delete(docId);
          return next;
        });
      } else {
        // CRITICAL FIX: /references uses SET semantics on the backend.
        // Passing only [docId] would delete all previously bound documents.
        // We must pass ALL currently linked docs + the new one.
        const allDocIds = [...Array.from(linkedDocs), docId];
        await addReferences(sessionId, allDocIds);
        setLinkedDocs(prev => new Set(prev).add(docId));

        // Refresh docToFileId so the new doc's session_file_id is available for unbinding.
        getSession(sessionId).then(res => {
          const associated: any[] = res?.associated_files || [];
          const mapping = new Map<string, string>();
          associated.forEach((entry: any) => {
            if (typeof entry === 'string') {
              // old plain-string format 鈥?no session_file_id available
            } else if (entry?.document_id && entry?.session_file_id) {
              mapping.set(entry.document_id, entry.session_file_id);
            }
          });
          setDocToFileId(mapping);
        }).catch(() => { /* non-critical 鈥?document_id fallback still works */ });
      }
    } catch (e) {
      alert(isLinked ? '资料解绑失败，请重试。' : '资料关联失败，请重试。');
    } finally {
      setLinkingDocs(prev => {
        const next = new Set(prev);
        next.delete(docId);
        return next;
      });
    }
  };

  const handleKbUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ''; // reset so same file can be re-selected
    setIsUploadingKb(true);
    try {
      await uploadKnowledgeDoc(file, { subject: '閫氱敤绫荤洰' });
      await fetchKbDocs();
    } catch {
      alert('上传失败，请检查文件格式或网络（支持 PDF / DOCX / PPTX / TXT / MD）');
    } finally {
      setIsUploadingKb(false);
    }
  };

  const handleKbFilesDrop = async (files: FileList) => {
    const valid = Array.from(files).filter(f =>
      ['.pdf', '.docx', '.doc', '.pptx', '.ppt', '.txt', '.md'].some(ext => f.name.toLowerCase().endsWith(ext))
    );
    if (!valid.length) { alert('仅支持 PDF / DOCX / PPTX / TXT / MD 格式文件'); return; }
    setIsUploadingKb(true);
    try {
      await Promise.all(valid.map(f => uploadKnowledgeDoc(f, { subject: '閫氱敤绫荤洰' })));
      await fetchKbDocs();
    } catch {
      alert('上传失败，请检查文件格式或网络');
    } finally {
      setIsUploadingKb(false);
    }
  };

  // Load linked docs when session changes, then also clear transient state
  useEffect(() => {
    setLinkedDocs(new Set());
    setDocToFileId(new Map());
    setLinkingDocs(new Set());
    setInputText('');
    setSelectionText('');

    if (sessionId && sessionId !== 'new') {
      let active = true;
      getSession(sessionId).then(res => {
        if (!active) return;
        // API 2.3 (updated): associated_files is an array of objects
        // Each object: { session_file_id, document_id, filename, status }
        const associated: any[] = res?.associated_files || [];
        
        const docIds = new Set<string>();
        const mapping = new Map<string, string>();

        associated.forEach((entry: any) => {
          // Support both old format (plain string id) and new object format
          if (typeof entry === 'string') {
            docIds.add(entry);
          } else if (entry?.document_id) {
            docIds.add(entry.document_id);
            if (entry.session_file_id) {
              mapping.set(entry.document_id, entry.session_file_id);
            }
          }
        });

        setLinkedDocs(docIds);
        setDocToFileId(mapping);
        // 璇诲彇 course_name 浣滀负椤甸潰鏍囬
        if (res?.course_name) setSessionTitle(res.course_name);

        // 鈥斺€?搴旂敤鍚庣杩斿洖鐨?ppt_theme锛岃鐩?localStorage 鍗犱綅绗?鈥斺€?
        const pptTheme = res?.ppt_theme;
        if (pptTheme?.resolved_colors) {
          const isCustomTheme = !!pptTheme.custom_colors;
          const selectedThemeKey = isCustomTheme ? CUSTOM_KEY : (pptTheme.theme_key ?? null);
          const displayName = resolveThemeDisplayName(pptTheme.theme_key ?? null, isCustomTheme);
          setAppliedThemeColors(pptTheme.resolved_colors);
          setAppliedThemeName(displayName);
          setPendingThemeKey(selectedThemeKey);
          // ???? localStorage ??
          try {
            localStorage.setItem(`eduagent_ppt_colors_${sessionId}`, JSON.stringify(pptTheme.resolved_colors));
            localStorage.setItem(`eduagent_ppt_name_${sessionId}`, displayName);
          } catch { /* ignore quota errors */ }
        }
      }).catch(e => console.warn('Failed to load linked docs for session', e));
      return () => { active = false; };
    }
    // 鏂板缓妯″紡娓呴櫎鏍囬
    if (sessionId === 'new') setSessionTitle('');
  }, [sessionId, resolveThemeDisplayName]);

  // 鐩戝惉 Sidebar 閲嶅懡鍚嶆搷浣滐紝鍚屾鏇存柊椤堕儴鏍囬
  useEffect(() => {
    const handleRenamed = (e: Event) => {
      const { sessionId: renamedId, courseName } = (e as CustomEvent).detail ?? {};
      if (renamedId === sessionId && courseName) {
        setSessionTitle(courseName);
      }
    };
    window.addEventListener('EduAgent_Session_Renamed', handleRenamed);
    return () => window.removeEventListener('EduAgent_Session_Renamed', handleRenamed);
  }, [sessionId]);

  // 鍐呰仈鏍囬缂栬緫 handlers
  const startTitleEdit = () => {
    setTitleDraft(sessionTitle);
    setTitleEditing(true);
    setTimeout(() => titleInputRef.current?.select(), 30);
  };

  const commitTitleEdit = async () => {
    const trimmed = titleDraft.trim();
    if (!trimmed || trimmed === sessionTitle || sessionId === 'new') {
      setTitleEditing(false);
      return;
    }
    setTitleSaving(true);
    try {
      await renameSession(sessionId, trimmed);
      setSessionTitle(trimmed);
      // 閫氱煡 Sidebar 鍚屾鏇存柊鍒楄〃鏍囬
      window.dispatchEvent(
        new CustomEvent('EduAgent_Session_Renamed', {
          detail: { sessionId, courseName: trimmed },
        })
      );
    } catch {
      // 澶辫触鏃朵繚鐣欐棫鏍囬
    } finally {
      setTitleSaving(false);
      setTitleEditing(false);
    }
  };

  // Auto scroll to bottom only if user hasn't scrolled up
  const shouldAutoScroll = useRef(true);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const isNearBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 100;
    shouldAutoScroll.current = isNearBottom;
  };

  useEffect(() => {
    if (shouldAutoScroll.current) {
      const el = messageStreamRef.current;
      if (el) {
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      }
    }
  }, [messages]);

  // Focus Hijacking: Auto-switch to PPT tab when AI is generating it via tools
  useEffect(() => {
    const handleGenerateStart = (e: Event) => {
       const ev = e as CustomEvent;
       if (ev.detail?.sessionId === sessionId) {
          console.log('[Focus Hijack] Tool Call detected, auto-switching to PPT.');
          setActiveTab('ppt');
       }
    };
    const handleStartStreaming = async (e: Event) => {
       const ev = e as CustomEvent;
       if (ev.detail?.sessionId === sessionId) {
          console.log('[Stream Trigger] Tool requested streaming, switching to PPT and starting stream.');
          setActiveTab('ppt');
          // 鍏ㄩ噺閲嶇敓鎴愶細鍏堟竻绌烘棫棰勮锛岄伩鍏嶆柊鏃ч〉鍙犲姞娓叉煋
          clearPages();
          await startStreaming(Array.from(linkedDocs), ev.detail.mode || 'depth');
          fetchPreview();
       }
    };

    window.addEventListener('EduAgent_Generate_Start', handleGenerateStart);
    window.addEventListener('EduAgent_Start_Streaming', handleStartStreaming);
    
    // Auto-stop stream if session changes? (handled by usePPTStream internally but good to be explicit here)
    if (isStreaming && sessionId === 'new') stopStreaming();

    // Intent-based fallback
    if (latestIntent && sessionId !== 'new') {
      const intentLower = latestIntent.toLowerCase();
      if (intentLower.includes('generate_courseware') || intentLower.includes('generate_ppt')) {
        setActiveTab('ppt');
      }
    }
    
    return () => {
       window.removeEventListener('EduAgent_Generate_Start', handleGenerateStart);
       window.removeEventListener('EduAgent_Start_Streaming', handleStartStreaming);
    };
  }, [latestIntent, sessionId, isStreaming, stopStreaming, startStreaming, linkedDocs, fetchPreview]);

  // 鈹€鈹€ 娓告垙 SSE 浜嬩欢鐩戝惉 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
  useEffect(() => {
    lastGameTriggerSignatureRef.current = null;
    const handleGameSuggest = (e: Event) => {
      const ev = e as CustomEvent;
      if (ev.detail?.sessionId === sessionId) {
        setPendingSuggest(ev.detail.data);
        setActiveTab('games');
      }
    };
    const handleGameTrigger = (e: Event) => {
      const ev = e as CustomEvent;
      if (ev.detail?.sessionId === sessionId) {
        const spec = ev.detail.spec as GameSpec | undefined;
        if (!spec) return;

        const signature = JSON.stringify({
          task_id: spec.task_id ?? null,
          game_id: spec.game_id ?? null,
          game_type: spec.game_type ?? null,
          title: spec.title ?? null,
          is_refinement: !!spec.is_refinement,
          refinement_instruction: spec.refinement_instruction ?? null,
        });

        if (signature === lastGameTriggerSignatureRef.current) return;
        lastGameTriggerSignatureRef.current = signature;
        setPendingTrigger(spec);
        setActiveTab('games');
      }
    };
    window.addEventListener('EduAgent_Game_Suggest', handleGameSuggest);
    window.addEventListener('EduAgent_Game_Trigger', handleGameTrigger);
    return () => {
      window.removeEventListener('EduAgent_Game_Suggest', handleGameSuggest);
      window.removeEventListener('EduAgent_Game_Trigger', handleGameTrigger);
    };
  }, [sessionId]);

  // Bug Fix: Sync Database Changes (like addslide tool execution) to PPT Preview 
  // Triggered when AI finishes talking / executing tools.
  useEffect(() => {
    if (!isSynthesizing && sessionId !== 'new' && sessionId) {
      console.log('[Sync] AI completed synthesis/tools, checking for PPT updates.');
      // Adding a slight delay to ensure DB transaction commits before fetch
      setTimeout(() => fetchPreview(true), 500);
    }
  }, [isSynthesizing, fetchPreview, sessionId]);

  const handleSubmit = () => {
    const text = inputText.trim();
    if (text && !isSynthesizing) {
      sendMessage(text);
      setInputText('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleSelection = () => {
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) {
      const text = selection.toString().trim();
      if (text) {
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        setFloatPos({
          top: rect.top - 48, // slightly above the selection
          left: rect.left + rect.width / 2
        });
        setSelectionText(text);
        return;
      }
    }
    setSelectionText('');
  };

  const handleHighlightAsk = () => {
    const brief = selectionText.length > 40 ? selectionText.substring(0, 40) + '...' : selectionText;
    setInputText(`针对内容选段：“${brief}”\n我的修改意见是：`);
    setSelectionText('');
    window.getSelection()?.removeAllRanges();
    setTimeout(() => {
      inputRef.current?.focus();
    }, 50);
  };

  return (
    <div ref={workspaceRef} className={styles.workspace}>
      
      {/* LEFT PANEL: Chat Interaction */}
      <section
        className={clsx(styles.chatPanel, mobilePane === 'chat' && styles.mobilePaneActive)}
        style={{ width: chatWidth, minWidth: CHAT_MIN, maxWidth: CHAT_MAX }}
      >
        <header className={styles.chatHeader}>
          <div className={styles.sessionInfo}>
            {sessionId === 'new' ? (
              <h2 className={styles.sessionTitle}>新建课件会话</h2>
            ) : titleEditing ? (
              /* 鍐呰仈缂栬緫妯″紡 */
              <div className={styles.titleEditRow}>
                <input
                  ref={titleInputRef}
                  className={styles.titleInput}
                  value={titleDraft}
                  onChange={e => setTitleDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') commitTitleEdit();
                    if (e.key === 'Escape') setTitleEditing(false);
                  }}
                  onBlur={commitTitleEdit}
                  disabled={titleSaving}
                  maxLength={60}
                  autoFocus
                />
                {titleSaving && <Loader2 size={14} className={styles.rotating} />}
              </div>
            ) : (
              /* 灞曠ず妯″紡锛歨over 鏄剧ず閾呯瑪 */
              <h2
                className={styles.sessionTitle}
                title="点击修改标题"
              >
                <span className={styles.sessionTitleText}>
                  {sessionTitle || '无标题会话'}
                </span>
                <button
                  className={styles.titleEditBtn}
                  onClick={startTitleEdit}
                  title="修改标题"
                >
                  <Pencil size={12} />
                </button>
              </h2>
            )}
            <span className={styles.sessionStatus}>
              {isSynthesizing ? (
                 <><Sparkles size={14} className={clsx(styles.sparkleIcon, styles.rotating)}/> 思考中...</>
              ) : (
                 <><Sparkles size={14} className={styles.sparkleIcon}/> 准备就绪</>
              )}
            </span>
          </div>
        </header>

        {sessionId === 'new' ? (
          <div className={styles.newSessionGuide}>
            <div className={styles.newSessionIconRing}>
              <Sparkles size={36} />
            </div>
            <h3 className={styles.newSessionTitle}>开始你的 AI 创作之旅</h3>
            <p className={styles.newSessionDesc}>
              新建一个会话，告诉 AI 你想设计什么课程，<br />
              即可开启协作备课之旅。
            </p>
            <div className={styles.newSessionActions}>
              <button
                className={clsx('button-primary', styles.newSessionCta)}
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('EduAgent_Open_NewSession'));
                }}
              >
                <Sparkles size={16} /> 新建课件会话
              </button>
              <button
                className={styles.newSessionGhostBtn}
                onClick={() => window.dispatchEvent(new CustomEvent('EduAgent_Open_MobileSidebar'))}
              >
                <Menu size={16} /> 查看以前的会话
              </button>
            </div>
          </div>
        ) : isLoadingHistory ? (
          /* 鈹€鈹€ 鍘嗗彶璁板綍鍔犺浇楠ㄦ灦灞?鈹€鈹€ */
          <div className={styles.historyLoadingWrapper}>
            <div className={styles.historyLoadingSpinner}>
              <Loader2 size={36} className={styles.rotating} />
            </div>
            <p className={styles.historyLoadingTitle}>正在恢复会话...</p>
            <p className={styles.historyLoadingHint}>正在从服务器加载历史对话记录</p>
            <div className={styles.loadingSkeletonGroup}>
              <div className={clsx(styles.loadingSkeleton, styles.skeletonAi)} />
              <div className={clsx(styles.loadingSkeleton, styles.skeletonUser)} />
              <div className={clsx(styles.loadingSkeleton, styles.skeletonAiLong)} />
            </div>
          </div>
        ) : (
          <>
            <div ref={messageStreamRef} className={styles.messageStream} onScroll={handleScroll}>
              {messages.length === 0 && !isSynthesizing ? (
                <div className={styles.emptyState}>
                  <div className={styles.emptyIconWrapper}>
                    <Sparkles size={32} />
                  </div>
                  <h3>您想设计什么课程？</h3>
                  <p>输入教学思路，或上传参考资料，AI 将自动进行设计与重组。</p>
                </div>
              ) : messages.length === 0 && isSynthesizing ? (
                /* AI 璇锋眰宸插彂鍑轰絾鍝嶅簲杩樻湭鍒帮細鏄剧ず绛夊緟鍔ㄧ敾 */
                <div className={styles.awaitingResponseWrapper}>
                  <div className={styles.awaitingDots}>
                    <span /><span /><span />
                  </div>
                  <p className={styles.awaitingText}>AI 正在思考中，请稍候...</p>
                </div>
              ) : (
                messages.map((msg) => (
                  <MessageBubble 
                    key={msg.id}
                    id={msg.id} 
                    role={msg.role} 
                    content={msg.content}
                    thinking={msg.thinking}
                    toolLog={msg.toolLog}
                    isThinking={msg.isThinking}
                    isTyping={msg.isTyping} 
                  />
                ))
              )}
              <div ref={streamEndRef} />
            </div>

            {/* OMNI-DOCK INPUT */}
            <div className={styles.inputDockContainer}>
              <div className={clsx(styles.omniDock, 'glass-panel', isGenerating && styles.dockDisabled)}>
                <button
                  className={clsx(styles.iconButton, styles.paperclipBtn)}
                  title="上传参考资料"
                  disabled={isGenerating || sessionId === 'new'}
                  onClick={() => handleOpenFiles('docs')}
                >
                  <Paperclip size={20} />
                </button>
                <textarea 
                  ref={inputRef}
                  className={styles.textarea} 
                  placeholder={isGenerating ? "后台正在生成课件全局结构，为保证状态一致性，暂缓文字指令..." : "描述您的教学逻辑，或者选中右侧 PPT 指定修改..."}
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  rows={3}
                  disabled={isGenerating}
                />
                <div className={styles.actionsBox}>
                  <button
                    type="button"
                    className={clsx(
                      styles.micButton,
                      isMicPressed && styles.micButtonActive,
                    )}
                    onPointerDown={(event) => {
                      event.preventDefault();
                      event.currentTarget.setPointerCapture?.(event.pointerId);
                      beginMicPress('pointer-down', event.pointerId);
                    }}
                    onPointerUp={(event) => {
                      releaseMicPress('button-up', event.pointerId);
                    }}
                    onPointerCancel={(event) => {
                      releaseMicPress('button-cancel', event.pointerId);
                    }}
                    onTouchStart={(event) => {
                      event.preventDefault();
                      beginMicPress('touch-start');
                    }}
                    onTouchEnd={(event) => {
                      event.preventDefault();
                      releaseMicPress('touch-end');
                    }}
                    onTouchCancel={(event) => {
                      event.preventDefault();
                      releaseMicPress('touch-cancel');
                    }}
                    onMouseDown={() => {
                      beginMicPress('mouse-down');
                    }}
                    onMouseUp={() => {
                      releaseMicPress('mouse-up');
                    }}
                    onLostPointerCapture={() => {
                      releaseMicPress('lost-capture');
                    }}
                    title={
                      sessionId === 'new'
                        ? '请先创建会话'
                        : !isSpeechSupported
                          ? '当前浏览器不支持语音录制'
                          : isGenerating
                            ? '生成期间禁用语音'
                            : isTranscribing
                              ? '语音转写中'
                              : '按住录音，松开发送转写'
                    }
                    disabled={!isSpeechSupported || isGenerating || isTranscribing || sessionId === 'new'}
                  >
                    <Mic size={20} />
                  </button>
                  {isSynthesizing || isStreaming ? (
                    <button
                      className={clsx('button-primary', styles.sendButton, styles.stopButton)}
                      onClick={() => {
                        stopGeneration();
                        if (isStreaming) stopStreaming();
                      }}
                      title="停止生成"
                    >
                      <Square size={18} fill="currentColor" />
                    </button>
                  ) : (
                    <button
                      className={clsx('button-primary', styles.sendButton)}
                      disabled={!inputText.trim() || isGenerating}
                      onClick={handleSubmit}
                      title="发送消息"
                    >
                      <Send size={18} />
                    </button>
                  )}
                </div>
              </div>
              {isTranscribing && (
                <p className={clsx(styles.speechError, styles.speechInfo)}>提示：语音转写中，请稍候...</p>
              )}
            </div>
          </>
        )}
      </section>

      {/* DRAG DIVIDER */}
      <div
        className={styles.divider}
        onMouseDown={handleDividerMouseDown}
        title="鎷栨嫿璋冩暣瀹藉害"
      />

      {/* RIGHT PANEL: Visual WorkSpace */}
      <section ref={visualPanelRef} className={clsx(styles.visualPanel, mobilePane !== 'chat' && styles.mobilePaneActive)}>
        {sessionId === 'new' ? (
          <div className={styles.welcomeHero}>
            <div className={styles.heroContent}>
              <div className={styles.heroBadge}>
                <Sparkles size={14} /> 全新一代智能备课
              </div>
              <h2 className={styles.heroTitle}>
                开启你的 <span>AI 创意空间</span>
              </h2>
              <p className={styles.heroDesc}>
                在这里构建、推演并沉淀你的教学想法。<br/>
                上传资料后，只需一句话就能生成多端联动排版的课件与配套讲义。
              </p>
              
              <div className={styles.heroFeatures}>
                <div className={styles.featureCard}>
                  <Library size={24} className={styles.featureIcon} />
                  <h4>全局 RAG 知识库</h4>
                  <p>无缝关联教学材料，确保 AI 提取内容精准、紧扣大纲且不发散。</p>
                </div>
                <div className={styles.featureCard}>
                  <Link size={24} className={styles.featureIcon} />
                  <h4>多端物料一致并行生成</h4>
                  <p>一键打通 PPT 骨架与 Word 完整讲义，告别机械排版与重复粘贴。</p>
                </div>
              </div>
            </div>
          </div>
        ) : (
        <div className={styles.tabsRoot}>
          <header className={styles.visualHeader}>
            <div className={styles.tabsList} role="tablist" aria-label="工作区标签">
              <button className={clsx(styles.tabsTrigger, activeTab === 'files' && styles.tabsTriggerActive)} onClick={() => { setActiveTab('files'); setMobilePane('files'); }}>资料</button>
              <button className={clsx(styles.tabsTrigger, activeTab === 'ppt' && styles.tabsTriggerActive)} onClick={() => { setActiveTab('ppt'); setMobilePane('ppt'); }}>课件</button>
              <button className={clsx(styles.tabsTrigger, activeTab === 'word' && styles.tabsTriggerActive)} onClick={() => { setActiveTab('word'); setMobilePane('more'); }}>讲义</button>
              <button className={clsx(styles.tabsTrigger, styles.gameTrigger, activeTab === 'games' && styles.tabsTriggerActive)} onClick={() => { setActiveTab('games'); setMobilePane('more'); }}>
                <Gamepad2 size={13} />
                游戏
                {(pendingSuggest || pendingTrigger) && (
                  <span className={styles.gameTabDot} />
                )}
              </button>
            </div>
            {hasVisualTools && (
            <div className={styles.visualHeaderTools}>
              {activeTab === 'ppt' && pages.length > 0 && (
                <>
                  <span className={styles.visualHeaderBadge}>{pages.length} 页</span>
                  <button
                    className={clsx(styles.headerToolBtn, styles.headerToolGhost)}
                    onClick={() => setShowThemePicker(true)}
                    title="切换课件主题"
                  >
                    <Palette size={14} />
                    <span>{currentThemeDisplayName ? `主题 · ${currentThemeDisplayName}` : '主题'}</span>
                  </button>
                  <button
                    className={clsx(styles.headerToolBtn, styles.headerToolPrimary)}
                    onClick={handleExportPpt}
                    disabled={isExporting || anyImageSaving || sessionId === 'new'}
                    title={anyImageSaving ? '图片保存中，请稍后再导出' : '使用当前主题导出 PPT'}
                  >
                    <Download size={14} className={clsx(isExporting && styles.rotating)} />
                    <span>{isExporting ? '导出中...' : '导出 PPT'}</span>
                  </button>
                </>
              )}
              {activeTab === 'word' && (persistedWordDoc || wordDirty) && (
                <>
                  {wordDirty && (
                    <span className={clsx(styles.visualHeaderBadge, styles.visualHeaderWarnBadge)}>未保存</span>
                  )}
                  <div className={styles.headerModeSwitch}>
                    <button
                      className={clsx(styles.headerModeBtn, wordMode === 'preview' && styles.headerModeBtnActive)}
                      onClick={handleWordPreview}
                    >
                      <Eye size={13} />
                      <span>预览</span>
                    </button>
                    <button
                      className={clsx(styles.headerModeBtn, wordMode === 'edit' && styles.headerModeBtnActive)}
                      onClick={handleEnterWordEdit}
                    >
                      <Pencil size={13} />
                      <span>编辑</span>
                    </button>
                  </div>
                  <button
                    className={clsx(styles.headerToolBtn, styles.headerToolGhost)}
                    onClick={handleSaveWord}
                    disabled={!wordDirty || isSavingWord || sessionId === 'new'}
                  >
                    {isSavingWord ? <><Loader2 size={14} className={styles.spinner} /> 保存中...</> : <><Check size={14} /> 保存</>}
                  </button>
                  <button
                    className={clsx(styles.headerToolBtn, styles.headerToolPrimary)}
                    onClick={handleExportWord}
                    disabled={isExportingWord || !wordDoc || sessionId === 'new' || wordDirty}
                    title={wordDirty ? '请先保存当前草稿，再导出 Word' : '导出 Word 讲义'}
                  >
                    {isExportingWord ? <><Loader2 size={14} className={styles.spinner} /> 导出中...</> : <><Download size={14} /> 导出 Word</>}
                  </button>
                </>
              )}
            </div>
            )}
          </header>

          {activeTab === 'files' && (
          <div className={styles.tabsContent}>
            <div ref={filesTabRef} className={styles.tabViewport}>
            <div className={clsx(styles.kbPanel, filesHighlight && styles.kbPanelHighlight)}>
              {/* 瀛?Tab 鍒囨崲锛堢煡璇嗗簱鏂囨。 / 鍥剧墖绱犳潗锛?*/}
              <div className={styles.subTabBar}>
                <button
                  className={clsx(styles.subTabBtn, filesSubTab === 'docs' && styles.subTabActive)}
                  onClick={() => setFilesSubTab('docs')}
                >
                  <Library size={14} /> 文档库
                </button>
                <button
                  className={clsx(styles.subTabBtn, filesSubTab === 'images' && styles.subTabActive)}
                  onClick={() => setFilesSubTab('images')}
                >
                  <ImageIcon size={14} /> 图片
                </button>
                <button
                  className={styles.manageAssetsBtn}
                  onClick={() => navigate('/assets', { state: { fromWorkspace: true, sessionId, subTab: filesSubTab } })}
                >
                  <FolderOpen size={14} /> 管理素材
                </button>
              </div>

              {/* 鐭ヨ瘑搴撴枃妗ｉ潰鏉?*/}
              {filesSubTab === 'docs' && (
                <>
                  {/* 鎷栨嫿涓婁紶鍖?*/}
                  <div
                    className={clsx(styles.kbDropzone, isDraggingKb && styles.kbDropzoneDragging, isUploadingKb && styles.kbDropzoneUploading)}
                    onDrop={(e) => { e.preventDefault(); setIsDraggingKb(false); if (e.dataTransfer.files.length) handleKbFilesDrop(e.dataTransfer.files); }}
                    onDragOver={(e) => { e.preventDefault(); setIsDraggingKb(true); }}
                    onDragLeave={() => setIsDraggingKb(false)}
                    onClick={() => !isUploadingKb && kbFileInputRef.current?.click()}
                    role="button"
                    tabIndex={0}
                    aria-label="点击或拖拽文档到此处上传"
                  >
                    <input
                      ref={kbFileInputRef}
                      type="file"
                      accept=".pdf,.docx,.doc,.pptx,.ppt,.txt,.md"
                      style={{ display: 'none' }}
                      onChange={handleKbUpload}
                    />
                    {isUploadingKb ? (
                      <><Loader2 size={20} className={styles.spinner} /> <span>上传中...</span></>
                    ) : isDraggingKb ? (
                      <><UploadCloud size={20} /> <span>松开即可上传</span></>
                    ) : (
                      <><UploadCloud size={18} /> <span>拖拽 / 点击上传文档</span><small>PDF · DOCX · PPTX · TXT · MD</small></>
                    )}
                  </div>

                  {kbDocs.length === 0 ? (
                    <div className={styles.placeholderCentric}>
                      暂无知识库文档，拖拽或点击上方区域添加
                    </div>
                  ) : (
                    <div className={styles.kbList}>
                      {kbDocs.map((doc: any) => {
                        const isLinked = linkedDocs.has(doc.document_id);
                        const isLinking = linkingDocs.has(doc.document_id);
                        const isCompleted = doc.status === 'completed' || !doc.status;
                        const isFailed   = doc.status === 'failed';
                        const isProcessing = doc.status === 'processing';
                        const isPending  = doc.status === 'pending';
                        return (
                          <div key={doc.document_id} className={clsx(styles.kbListItem, 'glass-panel')}>
                            <div className={styles.kbItemInfo}>
                              <FileText size={18} className={styles.docIcon} />
                              <div className={styles.kbItemTextWrap}>
                                <h4 className={styles.kbItemTitle} title={doc.filename}>{doc.filename}</h4>
                                <div className={styles.kbItemMetaRow}>
                                  <span className={styles.kbItemMeta}>{doc.subject || '通用类目'}</span>
                                  {isCompleted && (
                                    <span className={clsx(styles.docStatusBadge, styles.statusCompleted)}>
                                      <CheckCircle size={10} /> 已向量化
                                    </span>
                                  )}
                                  {isProcessing && (
                                    <span className={clsx(styles.docStatusBadge, styles.statusProcessing)}>
                                      <Loader2 size={10} className={styles.spinner} /> 向量化中...
                                    </span>
                                  )}
                                  {isPending && (
                                    <span className={clsx(styles.docStatusBadge, styles.statusPending)}>
                                      <Clock size={10} /> 等待处理
                                    </span>
                                  )}
                                  {isFailed && (
                                    <span className={clsx(styles.docStatusBadge, styles.statusFailed)}>
                                      <AlertCircle size={10} /> 失败
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                            <div className={styles.kbItemActions}>
                              {isFailed ? (
                                <span className={styles.failedLabel}>
                                  <AlertCircle size={13} /> 不可关联
                                </span>
                              ) : (
                                <button
                                  className={clsx(
                                    isLinked
                                      ? (hoveredLinkDoc === doc.document_id ? styles.btnUnlinkHover : styles.btnLinked)
                                      : 'button-primary',
                                    styles.actionBtn
                                  )}
                                  disabled={isLinking || sessionId === 'new' || !isCompleted}
                                  onClick={() => handleToggleLink(doc.document_id, isLinked)}
                                  onMouseEnter={() => setHoveredLinkDoc(doc.document_id)}
                                  onMouseLeave={() => setHoveredLinkDoc(null)}
                                  title={!isCompleted ? '向量化完成后方可关联' : isLinked ? '点击解除绑定' : '点击加入会话'}
                                >
                                  {isLinking ? (
                                    <><Loader2 size={14} className={styles.spinner} /> 变更中...</>
                                  ) : !isCompleted ? (
                                    <><Clock size={14} /> 处理中...</>
                                  ) : isLinked ? (
                                    hoveredLinkDoc === doc.document_id ? (
                                      <><Unlink size={14} /> 取消绑定</>
                                    ) : (
                                      <><CheckCircle size={14} /> 已绑定</>
                                    )
                                  ) : (
                                    <><Link size={14} /> 加入会话</>
                                  )}
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}

              {/* 鍥剧墖绱犳潗闈㈡澘 */}
              {filesSubTab === 'images' && (
                <ImageUploadPanel />
              )}
            </div>
            </div>
          </div>
          )}
          
          {activeTab === 'ppt' && (
          <div className={styles.tabsContent}>
            <div ref={pptTabRef} className={styles.tabViewport}>
            <div
              className={styles.canvasArea}
              style={appliedThemeColors ? {
                '--ppt-bg':        appliedThemeColors.bg_color,
                '--ppt-primary':   appliedThemeColors.primary,
                '--ppt-secondary': appliedThemeColors.secondary,
                '--ppt-accent':    appliedThemeColors.accent,
                '--ppt-text':      appliedThemeColors.text_color,
              } as React.CSSProperties : {}}
            >
              {/* 鈹€鈹€ PPT 棰勮鍐呴儴宸ュ叿鏍忥細鍒囨崲涓婚鍏ュ彛 鈹€鈹€ */}
              {pages.length > 0 && !isStreaming && (
                <div className={styles.stickyTopbarShell}>
                  <div className={clsx(styles.workspaceTopbar, styles.workspaceTopbarPpt)}>
                    <div className={styles.topbarPrimary}>
                      <div className={styles.topbarEyebrow}>课件预览</div>
                      <div className={styles.topbarHeadlineRow}>
                        <h3 className={styles.topbarTitle}>当前课件已生成</h3>
                        <span className={styles.topbarCountPill}>{pages.length} 页幻灯片</span>
                      </div>
                      <p className={styles.topbarDescription}>
                        顶栏固定在上方，滚动浏览页面时仍可快速切换主题或直接导出。
                      </p>
                    </div>

                    <div className={styles.topbarActions}>
                      <button
                        className={clsx(styles.topbarActionBtn, styles.topbarGhostAction)}
                        onClick={() => {
                          setShowThemePicker(true);
                        }}
                        title="切换课件主题"
                      >
                        <Palette size={15} />
                        <span>切换主题</span>
                      </button>

                      {currentThemeDisplayName && (
                        <span
                          className={styles.topbarThemeChip}
                          style={{
                            background: appliedThemeColors
                              ? `linear-gradient(135deg, ${appliedThemeColors.primary}, ${appliedThemeColors.accent})`
                              : undefined,
                            color: appliedThemeColors ? '#fff' : undefined,
                          }}
                        >
                          当前主题 · {currentThemeDisplayName}
                        </span>
                      )}

                      <button
                        className={clsx(styles.topbarActionBtn, styles.topbarPrimaryAction)}
                        onClick={handleExportPpt}
                        disabled={isExporting || anyImageSaving || sessionId === 'new'}
                        title={anyImageSaving ? '图片保存中，请稍后再导出' : '使用当前主题导出 PPT'}
                      >
                        <Download size={15} className={clsx(isExporting && styles.rotating)} />
                        <span>{isExporting ? '导出中...' : '导出 PPT'}</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {isGenerating && !isStreaming && pages.length === 0 && streamPages.length === 0 ? (
                <div className={styles.emptyStateContainer} style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-primary)' }}>
                  <Loader2 size={48} className={styles.rotating} style={{ marginBottom: '16px', color: 'var(--accent-primary)' }} />
                  <h3 style={{ marginBottom: '12px' }}>AI 正在智能排版课件</h3>
                  <p style={{ maxWidth: '420px', textAlign: 'center', lineHeight: '1.6', color: 'var(--text-secondary)' }}>
                    大模型正在深度重组知识结构，并为您渲染多端图文排版。<br/>
                    该过程较消耗算力，约需 <strong>80-90 秒</strong>。<br/>
                    您可以切回左侧处理其他会话，后台生成不会中断。
                  </p>
                </div>
              ) : previewStatus === 'error' && !isStreaming && pages.length === 0 ? (
                <div className={styles.emptyStateContainer} style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-primary)' }}>
                  <span style={{ fontSize: '48px', marginBottom: '16px' }}>⚠</span>
                  <h3 style={{ marginBottom: '12px' }}>课件加载中断</h3>
                  <p style={{ maxWidth: '380px', textAlign: 'center', lineHeight: '1.6', color: 'var(--text-secondary)', marginBottom: '20px' }}>
                    此时无法拉取课件预览。这很可能是后端发生了数据异常，或者生成的课件结构缺少必要字段而被拒绝。
                  </p>
                  <button
                    className='button-primary'
                    onClick={() => {
                      // 鍏ㄩ噺閲嶇敓鎴愶細鍏堟竻绌烘棫棰勮锛岄伩鍏嶆柊鏃ч〉鍙犲姞娓叉煋
                      clearPages();
                      startStreaming(Array.from(linkedDocs), 'fast', true);
                    }}
                    disabled={sessionId === 'new'}
                    style={{ padding: '10px 24px' }}
                  >
                    重新生成
                  </button>
                </div>
              ) : (
                <>
                  {/* Render existing stable pages */}
                  {pages.map(page => (
                    <PPTCard 
                      key={page.page_index} 
                      page={page}
                      sessionId={sessionId}
                      isUpdating={updatingPages.has(page.page_index)}
                      isStreaming={isStreaming}
                      onIterate={(instruction) => iteratePage(page.page_index, instruction)}
                      onManualSave={(pageIndex, updated) => updatePageLocally(pageIndex, updated)}
                      onApplyLayout={(layoutType) => applyLayoutAndRefresh(page.page_index, layoutType)}
                      onImageResolved={(elementId, imageId, previewUrl) =>
                        resolveImageInPage(page.page_index, elementId, imageId, previewUrl)
                      }
                      onSavingImageChange={(saving) => setAnyImageSaving(saving)}
                    />
                  ))}
                  
                  {/* Render streaming pages (retain during transition before fetchPreview finishes) */}
                  {streamPages.map(page => {
                     // Deduplicate if pages hasn't synced yet
                     if (pages.some(p => p.page_index === page.page_index)) return null;
                     return (
                       <PPTCard 
                         key={page.page_index} 
                         page={page}
                         sessionId={sessionId}
                         isUpdating={false}
                         isStreaming={true}
                         onIterate={() => {}} // Disabled during stream for stability
                       />
                     );
                  })}
                  
                  {/* Render the next page skeleton */}
                  {isStreaming && (
                    <PPTSkeleton 
                      pageNumber={(streamPages.length || pages.length) + 1} 
                      streamThinking={streamThinking}
                    />
                  )}

                  {/* Empty State */}
                  {pages.length === 0 && !isStreaming && !isGenerating && (
                    <div className={styles.emptyStateContainer} style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)', opacity: 0.6 }}>
                      <Sparkles size={48} style={{ marginBottom: '16px' }} />
                      <h3>课件待生成</h3>
                      <p>请点击右上角“AI 一键生成课件”开始</p>
                    </div>
                  )}
                  
                  {streamError && !isStreaming && (
                    <div className={styles.streamErrorToast}>
                      提示：{streamError}
                    </div>
                  )}
                </>
              )}
            </div>
            </div>
          </div>
          )}
          
          {activeTab === 'word' && (
          <div className={styles.tabsContent}>
            <div ref={wordTabRef} className={styles.tabViewport}>
            {(persistedWordDoc || wordDirty) && (
              <div className={styles.stickyTopbarShell}>
                <div className={clsx(styles.workspaceTopbar, styles.workspaceTopbarWord)}>
                  <div className={styles.topbarPrimary}>
                    <div className={styles.topbarEyebrow}>讲义工作台</div>
                    <div className={styles.topbarHeadlineRow}>
                      <h3 className={styles.topbarTitle}>
                        {wordMode === 'edit' ? '正在编辑讲义草稿' : wordDirty ? '正在预览未保存草稿' : '正在预览已保存讲义'}
                      </h3>
                      {wordDirty ? (
                        <span className={clsx(styles.topbarStatusPill, styles.statusWarnPill)}>未保存更改</span>
                      ) : (
                        <span className={clsx(styles.topbarStatusPill, styles.statusOkPill)}>已保存</span>
                      )}
                    </div>
                    <p className={styles.topbarDescription}>
                      预览和编辑共用同一份草稿。切去预览不会丢内容，只有点击保存才会写回讲义正文。
                    </p>
                  </div>
                  <div className={styles.topbarActions}>
                    <div className={styles.modeSwitch}>
                      <button
                        className={clsx(styles.modeSwitchBtn, wordMode === 'preview' && styles.modeSwitchBtnActive)}
                        onClick={handleWordPreview}
                      >
                        <Eye size={14} /> 预览
                      </button>
                      <button
                        className={clsx(styles.modeSwitchBtn, wordMode === 'edit' && styles.modeSwitchBtnActive)}
                        onClick={handleEnterWordEdit}
                      >
                        <Pencil size={14} /> 编辑
                      </button>
                    </div>
                    <button
                      className={clsx(styles.topbarActionBtn, styles.topbarSoftAction)}
                      onClick={handleSaveWord}
                      disabled={!wordDirty || isSavingWord || sessionId === 'new'}
                    >
                      {isSavingWord ? <><Loader2 size={14} className={styles.spinner} /> 保存中...</> : <><Check size={14} /> 保存</>}
                    </button>
                    <button
                      className={clsx(styles.topbarActionBtn, styles.topbarPrimaryAction)}
                      onClick={handleExportWord}
                      disabled={isExportingWord || !wordDoc || sessionId === 'new' || wordDirty}
                      title={wordDirty ? '请先保存当前草稿，再导出 Word' : '导出 Word 讲义'}
                    >
                      {isExportingWord ? <><Loader2 size={14} className={styles.spinner} /> 导出中...</> : <><Download size={14} /> 导出 Word</>}
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className={clsx(styles.wordDoc, 'glass-panel')}>
              {isGenerating && !isStreaming ? (
                <div className={styles.emptyStateContainer} style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-primary)' }}>
                  <Loader2 size={48} className={styles.rotating} style={{ marginBottom: '16px', color: 'var(--accent-primary)' }} />
                  <h3 style={{ marginBottom: '12px' }}>AI 正在提炼讲义长文</h3>
                  <p style={{ maxWidth: '420px', textAlign: 'center', lineHeight: '1.6', color: 'var(--text-secondary)' }}>
                    大模型正在为您扩写与课件配套的完整教学讲义文稿。<br/>
                    该并行流处理大约需要 <strong>80-90 秒</strong>。<br/>
                    请稍作等待，整套资料链路即可完成闭环。
                  </p>
                </div>
              ) : wordMode === 'edit' ? (
                <textarea
                  ref={wordEditRef}
                  className={styles.wordEditTextarea}
                  value={wordDraft}
                  onChange={e => setWordDraft(e.target.value)}
                  placeholder="在此处编辑 Markdown 讲义内容..."
                  spellCheck={false}
                />
              ) : displayedWordDoc ? (
                <div className={styles.markdownWrapper} onMouseUp={handleSelection} ref={wordDocRef}>
                  <ReactMarkdown 
                    remarkPlugins={[remarkGfm, remarkMath]} 
                    rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false }], rehypeRaw]}
                  >
                    {displayedWordDoc}
                  </ReactMarkdown>
                </div>
              ) : (
                <div className={styles.emptyStateContainer} style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)', opacity: 0.6 }}>
                  <Sparkles size={48} style={{ marginBottom: '16px' }} />
                  <h3>讲义待生成</h3>
                  <p>随课件一并产出，请先生成课件</p>
                </div>
              )}
            </div>
            
            {/* FLOATING ACTION BUTTON */}
            {selectionText && (
              <button 
                className={clsx(styles.floatActionBtn, 'glass-panel')}
                style={{ top: floatPos.top, left: floatPos.left }}
                onClick={handleHighlightAsk}
              >
                针对此划词发起修改
              </button>
            )}
            </div>
          </div>
          )}

          {/* 鈹€鈹€ 浜掑姩灏忔父鎴?Tab 鈹€鈹€ */}
          {activeTab === 'games' && (
          <div className={styles.tabsContent}>
            <div ref={gamesTabRef} className={styles.tabViewport}>
            {sessionId !== 'new' && (
              <GamePanel
                sessionId={sessionId}
                pendingSuggest={pendingSuggest}
                pendingTrigger={pendingTrigger}
                onClearSuggest={() => setPendingSuggest(null)}
                onClearTrigger={() => setPendingTrigger(null)}
                onActiveGameChange={setActiveGameId}
                mobileImmersive
              />
            )}
            {sessionId === 'new' && (
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', height: '100%', gap: 12,
                color: 'var(--text-tertiary)',
              }}>
                <Gamepad2 size={36} style={{ opacity: 0.3 }} />
                <p style={{ margin: 0, fontSize: 14, fontWeight: 500, color: 'var(--text-secondary)' }}>
                  请先创建会话
                </p>
                  <small style={{ fontSize: 12 }}>互动游戏功能需要在活跃会话中使用</small>
              </div>
            )}
            </div>
          </div>
          )}
        </div>
        )}
      </section>

      {/* 鈹€鈹€ PPT 涓婚閫夎壊鍣?Overlay 鈹€鈹€ */}
      {showThemePicker && (
        <ThemePicker
          mode="apply"
          selectedKey={pendingThemeKey}
          onSelect={setPendingThemeKey}
          onConfirm={(themeKey, customColors, resolvedColors) => {
            setShowThemePicker(false);
            if (resolvedColors) setAppliedThemeColors(resolvedColors);
            const displayName = resolveThemeDisplayName(themeKey === CUSTOM_KEY ? null : themeKey, themeKey === CUSTOM_KEY);
            setAppliedThemeName(displayName);

            if (resolvedColors && sessionId !== 'new') {
              try {
                localStorage.setItem(`eduagent_ppt_colors_${sessionId}`, JSON.stringify(resolvedColors));
                localStorage.setItem(`eduagent_ppt_name_${sessionId}`, displayName);
              } catch { /* ignore quota errors */ }
            }

            if (sessionId !== 'new') {
              const keyToSave = themeKey === CUSTOM_KEY ? null : themeKey;
              const colorsToSave = themeKey === CUSTOM_KEY ? customColors : undefined;
              saveSessionTheme(sessionId, keyToSave, colorsToSave)
                .catch(err => console.warn('[Theme] persist failed (preview unaffected)', err));
            }
          }}
          onCancel={() => setShowThemePicker(false)}
        />
      )}

      {sessionId !== 'new' && !(activeTab === 'games' && activeGameId) && (
        <nav className={styles.mobileWorkspaceNav}>
          <button
            className={styles.mobileWorkspaceNavBtn}
            onClick={() => window.dispatchEvent(new CustomEvent('EduAgent_Open_MobileSidebar'))}
          >
            <Menu size={16} />
            <span>会话</span>
          </button>
          <button
            className={clsx(styles.mobileWorkspaceNavBtn, mobilePane === 'chat' && styles.mobileWorkspaceNavBtnActive)}
            onClick={() => setMobilePane('chat')}
          >
            <Sparkles size={16} />
            <span>对话</span>
          </button>
          <button
            className={clsx(styles.mobileWorkspaceNavBtn, mobilePane === 'files' && styles.mobileWorkspaceNavBtnActive)}
            onClick={() => {
              setActiveTab('files');
              setMobilePane('files');
              setFilesSubTab('docs');
            }}
          >
            <Library size={16} />
            <span>资料</span>
          </button>
          <button
            className={clsx(styles.mobileWorkspaceNavBtn, mobilePane === 'ppt' && styles.mobileWorkspaceNavBtnActive)}
            onClick={() => {
              setActiveTab('ppt');
              setMobilePane('ppt');
            }}
          >
            <Palette size={16} />
            <span>课件</span>
          </button>
        </nav>
      )}

    </div>
  );
}


