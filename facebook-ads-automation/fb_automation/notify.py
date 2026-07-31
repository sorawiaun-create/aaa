"""แจ้งเตือนเข้า LINE เมื่อระบบมีปัญหา (error) — ผ่าน LINE Messaging API.

เปิดใช้งานโดยตั้ง secret:
  LINE_TOKEN  = Channel access token ของ LINE Official Account (Messaging API)
  LINE_TO     = (ไม่บังคับ) userId ปลายทาง ถ้าไม่ใส่จะใช้ broadcast (ส่งถึงเพื่อนของบอททุกคน)

ถ้าไม่ตั้ง LINE_TOKEN ระบบจะข้ามการแจ้งเตือนเงียบ ๆ (ไม่พัง).
มีการหน่วง (throttle) ไม่ให้สแปม: แจ้งซ้ำได้ไม่เกิน 1 ครั้งต่อ N นาที.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

log = logging.getLogger("fb_automation")

_PUSH_URL = "https://api.line.me/v2/bot/message/push"
_BROADCAST_URL = "https://api.line.me/v2/bot/message/broadcast"
NOTIFY_KEY = "__line_notify__"


def build_error_message(now: datetime, errors: list[dict[str, Any]]) -> str:
    """ประกอบข้อความแจ้งเตือนภาษาไทยจากรายการ error."""
    lines = [f"⚠️ Facebook Ads Automation พบปัญหา {len(errors)} รายการ",
             f"เวลา {now.strftime('%d/%m %H:%M')}", ""]
    for e in errors[:10]:
        who = e.get("account", "") or "-"
        detail = e.get("detail", "")
        err = e.get("error")
        line = f"• {who}: {detail}"
        if err:
            line += f" ({str(err)[:80]})"
        lines.append(line)
    if len(errors) > 10:
        lines.append(f"…และอีก {len(errors) - 10} รายการ")
    return "\n".join(lines)


def send_line(message: str, *, token: str, to: str | None = None, timeout: int = 10) -> bool:
    """ส่งข้อความเข้า LINE. คืน True ถ้าสำเร็จ."""
    if not token:
        return False
    try:
        import requests  # facebook_business ติดตั้ง requests มาให้อยู่แล้ว
    except ImportError:
        log.warning("ไม่มีไลบรารี requests — ข้ามการแจ้งเตือน LINE")
        return False

    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    payload: dict[str, Any] = {"messages": [{"type": "text", "text": message[:4900]}]}
    url = _BROADCAST_URL
    if to:
        url = _PUSH_URL
        payload["to"] = to
    try:
        r = requests.post(url, headers=headers, json=payload, timeout=timeout)
        if r.status_code == 200:
            return True
        log.warning("ส่ง LINE ไม่สำเร็จ (HTTP %s): %s", r.status_code, r.text[:150])
        return False
    except Exception as e:  # noqa: BLE001
        log.warning("ส่ง LINE ผิดพลาด: %s", e)
        return False


def maybe_notify(events, now, state, *, token, to=None, throttle_mins=60.0) -> bool:
    """แจ้งเตือนถ้ามี error และตั้ง LINE_TOKEN ไว้ (มีหน่วงกันสแปม)."""
    errors = [e for e in events if e.get("status") == "error"]
    if not errors or not token:
        return False
    if not state.can_apply(NOTIFY_KEY, throttle_mins, now):
        log.info("มี error แต่เพิ่งแจ้ง LINE ไปแล้ว (หน่วง %s นาที) — ข้าม", throttle_mins)
        return False
    ok = send_line(build_error_message(now, errors), token=token, to=to)
    if ok:
        state.mark_applied(NOTIFY_KEY, now)
        log.info("📱 แจ้งเตือน LINE แล้ว (%d error)", len(errors))
    return ok
