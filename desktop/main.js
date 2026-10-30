// লিখন বোর্ড — Electron মূল প্রসেস
'use strict';

const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { startServer, localIPv4 } = require('./server');

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let win = null;
let srv = null;
const token = { value: '' };
let config = {};
const configFile = () => path.join(app.getPath('userData'), 'config.json');

function loadConfig() {
  try {
    config = JSON.parse(fs.readFileSync(configFile(), 'utf8'));
  } catch {
    config = {};
  }
  if (!/^\d{4}$/.test(config.pin || '')) config.pin = newPin();
  saveConfig();
}
function saveConfig() {
  try {
    fs.mkdirSync(path.dirname(configFile()), { recursive: true });
    fs.writeFileSync(configFile(), JSON.stringify(config, null, 2));
  } catch {}
}
function newPin() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#eef0f4',
    title: 'লিখন বোর্ড',
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'), {
    query: { port: String(srv.port), k: token.value },
  });
  win.once('ready-to-show', () => {
    win.maximize();
    win.show();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12' && !app.isPackaged) win.webContents.toggleDevTools();
  });
}

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(async () => {
  loadConfig();
  token.value = config.pin;
  try {
    srv = await startServer({ root: __dirname, token, port: config.port || 8765 });
  } catch (err) {
    dialog.showErrorBox('লিখন বোর্ড', 'সার্ভার চালু করা যায়নি:\n' + err.message);
    app.quit();
    return;
  }
  createWindow();
});

app.on('window-all-closed', () => {
  if (srv) srv.close();
  app.quit();
});

// ---------- রেন্ডারারের জন্য সেবা ----------

ipcMain.handle('net-info', () => ({ ips: localIPv4(), port: srv.port, pin: token.value, version: app.getVersion() }));

ipcMain.handle('new-pin', () => {
  config.pin = newPin();
  token.value = config.pin;
  saveConfig();
  srv.kickAllPads();
  return token.value;
});

const FILTER = [{ name: 'লিখন ফাইল', extensions: ['likhon'] }];

ipcMain.handle('save-board', async (_e, { json, suggested, filePath }) => {
  let target = filePath;
  if (!target) {
    const r = await dialog.showSaveDialog(win, {
      title: 'বোর্ড সেভ করুন',
      defaultPath: path.join(app.getPath('documents'), (suggested || 'বোর্ড') + '.likhon'),
      filters: FILTER,
    });
    if (r.canceled || !r.filePath) return null;
    target = r.filePath;
  }
  fs.writeFileSync(target, json, 'utf8');
  return target;
});

ipcMain.handle('open-board', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'বোর্ড খুলুন', filters: FILTER, properties: ['openFile'] });
  if (r.canceled || !r.filePaths[0]) return null;
  return { filePath: r.filePaths[0], json: fs.readFileSync(r.filePaths[0], 'utf8') };
});

ipcMain.handle('pick-image', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'ছবি বাছুন',
    filters: [{ name: 'ছবি', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }],
    properties: ['openFile'],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const f = r.filePaths[0];
  const ext = path.extname(f).slice(1).toLowerCase().replace('jpg', 'jpeg');
  return `data:image/${ext};base64,` + fs.readFileSync(f).toString('base64');
});

ipcMain.handle('export-png', async (_e, { dataUrl, suggested }) => {
  const r = await dialog.showSaveDialog(win, {
    title: 'ছবি হিসেবে সেভ',
    defaultPath: path.join(app.getPath('pictures'), (suggested || 'বোর্ড') + '.png'),
    filters: [{ name: 'PNG ছবি', extensions: ['png'] }],
  });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, Buffer.from(dataUrl.split(',')[1], 'base64'));
  return r.filePath;
});

// প্রতিটি পেজের ছবি দিয়ে একটা লুকানো উইন্ডোতে PDF তৈরি
ipcMain.handle('export-pdf', async (_e, { pages, suggested }) => {
  const r = await dialog.showSaveDialog(win, {
    title: 'PDF হিসেবে সেভ',
    defaultPath: path.join(app.getPath('documents'), (suggested || 'বোর্ড') + '.pdf'),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (r.canceled || !r.filePath) return null;
  const tmp = path.join(app.getPath('temp'), 'likhon-pdf-' + Date.now());
  fs.mkdirSync(tmp, { recursive: true });
  const imgs = pages.map((d, i) => {
    const f = path.join(tmp, `p${i}.png`);
    fs.writeFileSync(f, Buffer.from(d.split(',')[1], 'base64'));
    return `<div class="pg"><img src="p${i}.png"></div>`;
  });
  const html = `<!doctype html><meta charset="utf-8"><style>
    @page{size:297mm 167mm;margin:0} html,body{margin:0}
    .pg{width:297mm;height:167mm;display:flex;align-items:center;justify-content:center;page-break-after:always;overflow:hidden}
    .pg:last-child{page-break-after:auto} img{max-width:100%;max-height:100%}</style>${imgs.join('')}`;
  fs.writeFileSync(path.join(tmp, 'index.html'), html);
  const pw = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  try {
    await pw.loadFile(path.join(tmp, 'index.html'));
    const pdf = await pw.webContents.printToPDF({
      printBackground: true,
      pageSize: { width: 11.69, height: 6.58 },
      margins: { marginType: 'none' },
    });
    fs.writeFileSync(r.filePath, pdf);
  } finally {
    pw.destroy();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return r.filePath;
});

ipcMain.handle('toggle-fullscreen', () => {
  win.setFullScreen(!win.isFullScreen());
  return win.isFullScreen();
});

ipcMain.handle('show-in-folder', (_e, p) => shell.showItemInFolder(p));
