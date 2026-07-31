"use client";

import { useEffect, useState } from "react";

interface SettingsView {
  appId: string;
  advertiserId: string;
  apiBase: string;
  redirectUri: string;
  schedulerEnabled: boolean;
  schedulerIntervalMinutes: number;
  appSecretMasked: string;
  accessTokenMasked: string;
  hasAppSecret: boolean;
  hasAccessToken: boolean;
}

interface Advertiser {
  advertiser_id: string;
  advertiser_name: string;
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

  // OAuth "Connect TikTok" flow.
  const [authCode, setAuthCode] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connectMsg, setConnectMsg] = useState<string | null>(null);
  const [advertisers, setAdvertisers] = useState<Advertiser[]>([]);
  // All advertiser accounts (sellers) the token can manage — for switching.
  const [allAdvertisers, setAllAdvertisers] = useState<Advertiser[]>([]);
  // Authorization link is prefetched so it can be a real <a> (no popup block).
  const [authUrl, setAuthUrl] = useState<string>("");

  async function load() {
    const res = await fetch("/api/settings");
    const s: SettingsView = await res.json();
    setView(s);
    setAppId(s.appId);
    setAdvertiserId(s.advertiserId);
    setApiBase(s.apiBase);
    setSchedulerEnabled(s.schedulerEnabled);
    setInterval(s.schedulerIntervalMinutes);

    // Prefetch the TikTok authorize URL (requires a saved App ID).
    if (s.appId) {
      try {
        const r = await fetch("/api/auth/url");
        const j = await r.json();
        setAuthUrl(j.ok ? j.url : "");
      } catch {
        setAuthUrl("");
      }
    } else {
      setAuthUrl("");
    }

    // Load the list of seller accounts the token can manage (for switching).
    if (s.hasAccessToken) {
      try {
        const r = await fetch("/api/advertisers");
        const j = await r.json();
        setAllAdvertisers(j.ok ? j.advertisers : []);
      } catch {
        setAllAdvertisers([]);
      }
    } else {
      setAllAdvertisers([]);
    }
  }

  async function connect() {
    setConnecting(true);
    setConnectMsg(null);
    try {
      const res = await fetch("/api/auth/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authCode }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      setAdvertisers(json.advertisers ?? []);
      setAuthCode("");
      setConnectMsg("เชื่อมต่อสำเร็จ ✓ ระบบบันทึก Access Token แล้ว");
      await load();
    } catch (e) {
      setConnectMsg(`เชื่อมต่อไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setConnecting(false);
    }
  }

  async function pickAdvertiser(id: string) {
    setAdvertiserId(id);
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ advertiserId: id }),
    });
    await load();
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

      {/* Connect TikTok (OAuth) */}
      <div className="card space-y-4">
        <div>
          <h2 className="text-sm font-medium text-neutral-300">
            เชื่อมต่อบัญชี TikTok (ดึงข้อมูลจริง)
          </h2>
          <p className="mt-1 text-xs text-neutral-500">
            บันทึก App ID และ App Secret ด้านบนก่อน แล้วทำ 2 ขั้นตอนนี้เพื่อรับ
            Access Token อัตโนมัติ (ไม่ต้องกรอกเอง)
          </p>
        </div>

        {view.hasAccessToken ? (
          <div className="rounded-lg border border-emerald-800 bg-emerald-950/40 p-3 text-sm text-emerald-300">
            ✓ เชื่อมต่อแล้ว · Advertiser ID:{" "}
            <span className="font-mono">{view.advertiserId || "-"}</span>
            <div className="mt-1 text-xs text-emerald-400/80">
              ข้อมูล GMV Max/LIVE ดูได้ที่หน้า “Campaigns” (หน้า Dashboard
              แสดงเฉพาะโฆษณาระดับ ad)
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-amber-800 bg-amber-950/30 p-3 text-sm text-amber-300">
            ยังไม่ได้เชื่อมต่อ — ทำตาม 2 ขั้นตอนด้านล่าง
          </div>
        )}

        {view.hasAccessToken && allAdvertisers.length > 0 && (
          <div>
            <label className="label">
              บัญชี seller ที่กำลังควบคุม ({allAdvertisers.length} บัญชี)
            </label>
            <select
              className="input"
              value={advertiserId}
              onChange={(e) => pickAdvertiser(e.target.value)}
            >
              {allAdvertisers.map((a) => (
                <option key={a.advertiser_id} value={a.advertiser_id}>
                  {a.advertiser_name} ({a.advertiser_id})
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-neutral-500">
              แต่ละบัญชีมีแคมเปญของตัวเอง — สลับบัญชีเพื่อดู/ควบคุมแคมเปญของ
              seller นั้น (เร็วๆ นี้จะรวมทุกบัญชีในหน้าเดียว)
            </p>
          </div>
        )}

        <div className="rounded-lg border border-neutral-800 p-4">
          <div className="mb-1 text-sm font-medium">
            ขั้นที่ 1 — อนุญาตแอปบนบัญชีโฆษณา
          </div>
          <p className="mb-3 text-xs text-neutral-500">
            กดลิงก์เพื่อเปิดหน้า TikTok → เลือกบัญชีโฆษณา → กด Authorize
            จากนั้นจะถูกพาไปหน้า{" "}
            <span className="text-neutral-300">{view?.redirectUri}</span>{" "}
            ที่แสดง <b>auth_code</b>
          </p>
          {authUrl ? (
            <a
              className="btn-secondary"
              href={authUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              เปิดหน้าอนุญาต TikTok ↗
            </a>
          ) : (
            <p className="text-xs text-amber-400">
              กรุณากรอกและบันทึก App ID ด้านบนก่อน แล้วรีเฟรชหน้านี้
            </p>
          )}
        </div>

        <div className="rounded-lg border border-neutral-800 p-4">
          <div className="mb-1 text-sm font-medium">
            ขั้นที่ 2 — วาง auth_code ที่ได้
          </div>
          <p className="mb-3 text-xs text-neutral-500">
            คัดลอก auth_code จากหน้าเว็บในขั้นที่ 1 มาวางที่นี่ แล้วกดเชื่อมต่อ
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              className="input flex-1"
              placeholder="วาง auth_code ที่นี่"
              value={authCode}
              onChange={(e) => setAuthCode(e.target.value)}
            />
            <button
              type="button"
              className="btn-primary"
              onClick={connect}
              disabled={connecting || !authCode.trim()}
            >
              {connecting ? "กำลังเชื่อมต่อ…" : "เชื่อมต่อ"}
            </button>
          </div>
        </div>

        {advertisers.length > 1 && (
          <div>
            <label className="label">เลือกบัญชีโฆษณาที่จะควบคุม</label>
            <select
              className="input"
              value={advertiserId}
              onChange={(e) => pickAdvertiser(e.target.value)}
            >
              {advertisers.map((a) => (
                <option key={a.advertiser_id} value={a.advertiser_id}>
                  {a.advertiser_name} ({a.advertiser_id})
                </option>
              ))}
            </select>
          </div>
        )}

        {connectMsg && (
          <p className="text-sm text-neutral-200">{connectMsg}</p>
        )}
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
