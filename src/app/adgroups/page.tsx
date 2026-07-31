"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AdGroupRow, TimeWindow } from "@/lib/types";
import { WINDOW_KEYS, WINDOW_LABELS, formatNumber } from "@/lib/labels";

export default function AdGroupsPage() {
  const [window, setWindow] = useState<TimeWindow>("today");
  const [rows, setRows] = useState<AdGroupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/adgroups?window=${window}`);
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "โหลดไม่สำเร็จ");
      setRows(json.adgroups);
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
    return q ? rows.filter((r) => r.adgroup_name.toLowerCase().includes(q)) : rows;
  }, [rows, query]);

  async function toggle(row: AdGroupRow) {
    const status = row.operation_status === "ENABLE" ? "DISABLE" : "ENABLE";
    setBusy(row.adgroup_id);
    try {
      const res = await fetch("/api/adgroups/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adgroupIds: [row.adgroup_id], status }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      setRows((prev) =>
        prev.map((r) =>
          r.adgroup_id === row.adgroup_id
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
          <h1 className="text-xl font-semibold">Ad Groups</h1>
          <p className="text-sm text-neutral-400">
            จัดการกลุ่มโฆษณา — งบ, ผลลัพธ์, เปิด-ปิด
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
        placeholder="ค้นหาชื่อกลุ่มโฆษณา…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-800 text-left text-xs uppercase tracking-wide text-neutral-500">
              <th className="p-3">กลุ่มโฆษณา</th>
              <th className="p-3 text-right">งบ</th>
              <th className="p-3 text-right">GMV</th>
              <th className="p-3 text-right">Spend</th>
              <th className="p-3 text-right">ROAS</th>
              <th className="p-3 text-center">สถานะ</th>
              <th className="p-3 text-right">จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => {
              const running = row.operation_status === "ENABLE";
              return (
                <tr
                  key={row.adgroup_id}
                  className="border-b border-neutral-800/60 hover:bg-neutral-900"
                >
                  <td className="p-3">
                    <div className="font-medium">{row.adgroup_name}</div>
                    <div className="text-xs text-neutral-500">
                      ID: {row.adgroup_id}
                    </div>
                  </td>
                  <td className="p-3 text-right">
                    {row.budget ? formatNumber(row.budget) : "-"}
                  </td>
                  <td className="p-3 text-right text-brand">
                    {formatNumber(row.metrics.gmv)}
                  </td>
                  <td className="p-3 text-right">
                    {formatNumber(row.metrics.spend)}
                  </td>
                  <td className="p-3 text-right">
                    {formatNumber(row.metrics.roas)}
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
                      disabled={busy === row.adgroup_id}
                    >
                      {busy === row.adgroup_id ? "…" : running ? "ปิด" : "เปิด"}
                    </button>
                  </td>
                </tr>
              );
            })}
            {!loading && filtered.length === 0 && !error && (
              <tr>
                <td colSpan={7} className="p-8 text-center text-neutral-500">
                  ไม่พบกลุ่มโฆษณา
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
