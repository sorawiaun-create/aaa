"use client";

import { useEffect, useState } from "react";
import { AlertRule, ComparisonOperator, MetricKey, TimeWindow } from "@/lib/types";
import {
  METRIC_KEYS,
  METRIC_LABELS,
  OPERATOR_KEYS,
  OPERATOR_LABELS,
  WINDOW_KEYS,
  WINDOW_LABELS,
} from "@/lib/labels";

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<AlertRule[]>([]);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [savedWebhook, setSavedWebhook] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [source, setSource] = useState<"campaign" | "gmvmax">("gmvmax");
  const [metric, setMetric] = useState<MetricKey>("roas");
  const [operator, setOperator] = useState<ComparisonOperator>("<");
  const [value, setValue] = useState(1);
  const [timeWindow, setTimeWindow] = useState<TimeWindow>("last_3d");

  async function load() {
    const [aRes, sRes] = await Promise.all([
      fetch("/api/alerts"),
      fetch("/api/settings"),
    ]);
    const aJson = await aRes.json();
    const sJson = await sRes.json();
    setAlerts(aJson.alerts ?? []);
    setWebhookUrl(sJson.webhookUrl ?? "");
    setSavedWebhook(sJson.webhookUrl ?? "");
  }

  useEffect(() => {
    load();
  }, []);

  async function saveWebhook() {
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ webhookUrl }),
    });
    setSavedWebhook(webhookUrl);
    setMsg("บันทึก Webhook แล้ว");
  }

  async function testWebhook() {
    setMsg("กำลังส่งข้อความทดสอบ…");
    const res = await fetch("/api/alerts/test", { method: "POST" });
    const json = await res.json();
    setMsg(json.ok ? "ส่งทดสอบแล้ว เช็คปลายทางได้เลย ✓" : `ผิดพลาด: ${json.error}`);
  }

  async function createAlert() {
    if (!name.trim()) {
      setMsg("กรุณาตั้งชื่อการแจ้งเตือน");
      return;
    }
    const res = await fetch("/api/alerts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, source, metric, operator, value, timeWindow }),
    });
    const json = await res.json();
    if (!json.ok) {
      setMsg(`ผิดพลาด: ${json.error}`);
      return;
    }
    setName("");
    setMsg(null);
    load();
  }

  async function toggle(a: AlertRule) {
    await fetch(`/api/alerts/${a.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !a.enabled }),
    });
    load();
  }

  async function remove(a: AlertRule) {
    if (!confirm(`ลบการแจ้งเตือน "${a.name}"?`)) return;
    await fetch(`/api/alerts/${a.id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Alerts</h1>
        <p className="text-sm text-neutral-400">
          แจ้งเตือนเมื่อผลถึงเงื่อนไข — เหมาะกับ LIVE GMV Max ที่ปิดผ่าน API
          ไม่ได้ (เตือนให้ไปปิดเองใน Seller Center)
        </p>
      </div>

      {/* Webhook config */}
      <div className="card space-y-3">
        <h2 className="text-sm font-medium text-neutral-300">
          ช่องทางแจ้งเตือน (Webhook)
        </h2>
        <p className="text-xs text-neutral-500">
          วางลิงก์ Webhook ของ Discord / Telegram (ผ่านบอท) / Make / Zapier —
          ระบบจะส่งข้อความไปที่นั่นเมื่อเข้าเงื่อนไข
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            className="input flex-1"
            placeholder="https://discord.com/api/webhooks/…"
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
          />
          <button className="btn-primary" onClick={saveWebhook}>
            บันทึก
          </button>
          <button
            className="btn-secondary"
            onClick={testWebhook}
            disabled={!savedWebhook}
          >
            ทดสอบส่ง
          </button>
        </div>
        {msg && <p className="text-sm text-neutral-300">{msg}</p>}
      </div>

      {/* Create alert */}
      <div className="card space-y-4">
        <h2 className="text-sm font-medium text-neutral-300">
          สร้างการแจ้งเตือนใหม่
        </h2>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="label">ชื่อ</label>
            <input
              className="input"
              placeholder="เช่น เตือน GMV Max ROAS ตก"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label className="label">ดูจาก</label>
            <select
              className="input"
              value={source}
              onChange={(e) =>
                setSource(e.target.value as "campaign" | "gmvmax")
              }
            >
              <option value="gmvmax">GMV Max</option>
              <option value="campaign">แคมเปญปกติ</option>
            </select>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1">
            <label className="label">ตัวชี้วัด</label>
            <select
              className="input"
              value={metric}
              onChange={(e) => setMetric(e.target.value as MetricKey)}
            >
              {METRIC_KEYS.map((m) => (
                <option key={m} value={m}>
                  {METRIC_LABELS[m]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">เงื่อนไข</label>
            <select
              className="input w-auto"
              value={operator}
              onChange={(e) =>
                setOperator(e.target.value as ComparisonOperator)
              }
            >
              {OPERATOR_KEYS.map((o) => (
                <option key={o} value={o}>
                  {OPERATOR_LABELS[o]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">ค่า</label>
            <input
              type="number"
              step="any"
              className="input w-28"
              value={value}
              onChange={(e) => setValue(Number(e.target.value))}
            />
          </div>
          <div>
            <label className="label">ช่วงเวลา</label>
            <select
              className="input w-auto"
              value={timeWindow}
              onChange={(e) => setTimeWindow(e.target.value as TimeWindow)}
            >
              {WINDOW_KEYS.map((w) => (
                <option key={w} value={w}>
                  {WINDOW_LABELS[w]}
                </option>
              ))}
            </select>
          </div>
          <button className="btn-primary" onClick={createAlert}>
            เพิ่ม
          </button>
        </div>
      </div>

      {/* Alert list */}
      <div className="space-y-3">
        {alerts.length === 0 && (
          <div className="card text-center text-sm text-neutral-500">
            ยังไม่มีการแจ้งเตือน
          </div>
        )}
        {alerts.map((a) => (
          <div
            key={a.id}
            className="card flex flex-wrap items-center justify-between gap-3"
          >
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium">{a.name}</span>
                <span
                  className={`badge ${
                    a.enabled
                      ? "bg-emerald-500/15 text-emerald-400"
                      : "bg-neutral-700/50 text-neutral-400"
                  }`}
                >
                  {a.enabled ? "เปิด" : "ปิด"}
                </span>
              </div>
              <p className="mt-1 text-xs text-neutral-400">
                {a.source === "gmvmax" ? "GMV Max" : "แคมเปญปกติ"} ·{" "}
                {METRIC_LABELS[a.metric].split(" ")[0]} {a.operator} {a.value} ·{" "}
                {WINDOW_LABELS[a.timeWindow]}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button className="btn-ghost" onClick={() => toggle(a)}>
                {a.enabled ? "ปิดใช้งาน" : "เปิดใช้งาน"}
              </button>
              <button
                className="btn-ghost text-red-400"
                onClick={() => remove(a)}
              >
                ลบ
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
