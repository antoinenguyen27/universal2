const { contextBridge, ipcRenderer } = require('electron');
// In sandboxed preload, requiring local files can fail. Keep channel constants local.
const IPC_CHANNELS = {
  VOICE_PROCESS: 'voice:process',
  DEMO_START: 'demo:start',
  DEMO_END: 'demo:end',
  DEMO_FINALIZE: 'demo:finalize',
  DEMO_SAVE: 'demo:save',
  WORK_STOP: 'work:stop',
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SKILLS_LIST: 'skills:list',
  CUA_INTERRUPT: 'cua:interrupt',
  STATUS_UPDATE: 'status:update',
  CUA_STATE: 'cua:state'
};

contextBridge.exposeInMainWorld('ua', {
  processVoice: (audioBase64, mode, audioFormat, demoStage) =>
    ipcRenderer.invoke(IPC_CHANNELS.VOICE_PROCESS, { audioBase64, mode, audioFormat, demoStage }),
  startDemo: () => ipcRenderer.invoke(IPC_CHANNELS.DEMO_START),
  endDemo: () => ipcRenderer.invoke(IPC_CHANNELS.DEMO_END),
  finalizeDemo: () => ipcRenderer.invoke(IPC_CHANNELS.DEMO_FINALIZE),
  saveDemoSkill: () => ipcRenderer.invoke(IPC_CHANNELS.DEMO_SAVE),
  stopWork: () => ipcRenderer.invoke(IPC_CHANNELS.WORK_STOP),
  getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET),
  setSettings: (patch) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_SET, patch),
  listSkills: () => ipcRenderer.invoke(IPC_CHANNELS.SKILLS_LIST),
  interruptCUA: () => ipcRenderer.invoke(IPC_CHANNELS.CUA_INTERRUPT),
  onStatus: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on(IPC_CHANNELS.STATUS_UPDATE, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.STATUS_UPDATE, listener);
  },
  onCUAState: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on(IPC_CHANNELS.CUA_STATE, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.CUA_STATE, listener);
  }
});
