import React, { useState } from 'react';
import { Cloud, HardDrive, Loader2 } from 'lucide-react';
import { Field, Input, Button } from './ui.jsx';
import { saveCloudConfig, chooseLocalMode } from '../lib/supabase.js';

// Shown when the app has no cloud config (e.g. opened from a plain HTML file).
// Lets the owner connect to their Supabase, or use the device-only mode.
export default function CloudSetup() {
  const [url, setUrl] = useState('https://fhqlfkbqpagphkaycszw.supabase.co');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const connect = (e) => {
    e.preventDefault();
    setError('');
    const u = url.trim();
    const k = key.trim();
    if (!/^https:\/\/.+\.supabase\.co\/?$/.test(u)) return setError('Supabase URL ไม่ถูกต้อง (ต้องเป็น https://xxxx.supabase.co)');
    if (!/^ey[A-Za-z0-9_-]/.test(k)) return setError('anon key ไม่ถูกต้อง (ต้องขึ้นต้นด้วย eyJ)');
    setBusy(true);
    saveCloudConfig(u, k);
    location.reload();
  };

  const local = () => { chooseLocalMode(); location.reload(); };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-2 justify-center mb-6">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-500 opacity-60" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-rose-500" />
          </span>
          <span className="font-bold text-white text-lg">TikTok Live Aff</span>
        </div>

        <form onSubmit={connect} className="bg-white rounded-2xl shadow-xl p-6 space-y-4">
          <div className="flex items-center gap-2 text-slate-800 font-bold">
            <Cloud size={18} className="text-pink-500" /> เชื่อมต่อฐานข้อมูลกลาง
          </div>
          <p className="text-xs text-slate-500 leading-relaxed">
            ใส่ค่าจาก Supabase → <b>Project Settings → API Keys</b> เพื่อให้ทุกเครื่องเห็นข้อมูลชุดเดียวกัน
            (ค่าเหล่านี้เก็บไว้ในเบราว์เซอร์เครื่องนี้เท่านั้น)
          </p>

          <Field label="Supabase URL">
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://xxxx.supabase.co" />
          </Field>
          <Field label="anon public key" hint="ข้อความยาว ๆ ขึ้นต้นด้วย eyJ…">
            <Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="eyJhbGciOi…" />
          </Field>

          {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}

          <Button type="submit" disabled={busy} icon={busy ? undefined : Cloud} className="w-full bg-pink-600 hover:bg-pink-700">
            {busy ? <Loader2 size={16} className="animate-spin" /> : null} เชื่อมต่อคลาวด์
          </Button>
        </form>

        <button onClick={local} className="mt-3 w-full flex items-center justify-center gap-2 text-sm text-slate-400 hover:text-slate-200">
          <HardDrive size={15} /> ใช้แบบเก็บในเครื่องนี้ (ไม่ต่อคลาวด์)
        </button>
      </div>
    </div>
  );
}
