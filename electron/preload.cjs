const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jobdone', {
  read: () => ipcRenderer.invoke('store:read'),
  write: (data) => ipcRenderer.invoke('store:write', data),
  hide: () => ipcRenderer.invoke('window:close'),
  minimize: () => ipcRenderer.invoke('window:minimize'),
  setAlwaysOnTop: (flag) => ipcRenderer.invoke('window:set-always-on-top', flag),
  setCompactHeight: (height) => ipcRenderer.invoke('window:set-compact-height', height),
  restoreExpandedHeight: () => ipcRenderer.invoke('window:restore-expanded-height'),
  openExternal: (href) => ipcRenderer.invoke('link:open-external', href),
});
