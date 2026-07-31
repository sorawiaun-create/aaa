"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CampaignRow, TimeWindow } from "@/lib/types";
import { WINDOW_KEYS, WINDOW_LABELS, formatNumber } from "@/lib/labels";

export default function CampaignsPage() {
  const [window, setWindow] = useState<TimeWindow>("today");
  const [rows, setRows] = useState<CampaignRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/campaigns?window=${window}`);
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Failed to load campaigns");
      setRows(json.campaigns);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [window]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.campaign_name.toLowerCase().includes(q));
  }, [rows, query]);

  const summary = useMemo(() => {
    const spend = filtered.reduce((a, x) => a + x.metrics.spend, 0);
    const gmv = filtered.reduce((a, x) => a + x.metrics.gmv, 0);
    const orders = filtered.reduce((a, x) => a + x.metrics.complete_payment, 0);
    const roas = spend > 0 ? gmv / spend : 0;
    const running = filtered.filter(
      (r) => r.operation_status === "ENABLE"
    ).length;
    return { spend, gmv, orders, roas, running, total: filtered.length };
  }, [filtered]);

  async function toggle(row: CampaignRow) {
    const status = row.operation_status === "ENABLE" ? "DISABLE" : "ENABLE";
    setBusy(row.campaign_id);
    try {
      const res = await fetch("/api/campaigns/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignIds: [row.campaign_id], status }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      setRows((prev) =>
        prev.map((r) =>
          r.campaign_id === row.campaign_id
            ? { ...r, operation_status: status }
            : r
        )
      );
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">แคมเปญ (GMV Max / LIVE)</h1>
          <p className="text-sm text-neutral-400">
            ควบคุมแคมเปญระดับบนสุด เปิด-ปิดเอง หรือให้ rule ทำอัตโนมัติ
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="input w-auto"
            value={window}
            onChange={(e) => setWindow(e.target.value as TimeWindow)}
          >
            {WINDOW_KEYS.map((w) => (
              <option key={w} value={w}>
                {WINDOW_LABELS[w]}
              </option>
            ))}
          </select>
          <button className="btn-secondary" onClick={load} disabled={loading}>
            {loading ? "กำลังโหลด…" : "รีเฟรช"}
          </button>
        </div>
      </div>

      {error && (
        <div className="card border-red-800 bg-red-950/40 text-sm text-red-200">
          <p className="font-medium">โหลดแคมเปญไม่สำเร็จ</p>
          <p className="mt-1 text-red-300">{error}</p>
          <p className="mt-2 text-xs text-red-400">
            ถ้าขึ้นเรื่องสิทธิ์/permission แปลว่า scope ยังไม่ครอบคลุม
            campaign — ตรวจ scope ของแอปที่ TikTok
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <Stat label="GMV (ยอดขายรวม)" value={formatNumber(summary.gmv)} highlight />
        <Stat label="ค่าโฆษณา (Spend)" value={formatNumber(summary.spend)} />
        <Stat label="ROAS เฉลี่ย" value={formatNumber(summary.roas)} />
        <Stat label="Orders" value={formatNumber(summary.orders, 0)} />
        <Stat
          label="กำลังรัน / ทั้งหมด"
          value={`${summary.running} / ${summary.total}`}
        />
      </div>

      <input
        className="input"
        placeholder="ค้นหาชื่อแคมเปญ เช่น LIVE GMV Max…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-800 text-left text-xs uppercase tracking-wide text-neutral-500">
              <th className="p-3">แคมเปญ</th>
              <th className="p-3 text-right">GMV</th>
              <th className="p-3 text-right">Spend</th>
              <th className="p-3 text-right">ROAS</th>
              <th className="p-3 text-right">Orders</th>
              <th className="p-3 text-center">สถานะ</th>
              <th className="p-3 text-right">จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => {
              const running = row.operation_status === "ENABLE";
              return (
                <tr
                  key={row.campaign_id}
                  className="border-b border-neutral-800/60 hover:bg-neutral-900"
                >
                  <td className="p-3">
                    <div className="font-medium">{row.campaign_name}</div>
                    <div className="text-xs text-neutral-500">
                      ID: {row.campaign_id}
                      {row.objective_type ? ` · ${row.objective_type}` : ""}
                    </div>
                  </td>
                  <td className="p-3 text-right font-medium text-brand">
                    {formatNumber(row.metrics.gmv)}
                  </td>
                  <td className="p-3 text-right">
                    {formatNumber(row.metrics.spend)}
                  </td>
                  <td className="p-3 text-right">
                    {formatNumber(row.metrics.roas)}
                  </td>
                  <td className="p-3 text-right">
                    {formatNumber(row.metrics.complete_payment, 0)}
                  </td>
                  <td className="p-3 text-center">
                    <span
                      className={`badge ${
                        running
                          ? "bg-emerald-500/15 text-emerald-400"
                          : "bg-neutral-700/50 text-neutral-400"
                      }`}
                    >
                      {running ? "กำลังรัน" : "ปิดอยู่"}
                    </span>
                  </td>
                  <td className="p-3 text-right">
                    <button
                      className={running ? "btn-secondary" : "btn-primary"}
                      onClick={() => toggle(row)}
                      disabled={busy === row.campaign_id}
                    >
                      {busy === row.campaign_id ? "…" : running ? "ปิด" : "เปิด"}
                    </button>
                  </td>
                </tr>
              );
            })}
            {!loading && filtered.length === 0 && !error && (
              <tr>
                <td colSpan={7} className="p-8 text-center text-neutral-500">
                  ไม่พบแคมเปญ — ตรวจสอบการเชื่อมต่อที่หน้า Settings
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className={`card ${highlight ? "border-brand/50 bg-brand/5" : ""}`}>
      <div className="text-xs text-neutral-400">{label}</div>
      <div
        className={`mt-1 text-2xl font-semibold ${highlight ? "text-brand" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}
