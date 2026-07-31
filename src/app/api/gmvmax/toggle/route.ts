import "@/lib/bootstrap";
import { NextRequest, NextResponse } from "next/server";
import { addLogs, getSettings, newId } from "@/lib/db";
import { updateGmvMaxCampaignStatus } from "@/lib/tiktok";
import { AutomationLog, OperationStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

// Manual enable/disable of one or more GMV Max / LIVE GMV Max campaigns.
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
    await updateGmvMaxCampaignStatus(settings, campaignIds, status);

    // Names are best-effort for the log; skip the extra lookup to keep the
    // toggle fast (the report+info fetch is heavy).
    const nameById: Record<string, string> = {};

    const logs: AutomationLog[] = campaignIds.map((id) => ({
      id: newId("log_"),
      timestamp: new Date().toISOString(),
      ruleId: "manual",
      ruleName: "Manual action",
      level: "campaign",
      entityId: id,
      entityName: nameById[id] ?? id,
      action: status,
      reason: "Manual toggle from GMV Max page",
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
