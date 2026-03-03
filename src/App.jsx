import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import SkillLog from './components/SkillLog.jsx';
import SettingsPanel from './components/SettingsPanel.jsx';
import StatusFeed from './components/StatusFeed.jsx';
import { useDemoRecorder } from './hooks/useDemoRecorder.js';
import { useWorkRecorder } from './hooks/useWorkRecorder.js';

const MODES = {
  DEMO: 'demo',
  WORK: 'work'
};
const DEMO_STAGE = {
  CAPTURE: 'capture',
  REVIEW: 'review'
};

function toFeedItem(type, message) {
  return { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, type, message };
}

async function playAudioFromBase64(audioBase64, mimeType = 'audio/mpeg') {
  if (!audioBase64) return;
  const binary = window.atob(audioBase64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const blob = new Blob([bytes], { type: mimeType });
  const objectUrl = URL.createObjectURL(blob);

  try {
    const audio = new Audio(objectUrl);
    await audio.play();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export default function App() {
  const ua = typeof window !== 'undefined' ? window.ua : undefined;
  const [mode, setMode] = useState(MODES.WORK);
  const [statusItems, setStatusItems] = useState([]);
  const [skills, setSkills] = useState([]);
  const [settings, setSettings] = useState({});
  const [processing, setProcessing] = useState(false);
  const [cuaRunning, setCUARunning] = useState(false);
  const [demoStage, setDemoStage] = useState(DEMO_STAGE.CAPTURE);
  const [demoAwaitingConfirmation, setDemoAwaitingConfirmation] = useState(false);
  const [demoReviewBusy, setDemoReviewBusy] = useState(false);
  const [demoCanFinalize, setDemoCanFinalize] = useState(false);
  const previousModeRef = useRef(null);
  const isDemoRecordingRef = useRef(false);
  const stopDemoAndFlushRef = useRef(async () => {});

  const appendStatus = useCallback((type, message) => {
    setStatusItems((prev) => [...prev.slice(-59), toFeedItem(type, message)]);
  }, []);

  const refreshSkills = useCallback(async () => {
    if (!ua) return;
    const result = await ua.listSkills();
    setSkills(result.skills || []);
  }, [ua]);

  const refreshSettings = useCallback(async () => {
    if (!ua) return;
    const next = await ua.getSettings();
    setSettings(next);
  }, [ua]);

  const updateSettings = useCallback(
    async (patch) => {
      if (!ua) return;
      await ua.setSettings(patch);
      await refreshSettings();
      appendStatus('status', 'Settings updated.');
    },
    [appendStatus, refreshSettings, ua]
  );

  const processSegment = useCallback(
    async (audioBase64, segmentMode, audioFormat = 'webm', demoStageContext = null) => {
      if (!ua) throw new Error('Electron bridge unavailable (window.ua missing).');
      appendStatus(
        'status',
        `Sending audio segment for processing (mode=${segmentMode}, format=${audioFormat}${demoStageContext ? `, stage=${demoStageContext}` : ''}).`
      );
      const result = await ua.processVoice(audioBase64, segmentMode, audioFormat, demoStageContext);
      appendStatus(
        result.error ? 'error' : 'status',
        result.error
          ? `Voice processing returned an error (mode=${segmentMode}).`
          : `Voice processing completed (mode=${segmentMode}).`
      );
      if (result.transcript) appendStatus('transcript', result.transcript);
      if (result.response) appendStatus('agent', result.response);
      if (segmentMode === MODES.DEMO && typeof result.awaitingConfirmation === 'boolean') {
        setDemoAwaitingConfirmation(result.awaitingConfirmation);
      }
      if (result.skillWritten) {
        await refreshSkills();
        if (segmentMode === MODES.DEMO) {
          setDemoStage(DEMO_STAGE.CAPTURE);
          setDemoAwaitingConfirmation(false);
        }
      }
      if (result.ttsAudioBase64) {
        await playAudioFromBase64(result.ttsAudioBase64, result.ttsMimeType || 'audio/mpeg');
      }
    },
    [appendStatus, refreshSkills, ua]
  );

  const { isRecording: isDemoRecording, toggle: toggleDemoRecording, stopAndFlush: stopDemoAndFlush } =
    useDemoRecorder({
      onLog: (message, type = 'status') => appendStatus(type, message),
      onSegment: async (audioBase64, audioFormat) => {
        try {
          await processSegment(audioBase64, MODES.DEMO, audioFormat, DEMO_STAGE.CAPTURE);
        } catch (error) {
          appendStatus('error', `Demo segment failed: ${error.message}`);
        }
      }
    });

  useEffect(() => {
    isDemoRecordingRef.current = isDemoRecording;
  }, [isDemoRecording]);

  useEffect(() => {
    stopDemoAndFlushRef.current = stopDemoAndFlush;
  }, [stopDemoAndFlush]);

  const { isListening: isDemoReplyListening, startListening: startDemoReply, stopListening: stopDemoReply } =
    useWorkRecorder({
      enableStopWordDetection: false,
      onInterrupt: undefined,
      onRecording: async (audioBase64, audioFormat) => {
        try {
          setProcessing(true);
          await processSegment(audioBase64, MODES.DEMO, audioFormat, DEMO_STAGE.REVIEW);
        } catch (error) {
          appendStatus('error', `Demo review reply failed: ${error.message}`);
        } finally {
          setProcessing(false);
        }
      }
    });

  const { isListening, startListening, stopListening } = useWorkRecorder({
    enableStopWordDetection: cuaRunning,
    onLog: (message, type = 'status') => appendStatus(type, message),
    onInterrupt: async () => {
      appendStatus('interrupt', 'Stop word detected. Interrupting current CUA task.');
      if (ua) await ua.interruptCUA();
    },
    onRecording: async (audioBase64, audioFormat) => {
      try {
        setProcessing(true);
        appendStatus('status', 'Thinking...');
        await processSegment(audioBase64, MODES.WORK, audioFormat);
      } catch (error) {
        appendStatus('error', `Work command failed: ${error.message}`);
      } finally {
        setProcessing(false);
      }
    }
  });

  useEffect(() => {
    if (!ua) {
      appendStatus(
        'error',
        'Electron preload bridge is unavailable. Restart dev app and ensure Electron window is used.'
      );
      return;
    }

    refreshSkills();
    refreshSettings();

    const unsubscribeStatus = ua.onStatus((payload) => {
      appendStatus(payload.type || 'status', payload.message);
    });

    const unsubscribeCUA = ua.onCUAState((payload) => {
      setCUARunning(Boolean(payload.running));
    });

    return () => {
      unsubscribeStatus?.();
      unsubscribeCUA?.();
    };
  }, [appendStatus, refreshSettings, refreshSkills, ua]);

  useEffect(() => {
    if (!ua) return;
    let cancelled = false;

    const syncMode = async () => {
      if (mode === MODES.DEMO) {
        setDemoStage(DEMO_STAGE.CAPTURE);
        setDemoAwaitingConfirmation(false);
        setDemoCanFinalize(false);
        try {
          await ua.startDemo();
        } catch (error) {
          if (!cancelled) appendStatus('error', error.message);
        }
      } else if (previousModeRef.current === MODES.DEMO) {
        try {
          if (isDemoRecordingRef.current) {
            appendStatus('status', 'Switching out of demo: stopping recording and flushing final segment.');
            await stopDemoAndFlushRef.current();
          }
          await ua.endDemo();
        } catch (error) {
          if (!cancelled) appendStatus('error', `Failed to end demo mode cleanly: ${error.message}`);
        }
        if (!cancelled) {
          setDemoStage(DEMO_STAGE.CAPTURE);
          setDemoAwaitingConfirmation(false);
          setDemoCanFinalize(false);
        }
      }
    };

    syncMode();
    previousModeRef.current = mode;
    return () => {
      cancelled = true;
    };
  }, [mode, appendStatus, ua]);

  const finalizeDemoCapture = useCallback(async () => {
    if (!ua || demoReviewBusy || !demoCanFinalize) return;
    setDemoReviewBusy(true);
    try {
      if (isDemoRecording) {
        appendStatus('status', 'End Demo requested: stopping recording and flushing final segment.');
        await stopDemoAndFlush();
      }

      const result = await ua.finalizeDemo();
      if (result.response) appendStatus('agent', result.response);
      setDemoAwaitingConfirmation(Boolean(result.awaitingConfirmation));
      setDemoStage(DEMO_STAGE.REVIEW);
      setDemoCanFinalize(false);
      if (result.skillWritten) await refreshSkills();
      if (result.ttsAudioBase64) {
        await playAudioFromBase64(result.ttsAudioBase64, result.ttsMimeType || 'audio/mpeg');
      }
    } catch (error) {
      appendStatus('error', `Demo finalize failed: ${error.message}`);
    } finally {
      setDemoReviewBusy(false);
    }
  }, [appendStatus, demoCanFinalize, demoReviewBusy, isDemoRecording, refreshSkills, stopDemoAndFlush, ua]);

  const createSkillFromReview = useCallback(async () => {
    if (!ua || demoReviewBusy) return;
    setDemoReviewBusy(true);
    try {
      const result = await ua.saveDemoSkill();
      if (result.response) appendStatus('agent', result.response);
      setDemoAwaitingConfirmation(Boolean(result.awaitingConfirmation));
      if (result.skillWritten) {
        await refreshSkills();
        setDemoStage(DEMO_STAGE.CAPTURE);
        setDemoCanFinalize(false);
      }
      if (result.ttsAudioBase64) {
        await playAudioFromBase64(result.ttsAudioBase64, result.ttsMimeType || 'audio/mpeg');
      }
    } catch (error) {
      appendStatus('error', `Create skill failed: ${error.message}`);
    } finally {
      setDemoReviewBusy(false);
    }
  }, [appendStatus, demoReviewBusy, refreshSkills, ua]);

  const modeIndicator = useMemo(
    () =>
      mode === MODES.DEMO
        ? demoStage === DEMO_STAGE.CAPTURE
          ? isDemoRecording
            ? 'Demo Capture: recording continuously with VAD segmenting'
            : 'Demo Capture: click to start recording'
          : demoAwaitingConfirmation
            ? 'Demo Review: ready to create skill or apply corrections'
            : 'Demo Review: answer clarifying questions'
        : cuaRunning
          ? 'Work Mode: task running (say stop/pause to interrupt)'
          : 'Work Mode: hold to speak command',
    [mode, demoStage, demoAwaitingConfirmation, cuaRunning, isDemoRecording]
  );

  return (
    <main className="mx-auto flex h-screen max-w-xl flex-col gap-3 p-4 text-slate-100">
      <header className="rounded-xl border border-slate-700 bg-slate-900/70 p-3">
        <h1 className="text-lg font-semibold">Universal Agent</h1>
        <p className="text-sm text-slate-300">{modeIndicator}</p>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            className={`rounded-md px-3 py-1 text-sm ${
              mode === MODES.WORK ? 'bg-mint text-slate-950' : 'bg-slate-800 text-slate-200'
            }`}
            onClick={() => setMode(MODES.WORK)}
          >
            Work
          </button>
          <button
            type="button"
            className={`rounded-md px-3 py-1 text-sm ${
              mode === MODES.DEMO ? 'bg-mint text-slate-950' : 'bg-slate-800 text-slate-200'
            }`}
            onClick={() => setMode(MODES.DEMO)}
          >
            Demo
          </button>
        </div>
      </header>

      {mode === MODES.DEMO ? (
        <div className="flex flex-col gap-2">
          {demoStage === DEMO_STAGE.CAPTURE ? (
            <>
              <button
                type="button"
                disabled={processing || demoReviewBusy}
                onClick={() => {
                  appendStatus(
                    'status',
                    isDemoRecording
                      ? 'Demo narrate button clicked: stopping recording.'
                      : 'Demo narrate button clicked: starting recording.'
                  );
                  if (isDemoRecording) {
                    setDemoCanFinalize(true);
                  } else {
                    setDemoCanFinalize(false);
                  }
                  toggleDemoRecording();
                }}
                className={`w-full rounded-xl px-4 py-5 text-lg font-semibold transition ${
                  isDemoRecording
                    ? 'bg-danger text-white shadow-[0_0_25px_rgba(239,68,68,0.6)]'
                    : 'bg-mint text-slate-950 hover:bg-emerald-400'
                } ${processing || demoReviewBusy ? 'cursor-not-allowed opacity-70' : ''}`}
              >
                {isDemoRecording ? 'Stop Recording' : 'Start Recording'}
              </button>
              {demoCanFinalize ? (
                <button
                  type="button"
                  disabled={processing || demoReviewBusy || isDemoRecording}
                  onClick={finalizeDemoCapture}
                  className={`w-full rounded-xl border border-slate-600 bg-slate-800 px-4 py-3 text-sm font-semibold text-slate-100 transition hover:bg-slate-700 ${
                    processing || demoReviewBusy || isDemoRecording ? 'cursor-not-allowed opacity-70' : ''
                  }`}
                >
                  End Demo & Review
                </button>
              ) : null}
            </>
          ) : (
            <>
              <button
                type="button"
                disabled={processing || demoReviewBusy}
                onMouseDown={startDemoReply}
                onMouseUp={stopDemoReply}
                onMouseLeave={isDemoReplyListening ? stopDemoReply : undefined}
                onTouchStart={(event) => {
                  event.preventDefault();
                  startDemoReply();
                }}
                onTouchEnd={(event) => {
                  event.preventDefault();
                  stopDemoReply();
                }}
                className={`w-full rounded-xl px-4 py-5 text-lg font-semibold transition ${
                  isDemoReplyListening
                    ? 'bg-danger text-white shadow-[0_0_25px_rgba(239,68,68,0.6)]'
                    : 'bg-mint text-slate-950 hover:bg-emerald-400'
                } ${processing || demoReviewBusy ? 'cursor-not-allowed opacity-70' : ''}`}
              >
                {isDemoReplyListening ? 'Listening...' : 'Hold to Reply'}
              </button>
              <button
                type="button"
                disabled={processing || demoReviewBusy || !demoAwaitingConfirmation}
                onClick={createSkillFromReview}
                className={`w-full rounded-xl border border-emerald-500 bg-emerald-900/30 px-4 py-3 text-sm font-semibold text-emerald-200 transition hover:bg-emerald-900/50 ${
                  processing || demoReviewBusy || !demoAwaitingConfirmation
                    ? 'cursor-not-allowed opacity-70'
                    : ''
                }`}
              >
                Create Skill
              </button>
              <button
                type="button"
                disabled={processing || demoReviewBusy}
                onClick={() => {
                  setDemoStage(DEMO_STAGE.CAPTURE);
                  setDemoCanFinalize(false);
                  appendStatus('status', 'Returned to demo capture mode.');
                }}
                className={`w-full rounded-xl border border-slate-600 bg-slate-800 px-4 py-3 text-sm font-semibold text-slate-100 transition hover:bg-slate-700 ${
                  processing || demoReviewBusy ? 'cursor-not-allowed opacity-70' : ''
                }`}
              >
                Resume Capture
              </button>
            </>
          )}
        </div>
      ) : (
        <button
          type="button"
          disabled={processing}
          onMouseDown={() => {
            appendStatus('status', 'Work speak button pressed: recording started.');
            startListening();
          }}
          onMouseUp={() => {
            appendStatus('status', 'Work speak button released: recording stopped.');
            stopListening();
          }}
          onMouseLeave={
            isListening
              ? () => {
                  stopListening();
                }
              : undefined
          }
          onTouchStart={(event) => {
            event.preventDefault();
            appendStatus('status', 'Work speak button touched: recording started.');
            startListening();
          }}
          onTouchEnd={(event) => {
            event.preventDefault();
            appendStatus('status', 'Work speak touch ended: recording stopped.');
            stopListening();
          }}
          className={`w-full rounded-xl px-4 py-5 text-lg font-semibold transition ${
            isListening
              ? 'bg-danger text-white shadow-[0_0_25px_rgba(239,68,68,0.6)]'
              : 'bg-mint text-slate-950 hover:bg-emerald-400'
          } ${processing ? 'cursor-not-allowed opacity-70' : ''}`}
        >
          {isListening ? 'Listening...' : 'Hold to Speak'}
        </button>
      )}

      <StatusFeed items={statusItems} />
      <SkillLog skills={skills.slice(-8).reverse()} />
      <SettingsPanel settings={settings} onChangeModel={updateSettings} />
    </main>
  );
}
