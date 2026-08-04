"""ส่งข้อความแจ้งเตือนผ่าน LINE Messaging API

ใช้ Channel access token จาก LINE Official Account (Messaging API)
- ถ้ากำหนด to_user_id -> ใช้ push (ส่งหาผู้ใช้คนนั้น)
- ถ้าไม่กำหนด -> ใช้ broadcast (ส่งหาทุกคนที่แอดบอทเป็นเพื่อน)
  เหมาะกับกรณีที่มีแค่ตัวเองแอดบอท ไม่ต้องหา userId ให้ยุ่งยาก
"""

import requests

API_PUSH = "https://api.line.me/v2/bot/message/push"
API_BROADCAST = "https://api.line.me/v2/bot/message/broadcast"


class LineClient:
    def __init__(self, channel_access_token, to_user_id=None):
        if not channel_access_token or channel_access_token.startswith("ใส่ "):
            raise ValueError(
                "ยังไม่ได้ตั้งค่า channel_access_token ใน config.json "
                "(ดูวิธีสร้างใน README.md)"
            )
        self.token = channel_access_token
        self.to = (to_user_id or "").strip() or None

    def send(self, text):
        headers = {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
        }
        # LINE จำกัดข้อความ text ที่ 5000 ตัวอักษร
        messages = [{"type": "text", "text": text[:4900]}]
        if self.to:
            url, body = API_PUSH, {"to": self.to, "messages": messages}
        else:
            url, body = API_BROADCAST, {"messages": messages}

        resp = requests.post(url, headers=headers, json=body, timeout=10)
        if resp.status_code != 200:
            raise RuntimeError(
                f"LINE ส่งไม่สำเร็จ (HTTP {resp.status_code}): {resp.text}"
            )
