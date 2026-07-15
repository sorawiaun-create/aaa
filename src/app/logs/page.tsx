"use client";

import { useEffect, useState } from "react";
import { AutomationLog } from "@/lib/types";

export default function LogsPage() {
  const [logs, setLogs] = useState<AutomationLog[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/logs?limit=300");
    const json = await res.json();
    setLogs(json.logs ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Logs</h1>
          <p className="text-sm text-neutral-400">
            ประวัติการเปิด/ปิดโฆษณา (อัตโนมัติและด้วยตนเอง)
          </p>
        </div>
        <button className="btn-secondary" onClick={load} disabled={loading}>
          {loading ? "กำลังโหลด…" : "รีเฟรช"}
        </button>
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-800 text-left text-xs uppercase tracking-wide text-neutral-500">
              <th className="p-3">เวลา</th>
              <th className="p-3">Rule</th>
              <th className="p-3">โฆษณา</th>
              <th className="p-3 text-center">การกระทำ</th>
              <th className="p-3">เหตุผล</th>
              <th className="p-3 text-center">ที่มา</th>
              <th className="p-3 text-center">ผล</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr
                key={l.id}
                className="border-b border-neutral-800/60 align-top hover:bg-neutral-900"
              >
                <td className="whitespace-nowrap p-3 text-xs text-neutral-400">
                  {new Date(l.timestamp).toLocaleString("th-TH")}
                </td>
                <td className="p-3">{l.ruleName}</td>
                <td className="p-3">
                  <div>{l.entityName}</div>
                  <div className="text-xs text-neutral-500">{l.entityId}</div>
                </td>
                <td className="p-3 text-center">
                  <span
                    className={`badge ${
                      l.action === "DISABLE"
                        ? "bg-red-500/15 text-red-400"
                        : "bg-sky-500/15 text-sky-400"
                    }`}
                  >
                    {l.action === "DISABLE" ? "ปิด" : "เปิด"}
                  </span>
                </td>
                <td className="p-3 text-xs text-neutral-400">{l.reason}</td>
                <td className="p-3 text-center text-xs">
                  {l.source === "auto" ? "อัตโนมัติ" : "manual"}
                </td>
                <td className="p-3 text-center">
                  {l.success ? (
                    <span className="text-emerald-400">✓</span>
                  ) : (
                    <span
                      className="text-red-400"
                      title={l.error ?? "error"}
                    >
                      ✕
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {!loading && logs.length === 0 && (
              <tr>
                <td colSpan={7} className="p-8 text-center text-neutral-500">
                  ยังไม่มีประวัติการทำงาน
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
