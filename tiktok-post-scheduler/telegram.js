// telegram.js — แจ้งเตือนผ่าน Telegram bot (เมื่อโพสต์เสร็จ/ล้มเหลว)

/**
 * ส่งข้อความเข้า Telegram
 * @param {object} o { token, chatId, text }
 */
export async function sendTelegram({ token, chatId, text }) {
  if (!token || !chatId) return { ok: false, error: 'ยังไม่ได้ตั้งค่า Telegram token/chat id' };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) return { ok: false, error: data.description || `HTTP ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}
