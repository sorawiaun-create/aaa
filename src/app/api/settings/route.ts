import "@/lib/bootstrap";
import { NextRequest, NextResponse } from "next/server";
import { getSettings, saveSettings } from "@/lib/db";
import { reloadScheduler } from "@/lib/scheduler";
import { verifyCredentials } from "@/lib/tiktok";

export const dynamic = "force-dynamic";

function mask(v: string): string {
  if (!v) return "";
  if (v.length <= 6) return "••••";
  return `${v.slice(0, 3)}••••${v.slice(-3)}`;
}

// Returns settings with secrets masked; the UI uses the boolean flags to know
// whether a value is already configured.
export async function GET() {
  const s = getSettings();
  return NextResponse.json({
    appId: s.appId,
    advertiserId: s.advertiserId,
    apiBase: s.apiBase,
    schedulerEnabled: s.schedulerEnabled,
    schedulerIntervalMinutes: s.schedulerIntervalMinutes,
    appSecretMasked: mask(s.appSecret),
    accessTokenMasked: mask(s.accessToken),
    hasAppSecret: Boolean(s.appSecret),
    hasAccessToken: Boolean(s.accessToken),
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const patch: Record<string, unknown> = {};

  if (typeof body.appId === "string") patch.appId = body.appId.trim();
  if (typeof body.advertiserId === "string")
    patch.advertiserId = body.advertiserId.trim();
  if (typeof body.apiBase === "string" && body.apiBase.trim())
    patch.apiBase = body.apiBase.trim();
  if (typeof body.schedulerEnabled === "boolean")
    patch.schedulerEnabled = body.schedulerEnabled;
  if (typeof body.schedulerIntervalMinutes === "number")
    patch.schedulerIntervalMinutes = Math.max(
      1,
      Math.floor(body.schedulerIntervalMinutes)
    );

  // Only overwrite secrets when a non-empty value is supplied, so leaving the
  // field blank preserves the existing secret.
  if (typeof body.appSecret === "string" && body.appSecret.trim())
    patch.appSecret = body.appSecret.trim();
  if (typeof body.accessToken === "string" && body.accessToken.trim())
    patch.accessToken = body.accessToken.trim();

  saveSettings(patch);
  reloadScheduler();

  return NextResponse.json({ ok: true });
}

// Verifies the stored credentials against the TikTok API.
export async function PUT() {
  try {
    const info = await verifyCredentials(getSettings());
    return NextResponse.json({ ok: true, advertiser: info });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 400 }
    );
  }
}
