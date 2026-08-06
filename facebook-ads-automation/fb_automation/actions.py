"""ลงมือทำตามแผน (PlannedAction) กับแคมเปญจริง — หรือแค่แสดง log เมื่อ dry-run.

นอกจากทำงานแล้ว ยังบันทึก "เหตุการณ์" (events) ทุกครั้งที่มีการเปลี่ยนแปลง
เพื่อให้หน้า Dashboard โชว์ log ได้ว่ากฎไหนทำงาน ทำอะไร สำเร็จหรือพลาด.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime
from typing import TYPE_CHECKING, Any

from .rules import PlannedAction
from .state import State

if TYPE_CHECKING:  # ไม่ import SDK ตอน runtime -> เทส logic ได้โดยไม่ต้องติดตั้ง facebook_business
    from .fb_client import FacebookClient

log = logging.getLogger("fb_automation")

_EPS = 0.005  # ต่ำกว่านี้ถือว่างบเท่าเดิม


@dataclass
class RunSummary:
    status_changes: int = 0
    budget_changes: int = 0
    skipped_cooldown: int = 0
    errors: int = 0


def _th_status(s: str | None) -> str:
    return {"ACTIVE": "เปิด", "PAUSED": "ปิด"}.get((s or "").upper(), s or "?")


# แปล effective_status (สถานะการยิงจริง) เป็นภาษาไทย
_TH_EFFECTIVE = {
    "ACTIVE": "กำลังยิง",
    "PAUSED": "ปิดอยู่",
    "CAMPAIGN_PAUSED": "แคมเปญถูกปิด",
    "ADSET_PAUSED": "ชุดโฆษณา (ad set) ถูกปิดอยู่",
    "PENDING_REVIEW": "รอ Facebook ตรวจ",
    "IN_PROCESS": "กำลังดำเนินการ",
    "PENDING_BILLING_INFO": "รอข้อมูลการชำระเงิน",
    "PREAPPROVED": "อนุมัติเบื้องต้น รอเริ่ม",
    "DISAPPROVED": "โฆษณาไม่ผ่านการตรวจ",
    "WITH_ISSUES": "มีปัญหา (ตรวจในหน้า Facebook)",
    "ADSET_UNDER_REVIEW": "ชุดโฆษณากำลังถูกตรวจ",
}
# สถานะที่ถือว่า "กำลังจะยิง" (ยังไม่ต้องเตือนว่า error)
_DELIVERING_OK = {"ACTIVE", "PENDING_REVIEW", "IN_PROCESS", "PENDING_BILLING_INFO",
                  "PREAPPROVED", "ADSET_UNDER_REVIEW"}


def _th_effective(s: str | None) -> str:
    s = (s or "").upper()
    return _TH_EFFECTIVE.get(s, s or "ไม่ทราบ")


def activate_campaign_fully(client: FacebookClient, cid: str) -> dict[str, Any]:
    """เปิดแคมเปญ + เปิด ad set ข้างในที่ถูกปิดอยู่ แล้วยืนยันสถานะจริง.

    Facebook: การสั่งเปิดแค่ระดับแคมเปญ ถ้า ad set ข้างในยังถูกปิด แอดจะ "ไม่วิ่งจริง"
    (API คืนสำเร็จแต่ไม่ยิง) — จึงต้องเปิด ad set ด้วย แล้วอ่าน effective_status มายืนยัน.

    คืน dict: {effective, adsets_activated, adset_errors}
    """
    client.update_campaign_status(cid, "ACTIVE")
    activated = 0
    adset_errors: list[str] = []
    try:
        adsets = client.get_campaign_adsets(cid)
    except Exception as e:  # noqa: BLE001
        adsets = []
        adset_errors.append(str(e)[:120])
    for a in adsets:
        if (a.get("status") or "").upper() == "PAUSED":
            try:
                client.update_adset_status(a["id"], "ACTIVE")
                activated += 1
            except Exception as e:  # noqa: BLE001
                adset_errors.append(f"{a.get('name', 'ad set')}: {str(e)[:80]}")
    return {
        "effective": client.get_campaign_effective_status(cid),
        "adsets_activated": activated,
        "adset_errors": adset_errors,
    }


def _apply_budget_sequence(
    current_major: float,
    budget_actions: list[PlannedAction],
    *,
    state: State,
    now: datetime,
    account_id: str,
    unit_id: str,
    unit_label: str,
    summary: RunSummary,
) -> tuple[float | None, list[dict[str, str]]]:
    """คำนวณงบใหม่จากกฎงบทั้งหมด. คืน (งบใหม่หรือ None, รายการกฎที่ทำให้เปลี่ยน)."""
    working = current_major
    changed = False
    applied: list[dict[str, str]] = []

    for pa in budget_actions:
        key = pa.state_key(account_id, unit_id)
        if not state.can_apply(key, pa.frequency_mins, now):
            log.info("      ⏭️  %s: ยังไม่ถึงรอบ (ทุก %s นาที) — ข้าม", pa.rule_name, pa.frequency_mins)
            summary.skipped_cooldown += 1
            continue

        base = working if working > 0 else 0.0
        if pa.budget_op == "increase":
            new = base * (1 + (pa.percent or 0) / 100.0)
        elif pa.budget_op == "decrease":
            new = base * (1 - (pa.percent or 0) / 100.0)
        elif pa.budget_op == "reset":
            new = pa.reset_amount if pa.reset_amount is not None else base
        else:
            continue

        if pa.max_budget is not None and new > pa.max_budget:
            new = pa.max_budget
        if pa.min_budget is not None and new < pa.min_budget:
            new = pa.min_budget

        if abs(new - working) < _EPS:
            continue

        log.info("      💰 %s [%s]: %.2f -> %.2f บาท (กฎ: %s)",
                 unit_label, pa.action, working, new, pa.rule_name)
        working = new
        changed = True
        applied.append({"rule": pa.rule_name, "action": pa.action, "reason": pa.reason})
        state.mark_applied(key, now)

    return (working if changed else None), applied


def execute_campaign(
    client: FacebookClient,
    campaign: dict[str, Any],
    planned: list[PlannedAction],
    *,
    state: State,
    now: datetime,
    dry_run: bool,
    summary: RunSummary,
    account_name: str = "",
    events: list[dict[str, Any]] | None = None,
) -> None:
    """ประมวลผลแผนของแคมเปญเดียว แล้วสั่ง API (หรือ log ถ้า dry-run)."""
    cid = campaign["id"]
    cname = campaign.get("name", cid)
    account_id = client.account_id
    evs = events if events is not None else []

    if not planned:
        return

    log.info("  ▶ %s (%s)", cname, cid)

    def _event(rule, action, detail, ok, err=None, reason=""):
        evs.append({
            "account": account_name, "campaign": cname, "rule": rule,
            "action": action, "detail": detail, "reason": reason,
            "status": "error" if err else ("dry-run" if dry_run else "applied"),
            "error": err,
        })

    # ---- 1) สถานะ ----
    # PAUSE ชนะ ACTIVATE เสมอ (fail-safe กันเงินรั่ว): ถ้ามีกฎ "ปิด" เข้าเงื่อนไข
    # ให้ปิดก่อน แม้จะมีกฎ "เปิด" เข้าเงื่อนไขพร้อมกันและอยู่ล่างกว่า.
    status_actions = [p for p in planned if p.kind == "STATUS"]
    if status_actions:
        pauses = [p for p in status_actions if p.status == "PAUSED"]
        final = pauses[-1] if pauses else status_actions[-1]
        current = (campaign.get("status") or "").upper()
        if final.status != current:
            detail = f"{_th_status(current)} → {_th_status(final.status)}"
            log.info("      🔀 สถานะ: %s (กฎ: %s)", detail, final.rule_name)
            if dry_run:
                summary.status_changes += 1
                _event(final.rule_name, final.action, detail, ok=True, reason=final.reason)
            elif final.status == "ACTIVE":
                # เปิดแคมเปญ + เปิด ad set ข้างใน + ยืนยันสถานะจริง (แก้บั๊ก "log เปิดแต่ไม่วิ่ง")
                try:
                    res = activate_campaign_fully(client, cid)
                    summary.status_changes += 1
                    eff = res["effective"]
                    extra = f" · เปิด ad set {res['adsets_activated']} ชุด" if res["adsets_activated"] else ""
                    if eff in _DELIVERING_OK:
                        ok_detail = f"{detail}{extra} · สถานะจริง: {_th_effective(eff)}"
                        log.info("      ✅ เปิดสำเร็จ (%s)", eff or "?")
                        _event(final.rule_name, final.action, ok_detail, ok=True, reason=final.reason)
                    else:
                        # สั่งเปิดแล้วแต่ Facebook ยังไม่ปล่อยยิง — แจ้งความจริง + ถือเป็น error เพื่อเตือน
                        warn = (f"⚠️ สั่งเปิดแล้วแต่ยังไม่วิ่งจริง{extra} · "
                                f"สถานะจริง: {_th_effective(eff)} ({eff or '?'})")
                        if res["adset_errors"]:
                            warn += " · " + "; ".join(res["adset_errors"][:3])
                        log.warning("      ⚠️ เปิดแล้วแต่ยังไม่วิ่ง: %s", eff or "?")
                        summary.errors += 1
                        _event(final.rule_name, final.action, warn, ok=False,
                               err=f"effective_status={eff}", reason=final.reason)
                except Exception as e:  # noqa: BLE001
                    log.error("      ❌ เปิดไม่สำเร็จ: %s", e)
                    summary.errors += 1
                    _event(final.rule_name, final.action, detail, ok=False, err=str(e)[:200], reason=final.reason)
            else:
                try:
                    client.update_campaign_status(cid, final.status)
                    summary.status_changes += 1
                    _event(final.rule_name, final.action, detail, ok=True, reason=final.reason)
                except Exception as e:  # noqa: BLE001
                    log.error("      ❌ เปลี่ยนสถานะไม่สำเร็จ: %s", e)
                    summary.errors += 1
                    _event(final.rule_name, final.action, detail, ok=False, err=str(e)[:200], reason=final.reason)

    # ---- 2) งบประมาณ ----
    budget_actions = [p for p in planned if p.kind == "BUDGET"]
    if not budget_actions:
        return

    def _apply_budget(unit_id, unit_label, current_major, setter, disp):
        new_major, applied = _apply_budget_sequence(
            current_major, budget_actions,
            state=state, now=now, account_id=account_id,
            unit_id=unit_id, unit_label=unit_label, summary=summary,
        )
        if new_major is None:
            return
        rule = ", ".join(a["rule"] for a in applied)
        action = applied[-1]["action"] if applied else "BUDGET"
        reason = " · ".join(a["reason"] for a in applied if a.get("reason"))
        detail = f"{disp}งบ {current_major:.0f} → {new_major:.0f} บาท"
        if not dry_run:
            try:
                setter(client.to_minor(new_major))
                summary.budget_changes += 1
                _event(rule, action, detail, ok=True, reason=reason)
            except Exception as e:  # noqa: BLE001
                log.error("      ❌ ปรับงบไม่สำเร็จ: %s", e)
                summary.errors += 1
                _event(rule, action, detail, ok=False, err=str(e)[:200], reason=reason)
        else:
            summary.budget_changes += 1
            _event(rule, action, detail, ok=True, reason=reason)

    daily_budget_minor = campaign.get("daily_budget")
    if daily_budget_minor:
        _apply_budget(cid, "แคมเปญ", client.to_major(daily_budget_minor),
                      lambda m: client.update_campaign_daily_budget(cid, m), "")
    else:
        # ABO: งบอยู่ที่ ad set — ปรับทีละ set
        try:
            adsets = client.get_campaign_adsets(cid)
        except Exception as e:  # noqa: BLE001
            log.error("      ❌ ดึง ad set ไม่ได้: %s", e)
            summary.errors += 1
            _event("-", "BUDGET", "ดึง ad set ไม่ได้", ok=False, err=str(e)[:200])
            return

        adsets_with_budget = [a for a in adsets if a.get("daily_budget")]
        if not adsets_with_budget:
            log.info("      ⚠️  แคมเปญนี้ไม่มี daily_budget ทั้งระดับแคมเปญและ ad set — ข้ามการปรับงบ")
            return

        for adset in adsets_with_budget:
            aid = adset["id"]
            aname = adset.get("name", aid)
            _apply_budget(aid, f"ad set '{aname}'", client.to_major(adset["daily_budget"]),
                          lambda m, _id=aid: client.update_adset_daily_budget(_id, m),
                          f"[{aname}] ")
