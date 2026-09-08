#!/usr/bin/env python3
"""สร้าง content-os/data.json จากข้อมูลจริง (Meta Ads + Instagram Graph API).

หน้า content-os/index.html จะอ่านไฟล์นี้ถ้าเปิดผ่าน http(s) และมีไฟล์อยู่จริง
ถ้าไม่มี (หรือเปิดด้วย file://) หน้าเว็บจะใช้ข้อมูลตัวอย่างที่ฝังไว้แทน

ตัวแปรสภาพแวดล้อม
-----------------
FB_ACCESS_TOKEN     token ของ Meta (System User token แนะนำ) — ใช้ร่วมกันทั้ง Ads และ IG
FB_AD_ACCOUNT_ID    เลขบัญชีโฆษณา เช่น 1234567890 หรือ act_1234567890  [ถ้าไม่ใส่ = ข้ามหน้า ADS]
IG_USER_ID          Instagram Business/Creator account id             [ถ้าไม่ใส่ = ข้าม ANALYTICS]
GRAPH_API_VERSION   ค่าเริ่มต้น v21.0
OUT_PATH            ค่าเริ่มต้น <repo>/content-os/data.json

ส่วนไหนที่ไม่มี credential หรือดึงไม่สำเร็จ จะถูกข้าม (ไม่เขียนลงไฟล์)
แล้วหน้าเว็บจะใช้ข้อมูลตัวอย่างของส่วนนั้นต่อไป พร้อมขึ้นเตือนใน meta.warnings
"""
from __future__ import annotations

import json
import logging
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import requests

log = logging.getLogger("content-os")

TZ = timezone(timedelta(hours=7))  # เวลาไทย
GRAPH = "https://graph.facebook.com"
MODEL_DEFAULT = "claude-opus-5"
TIMEOUT = 30

# action_type ที่นับว่าเป็น "ลูกค้า 1 ราย"
CUSTOMER_ACTIONS = (
    "purchase",
    "offsite_conversion.fb_pixel_purchase",
    "onsite_conversion.purchase",
    "lead",
    "onsite_conversion.lead_grouped",
)
REVENUE_ACTIONS = (
    "purchase",
    "offsite_conversion.fb_pixel_purchase",
    "onsite_conversion.purchase",
)


# --------------------------------------------------------------------------
# ฟอร์แมตตัวเลขให้พร้อมแสดงผล (หน้าเว็บไม่ต้องคำนวณอะไรเลย)
# --------------------------------------------------------------------------
def compact(n: float) -> str:
    """287400 -> '287.4K'"""
    n = float(n or 0)
    for limit, suffix in ((1_000_000_000, "B"), (1_000_000, "M"), (1_000, "K")):
        if abs(n) >= limit:
            return f"{n / limit:.1f}".rstrip("0").rstrip(".") + suffix
    return f"{n:,.0f}"


def baht(n: float) -> str:
    return "฿" + f"{float(n or 0):,.0f}"


def pct_delta(now: float, before: float) -> tuple[str, str]:
    """คืน ('+162%', 'up') — ถ้าเทียบไม่ได้คืน ('', 'up')"""
    if not before:
        return ("", "up")
    change = (now - before) / before * 100
    sign = "+" if change >= 0 else "−"
    return (f"{sign}{abs(change):.0f}%", "up" if change >= 0 else "down")


def to_float(v: Any, default: float = 0.0) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def sum_actions(actions: list[dict] | None, wanted: tuple[str, ...]) -> float:
    """รวมค่า action ตาม action_type — ใช้ตัวแรกที่เจอตามลำดับ wanted เพื่อกันนับซ้ำ"""
    if not actions:
        return 0.0
    by_type = {a.get("action_type"): to_float(a.get("value")) for a in actions}
    for t in wanted:
        if t in by_type:
            return by_type[t]
    return 0.0


