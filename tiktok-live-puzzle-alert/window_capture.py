"""จับภาพเฉพาะหน้าต่าง (Windows) แม้หน้าต่างจะถูกบังหรือย่ออยู่ก็ตาม

ใช้ Windows API (PrintWindow + PW_RENDERFULLCONTENT) แบบเดียวกับ Window Capture ของ OBS
ทำให้ไม่ต้องเปิดหน้าต่าง TikTok Live Studio ค้างให้เห็นบนจอ — เอาอย่างอื่นมาทับได้

ใช้ได้เฉพาะ Windows เท่านั้น (import ctypes.windll)
"""

import ctypes
from ctypes import wintypes

import numpy as np

user32 = ctypes.windll.user32
gdi32 = ctypes.windll.gdi32

PW_RENDERFULLCONTENT = 0x00000002
BI_RGB = 0
DIB_RGB_COLORS = 0


class BITMAPINFOHEADER(ctypes.Structure):
    _fields_ = [
        ("biSize", wintypes.DWORD),
        ("biWidth", ctypes.c_long),
        ("biHeight", ctypes.c_long),
        ("biPlanes", wintypes.WORD),
        ("biBitCount", wintypes.WORD),
        ("biCompression", wintypes.DWORD),
        ("biSizeImage", wintypes.DWORD),
        ("biXPelsPerMeter", ctypes.c_long),
        ("biYPelsPerMeter", ctypes.c_long),
        ("biClrUsed", wintypes.DWORD),
        ("biClrImportant", wintypes.DWORD),
    ]


class BITMAPINFO(ctypes.Structure):
    _fields_ = [("bmiHeader", BITMAPINFOHEADER), ("bmiColors", wintypes.DWORD * 3)]


def list_windows():
    """คืน list ของ (hwnd, title) ของหน้าต่างที่มองเห็นและมีชื่อ"""
    found = []

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def _cb(hwnd, _lparam):
        if not user32.IsWindowVisible(hwnd):
            return True
        length = user32.GetWindowTextLengthW(hwnd)
        if length <= 0:
            return True
        buf = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, buf, length + 1)
        if buf.value.strip():
            found.append((hwnd, buf.value))
        return True

    user32.EnumWindows(_cb, 0)
    return found


def find_window(title_substr):
    """หา hwnd ตัวแรกที่ชื่อมีคำนี้ (ไม่สนตัวพิมพ์ใหญ่เล็ก) หรือ None"""
    key = title_substr.lower()
    for hwnd, title in list_windows():
        if key in title.lower():
            return hwnd
    return None


def capture_window(hwnd):
    """จับภาพหน้าต่างเป็น numpy BGR array (คืน None ถ้าล้มเหลว)"""
    rect = wintypes.RECT()
    if not user32.GetWindowRect(hwnd, ctypes.byref(rect)):
        return None
    w = rect.right - rect.left
    h = rect.bottom - rect.top
    if w <= 0 or h <= 0:
        return None

    hwnd_dc = user32.GetWindowDC(hwnd)
    save_dc = gdi32.CreateCompatibleDC(hwnd_dc)
    save_bmp = gdi32.CreateCompatibleBitmap(hwnd_dc, w, h)
    gdi32.SelectObject(save_dc, save_bmp)

    # PW_RENDERFULLCONTENT ช่วยให้จับแอปแบบ Chromium/Electron (เช่น TikTok Live Studio) ได้
    user32.PrintWindow(hwnd, save_dc, PW_RENDERFULLCONTENT)

    bmi = BITMAPINFO()
    bmi.bmiHeader.biSize = ctypes.sizeof(BITMAPINFOHEADER)
    bmi.bmiHeader.biWidth = w
    bmi.bmiHeader.biHeight = -h  # ลบ = ภาพหัวตั้ง (top-down)
    bmi.bmiHeader.biPlanes = 1
    bmi.bmiHeader.biBitCount = 32
    bmi.bmiHeader.biCompression = BI_RGB

    buffer = ctypes.create_string_buffer(w * h * 4)
    got = gdi32.GetDIBits(save_dc, save_bmp, 0, h, buffer, ctypes.byref(bmi), DIB_RGB_COLORS)

    gdi32.DeleteObject(save_bmp)
    gdi32.DeleteDC(save_dc)
    user32.ReleaseDC(hwnd, hwnd_dc)

    if got == 0:
        return None

    img = np.frombuffer(buffer, dtype=np.uint8).reshape((h, w, 4))
    return img[:, :, :3].copy()  # BGRA -> BGR
