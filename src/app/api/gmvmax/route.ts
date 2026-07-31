import "@/lib/bootstrap";
import { NextResponse } from "next/server";
import { getSettings } from "@/lib/db";
import { listGmvMaxCampaigns } from "@/lib/tiktok";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const campaigns = await listGmvMaxCampaigns(getSettings());
    return NextResponse.json({ ok: true, campaigns });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 400 }
    );
  }
}
