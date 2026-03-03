import { useRef, useState, useCallback } from 'react';

const SILENCE_THRESHOLD = 0.01;
const SILENCE_DURATION_MS = 800;

function blobToBase64(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = String(reader.result || '');
      resolve(dataUrl.includes(',') ? dataUrl.split(',')[1] : '');
    };
    reader.readAsDataURL(blob);
  });
}

export function useDemoRecorder({ onSegment }) {
  const [isRecording, setIsRecording] = useState(false);
  const streamRef = useRef(null);
  const audioContextRef = useRef(null);
  const processorRef = useRef(null);
  const sourceRef = useRef(null);
  const chunksRef = useRef([]);
  const mediaRecorderRef = useRef(null);
  const silenceTimerRef = useRef(null);
  const segmentQueueRef = useRef(Promise.resolve());

  const setupRecorder = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;

    const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
    mediaRecorderRef.current = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };

    recorder.start(100);
  }, []);

  const processSegmentBlob = useCallback(
    async (blob) => {
      if (blob.size < 1000) return;
      const base64 = await blobToBase64(blob);
      if (!base64) return;
      await onSegment(base64);
    },
    [onSegment]
  );

  const cutSegment = useCallback(
    (finalCut = false) => {
      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state === 'inactive') return;

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        chunksRef.current = [];

        segmentQueueRef.current = segmentQueueRef.current.then(() => processSegmentBlob(blob));

        if (!finalCut && isRecording) {
          setupRecorder();
        }
      };

      recorder.stop();
    },
    [isRecording, processSegmentBlob, setupRecorder]
  );

  const startRecording = useCallback(async () => {
    if (isRecording) return;

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true }
    });

    streamRef.current = stream;
    audioContextRef.current = new AudioContext({ sampleRate: 16000 });
    sourceRef.current = audioContextRef.current.createMediaStreamSource(stream);

    const processor = audioContextRef.current.createScriptProcessor(2048, 1, 1);
    processorRef.current = processor;

    processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      const rms = Math.sqrt(input.reduce((sum, sample) => sum + sample * sample, 0) / input.length);

      if (rms < SILENCE_THRESHOLD) {
        if (!silenceTimerRef.current) {
          silenceTimerRef.current = setTimeout(() => {
            cutSegment(false);
            silenceTimerRef.current = null;
          }, SILENCE_DURATION_MS);
        }
      } else if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
    };

    sourceRef.current.connect(processor);
    processor.connect(audioContextRef.current.destination);
    chunksRef.current = [];
    setupRecorder();
    setIsRecording(true);
  }, [cutSegment, isRecording, setupRecorder]);

  const stopRecording = useCallback(() => {
    if (!isRecording) return;

    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }

    cutSegment(true);

    setTimeout(() => {
      processorRef.current?.disconnect();
      sourceRef.current?.disconnect();
      audioContextRef.current?.close().catch(() => {});
      streamRef.current?.getTracks().forEach((track) => track.stop());

      processorRef.current = null;
      sourceRef.current = null;
      audioContextRef.current = null;
      streamRef.current = null;
      mediaRecorderRef.current = null;

      setIsRecording(false);
    }, 220);
  }, [cutSegment, isRecording]);

  const toggle = useCallback(() => {
    if (isRecording) stopRecording();
    else startRecording();
  }, [isRecording, startRecording, stopRecording]);

  return { isRecording, toggle };
}
