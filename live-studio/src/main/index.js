import { app, BrowserWindow, ipcMain, desktopCapturer, session } from 'electron';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { StreamManager } from './streamer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const streamer = new StreamManager();

/** สร้างหน้าต่างหลัก 1 บาน = 1 ช่องได้อิสระ (เปิดหลายบาน = หลายช่องพร้อมกัน) */
function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0d0d12',
    title: 'Live Studio',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
    },
  });

  win.webContents.on('did-fail-load', (_e, code, desc) => {
    console.error('[renderer] did-fail-load', code, desc);
  });
  win.webContents.on('preload-error', (_e, path, err) => {
    console.error('[preload] error', path, err?.message);
  });
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) console.error('[renderer console]', message);
  });

  // dev: โหลดจาก vite dev server / prod: โหลดไฟล์ที่ build แล้ว
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return win;
}

app.whenReady().then(() => {
  // อนุญาต getDisplayMedia (จับหน้าจอ) — ตอบด้วยหน้าจอแรกเป็นค่าเริ่มต้น
  session.defaultSession.setDisplayMediaRequestHandler(
    (request, callback) => {
      desktopCapturer.getSources({ types: ['screen', 'window'] }).then((sources) => {
        callback({ video: sources[0], audio: 'loopback' });
      });
    },
    { useSystemPicker: true }
  );

  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  streamer.stopAll();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => streamer.stopAll());

function registerIpc() {
  // ส่ง event ของ ffmpeg กลับไปหน้าต่างที่เป็นเจ้าของช่องนั้น
  const emit = (channelId, event, payload) => {
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send('stream:event', { channelId, event, payload });
    }
  };

  ipcMain.handle('capturer:list', async () => {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 180 },
    });
    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      thumbnail: s.thumbnail.toDataURL(),
    }));
  });

  ipcMain.handle('stream:start', (_e, { channelId, options }) => {
    try {
      streamer.start(channelId, options, emit);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // ส่ง chunk วิดีโอเข้าไปที่ ffmpeg (ArrayBuffer จาก renderer)
  ipcMain.on('stream:chunk', (_e, { channelId, chunk }) => {
    streamer.writeChunk(channelId, chunk);
  });

  ipcMain.handle('stream:stop', (_e, { channelId }) => {
    streamer.stop(channelId);
    return { ok: true };
  });

  ipcMain.handle('stream:status', (_e, { channelId }) => {
    return {
      live: streamer.isLive(channelId),
      stats: streamer.getStats(channelId),
    };
  });

  // เปิดหน้าต่างใหม่ = อีกช่องหนึ่งบนเครื่องเดียวกัน
  ipcMain.handle('app:new-window', () => {
    createWindow();
    return { ok: true };
  });
}
