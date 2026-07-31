"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AdRow, TimeWindow } from "@/lib/types";
import {
  WINDOW_KEYS,
  WINDOW_LABELS,
  formatNumber,
} from "@/lib/labels";

export default function DashboardPage() {
  const [window, setWindow] = useState<TimeWindow>("today");
  const [ads, setAds] = useState<AdRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/ads?window=${window}`);
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Failed to load ads");
      setAds(json.ads);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setAds([]);
    } finally {
      setLoading(false);
    }
  }, [window]);

  useEffect(() => {
    load();
  }, [load]);

  const summary = useMemo(() => {
    const spend = ads.reduce((a, x) => a + x.metrics.spend, 0);
    const orders = ads.reduce((a, x) => a + x.metrics.complete_payment, 0);
    const gmv = ads.reduce((a, x) => a + x.metrics.gmv, 0);
    const roas = spend > 0 ? gmv / spend : 0;
    const running = ads.filter((a) => a.operation_status === "ENABLE").length;
    return { spend, orders, gmv, roas, running, total: ads.length };
  }, [ads]);

  const chartData = useMemo(
    () =>
      [...ads]
        .sort((a, b) => b.metrics.spend - a.metrics.spend)
        .slice(0, 10)
        .map((a) => ({
          name:
            a.ad_name.length > 14 ? a.ad_name.slice(0, 13) + "…" : a.ad_name,
          spend: Number(a.metrics.spend.toFixed(2)),
        })),
    [ads]
  );

  async function toggle(ad: AdRow) {
    const status = ad.operation_status === "ENABLE" ? "DISABLE" : "ENABLE";
    setBusy(ad.ad_id);
    try {
      const res = await fetch("/api/ads/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adIds: [ad.ad_id], status }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      setAds((prev) =>
        prev.map((a) =>
          a.ad_id === ad.ad_id ? { ...a, operation_status: status } : a
        )
      );
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function runNow() {
    setBusy("run");
    setRunResult(null);
    try {
      const res = await fetch("/api/rules/run", { method: "POST" });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      setRunResult(
        `รันแล้ว: ตรวจ ${json.evaluatedAds} โฆษณา / ${json.activeRules} rule · ดำเนินการ ${json.actionsTaken} รายการ`
      );
      await load();
    } catch (e) {
      setRunResult(`ผิดพลาด: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Dashboard</h1>
          <p className="text-sm text-neutral-400">
            ภาพรวมประสิทธิภาพโฆษณา และควบคุมเปิด/ปิดด้วยตนเอง
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
          <button
            className="btn-primary"
            onClick={runNow}
            disabled={busy === "run"}
          >
            {busy === "run" ? "กำลังรัน…" : "รัน rules เดี๋ยวนี้"}
          </button>
        </div>
      </div>

      {runResult && (
        <div className="card border-brand/40 text-sm text-neutral-200">
          {runResult}
        </div>
      )}

      {error && (
        <div className="card border-red-800 bg-red-950/40 text-sm text-red-200">
          <p className="font-medium">โหลดข้อมูลไม่สำเร็จ</p>
          <p className="mt-1 text-red-300">{error}</p>
          <p className="mt-2 text-xs text-red-400">
            ตรวจสอบ Access Token / Advertiser ID ที่หน้า Settings
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <Stat label="GMV (ยอดขายรวม)" value={formatNumber(summary.gmv)} highlight />
        <Stat label="ค่าโฆษณา (Spend)" value={formatNumber(summary.spend)} />
        <Stat label="ROAS เฉลี่ย" value={formatNumber(summary.roas)} />
        <Stat label="Orders (ออร์เดอร์)" value={formatNumber(summary.orders, 0)} />
        <Stat label="กำลังรัน / ทั้งหมด" value={`${summary.running} / ${summary.total}`} />
      </div>

      {chartData.length > 0 && (
        <div className="card">
          <h2 className="mb-4 text-sm font-medium text-neutral-300">
            Top 10 ค่าโฆษณาตามชิ้นงาน
          </h2>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                <XAxis
                  dataKey="name"
                  tick={{ fill: "#a3a3a3", fontSize: 11 }}
                  interval={0}
                  angle={-20}
                  textAnchor="end"
                  height={50}
                />
                <YAxis tick={{ fill: "#a3a3a3", fontSize: 11 }} />
                <Tooltip
                  contentStyle={{
                    background: "#171717",
                    border: "1px solid #404040",
                    borderRadius: 8,
                    color: "#fff",
                  }}
                />
                <Bar dataKey="spend" fill="#fe2c55" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-800 text-left text-xs uppercase tracking-wide text-neutral-500">
              <th className="p-3">โฆษณา</th>
              <th className="p-3 text-right">GMV</th>
              <th className="p-3 text-right">Spend</th>
              <th className="p-3 text-right">ROAS</th>
              <th className="p-3 text-right">Orders</th>
              <th className="p-3 text-right">CPA</th>
              <th className="p-3 text-right">CTR</th>
              <th className="p-3 text-center">สถานะ</th>
              <th className="p-3 text-right">จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {ads.map((ad) => {
              const running = ad.operation_status === "ENABLE";
              return (
                <tr
                  key={ad.ad_id}
                  className="border-b border-neutral-800/60 hover:bg-neutral-900"
                >
                  <td className="p-3">
                    <div className="font-medium">{ad.ad_name}</div>
                    <div className="text-xs text-neutral-500">
                      ID: {ad.ad_id}
                    </div>
                  </td>
                  <td className="p-3 text-right font-medium text-brand">
                    {formatNumber(ad.metrics.gmv)}
                  </td>
                  <td className="p-3 text-right">
                    {formatNumber(ad.metrics.spend)}
                  </td>
                  <td className="p-3 text-right">
                    {formatNumber(ad.metrics.roas)}
                  </td>
                  <td className="p-3 text-right">
                    {formatNumber(ad.metrics.complete_payment, 0)}
                  </td>
                  <td className="p-3 text-right">
                    {formatNumber(ad.metrics.cost_per_conversion)}
                  </td>
                  <td className="p-3 text-right">
                    {formatNumber(ad.metrics.ctr)}
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
                      onClick={() => toggle(ad)}
                      disabled={busy === ad.ad_id}
                    >
                      {busy === ad.ad_id
                        ? "…"
                        : running
                        ? "ปิด"
                        : "เปิด"}
                    </button>
                  </td>
                </tr>
              );
            })}
            {!loading && ads.length === 0 && !error && (
              <tr>
                <td colSpan={9} className="p-8 text-center text-neutral-500">
                  ไม่พบโฆษณา — ตรวจสอบการตั้งค่า API ที่หน้า Settings
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
        className={`mt-1 text-2xl font-semibold ${
          highlight ? "text-brand" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}
