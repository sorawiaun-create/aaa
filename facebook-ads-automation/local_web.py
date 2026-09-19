#!/usr/bin/env python3
"""รันบนเครื่อง: เปิดหน้าโคม (เว็บในเครื่อง) + รัน engine จัดการแอดทุก N นาที.

- เสิร์ฟหน้าเว็บ dashboard_local.html ที่ http://127.0.0.1:8765
- อ่านไฟล์สถานะ (status/board/activity/...) ให้หน้าเว็บผ่าน /api/get
- บันทึกกฎ (config.json) และคิวคำสั่ง (commands.json) ผ่าน /api/config, /api/commands
- สั่งรันเดี๋ยวนี้ผ่าน /api/run
- รัน engine (main.py) วนอัตโนมัติทุก INTERVAL_MINS นาทีเป็นเบื้องหลัง

ใช้เฉพาะไลบรารีมาตรฐานของ Python (ไม่ต้องติดตั้งเพิ่ม)
"""
import http.server
import json
import os
import socketserver
import subprocess
import sys
import threading
import time
import urllib.parse
import webbrowser

HERE = os.path.dirname(os.path.abspath(__file__))
os.chdir(HERE)

PORT = int(os.environ.get("PORT", "8765"))
INTERVAL_MINS = int(os.environ.get("INTERVAL_MINS", "10"))

# ชื่อที่หน้าเว็บเรียก -> ไฟล์จริงในเครื่อง
FILES = {
    "config": "config.json",
    "status": "status.json",
    "activity": "activity.json",
    "board": "board.json",
    "evaluations": "evaluations.json",
    "analysis": "analysis.json",
    "commands": "commands.json",
}

_run_lock = threading.Lock()


def run_engine_once(force=True):
    """รัน main.py 1 รอบ (กันรันซ้อนด้วย lock). คืน True ถ้าได้รัน, False ถ้ากำลังรันอยู่แล้ว."""
    if not _run_lock.acquire(blocking=False):
        return False
    try:
        env = dict(os.environ)
        if force:
            env["RUN_FORCE"] = "1"
        subprocess.run([sys.executable, "main.py"], env=env, cwd=HERE)
        return True
    except Exception as e:  # noqa: BLE001
        print("engine error:", e)
        return False
    finally:
        _run_lock.release()


def engine_loop():
    """วนรัน engine ทุก INTERVAL_MINS นาที."""
    time.sleep(2)  # ให้เว็บขึ้นก่อน
    while True:
        run_engine_once(force=True)
        time.sleep(max(60, INTERVAL_MINS * 60))


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):  # ปิด log รก ๆ
        pass

    def _send(self, code, body=b"", ctype="application/json; charset=utf-8"):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if body:
            self.wfile.write(body)

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        if u.path in ("/", "/index.html"):
            try:
                with open(os.path.join(HERE, "dashboard_local.html"), "rb") as f:
                    self._send(200, f.read(), "text/html; charset=utf-8")
            except OSError:
                self._send(404, "ไม่พบ dashboard_local.html")
            return
        if u.path == "/api/get":
            q = urllib.parse.parse_qs(u.query)
            name = (q.get("name") or [""])[0]
            fn = FILES.get(name)
            if not fn:
                self._send(404, "")
                return
            p = os.path.join(HERE, fn)
            if not os.path.exists(p):
                self._send(404, "")
                return
            try:
                with open(p, "rb") as f:
                    self._send(200, f.read())
            except OSError as e:
                self._send(500, json.dumps({"error": str(e)}))
            return
        self._send(404, "")

    def do_POST(self):
        u = urllib.parse.urlparse(self.path)
        ln = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(ln) if ln else b""

        if u.path in ("/api/config", "/api/commands"):
            fn = "config.json" if u.path == "/api/config" else "commands.json"
            try:
                json.loads(raw.decode("utf-8"))  # ตรวจว่าเป็น JSON ถูกต้องก่อนเขียนทับ
                tmp = os.path.join(HERE, fn + ".tmp")
                with open(tmp, "wb") as f:
                    f.write(raw)
                os.replace(tmp, os.path.join(HERE, fn))
                self._send(200, '{"ok":true}')
            except Exception as e:  # noqa: BLE001
                self._send(400, json.dumps({"error": str(e)}))
            return

        if u.path == "/api/run":
            started = run_engine_once(force=True)
            self._send(200, json.dumps({"ok": True, "started": started}))
            return

        self._send(404, "")


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def main():
    threading.Thread(target=engine_loop, daemon=True).start()
    url = f"http://127.0.0.1:{PORT}/"
    try:
        httpd = Server(("127.0.0.1", PORT), Handler)
    except OSError as e:
        print(f"เปิดพอร์ต {PORT} ไม่ได้ ({e}) — อาจเปิดโปรแกรมนี้ค้างอยู่แล้ว")
        print("ลองเปิดเบราว์เซอร์ไปที่:", url)
        input("กด Enter เพื่อปิด...")
        return
    print("=" * 50)
    print("  หน้าโคมพร้อมแล้ว! เปิดที่:", url)
    print("  ปล่อยหน้าต่างนี้เปิดไว้ · ปิด = ระบบหยุด")
    print("=" * 50)
    try:
        webbrowser.open(url)
    except Exception:  # noqa: BLE001
        pass
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("หยุดแล้ว")


if __name__ == "__main__":
    main()