# --------------------------------------------------------------------------
# Graph API
# --------------------------------------------------------------------------
class Graph:
    def __init__(self, token: str, version: str):
        self.token = token
        self.base = f"{GRAPH}/{version}"
        self.session = requests.Session()

    def get(self, path: str, **params: Any) -> dict:
        params["access_token"] = self.token
        r = self.session.get(f"{self.base}/{path.lstrip('/')}", params=params, timeout=TIMEOUT)
        if not r.ok:
            # ข้อความ error ของ Graph API อ่านง่ายกว่า status code เปล่า ๆ
            try:
                detail = r.json()["error"]["message"]
            except Exception:  # noqa: BLE001
                detail = r.text[:200]
            raise RuntimeError(f"{path}: HTTP {r.status_code} — {detail}")
        return r.json()

    def get_all(self, path: str, **params: Any) -> list[dict]:
        """ตาม paging ไปจนหมด (จำกัดที่ 20 หน้า กันวนไม่จบ)"""
        out: list[dict] = []
        page = self.get(path, **params)
        for _ in range(20):
            out.extend(page.get("data", []))
            nxt = (page.get("paging") or {}).get("next")
            if not nxt:
                break
            r = self.session.get(nxt, timeout=TIMEOUT)
            if not r.ok:
                break
            page = r.json()
        return out


# --------------------------------------------------------------------------
# หน้า ADS · FB/IG
# --------------------------------------------------------------------------
def build_ads(g: Graph, account_id: str) -> dict:
    act = account_id if account_id.startswith("act_") else f"act_{account_id}"
    fields = "campaign_name,spend,actions,action_values"

    def fetch(preset: str) -> list[dict]:
        return g.get_all(
            f"{act}/insights",
            level="campaign",
            date_preset=preset,
            fields=fields,
            limit=200,
        )

    rows = fetch("last_7d")
    if not rows:
        raise RuntimeError("ไม่มีข้อมูล insights ใน 7 วันล่าสุด")

    prev_rows = []
    try:
        prev_rows = fetch("last_14d")  # ใช้หา 7 วันก่อนหน้าแบบคร่าว ๆ
    except RuntimeError as e:
        log.warning("  ดึงข้อมูลเทียบย้อนหลังไม่ได้: %s", e)

    campaigns = []
    total_spend = total_customers = total_revenue = 0.0
    for r in rows:
        spend = to_float(r.get("spend"))
        customers = sum_actions(r.get("actions"), CUSTOMER_ACTIONS)
        revenue = sum_actions(r.get("action_values"), REVENUE_ACTIONS)
        roas = revenue / spend if spend else 0.0
        total_spend += spend
        total_customers += customers
        total_revenue += revenue
        campaigns.append(
            {
                "name": r.get("campaign_name") or "(ไม่มีชื่อ)",
                "spend": baht(spend),
                "customers": f"{customers:,.0f}",
                "cpa": baht(spend / customers) if customers else "—",
                "roas": f"{roas:.1f}×" if spend else "—",
                "good": roas >= 3.0,
                "_spend": spend,
                "_roas": roas,
            }
        )
    campaigns.sort(key=lambda c: c["_spend"], reverse=True)

    # ตัวเลขรวมของ 14 วัน ลบ 7 วันล่าสุด = 7 วันก่อนหน้า (ไว้คิด %)
    prev_spend = sum(to_float(r.get("spend")) for r in prev_rows) - total_spend
    prev_customers = sum(sum_actions(r.get("actions"), CUSTOMER_ACTIONS) for r in prev_rows) - total_customers
    prev_revenue = sum(sum_actions(r.get("action_values"), REVENUE_ACTIONS) for r in prev_rows) - total_revenue

    total_roas = total_revenue / total_spend if total_spend else 0.0
    prev_roas = prev_revenue / prev_spend if prev_spend > 0 else 0.0
    spend_delta, spend_dir = pct_delta(total_spend, max(prev_spend, 0))
    cust_delta, cust_dir = pct_delta(total_customers, max(prev_customers, 0))
    roas_gap = total_roas - prev_roas
    roas_delta = f"{'+' if roas_gap >= 0 else '−'}{abs(roas_gap):.1f}×" if prev_roas else ""

    best = max(campaigns, key=lambda c: c["_roas"], default=None)
    worst = min((c for c in campaigns if c["_spend"] > 0), key=lambda c: c["_roas"], default=None)
    advice_parts = []
    if best and best["_roas"] >= 3.0:
        advice_parts.append(
            f'Campaign <b>"{best["name"]}"</b> ROAS {best["roas"]} — คุ้มที่สุด แนะนำเพิ่มงบ'
        )
    if worst and worst is not best and worst["_roas"] < 3.0:
        advice_parts.append(
            f'ส่วน <b>"{worst["name"]}"</b> ROAS {worst["roas"]} ต่ำกว่าเกณฑ์ 3.0× '
            f"ควรหยุดหรือปรับกลุ่มเป้าหมายใหม่ — ย้ายงบ {worst['spend']} ไปตัวแรกน่าจะคุ้มกว่า"
        )
    advice = " ".join(advice_parts) or "ยังไม่มีคำแนะนำสำหรับรอบนี้ — ตัวเลขทุก Campaign อยู่ในเกณฑ์"

    for c in campaigns:  # ตัด field ภายในออกก่อนเขียนไฟล์
        c.pop("_spend", None)
        c.pop("_roas", None)

    return {
        "kpis": [
            {"k": "งบที่ใช้ · 7D", "v": baht(total_spend), "delta": spend_delta, "dir": spend_dir, "color": "#a8752a"},
            {"k": "ลูกค้าใหม่ · 7D", "v": f"{total_customers:,.0f}", "delta": cust_delta, "dir": cust_dir},
            {"k": "ROAS รวม", "v": f"{total_roas:.1f}×", "delta": roas_delta, "dir": "up"},
        ],
        "note": "ดึงจาก Meta Ads Insights (7 วันล่าสุด) ทุกเช้า 6:00 น.",
        "campaigns": campaigns,
        "total": {
            "name": "รวมทั้งหมด",
            "spend": baht(total_spend),
            "customers": f"{total_customers:,.0f}",
            "cpa": baht(total_spend / total_customers) if total_customers else "—",
            "roas": f"{total_roas:.1f}×",
        },
        "advice": advice,
        "_revenue": total_revenue,
        "_customers": total_customers,
    }


