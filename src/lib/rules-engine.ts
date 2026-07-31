import { addLogs, getRules, getSettings, newId } from "./db";
import {
  getAdsWithMetrics,
  getCampaignsWithMetrics,
  updateAdStatus,
  updateCampaignStatus,
} from "./tiktok";
import {
  AdMetrics,
  AutomationLog,
  AutomationRule,
  ComparisonOperator,
  EntityLevel,
  OperationStatus,
  RuleCondition,
  Settings,
} from "./types";

// Normalized view of a controllable entity (ad or campaign) so the rule
// evaluation logic works the same regardless of level.
interface Entity {
  id: string;
  name: string;
  status: OperationStatus;
  metrics: AdMetrics;
}

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

function conditionMet(entity: Entity, cond: RuleCondition): boolean {
  return compare(entity.metrics[cond.metric], cond.operator, cond.value);
}

function describeConditions(rule: AutomationRule, entity: Entity): string {
  return rule.conditions
    .map(
      (c) =>
        `${c.metric} ${c.operator} ${c.value} (actual ${entity.metrics[c.metric]})`
    )
    .join(" AND ");
}

async function fetchEntities(
  settings: Settings,
  level: EntityLevel,
  window: AutomationRule["timeWindow"]
): Promise<Entity[]> {
  if (level === "campaign") {
    const rows = await getCampaignsWithMetrics(settings, window);
    return rows.map((c) => ({
      id: c.campaign_id,
      name: c.campaign_name,
      status: c.operation_status,
      metrics: c.metrics,
    }));
  }
  // Default to ad level (adgroup not yet supported; treated as ad).
  const rows = await getAdsWithMetrics(settings, window);
  return rows.map((a) => ({
    id: a.ad_id,
    name: a.ad_name,
    status: a.operation_status,
    metrics: a.metrics,
  }));
}

async function applyStatus(
  settings: Settings,
  level: EntityLevel,
  ids: string[],
  status: OperationStatus
): Promise<void> {
  if (level === "campaign") {
    await updateCampaignStatus(settings, ids, status);
  } else {
    await updateAdStatus(settings, ids, status);
  }
}

export interface RunResult {
  evaluatedAds: number;
  activeRules: number;
  actionsTaken: number;
  logs: AutomationLog[];
}

// Evaluates all enabled rules (ad- and campaign-level) against current metrics
// and applies matching actions. `source` distinguishes scheduler vs manual runs.
export async function runAutomation(
  source: "auto" | "manual" = "auto"
): Promise<RunResult> {
  const settings = getSettings();
  const rules = getRules().filter((r) => r.enabled);

  if (rules.length === 0) {
    return { evaluatedAds: 0, activeRules: 0, actionsTaken: 0, logs: [] };
  }

  const logs: AutomationLog[] = [];
  let evaluated = 0;

  // Process each level (ad, campaign) independently.
  const levels = Array.from(new Set(rules.map((r) => r.level)));

  for (const level of levels) {
    const levelRules = rules.filter((r) => r.level === level);

    // Fetch entity data once per distinct time window used at this level.
    // Isolated per level so a failure at one level (e.g. limited GMV Max API
    // access) doesn't block automation at the other level.
    const windows = Array.from(new Set(levelRules.map((r) => r.timeWindow)));
    const byWindow = new Map<string, Entity[]>();
    try {
      await Promise.all(
        windows.map(async (w) => {
          byWindow.set(w, await fetchEntities(settings, level, w));
        })
      );
    } catch (e) {
      logs.push({
        id: newId("log_"),
        timestamp: new Date().toISOString(),
        ruleId: "system",
        ruleName: `ดึงข้อมูลระดับ ${level} ไม่สำเร็จ`,
        level,
        entityId: "-",
        entityName: "-",
        action: "DISABLE",
        reason: "fetch failed",
        success: false,
        error: e instanceof Error ? e.message : String(e),
        source,
      });
      continue;
    }

    evaluated += byWindow.get(windows[0])?.length ?? 0;

    const toEnable = new Map<string, { rule: AutomationRule; entity: Entity }>();
    const toDisable = new Map<string, { rule: AutomationRule; entity: Entity }>();

    for (const rule of levelRules) {
      const entities = byWindow.get(rule.timeWindow) ?? [];
      for (const entity of entities) {
        const allMet =
          rule.conditions.length > 0 &&
          rule.conditions.every((c) => conditionMet(entity, c));
        if (!allMet) continue;
        // Skip if already in the desired state (no-op).
        if (entity.status === rule.action) continue;

        const target = rule.action === "ENABLE" ? toEnable : toDisable;
        if (!target.has(entity.id)) target.set(entity.id, { rule, entity });
      }
    }

    for (const [action, map] of [
      ["ENABLE", toEnable],
      ["DISABLE", toDisable],
    ] as const) {
      const ids = Array.from(map.keys());
      if (ids.length === 0) continue;
      let success = true;
      let errorMsg: string | undefined;
      try {
        await applyStatus(settings, level, ids, action);
      } catch (e) {
        success = false;
        errorMsg = e instanceof Error ? e.message : String(e);
      }
      for (const [id, { rule, entity }] of map.entries()) {
        logs.push({
          id: newId("log_"),
          timestamp: new Date().toISOString(),
          ruleId: rule.id,
          ruleName: rule.name,
          level,
          entityId: id,
          entityName: entity.name,
          action,
          reason: describeConditions(rule, entity),
          success,
          error: errorMsg,
          source,
        });
      }
    }
  }

  addLogs(logs);

  return {
    evaluatedAds: evaluated,
    activeRules: rules.length,
    actionsTaken: logs.filter((l) => l.success).length,
    logs,
  };
}
