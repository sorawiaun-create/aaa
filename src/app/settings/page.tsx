"use client";

import { useEffect, useState } from "react";

interface SettingsView {
  appId: string;
  advertiserId: string;
  apiBase: string;
  schedulerEnabled: boolean;
  schedulerIntervalMinutes: number;
  appSecretMasked: string;
  accessTokenMasked: string;
  hasAppSecret: boolean;
  hasAccessToken: boolean;
}

export default function SettingsPage() {
  const [view, setView] = useState<SettingsView | null>(null);
  const [appId, setAppId] = useState("");
  const [advertiserId, setAdvertiserId] = useState("");
  const [apiBase, setApiBase] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [schedulerEnabled, setSchedulerEnabled] = useState(true);
  const [interval, setInterval] = useState(15);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [verify, setVerify] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/settings");
    const s: SettingsView = await res.json();
    setView(s);
    setAppId(s.appId);
    setAdvertiserId(s.advertiserId);
    setApiBase(s.apiBase);
    setSchedulerEnabled(s.schedulerEnabled);
    setInterval(s.schedulerIntervalMinutes);
  }

  useEffect(() => {
    load();
  }, []);

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appId,
          advertiserId,
          apiBase,
          appSecret, // blank = keep existing
          accessToken, // blank = keep existing
          schedulerEnabled,
          schedulerIntervalMinutes: interval,
        }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      setMsg("บันทึกเรียบร้อย");
      setAppSecret("");
      setAccessToken("");
      await load();
    } catch (e) {
      setMsg(`ผิดพลาด: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    setVerify("กำลังตรวจสอบ…");
    try {
      const res = await fetch("/api/settings", { method: "PUT" });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      setVerify(
        `เชื่อมต่อสำเร็จ ✓ — ${json.advertiser.name} (${json.advertiser.advertiser_id})`
      );
    } catch (e) {
      setVerify(`เชื่อมต่อไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (!view) return <p className="text-sm text-neutral-500">กำลังโหลด…</p>;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-neutral-400">
          ตั้งค่าการเชื่อมต่อ TikTok Marketing API และตัวจับเวลา
        </p>
      </div>

      <div className="card space-y-4">
        <h2 className="text-sm font-medium text-neutral-300">TikTok API</h2>

        <div>
          <label className="label">App ID</label>
          <input
            className="input"
            value={appId}
            onChange={(e) => setAppId(e.target.value)}
            placeholder="App ID"
          />
        </div>

        <div>
          <label className="label">
            App Secret {view.hasAppSecret && `(ตั้งไว้แล้ว: ${view.appSecretMasked})`}
          </label>
          <input
            className="input"
            type="password"
            value={appSecret}
            onChange={(e) => setAppSecret(e.target.value)}
            placeholder={
              view.hasAppSecret ? "เว้นว่างเพื่อคงค่าเดิม" : "App Secret"
            }
          />
        </div>

        <div>
          <label className="label">
            Access Token{" "}
            {view.hasAccessToken && `(ตั้งไว้แล้ว: ${view.accessTokenMasked})`}
          </label>
          <input
            className="input"
            type="password"
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
            placeholder={
              view.hasAccessToken ? "เว้นว่างเพื่อคงค่าเดิม" : "Access Token"
            }
          />
        </div>

        <div>
          <label className="label">Advertiser ID</label>
          <input
            className="input"
            value={advertiserId}
            onChange={(e) => setAdvertiserId(e.target.value)}
            placeholder="Advertiser ID"
          />
        </div>

        <div>
          <label className="label">API Base URL</label>
          <input
            className="input"
            value={apiBase}
            onChange={(e) => setApiBase(e.target.value)}
          />
        </div>
      </div>

      <div className="card space-y-4">
        <h2 className="text-sm font-medium text-neutral-300">Scheduler</h2>
        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 accent-brand"
            checked={schedulerEnabled}
            onChange={(e) => setSchedulerEnabled(e.target.checked)}
          />
          เปิดใช้ตัวจับเวลา (รันตรวจสอบ rules อัตโนมัติ)
        </label>
        <div>
          <label className="label">ความถี่ (นาที)</label>
          <input
            type="number"
            min={1}
            className="input w-40"
            value={interval}
            onChange={(e) => setInterval(Number(e.target.value))}
          />
          <p className="mt-1 text-xs text-neutral-500">
            ระบบจะประเมิน rules ทุก {interval} นาที
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary" onClick={save} disabled={saving}>
          {saving ? "กำลังบันทึก…" : "บันทึกการตั้งค่า"}
        </button>
        <button className="btn-secondary" onClick={testConnection}>
          ทดสอบการเชื่อมต่อ
        </button>
        {msg && <span className="text-sm text-neutral-300">{msg}</span>}
      </div>
      {verify && <p className="text-sm text-neutral-300">{verify}</p>}

      <div className="card text-xs leading-relaxed text-neutral-400">
        <p className="mb-1 font-medium text-neutral-300">วิธีขอ credentials</p>
        สมัคร Developer app ที่{" "}
        <span className="text-brand">ads.tiktok.com/marketing_api</span> →
        สร้าง app เพื่อรับ App ID / Secret → ทำ OAuth เพื่อรับ Access Token →
        คัดลอก Advertiser ID จาก TikTok Ads Manager
      </div>
    </div>
  );
}
