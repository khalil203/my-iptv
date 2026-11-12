// INTPROTO-TV for Windows & Mac. Loads the live app (so it always updates by itself)
// and lets it talk to the IPTV server directly from this computer.
const { app, BrowserWindow, ipcMain, shell, session } = require('electron');
const path = require('path');
const APP_URL = process.env.INTPROTO_URL || 'https://my-iptv.mrkhalil-ben-salah.workers.dev';
const APP_HOST = new URL(APP_URL).host;
let ua = 'IPTVSmartersPro';

function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 380, minHeight: 600, backgroundColor: '#060a12', title: 'INTPROTO-TV',
    icon: path.join(__dirname, 'icon.png'), autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, webSecurity: false, allowRunningInsecureContent: true },
  });
  // Streams from the IPTV server: send the player identity the server expects.
  session.defaultSession.webRequest.onBeforeSendHeaders((details, cb) => {
    try { if (new URL(details.url).host !== APP_HOST && !/googleapis|gstatic|jsdelivr/.test(details.url)) details.requestHeaders['User-Agent'] = ua; } catch {}
    cb({ requestHeaders: details.requestHeaders });
  });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (new URL(url).host !== APP_HOST) { e.preventDefault(); shell.openExternal(url); } });
  win.loadURL(APP_URL);
  win.webContents.on('did-fail-load', () => win.loadURL(`data:text/html,<body style="background:#060a12;color:#fff;font-family:sans-serif;display:grid;place-items:center;height:100vh"><div style="text-align:center"><h2>INTPROTO-TV</h2><p>No internet connection</p><button onclick="location.href='${APP_URL}'" style="padding:12px 24px;border:0;border-radius:10px;background:#12bfd8;color:#fff;font-size:16px">Retry</button></div></body>`));
}

ipcMain.handle('iptv-fetch', async (_e, url, agent) => {
  if (agent) ua = agent;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': ua }, redirect: 'follow' });
    return { status: r.status, body: await r.text() };
  } catch (e) { return { status: -1, body: String(e.message) }; }
});
ipcMain.on('iptv-ua', (_e, agent) => { if (agent) ua = agent; });

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
