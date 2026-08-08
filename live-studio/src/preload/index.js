import { contextBridge, ipcRenderer } from 'electron';

// สะพานปลอดภัยระหว่าง renderer (React) กับ main process
contextBridge.exposeInMainWorld('studio', {
  listCaptureSources: () => ipcRenderer.invoke('capturer:list'),

  startStream: (channelId, options) =>
    ipcRenderer.invoke('stream:start', { channelId, options }),

  // ส่ง chunk วิดีโอ (ArrayBuffer) — ใช้ send เพื่อ throughput สูง
  sendChunk: (channelId, chunk) =>
    ipcRenderer.send('stream:chunk', { channelId, chunk }),

  stopStream: (channelId) => ipcRenderer.invoke('stream:stop', { channelId }),

  getStatus: (channelId) => ipcRenderer.invoke('stream:status', { channelId }),

  newWindow: () => ipcRenderer.invoke('app:new-window'),

  // รับ event จาก ffmpeg (started/stopped/log/error)
  onStreamEvent: (handler) => {
    const listener = (_e, data) => handler(data);
    ipcRenderer.on('stream:event', listener);
    return () => ipcRenderer.removeListener('stream:event', listener);
  },
});
