import { addLogs, getAlerts, getSettings, newId } from "./db";
import {
  getCampaignsWithMetrics,
  getGmvMaxCampaigns,
  notifyWebhook,
} from "./tiktok";
import { AlertRule, ComparisonOperator, MetricKey } from "./types";

function cmp(a: number, op: ComparisonOperator, b: number): boolean {
  switch (op) {
    case ">":
      return a > b;
    case ">=":
      return a >= b;
    case "<":
      return a < b;
    case "<=":
      return a <= b;
    case "==":
      return a === b;
  }
}

interface Item {
  name: string;
  value: number;
}

// Collects the entities (with the alert's metric value) for one alert.
async function itemsForAlert(alert: AlertRule): Promise<Item[]> {
  const s = getSettings();
  if (alert.source === "gmvmax") {
    const rows = await getGmvMaxCampaigns(s, alert.timeWindow);
    const pick = (m: (typeof rows)[number]["metrics"]): number => {
      const key = alert.metric as MetricKey;
      if (key === "gmv") return m.gmv;
      if (key === "spend") return m.spend;
      if (key === "roas") return m.roas;
      if (key === "complete_payment") return m.orders;
      return 0;
    };
    return rows.map((r) => ({ name: r.campaign_name, value: pick(r.metrics) }));
  }
  const rows = await getCampaignsWithMetrics(s, alert.timeWindow);
  return rows.map((r) => ({
    name: r.campaign_name,
    value: r.metrics[alert.metric],
  }));
}

// Evaluates enabled alerts; sends one webhook message per alert that has
// matching campaigns, and records it to the logs. Returns the number sent.
export async function evaluateAlerts(): Promise<number> {
  const s = getSettings();
  const alerts = getAlerts().filter((a) => a.enabled);
  if (alerts.length === 0) return 0;

  let sent = 0;
  for (const alert of alerts) {
    let items: Item[];
    try {
      items = await itemsForAlert(alert);
    } catch {
      continue;
    }
    const matches = items.filter((it) =>
      cmp(it.value, alert.operator, alert.value)
    );
    if (matches.length === 0) continue;

    const top = matches
      .slice(0, 10)
      .map((m) => `• ${m.name}: ${m.value}`)
      .join("\n");
    const text =
      `🔔 [${alert.name}]\n` +
      `เงื่อนไข: ${alert.metric} ${alert.operator} ${alert.value} (${alert.source})\n` +
      `เข้าเงื่อนไข ${matches.length} แคมเปญ:\n${top}`;

    if (s.webhookUrl) {
      await notifyWebhook(s.webhookUrl, text);
      sent += 1;
    }
    addLogs([
      {
        id: newId("log_"),
        timestamp: new Date().toISOString(),
        ruleId: alert.id,
        ruleName: `Alert: ${alert.name}`,
        level: alert.source === "gmvmax" ? "campaign" : "campaign",
        entityId: "-",
        entityName: `${matches.length} แคมเปญ`,
        action: "DISABLE",
        reason: `${alert.metric} ${alert.operator} ${alert.value}`,
        success: true,
        source: "auto",
      },
    ]);
  }
  return sent;
}
