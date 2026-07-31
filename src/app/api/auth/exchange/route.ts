import "@/lib/bootstrap";
import { NextRequest, NextResponse } from "next/server";
import { getSettings, saveSettings } from "@/lib/db";
import { reloadScheduler } from "@/lib/scheduler";
import { exchangeAuthCode, getAuthorizedAdvertisers } from "@/lib/tiktok";

export const dynamic = "force-dynamic";

// Takes the pasted auth_code, exchanges it for an access token, stores the
// token, and auto-selects an advertiser account so the tool is ready to use.
export async function POST(req: NextRequest) {
  const body = await req.json();
  const authCode = typeof body.authCode === "string" ? body.authCode.trim() : "";
  if (!authCode) {
    return NextResponse.json(
      { ok: false, error: "กรุณาวาง auth_code" },
      { status: 400 }
    );
  }

  try {
    const settings = getSettings();
    const token = await exchangeAuthCode(settings, authCode);

    // Fetch advertiser names for a friendlier picker; fall back to raw ids.
    const advertisers = await getAuthorizedAdvertisers(
      { ...settings, accessToken: token.access_token },
      token.access_token
    );

    const chosenId =
      advertisers[0]?.advertiser_id ?? token.advertiser_ids?.[0] ?? "";

    saveSettings({
      accessToken: token.access_token,
      advertiserId: chosenId,
    });
    reloadScheduler();

    return NextResponse.json({
      ok: true,
      advertiserId: chosenId,
      advertisers:
        advertisers.length > 0
          ? advertisers
          : (token.advertiser_ids ?? []).map((id) => ({
              advertiser_id: id,
              advertiser_name: id,
            })),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 400 }
    );
  }
}
