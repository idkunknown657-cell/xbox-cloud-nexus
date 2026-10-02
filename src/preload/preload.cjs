/**
 * Main window preload — exposes a minimal, promise-based API bridge.
 * contextIsolation is ON: the page never sees Electron internals.
 */
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// Small helper: call the main API and unwrap {ok, result|error}
async function call(channel, ...args) {
  const res = await ipcRenderer.invoke(channel, ...args);
  if (!res || typeof res !== 'object') throw new Error('Bad IPC response');
  if (!res.ok) throw new Error(res.error || 'Unknown error');
  return res.result;
}

const on = (channel) => (cb) => {
  const listener = (_ev, payload) => { try { cb(payload); } catch { /* user code */ } };
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('nexus', {
  settings: {
    get: () => call('settings:get'),
    set: (k, v) => call('settings:set', k, v),
    resetAll: () => call('settings:resetAll'),
    flush: () => call('settings:flush'),
  },
  catalog: {
    library: () => call('catalog:library'),
    product: (id) => call('catalog:product', id),
    listsMeta: () => call('catalog:listsMeta'),
  },
  launch: (opts) => call('app:launchGame', opts),
  stream: {
    setFullscreen: (productId, on) => call('stream:setFullscreen', productId, on),
  },
  appInfo: () => call('app:info'),
  debugLogs: () => call('app:debugLogs'),
  toggleDevTools: () => call('app:toggleDevTools'),
  openExternal: (url) => call('app:openExternal', url),
  profiles: {
    export: (p) => call('profiles:export', p),
    import: () => call('profiles:import'),
    assignGame: (pid, profileId) => call('profiles:assignGame', pid, profileId),
  },
  window: {
    minimize: () => call('win:minimize'),
    maximizeToggle: () => call('win:maximizeToggle'),
    close: () => call('win:close'),
    mode: (m) => call('win:mode', m),
  },
  events: {
    windowState: on('window:state'),
    streamStatus: on('stream:status'),
    controllers: on('controllers:changed'),
    catalogDetails: on('catalog:details'),
  },
});
