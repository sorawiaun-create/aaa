// db.js — เก็บคลิป (ไฟล์วิดีโอ + ข้อมูลโพสต์) และคิว ลง IndexedDB
// ใช้ร่วมกันทั้ง side panel และ service worker (import เป็น ES module)
//
// ทำไมต้อง IndexedDB: chrome.storage เก็บไฟล์วิดีโอหลายร้อยไฟล์ไม่ไหว (จำกัดโควตา)
// IndexedDB เก็บ Blob ขนาดใหญ่ได้ (โดยเฉพาะเมื่อประกาศ unlimitedStorage)

const DB_NAME = 'tt-clip-scheduler';
const DB_VERSION = 1;
const STORE = 'clips';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: 'id' });
        os.createIndex('status', 'status', { unique: false });
        os.createIndex('scheduledAt', 'scheduledAt', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(mode, fn) {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const store = t.objectStore(STORE);
        let result;
        Promise.resolve(fn(store)).then((r) => (result = r));
        t.oncomplete = () => resolve(result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      })
  );
}

/**
 * clip record:
 * {
 *   id, name, mime, size, blob(Blob),
 *   caption, hashtags[], productKeyword,
 *   scheduledAt(ms|null), status('queued'|'posting'|'posted'|'failed'|'skipped'),
 *   attempts, lastError, createdAt, postedAt
 * }
 */

export async function addClip(clip) {
  const record = {
    id: clip.id,
    name: clip.name,
    mime: clip.mime || 'video/mp4',
    size: clip.size || (clip.blob ? clip.blob.size : 0),
    blob: clip.blob,
    caption: clip.caption || '',
    hashtags: clip.hashtags || [],
    productKeyword: clip.productKeyword || '',
    channel: clip.channel || '',
    scheduledAt: clip.scheduledAt ?? null,
    status: clip.status || 'queued',
    attempts: 0,
    lastError: '',
    createdAt: clip.createdAt || nowSafe(),
    postedAt: null,
  };
  await tx('readwrite', (s) => s.put(record));
  return record.id;
}

export async function updateClip(id, patch) {
  await tx('readwrite', (s) => {
    const req = s.get(id);
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) return;
      s.put({ ...cur, ...patch });
    };
  });
}

export async function getClip(id) {
  return tx('readonly', (s) => promisify(s.get(id)));
}

export async function deleteClip(id) {
  await tx('readwrite', (s) => s.delete(id));
}

/** ดึงทั้งหมด (เรียงตามเวลาโพสต์) — ตัด blob ออกเพื่อไม่ให้ payload ใหญ่ */
export async function listClipsMeta() {
  const all = await tx('readonly', (s) => promisify(s.getAll()));
  return all
    .map(({ blob, ...meta }) => meta)
    .sort((a, b) => (a.scheduledAt || Infinity) - (b.scheduledAt || Infinity));
}

/** งานที่ถึงกำหนดโพสต์แล้ว (queued และ scheduledAt <= now) */
export async function dueClips(nowMs) {
  const all = await tx('readonly', (s) => promisify(s.getAll()));
  return all
    .filter((c) => c.status === 'queued' && c.scheduledAt != null && c.scheduledAt <= nowMs)
    .sort((a, b) => a.scheduledAt - b.scheduledAt);
}

export async function clearAll() {
  await tx('readwrite', (s) => s.clear());
}

function promisify(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// service worker บางบริบทเรียก Date.now ได้ปกติ — ห่อไว้กันพลาด
function nowSafe() {
  try {
    return Date.now();
  } catch {
    return 0;
  }
}