# --------------------------------------------------------------------------
# หน้า ANALYTICS (Instagram)
# --------------------------------------------------------------------------
def _day_series(g: Graph, ig_id: str, metric: str, since: datetime, until: datetime) -> list[float]:
    """ค่ารายวันของ metric หนึ่งตัว — คืน [] ถ้า metric นั้นใช้ไม่ได้กับบัญชีนี้"""
    try:
        data = g.get(
            f"{ig_id}/insights",
            metric=metric,
            period="day",
            since=int(since.timestamp()),
            until=int(until.timestamp()),
        ).get("data", [])
    except RuntimeError as e:
        log.warning("  metric %s ใช้ไม่ได้: %s", metric, e)
        return []
    if not data:
        return []
    return [to_float(v.get("value")) for v in data[0].get("values", [])]


def build_analytics(g: Graph, ig_id: str) -> dict:
    now = datetime.now(TZ)
    since = now - timedelta(days=15)

    # IG เปลี่ยนชื่อ metric ตามเวอร์ชัน — ลองไล่จากชื่อใหม่ไปเก่า
    def series(*names: str) -> list[float]:
        for n in names:
            s = _day_series(g, ig_id, n, since, now)
            if s:
                return s
        return []

    views = series("views", "impressions")
    reach = series("reach")
    profile = series("profile_views")

    def split(s: list[float]) -> tuple[float, float, list[float]]:
        """คืน (ผลรวม 7 วันล่าสุด, ผลรวม 7 วันก่อนหน้า, ชุดตัวเลขไว้วาดกราฟ)"""
        last7, prev7 = s[-7:], s[-14:-7]
        return (sum(last7), sum(prev7), last7 or s)

    kpis = []
    for label, s in (("Views · 7D", views), ("Reach · 7D", reach), ("เข้าชม Profile", profile)):
        if not s:
            continue
        cur, prev, spark = split(s)
        delta, direction = pct_delta(cur, prev)
        kpis.append({"k": label, "v": compact(cur), "delta": delta, "dir": direction, "spark": spark})

    if not kpis:
        raise RuntimeError("ดึง insights ของ Instagram ไม่ได้เลย (ตรวจสิทธิ์ instagram_manage_insights)")

    # โพสต์เด่นใน 7 วันล่าสุด
    top: list[dict] = []
    try:
        cutoff = now - timedelta(days=7)
        media = g.get_all(
            f"{ig_id}/media",
            fields="caption,timestamp,media_type,insights.metric(views,reach)",
            limit=50,
        )
        scored = []
        for m in media:
            ts = m.get("timestamp")
            when = datetime.fromisoformat(ts.replace("+0000", "+00:00")) if ts else None
            if not when or when < cutoff:
                continue
            vals = {i["name"]: to_float((i.get("values") or [{}])[0].get("value")) for i in
                    (m.get("insights") or {}).get("data", [])}
            score = vals.get("views") or vals.get("reach") or 0
            caption = (m.get("caption") or "(ไม่มีแคปชัน)").split("\n")[0][:70]
            scored.append((score, caption, m.get("media_type") or ""))
        scored.sort(reverse=True, key=lambda x: x[0])
        top = [
            {"title": f'"{c}"', "note": f"{compact(s)} วิว · {t}"}
            for s, c, t in scored[:5]
        ]
    except RuntimeError as e:
        log.warning("  ดึงโพสต์เด่นไม่ได้: %s", e)

    return {
        "kpis": kpis,
        "topNote": "ดึงจาก Instagram Insights (7 วันล่าสุด) — เรียงตามยอดวิว",
        "top": top,
        "weak": [],
        "_views7d": sum(views[-7:]) if views else 0,
        "_viewsPrev": sum(views[-14:-7]) if views else 0,
        "_spark": views[-7:] if views else [],
    }


