/**
 * StreamPump — ดึง MediaStream จาก Compositor ผ่าน MediaRecorder
 * แล้วส่ง chunk (webm) ไปที่ main process เพื่อให้ ffmpeg push RTMP
 */
export class StreamPump {
  constructor(channelId, stream, { fps = 30, videoBitsPerSecond = 4_500_000 } = {}) {
    this.channelId = channelId;
    this.stream = stream;
    this.fps = fps;
    this.videoBitsPerSecond = videoBitsPerSecond;
    this.recorder = null;
  }

  static pickMime() {
    const candidates = [
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=vp9,opus',
      'video/webm',
    ];
    for (const c of candidates) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(c)) return c;
    }
    return '';
  }

  start() {
    const mimeType = StreamPump.pickMime();
    if (!mimeType) throw new Error('เบราว์เซอร์ไม่รองรับ MediaRecorder (webm)');

    this.recorder = new MediaRecorder(this.stream, {
      mimeType,
      videoBitsPerSecond: this.videoBitsPerSecond,
      audioBitsPerSecond: 160_000,
    });

    this.recorder.ondataavailable = async (e) => {
      if (e.data && e.data.size > 0) {
        const buf = await e.data.arrayBuffer();
        window.studio.sendChunk(this.channelId, buf);
      }
    };

    // ส่ง chunk ทุก 500ms — สมดุลระหว่าง latency กับ overhead
    this.recorder.start(500);
  }

  stop() {
    if (this.recorder && this.recorder.state !== 'inactive') {
      this.recorder.stop();
    }
    this.recorder = null;
  }
}
