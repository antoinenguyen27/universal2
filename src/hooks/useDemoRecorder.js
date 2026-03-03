import { useRef, useState, useCallback } from 'react';
import { toTranscriptionPayload } from '../utils/audioPayload.js';

const SILENCE_THRESHOLD = 0.01;
const SILENCE_DURATION_MS = 3200;
const INITIAL_SILENCE_GRACE_MS = 10000;
const MIN_SEGMENT_DURATION_MS = 1200;

export function useDemoRecorder({ onSegment, onLog }) {
  const [isRecording, setIsRecording] = useState(false);
  const streamRef = useRef(null);
  const audioContextRef = useRef(null);
  const processorRef = useRef(null);
  const sourceRef = useRef(null);
  const chunksRef = useRef([]);
  const mediaRecorderRef = useRef(null);
  const silenceTimerRef = useRef(null);
  const segmentQueueRef = useRef(Promise.resolve());
  const recordingStartedAtRef = useRef(0);
  const hasDetectedSpeechRef = useRef(false);
  const stopResolversRef = useRef([]);

  const resolveStopWaiters = useCallback(() => {
    if (!stopResolversRef.current.length) return;
    const resolvers = stopResolversRef.current;
    stopResolversRef.current = [];
    resolvers.forEach((resolve) => resolve());
  }, []);

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
      if (blob.size < 1000) {
        onLog?.('Demo segment skipped: audio too short or silent (under 1000 bytes).', 'warning');
        return;
      }
      const payload = await toTranscriptionPayload(blob);
      if (!payload.audioBase64) {
        onLog?.('Demo segment conversion failed: base64 payload empty.', 'error');
        return;
      }
      if (typeof payload.durationMs === 'number' && payload.durationMs < MIN_SEGMENT_DURATION_MS) {
        onLog?.(
          `Demo segment skipped: duration too short (${payload.durationMs}ms < ${MIN_SEGMENT_DURATION_MS}ms).`,
          'warning'
        );
        return;
      }
      if (payload.convertedToWav) {
        onLog?.(
          `Demo segment ready: ${blob.size} bytes, ${payload.durationMs || 'unknown'}ms. Converted to wav and sending for transcription.`,
          'status'
        );
      } else {
        onLog?.(`Demo segment ready: ${blob.size} bytes. Sending original webm for transcription.`, 'warning');
      }
      await onSegment(payload.audioBase64, payload.audioFormat);
    },
    [onLog, onSegment]
  );

  const cutSegment = useCallback(
    (finalCut = false) => {
      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state === 'inactive') return false;

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        chunksRef.current = [];

        segmentQueueRef.current = segmentQueueRef.current
          .then(() => processSegmentBlob(blob))
          .catch((error) => {
            onLog?.(`Demo segment processing failed: ${String(error?.message || error)}`, 'error');
          });

        if (finalCut) {
          segmentQueueRef.current.finally(resolveStopWaiters);
        }

        if (!finalCut && isRecording) {
          setupRecorder();
        }
      };

      recorder.stop();
      return true;
    },
    [isRecording, onLog, processSegmentBlob, resolveStopWaiters, setupRecorder]
  );

  const startRecording = useCallback(async () => {
    if (isRecording) return;
    onLog?.('Demo recorder starting microphone capture.', 'status');

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true }
    });

    streamRef.current = stream;
    audioContextRef.current = new AudioContext({ sampleRate: 16000 });
    sourceRef.current = audioContextRef.current.createMediaStreamSource(stream);
    recordingStartedAtRef.current = Date.now();
    hasDetectedSpeechRef.current = false;

    const processor = audioContextRef.current.createScriptProcessor(2048, 1, 1);
    processorRef.current = processor;

    processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      const rms = Math.sqrt(input.reduce((sum, sample) => sum + sample * sample, 0) / input.length);
      const isSilent = rms < SILENCE_THRESHOLD;
      const withinInitialSilenceGrace =
        !hasDetectedSpeechRef.current &&
        Date.now() - recordingStartedAtRef.current < INITIAL_SILENCE_GRACE_MS;

      if (isSilent) {
        if (withinInitialSilenceGrace) return;
        if (!silenceTimerRef.current) {
          silenceTimerRef.current = setTimeout(() => {
            cutSegment(false);
            silenceTimerRef.current = null;
          }, SILENCE_DURATION_MS);
        }
      } else {
        hasDetectedSpeechRef.current = true;
        if (silenceTimerRef.current) {
          clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = null;
        }
      }
    };

    sourceRef.current.connect(processor);
    processor.connect(audioContextRef.current.destination);
    chunksRef.current = [];
    setupRecorder();
    setIsRecording(true);
    onLog?.('Demo recorder active.', 'status');
  }, [cutSegment, isRecording, onLog, setupRecorder]);

  const stopRecording = useCallback(() => {
    if (!isRecording) return;
    onLog?.('Demo recorder stopping microphone capture.', 'status');

    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }

    const cutStarted = cutSegment(true);

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
      recordingStartedAtRef.current = 0;
      hasDetectedSpeechRef.current = false;

      setIsRecording(false);
      onLog?.('Demo recorder stopped.', 'status');
      if (!cutStarted) {
        resolveStopWaiters();
      }
    }, 220);
  }, [cutSegment, isRecording, onLog, resolveStopWaiters]);

  const stopAndFlush = useCallback(() => {
    if (!isRecording) return segmentQueueRef.current.catch(() => {});
    return new Promise((resolve) => {
      stopResolversRef.current.push(resolve);
      stopRecording();
    });
  }, [isRecording, stopRecording]);

  const toggle = useCallback(() => {
    if (isRecording) stopRecording();
    else startRecording();
  }, [isRecording, startRecording, stopRecording]);

  return { isRecording, toggle, stopAndFlush };
}
