"""ห่อ facebook_business SDK ให้เรียกใช้ง่ายและแยก network ออกจาก logic.

รองรับหลาย access token (สร้าง api object แยกต่อบัญชี).
"""
from __future__ import annotations

import logging
from typing import Any

from facebook_business.adobjects.adaccount import AdAccount
from facebook_business.adobjects.adset import AdSet
from facebook_business.adobjects.campaign import Campaign
from facebook_business.api import FacebookAdsApi
from facebook_business.session import FacebookSession

from .metrics import INSIGHTS_FIELDS

log = logging.getLogger("fb_automation")

# ตัวคูณหน่วยเงินย่อย (minor units) ของแต่ละสกุล — ส่วนใหญ่ = 100
# ดูเพิ่ม: https://developers.facebook.com/docs/marketing-api/currencies
CURRENCY_OFFSETS: dict[str, int] = {
    "THB": 100, "USD": 100, "EUR": 100, "GBP": 100, "SGD": 100,
    "MYR": 100, "AUD": 100, "PHP": 100, "IDR": 1, "VND": 1,
    "JPY": 1, "KRW": 1, "TWD": 100, "CNY": 100, "INR": 100,
}
DEFAULT_CURRENCY_OFFSET = 100


class FacebookClient:
    """ตัวเชื่อม Facebook Ads API สำหรับ 1 บัญชี (1 token)."""

    def __init__(self, account_id: str, token: str):
        self.account_id = account_id.replace("act_", "")
        self.act_id = f"act_{self.account_id}"
        self._api = FacebookAdsApi(FacebookSession(access_token=token))
        self._account = AdAccount(self.act_id, api=self._api)
        self._currency_offset: int | None = None

    # ---- เงิน / สกุลเงิน ------------------------------------------------
    @property
    def currency_offset(self) -> int:
        """ตัวคูณแปลงบาท -> หน่วยที่ API ใช้ (บาท x offset)."""
        if self._currency_offset is None:
            try:
                data = self._account.api_get(fields=["currency"])
                currency = (data.get("currency") or "").upper()
                self._currency_offset = CURRENCY_OFFSETS.get(currency, DEFAULT_CURRENCY_OFFSET)
                log.info("  สกุลเงินบัญชี = %s (offset %s)", currency or "?", self._currency_offset)
            except Exception as e:  # noqa: BLE001
                log.warning("  อ่านสกุลเงินไม่ได้ (%s) ใช้ค่าเริ่มต้น offset %s", e, DEFAULT_CURRENCY_OFFSET)
                self._currency_offset = DEFAULT_CURRENCY_OFFSET
        return self._currency_offset

    def to_minor(self, major_amount: float) -> int:
        return int(round(major_amount * self.currency_offset))

    def to_major(self, minor_amount: Any) -> float:
        try:
            return float(minor_amount) / self.currency_offset
        except (TypeError, ValueError):
            return 0.0

    # ---- ดึงข้อมูล -----------------------------------------------------
    def get_campaigns(self) -> list[dict[str, Any]]:
        """คืน list แคมเปญ (เฉพาะ ACTIVE/PAUSED) พร้อม field ที่จำเป็น."""
        fields = [
            "id", "name", "status", "effective_status",
            "daily_budget", "lifetime_budget",
        ]
        params = {
            "effective_status": ["ACTIVE", "PAUSED"],
            "limit": 500,
        }
        return [dict(c) for c in self._account.get_campaigns(fields=fields, params=params)]

    def get_insights_by_campaign(self) -> dict[str, dict[str, Any]]:
        """ดึง insight ของ "วันนี้" ระดับแคมเปญ คืน map campaign_id -> row."""
        params = {"level": "campaign", "date_preset": "today", "limit": 500}
        result: dict[str, dict[str, Any]] = {}
        for row in self._account.get_insights(fields=INSIGHTS_FIELDS, params=params):
            d = dict(row)
            cid = d.get("campaign_id")
            if cid:
                result[cid] = d
        return result

    def get_account_totals(self, date_preset: str) -> dict[str, Any]:
        """ดึง insight รวมทั้งบัญชีของช่วงเวลาหนึ่ง (today/yesterday/last_7d/last_30d ...)."""
        fields = ["spend", "actions", "purchase_roas", "action_values"]
        params = {"date_preset": date_preset, "level": "account", "limit": 1}
        rows = list(self._account.get_insights(fields=fields, params=params))
        return dict(rows[0]) if rows else {}

    def get_campaign_adsets(self, campaign_id: str) -> list[dict[str, Any]]:
        fields = ["id", "name", "status", "effective_status", "daily_budget", "lifetime_budget"]
        camp = Campaign(campaign_id, api=self._api)
        return [dict(a) for a in camp.get_ad_sets(fields=fields, params={"limit": 200})]

    def get_campaign_effective_status(self, campaign_id: str) -> str:
        """อ่านสถานะการยิงจริง (effective_status) ของแคมเปญ — ใช้ยืนยันหลังสั่งเปิด/ปิด."""
        try:
            data = Campaign(campaign_id, api=self._api).api_get(fields=["effective_status"])
            return (data.get("effective_status") or "").upper()
        except Exception:  # noqa: BLE001
            return ""

    # ---- สั่งเปลี่ยนแปลง ------------------------------------------------
    def update_campaign_status(self, campaign_id: str, status: str) -> None:
        Campaign(campaign_id, api=self._api).api_update(params={"status": status})

    def update_adset_status(self, adset_id: str, status: str) -> None:
        AdSet(adset_id, api=self._api).api_update(params={"status": status})

    def update_campaign_daily_budget(self, campaign_id: str, minor_amount: int) -> None:
        Campaign(campaign_id, api=self._api).api_update(params={"daily_budget": minor_amount})

    def update_adset_daily_budget(self, adset_id: str, minor_amount: int) -> None:
        AdSet(adset_id, api=self._api).api_update(params={"daily_budget": minor_amount})
