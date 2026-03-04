import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain, session } from 'electron';
import ipcChannelsModule from './ipc-channels.cjs';
import { registerMainWindow, pushStatus } from './status-bus.js';
import { closeStagehand, getPage } from './stagehand-manager.js';
import { getRuntimeSettings, normalizeExecutionMode, persistEnvPatch } from './env-settings.js';
import { transcribeAudio } from '../voice/transcription.js';
import { speak } from '../voice/tts.js';
import { runOrchestratorTurn, interruptCurrentTask, resetOrchestratorState } from '../agent/orchestrator.js';
import {
  startDemoSession,
  endDemoSession,
  handleVoiceSegment,
  finalizeDemoCaptureForReview,
  saveDraftFromReview
} from '../agent/demo-agent.js';
import { clearSessionMemory } from '../memory/session-memory.js';
import { deleteSkill, loadAllSkills } from '../skills/skill-store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { IPC_CHANNELS } = ipcChannelsModule;
const EXECUTION_MODEL = 'anthropic/claude-haiku-4-5-20251001';
const REQUIRED_ENV_VARS = ['OPENROUTER_API_KEY', 'ANTHROPIC_API_KEY'];

let mainWindow = null;
const runtimeSettings = {
  orchestratorModel: process.env.ORCHESTRATOR_MODEL || 'google/gemini-3-flash-preview',
  demoModel: process.env.DEMO_MODEL || 'google/gemini-2.5-flash'
};

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 340,
    height: 544,
    minWidth: 340,
    minHeight: 544,
    show: false,
    title: 'Universal',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: true
    }
  });

  registerMainWindow(mainWindow);
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.webContents.on('did-finish-load', () => {
    console.log(`[electron] did-finish-load: ${mainWindow?.webContents.getURL()}`);
  });
  mainWindow.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      console.error(
        `[electron] did-fail-load mainFrame=${isMainFrame} code=${errorCode} url=${validatedURL} error=${errorDescription}`
      );
    }
  );
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[electron] render-process-gone reason=${details.reason} exitCode=${details.exitCode}`);
  });
  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.log(`[renderer:${level}] ${sourceId}:${line} ${message}`);
  });
  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error(`[electron] preload-error path=${preloadPath} error=${error?.message || error}`);
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173').catch((error) => {
      console.error(`[electron] loadURL failed: ${error.message}`);
    });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html')).catch((error) => {
      console.error(`[electron] loadFile failed: ${error.message}`);
    });
  }
}

function hardenSessionSecurity() {
  // Verified via web: Electron security checklist recommends denying navigation and limiting window creation by default.
  const isDev = process.env.NODE_ENV === 'development';
  if (!isDev) {
    const csp =
      "default-src 'self'; connect-src 'self'; media-src 'self' blob:; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self';";
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [csp]
        }
      });
    });
  }

  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (navigationEvent, url) => {
      const isLocalDev = url.startsWith('http://localhost:5173');
      const isLocalFile = url.startsWith('file://');
      if (!isLocalDev && !isLocalFile) navigationEvent.preventDefault();
    });
  });
}

function getMissingRequiredKeys() {
  return REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
}

function settingsPayload() {
  const runtime = getRuntimeSettings();
  return {
    openrouterKey: runtime.openrouterConfigured ? 'configured' : '',
    anthropicKey: runtime.anthropicConfigured ? 'configured' : '',
    elevenlabsKey: runtime.elevenlabsConfigured ? 'configured' : '',
    elevenlabsVoiceId: runtime.elevenlabsVoiceConfigured ? 'configured' : '',
    openrouterConfigured: runtime.openrouterConfigured,
    anthropicConfigured: runtime.anthropicConfigured,
    elevenlabsConfigured: runtime.elevenlabsConfigured,
    elevenlabsVoiceConfigured: runtime.elevenlabsVoiceConfigured,
    debugMode: runtime.debugMode,
    executionMode: runtime.executionMode,
    missingRequiredKeys: getMissingRequiredKeys(),
    executionModel: EXECUTION_MODEL,
    orchestratorModel: runtimeSettings.orchestratorModel,
    demoModel: runtimeSettings.demoModel
  };
}

function assertRuntimeReady(actionLabel) {
  const missing = getMissingRequiredKeys();
  if (!missing.length) return;
  throw new Error(`${actionLabel} unavailable: missing required key(s): ${missing.join(', ')}.`);
}

async function processWorkInput(userInput, source) {
  assertRuntimeReady('Work mode');
  pushStatus(`Routing ${source} input to work orchestrator.`, 'status');
  const result = await runOrchestratorTurn(userInput);
  pushStatus('Work agent response generated.', 'api');
  const speech = result.response ? await speak(result.response) : null;
  if (speech?.source) {
    pushStatus(`TTS finished (source=${speech.source}).`, 'api');
  }

  return {
    response: result.response || null,
    ttsAudioBase64: speech?.audioBase64 || null,
    ttsMimeType: speech?.mimeType || null
  };
}

app.whenReady().then(async () => {
  if (!gotSingleInstanceLock) return;

  hardenSessionSecurity();
  createWindow();
  const missing = getMissingRequiredKeys();
  if (missing.length) {
    setTimeout(
      () =>
        pushStatus(
          `Startup warning: missing required environment variable(s): ${missing.join(', ')}. Configure keys in Settings.`,
          'warning'
        ),
      1200
    );
  }

  pushStatus('Universal ready.');
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.on('window-all-closed', async () => {
  await endDemoSession().catch(() => {});
  await closeStagehand().catch(() => {});
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async () => {
  await endDemoSession().catch(() => {});
  await closeStagehand().catch(() => {});
});

ipcMain.handle(IPC_CHANNELS.VOICE_PROCESS, async (_event, payload) => {
  const { audioBase64, mode, audioFormat, demoStage } = payload || {};
  let transcript = '';

  try {
    pushStatus(`Voice process invoked (mode=${mode || 'unknown'}, format=${audioFormat || 'webm'}).`, 'status');

    if (mode === 'interrupt') {
      pushStatus('Voice process routing to interrupt handler.', 'status');
      return interruptCurrentTask();
    }

    assertRuntimeReady(mode === 'demo' ? 'Demo mode' : 'Work mode');

    if (mode === 'demo') {
      const page = await getPage().catch(() => null);
      const url = typeof page?.url === 'function' ? page.url() : '';
      if (url) pushStatus(`Demo context URL: ${url}`, 'status');
    }

    transcript = await transcribeAudio(audioBase64, { onLog: pushStatus, audioFormat });
    if (!transcript) {
      pushStatus('Transcription returned empty transcript.', 'warning');
      return { transcript: '', response: null, ttsAudioBase64: null, ttsMimeType: null };
    }

    pushStatus(`Transcription complete (${transcript.length} chars).`, 'api');
    pushStatus(transcript, 'transcript', {
      source: 'voice',
      mode: mode || 'work',
      stage: demoStage || null
    });

    if (mode === 'demo') {
      pushStatus(`Routing transcript to demo agent (stage=${demoStage || 'capture'}).`, 'status');
      const result = await handleVoiceSegment(transcript);
      const isCaptureStage = demoStage === 'capture';
      pushStatus('Demo agent response generated.', 'api');
      const speech =
        !isCaptureStage && result.agentMessage ? await speak(result.agentMessage) : null;
      if (!isCaptureStage && speech?.source) {
        pushStatus(`TTS finished (source=${speech.source}).`, 'api');
      }
      if (isCaptureStage) {
        pushStatus('Demo capture updated. Use End Demo & Review for clarifications and skill creation.', 'status');
      }
      return {
        transcript,
        response: isCaptureStage ? null : result.agentMessage,
        skillWritten: result.skillWritten,
        awaitingConfirmation: Boolean(result.awaitingConfirmation),
        ttsAudioBase64: speech?.audioBase64 || null,
        ttsMimeType: speech?.mimeType || null
      };
    }

    return {
      transcript,
      ...(await processWorkInput(transcript, 'voice'))
    };
  } catch (error) {
    pushStatus(`Error: ${error.message}`, 'error');
    return {
      transcript,
      response: `Error: ${error.message}`,
      ttsAudioBase64: null,
      ttsMimeType: null,
      error: true
    };
  }
});

ipcMain.handle(IPC_CHANNELS.WORK_TEXT_PROCESS, async (_event, payload) => {
  const text = String(payload?.text || '').trim();
  const mode = payload?.mode || 'work';
  if (!text) return { response: null, ttsAudioBase64: null, ttsMimeType: null };
  if (mode !== 'work') {
    return {
      response: 'Text input is currently supported in Work mode only.',
      ttsAudioBase64: null,
      ttsMimeType: null,
      error: true
    };
  }

  try {
    assertRuntimeReady('Work mode');
    pushStatus(`Text process invoked (mode=${mode}).`, 'status');
    return await processWorkInput(text, 'text');
  } catch (error) {
    pushStatus(`Error: ${error.message}`, 'error');
    return {
      response: `Error: ${error.message}`,
      ttsAudioBase64: null,
      ttsMimeType: null,
      error: true
    };
  }
});

ipcMain.handle(IPC_CHANNELS.DEMO_START, async () => {
  assertRuntimeReady('Demo mode');
  pushStatus('Demo start requested from renderer.', 'status');
  await startDemoSession();
  return { ok: true };
});

ipcMain.handle(IPC_CHANNELS.DEMO_END, async () => {
  pushStatus('Demo end requested from renderer.', 'status');
  const summary = await endDemoSession();
  return { ok: true, summary };
});

ipcMain.handle(IPC_CHANNELS.DEMO_FINALIZE, async () => {
  assertRuntimeReady('Demo mode');
  pushStatus('Demo finalize requested from renderer.', 'status');
  const page = await getPage().catch(() => null);
  const url = typeof page?.url === 'function' ? page.url() : '';
  if (url) pushStatus(`Demo finalize context URL: ${url}`, 'status');
  const result = await finalizeDemoCaptureForReview();
  const speech = result.agentMessage ? await speak(result.agentMessage) : null;
  return {
    ok: true,
    response: result.agentMessage,
    skillWritten: result.skillWritten || null,
    awaitingConfirmation: Boolean(result.awaitingConfirmation),
    ttsAudioBase64: speech?.audioBase64 || null,
    ttsMimeType: speech?.mimeType || null
  };
});

ipcMain.handle(IPC_CHANNELS.DEMO_SAVE, async () => {
  assertRuntimeReady('Demo mode');
  pushStatus('Demo save requested from renderer.', 'status');
  const result = await saveDraftFromReview();
  const speech = result.agentMessage ? await speak(result.agentMessage) : null;
  return {
    ok: true,
    response: result.agentMessage,
    skillWritten: result.skillWritten || null,
    awaitingConfirmation: Boolean(result.awaitingConfirmation),
    ttsAudioBase64: speech?.audioBase64 || null,
    ttsMimeType: speech?.mimeType || null
  };
});

ipcMain.handle(IPC_CHANNELS.WORK_STOP, async () => {
  assertRuntimeReady('Work mode');
  pushStatus('Work stop requested from renderer.', 'status');
  await interruptCurrentTask();
  clearSessionMemory();
  resetOrchestratorState();
  return { ok: true };
});

ipcMain.handle(IPC_CHANNELS.EXEC_INTERRUPT, async () => {
  assertRuntimeReady('Work mode');
  return interruptCurrentTask();
});

ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, async () => {
  return settingsPayload();
});

ipcMain.handle(IPC_CHANNELS.SETTINGS_SET, async (_event, patch) => {
  const envPatch = {};
  if (Object.prototype.hasOwnProperty.call(patch || {}, 'openrouterKey')) {
    envPatch.OPENROUTER_API_KEY = String(patch.openrouterKey ?? '');
  }
  if (Object.prototype.hasOwnProperty.call(patch || {}, 'anthropicKey')) {
    envPatch.ANTHROPIC_API_KEY = String(patch.anthropicKey ?? '');
  }
  if (Object.prototype.hasOwnProperty.call(patch || {}, 'executionMode')) {
    envPatch.STAGEHAND_AGENT_MODE = normalizeExecutionMode(patch.executionMode);
  }
  if (Object.prototype.hasOwnProperty.call(patch || {}, 'elevenlabsKey')) {
    envPatch.ELEVENLABS_API_KEY = String(patch.elevenlabsKey ?? '');
  }
  if (Object.prototype.hasOwnProperty.call(patch || {}, 'elevenlabsVoiceId')) {
    envPatch.ELEVENLABS_VOICE_ID = String(patch.elevenlabsVoiceId ?? '');
  }
  if (Object.prototype.hasOwnProperty.call(patch || {}, 'debugMode')) {
    envPatch.DEBUG_MODE = Boolean(patch.debugMode);
  }
  if (Object.keys(envPatch).length) {
    await persistEnvPatch(envPatch);
  }
  if (typeof patch?.orchestratorModel === 'string' && patch.orchestratorModel.trim()) {
    runtimeSettings.orchestratorModel = patch.orchestratorModel.trim();
    process.env.ORCHESTRATOR_MODEL = runtimeSettings.orchestratorModel;
  }
  if (typeof patch?.demoModel === 'string' && patch.demoModel.trim()) {
    runtimeSettings.demoModel = patch.demoModel.trim();
    process.env.DEMO_MODEL = runtimeSettings.demoModel;
  }
  return { ok: true, settings: settingsPayload() };
});

ipcMain.handle(IPC_CHANNELS.SKILLS_LIST, async () => {
  const skills = await loadAllSkills();
  return { skills };
});

ipcMain.handle(IPC_CHANNELS.SKILLS_DELETE, async (_event, payload) => {
  await deleteSkill(payload || {});
  const skills = await loadAllSkills();
  return { ok: true, skills };
});
