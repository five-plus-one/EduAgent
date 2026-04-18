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
  const shouldRecordRef = useRef(false);
  const isStartingRef = useRef(false);
  const startedAtRef = useRef(0);

  const isSupported = useMemo(() => {
    return typeof window !== 'undefined'
      && typeof navigator !== 'undefined'
      && !!navigator.mediaDevices?.getUserMedia
      && typeof MediaRecorder !== 'undefined';
  }, []);

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop();
      }
      stopTracks();
    };
  }, [stopTracks]);

  const startRecording = useCallback(async () => {
    shouldRecordRef.current = true;

    if (!isSupported) {
      setError('当前浏览器不支持语音录制，请使用最新版 Chrome 或 Edge。');
      return;
    }

    if (sessionId === 'new') {
      setError('请先创建会话，再使用语音输入。');
      return;
    }

    if (isRecording || isTranscribing || isStartingRef.current) {
      return;
    }

    try {
      isStartingRef.current = true;
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
      };

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onerror = () => {
        if (!mountedRef.current) return;
        setError('录音过程中发生异常，请重试。');
        setIsRecording(false);
        setIsTranscribing(false);
        stopTracks();
      };

      recorder.onstop = async () => {
        const recordedChunks = [...chunksRef.current];
        const blobType = recorder.mimeType || mimeType || 'audio/webm';

        chunksRef.current = [];
        recorderRef.current = null;
        stopTracks();

        if (!mountedRef.current) return;

        setIsRecording(false);

        if (recordedChunks.length === 0) {
          setError('没有录到有效声音，请按住说话后再松开。');
          return;
        }

        setIsTranscribing(true);

        try {
          const audioBlob = new Blob(recordedChunks, { type: blobType });
          const result = await transcribeAudio(sessionId, audioBlob);
          const text = result.text?.trim() ?? '';

          if (!mountedRef.current) return;

          setTranscript(text);

          if (!text) {
            setError('未识别到语音内容，请重试。');
            return;
          }

          onTranscript(text);
        } catch (err: unknown) {
          if (!mountedRef.current) return;
          setError(getApiErrorMessage(err, '语音转写失败，请稍后重试。'));
        } finally {
          if (mountedRef.current) {
            setIsTranscribing(false);
          }
        }
      };

      recorder.start(250);

      if (!shouldRecordRef.current && recorder.state !== 'inactive') {
        recorder.stop();
      }
    } catch (err) {
      shouldRecordRef.current = false;
      stopTracks();
      recorderRef.current = null;
      setIsRecording(false);

      const mediaError = err as DOMException | undefined;
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
  }, [isRecording, isSupported, isTranscribing, onTranscript, sessionId, stopTracks]);

  const stopRecording = useCallback(() => {
    shouldRecordRef.current = false;
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') {
      return;
    }
    if (recorder.state === 'recording' && Date.now() - startedAtRef.current > 120) {
      try {
        recorder.requestData();
      } catch {
        // Ignore browsers that reject requestData during teardown.
      }
    }
    recorder.stop();
  }, []);

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
