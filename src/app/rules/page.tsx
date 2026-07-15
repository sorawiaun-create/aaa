"use client";

import { useEffect, useState } from "react";
import {
  AutomationRule,
  ComparisonOperator,
  MetricKey,
  OperationStatus,
  RuleCondition,
  TimeWindow,
} from "@/lib/types";
import {
  ACTION_LABELS,
  METRIC_KEYS,
  METRIC_LABELS,
  OPERATOR_KEYS,
  OPERATOR_LABELS,
  WINDOW_KEYS,
  WINDOW_LABELS,
} from "@/lib/labels";

interface Draft {
  name: string;
  timeWindow: TimeWindow;
  action: OperationStatus;
  conditions: RuleCondition[];
}

function emptyDraft(): Draft {
  return {
    name: "",
    timeWindow: "today",
    action: "DISABLE",
    conditions: [{ metric: "roas", operator: "<", value: 1 }],
  };
}

export default function RulesPage() {
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/rules");
    const json = await res.json();
    setRules(json.rules ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function resetForm() {
    setDraft(emptyDraft());
    setEditingId(null);
    setError(null);
  }

  function editRule(r: AutomationRule) {
    setEditingId(r.id);
    setDraft({
      name: r.name,
      timeWindow: r.timeWindow,
      action: r.action,
      conditions: r.conditions.map((c) => ({ ...c })),
    });
    setError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function updateCondition(i: number, patch: Partial<RuleCondition>) {
    setDraft((d) => ({
      ...d,
      conditions: d.conditions.map((c, idx) =>
        idx === i ? { ...c, ...patch } : c
      ),
    }));
  }

  function addCondition() {
    setDraft((d) => ({
      ...d,
      conditions: [...d.conditions, { metric: "spend", operator: ">", value: 0 }],
    }));
  }

  function removeCondition(i: number) {
    setDraft((d) => ({
      ...d,
      conditions: d.conditions.filter((_, idx) => idx !== i),
    }));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const payload = { ...draft, level: "ad", enabled: true };
      const res = await fetch(
        editingId ? `/api/rules/${editingId}` : "/api/rules",
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      resetForm();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function toggleEnabled(r: AutomationRule) {
    await fetch(`/api/rules/${r.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !r.enabled }),
    });
    await load();
  }

  async function remove(r: AutomationRule) {
    if (!confirm(`ลบ rule "${r.name}"?`)) return;
    await fetch(`/api/rules/${r.id}`, { method: "DELETE" });
    if (editingId === r.id) resetForm();
    await load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Automation Rules</h1>
        <p className="text-sm text-neutral-400">
          ตั้งเงื่อนไขให้ระบบเปิด/ปิดโฆษณาอัตโนมัติ (ทุกเงื่อนไขต้องเป็นจริงพร้อมกัน)
        </p>
      </div>

      {/* Rule builder */}
      <div className="card space-y-4">
        <h2 className="text-sm font-medium text-neutral-300">
          {editingId ? "แก้ไข rule" : "สร้าง rule ใหม่"}
        </h2>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="md:col-span-1">
            <label className="label">ชื่อ rule</label>
            <input
              className="input"
              placeholder="เช่น ปิดโฆษณา ROAS ต่ำ"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </div>
          <div>
            <label className="label">ช่วงเวลาที่ใช้ประเมิน</label>
            <select
              className="input"
              value={draft.timeWindow}
              onChange={(e) =>
                setDraft({ ...draft, timeWindow: e.target.value as TimeWindow })
              }
            >
              {WINDOW_KEYS.map((w) => (
                <option key={w} value={w}>
                  {WINDOW_LABELS[w]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">เมื่อเงื่อนไขเป็นจริง ให้</label>
            <select
              className="input"
              value={draft.action}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  action: e.target.value as OperationStatus,
                })
              }
            >
              {(["DISABLE", "ENABLE"] as OperationStatus[]).map((a) => (
                <option key={a} value={a}>
                  {ACTION_LABELS[a]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-2">
          <label className="label">เงื่อนไข (AND)</label>
          {draft.conditions.map((c, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <select
                className="input w-auto flex-1"
                value={c.metric}
                onChange={(e) =>
                  updateCondition(i, { metric: e.target.value as MetricKey })
                }
              >
                {METRIC_KEYS.map((m) => (
                  <option key={m} value={m}>
                    {METRIC_LABELS[m]}
                  </option>
                ))}
              </select>
              <select
                className="input w-auto"
                value={c.operator}
                onChange={(e) =>
                  updateCondition(i, {
                    operator: e.target.value as ComparisonOperator,
                  })
                }
              >
                {OPERATOR_KEYS.map((o) => (
                  <option key={o} value={o}>
                    {OPERATOR_LABELS[o]}
                  </option>
                ))}
              </select>
              <input
                type="number"
                step="any"
                className="input w-32"
                value={c.value}
                onChange={(e) =>
                  updateCondition(i, { value: Number(e.target.value) })
                }
              />
              <button
                className="btn-ghost"
                onClick={() => removeCondition(i)}
                disabled={draft.conditions.length === 1}
                title="ลบเงื่อนไข"
              >
                ✕
              </button>
            </div>
          ))}
          <button className="btn-ghost text-brand" onClick={addCondition}>
            + เพิ่มเงื่อนไข
          </button>
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <div className="flex items-center gap-2">
          <button className="btn-primary" onClick={save} disabled={saving}>
            {saving ? "กำลังบันทึก…" : editingId ? "บันทึกการแก้ไข" : "สร้าง rule"}
          </button>
          {editingId && (
            <button className="btn-ghost" onClick={resetForm}>
              ยกเลิก
            </button>
          )}
        </div>
      </div>

      {/* Rule list */}
      <div className="space-y-3">
        {loading && <p className="text-sm text-neutral-500">กำลังโหลด…</p>}
        {!loading && rules.length === 0 && (
          <div className="card text-center text-sm text-neutral-500">
            ยังไม่มี rule — สร้าง rule แรกด้านบน
          </div>
        )}
        {rules.map((r) => (
          <div
            key={r.id}
            className="card flex flex-wrap items-center justify-between gap-3"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium">{r.name}</span>
                <span
                  className={`badge ${
                    r.enabled
                      ? "bg-emerald-500/15 text-emerald-400"
                      : "bg-neutral-700/50 text-neutral-400"
                  }`}
                >
                  {r.enabled ? "เปิดใช้งาน" : "ปิดอยู่"}
                </span>
                <span
                  className={`badge ${
                    r.action === "DISABLE"
                      ? "bg-red-500/15 text-red-400"
                      : "bg-sky-500/15 text-sky-400"
                  }`}
                >
                  {r.action === "DISABLE" ? "→ ปิดโฆษณา" : "→ เปิดโฆษณา"}
                </span>
              </div>
              <p className="mt-1 text-xs text-neutral-400">
                {WINDOW_LABELS[r.timeWindow]} ·{" "}
                {r.conditions
                  .map(
                    (c) =>
                      `${METRIC_LABELS[c.metric].split(" ")[0]} ${c.operator} ${c.value}`
                  )
                  .join(" และ ")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button className="btn-ghost" onClick={() => toggleEnabled(r)}>
                {r.enabled ? "ปิดใช้งาน" : "เปิดใช้งาน"}
              </button>
              <button className="btn-secondary" onClick={() => editRule(r)}>
                แก้ไข
              </button>
              <button
                className="btn-ghost text-red-400"
                onClick={() => remove(r)}
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
