import {
  ComparisonOperator,
  MetricKey,
  OperationStatus,
  TimeWindow,
} from "./types";

// Shared, client-safe display metadata (no server-only imports here).

export const METRIC_LABELS: Record<MetricKey, string> = {
  gmv: "GMV (ยอดขายรวม)",
  spend: "Spend (ค่าโฆษณา)",
  roas: "ROAS",
  complete_payment: "Orders (จำนวนออร์เดอร์)",
  cost_per_conversion: "CPA (ต้นทุน/conversion)",
  conversion: "Conversions",
  cpc: "CPC",
  cpm: "CPM",
  ctr: "CTR (%)",
  impressions: "Impressions",
  clicks: "Clicks",
};

export const METRIC_KEYS = Object.keys(METRIC_LABELS) as MetricKey[];

export const OPERATOR_LABELS: Record<ComparisonOperator, string> = {
  ">": "> มากกว่า",
  ">=": "≥ มากกว่าหรือเท่ากับ",
  "<": "< น้อยกว่า",
  "<=": "≤ น้อยกว่าหรือเท่ากับ",
  "==": "= เท่ากับ",
};

export const OPERATOR_KEYS = Object.keys(
  OPERATOR_LABELS
) as ComparisonOperator[];

export const WINDOW_LABELS: Record<TimeWindow, string> = {
  today: "วันนี้",
  yesterday: "เมื่อวาน",
  last_3d: "3 วันล่าสุด",
  last_7d: "7 วันล่าสุด",
};

export const WINDOW_KEYS = Object.keys(WINDOW_LABELS) as TimeWindow[];

export const ACTION_LABELS: Record<OperationStatus, string> = {
  ENABLE: "เปิดโฆษณา (ENABLE)",
  DISABLE: "ปิดโฆษณา (DISABLE)",
};

export function formatNumber(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return "0";
  return v.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}
