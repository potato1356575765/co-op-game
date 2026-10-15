// 🍰 Cake Defense — desktop app (Electron)
// Runs the game server inside the app and shows the game in its own window.
// Friends on the same network can join by typing this computer's address in their app.

const path = require('path');
const { app, BrowserWindow, Menu, ipcMain, shell } = require('electron');
const { start } = require('./server');

if (!app.requestSingleInstanceLock()) app.quit();

let win = null;
let homeUrl = null;

async function startServer() {
  try {
    return await start(3000);
  } catch (err) {
    if (err.code !== 'EADDRINUSE') throw err;
    return start(0); // 3000 is taken: any free port works, the menu shows the real one
  }
}

async function createWindow() {
  const port = await startServer();
  homeUrl = `http://localhost:${port}/`;

  Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 500,
    title: 'Cake Defense',
    icon: path.join(__dirname, 'build', 'icon.png'),
    backgroundColor: '#1b1430',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.once('ready-to-show', () => win.show());

  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    }
  });
  // links that try to open new windows go to the real browser instead
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // a friend's game we can't reach: back to the menu with an error instead of a blank window
  win.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (isMainFrame && code !== -3 && !url.startsWith(homeUrl)) {
      win.loadURL(`${homeUrl}?error=${encodeURIComponent(`Couldn't reach ${new URL(url).host} (${desc})`)}`);
    }
  });

  win.loadURL(homeUrl);
}

ipcMain.on('home', () => win?.loadURL(homeUrl));
ipcMain.on('fullscreen', () => win?.setFullScreen(!win.isFullScreen()));
ipcMain.on('quit', () => app.quit());

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});
app.on('window-all-closed', () => app.quit());
app.whenReady().then(createWindow);