def build_profile(g: Graph, ig_id: str) -> dict:
    """ชื่อบัญชี ผู้ติดตาม bio และแคปชันล่าสุด

    bio กับแคปชันไม่ได้เอาไปโชว์บนหน้าเว็บ แต่ส่งให้ Claude อ่านเพื่อเดาเองว่า
    ธุรกิจนี้ทำอะไร ลูกค้าเป็นใคร โทนแบบไหน — เจ้าของไม่ต้องมากรอกเอง
    """
    d = g.get(ig_id, fields="username,followers_count,biography")
    captions: list[str] = []
    try:
        for m in g.get_all(f"{ig_id}/media", fields="caption", limit=12)[:12]:
            first_line = (m.get("caption") or "").split("\n")[0].strip()
            if first_line:
                captions.append(first_line[:120])
    except RuntimeError as e:
        log.warning("  อ่านแคปชันล่าสุดไม่ได้: %s", e)
    return {
        "brand": "@" + d["username"] if d.get("username") else "",
        "followers": compact(d.get("followers_count", 0)),
        "biography": d.get("biography", ""),
        "captions": captions,
    }


# --------------------------------------------------------------------------
# หน้า ภาพรวม — ประกอบจากส่วนที่ดึงมาได้จริงเท่านั้น
# --------------------------------------------------------------------------
def build_overview(analytics: dict | None, ads: dict | None) -> dict:
    kpis, summary = [], []

    if analytics:
        delta, direction = pct_delta(analytics["_views7d"], analytics["_viewsPrev"])
        kpis.append({
            "k": "ยอดวิว · 7D", "v": compact(analytics["_views7d"]),
            "delta": delta, "dir": direction, "spark": analytics["_spark"],
        })
        if analytics.get("top"):
            best = analytics["top"][0]
            summary.append(f'โพสต์ที่แรงที่สุดสัปดาห์นี้คือ <b>{best["title"]}</b> ({best["note"]}) — ควรทำภาคต่อภายใน 48 ชม.')

    if ads:
        kpis.append({"k": "รายได้จากโฆษณา · 7D", "v": baht(ads["_revenue"])})
        kpis.append({"k": "ลูกค้าใหม่ · 7D", "v": f'{ads["_customers"]:,.0f}'})
        summary.append(ads["advice"])

    if not summary:
        summary.append("ยังไม่มีข้อมูลพอจะสรุป — ตรวจการเชื่อมต่อใน scripts/build_data.py")

    return {
        "kpis": kpis,
        "summary": summary,
        "todo": [
            {"title": "ตรวจรายงานเช้านี้", "note": "ตัวเลขอัปเดตอัตโนมัติทุกวัน 6:00 น.",
             "cta": "ดู ANALYTICS", "go": "analytics"},
            {"title": "ดูว่า Campaign ไหนควรหยุด", "note": "เรียงตามงบที่ใช้",
             "cta": "ดูตัวเลข", "go": "ads"},
        ],
    }


