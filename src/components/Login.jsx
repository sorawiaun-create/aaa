import React, { useState } from 'react';
import { LogIn, Loader2 } from 'lucide-react';
import { Field, Input, Button } from './ui.jsx';

// Cloud-mode sign-in screen. Owner can also create staff accounts here
// (sign-up) unless disabled in the Supabase dashboard.
export default function Login({ store }) {
  const [mode, setMode] = useState('signin'); // 'signin' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setInfo(''); setBusy(true);
    try {
      const fn = mode === 'signin' ? store.signIn : store.signUp;
      const { data, error: err } = await fn(email.trim(), password);
      if (err) { setError(translate(err.message)); return; }
      if (mode === 'signup' && !data.session) {
        setInfo('สร้างบัญชีแล้ว — โปรดยืนยันอีเมล (ถ้าเปิดใช้) แล้วเข้าสู่ระบบ');
        setMode('signin');
      }
    } catch (err) {
      setError(err.message || 'เกิดข้อผิดพลาด');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 justify-center mb-6">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-500 opacity-60" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-rose-500" />
          </span>
          <span className="font-bold text-white text-lg">TikTok Live Aff</span>
        </div>

        <form onSubmit={submit} className="bg-white rounded-2xl shadow-xl p-6 space-y-4">
          <h1 className="text-lg font-bold text-slate-800">
            {mode === 'signin' ? 'เข้าสู่ระบบ' : 'สร้างบัญชีพนักงาน'}
          </h1>

          <Field label="อีเมล">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus placeholder="you@example.com" />
          </Field>
          <Field label="รหัสผ่าน">
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} placeholder="อย่างน้อย 6 ตัวอักษร" />
          </Field>

          {error && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>}
          {info && <div className="text-sm text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2">{info}</div>}

          <Button type="submit" disabled={busy} icon={busy ? undefined : LogIn} className="w-full bg-pink-600 hover:bg-pink-700">
            {busy ? <Loader2 size={16} className="animate-spin" /> : null}
            {mode === 'signin' ? 'เข้าสู่ระบบ' : 'สร้างบัญชี'}
          </Button>

          <div className="text-center text-sm text-slate-500">
            {mode === 'signin' ? (
              <button type="button" className="text-pink-600 hover:underline" onClick={() => { setMode('signup'); setError(''); }}>
                สร้างบัญชีพนักงานใหม่
              </button>
            ) : (
              <button type="button" className="text-pink-600 hover:underline" onClick={() => { setMode('signin'); setError(''); }}>
                มีบัญชีอยู่แล้ว — เข้าสู่ระบบ
              </button>
            )}
          </div>
        </form>

        <p className="text-center text-[11px] text-slate-500 mt-4">
          ข้อมูลทั้งหมดเก็บบนฐานข้อมูลกลาง — ทุกเครื่องที่เข้าสู่ระบบเห็นข้อมูลชุดเดียวกัน
        </p>
      </div>
    </div>
  );
}

const translate = (msg) => {
  const m = (msg || '').toLowerCase();
  if (m.includes('invalid login')) return 'อีเมลหรือรหัสผ่านไม่ถูกต้อง';
  if (m.includes('already registered')) return 'อีเมลนี้ถูกใช้แล้ว';
  if (m.includes('password')) return 'รหัสผ่านไม่ผ่านเงื่อนไข (อย่างน้อย 6 ตัวอักษร)';
  if (m.includes('email')) return 'อีเมลไม่ถูกต้อง';
  return msg;
};
