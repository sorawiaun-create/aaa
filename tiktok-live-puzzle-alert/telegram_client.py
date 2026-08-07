"""ส่งแจ้งเตือนผ่าน Telegram Bot (เด้งเตือนชัวร์กว่า LINE และตั้งง่าย)

รองรับผู้รับหลายราย: ส่งไปได้หลาย chat id พร้อมกัน
- หลายคน: แต่ละคนทักบอท แล้วเพิ่ม chat id ของแต่ละคน
- ทั้งกลุ่ม: สร้างกลุ่ม เพิ่มบอทเข้ากลุ่ม ใช้ chat id ของกลุ่ม (ทุกคนในกลุ่มได้รับ)
"""

import requests


def _normalize_ids(chat_ids):
    if isinstance(chat_ids, (list, tuple)):
        raw = [str(c).strip() for c in chat_ids]
    else:
        raw = [str(chat_ids).strip()]
    seen = set()
    out = []
    for c in raw:
        if c and c not in seen:
            seen.add(c)
            out.append(c)
    return out


class TelegramClient:
    def __init__(self, bot_token, chat_ids):
        self.base = f"https://api.telegram.org/bot{bot_token}"
        self.chat_ids = _normalize_ids(chat_ids)

    def _broadcast(self, method, data, file_field=None, file_bytes=None):
        """ส่งไปทุก chat id — สำเร็จอย่างน้อย 1 ราย ถือว่าผ่าน"""
        if not self.chat_ids:
            raise RuntimeError("ยังไม่มีผู้รับ Telegram")
        errors = []
        ok = False
        for cid in self.chat_ids:
            body = dict(data, chat_id=cid)
            files = {file_field: ("shot.jpg", file_bytes)} if file_field else None
            try:
                r = requests.post(f"{self.base}/{method}", data=body, files=files, timeout=30)
                if r.ok:
                    ok = True
                else:
                    errors.append(f"{cid}: HTTP {r.status_code} {r.text[:80]}")
            except Exception as e:
                errors.append(f"{cid}: {e}")
        if not ok:
            raise RuntimeError("Telegram ส่งไม่สำเร็จทุกผู้รับ: " + " | ".join(errors))

    def send(self, text):
        self._broadcast("sendMessage", {"text": text})

    def send_photo(self, path, caption=""):
        with open(path, "rb") as f:
            data_bytes = f.read()
        self._broadcast("sendPhoto", {"caption": caption[:1000]},
                        file_field="photo", file_bytes=data_bytes)

    def notify(self, text, image_path=None, attach=True):
        if image_path and attach:
            self.send_photo(image_path, caption=text)
        else:
            self.send(text)


def autodetect_chat_id(bot_token):
    """หา chat id ล่าสุดจากอัปเดตของบอท (รองรับทั้งแชทเดี่ยว/กลุ่ม/ช่อง)"""
    r = requests.get(f"https://api.telegram.org/bot{bot_token}/getUpdates", timeout=15)
    data = r.json()
    if not data.get("ok"):
        raise RuntimeError(f"bot_token อาจไม่ถูกต้อง: {data}")
    keys = ("message", "edited_message", "channel_post", "my_chat_member", "chat_member")
    for upd in reversed(data.get("result", [])):
        for k in keys:
            obj = upd.get(k)
            if obj and obj.get("chat", {}).get("id") is not None:
                return str(obj["chat"]["id"])
    return None
