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

const INITIAL_SETTINGS_DRAFT = {
  openrouterKey: '',
  anthropicKey: '',
  executionMode: 'cua',
  elevenlabsKey: '',
  elevenlabsVoiceId: '',
  debugMode: false
};

function toFeedItem(type, message) {
  return { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, type, message };
}

function toChatItem(role, message, meta = {}) {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    role,
    message,
    createdAt: Date.now(),
    ...meta
  };
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

function settingsToDraft(next = {}) {
  return {
    ...INITIAL_SETTINGS_DRAFT,
    executionMode: next.executionMode || 'cua',
    debugMode: Boolean(next.debugMode)
  };
}

export default function App() {
  const ua = typeof window !== 'undefined' ? window.ua : undefined;
  const [mode, setMode] = useState(MODES.WORK);
  const [statusItems, setStatusItems] = useState([]);
  const [chatItems, setChatItems] = useState([]);
  const [skills, setSkills] = useState([]);
  const [settings, setSettings] = useState({});
  const [settingsDraft, setSettingsDraft] = useState(INITIAL_SETTINGS_DRAFT);
  const [settingsTouched, setSettingsTouched] = useState({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState('');
  const [deletingSkillId, setDeletingSkillId] = useState('');
  const [processing, setProcessing] = useState(false);
  const [executionRunning, setExecutionRunning] = useState(false);
  const [pendingAgentOps, setPendingAgentOps] = useState(0);
  const [demoStage, setDemoStage] = useState(DEMO_STAGE.CAPTURE);
  const [demoAwaitingConfirmation, setDemoAwaitingConfirmation] = useState(false);
  const [demoReviewBusy, setDemoReviewBusy] = useState(false);
  const [demoCanFinalize, setDemoCanFinalize] = useState(false);
  const [demoSessionActive, setDemoSessionActive] = useState(false);
  const [demoStarting, setDemoStarting] = useState(false);
  const [modeSwitchBusy, setModeSwitchBusy] = useState(false);
  const [modeSwitchTarget, setModeSwitchTarget] = useState(null);
  const [chatInput, setChatInput] = useState('');
  const [chatComposerOpen, setChatComposerOpen] = useState(false);
  const previousModeRef = useRef(null);
  const isDemoRecordingRef = useRef(false);
  const stopDemoAndFlushRef = useRef(async () => {});
  const demoSessionActiveRef = useRef(false);

  const appendStatus = useCallback((type, message) => {
    setStatusItems((prev) => [...prev.slice(-59), toFeedItem(type, message)]);
  }, []);

  const appendUserVoiceChat = useCallback((message, modeValue, stageValue = null) => {
    const trimmed = String(message || '').trim();
    if (!trimmed) return;

    setChatItems((prev) => {
      const last = prev[prev.length - 1];
      const canMerge =
        Boolean(last) &&
        last.role === 'user' &&
        last.inputType === 'voice' &&
        last.mode === modeValue &&
        last.stage === stageValue;

      if (canMerge) {
        const merged = `${last.message} ${trimmed}`.replace(/\s+/g, ' ').trim();
        return [...prev.slice(0, -1), { ...last, message: merged, updatedAt: Date.now() }].slice(-79);
      }

      return [...prev, toChatItem('user', trimmed, { inputType: 'voice', mode: modeValue, stage: stageValue })].slice(
        -79
      );
    });
  }, []);

  const appendUserTextChat = useCallback((message) => {
    const trimmed = String(message || '').trim();
    if (!trimmed) return;
    setChatItems((prev) => [...prev, toChatItem('user', trimmed, { inputType: 'text' })].slice(-79));
  }, []);

  const appendAgentChat = useCallback((message) => {
    const trimmed = String(message || '').trim();
    if (!trimmed) return;
    setChatItems((prev) => [...prev, toChatItem('agent', trimmed)].slice(-79));
  }, []);

  const clearChatHistory = useCallback(() => {
    setChatItems([]);
    setChatInput('');
  }, []);

  const refreshSkills = useCallback(async () => {
    if (!ua) return;
    const result = await ua.listSkills();
    setSkills(result.skills || []);
  }, [ua]);

  const refreshSettings = useCallback(async () => {
    if (!ua) return;
    const next = await ua.getSettings();
    setSettings(next || {});
    setSettingsDraft(settingsToDraft(next || {}));
    setSettingsTouched({});
  }, [ua]);

  const processSegment = useCallback(
    async (audioBase64, segmentMode, audioFormat = 'webm', demoStageContext = null, segmentTiming = null) => {
      if (!ua) throw new Error('Electron bridge unavailable (window.ua missing).');
      setPendingAgentOps((value) => value + 1);
      appendStatus(
        'status',
        `Sending audio segment for processing (mode=${segmentMode}, format=${audioFormat}${demoStageContext ? `, stage=${demoStageContext}` : ''}).`
      );
      try {
        const result = await ua.processVoice(audioBase64, segmentMode, audioFormat, demoStageContext, segmentTiming);
        appendStatus(
          result.error ? 'error' : 'status',
          result.error
            ? `Voice processing returned an error (mode=${segmentMode}).`
            : `Voice processing completed (mode=${segmentMode}).`
        );
        if (result.response) {
          appendStatus('agent', result.response);
          appendAgentChat(result.response);
        }
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
        return result;
      } finally {
        setPendingAgentOps((value) => Math.max(0, value - 1));
      }
    },
    [appendAgentChat, appendStatus, refreshSkills, ua]
  );

  const processText = useCallback(
    async (text) => {
      if (!ua) throw new Error('Electron bridge unavailable (window.ua missing).');
      if (mode !== MODES.WORK) {
        throw new Error('Text input is currently available only in Work mode.');
      }
      const trimmed = text.trim();
      if (!trimmed) return null;

      appendUserTextChat(trimmed);
      setPendingAgentOps((value) => value + 1);
      appendStatus('status', 'Sending text command for processing (mode=work).');
      try {
        const result = await ua.processText(trimmed, MODES.WORK);
        appendStatus(
          result.error ? 'error' : 'status',
          result.error ? 'Text processing returned an error (mode=work).' : 'Text processing completed (mode=work).'
        );
        if (result.response) {
          appendStatus('agent', result.response);
          appendAgentChat(result.response);
        }
        if (result.ttsAudioBase64) {
          await playAudioFromBase64(result.ttsAudioBase64, result.ttsMimeType || 'audio/mpeg');
        }
        return result;
      } finally {
        setPendingAgentOps((value) => Math.max(0, value - 1));
      }
    },
    [appendAgentChat, appendStatus, appendUserTextChat, mode, ua]
  );

  const { isRecording: isDemoRecording, toggle: toggleDemoRecording, stopAndFlush: stopDemoAndFlush } =
    useDemoRecorder({
      onLog: (message, type = 'status') => appendStatus(type, message),
      onSegment: async (audioBase64, audioFormat, segmentTiming) => {
        try {
          await processSegment(audioBase64, MODES.DEMO, audioFormat, DEMO_STAGE.CAPTURE, segmentTiming);
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

  useEffect(() => {
    demoSessionActiveRef.current = demoSessionActive;
  }, [demoSessionActive]);

  const resetDemoUiState = useCallback(() => {
    setDemoStage(DEMO_STAGE.CAPTURE);
    setDemoAwaitingConfirmation(false);
    setDemoCanFinalize(false);
    setDemoSessionActive(false);
    setDemoStarting(false);
  }, []);

  const { isListening: isDemoReplyListening, startListening: startDemoReply, stopListening: stopDemoReply } =
    useWorkRecorder({
      enableStopWordDetection: false,
      onInterrupt: undefined,
      onRecording: async (audioBase64, audioFormat, segmentTiming) => {
        try {
          setProcessing(true);
          await processSegment(audioBase64, MODES.DEMO, audioFormat, DEMO_STAGE.REVIEW, segmentTiming);
        } catch (error) {
          appendStatus('error', `Demo review reply failed: ${error.message}`);
        } finally {
          setProcessing(false);
        }
      }
    });

  const { isListening, isStarting: isWorkStarting, startListening, stopListening } = useWorkRecorder({
    enableStopWordDetection: executionRunning,
    onLog: (message, type = 'status') => appendStatus(type, message),
    onInterrupt: async () => {
      appendStatus('interrupt', 'Stop word detected. Interrupting current execution task.');
      if (ua) await ua.interruptExecution();
    },
    onRecording: async (audioBase64, audioFormat, segmentTiming) => {
      try {
        setProcessing(true);
        appendStatus('status', 'Thinking...');
        await processSegment(audioBase64, MODES.WORK, audioFormat, null, segmentTiming);
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
      if (payload.type === 'transcript' && payload.source === 'voice') {
        appendUserVoiceChat(payload.message, payload.mode || MODES.WORK, payload.stage || null);
      }
    });

    const unsubscribeExecution = ua.onExecutionState((payload) => {
      setExecutionRunning(Boolean(payload.running));
    });

    return () => {
      unsubscribeStatus?.();
      unsubscribeExecution?.();
    };
  }, [appendStatus, appendUserVoiceChat, refreshSettings, refreshSkills, ua]);

  useEffect(() => {
    if (!ua) {
      setModeSwitchBusy(false);
      setModeSwitchTarget(null);
      return;
    }
    let cancelled = false;

    const syncMode = async () => {
      const previousMode = previousModeRef.current;
      if (previousMode && previousMode !== mode) {
        clearChatHistory();
      }

      if (mode === MODES.DEMO) {
        resetDemoUiState();
      } else if (previousMode === MODES.DEMO) {
        try {
          if (isDemoRecordingRef.current) {
            appendStatus('status', 'Switching out of demo: stopping recording and flushing final segment.');
            await stopDemoAndFlushRef.current();
          }
          if (demoSessionActiveRef.current) {
            await ua.endDemo();
          }
        } catch (error) {
          if (!cancelled) appendStatus('error', `Failed to end demo mode cleanly: ${error.message}`);
        }
        if (!cancelled) {
          resetDemoUiState();
        }
      }
      if (!cancelled) {
        setModeSwitchBusy(false);
        setModeSwitchTarget(null);
      }
    };

    syncMode().catch((error) => {
      if (!cancelled) {
        appendStatus('error', `Mode switch sync failed: ${error.message}`);
        setModeSwitchBusy(false);
        setModeSwitchTarget(null);
      }
    });
    previousModeRef.current = mode;
    return () => {
      cancelled = true;
    };
  }, [mode, appendStatus, clearChatHistory, resetDemoUiState, ua]);

  const handleModeSelect = useCallback(
    (nextMode) => {
      if (nextMode === mode || modeSwitchBusy) return;
      if (!ua) {
        setMode(nextMode);
        return;
      }
      setModeSwitchBusy(true);
      setModeSwitchTarget(nextMode);
      setMode(nextMode);
    },
    [mode, modeSwitchBusy, ua]
  );

  const resetDemoFlow = useCallback(async () => {
    if (!ua || demoReviewBusy || demoStarting) return;
    setDemoReviewBusy(true);
    try {
      if (isDemoReplyListening) stopDemoReply();
      if (isDemoRecordingRef.current) {
        appendStatus('status', 'Try Again requested: stopping recording and flushing final segment.');
        await stopDemoAndFlushRef.current();
      }
      if (demoSessionActiveRef.current) {
        await ua.endDemo();
      }
      clearChatHistory();
      resetDemoUiState();
      appendStatus('status', 'Demo reset. Ready to start a new recording.');
    } catch (error) {
      appendStatus('error', `Demo reset failed: ${error.message}`);
    } finally {
      setDemoReviewBusy(false);
    }
  }, [appendStatus, clearChatHistory, demoReviewBusy, demoStarting, isDemoReplyListening, resetDemoUiState, stopDemoReply, ua]);

  const finalizeDemoCapture = useCallback(async () => {
    if (!ua || demoReviewBusy || !demoCanFinalize) return;
    setDemoReviewBusy(true);
    try {
      if (isDemoRecording) {
        appendStatus('status', 'End Demo requested: stopping recording and flushing final segment.');
        await stopDemoAndFlush();
      }

      const result = await ua.finalizeDemo();
      if (result.response) {
        appendStatus('agent', result.response);
        appendAgentChat(result.response);
      }
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
  }, [appendAgentChat, appendStatus, demoCanFinalize, demoReviewBusy, isDemoRecording, refreshSkills, stopDemoAndFlush, ua]);

  const createSkillFromReview = useCallback(async () => {
    if (!ua || demoReviewBusy) return;
    setDemoReviewBusy(true);
    try {
      const result = await ua.saveDemoSkill();
      if (result.response) {
        appendStatus('agent', result.response);
        appendAgentChat(result.response);
      }
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
  }, [appendAgentChat, appendStatus, demoReviewBusy, refreshSkills, ua]);

  const saveSettings = useCallback(async () => {
    if (!ua) return;
    setSettingsSaving(true);
    setSettingsError('');
    try {
      const payload = { debugMode: settingsDraft.debugMode };
      if (settingsTouched.openrouterKey) payload.openrouterKey = settingsDraft.openrouterKey;
      if (settingsTouched.anthropicKey) payload.anthropicKey = settingsDraft.anthropicKey;
      if (settingsDraft.executionMode !== (settings.executionMode || 'cua')) {
        payload.executionMode = settingsDraft.executionMode;
      }
      if (settingsTouched.elevenlabsKey) payload.elevenlabsKey = settingsDraft.elevenlabsKey;
      if (settingsTouched.elevenlabsVoiceId) payload.elevenlabsVoiceId = settingsDraft.elevenlabsVoiceId;
      const result = await ua.setSettings(payload);
      if (result?.settings) {
        setSettings(result.settings);
        setSettingsDraft(settingsToDraft(result.settings));
        setSettingsTouched({});
      }
      appendStatus('status', 'Settings saved.');
      await refreshSkills();
    } catch (error) {
      setSettingsError(error.message);
      appendStatus('error', `Failed to save settings: ${error.message}`);
    } finally {
      setSettingsSaving(false);
    }
  }, [appendStatus, refreshSkills, settings, settingsDraft, settingsTouched, ua]);

  const deleteSkillFromSettings = useCallback(
    async (skill) => {
      if (!ua || !skill) return;
      const id = `${skill.domain}/${skill.filename}`;
      setDeletingSkillId(id);
      try {
        await ua.deleteSkill(skill.domain, skill.filename);
        appendStatus('status', `Deleted skill ${skill.name}.`);
        await refreshSkills();
      } catch (error) {
        appendStatus('error', `Delete skill failed: ${error.message}`);
      } finally {
        setDeletingSkillId('');
      }
    },
    [appendStatus, refreshSkills, ua]
  );

  const submitChat = useCallback(async () => {
    try {
      setProcessing(true);
      await processText(chatInput);
      setChatInput('');
    } catch (error) {
      appendStatus('error', `Text command failed: ${error.message}`);
    } finally {
      setProcessing(false);
    }
  }, [appendStatus, chatInput, processText]);

  const hasSettingsChanges = useMemo(() => {
    const keyFieldsTouched =
      Boolean(settingsTouched.openrouterKey) ||
      Boolean(settingsTouched.anthropicKey) ||
      Boolean(settingsTouched.elevenlabsKey) ||
      Boolean(settingsTouched.elevenlabsVoiceId);
    const executionModeChanged =
      String(settingsDraft.executionMode || 'cua') !== String(settings.executionMode || 'cua');
    const debugChanged = Boolean(settingsDraft.debugMode) !== Boolean(settings.debugMode);
    return keyFieldsTouched || executionModeChanged || debugChanged;
  }, [settings.debugMode, settings.executionMode, settingsDraft.debugMode, settingsDraft.executionMode, settingsTouched]);

  const modeIndicator = useMemo(
    () =>
      mode === MODES.DEMO
        ? demoStage === DEMO_STAGE.CAPTURE
          ? isDemoRecording
            ? 'Recording demo. Click to stop.'
            : 'Click Start Recording to begin demo.'
          : demoAwaitingConfirmation
            ? 'Create skill or record corrections.'
            : 'Hold to answer clarifying question.'
        : executionRunning
          ? 'Task running. Say stop to interrupt.'
          : 'Hold button to speak task.',
    [mode, demoStage, demoAwaitingConfirmation, executionRunning, isDemoRecording]
  );
  const showRecordingDot = isListening || isDemoRecording || isDemoReplyListening;

  const debugMode = Boolean(settings.debugMode);
  const chatFeed = chatItems;
  const showComposer = debugMode || chatComposerOpen;
  const agentBusy = processing || demoReviewBusy || executionRunning || pendingAgentOps > 0;

  return (
    <main className="app-shell">
      <div className="app-bg-orb orb-a" />
      <div className="app-bg-orb orb-b" />

      <section className="app-surface">
        <div className="window-top-pad drag-region" aria-hidden="true" />
        <header className="app-header drag-region">
          <div>
            <h1>Universal</h1>
            <p>{modeIndicator}</p>
          </div>
          <div className="header-controls no-drag">
            {showRecordingDot ? <span className="recording-dot" aria-label="Recording in progress" title="Recording" /> : null}
            <div className="glass-pill mode-pill" role="tablist" aria-label="Mode">
              <button
                type="button"
                className={mode === MODES.WORK ? 'active' : ''}
                onClick={() => handleModeSelect(MODES.WORK)}
                disabled={modeSwitchBusy}
              >
                {modeSwitchBusy && modeSwitchTarget === MODES.WORK ? 'Preparing...' : 'Work'}
              </button>
              <button
                type="button"
                className={mode === MODES.DEMO ? 'active' : ''}
                onClick={() => handleModeSelect(MODES.DEMO)}
                disabled={modeSwitchBusy}
              >
                {modeSwitchBusy && modeSwitchTarget === MODES.DEMO ? 'Preparing...' : 'Demo'}
              </button>
            </div>
            <button type="button" className="icon-btn" onClick={() => setSettingsOpen(true)} aria-label="Open settings">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M11.983 3.5c.286 0 .567.048.834.142l.396 1.19a7.232 7.232 0 0 1 1.392.58l1.16-.57a1 1 0 0 1 1.152.199l1.886 1.886a1 1 0 0 1 .198 1.151l-.57 1.161c.229.437.421.901.575 1.388l1.193.398a1 1 0 0 1 .68.95v2.668a1 1 0 0 1-.68.949l-1.193.398a7.263 7.263 0 0 1-.575 1.388l.57 1.162a1 1 0 0 1-.198 1.15l-1.886 1.886a1 1 0 0 1-1.151.199l-1.161-.57a7.247 7.247 0 0 1-1.392.58l-.396 1.19a1 1 0 0 1-.949.68H10.65a1 1 0 0 1-.949-.68l-.396-1.19a7.247 7.247 0 0 1-1.392-.58l-1.161.57a1 1 0 0 1-1.151-.199l-1.886-1.886a1 1 0 0 1-.198-1.15l.57-1.162a7.258 7.258 0 0 1-.575-1.388l-1.193-.398a1 1 0 0 1-.68-.95v-2.667a1 1 0 0 1 .68-.95l1.193-.398c.154-.487.346-.951.575-1.388l-.57-1.161a1 1 0 0 1 .198-1.151l1.886-1.886a1 1 0 0 1 1.151-.198l1.161.57c.435-.23.901-.425 1.392-.58l.396-1.191a1 1 0 0 1 .949-.68h1.334ZM12 8.25A3.75 3.75 0 1 0 12 15.75 3.75 3.75 0 0 0 12 8.25Z"
                  fill="currentColor"
                />
              </svg>
            </button>
          </div>
        </header>

        <div className="controls-wrap">
          {mode === MODES.DEMO ? (
            <div className="stack">
              {demoStage === DEMO_STAGE.CAPTURE ? (
                <>
                  <button
                    type="button"
                    disabled={processing || demoReviewBusy || demoStarting}
                    onClick={async () => {
                      appendStatus(
                        'status',
                        isDemoRecording
                          ? 'Demo narrate button clicked: stopping recording.'
                          : 'Demo narrate button clicked: starting recording.'
                      );
                      if (!isDemoRecording && !demoSessionActive) {
                        try {
                          setProcessing(true);
                          setDemoStarting(true);
                          await ua.startDemo();
                          setDemoSessionActive(true);
                        } catch (error) {
                          appendStatus('error', error.message);
                          return;
                        } finally {
                          setDemoStarting(false);
                          setProcessing(false);
                        }
                      }
                      if (isDemoRecording) {
                        setDemoCanFinalize(true);
                      } else {
                        setDemoCanFinalize(false);
                      }
                      toggleDemoRecording();
                    }}
                    className={`glass-btn ${isDemoRecording ? 'danger' : 'primary'} ${
                      processing || demoReviewBusy || demoStarting ? 'disabled' : ''
                    }`}
                  >
                    {demoStarting ? 'Preparing...' : isDemoRecording ? 'Stop Recording' : 'Start Recording'}
                  </button>
                  {demoSessionActive && !isDemoRecording ? (
                    <button
                      type="button"
                      disabled={processing || demoReviewBusy || demoStarting}
                      onClick={resetDemoFlow}
                      className={`glass-btn muted ${
                        processing || demoReviewBusy || demoStarting ? 'disabled' : ''
                      }`}
                    >
                      Try Again
                    </button>
                  ) : null}
                  {demoCanFinalize ? (
                    <button
                      type="button"
                      disabled={processing || demoReviewBusy || isDemoRecording || demoStarting}
                      onClick={finalizeDemoCapture}
                      className={`glass-btn muted ${
                        processing || demoReviewBusy || isDemoRecording || demoStarting ? 'disabled' : ''
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
                    className={`glass-btn ${isDemoReplyListening ? 'danger' : 'primary'} ${
                      processing || demoReviewBusy ? 'disabled' : ''
                    }`}
                  >
                    {isDemoReplyListening ? 'Listening...' : 'Hold to Reply'}
                  </button>
                  <button
                    type="button"
                    disabled={processing || demoReviewBusy || !demoAwaitingConfirmation}
                    onClick={createSkillFromReview}
                    className={`glass-btn success ${
                      processing || demoReviewBusy || !demoAwaitingConfirmation ? 'disabled' : ''
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
                    className={`glass-btn muted ${processing || demoReviewBusy ? 'disabled' : ''}`}
                  >
                    Resume Capture
                  </button>
                </>
              )}
            </div>
          ) : (
            <div className="stack">
              <button
                type="button"
                disabled={processing}
                onMouseDown={async () => {
                  appendStatus('status', 'Work speak button pressed: recording started.');
                  try {
                    await startListening();
                  } catch (error) {
                    appendStatus('error', `Microphone start failed: ${error.message}`);
                  }
                }}
                onMouseUp={() => {
                  appendStatus('status', 'Work speak button released: recording stopped.');
                  stopListening();
                }}
                onMouseLeave={
                  isListening || isWorkStarting
                    ? () => {
                        stopListening();
                      }
                    : undefined
                }
                onTouchStart={(event) => {
                  event.preventDefault();
                  appendStatus('status', 'Work speak button touched: recording started.');
                  startListening().catch((error) => {
                    appendStatus('error', `Microphone start failed: ${error.message}`);
                  });
                }}
                onTouchEnd={(event) => {
                  event.preventDefault();
                  appendStatus('status', 'Work speak touch ended: recording stopped.');
                  stopListening();
                }}
                className={`glass-btn ${isListening ? 'danger' : 'primary'} ${
                  processing ? 'disabled' : ''
                }`}
              >
                {isWorkStarting ? 'Preparing mic...' : isListening ? 'Listening...' : 'Hold to Speak'}
              </button>
              {executionRunning ? (
                <button
                  type="button"
                  className="glass-btn danger"
                  onClick={async () => {
                    if (!ua) return;
                    appendStatus('interrupt', 'Stop button pressed. Interrupting current execution task.');
                    try {
                      const result = await ua.interruptExecution();
                      if (result?.response) appendStatus('status', result.response);
                    } catch (error) {
                      appendStatus('error', `Failed to interrupt task: ${error.message}`);
                    }
                  }}
                >
                  Stop Task
                </button>
              ) : null}
            </div>
          )}
        </div>

        <section
          className="glass-inset chat-panel"
          onClick={() => setChatComposerOpen((value) => !value)}
          onFocus={() => setChatComposerOpen(true)}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'Enter') setChatComposerOpen(true);
          }}
        >
          <div className="chat-log">
            {chatFeed.length === 0 ? <p className="muted-text">Agent responses will appear here.</p> : null}
            {chatFeed.map((item) => (
              <article
                key={item.id}
                className={`chat-bubble ${item.role === 'user' ? 'chat-bubble-user' : 'chat-bubble-agent'}`}
              >
                <p>{item.message}</p>
              </article>
            ))}
            {agentBusy ? (
              <article className="chat-bubble typing-bubble" aria-live="polite">
                <p>{executionRunning ? 'Agent is using the browser' : 'Agent is working'}</p>
                <div className="typing-dots" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
              </article>
            ) : null}
          </div>
          {showComposer ? (
            <div className="chat-composer" onClick={(event) => event.stopPropagation()}>
              <input
                className="glass-input"
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                placeholder={mode === MODES.WORK ? 'Type a task...' : 'Text input in Work mode only'}
                disabled={processing || mode !== MODES.WORK}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    submitChat();
                  }
                }}
              />
              <button
                type="button"
                className="glass-btn small primary"
                onClick={submitChat}
                disabled={processing || mode !== MODES.WORK || !chatInput.trim()}
              >
                Send
              </button>
            </div>
          ) : (
            <p className="hint-text">Click to type</p>
          )}
        </section>

        {debugMode ? (
          <div className="debug-grid">
            <StatusFeed items={statusItems} />
            <SkillLog skills={skills.slice(-8).reverse()} />
          </div>
        ) : null}
      </section>

      <SettingsPanel
        open={settingsOpen}
        onClose={() => {
          setSettingsOpen(false);
          setSettingsError('');
          setSettingsDraft(settingsToDraft(settings));
          setSettingsTouched({});
        }}
        settings={settings}
        skills={skills.slice().reverse()}
        draft={settingsDraft}
        touched={settingsTouched}
        onDraftChange={(field, value) => {
          setSettingsDraft((prev) => ({ ...prev, [field]: value }));
          setSettingsTouched((prev) => ({ ...prev, [field]: true }));
        }}
        onSave={saveSettings}
        saving={settingsSaving}
        saveError={settingsError}
        hasChanges={hasSettingsChanges}
        onDeleteSkill={deleteSkillFromSettings}
        deletingSkillId={deletingSkillId}
      />
    </main>
  );
}
