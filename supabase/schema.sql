-- ============================================================
-- TikTok Live Aff — Supabase schema
-- วิธีใช้: เปิด Supabase Dashboard → SQL Editor → วางทั้งไฟล์นี้ → Run
-- ============================================================

-- แต่ละตารางเก็บเป็น id + JSON (ยืดหยุ่น ตรงกับโครงสร้างข้อมูลในแอป)
create table if not exists public.channels  (id text primary key, data jsonb not null, updated_at timestamptz not null default now());
create table if not exists public.employees (id text primary key, data jsonb not null, updated_at timestamptz not null default now());
create table if not exists public.teams     (id text primary key, data jsonb not null, updated_at timestamptz not null default now());
create table if not exists public.sales     (id text primary key, data jsonb not null, updated_at timestamptz not null default now());
create table if not exists public.work_logs (id text primary key, data jsonb not null, updated_at timestamptz not null default now());
create table if not exists public.settings  (id text primary key, data jsonb not null, updated_at timestamptz not null default now());

-- ------------------------------------------------------------
-- Row Level Security: อนุญาตเฉพาะผู้ที่ "เข้าสู่ระบบ" แล้ว
-- ทุกคนที่ล็อกอินเห็น/แก้ข้อมูลชุดกลางชุดเดียวกัน (workspace เดียว)
-- ------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['channels','employees','teams','sales','work_logs','settings']
  loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists "auth_all" on public.%I;', t);
    execute format($f$
      create policy "auth_all" on public.%I
        for all
        to authenticated
        using (true)
        with check (true);
    $f$, t);
  end loop;
end $$;

-- ------------------------------------------------------------
-- เปิด Realtime เพื่อให้ทุกเครื่อง sync กันทันที
-- (ถ้ารันแล้วขึ้น error ว่า table อยู่ใน publication แล้ว ข้ามได้)
-- ------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['channels','employees','teams','sales','work_logs','settings']
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I;', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
