// 界面和主进程之间唯一的通道：只暴露专注芽需要的几个调用，界面本身没有 Node 权限。
const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = new Set(['state', 'chime']);

contextBridge.exposeInMainWorld('bloom', {
  platform: process.platform,
  snapshot: () => ipcRenderer.invoke('bloom:snapshot'),
  action: (name, ...args) => ipcRenderer.invoke('bloom:action', name, ...args),
  updateSettings: (patch, seq) => ipcRenderer.send('bloom:settings', patch, seq),
  loadAmbient: (id) => ipcRenderer.invoke('bloom:ambient-asset', id),
  command: (name) => ipcRenderer.send('bloom:window', name),
  on(channel, callback) {
    if (!CHANNELS.has(channel)) throw new Error(`unknown channel: ${channel}`);
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on(`bloom:${channel}`, listener);
    return () => ipcRenderer.removeListener(`bloom:${channel}`, listener);
  }
});
