import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config.js';

// เผยแพร่วิดีโอลง TikTok ผ่าน Content Posting API (Direct Post)
// ต้องมี access token ที่ผ่าน scope video.publish และแอปผ่าน app review ของ TikTok
export async function publishTiktok(post, ctx) {
  const cfg = CONFIG.publish.tiktok;
  const title = [post.caption, post.hashtags].filter(Boolean).join(' ').slice(0, 2200);

  if (!CONFIG.publish.live) {
    return { platform: 'tiktok', status: 'dry-run', title: title.slice(0, 80) + '…' };
  }
  if (!cfg.token) {
    return { platform: 'tiktok', status: 'skipped', reason: 'ยังไม่ได้ตั้ง TIKTOK_TOKEN' };
  }

  const video = (post.media || []).map((m) => path.resolve(ctx.dir, m)).find((m) => /\.(mp4|mov|webm)$/i.test(m));
  if (!video) {
    return { platform: 'tiktok', status: 'skipped', reason: 'TikTok ต้องมีไฟล์วิดีโอ' };
  }

  try {
    const size = fs.statSync(video).size;
    const auth = { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json; charset=UTF-8' };

    // 1) init การโพสต์ (อัปโหลดไฟล์ทั้งก้อนใน 1 chunk)
    let res = await fetch('https://open.tiktokapis.com/v2/post/publish/video/init/', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        post_info: { title, privacy_level: 'SELF_ONLY' }, // เริ่มเป็นส่วนตัวเพื่อความปลอดภัย ปรับได้
        source_info: { source: 'FILE_UPLOAD', video_size: size, chunk_size: size, total_chunk_count: 1 },
      }),
    });
    let json = await res.json();
    if (json.error && json.error.code !== 'ok') throw new Error(json.error.message || JSON.stringify(json.error));
    const { publish_id, upload_url } = json.data;

    // 2) อัปโหลดไบต์วิดีโอ
    const buf = fs.readFileSync(video);
    const put = await fetch(upload_url, {
      method: 'PUT',
      headers: { 'Content-Type': 'video/mp4', 'Content-Range': `bytes 0-${size - 1}/${size}` },
      body: buf,
    });
    if (!put.ok) throw new Error(`อัปโหลดวิดีโอไม่สำเร็จ: ${put.status}`);

    return { platform: 'tiktok', status: 'uploaded', publish_id, note: 'TikTok กำลังประมวลผล ตรวจสถานะในบัญชี/ผ่าน status API' };
  } catch (e) {
    return { platform: 'tiktok', status: 'error', error: e.message };
  }
}
