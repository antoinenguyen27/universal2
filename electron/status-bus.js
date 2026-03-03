import ipcChannelsModule from './ipc-channels.cjs';

const { IPC_CHANNELS } = ipcChannelsModule;

let mainWindow = null;

export function registerMainWindow(windowRef) {
  mainWindow = windowRef;
}

export function pushStatus(message, type = 'status') {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(IPC_CHANNELS.STATUS_UPDATE, {
    type,
    message,
    timestamp: Date.now()
  });
}

export function pushCUAState(running) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(IPC_CHANNELS.CUA_STATE, { running, timestamp: Date.now() });
}
