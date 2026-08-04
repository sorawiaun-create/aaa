"""เล่นเสียงเตือนในเครื่อง (รองรับ Windows เป็นหลัก + fallback อื่นๆ)"""

import os
import sys


def play_alert():
    # Windows: TikTok Live Studio ส่วนใหญ่ใช้ Windows
    try:
        import winsound

        winsound.Beep(880, 350)
        winsound.Beep(1175, 350)
        winsound.Beep(1568, 450)
        return
    except Exception:
        pass

    # macOS
    if sys.platform == "darwin":
        if os.system("afplay /System/Library/Sounds/Glass.aiff >/dev/null 2>&1") == 0:
            return

    # Linux (ถ้ามี paplay/aplay)
    for cmd in (
        "paplay /usr/share/sounds/freedesktop/stereo/complete.oga",
        "aplay -q /usr/share/sounds/alsa/Front_Center.wav",
    ):
        if os.system(cmd + " >/dev/null 2>&1") == 0:
            return

    # สุดท้าย: bell ในเทอร์มินัล
    sys.stdout.write("\a")
    sys.stdout.flush()
