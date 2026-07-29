import path from 'node:path';
import { CONFIG } from '../config.js';

// เผยแพร่ลง Instagram (Business/Creator) ผ่าน Content Publishing API
// IG ต้องดึงสื่อจาก "URL สาธารณะ" — อัปโหลดไฟล์ตรงไม่ได้
// จึงต้องตั้ง MEDIA_BASE_URL ให้ชี้ไปยังโฟลเดอร์ assets ที่เผยแพร่ออนไลน์
export async function publishInstagram(post, ctx) {
  const cfg = CONFIG.publish.instagram;
  const caption = [post.caption, post.hashtags].filter(Boolean).join('\n\n');

  if (!CONFIG.publish.live) {
    return { platform: 'instagram', status: 'dry-run', caption: caption.slice(0, 80) + '…' };
  }
  if (!cfg.userId || !cfg.token) {
    return { platform: 'instagram', status: 'skipped', reason: 'ยังไม่ได้ตั้ง IG_USER_ID / IG_TOKEN' };
  }
  if (!cfg.mediaBaseUrl) {
    return { platform: 'instagram', status: 'skipped', reason: 'IG ต้องมี MEDIA_BASE_URL (URL สาธารณะของสื่อ)' };
  }

  const media = post.media || [];
  const image = media.find((m) => /\.(png|jpe?g|webp)$/i.test(m));
  const video = media.find((m) => /\.(mp4|mov)$/i.test(m));
  if (!image && !video) {
    return { platform: 'instagram', status: 'skipped', reason: 'IG ต้องมีรูปหรือวิดีโออย่างน้อย 1 ชิ้น' };
  }

  const base = `https://graph.facebook.com/${cfg.apiVersion}/${cfg.userId}`;
  const publicUrl = (rel) => joinUrl(cfg.mediaBaseUrl, path.basename(rel));

  try {
    // 1) สร้าง media container
    const params = new URLSearchParams({ caption, access_token: cfg.token });
    if (video) {
      params.set('media_type', 'REELS');
      params.set('video_url', publicUrl(video));
    } else {
      params.set('image_url', publicUrl(image));
    }
    let res = await fetch(`${base}/media`, { method: 'POST', body: params });
    let json = await res.json();
    if (!res.ok) throw new Error(json.error?.message || JSON.stringify(json));
    const creationId = json.id;

    // 2) วิดีโอต้องรอประมวลผลให้พร้อมก่อน publish
    if (video) await waitReady(creationId, cfg);

    // 3) publish
    res = await fetch(`${base}/media_publish`, {
      method: 'POST',
      body: new URLSearchParams({ creation_id: creationId, access_token: cfg.token }),
    });
    json = await res.json();
    if (!res.ok) throw new Error(json.error?.message || JSON.stringify(json));
    return { platform: 'instagram', status: 'published', id: json.id };
  } catch (e) {
    return { platform: 'instagram', status: 'error', error: e.message };
  }
}

async function waitReady(creationId, cfg) {
  const url = `https://graph.facebook.com/${cfg.apiVersion}/${creationId}?fields=status_code&access_token=${cfg.token}`;
  for (let i = 0; i < 30; i++) {
    const res = await fetch(url);
    const json = await res.json();
    if (json.status_code === 'FINISHED') return;
    if (json.status_code === 'ERROR') throw new Error('IG ประมวลผลสื่อล้มเหลว');
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error('IG ประมวลผลสื่อนานเกินไป');
}

function joinUrl(base, name) {
  return base.replace(/\/+$/, '') + '/' + name;
}
