// Same "IPTVBridge" the Android app provides, so the web app connects to the IPTV server directly.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('IPTVBridge', {
  version: () => '2-desktop',
  inline: true, // play inside the app window
  fetch: (id, url, ua) => {
    ipcRenderer.invoke('iptv-fetch', url, ua).then((r) => window.postMessage({ __iptv: 1, id, status: r.status, body: r.body }, '*'));
  },
  setUserAgent: (ua) => ipcRenderer.send('iptv-ua', ua),
});
