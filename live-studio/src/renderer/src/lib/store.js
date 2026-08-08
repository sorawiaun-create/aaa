// เก็บการตั้งค่าช่อง/สตรีมไว้ใน localStorage
const KEY = 'live-studio:channels';

export function loadChannels() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return [defaultChannel('ช่องหลัก')];
}

export function saveChannels(channels) {
  localStorage.setItem(KEY, JSON.stringify(channels));
}

export function defaultChannel(name) {
  return {
    id: 'ch_' + Math.random().toString(36).slice(2, 9),
    name,
    // ปลายทาง RTMP — TikTok LIVE Studio จะให้ Server URL + Stream Key มา
    rtmpUrl: 'rtmp://live.tiktok.com/live',
    streamKey: '',
    resolution: '1280x720',
    fps: 30,
    videoBitrate: '4500k',
    audioBitrate: '160k',
  };
}
