// Shared domain types for the TikTok Ads automation app.

export type EntityLevel = "ad" | "adgroup" | "campaign";

export type OperationStatus = "ENABLE" | "DISABLE";

// Metrics we can build automation rules on. These map to TikTok report metrics.
export type MetricKey =
  | "spend"
  | "gmv" // gross merchandise value (ยอดขายรวม) = roas * spend
  | "roas" // = complete_payment_roas
  | "complete_payment" // number of paid orders
  | "cost_per_conversion" // CPA
  | "conversion" // number of conversions
  | "cpc"
  | "cpm"
  | "ctr"
  | "impressions"
  | "clicks";

export type ComparisonOperator = ">" | ">=" | "<" | "<=" | "==";

// Reporting time window used when evaluating a rule.
export type TimeWindow = "today" | "yesterday" | "last_3d" | "last_7d";

export interface RuleCondition {
  metric: MetricKey;
  operator: ComparisonOperator;
  value: number;
}

export interface AutomationRule {
  id: string;
  name: string;
  enabled: boolean;
  level: EntityLevel;
  timeWindow: TimeWindow;
  // All conditions must be true (logical AND) for the action to fire.
  conditions: RuleCondition[];
  // What to do when conditions match: pause (DISABLE) or turn on (ENABLE).
  action: OperationStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Settings {
  appId: string;
  appSecret: string;
  accessToken: string;
  advertiserId: string;
  apiBase: string;
  schedulerEnabled: boolean;
  schedulerIntervalMinutes: number;
}

export interface AdMetrics {
  spend: number;
  gmv: number;
  roas: number;
  complete_payment: number;
  cost_per_conversion: number;
  conversion: number;
  cpc: number;
  cpm: number;
  ctr: number;
  impressions: number;
  clicks: number;
}

export interface AdRow {
  ad_id: string;
  ad_name: string;
  adgroup_id: string;
  campaign_id: string;
  operation_status: OperationStatus; // ENABLE = running, DISABLE = paused
  secondary_status?: string;
  metrics: AdMetrics;
}

export interface AutomationLog {
  id: string;
  timestamp: string;
  ruleId: string;
  ruleName: string;
  level: EntityLevel;
  entityId: string;
  entityName: string;
  action: OperationStatus;
  reason: string;
  success: boolean;
  error?: string;
  // "auto" for scheduler-triggered, "manual" for user-triggered actions.
  source: "auto" | "manual";
}
