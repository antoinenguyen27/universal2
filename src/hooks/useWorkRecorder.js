import { useCallback, useEffect, useRef, useState } from 'react';
import { toTranscriptionPayload } from '../utils/audioPayload.js';

const STOP_WORDS = ['stop', 'pause', 'wait', 'actually', 'no'];

export function useWorkRecorder({ onRecording, enableStopWordDetection, onInterrupt, onLog }) {
  const [isListening, setIsListening] = useState(false);
  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const recognitionRef = useRef(null);

  const startListening = useCallback(async () => {
    if (isListening) return;

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;

    const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
    mediaRecorderRef.current = recorder;
    chunksRef.current = [];

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };

    recorder.onstop = async () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
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
        await onRecording(payload.audioBase64, payload.audioFormat);
      } else {
        onLog?.('Work segment conversion failed: base64 payload empty.', 'error');
      }

      streamRef.current = null;
      mediaRecorderRef.current = null;
      setIsListening(false);
    };

    recorder.start();
    setIsListening(true);
  }, [isListening, onLog, onRecording]);

  const stopListening = useCallback(() => {
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

  return { isListening, startListening, stopListening };
}
