import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getApiErrorMessage, transcribeAudio } from '../utils/api';

interface UseSpeechRecognitionResult {
  isRecording: boolean;
  isSupported: boolean;
  isTranscribing: boolean;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  transcript: string;
  error: string | null;
}

const MIME_TYPE_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
];

const resolveSupportedMimeType = () => {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return '';
  }

  return MIME_TYPE_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
};

export function useSpeechRecognition(
  sessionId: string,
  onTranscript: (text: string) => void,
): UseSpeechRecognitionResult {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mountedRef = useRef(true);
  const isStartingRef = useRef(false);
  const isFinalizingRef = useRef(false);
  const stopFallbackTimerRef = useRef<number | null>(null);
  const stopRequestedRef = useRef(false);
  const startedAtRef = useRef(0);

  const isSupported = useMemo(() => {
    return typeof window !== 'undefined'
      && typeof navigator !== 'undefined'
      && !!navigator.mediaDevices?.getUserMedia
      && typeof MediaRecorder !== 'undefined';
  }, []);

  const clearStopFallbackTimer = useCallback(() => {
    if (stopFallbackTimerRef.current != null && typeof window !== 'undefined') {
      window.clearTimeout(stopFallbackTimerRef.current);
      stopFallbackTimerRef.current = null;
    }
  }, []);

  const stopTracks = useCallback(() => {
    try {
      streamRef.current?.getTracks().forEach((track) => track.stop());
    } finally {
      streamRef.current = null;
    }
  }, []);

  const finalizeRecording = useCallback(async (reason: string, mimeType: string) => {
    console.log('[voice] finalize invoked', {
      reason,
      chunkCount: chunksRef.current.length,
      recorderState: recorderRef.current?.state ?? 'missing',
    });

    if (isFinalizingRef.current) {
      console.log('[voice] finalize skipped', { reason });
      return;
    }

    isFinalizingRef.current = true;
    clearStopFallbackTimer();

    try {
      const recordedChunks = [...chunksRef.current];
      const totalBytes = recordedChunks.reduce((total, chunk) => total + chunk.size, 0);

      chunksRef.current = [];
      recorderRef.current = null;
      stopTracks();

      if (!mountedRef.current) {
        return;
      }

      setIsRecording(false);
      console.log('[voice] finalize recording', {
        reason,
        chunkCount: recordedChunks.length,
        totalBytes,
      });

      if (recordedChunks.length === 0 || totalBytes === 0) {
        setError('没有录到有效声音，请按住说话后再松开。');
        return;
      }

      const audioBlob = new Blob(recordedChunks, { type: mimeType || 'audio/webm' });
      console.log('[voice] uploading audio blob', {
        size: audioBlob.size,
        type: audioBlob.type,
      });

      setIsTranscribing(true);
      const result = await transcribeAudio(sessionId, audioBlob);
      const text = result.text?.trim() ?? '';

      if (!mountedRef.current) {
        return;
      }

      setTranscript(text);
      console.log('[voice] transcription finished', { textLength: text.length });

      if (!text) {
        setError('未识别到语音内容，请重试。');
        return;
      }

      onTranscript(text);
    } catch (err: unknown) {
      console.log('[voice] finalize failed', err);
      if (!mountedRef.current) {
        return;
      }
      setError(getApiErrorMessage(err, '语音转写失败，请稍后重试。'));
    } finally {
      if (mountedRef.current) {
        setIsRecording(false);
        setIsTranscribing(false);
      }
      isFinalizingRef.current = false;
      stopRequestedRef.current = false;
    }
  }, [clearStopFallbackTimer, onTranscript, sessionId, stopTracks]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      clearStopFallbackTimer();
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        try {
          recorderRef.current.stop();
        } catch {
          // noop
        }
      }
      stopTracks();
    };
  }, [clearStopFallbackTimer, stopTracks]);

  const startRecording = useCallback(async () => {
    console.log('[voice] start requested', { sessionId });

    if (!isSupported) {
      setError('当前浏览器不支持语音录制，请使用最新版 Chrome 或 Edge。');
      return;
    }

    if (sessionId === 'new') {
      setError('请先创建会话，再使用语音输入。');
      return;
    }

    if (isRecording || isTranscribing || isStartingRef.current || isFinalizingRef.current) {
      console.log('[voice] start skipped', {
        isRecording,
        isTranscribing,
        isStarting: isStartingRef.current,
        isFinalizing: isFinalizingRef.current,
      });
      return;
    }

    try {
      isStartingRef.current = true;
      stopRequestedRef.current = false;
      clearStopFallbackTimer();
      setError(null);
      setTranscript('');
      chunksRef.current = [];

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      console.log('[voice] media stream granted');

      const mimeType = resolveSupportedMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      streamRef.current = stream;
      recorderRef.current = recorder;

      recorder.onstart = () => {
        if (!mountedRef.current) return;
        startedAtRef.current = Date.now();
        setIsRecording(true);
        console.log('[voice] recorder started', {
          mimeType: recorder.mimeType || mimeType || 'default',
        });
      };

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
          console.log('[voice] chunk received', { size: event.data.size });
        }
      };

      recorder.onerror = (event) => {
        console.log('[voice] recorder error', event);
        clearStopFallbackTimer();
        if (mountedRef.current) {
          setError('录音过程中发生异常，请重试。');
          setIsRecording(false);
          setIsTranscribing(false);
        }
        stopTracks();
      };

      recorder.onstop = () => {
        console.log('[voice] recorder onstop fired');
        void finalizeRecording('onstop', recorder.mimeType || mimeType || 'audio/webm');
      };

      recorder.start();

      if (stopRequestedRef.current && recorder.state !== 'inactive') {
        console.log('[voice] stop requested before recorder fully started');
        try {
          recorder.requestData();
        } catch {
          // noop
        }
        recorder.stop();
      }
    } catch (err) {
      stopRequestedRef.current = false;
      stopTracks();
      recorderRef.current = null;
      setIsRecording(false);

      const mediaError = err as DOMException | undefined;
      console.log('[voice] failed to start recorder', { name: mediaError?.name });

      if (mediaError?.name === 'NotAllowedError') {
        setError('麦克风权限被拒绝，请在浏览器地址栏中允许麦克风访问。');
      } else if (mediaError?.name === 'NotFoundError') {
        setError('未检测到可用麦克风设备。');
      } else {
        setError('无法启动录音，请检查浏览器权限或设备状态。');
      }
    } finally {
      isStartingRef.current = false;
    }
  }, [clearStopFallbackTimer, finalizeRecording, isRecording, isSupported, isTranscribing, sessionId, stopTracks]);

  const stopRecording = useCallback(() => {
    stopRequestedRef.current = true;

    const recorder = recorderRef.current;
    console.log('[voice] stop requested', { state: recorder?.state ?? 'missing' });

    if (!recorder || recorder.state === 'inactive') {
      return;
    }

    if (recorder.state === 'recording' && Date.now() - startedAtRef.current > 60) {
      try {
        recorder.requestData();
      } catch {
        // noop
      }
    }

    try {
      recorder.stop();
    } catch (err) {
      console.log('[voice] recorder.stop failed', err);
      void finalizeRecording('stop-exception', recorder.mimeType || 'audio/webm');
      return;
    }

    if (typeof window !== 'undefined') {
      clearStopFallbackTimer();
      stopFallbackTimerRef.current = window.setTimeout(() => {
        if (stopRequestedRef.current && !isFinalizingRef.current) {
          console.log('[voice] stop fallback triggered');
          void finalizeRecording('fallback-timeout', recorder.mimeType || 'audio/webm');
        }
      }, 500);
    }
  }, [clearStopFallbackTimer, finalizeRecording]);

  return {
    isRecording,
    isSupported,
    isTranscribing,
    startRecording,
    stopRecording,
    transcript,
    error,
  };
}