# --------------------------------------------------------------------------
def main() -> int:
    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(message)s")

    token = os.getenv("FB_ACCESS_TOKEN", "").strip()
    ad_account = os.getenv("FB_AD_ACCOUNT_ID", "").strip()
    ig_id = os.getenv("IG_USER_ID", "").strip()
    version = os.getenv("GRAPH_API_VERSION", "v21.0").strip()
    out = Path(os.getenv("OUT_PATH") or Path(__file__).resolve().parents[1] / "data.json")

    if not token:
        log.error("ไม่พบ FB_ACCESS_TOKEN — ข้ามการสร้าง data.json (หน้าเว็บจะใช้ข้อมูลตัวอย่างต่อไป)")
        return 0
    if not ad_account and not ig_id:
        log.error("ต้องตั้งอย่างน้อย FB_AD_ACCOUNT_ID หรือ IG_USER_ID อย่างใดอย่างหนึ่ง")
        return 0

    g = Graph(token, version)
    warnings: list[str] = []
    analytics = ads = None
    profile: dict = {}

    if ig_id:
        try:
            log.info("ดึง Instagram insights…")
            analytics = build_analytics(g, ig_id)
            profile = build_profile(g, ig_id)
        except Exception as e:  # noqa: BLE001
            log.warning("Instagram: %s", e)
            warnings.append("Instagram")
    else:
        warnings.append("Instagram")

    if ad_account:
        try:
            log.info("ดึง Meta Ads insights…")
            ads = build_ads(g, ad_account)
        except Exception as e:  # noqa: BLE001
            log.warning("Meta Ads: %s", e)
            warnings.append("Meta Ads")
    else:
        warnings.append("Meta Ads")

    if not analytics and not ads:
        log.error("ดึงข้อมูลไม่ได้เลย — ไม่เขียนไฟล์ หน้าเว็บจะใช้ข้อมูลตัวอย่างต่อไป")
        return 1

    now = datetime.now(TZ)
    data: dict[str, Any] = {
        "meta": {
            "source": "live",
            "brand": profile.get("brand") or "Content OS",
            "followers": profile.get("followers", ""),
            "window": "7D",
            "updatedLabel": now.strftime("%d/%m/%Y %H:%M น."),
            "footer": "CONTENT OS\nข้อมูลจริง · อัปเดตทุก 6:00 น.",
            "warnings": warnings,   # ยังเติมได้อีกในขั้น AI ข้างล่าง (เป็น list เดียวกัน)
        },
        "overview": build_overview(analytics, ads),
    }
    if analytics:
        for k in ("_views7d", "_viewsPrev", "_spark"):
            analytics.pop(k, None)
        data["analytics"] = analytics
    if ads:
        for k in ("_revenue", "_customers"):
            ads.pop(k, None)
        data["ads"] = ads

    # ---- ให้ Claude คิดคอนเทนต์ต่อจากตัวเลขจริง ----
    if os.getenv("ANTHROPIC_API_KEY", "").strip():
        try:
            from brain import Brain, to_sections

            brain = Brain(os.getenv("CONTENT_OS_MODEL") or MODEL_DEFAULT)
            log.info("ให้ Claude ค้นเว็บหาเทรนด์และคู่แข่ง…")
            research = brain.research(profile)
            log.info("ให้ Claude วางแผนคอนเทนต์…")
            plan = brain.plan(profile, {"analytics": analytics, "ads": ads}, research, now.date())

            data.update(to_sections(plan, now.date()))
            if plan.get("summary"):
                data["overview"]["summary"] = plan["summary"]
            if plan.get("todo"):
                data["overview"]["todo"] = plan["todo"]
            if analytics is not None and plan.get("weak"):
                data["analytics"]["weak"] = plan["weak"]
            if ads is not None and plan.get("adsAdvice"):
                data["ads"]["advice"] = plan["adsAdvice"]
            data["meta"]["plannedBy"] = "Claude"
            log.info("Claude วางแผนให้แล้ว: %s", plan.get("profile", {}).get("niche", ""))
        except Exception as e:  # noqa: BLE001
            # ตัวเลขจริงยังใช้ได้ แค่ส่วนที่ AI คิดจะกลับไปใช้ข้อมูลตัวอย่าง
            log.warning("Claude วางแผนไม่สำเร็จ: %s", e)
            warnings.append("แผนคอนเทนต์จาก AI")
    else:
        log.info("ไม่พบ ANTHROPIC_API_KEY — ข้ามขั้นให้ AI คิดคอนเทนต์")
        warnings.append("แผนคอนเทนต์จาก AI")

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    log.info("เขียน %s เรียบร้อย (%s)", out, ", ".join(k for k in data if k != "meta") or "ไม่มีส่วนไหนเลย")
    return 0


if __name__ == "__main__":
    sys.exit(main())
