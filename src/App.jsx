import { useCallback, useEffect, useMemo, useState } from 'react';
import SkillLog from './components/SkillLog.jsx';
import SettingsPanel from './components/SettingsPanel.jsx';
import StatusFeed from './components/StatusFeed.jsx';
import { useDemoRecorder } from './hooks/useDemoRecorder.js';
import { useWorkRecorder } from './hooks/useWorkRecorder.js';

const MODES = {
  DEMO: 'demo',
  WORK: 'work'
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
    async (audioBase64, segmentMode) => {
      if (!ua) throw new Error('Electron bridge unavailable (window.ua missing).');
      const result = await ua.processVoice(audioBase64, segmentMode);
      if (result.transcript) appendStatus('transcript', result.transcript);
      if (result.response) appendStatus('agent', result.response);
      if (result.skillWritten) await refreshSkills();
      if (result.ttsAudioBase64) {
        await playAudioFromBase64(result.ttsAudioBase64, result.ttsMimeType || 'audio/mpeg');
      }
    },
    [appendStatus, refreshSkills, ua]
  );

  const { isRecording: isDemoRecording, toggle: toggleDemoRecording } = useDemoRecorder({
    onSegment: async (audioBase64) => {
      try {
        await processSegment(audioBase64, MODES.DEMO);
      } catch (error) {
        appendStatus('error', `Demo segment failed: ${error.message}`);
      }
    }
  });

  const { isListening, startListening, stopListening } = useWorkRecorder({
    enableStopWordDetection: cuaRunning,
    onInterrupt: async () => {
      appendStatus('interrupt', 'Stop word detected. Interrupting current CUA task.');
      if (ua) await ua.interruptCUA();
    },
    onRecording: async (audioBase64) => {
      try {
        setProcessing(true);
        appendStatus('status', 'Thinking...');
        await processSegment(audioBase64, MODES.WORK);
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
      appendStatus('status', payload.message);
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
    if (mode === MODES.DEMO) {
      ua.startDemo().catch((error) => appendStatus('error', error.message));
    } else {
      ua.endDemo().catch(() => {});
    }
  }, [mode, appendStatus, ua]);

  const modeIndicator = useMemo(
    () =>
      mode === MODES.DEMO
        ? isDemoRecording
          ? 'Demo Mode: recording continuously with VAD segmenting'
          : 'Demo Mode: click to start narration'
        : cuaRunning
          ? 'Work Mode: task running (say stop/pause to interrupt)'
          : 'Work Mode: hold to speak command',
    [mode, cuaRunning, isDemoRecording]
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
        <button
          type="button"
          disabled={processing}
          onClick={toggleDemoRecording}
          className={`w-full rounded-xl px-4 py-5 text-lg font-semibold transition ${
            isDemoRecording ? 'bg-danger text-white shadow-[0_0_25px_rgba(239,68,68,0.6)]' : 'bg-mint text-slate-950 hover:bg-emerald-400'
          } ${processing ? 'cursor-not-allowed opacity-70' : ''}`}
        >
          {isDemoRecording ? 'Stop Narrating' : 'Start Narrating'}
        </button>
      ) : (
        <button
          type="button"
          disabled={processing}
          onMouseDown={startListening}
          onMouseUp={stopListening}
          onMouseLeave={isListening ? stopListening : undefined}
          onTouchStart={(event) => {
            event.preventDefault();
            startListening();
          }}
          onTouchEnd={(event) => {
            event.preventDefault();
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
