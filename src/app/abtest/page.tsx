"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatNumber } from "@/lib/labels";

interface C {
  id: string;
  name: string;
  gmv: number;
  spend: number;
  roas: number;
  orders: number;
}

export default function AbTestPage() {
  const [rows, setRows] = useState<C[]>([]);
  const [loading, setLoading] = useState(true);
  const [a, setA] = useState("");
  const [b, setB] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
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
            id: c.campaign_id,
            name: c.campaign_name,
            gmv: c.metrics.gmv,
            spend: c.metrics.spend,
            roas: c.metrics.roas,
            orders: c.metrics.complete_payment,
          });
      if (gJson.ok)
        for (const c of gJson.campaigns)
          out.push({
            id: c.campaign_id,
            name: c.campaign_name,
            gmv: c.metrics.gmv,
            spend: c.metrics.spend,
            roas: c.metrics.roas,
            orders: c.metrics.orders,
          });
      setRows(out);
      if (out[0]) setA(out[0].id);
      if (out[1]) setB(out[1].id);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const rowA = useMemo(() => rows.find((r) => r.id === a), [rows, a]);
  const rowB = useMemo(() => rows.find((r) => r.id === b), [rows, b]);

  const metrics: { key: keyof C; label: string; higherBetter: boolean }[] = [
    { key: "gmv", label: "GMV", higherBetter: true },
    { key: "roas", label: "ROAS", higherBetter: true },
    { key: "orders", label: "Orders", higherBetter: true },
    { key: "spend", label: "Spend", higherBetter: false },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">A/B Testing</h1>
          <p className="text-sm text-neutral-400">
            เปรียบเทียบ 2 แคมเปญแบบเทียบกันตรงๆ (7 วันล่าสุด)
          </p>
        </div>
        <button className="btn-secondary" onClick={load} disabled={loading}>
          {loading ? "กำลังโหลด…" : "รีเฟรช"}
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="label">แคมเปญ A</label>
          <select className="input" value={a} onChange={(e) => setA(e.target.value)}>
            {rows.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">แคมเปญ B</label>
          <select className="input" value={b} onChange={(e) => setB(e.target.value)}>
            {rows.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {rowA && rowB && (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-800 text-left text-xs uppercase tracking-wide text-neutral-500">
                <th className="p-3">ตัวชี้วัด</th>
                <th className="p-3 text-right">A: {rowA.name}</th>
                <th className="p-3 text-right">B: {rowB.name}</th>
                <th className="p-3 text-center">ผู้ชนะ</th>
              </tr>
            </thead>
            <tbody>
              {metrics.map((m) => {
                const va = rowA[m.key] as number;
                const vb = rowB[m.key] as number;
                const winA = m.higherBetter ? va > vb : va < vb;
                const winB = m.higherBetter ? vb > va : vb < va;
                return (
                  <tr key={m.key} className="border-b border-neutral-800/60">
                    <td className="p-3 font-medium">{m.label}</td>
                    <td
                      className={`p-3 text-right ${winA ? "text-emerald-400" : ""}`}
                    >
                      {formatNumber(va)}
                    </td>
                    <td
                      className={`p-3 text-right ${winB ? "text-emerald-400" : ""}`}
                    >
                      {formatNumber(vb)}
                    </td>
                    <td className="p-3 text-center text-xs">
                      {va === vb ? "เสมอ" : winA ? "A" : "B"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="card border-sky-900 bg-sky-950/20 text-xs text-sky-300">
        เวอร์ชันนี้เทียบผลจากแคมเปญที่มีอยู่ · การสร้าง Split Test อย่างเป็นทางการ
        (แบ่งงบทดสอบผ่าน API) จะเพิ่มในขั้นถัดไป
      </div>
    </div>
  );
}
