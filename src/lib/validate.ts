import {
  AutomationRule,
  ComparisonOperator,
  EntityLevel,
  MetricKey,
  OperationStatus,
  RuleCondition,
  TimeWindow,
} from "./types";

const METRICS: MetricKey[] = [
  "spend",
  "gmv",
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
const OPERATORS: ComparisonOperator[] = [">", ">=", "<", "<=", "=="];
const WINDOWS: TimeWindow[] = ["today", "yesterday", "last_3d", "last_7d"];
const LEVELS: EntityLevel[] = ["ad", "adgroup", "campaign"];
const ACTIONS: OperationStatus[] = ["ENABLE", "DISABLE"];

type RuleInput = Omit<AutomationRule, "id" | "createdAt" | "updatedAt">;

export type ParseResult =
  | { ok: true; rule: RuleInput }
  | { ok: false; error: string };

export function parseRuleInput(body: unknown): ParseResult {
  if (typeof body !== "object" || body === null)
    return { ok: false, error: "Invalid body" };
  const b = body as Record<string, unknown>;

  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name) return { ok: false, error: "Rule name is required" };

  const level = b.level as EntityLevel;
  if (!LEVELS.includes(level)) return { ok: false, error: "Invalid level" };

  const timeWindow = b.timeWindow as TimeWindow;
  if (!WINDOWS.includes(timeWindow))
    return { ok: false, error: "Invalid time window" };

  const action = b.action as OperationStatus;
  if (!ACTIONS.includes(action)) return { ok: false, error: "Invalid action" };

  if (!Array.isArray(b.conditions) || b.conditions.length === 0)
    return { ok: false, error: "At least one condition is required" };

  const conditions: RuleCondition[] = [];
  for (const raw of b.conditions) {
    const c = raw as Record<string, unknown>;
    if (!METRICS.includes(c.metric as MetricKey))
      return { ok: false, error: `Invalid metric: ${String(c.metric)}` };
    if (!OPERATORS.includes(c.operator as ComparisonOperator))
      return { ok: false, error: `Invalid operator: ${String(c.operator)}` };
    const value = Number(c.value);
    if (!Number.isFinite(value))
      return { ok: false, error: "Condition value must be a number" };
    conditions.push({
      metric: c.metric as MetricKey,
      operator: c.operator as ComparisonOperator,
      value,
    });
  }

  return {
    ok: true,
    rule: {
      name,
      enabled: b.enabled !== false,
      level,
      timeWindow,
      action,
      conditions,
    },
  };
}
