import "@/lib/bootstrap";
import { NextResponse } from "next/server";
import { getSettings } from "@/lib/db";
import {
  diagnoseCampaigns,
  diagnoseGmvMax,
  getAuthorizedAdvertisers,
} from "@/lib/tiktok";

export const dynamic = "force-dynamic";

// Diagnostic endpoint: shows which advertiser accounts the token can manage
// and how many campaigns each one exposes via the API. Open in a browser at
// /api/diag. Contains no secrets (token/app secret are never returned).
export async function GET() {
  const s = getSettings();
  const out: {
    connected: boolean;
    currentAdvertiserId: string;
    apiBase: string;
    advertisers: Array<{
      advertiser_id: string;
      advertiser_name: string;
      campaignCount: number | string;
      gmvMaxCount: number | string;
      sample: unknown[];
    }>;
    error?: string;
  } = {
    connected: Boolean(s.accessToken),
    currentAdvertiserId: s.advertiserId,
    apiBase: s.apiBase,
    advertisers: [],
  };

  if (!s.accessToken) {
    out.error = "ยังไม่ได้เชื่อมต่อ";
    return NextResponse.json(out);
  }

  try {
    const advertisers = await getAuthorizedAdvertisers(s, s.accessToken);
    // Limit to 15 accounts to keep the check fast.
    for (const a of advertisers.slice(0, 15)) {
      let campaignCount: number | string = 0;
      let sample: unknown[] = [];
      let gmvMaxCount: number | string = 0;
      try {
        const d = await diagnoseCampaigns(s, a.advertiser_id);
        campaignCount = d.count;
        sample = d.sample;
      } catch (e) {
        campaignCount = `error: ${e instanceof Error ? e.message : String(e)}`;
      }
      try {
        const g = await diagnoseGmvMax(s, a.advertiser_id);
        gmvMaxCount = `${g.count} (stores: ${g.storeCount})`;
      } catch (e) {
        gmvMaxCount = `error: ${e instanceof Error ? e.message : String(e)}`;
      }
      out.advertisers.push({
        advertiser_id: a.advertiser_id,
        advertiser_name: a.advertiser_name,
        campaignCount,
        gmvMaxCount,
        sample,
      });
    }
  } catch (e) {
    out.error = e instanceof Error ? e.message : String(e);
  }

  return NextResponse.json(out);
}
