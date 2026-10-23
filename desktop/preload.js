// Loaded only into the local panel and settings pages, never into the board (server) view.
// main.js also checks that each message comes from the page that may send it.
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel, cb) => ipcRenderer.on(channel, (_e, value) => cb(value));

contextBridge.exposeInMainWorld('pragmatic', {
  ready: (cols, rows) => ipcRenderer.send('pty:ready', { cols, rows }),
  write: (data) => ipcRenderer.send('pty:write', data),
  resize: (cols, rows) => ipcRenderer.send('pty:resize', { cols, rows }),
  restart: () => ipcRenderer.send('pty:restart'),
  chooseFolder: () => ipcRenderer.send('panel:choose-folder'),
  openLink: (url) => ipcRenderer.send('open-link', url),
  onData: (cb) => on('pty:data', cb),
  onExit: (cb) => on('pty:exit', cb),
  onInfo: (cb) => on('pty:info', cb),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (value) => ipcRenderer.invoke('settings:save', value),
  showData: () => ipcRenderer.send('settings:show-data'),
});
