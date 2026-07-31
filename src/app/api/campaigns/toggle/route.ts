import "@/lib/bootstrap";
import { NextRequest, NextResponse } from "next/server";
import { addLogs, getSettings, newId } from "@/lib/db";
import { getCampaignsWithMetrics, updateCampaignStatus } from "@/lib/tiktok";
import { AutomationLog, OperationStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

// Manual enable/disable of one or more campaigns (GMV Max / LIVE included).
export async function POST(req: NextRequest) {
  const body = await req.json();
  const campaignIds: string[] = Array.isArray(body.campaignIds)
    ? body.campaignIds
    : [];
  const status: OperationStatus =
    body.status === "ENABLE" ? "ENABLE" : "DISABLE";

  if (campaignIds.length === 0) {
    return NextResponse.json(
      { ok: false, error: "No campaign ids provided" },
      { status: 400 }
    );
  }

  const settings = getSettings();
  try {
    await updateCampaignStatus(settings, campaignIds, status);

    let nameById: Record<string, string> = {};
    try {
      const cs = await getCampaignsWithMetrics(settings, "today");
      nameById = Object.fromEntries(
        cs.map((c) => [c.campaign_id, c.campaign_name])
      );
    } catch {
      /* best-effort */
    }

    const logs: AutomationLog[] = campaignIds.map((id) => ({
      id: newId("log_"),
      timestamp: new Date().toISOString(),
      ruleId: "manual",
      ruleName: "Manual action",
      level: "campaign",
      entityId: id,
      entityName: nameById[id] ?? id,
      action: status,
      reason: "Manual toggle from campaigns page",
      success: true,
      source: "manual",
    }));
    addLogs(logs);

    return NextResponse.json({ ok: true, updated: campaignIds.length, status });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 400 }
    );
  }
}
