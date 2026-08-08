import React, { useState } from 'react';
import { X } from 'lucide-react';

const RESOLUTIONS = ['1920x1080', '1280x720', '854x480', '720x1280', '1080x1920'];
const FPS = [24, 30, 60];
const BITRATES = ['2500k', '3500k', '4500k', '6000k', '8000k'];

export default function ChannelSettings({ channel, onChange, onClose }) {
  const [showKey, setShowKey] = useState(false);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>ตั้งค่าช่อง</h3>
          <button className="iconbtn" onClick={onClose}><X size={18} /></button>
        </div>

        <label className="field">
          <span>ชื่อช่อง</span>
          <input value={channel.name} onChange={(e) => onChange({ name: e.target.value })} />
        </label>

        <label className="field">
          <span>RTMP Server URL</span>
          <input
            value={channel.rtmpUrl}
            placeholder="rtmp://live.tiktok.com/live"
            onChange={(e) => onChange({ rtmpUrl: e.target.value })}
          />
        </label>

        <label className="field">
          <span>Stream Key</span>
          <div className="key-row">
            <input
              type={showKey ? 'text' : 'password'}
              value={channel.streamKey}
              placeholder="วางคีย์ที่ได้จาก TikTok LIVE ที่นี่"
              onChange={(e) => onChange({ streamKey: e.target.value })}
            />
            <button className="ghost sm" onClick={() => setShowKey((v) => !v)}>
              {showKey ? 'ซ่อน' : 'แสดง'}
            </button>
          </div>
        </label>

        <div className="field-row">
          <label className="field">
            <span>ความละเอียด</span>
            <select value={channel.resolution} onChange={(e) => onChange({ resolution: e.target.value })}>
              {RESOLUTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <label className="field">
            <span>FPS</span>
            <select value={channel.fps} onChange={(e) => onChange({ fps: Number(e.target.value) })}>
              {FPS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </label>
          <label className="field">
            <span>บิตเรตวิดีโอ</span>
            <select value={channel.videoBitrate} onChange={(e) => onChange({ videoBitrate: e.target.value })}>
              {BITRATES.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </label>
        </div>

        <div className="hint">
          <b>วิธีเอา Stream Key จาก TikTok:</b> เปิด TikTok LIVE บนมือถือ/เว็บ → เลือกไลฟ์ผ่าน
          "สตรีมมิ่ง / OBS" จะได้ <b>Server URL</b> และ <b>Stream Key</b> มาวางที่นี่.
          เปิดหลายหน้าต่างเพื่อไลฟ์หลายช่องพร้อมกันบนเครื่องเดียว.
        </div>

        <div className="modal-foot">
          <button className="golive sm" onClick={onClose}>เสร็จสิ้น</button>
        </div>
      </div>
    </div>
  );
}
