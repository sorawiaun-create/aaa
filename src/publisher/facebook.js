import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config.js';

// เผยแพร่ลง Facebook Page ผ่าน Graph API
// - มีรูป  -> /{page-id}/photos (อัปโหลดไฟล์ตรง)
// - มีวิดีโอ -> /{page-id}/videos
// - ข้อความล้วน -> /{page-id}/feed
export async function publishFacebook(post, ctx) {
  const cfg = CONFIG.publish.facebook;
  const message = [post.caption, post.hashtags].filter(Boolean).join('\n\n');

  if (!CONFIG.publish.live) {
    return { platform: 'facebook', status: 'dry-run', message: message.slice(0, 80) + '…' };
  }
  if (!cfg.pageId || !cfg.token) {
    return { platform: 'facebook', status: 'skipped', reason: 'ยังไม่ได้ตั้ง FB_PAGE_ID / FB_PAGE_TOKEN' };
  }

  const base = `https://graph.facebook.com/${cfg.apiVersion}/${cfg.pageId}`;
  const media = (post.media || []).map((m) => path.resolve(ctx.dir, m));
  const image = media.find((m) => /\.(png|jpe?g|webp|gif)$/i.test(m));
  const video = media.find((m) => /\.(mp4|mov|webm)$/i.test(m));

  try {
    let url, form;
    if (video) {
      url = `${base}/videos`;
      form = new FormData();
      form.append('description', message);
      form.append('source', await fileBlob(video));
    } else if (image) {
      url = `${base}/photos`;
      form = new FormData();
      form.append('caption', message);
      form.append('source', await fileBlob(image));
    } else {
      url = `${base}/feed`;
      form = new FormData();
      form.append('message', message);
    }
    form.append('access_token', cfg.token);
    // ตั้งเวลาโพสต์ (ถ้าระบุ scheduleTime เป็น unix timestamp)
    const ts = toUnix(post.scheduleTime);
    if (ts) {
      form.append('published', 'false');
      form.append('scheduled_publish_time', String(ts));
    }

    const res = await fetch(url, { method: 'POST', body: form });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error?.message || JSON.stringify(json));
    return { platform: 'facebook', status: 'published', id: json.id || json.post_id, scheduled: !!ts };
  } catch (e) {
    return { platform: 'facebook', status: 'error', error: e.message };
  }
}

async function fileBlob(p) {
  const buf = fs.readFileSync(p);
  return new Blob([buf], { type: guessMime(p) });
}
function guessMime(p) {
  const e = p.split('.').pop().toLowerCase();
  return { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' }[e] || 'application/octet-stream';
}
function toUnix(s) {
  if (!s) return 0;
  const t = Date.parse(s);
  return Number.isNaN(t) ? 0 : Math.floor(t / 1000);
}
