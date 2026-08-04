"""อัปโหลดรูปขึ้นเว็บฝากรูปฟรี เพื่อเอาลิงก์ (URL) ไปแนบใน LINE

LINE ส่งรูปได้ต้องเป็นลิงก์ https ส่งไฟล์ดิบตรงๆ ไม่ได้ จึงต้องอัปขึ้นเว็บก่อน
ลองหลายเว็บให้ (ฟรี ไม่ต้องสมัคร) ถ้าเว็บแรกล่ม/โดนบล็อกก็ใช้เว็บถัดไป

หมายเหตุความเป็นส่วนตัว: รูปจะถูกอัปขึ้นเว็บสาธารณะ (ลิงก์เดารหัสยากแต่เป็น public)
ถ้าไม่อยากให้อัป ตั้ง "attach_screenshot": false ใน config.json
"""

import requests

# เลียนแบบ browser เพื่อกันบางเว็บบล็อก user-agent ของ python
_UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) PuzzleAlert"}


def _to_catbox(path):
    with open(path, "rb") as f:
        resp = requests.post(
            "https://catbox.moe/user/api.php",
            data={"reqtype": "fileupload"},
            files={"fileToUpload": f},
            headers=_UA,
            timeout=30,
        )
    url = resp.text.strip()
    if resp.status_code == 200 and url.startswith("http"):
        return url
    raise RuntimeError(f"catbox: HTTP {resp.status_code} {url[:120]}")


def _to_0x0(path):
    with open(path, "rb") as f:
        resp = requests.post(
            "https://0x0.st",
            files={"file": f},
            headers=_UA,
            timeout=30,
        )
    url = resp.text.strip()
    if resp.status_code == 200 and url.startswith("http"):
        return url
    raise RuntimeError(f"0x0.st: HTTP {resp.status_code} {url[:120]}")


def upload_image(path):
    """อัปโหลดไฟล์รูป คืนค่า URL (https) หรือโยน error ถ้าทุกเว็บล้มเหลว"""
    errors = []
    for uploader in (_to_catbox, _to_0x0):
        try:
            url = uploader(path)
            return url.replace("http://", "https://", 1)  # LINE ต้องการ https
        except Exception as e:
            errors.append(str(e))
    raise RuntimeError("อัปโหลดรูปไม่สำเร็จทุกเว็บ: " + " | ".join(errors))
