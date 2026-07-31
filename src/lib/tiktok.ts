import {
  AdMetrics,
  AdRow,
  CampaignRow,
  GmvMaxCampaignRow,
  GmvMaxMetrics,
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
  "complete_payment",
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
    const spend = num(m.spend);
    const roas = num(m.complete_payment_roas);
    out[row.dimensions.ad_id] = {
      spend,
      // GMV (gross merchandise value / ยอดขายรวม) is derived from payment ROAS:
      // ROAS = revenue / spend, so revenue (GMV) = ROAS * spend.
      gmv: roas * spend,
      roas,
      complete_payment: num(m.complete_payment),
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
  gmv: 0,
  roas: 0,
  complete_payment: 0,
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

/* ---------------------------- Campaigns ----------------------------- */
// Campaign-level control is what GMV Max / LIVE GMV Max campaigns need,
// since those are managed as smart campaigns (no editable ad breakdown).

interface CampaignGetData {
  list: Array<{
    campaign_id: string;
    campaign_name: string;
    objective_type?: string;
    operation_status: OperationStatus;
    secondary_status?: string;
  }>;
  page_info?: { total_page: number };
}

async function listCampaignEntities(
  s: Settings
): Promise<CampaignGetData["list"]> {
  const all: CampaignGetData["list"] = [];
  let page = 1;
  for (let i = 0; i < 100; i++) {
    const data = await request<CampaignGetData>(s, "GET", "/campaign/get/", {
      advertiser_id: s.advertiserId,
      page,
      page_size: 100,
      fields: [
        "campaign_id",
        "campaign_name",
        "objective_type",
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

interface CampaignReportData {
  list: Array<{
    dimensions: { campaign_id: string };
    metrics: Record<string, string>;
  }>;
}

async function getCampaignReports(
  s: Settings,
  window: TimeWindow
): Promise<Record<string, AdMetrics>> {
  const { start, end } = windowToDates(window);
  const data = await request<CampaignReportData>(
    s,
    "GET",
    "/report/integrated/get/",
    {
      advertiser_id: s.advertiserId,
      report_type: "BASIC",
      data_level: "AUCTION_CAMPAIGN",
      dimensions: ["campaign_id"],
      metrics: REPORT_METRICS,
      start_date: start,
      end_date: end,
      page: 1,
      page_size: 1000,
    }
  );

  const out: Record<string, AdMetrics> = {};
  for (const row of data.list ?? []) {
    const m = row.metrics;
    const spend = num(m.spend);
    const roas = num(m.complete_payment_roas);
    out[row.dimensions.campaign_id] = {
      spend,
      gmv: roas * spend,
      roas,
      complete_payment: num(m.complete_payment),
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

// Returns every campaign with its metrics for the window (GMV Max included).
export async function getCampaignsWithMetrics(
  s: Settings,
  window: TimeWindow = "today"
): Promise<CampaignRow[]> {
  assertConfigured(s);
  const [entities, reports] = await Promise.all([
    listCampaignEntities(s),
    getCampaignReports(s, window),
  ]);
  return entities.map((e) => ({
    campaign_id: e.campaign_id,
    campaign_name: e.campaign_name,
    objective_type: e.objective_type,
    operation_status: e.operation_status,
    secondary_status: e.secondary_status,
    metrics: reports[e.campaign_id] ?? { ...ZERO_METRICS },
  }));
}

// Diagnostic: for one advertiser, report how many campaigns /campaign/get
// returns plus a small sample, so we can see whether GMV Max campaigns are
// exposed via the API and under which account.
export async function diagnoseCampaigns(
  s: Settings,
  advertiserId: string
): Promise<{
  count: number;
  sample: Array<{
    campaign_id: string;
    campaign_name: string;
    objective_type?: string;
    operation_status: string;
  }>;
}> {
  const data = await request<
    CampaignGetData & { page_info?: { total_number?: number } }
  >({ ...s, advertiserId }, "GET", "/campaign/get/", {
    advertiser_id: advertiserId,
    page: 1,
    page_size: 20,
    fields: [
      "campaign_id",
      "campaign_name",
      "objective_type",
      "operation_status",
    ],
  });
  return {
    count: data.page_info?.total_number ?? data.list?.length ?? 0,
    sample: (data.list ?? []).slice(0, 5).map((c) => ({
      campaign_id: c.campaign_id,
      campaign_name: c.campaign_name,
      objective_type: c.objective_type,
      operation_status: c.operation_status,
    })),
  };
}

// Enable or disable one or more campaigns.
export async function updateCampaignStatus(
  s: Settings,
  campaignIds: string[],
  status: OperationStatus
): Promise<void> {
  assertConfigured(s);
  if (campaignIds.length === 0) return;
  await request(s, "POST", "/campaign/status/update/", {
    advertiser_id: s.advertiserId,
    campaign_ids: campaignIds,
    operation_status: status,
  });
}

/* --------------------------- GMV Max -------------------------------- */
// GMV Max / LIVE GMV Max are NOT returned by /campaign/get or
// /smart_plus/campaign/get. They are enumerated via the GMV Max report
// (per Shop store), and each campaign's name/status/budget come from
// /campaign/gmv_max/info/. Verified live against a real account.

interface GmvMaxStore {
  store_id: string;
  store_name?: string;
}

async function listGmvMaxStores(
  s: Settings,
  advertiserId = s.advertiserId
): Promise<GmvMaxStore[]> {
  const data = await request<{
    store_list?: Array<{ store_id: string; store_name?: string }>;
  }>({ ...s, advertiserId }, "GET", "/gmv_max/store/list/", {
    advertiser_id: advertiserId,
  });
  return (data.store_list ?? []).map((x) => ({
    store_id: x.store_id,
    store_name: x.store_name,
  }));
}

interface GmvMaxReportData {
  list: Array<{
    dimensions: { campaign_id: string };
    metrics: {
      gross_revenue?: string;
      net_cost?: string;
      orders?: string;
      roi?: string;
    };
  }>;
  page_info?: { total_page: number; total_number?: number };
}

// Returns campaign_id -> metrics for all GMV Max campaigns under the stores.
async function getGmvMaxReport(
  s: Settings,
  storeIds: string[],
  window: TimeWindow,
  advertiserId = s.advertiserId
): Promise<Record<string, GmvMaxMetrics>> {
  const out: Record<string, GmvMaxMetrics> = {};
  if (storeIds.length === 0) return out;
  const { start, end } = windowToDates(window);
  let page = 1;
  for (let i = 0; i < 50; i++) {
    const data = await request<GmvMaxReportData>(
      { ...s, advertiserId },
      "GET",
      "/gmv_max/report/get/",
      {
        advertiser_id: advertiserId,
        store_ids: storeIds,
        dimensions: ["campaign_id"],
        metrics: ["gross_revenue", "net_cost", "orders", "roi"],
        start_date: start,
        end_date: end,
        page,
        page_size: 1000,
      }
    );
    for (const row of data.list ?? []) {
      const m = row.metrics;
      out[row.dimensions.campaign_id] = {
        gmv: num(m.gross_revenue),
        spend: num(m.net_cost),
        orders: num(m.orders),
        roas: num(m.roi),
      };
    }
    const totalPage = data.page_info?.total_page ?? 1;
    if (page >= totalPage) break;
    page += 1;
  }
  return out;
}

interface GmvMaxInfo {
  campaign_name: string;
  operation_status: OperationStatus;
  budget?: number;
  roas_bid?: number;
  shopping_ads_type?: string;
}

async function getGmvMaxInfo(
  s: Settings,
  campaignId: string
): Promise<GmvMaxInfo | null> {
  try {
    return await request<GmvMaxInfo>(s, "GET", "/campaign/gmv_max/info/", {
      advertiser_id: s.advertiserId,
      campaign_id: campaignId,
    });
  } catch {
    return null;
  }
}

// Runs an async fn over items with a bounded concurrency.
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (t: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker())
  );
  return results;
}

const ZERO_GMV: GmvMaxMetrics = { gmv: 0, spend: 0, orders: 0, roas: 0 };

// Lists GMV Max / LIVE GMV Max campaigns for the connected advertiser, with
// GMV/spend/orders/ROAS metrics and name/status.
export async function getGmvMaxCampaigns(
  s: Settings,
  window: TimeWindow = "last_7d"
): Promise<GmvMaxCampaignRow[]> {
  assertConfigured(s);
  const stores = await listGmvMaxStores(s);
  const storeIds = stores.map((x) => x.store_id);
  const reports = await getGmvMaxReport(s, storeIds, window);
  const ids = Object.keys(reports);
  const infos = await mapLimit(ids, 8, (id) => getGmvMaxInfo(s, id));
  return ids.map((id, i) => {
    const info = infos[i];
    return {
      campaign_id: id,
      campaign_name: info?.campaign_name ?? id,
      operation_status: info?.operation_status ?? "ENABLE",
      shopping_ads_type: info?.shopping_ads_type,
      budget: info?.budget,
      roas_bid: info?.roas_bid,
      metrics: reports[id] ?? { ...ZERO_GMV },
    };
  });
}

// Diagnostic: count GMV Max campaigns for one advertiser (stores + report).
export async function diagnoseGmvMax(
  s: Settings,
  advertiserId: string
): Promise<{ count: number; storeCount: number }> {
  const stores = await listGmvMaxStores(s, advertiserId);
  if (stores.length === 0) return { count: 0, storeCount: 0 };
  const { start, end } = windowToDates("last_7d");
  const data = await request<GmvMaxReportData>(
    { ...s, advertiserId },
    "GET",
    "/gmv_max/report/get/",
    {
      advertiser_id: advertiserId,
      store_ids: stores.map((x) => x.store_id),
      dimensions: ["campaign_id"],
      metrics: ["net_cost"],
      start_date: start,
      end_date: end,
      page: 1,
      page_size: 1,
    }
  );
  return {
    count: data.page_info?.total_number ?? data.list?.length ?? 0,
    storeCount: stores.length,
  };
}

// Diagnostic: try each candidate status-update endpoint on one GMV Max
// campaign and report the raw API code/message plus the campaign's status
// after each attempt, so we can identify which endpoint actually works.
export async function diagnoseGmvMaxToggle(
  s: Settings,
  campaignId: string,
  target: OperationStatus
): Promise<{
  campaignId: string;
  target: OperationStatus;
  steps: Array<{
    endpoint: string;
    httpStatus?: number;
    code?: number;
    message?: string;
    statusAfter: string;
  }>;
}> {
  assertConfigured(s);
  const base = s.apiBase.replace(/\/$/, "");
  const headers = {
    "Access-Token": s.accessToken,
    "Content-Type": "application/json",
  };

  async function readStatus(): Promise<string> {
    const info = await getGmvMaxInfo(s, campaignId);
    return info?.operation_status ?? "?";
  }
  async function tryPost(path: string, body: object) {
    try {
      const res = await fetch(`${base}${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      const text = await res.text();
      try {
        const j = JSON.parse(text);
        return { httpStatus: res.status, code: j.code, message: j.message };
      } catch {
        return { httpStatus: res.status, code: -1, message: text.slice(0, 120) };
      }
    } catch (e) {
      return {
        httpStatus: 0,
        code: -1,
        message: e instanceof Error ? e.message : String(e),
      };
    }
  }

  const steps: Array<{
    endpoint: string;
    httpStatus?: number;
    code?: number;
    message?: string;
    statusAfter: string;
  }> = [];
  steps.push({ endpoint: "info (before)", statusAfter: await readStatus() });

  const candidates = [
    {
      ep: "/campaign/status/update/",
      body: {
        advertiser_id: s.advertiserId,
        campaign_ids: [campaignId],
        operation_status: target,
      },
    },
    {
      ep: "/smart_plus/campaign/status/update/",
      body: {
        advertiser_id: s.advertiserId,
        campaign_ids: [campaignId],
        operation_status: target,
      },
    },
    {
      ep: "/campaign/gmv_max/update/",
      body: {
        advertiser_id: s.advertiserId,
        campaign_id: campaignId,
        operation_status: target,
      },
    },
  ];

  for (const c of candidates) {
    const r = await tryPost(c.ep, c.body);
    const statusAfter = await readStatus();
    steps.push({ endpoint: c.ep, ...r, statusAfter });
    if (statusAfter === target) break;
  }
  return { campaignId, target, steps };
}

// Enable/disable GMV Max campaigns. There is no operation_status on
// /campaign/gmv_max/update/, so we use the Smart+ status endpoint and fall
// back to the standard campaign status endpoint. Batched at 20 ids.
export async function updateGmvMaxCampaignStatus(
  s: Settings,
  campaignIds: string[],
  status: OperationStatus
): Promise<void> {
  assertConfigured(s);
  for (let i = 0; i < campaignIds.length; i += 20) {
    const chunk = campaignIds.slice(i, i + 20);
    try {
      await request(s, "POST", "/smart_plus/campaign/status/update/", {
        advertiser_id: s.advertiserId,
        campaign_ids: chunk,
        operation_status: status,
      });
    } catch (e) {
      await request(s, "POST", "/campaign/status/update/", {
        advertiser_id: s.advertiserId,
        campaign_ids: chunk,
        operation_status: status,
      });
    }
  }
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

/* ------------------------------ OAuth ------------------------------- */

const AUTH_PORTAL = "https://business-api.tiktok.com/portal/auth";

// Builds the URL the user visits to authorize the app on their ad account.
export function buildAuthorizeUrl(
  appId: string,
  redirectUri: string,
  state = "tk"
): string {
  const qs = new URLSearchParams({
    app_id: appId,
    state,
    redirect_uri: redirectUri,
  });
  return `${AUTH_PORTAL}?${qs.toString()}`;
}

interface AccessTokenData {
  access_token: string;
  scope: unknown;
  advertiser_ids: string[];
}

// Exchanges the one-time auth_code (from the redirect) for a long-lived
// access token plus the list of advertiser ids the token can manage.
export async function exchangeAuthCode(
  s: Settings,
  authCode: string
): Promise<AccessTokenData> {
  if (!s.appId || !s.appSecret) {
    throw new TikTokApiError("Missing App ID or App Secret", -1);
  }
  const base = s.apiBase.replace(/\/$/, "");
  const res = await fetch(`${base}/oauth2/access_token/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      app_id: s.appId,
      secret: s.appSecret,
      auth_code: authCode,
    }),
  });
  const json = (await res.json()) as TikTokResponse<AccessTokenData>;
  if (json.code !== 0) {
    throw new TikTokApiError(
      json.message || "Failed to exchange auth code",
      json.code,
      json.request_id
    );
  }
  return json.data;
}

// Lists advertiser accounts (with names) that the access token can manage.
export async function getAuthorizedAdvertisers(
  s: Settings,
  accessToken: string
): Promise<Array<{ advertiser_id: string; advertiser_name: string }>> {
  const base = s.apiBase.replace(/\/$/, "");
  const qs = new URLSearchParams({
    app_id: s.appId,
    secret: s.appSecret,
    access_token: accessToken,
  });
  const res = await fetch(`${base}/oauth2/advertiser/get/?${qs.toString()}`, {
    headers: { "Access-Token": accessToken },
  });
  const json = (await res.json()) as TikTokResponse<{
    list: Array<{ advertiser_id: string; advertiser_name: string }>;
  }>;
  if (json.code !== 0) return [];
  return json.data.list ?? [];
}
