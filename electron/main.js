import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, ipcMain, session } from 'electron';
import ipcChannelsModule from './ipc-channels.cjs';
import { registerMainWindow, pushStatus } from './status-bus.js';
import { closeStagehand } from './stagehand-manager.js';
import { transcribeAudio } from '../voice/transcription.js';
import { speak } from '../voice/tts.js';
import { runOrchestratorTurn, interruptCurrentTask } from '../agent/orchestrator.js';
import { startDemoSession, endDemoSession, handleVoiceSegment } from '../agent/demo-agent.js';
import { clearSessionMemory } from '../memory/session-memory.js';
import { loadAllSkills } from '../skills/skill-store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { IPC_CHANNELS } = ipcChannelsModule;

let mainWindow = null;
const runtimeSettings = {
  cuaModel: process.env.CUA_MODEL || 'anthropic/claude-sonnet-4-20250514',
  orchestratorModel: process.env.ORCHESTRATOR_MODEL || 'inception/mercury',
  demoModel: process.env.DEMO_MODEL || 'google/gemini-2.5-flash'
};

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 440,
    height: 760,
    minWidth: 400,
    minHeight: 640,
    show: false,
    title: 'Universal Agent',
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

app.whenReady().then(async () => {
  if (!gotSingleInstanceLock) return;

  hardenSessionSecurity();
  createWindow();

  pushStatus('Universal Agent ready.');
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
  const { audioBase64, mode } = payload || {};

  try {
    if (mode === 'interrupt') {
      return interruptCurrentTask();
    }

    const transcript = await transcribeAudio(audioBase64);
    if (!transcript) {
      return { transcript: '', response: null, ttsAudioBase64: null, ttsMimeType: null };
    }

    pushStatus(`Heard: ${transcript}`);

    if (mode === 'demo') {
      const result = await handleVoiceSegment(transcript);
      const speech = result.agentMessage ? await speak(result.agentMessage) : null;
      return {
        transcript,
        response: result.agentMessage,
        skillWritten: result.skillWritten,
        ttsAudioBase64: speech?.audioBase64 || null,
        ttsMimeType: speech?.mimeType || null
      };
    }

    const result = await runOrchestratorTurn(transcript);
    const speech = result.response ? await speak(result.response) : null;

    return {
      transcript,
      response: result.response || null,
      ttsAudioBase64: speech?.audioBase64 || null,
      ttsMimeType: speech?.mimeType || null
    };
  } catch (error) {
    pushStatus(`Error: ${error.message}`);
    return {
      transcript: '',
      response: `Error: ${error.message}`,
      ttsAudioBase64: null,
      ttsMimeType: null,
      error: true
    };
  }
});

ipcMain.handle(IPC_CHANNELS.DEMO_START, async () => {
  await startDemoSession();
  return { ok: true };
});

ipcMain.handle(IPC_CHANNELS.DEMO_END, async () => {
  const summary = await endDemoSession();
  return { ok: true, summary };
});

ipcMain.handle(IPC_CHANNELS.WORK_STOP, async () => {
  await interruptCurrentTask();
  clearSessionMemory();
  return { ok: true };
});

ipcMain.handle(IPC_CHANNELS.CUA_INTERRUPT, async () => {
  return interruptCurrentTask();
});

ipcMain.handle(IPC_CHANNELS.SETTINGS_GET, async () => {
  const mask = (value) => (value ? '********' : '');
  return {
    openrouterKey: mask(process.env.OPENROUTER_API_KEY),
    elevenlabsKey: mask(process.env.ELEVENLABS_API_KEY),
    elevenlabsVoiceId: process.env.ELEVENLABS_VOICE_ID ? 'configured' : '',
    cuaModel: runtimeSettings.cuaModel,
    orchestratorModel: runtimeSettings.orchestratorModel,
    demoModel: runtimeSettings.demoModel
  };
});

ipcMain.handle(IPC_CHANNELS.SETTINGS_SET, async (_event, patch) => {
  if (typeof patch?.cuaModel === 'string' && patch.cuaModel.trim()) {
    runtimeSettings.cuaModel = patch.cuaModel.trim();
    process.env.CUA_MODEL = runtimeSettings.cuaModel;
  }
  if (typeof patch?.orchestratorModel === 'string' && patch.orchestratorModel.trim()) {
    runtimeSettings.orchestratorModel = patch.orchestratorModel.trim();
    process.env.ORCHESTRATOR_MODEL = runtimeSettings.orchestratorModel;
  }
  if (typeof patch?.demoModel === 'string' && patch.demoModel.trim()) {
    runtimeSettings.demoModel = patch.demoModel.trim();
    process.env.DEMO_MODEL = runtimeSettings.demoModel;
  }
  return { ok: true, settings: runtimeSettings };
});

ipcMain.handle(IPC_CHANNELS.SKILLS_LIST, async () => {
  const skills = await loadAllSkills();
  return { skills };
});
