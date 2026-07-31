import "@/lib/bootstrap";
import { NextRequest, NextResponse } from "next/server";
import { getAlerts, newId, saveAlert } from "@/lib/db";
import { AlertRule, ComparisonOperator, MetricKey, TimeWindow } from "@/lib/types";

export const dynamic = "force-dynamic";

const METRICS: MetricKey[] = [
  "gmv",
  "spend",
  "roas",
  "complete_payment",
  "cost_per_conversion",
  "conversion",
  "cpc",
  "cpm",
  "ctr",
  "impressions",
  "clicks",
];
const OPS: ComparisonOperator[] = [">", ">=", "<", "<=", "=="];
const WINDOWS: TimeWindow[] = ["today", "yesterday", "last_3d", "last_7d"];

export async function GET() {
  return NextResponse.json({ ok: true, alerts: getAlerts() });
}

export async function POST(req: NextRequest) {
  const b = await req.json();
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name)
    return NextResponse.json({ ok: false, error: "ต้องมีชื่อ" }, { status: 400 });
  if (!METRICS.includes(b.metric))
    return NextResponse.json({ ok: false, error: "metric ไม่ถูกต้อง" }, { status: 400 });
  if (!OPS.includes(b.operator))
    return NextResponse.json({ ok: false, error: "operator ไม่ถูกต้อง" }, { status: 400 });
  if (!WINDOWS.includes(b.timeWindow))
    return NextResponse.json({ ok: false, error: "ช่วงเวลาไม่ถูกต้อง" }, { status: 400 });

  const alert: AlertRule = {
    id: newId("alert_"),
    name,
    enabled: b.enabled !== false,
    source: b.source === "gmvmax" ? "gmvmax" : "campaign",
    metric: b.metric,
    operator: b.operator,
    value: Number(b.value) || 0,
    timeWindow: b.timeWindow,
    createdAt: new Date().toISOString(),
  };
  saveAlert(alert);
  return NextResponse.json({ ok: true, alert });
}
