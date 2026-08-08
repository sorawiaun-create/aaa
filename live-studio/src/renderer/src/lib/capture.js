/**
 * Compositor — หัวใจของสตูดิโอ
 * รวม "sources" (กล้อง, จับหน้าจอ, รูป, ข้อความ) วาดลง canvas เดียว
 * แล้วส่งออกเป็น MediaStream (วิดีโอจาก canvas + เสียงที่มิกซ์แล้ว)
 */
export class Compositor {
  constructor(width = 1280, height = 720, fps = 30) {
    this.width = width;
    this.height = height;
    this.fps = fps;
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d');
    this.sources = []; // {id, type, layout, hidden, muted, el, stream, audioNode, ...}
    this.running = false;
    this._raf = null;

    // สำหรับมิกซ์เสียง
    this.audioCtx = null;
    this.audioDest = null;
  }

  _ensureAudio() {
    if (!this.audioCtx) {
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      this.audioDest = this.audioCtx.createMediaStreamDestination();
    }
  }

  /** เพิ่มกล้อง */
  async addCamera(id, { deviceId } = {}) {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: deviceId ? { deviceId: { exact: deviceId } } : true,
      audio: false,
    });
    const el = document.createElement('video');
    el.srcObject = stream;
    el.muted = true;
    el.playsInline = true;
    await el.play().catch(() => {});
    this._add({ id, type: 'camera', el, stream, layout: fullLayout() });
    return id;
  }

  /** เพิ่มไมโครโฟน (เสียงล้วน) */
  async addMic(id, { deviceId } = {}) {
    this._ensureAudio();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      video: false,
    });
    const node = this.audioCtx.createMediaStreamSource(stream);
    const gain = this.audioCtx.createGain();
    node.connect(gain).connect(this.audioDest);
    this._add({ id, type: 'mic', stream, audioNode: gain, layout: null });
    return id;
  }

  /** เพิ่มการจับหน้าจอ (พร้อมเสียงระบบถ้ามี) */
  async addScreen(id) {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: this.fps },
      audio: true,
    });
    const el = document.createElement('video');
    el.srcObject = stream;
    el.muted = true;
    el.playsInline = true;
    await el.play().catch(() => {});
    let gain = null;
    if (stream.getAudioTracks().length) {
      this._ensureAudio();
      const node = this.audioCtx.createMediaStreamSource(stream);
      gain = this.audioCtx.createGain();
      node.connect(gain).connect(this.audioDest);
    }
    this._add({ id, type: 'screen', el, stream, audioNode: gain, layout: fullLayout() });
    return id;
  }

  /** เพิ่มรูปภาพ (dataURL หรือ url) */
  async addImage(id, src) {
    const img = new Image();
    img.src = src;
    await img.decode().catch(() => {});
    this._add({ id, type: 'image', el: img, src, layout: centerLayout(0.5) });
    return id;
  }

  /** เพิ่มข้อความ */
  addText(id, text, opts = {}) {
    this._add({
      id,
      type: 'text',
      text,
      font: opts.font || 'bold 48px Prompt, Arial, sans-serif',
      color: opts.color || '#ffffff',
      layout: { x: 0.05, y: 0.8, w: 0.9, h: 0.15 },
    });
    return id;
  }

  _add(source) {
    source.hidden = false;
    source.muted = false;
    // แหล่งใหม่อยู่บนสุด
    this.sources.unshift(source);
  }

  remove(id) {
    const idx = this.sources.findIndex((s) => s.id === id);
    if (idx === -1) return;
    const s = this.sources[idx];
    if (s.stream) s.stream.getTracks().forEach((t) => t.stop());
    if (s.audioNode) try { s.audioNode.disconnect(); } catch (_) {}
    this.sources.splice(idx, 1);
  }

  get(id) {
    return this.sources.find((s) => s.id === id);
  }

  setLayout(id, layout) {
    const s = this.get(id);
    if (s) s.layout = { ...s.layout, ...layout };
  }

  setHidden(id, hidden) {
    const s = this.get(id);
    if (s) s.hidden = hidden;
  }

  setMuted(id, muted) {
    const s = this.get(id);
    if (!s) return;
    s.muted = muted;
    if (s.audioNode) s.audioNode.gain.value = muted ? 0 : 1;
  }

  setVolume(id, v) {
    const s = this.get(id);
    if (s && s.audioNode) s.audioNode.gain.value = v;
  }

  /** ยกลำดับชั้น (z-order) */
  moveUp(id) {
    const i = this.sources.findIndex((s) => s.id === id);
    if (i > 0) [this.sources[i - 1], this.sources[i]] = [this.sources[i], this.sources[i - 1]];
  }
  moveDown(id) {
    const i = this.sources.findIndex((s) => s.id === id);
    if (i >= 0 && i < this.sources.length - 1)
      [this.sources[i + 1], this.sources[i]] = [this.sources[i], this.sources[i + 1]];
  }

  start() {
    if (this.running) return;
    this.running = true;
    const draw = () => {
      if (!this.running) return;
      this._renderFrame();
      this._raf = requestAnimationFrame(draw);
    };
    draw();
  }

  stop() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
  }

  _renderFrame() {
    const { ctx, width, height } = this;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, width, height);
    // วาดจากล่างขึ้นบน (ท้าย array = ชั้นล่างสุด)
    for (let i = this.sources.length - 1; i >= 0; i--) {
      const s = this.sources[i];
      if (s.hidden || !s.layout) continue;
      const r = absLayout(s.layout, width, height);
      try {
        if (s.type === 'camera' || s.type === 'screen') {
          if (s.el.readyState >= 2) drawCover(ctx, s.el, r);
        } else if (s.type === 'image') {
          if (s.el.complete) drawContain(ctx, s.el, r);
        } else if (s.type === 'text') {
          ctx.save();
          ctx.font = s.font;
          ctx.fillStyle = s.color;
          ctx.textBaseline = 'top';
          ctx.shadowColor = 'rgba(0,0,0,0.6)';
          ctx.shadowBlur = 6;
          ctx.fillText(s.text, r.x, r.y);
          ctx.restore();
        }
      } catch (_) {
        /* ข้ามเฟรมที่ยังไม่พร้อม */
      }
    }
  }

  /** ได้ MediaStream ที่พร้อมส่งไลฟ์ (วิดีโอ + เสียงมิกซ์) */
  getOutputStream() {
    const stream = this.canvas.captureStream(this.fps);
    if (this.audioDest) {
      for (const track of this.audioDest.stream.getAudioTracks()) {
        stream.addTrack(track);
      }
    }
    return stream;
  }

  dispose() {
    this.stop();
    for (const s of [...this.sources]) this.remove(s.id);
    if (this.audioCtx) this.audioCtx.close().catch(() => {});
  }
}

