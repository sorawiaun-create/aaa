import "@/lib/bootstrap";
import { NextResponse } from "next/server";
import { getSettings } from "@/lib/db";
import { buildAuthorizeUrl } from "@/lib/tiktok";

export const dynamic = "force-dynamic";

// Returns the TikTok authorization URL the user opens to grant access.
export async function GET() {
  const s = getSettings();
  if (!s.appId) {
    return NextResponse.json(
      { ok: false, error: "กรุณาบันทึก App ID ก่อน" },
      { status: 400 }
    );
  }
  if (!s.redirectUri) {
    return NextResponse.json(
      { ok: false, error: "Missing redirect URI" },
      { status: 400 }
    );
  }
  return NextResponse.json({
    ok: true,
    url: buildAuthorizeUrl(s.appId, s.redirectUri),
    redirectUri: s.redirectUri,
  });
}
