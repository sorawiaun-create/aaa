import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { copyFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

// หน้า Content OS เป็น HTML ไฟล์เดียวที่ไม่ผ่าน bundler (เปิดจากไฟล์ตรง ๆ ก็ได้)
// จึงต้องก๊อปเข้า dist เองตอน build เพื่อให้เปิดได้ที่ <เว็บ>/content-os/
// data.json คือข้อมูลจริงที่ workflow เขียน commit กลับมาทุกเช้า — ยังไม่มีก็ข้ามไป
// (หน้าเว็บจะใช้ข้อมูลตัวอย่างที่ฝังไว้แทน)
function copyContentOs() {
  return {
    name: 'copy-content-os',
    apply: 'build',
    async closeBundle() {
      const dest = path.resolve('dist/content-os');
      await mkdir(dest, { recursive: true });
      for (const name of ['index.html', 'data.json']) {
        const src = path.resolve('content-os', name);
        if (existsSync(src)) await copyFile(src, path.join(dest, name));
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), copyContentOs()],
  server: {
    port: 5173,
    host: true,
  },
});
