import {
  AdMetrics,
  AdRow,
  OperationStatus,
  Settings,
  TimeWindow,
} from "./types";

// Minimal TikTok Marketing API v1.3 client covering what the automation tool
// needs: list ads, pull performance reports, and enable/disable ads.
// Docs: https://business-api.tiktok.com/portal/docs

export class TikTokApiError extends Error {
  code: number;
  requestId?: string;
  constructor(message: string, code: number, requestId?: string) {
    super(message);
    this.name = "TikTokApiError";
    this.code = code;
    this.requestId = requestId;
  }
}

interface TikTokResponse<T> {
  code: number;
  message: string;
  request_id?: string;
  data: T;
}

function assertConfigured(s: Settings) {
  if (!s.accessToken) throw new TikTokApiError("Missing access token", -1);
  if (!s.advertiserId) throw new TikTokApiError("Missing advertiser id", -1);
}

async function request<T>(
  s: Settings,
  method: "GET" | "POST",
  endpoint: string,
  params?: Record<string, unknown>
): Promise<T> {
  const base = s.apiBase.replace(/\/$/, "");
  let url = `${base}${endpoint}`;
  const init: RequestInit = {
    method,
    headers: {
      "Access-Token": s.accessToken,
      "Content-Type": "application/json",
    },
  };

  if (method === "GET" && params) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null) continue;
      qs.set(k, typeof v === "string" ? v : JSON.stringify(v));
    }
    url += `?${qs.toString()}`;
  } else if (method === "POST" && params) {
    init.body = JSON.stringify(params);
  }

  const res = await fetch(url, init);
  const json = (await res.json()) as TikTokResponse<T>;

  // TikTok returns HTTP 200 with a business code; 0 means success.
  if (json.code !== 0) {
    throw new TikTokApiError(
      json.message || "TikTok API error",
      json.code,
      json.request_id
    );
  }
  return json.data;
}

/* --------------------------- Date helpers --------------------------- */

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function windowToDates(w: TimeWindow): { start: string; end: string } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = 24 * 60 * 60 * 1000;
  switch (w) {
    case "today":
      return { start: fmt(today), end: fmt(today) };
    case "yesterday": {
      const y = new Date(today.getTime() - day);
      return { start: fmt(y), end: fmt(y) };
    }
    case "last_3d":
      return { start: fmt(new Date(today.getTime() - 2 * day)), end: fmt(today) };
    case "last_7d":
      return { start: fmt(new Date(today.getTime() - 6 * day)), end: fmt(today) };
  }
}

/* ------------------------------ Ads --------------------------------- */

interface AdGetData {
  list: Array<{
    ad_id: string;
    ad_name: string;
    adgroup_id: string;
    campaign_id: string;
    operation_status: OperationStatus;
    secondary_status?: string;
  }>;
  page_info?: { total_number: number; page: number; total_page: number };
}

async function listAdEntities(s: Settings): Promise<AdGetData["list"]> {
  const all: AdGetData["list"] = [];
  let page = 1;
  const pageSize = 100;
  // Guard against runaway pagination.
  for (let i = 0; i < 50; i++) {
    const data = await request<AdGetData>(s, "GET", "/ad/get/", {
      advertiser_id: s.advertiserId,
      page,
      page_size: pageSize,
      fields: [
        "ad_id",
        "ad_name",
        "adgroup_id",
        "campaign_id",
        "operation_status",
        "secondary_status",
      ],
    });
    all.push(...(data.list ?? []));
    const totalPage = data.page_info?.total_page ?? 1;
    if (page >= totalPage) break;
    page += 1;
  }
  return all;
}

const REPORT_METRICS = [
  "spend",
  "complete_payment_roas",
  "cost_per_conversion",
  "conversion",
  "cpc",
  "cpm",
  "ctr",
  "impressions",
  "clicks",
];

interface ReportData {
  list: Array<{
    dimensions: { ad_id: string };
    metrics: Record<string, string>;
  }>;
}

function num(v: string | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function getAdReports(
  s: Settings,
  window: TimeWindow
): Promise<Record<string, AdMetrics>> {
  const { start, end } = windowToDates(window);
  const data = await request<ReportData>(s, "GET", "/report/integrated/get/", {
    advertiser_id: s.advertiserId,
    report_type: "BASIC",
    data_level: "AUCTION_AD",
    dimensions: ["ad_id"],
    metrics: REPORT_METRICS,
    start_date: start,
    end_date: end,
    page: 1,
    page_size: 1000,
  });

  const out: Record<string, AdMetrics> = {};
  for (const row of data.list ?? []) {
    const m = row.metrics;
    out[row.dimensions.ad_id] = {
      spend: num(m.spend),
      roas: num(m.complete_payment_roas),
      cost_per_conversion: num(m.cost_per_conversion),
      conversion: num(m.conversion),
      cpc: num(m.cpc),
      cpm: num(m.cpm),
      ctr: num(m.ctr),
      impressions: num(m.impressions),
      clicks: num(m.clicks),
    };
  }
  return out;
}

const ZERO_METRICS: AdMetrics = {
  spend: 0,
  roas: 0,
  cost_per_conversion: 0,
  conversion: 0,
  cpc: 0,
  cpm: 0,
  ctr: 0,
  impressions: 0,
  clicks: 0,
};

// Returns every ad with its metrics for the given window, joined together.
export async function getAdsWithMetrics(
  s: Settings,
  window: TimeWindow = "today"
): Promise<AdRow[]> {
  assertConfigured(s);
  const [entities, reports] = await Promise.all([
    listAdEntities(s),
    getAdReports(s, window),
  ]);
  return entities.map((e) => ({
    ad_id: e.ad_id,
    ad_name: e.ad_name,
    adgroup_id: e.adgroup_id,
    campaign_id: e.campaign_id,
    operation_status: e.operation_status,
    secondary_status: e.secondary_status,
    metrics: reports[e.ad_id] ?? { ...ZERO_METRICS },
  }));
}

// Enable or disable one or more ads.
export async function updateAdStatus(
  s: Settings,
  adIds: string[],
  status: OperationStatus
): Promise<void> {
  assertConfigured(s);
  if (adIds.length === 0) return;
  await request(s, "POST", "/ad/status/update/", {
    advertiser_id: s.advertiserId,
    ad_ids: adIds,
    operation_status: status,
  });
}

// Verifies credentials by fetching the advertiser's own info.
export async function verifyCredentials(
  s: Settings
): Promise<{ advertiser_id: string; name: string }> {
  assertConfigured(s);
  const data = await request<{ list: Array<{ advertiser_id: string; name: string }> }>(
    s,
    "GET",
    "/advertiser/info/",
    { advertiser_ids: [s.advertiserId], fields: ["advertiser_id", "name"] }
  );
  const info = data.list?.[0];
  if (!info) throw new TikTokApiError("Advertiser not found", -1);
  return info;
}
