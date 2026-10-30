'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('likhonNative', {
  netInfo: () => ipcRenderer.invoke('net-info'),
  newPin: () => ipcRenderer.invoke('new-pin'),
  saveBoard: (opts) => ipcRenderer.invoke('save-board', opts),
  openBoard: () => ipcRenderer.invoke('open-board'),
  pickImage: () => ipcRenderer.invoke('pick-image'),
  exportPng: (opts) => ipcRenderer.invoke('export-png', opts),
  exportPdf: (opts) => ipcRenderer.invoke('export-pdf', opts),
  toggleFullscreen: () => ipcRenderer.invoke('toggle-fullscreen'),
  showInFolder: (p) => ipcRenderer.invoke('show-in-folder', p),
});
