"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { GmvMaxCampaignRow } from "@/lib/types";
import { formatNumber } from "@/lib/labels";

export default function GmvMaxPage() {
  const [rows, setRows] = useState<GmvMaxCampaignRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/gmvmax");
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "โหลดไม่สำเร็จ");
      setRows(json.campaigns);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.campaign_name.toLowerCase().includes(q));
  }, [rows, query]);

  const running = filtered.filter(
    (r) => r.operation_status === "ENABLE"
  ).length;

  async function toggle(row: GmvMaxCampaignRow) {
    const status = row.operation_status === "ENABLE" ? "DISABLE" : "ENABLE";
    setBusy(row.campaign_id);
    try {
      const res = await fetch("/api/gmvmax/toggle", {
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
          <h1 className="text-xl font-semibold">GMV Max / LIVE GMV Max</h1>
          <p className="text-sm text-neutral-400">
            แคมเปญ GMV Max โดยเฉพาะ (ดึงผ่าน smart_plus API) — เปิด-ปิดได้จริง
          </p>
        </div>
        <button className="btn-secondary" onClick={load} disabled={loading}>
          {loading ? "กำลังโหลด…" : "รีเฟรช"}
        </button>
      </div>

      {error && (
        <div className="card border-red-800 bg-red-950/40 text-sm text-red-200">
          <p className="font-medium">โหลด GMV Max ไม่สำเร็จ</p>
          <p className="mt-1 text-red-300">{error}</p>
          <p className="mt-2 text-xs text-red-400">
            ถ้าขึ้นเรื่องสิทธิ์ อาจต้องเพิ่ม scope ของ GMV Max ในแอป TikTok
          </p>
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        <Stat label="แคมเปญทั้งหมด" value={`${filtered.length}`} highlight />
        <Stat label="กำลังรัน" value={`${running}`} />
        <Stat label="ปิดอยู่" value={`${filtered.length - running}`} />
      </div>

      <input
        className="input"
        placeholder="ค้นหาชื่อแคมเปญ เช่น LIVE GMV Max…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className="card border-sky-900 bg-sky-950/20 text-xs text-sky-300">
        หน้านี้แสดง <b>สถานะ + งบ</b> และเปิด-ปิดได้แล้ว · ตัวเลข GMV/ROAS
        ต่อแคมเปญ (สำหรับตั้ง rule อัตโนมัติ) กำลังต่อ report API เป็นขั้นถัดไป
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-800 text-left text-xs uppercase tracking-wide text-neutral-500">
              <th className="p-3">แคมเปญ</th>
              <th className="p-3 text-right">งบ/วัน</th>
              <th className="p-3 text-center">ประเภท</th>
              <th className="p-3 text-center">สถานะ</th>
              <th className="p-3 text-right">จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => {
              const isRunning = row.operation_status === "ENABLE";
              return (
                <tr
                  key={row.campaign_id}
                  className="border-b border-neutral-800/60 hover:bg-neutral-900"
                >
                  <td className="p-3">
                    <div className="font-medium">{row.campaign_name}</div>
                    <div className="text-xs text-neutral-500">
                      ID: {row.campaign_id}
                    </div>
                  </td>
                  <td className="p-3 text-right">
                    {row.budget ? formatNumber(row.budget) : "-"}
                  </td>
                  <td className="p-3 text-center text-xs text-neutral-400">
                    {row.objective_type || row.campaign_type || "-"}
                  </td>
                  <td className="p-3 text-center">
                    <span
                      className={`badge ${
                        isRunning
                          ? "bg-emerald-500/15 text-emerald-400"
                          : "bg-neutral-700/50 text-neutral-400"
                      }`}
                    >
                      {isRunning ? "กำลังรัน" : "ปิดอยู่"}
                    </span>
                  </td>
                  <td className="p-3 text-right">
                    <button
                      className={isRunning ? "btn-secondary" : "btn-primary"}
                      onClick={() => toggle(row)}
                      disabled={busy === row.campaign_id}
                    >
                      {busy === row.campaign_id
                        ? "…"
                        : isRunning
                        ? "ปิด"
                        : "เปิด"}
                    </button>
                  </td>
                </tr>
              );
            })}
            {!loading && filtered.length === 0 && !error && (
              <tr>
                <td colSpan={5} className="p-8 text-center text-neutral-500">
                  ไม่พบแคมเปญ GMV Max ในบัญชีนี้ — ลองสลับบัญชีที่หน้า Settings
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
