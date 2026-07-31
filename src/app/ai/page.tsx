"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatNumber } from "@/lib/labels";

interface C {
  name: string;
  gmv: number;
  spend: number;
  roas: number;
  orders: number;
  gmvMax: boolean;
}

export default function AiPage() {
  const [rows, setRows] = useState<C[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      const out: C[] = [];
      if (cJson.ok)
        for (const c of cJson.campaigns)
          out.push({
            name: c.campaign_name,
            gmv: c.metrics.gmv,
            spend: c.metrics.spend,
            roas: c.metrics.roas,
            orders: c.metrics.complete_payment,
            gmvMax: false,
          });
      if (gJson.ok)
        for (const c of gJson.campaigns)
          out.push({
            name: c.campaign_name,
            gmv: c.metrics.gmv,
            spend: c.metrics.spend,
            roas: c.metrics.roas,
            orders: c.metrics.orders,
            gmvMax: true,
          });
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

  const analysis = useMemo(() => {
    const spending = rows.filter((r) => r.spend > 0);
    const totalSpend = rows.reduce((a, r) => a + r.spend, 0);
    const totalGmv = rows.reduce((a, r) => a + r.gmv, 0);
    const avgRoas = totalSpend > 0 ? totalGmv / totalSpend : 0;
    const winners = spending
      .filter((r) => r.roas >= 2)
      .sort((a, b) => b.roas - a.roas)
      .slice(0, 8);
    const losers = spending
      .filter((r) => r.roas < 1)
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 8);
    return { totalSpend, totalGmv, avgRoas, winners, losers, spending };
  }, [rows]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">AI Analysis</h1>
          <p className="text-sm text-neutral-400">
            วิเคราะห์จากข้อมูลจริง 7 วันล่าสุด + คำแนะนำการปรับ
          </p>
        </div>
        <button className="btn-secondary" onClick={load} disabled={loading}>
          {loading ? "กำลังวิเคราะห์…" : "วิเคราะห์ใหม่"}
        </button>
      </div>

      {error && (
        <div className="card border-red-800 bg-red-950/40 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        <Stat label="GMV รวม" value={formatNumber(analysis.totalGmv)} highlight />
        <Stat label="Spend รวม" value={formatNumber(analysis.totalSpend)} />
        <Stat label="ROAS เฉลี่ย" value={formatNumber(analysis.avgRoas)} />
      </div>

      <div className="card">
        <div className="mb-2 text-sm font-medium text-neutral-300">
          📋 สรุปโดยรวม
        </div>
        <p className="text-sm text-neutral-300">
          กำลังใช้งบอยู่ {analysis.spending.length} แคมเปญ · ROAS เฉลี่ย{" "}
          <b className={analysis.avgRoas >= 2 ? "text-emerald-400" : "text-amber-400"}>
            {formatNumber(analysis.avgRoas)}
          </b>{" "}
          {analysis.avgRoas >= 2
            ? "— ภาพรวมดี ควรมองหาตัวที่ปังเพื่อเพิ่มงบ"
            : "— ภาพรวมพอใช้/ต้องระวัง มีตัวที่กินงบแต่ ROAS ต่ำ ควรพิจารณาลดงบ/ปิด"}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="card">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-emerald-400">
            🚀 ตัวปัง — ควรเพิ่มงบ (ROAS ≥ 2)
          </div>
          {analysis.winners.length === 0 ? (
            <p className="text-sm text-neutral-500">ยังไม่มีตัวที่ ROAS ≥ 2</p>
          ) : (
            <ul className="space-y-2">
              {analysis.winners.map((w, i) => (
                <li key={i} className="flex justify-between gap-2 text-sm">
                  <span className="truncate">{w.name}</span>
                  <span className="shrink-0 text-emerald-400">
                    ROAS {formatNumber(w.roas)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-red-400">
            ⚠️ ตัวแป้ก — ควรลดงบ/ปิด (ROAS &lt; 1)
          </div>
          {analysis.losers.length === 0 ? (
            <p className="text-sm text-neutral-500">ไม่มีตัวที่ ROAS ต่ำกว่า 1 🎉</p>
          ) : (
            <ul className="space-y-2">
              {analysis.losers.map((w, i) => (
                <li key={i} className="flex justify-between gap-2 text-sm">
                  <span className="truncate">{w.name}</span>
                  <span className="shrink-0 text-red-400">
                    Spend {formatNumber(w.spend)} · ROAS {formatNumber(w.roas)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="card border-sky-900 bg-sky-950/20 text-xs text-sky-300">
        การวิเคราะห์นี้อิงกฎจากข้อมูลจริงของคุณ · ขั้นต่อไปจะเชื่อมกับ Scaling
        Tools + Automated Rules เพื่อลงมือปรับให้อัตโนมัติ
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
      <div className={`mt-1 text-2xl font-semibold ${highlight ? "text-brand" : ""}`}>
        {value}
      </div>
    </div>
  );
}
