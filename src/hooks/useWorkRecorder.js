import { useCallback, useEffect, useRef, useState } from 'react';
import { toTranscriptionPayload } from '../utils/audioPayload.js';

const STOP_WORDS = ['stop', 'pause', 'wait', 'actually', 'no'];

export function useWorkRecorder({ onRecording, enableStopWordDetection, onInterrupt, onLog }) {
  const [isListening, setIsListening] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const recognitionRef = useRef(null);
  const startSeqRef = useRef(0);
  const stopRequestedRef = useRef(false);
  const startedAtMsRef = useRef(0);

  const startListening = useCallback(async () => {
    if (isListening || isStarting) return;
    setIsStarting(true);
    stopRequestedRef.current = false;
    const seq = ++startSeqRef.current;

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (startSeqRef.current !== seq || stopRequestedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;

      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
      if (startSeqRef.current !== seq || stopRequestedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      recorder.onstop = async () => {
        const stoppedAtMs = Date.now();
        setIsListening(false);
        try {
          const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
          chunksRef.current = [];

          const payload = await toTranscriptionPayload(blob);
          if (payload.audioBase64) {
            onLog?.(
              payload.convertedToWav
                ? `Work segment converted to wav and sent (${blob.size} bytes source).`
                : `Work segment sent as original webm (${blob.size} bytes source).`,
              payload.convertedToWav ? 'status' : 'warning'
            );
            await onRecording(payload.audioBase64, payload.audioFormat, {
              segmentStartedAtMs: startedAtMsRef.current || null,
              segmentEndedAtMs: stoppedAtMs,
              segmentDurationMs: typeof payload.durationMs === 'number' ? payload.durationMs : null
            });
          } else {
            onLog?.('Work segment conversion failed: base64 payload empty.', 'error');
          }
        } finally {
          startedAtMsRef.current = 0;
          stream.getTracks().forEach((track) => track.stop());
          if (streamRef.current === stream) streamRef.current = null;
          if (mediaRecorderRef.current === recorder) mediaRecorderRef.current = null;
        }
      };

      recorder.start();
      startedAtMsRef.current = Date.now();
      if (startSeqRef.current !== seq || stopRequestedRef.current) {
        if (recorder.state === 'recording') recorder.stop();
        return;
      }
      setIsListening(true);
    } finally {
      if (startSeqRef.current === seq) setIsStarting(false);
    }
  }, [isListening, isStarting, onLog, onRecording]);

  const stopListening = useCallback(() => {
    stopRequestedRef.current = true;
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  }, []);

  useEffect(() => {
    if (!enableStopWordDetection) {
      recognitionRef.current?.stop?.();
      recognitionRef.current = null;
      return;
    }

    const SpeechRecognition = window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0]?.transcript?.toLowerCase() || '')
        .join(' ');

      if (STOP_WORDS.some((word) => transcript.includes(word))) {
        onInterrupt?.();
      }
    };

    recognition.onerror = () => {};
    recognition.onend = () => {
      if (enableStopWordDetection) recognition.start();
    };

    recognition.start();
    recognitionRef.current = recognition;

    return () => {
      recognition.stop();
      recognitionRef.current = null;
    };
  }, [enableStopWordDetection, onInterrupt]);

  return { isListening, isStarting, startListening, stopListening };
}
