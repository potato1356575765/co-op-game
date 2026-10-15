// Gives the game page a few app-only buttons (back to menu, fullscreen, quit).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cakeApp', {
  home: () => ipcRenderer.send('home'),
  toggleFullscreen: () => ipcRenderer.send('fullscreen'),
  quit: () => ipcRenderer.send('quit'),
});
