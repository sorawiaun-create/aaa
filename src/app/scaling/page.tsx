"use client";

import { useCallback, useEffect, useState } from "react";
import { formatNumber } from "@/lib/labels";

interface Row {
  campaignId: string;
  name: string;
  gmvMax: boolean;
  budget: number;
  roas: number;
  gmv: number;
}

export default function ScalingPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cRes, gRes] = await Promise.all([
        fetch("/api/campaigns?window=last_7d"),
        fetch("/api/gmvmax?window=last_7d"),
      ]);
      const cJson = await cRes.json();
      const gJson = await gRes.json();
      const out: Row[] = [];
      if (cJson.ok) {
        for (const c of cJson.campaigns) {
          out.push({
            campaignId: c.campaign_id,
            name: c.campaign_name,
            gmvMax: false,
            budget: c.budget ?? 0,
            roas: c.metrics.roas,
            gmv: c.metrics.gmv,
          });
        }
      }
      if (gJson.ok) {
        for (const c of gJson.campaigns) {
          out.push({
            campaignId: c.campaign_id,
            name: c.campaign_name,
            gmvMax: true,
            budget: c.budget ?? 0,
            roas: c.metrics.roas,
            gmv: c.metrics.gmv,
          });
        }
      }
      if (!cJson.ok && !gJson.ok)
        throw new Error(cJson.error || gJson.error || "โหลดไม่สำเร็จ");
      setRows(out);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function setBudget(row: Row, newBudget: number) {
    if (!Number.isFinite(newBudget) || newBudget <= 0) return;
    setBusy(row.campaignId);
    setMsg(null);
    try {
      const res = await fetch("/api/scaling/budget", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId: row.campaignId,
          budget: Math.round(newBudget),
          gmvMax: row.gmvMax,
          name: row.name,
        }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      setRows((prev) =>
        prev.map((r) =>
          r.campaignId === row.campaignId ? { ...r, budget: json.budget } : r
        )
      );
      setMsg(`ตั้งงบ "${row.name}" เป็น ${formatNumber(json.budget)} แล้ว`);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Scaling Tools</h1>
          <p className="text-sm text-neutral-400">
            เพิ่ม/ลดงบตามผลลัพธ์ — ตัวปัง (ROAS ดี) เพิ่มงบ, ตัวแป้กลดงบ
          </p>
        </div>
        <button className="btn-secondary" onClick={load} disabled={loading}>
          {loading ? "กำลังโหลด…" : "รีเฟรช"}
        </button>
      </div>

      {error && (
        <div className="card border-red-800 bg-red-950/40 text-sm text-red-200">
          {error}
        </div>
      )}
      {msg && (
        <div className="card border-brand/40 text-sm text-neutral-200">{msg}</div>
      )}

      <div className="card border-sky-900 bg-sky-950/20 text-xs text-sky-300">
        ปรับงบได้ทันทีด้วยปุ่ม −20% / +20% หรือกรอกงบเอง ·
        (ระบบปรับงบอัตโนมัติตามกฎ กำลังต่อในขั้นถัดไป)
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-800 text-left text-xs uppercase tracking-wide text-neutral-500">
              <th className="p-3">แคมเปญ</th>
              <th className="p-3 text-right">GMV</th>
              <th className="p-3 text-right">ROAS</th>
              <th className="p-3 text-right">งบปัจจุบัน</th>
              <th className="p-3 text-center">ปรับงบ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <BudgetRow
                key={(row.gmvMax ? "g" : "c") + row.campaignId}
                row={row}
                busy={busy === row.campaignId}
                onSet={(b) => setBudget(row, b)}
              />
            ))}
            {!loading && rows.length === 0 && !error && (
              <tr>
                <td colSpan={5} className="p-8 text-center text-neutral-500">
                  ไม่พบแคมเปญ
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BudgetRow({
  row,
  busy,
  onSet,
}: {
  row: Row;
  busy: boolean;
  onSet: (b: number) => void;
}) {
  const [custom, setCustom] = useState("");
  return (
    <tr className="border-b border-neutral-800/60 hover:bg-neutral-900">
      <td className="p-3">
        <div className="font-medium">{row.name}</div>
        <div className="text-xs text-neutral-500">
          {row.gmvMax ? "GMV Max" : "ปกติ"} · ID: {row.campaignId}
        </div>
      </td>
      <td className="p-3 text-right text-brand">{formatNumber(row.gmv)}</td>
      <td className="p-3 text-right">{formatNumber(row.roas)}</td>
      <td className="p-3 text-right">{formatNumber(row.budget)}</td>
      <td className="p-3">
        <div className="flex items-center justify-center gap-1.5">
          <button
            className="btn-secondary"
            disabled={busy || !row.budget}
            onClick={() => onSet(row.budget * 0.8)}
          >
            −20%
          </button>
          <button
            className="btn-secondary"
            disabled={busy || !row.budget}
            onClick={() => onSet(row.budget * 1.2)}
          >
            +20%
          </button>
          <input
            className="input w-24"
            placeholder="งบใหม่"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
          />
          <button
            className="btn-primary"
            disabled={busy || !custom}
            onClick={() => onSet(Number(custom))}
          >
            {busy ? "…" : "ตั้ง"}
          </button>
        </div>
      </td>
    </tr>
  );
}
