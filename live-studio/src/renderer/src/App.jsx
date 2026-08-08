import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Camera, Monitor, Image as ImageIcon, Type, Mic, Trash2, Eye, EyeOff,
  Volume2, VolumeX, ChevronUp, ChevronDown, Radio, Square, Plus,
  Settings, ExternalLink, CircleDot,
} from 'lucide-react';
import { Compositor } from './lib/capture.js';
import { StreamPump } from './lib/recorder.js';
import { loadChannels, saveChannels, defaultChannel } from './lib/store.js';
import Preview from './components/Preview.jsx';
import SourceRow from './components/SourceRow.jsx';
import ChannelSettings from './components/ChannelSettings.jsx';

let uid = 0;
const nextId = (p) => `${p}_${Date.now()}_${uid++}`;

export default function App() {
  const [channels, setChannels] = useState(loadChannels);
  const [activeId, setActiveId] = useState(channels[0]?.id);
  const [sources, setSources] = useState([]);
  const [live, setLive] = useState(false);
  const [uptime, setUptime] = useState(0);
  const [status, setStatus] = useState('พร้อม');
  const [showSettings, setShowSettings] = useState(false);
  const [logs, setLogs] = useState([]);

  const compRef = useRef(null);
  const pumpRef = useRef(null);
  const timerRef = useRef(null);

  const active = channels.find((c) => c.id === activeId) || channels[0];

  // สร้าง compositor เมื่อเปิดแอป
  useEffect(() => {
    const [w, h] = (active?.resolution || '1280x720').split('x').map(Number);
    const comp = new Compositor(w, h, active?.fps || 30);
    comp.start();
    compRef.current = comp;
    return () => {
      comp.dispose();
      compRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // รับ event จาก ffmpeg
  useEffect(() => {
    const off = window.studio.onStreamEvent(({ channelId, event, payload }) => {
      if (channelId !== activeId) return;
      if (event === 'started') setStatus('กำลังไลฟ์');
      if (event === 'stopped') {
        setStatus('หยุดแล้ว');
        setLive(false);
      }
      if (event === 'error') {
        pushLog(`❌ ${payload}`);
        setStatus('ผิดพลาด');
      }
      if (event === 'log') pushLog(payload.trim());
    });
    return off;
  }, [activeId]);

  const pushLog = useCallback((line) => {
    if (!line) return;
    setLogs((prev) => [...prev.slice(-80), line]);
  }, []);

  const syncSources = () => {
    setSources(compRef.current ? [...compRef.current.sources] : []);
  };

  // ---------- เพิ่ม sources ----------
  const addCamera = async () => {
    try {
      await compRef.current.addCamera(nextId('cam'));
      syncSources();
    } catch (e) {
      pushLog('❌ เปิดกล้องไม่ได้: ' + e.message);
    }
  };
  const addScreen = async () => {
    try {
      await compRef.current.addScreen(nextId('scr'));
      syncSources();
    } catch (e) {
      pushLog('❌ จับหน้าจอไม่ได้: ' + e.message);
    }
  };
  const addMic = async () => {
    try {
      await compRef.current.addMic(nextId('mic'));
      syncSources();
    } catch (e) {
      pushLog('❌ เปิดไมค์ไม่ได้: ' + e.message);
    }
  };
  const addImage = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        await compRef.current.addImage(nextId('img'), reader.result);
        syncSources();
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };
  const addText = () => {
    const text = prompt('ข้อความที่จะแสดง', 'สวัสดีครับ ยินดีต้อนรับ!');
    if (text == null) return;
    compRef.current.addText(nextId('txt'), text);
    syncSources();
  };

  // ---------- จัดการ source ----------
  const removeSource = (id) => { compRef.current.remove(id); syncSources(); };
  const toggleHidden = (id) => {
    const s = compRef.current.get(id);
    compRef.current.setHidden(id, !s.hidden); syncSources();
  };
  const toggleMuted = (id) => {
    const s = compRef.current.get(id);
    compRef.current.setMuted(id, !s.muted); syncSources();
  };
  const setVolume = (id, v) => { compRef.current.setVolume(id, v); syncSources(); };
  const moveUp = (id) => { compRef.current.moveUp(id); syncSources(); };
  const moveDown = (id) => { compRef.current.moveDown(id); syncSources(); };

  // ---------- Go Live ----------
  const goLive = async () => {
    if (!active.streamKey) {
      setShowSettings(true);
      pushLog('⚠️ กรุณาใส่ Stream Key ก่อนเริ่มไลฟ์');
      return;
    }
    setStatus('กำลังเชื่อมต่อ...');
    const stream = compRef.current.getOutputStream();
    const [vb] = [parseBitrate(active.videoBitrate)];
    const res = await window.studio.startStream(active.id, {
      rtmpUrl: active.rtmpUrl,
      streamKey: active.streamKey,
      videoBitrate: active.videoBitrate,
      audioBitrate: active.audioBitrate,
      fps: active.fps,
      preset: 'veryfast',
    });
    if (!res.ok) {
      pushLog('❌ ' + res.error);
      setStatus('ผิดพลาด');
      return;
    }
    const pump = new StreamPump(active.id, stream, {
      fps: active.fps,
      videoBitsPerSecond: vb,
    });
    try {
      pump.start();
    } catch (e) {
      pushLog('❌ ' + e.message);
      await window.studio.stopStream(active.id);
      return;
    }
    pumpRef.current = pump;
    setLive(true);
    startTimer();
  };

  const stopLive = async () => {
    setStatus('กำลังหยุด...');
    if (pumpRef.current) { pumpRef.current.stop(); pumpRef.current = null; }
    await window.studio.stopStream(active.id);
    stopTimer();
    setLive(false);
    setStatus('หยุดแล้ว');
  };

  const startTimer = () => {
    const t0 = Date.now();
    timerRef.current = setInterval(() => setUptime(Math.floor((Date.now() - t0) / 1000)), 1000);
  };
  const stopTimer = () => { clearInterval(timerRef.current); setUptime(0); };

  // ---------- ช่อง ----------
  const updateChannel = (patch) => {
    const next = channels.map((c) => (c.id === active.id ? { ...c, ...patch } : c));
    setChannels(next);
    saveChannels(next);
  };
  const addChannel = () => {
    const next = [...channels, defaultChannel(`ช่อง ${channels.length + 1}`)];
    setChannels(next); saveChannels(next); setActiveId(next[next.length - 1].id);
  };
  const openNewWindow = () => window.studio.newWindow();

  const audioSources = sources.filter((s) => s.type === 'mic' || s.type === 'screen' || s.audioNode);

  return (
    <div className="app">
      {/* Header */}
      <header className="topbar">
        <div className="brand"><CircleDot size={18} className="brand-dot" /> Live Studio</div>
        <div className="channel-tabs">
          {channels.map((c) => (
            <button
              key={c.id}
              className={'chtab' + (c.id === activeId ? ' active' : '')}
              onClick={() => setActiveId(c.id)}
            >
              {live && c.id === activeId && <span className="live-dot" />} {c.name}
            </button>
          ))}
          <button className="chtab add" onClick={addChannel} title="เพิ่มช่อง"><Plus size={14} /></button>
        </div>
        <div className="spacer" />
        <button className="ghost" onClick={openNewWindow} title="เปิดอีกหน้าต่าง = อีกช่องพร้อมกัน">
          <ExternalLink size={15} /> หน้าต่างใหม่
        </button>
        <button className="ghost" onClick={() => setShowSettings(true)}><Settings size={15} /> ตั้งค่า</button>
      </header>

      <div className="body">
        {/* ซ้าย: Sources */}
        <aside className="left">
          <div className="panel-title">แหล่งภาพ/เสียง (Sources)</div>
          <div className="add-grid">
            <button onClick={addCamera}><Camera size={16} /> กล้อง</button>
            <button onClick={addScreen}><Monitor size={16} /> จับหน้าจอ</button>
            <button onClick={addMic}><Mic size={16} /> ไมค์</button>
            <button onClick={addImage}><ImageIcon size={16} /> รูปภาพ</button>
            <button onClick={addText}><Type size={16} /> ข้อความ</button>
          </div>
          <div className="source-list">
            {sources.length === 0 && <div className="empty">ยังไม่มีแหล่ง — กดปุ่มด้านบนเพื่อเพิ่ม</div>}
            {sources.map((s) => (
              <SourceRow
                key={s.id}
                source={s}
                onToggleHidden={() => toggleHidden(s.id)}
                onToggleMuted={() => toggleMuted(s.id)}
                onRemove={() => removeSource(s.id)}
                onUp={() => moveUp(s.id)}
                onDown={() => moveDown(s.id)}
              />
            ))}
          </div>
        </aside>

        {/* กลาง: Preview */}
        <main className="center">
          <div className="preview-wrap">
            <Preview compositor={compRef.current} />
            {live && <div className="live-badge"><Radio size={13} /> LIVE {fmt(uptime)}</div>}
          </div>

          <div className="controls">
            <div className={'status ' + (live ? 'on' : '')}>
              <span className="dot" /> {status}
            </div>
            <div className="spacer" />
            {!live ? (
              <button className="golive" onClick={goLive}><Radio size={18} /> เริ่มไลฟ์</button>
            ) : (
              <button className="stop" onClick={stopLive}><Square size={16} /> หยุดไลฟ์</button>
            )}
          </div>

          {/* มิกเซอร์เสียง */}
          <div className="mixer">
            <div className="panel-title">มิกเซอร์เสียง</div>
            {audioSources.length === 0 && <div className="empty small">ยังไม่มีแหล่งเสียง</div>}
            {audioSources.map((s) => (
              <div className="mix-row" key={s.id}>
                <button className="iconbtn" onClick={() => toggleMuted(s.id)}>
                  {s.muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                </button>
                <span className="mix-name">{labelOf(s)}</span>
                <input
                  type="range" min="0" max="1.5" step="0.05"
                  defaultValue="1"
                  onChange={(e) => setVolume(s.id, parseFloat(e.target.value))}
                />
              </div>
            ))}
          </div>
        </main>

        {/* ขวา: สถานะ/ล็อก */}
        <aside className="right">
          <div className="panel-title">สถานะช่อง</div>
          <div className="info-card">
            <div className="row"><span>ช่อง</span><b>{active?.name}</b></div>
            <div className="row"><span>ความละเอียด</span><b>{active?.resolution} @ {active?.fps}fps</b></div>
            <div className="row"><span>บิตเรต</span><b>{active?.videoBitrate}</b></div>
            <div className="row"><span>ปลายทาง</span><b className="truncate">{active?.rtmpUrl}</b></div>
            <div className="row"><span>Stream Key</span><b>{active?.streamKey ? '••••••' + active.streamKey.slice(-4) : '— ยังไม่ตั้ง —'}</b></div>
          </div>
          <div className="panel-title">บันทึกระบบ (Log)</div>
          <div className="logbox">
            {logs.length === 0 && <div className="empty small">—</div>}
            {logs.map((l, i) => <div key={i} className="logline">{l}</div>)}
          </div>
        </aside>
      </div>

      {showSettings && (
        <ChannelSettings
          channel={active}
          onChange={updateChannel}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}

function fmt(s) {
  const m = Math.floor(s / 60).toString().padStart(2, '0');
  const ss = (s % 60).toString().padStart(2, '0');
  return `${m}:${ss}`;
}
function labelOf(s) {
  return { mic: '🎤 ไมโครโฟน', screen: '🖥️ เสียงระบบ', camera: '📷 กล้อง' }[s.type] || s.type;
}
function parseBitrate(b) {
  const m = String(b).match(/^(\d+)(k|M)?$/i);
  if (!m) return 4_500_000;
  let n = parseInt(m[1], 10);
  if (/k/i.test(m[2])) n *= 1000;
  if (/M/i.test(m[2])) n *= 1_000_000;
  return n;
}
