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

module.exports = { IPC_CHANNELS };