// ---------- helpers ----------
function fullLayout() {
  return { x: 0, y: 0, w: 1, h: 1 };
}
function centerLayout(scale = 0.5) {
  const w = scale;
  const h = scale;
  return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
}
function absLayout(l, W, H) {
  return { x: l.x * W, y: l.y * H, w: l.w * W, h: l.h * H };
}
// วาดแบบเต็มกรอบ (crop ส่วนเกิน) — เหมาะกับกล้อง/หน้าจอ
function drawCover(ctx, media, r) {
  const mw = media.videoWidth || media.width;
  const mh = media.videoHeight || media.height;
  if (!mw || !mh) return;
  const scale = Math.max(r.w / mw, r.h / mh);
  const sw = r.w / scale;
  const sh = r.h / scale;
  const sx = (mw - sw) / 2;
  const sy = (mh - sh) / 2;
  ctx.drawImage(media, sx, sy, sw, sh, r.x, r.y, r.w, r.h);
}
// วาดแบบพอดีกรอบ (ไม่ crop) — เหมาะกับรูปภาพ
function drawContain(ctx, media, r) {
  const mw = media.naturalWidth || media.width;
  const mh = media.naturalHeight || media.height;
  if (!mw || !mh) return;
  const scale = Math.min(r.w / mw, r.h / mh);
  const w = mw * scale;
  const h = mh * scale;
  ctx.drawImage(media, r.x + (r.w - w) / 2, r.y + (r.h - h) / 2, w, h);
}
