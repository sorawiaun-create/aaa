import "@/lib/bootstrap";
import { NextRequest, NextResponse } from "next/server";
import { addLogs, getSettings, newId } from "@/lib/db";
import { updateCampaignBudget, updateGmvMaxBudget } from "@/lib/tiktok";
import { AutomationLog } from "@/lib/types";

export const dynamic = "force-dynamic";

// Sets a new budget for a campaign (regular or GMV Max).
export async function POST(req: NextRequest) {
  const body = await req.json();
  const campaignId = String(body.campaignId ?? "");
  const budget = Number(body.budget);
  const isGmvMax = Boolean(body.gmvMax);
  const name = typeof body.name === "string" ? body.name : campaignId;

  if (!campaignId || !Number.isFinite(budget) || budget <= 0) {
    return NextResponse.json(
      { ok: false, error: "ต้องระบุ campaignId และ budget ที่ถูกต้อง" },
      { status: 400 }
    );
  }

  try {
    const s = getSettings();
    if (isGmvMax) await updateGmvMaxBudget(s, campaignId, budget);
    else await updateCampaignBudget(s, campaignId, budget);

    const log: AutomationLog = {
      id: newId("log_"),
      timestamp: new Date().toISOString(),
      ruleId: "manual",
      ruleName: "Budget change",
      level: "campaign",
      entityId: campaignId,
      entityName: name,
      action: "ENABLE",
      reason: `ตั้งงบใหม่เป็น ${budget}`,
      success: true,
      source: "manual",
    };
    addLogs([log]);

    return NextResponse.json({ ok: true, budget });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 400 }
    );
  }
}
