import { addLogs, getRules, getSettings, newId } from "./db";
import { getAdsWithMetrics, updateAdStatus } from "./tiktok";
import {
  AdRow,
  AutomationLog,
  AutomationRule,
  ComparisonOperator,
  RuleCondition,
} from "./types";

function compare(
  actual: number,
  op: ComparisonOperator,
  target: number
): boolean {
  switch (op) {
    case ">":
      return actual > target;
    case ">=":
      return actual >= target;
    case "<":
      return actual < target;
    case "<=":
      return actual <= target;
    case "==":
      return actual === target;
  }
}

function conditionMet(ad: AdRow, cond: RuleCondition): boolean {
  const actual = ad.metrics[cond.metric];
  return compare(actual, cond.operator, cond.value);
}

function describeConditions(rule: AutomationRule, ad: AdRow): string {
  return rule.conditions
    .map(
      (c) => `${c.metric} ${c.operator} ${c.value} (actual ${ad.metrics[c.metric]})`
    )
    .join(" AND ");
}

export interface RunResult {
  evaluatedAds: number;
  activeRules: number;
  actionsTaken: number;
  logs: AutomationLog[];
}

// Evaluates all enabled rules against current ad metrics and applies matching
// actions. `source` distinguishes scheduler runs from manual triggers.
export async function runAutomation(
  source: "auto" | "manual" = "auto"
): Promise<RunResult> {
  const settings = getSettings();
  const rules = getRules().filter((r) => r.enabled && r.level === "ad");

  if (rules.length === 0) {
    return { evaluatedAds: 0, activeRules: 0, actionsTaken: 0, logs: [] };
  }

  // Fetch ad data once per distinct time window used by the active rules.
  const windows = Array.from(new Set(rules.map((r) => r.timeWindow)));
  const adsByWindow = new Map<string, AdRow[]>();
  await Promise.all(
    windows.map(async (w) => {
      adsByWindow.set(w, await getAdsWithMetrics(settings, w));
    })
  );

  const logs: AutomationLog[] = [];
  // Collect target ad ids per action so we can batch the API calls.
  const toEnable = new Map<string, { rule: AutomationRule; ad: AdRow }>();
  const toDisable = new Map<string, { rule: AutomationRule; ad: AdRow }>();

  const anyAds = adsByWindow.get(windows[0]) ?? [];

  for (const rule of rules) {
    const ads = adsByWindow.get(rule.timeWindow) ?? [];
    for (const ad of ads) {
      const allMet =
        rule.conditions.length > 0 &&
        rule.conditions.every((c) => conditionMet(ad, c));
      if (!allMet) continue;

      // Skip if the ad is already in the desired state (no-op).
      if (ad.operation_status === rule.action) continue;

      const target = rule.action === "ENABLE" ? toEnable : toDisable;
      // First matching rule wins for a given ad+action.
      if (!target.has(ad.ad_id)) target.set(ad.ad_id, { rule, ad });
    }
  }

  async function apply(
    map: Map<string, { rule: AutomationRule; ad: AdRow }>,
    action: "ENABLE" | "DISABLE"
  ) {
    const ids = Array.from(map.keys());
    if (ids.length === 0) return;
    let success = true;
    let errorMsg: string | undefined;
    try {
      await updateAdStatus(settings, ids, action);
    } catch (e) {
      success = false;
      errorMsg = e instanceof Error ? e.message : String(e);
    }
    for (const [adId, { rule, ad }] of map.entries()) {
      logs.push({
        id: newId("log_"),
        timestamp: new Date().toISOString(),
        ruleId: rule.id,
        ruleName: rule.name,
        level: "ad",
        entityId: adId,
        entityName: ad.ad_name,
        action,
        reason: describeConditions(rule, ad),
        success,
        error: errorMsg,
        source,
      });
    }
  }

  await apply(toEnable, "ENABLE");
  await apply(toDisable, "DISABLE");

  addLogs(logs);

  return {
    evaluatedAds: anyAds.length,
    activeRules: rules.length,
    actionsTaken: logs.filter((l) => l.success).length,
    logs,
  };
}
