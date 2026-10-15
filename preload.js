// Gives the game page a few app-only buttons (back to menu, fullscreen, quit) and the anti-cheat status.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cakeApp', {
  home: () => ipcRenderer.send('home'),
  toggleFullscreen: () => ipcRenderer.send('fullscreen'),
  quit: () => ipcRenderer.send('quit'),
  relaunch: () => ipcRenderer.send('relaunch'),
  antiCheatStatus: () => ipcRenderer.invoke('anti-cheat-status'),
});
