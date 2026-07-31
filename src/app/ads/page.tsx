"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AdRow, TimeWindow } from "@/lib/types";
import { WINDOW_KEYS, WINDOW_LABELS, formatNumber } from "@/lib/labels";

export default function AdsPage() {
  const [window, setWindow] = useState<TimeWindow>("today");
  const [ads, setAds] = useState<AdRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/ads?window=${window}`);
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "โหลดไม่สำเร็จ");
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? ads.filter((a) => a.ad_name.toLowerCase().includes(q)) : ads;
  }, [ads, query]);

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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Ads</h1>
          <p className="text-sm text-neutral-400">
            โฆษณารายชิ้น — ผลลัพธ์ + เปิด-ปิดรายตัว
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
          {error}
        </div>
      )}

      <input
        className="input"
        placeholder="ค้นหาชื่อโฆษณา…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-800 text-left text-xs uppercase tracking-wide text-neutral-500">
              <th className="p-3">โฆษณา</th>
              <th className="p-3 text-right">GMV</th>
              <th className="p-3 text-right">Spend</th>
              <th className="p-3 text-right">ROAS</th>
              <th className="p-3 text-right">CTR</th>
              <th className="p-3 text-center">สถานะ</th>
              <th className="p-3 text-right">จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((ad) => {
              const running = ad.operation_status === "ENABLE";
              return (
                <tr
                  key={ad.ad_id}
                  className="border-b border-neutral-800/60 hover:bg-neutral-900"
                >
                  <td className="p-3">
                    <div className="font-medium">{ad.ad_name}</div>
                    <div className="text-xs text-neutral-500">ID: {ad.ad_id}</div>
                  </td>
                  <td className="p-3 text-right text-brand">
                    {formatNumber(ad.metrics.gmv)}
                  </td>
                  <td className="p-3 text-right">
                    {formatNumber(ad.metrics.spend)}
                  </td>
                  <td className="p-3 text-right">
                    {formatNumber(ad.metrics.roas)}
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
                      {busy === ad.ad_id ? "…" : running ? "ปิด" : "เปิด"}
                    </button>
                  </td>
                </tr>
              );
            })}
            {!loading && filtered.length === 0 && !error && (
              <tr>
                <td colSpan={7} className="p-8 text-center text-neutral-500">
                  ไม่พบโฆษณา (ระดับ ad) — GMV Max ดูที่หน้า GMV Max+
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
