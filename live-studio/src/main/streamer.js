import { spawn } from 'child_process';
import ffmpegStatic from 'ffmpeg-static';

// แก้ path เมื่อรันในแพ็กเกจ asar (ffmpeg ถูก unpack ออกมา)
const ffmpegPath = (ffmpegStatic || 'ffmpeg').replace('app.asar', 'app.asar.unpacked');

/**
 * StreamManager — จัดการการไลฟ์หลายช่องพร้อมกัน
 * แต่ละช่อง (channelId) มี ffmpeg process ของตัวเอง อ่านวิดีโอ webm จาก stdin
 * แล้ว transcode เป็น FLV/H.264 ส่งออก RTMP ของ TikTok (หรือปลายทางอื่น)
 */
export class StreamManager {
  constructor() {
    /** @type {Map<string, {proc: import('child_process').ChildProcess, stats: object}>} */
    this.channels = new Map();
  }

  isLive(channelId) {
    return this.channels.has(channelId);
  }

  liveChannels() {
    return [...this.channels.keys()];
  }

  /**
   * เริ่มไลฟ์ช่องหนึ่ง
   * @param {string} channelId
   * @param {object} opts { rtmpUrl, streamKey, videoBitrate, audioBitrate, fps, resolution, preset }
   * @param {function} onEvent (channelId, event, payload)
   */
  start(channelId, opts, onEvent) {
    if (this.channels.has(channelId)) {
      throw new Error(`ช่อง ${channelId} กำลังไลฟ์อยู่แล้ว`);
    }

    const {
      rtmpUrl,
      streamKey,
      videoBitrate = '4500k',
      audioBitrate = '160k',
      fps = 30,
      preset = 'veryfast',
    } = opts;

    if (!rtmpUrl || !streamKey) {
      throw new Error('ต้องมี RTMP URL และ Stream Key');
    }

    // รวม url + key ให้เป็นปลายทางเดียว
    const target = rtmpUrl.replace(/\/+$/, '') + '/' + streamKey;

    const args = [
      '-hide_banner',
      '-loglevel', 'warning',
      // อ่าน webm (VP8/VP9 + Opus) จาก stdin ที่ renderer ส่งเข้ามา
      '-f', 'webm',
      '-i', 'pipe:0',
      // วิดีโอ → H.264
      '-c:v', 'libx264',
      '-preset', preset,
      '-tune', 'zerolatency',
      '-profile:v', 'main',
      '-pix_fmt', 'yuv420p',
      '-b:v', videoBitrate,
      '-maxrate', videoBitrate,
      '-bufsize', doubleBitrate(videoBitrate),
      '-g', String(fps * 2),
      '-r', String(fps),
      // เสียง → AAC
      '-c:a', 'aac',
      '-b:a', audioBitrate,
      '-ar', '44100',
      // ปลายทาง RTMP
      '-f', 'flv',
      target,
    ];

    const proc = spawn(ffmpegPath, args, { stdio: ['pipe', 'ignore', 'pipe'] });
    const stats = { startedAt: Date.now(), bytes: 0 };

    proc.stderr.on('data', (data) => {
      const line = data.toString();
      // ffmpeg เขียน progress/warning มาที่ stderr — ส่งกลับไปให้ UI เห็น
      onEvent?.(channelId, 'log', line);
    });

    proc.on('error', (err) => {
      onEvent?.(channelId, 'error', err.message);
      this.channels.delete(channelId);
    });

    proc.on('close', (code, signal) => {
      this.channels.delete(channelId);
      onEvent?.(channelId, 'stopped', { code, signal });
    });

    // กัน EPIPE ตอน ffmpeg ปิดก่อน renderer หยุดส่งข้อมูล
    proc.stdin.on('error', (err) => {
      if (err && err.code !== 'EPIPE') {
        onEvent?.(channelId, 'error', err.message);
      }
    });

    this.channels.set(channelId, { proc, stats });
    onEvent?.(channelId, 'started', { startedAt: stats.startedAt });
    return true;
  }

  /** ป้อน chunk วิดีโอ (Buffer/Uint8Array) จาก renderer เข้าไปที่ ffmpeg stdin */
  writeChunk(channelId, chunk) {
    const ch = this.channels.get(channelId);
    if (!ch) return false;
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    ch.stats.bytes += buf.length;
    if (ch.proc.stdin.writable) {
      ch.proc.stdin.write(buf);
      return true;
    }
    return false;
  }

  /** หยุดไลฟ์ช่องหนึ่งอย่างนุ่มนวล */
  stop(channelId) {
    const ch = this.channels.get(channelId);
    if (!ch) return false;
    try {
      ch.proc.stdin.end();
    } catch (_) {
      /* ignore */
    }
    // ให้เวลา flush แล้วค่อยฆ่าถ้ายังไม่ปิด
    const proc = ch.proc;
    setTimeout(() => {
      if (!proc.killed) {
        try {
          proc.kill('SIGKILL');
        } catch (_) {
          /* ignore */
        }
      }
    }, 3000);
    return true;
  }

  /** หยุดทุกช่อง (ใช้ตอนปิดโปรแกรม) */
  stopAll() {
    for (const id of this.channels.keys()) {
      this.stop(id);
    }
  }

  getStats(channelId) {
    const ch = this.channels.get(channelId);
    if (!ch) return null;
    return {
      ...ch.stats,
      uptimeSec: Math.floor((Date.now() - ch.stats.startedAt) / 1000),
    };
  }
}

function doubleBitrate(b) {
  const m = String(b).match(/^(\d+)(k|M)?$/i);
  if (!m) return b;
  const n = parseInt(m[1], 10) * 2;
  return `${n}${m[2] || ''}`;
}

export { ffmpegPath };
