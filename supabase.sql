-- =============================================================
-- Sistem Ranara — Tabel "laporan" (Supabase)
-- Cara pakai: Supabase → SQL Editor → New query → tempel → Run.
-- Aman dijalankan berulang kali (idempotent) dan tidak menghapus data.
-- Kolom disesuaikan dengan formulir di dashboard.html / dashboard.js
-- =============================================================

-- 1) Tabel (dibuat hanya bila belum ada)
create table if not exists public.laporan (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null default auth.uid()
                     references auth.users (id) on delete cascade,
    tanggal     date        not null default current_date,  -- input "Tanggal"
    uraian      text        not null default '',            -- input "Uraian Belanja"
    cv          text        not null default '',            -- input "CV / PT"
    pagu        bigint      not null default 0,             -- input "PAGU (Rp)"
    ppn         bigint      not null default 0,             -- input "PPN 12% (Rp)"
    pph22       bigint      not null default 0,             -- input "PPH 22 (Rp)"
    keterangan  text        not null default '',            -- input "Keterangan"
    dibuat      timestamptz not null default now()          -- waktu dicatat (untuk urutan)
);

-- 2) Pastikan semua kolom ada bila tabel sudah dibuat lebih dulu
alter table public.laporan add column if not exists user_id    uuid default auth.uid() references auth.users (id) on delete cascade;
alter table public.laporan add column if not exists tanggal    date;
alter table public.laporan add column if not exists uraian     text;
alter table public.laporan add column if not exists cv         text;
alter table public.laporan add column if not exists pagu       bigint;
alter table public.laporan add column if not exists ppn        bigint;
alter table public.laporan add column if not exists pph22      bigint;
alter table public.laporan add column if not exists keterangan text;
alter table public.laporan add column if not exists dibuat     timestamptz;

-- 3) Bersihkan nilai kosong (bila ada), lalu pasang default & NOT NULL
update public.laporan set tanggal    = current_date where tanggal    is null;
update public.laporan set uraian     = ''           where uraian     is null;
update public.laporan set cv         = ''           where cv         is null;
update public.laporan set pagu       = 0            where pagu       is null;
update public.laporan set ppn        = 0            where ppn        is null;
update public.laporan set pph22      = 0            where pph22      is null;
update public.laporan set keterangan = ''           where keterangan is null;
update public.laporan set dibuat     = now()        where dibuat     is null;

alter table public.laporan alter column user_id    set default auth.uid();
alter table public.laporan alter column tanggal    set default current_date;
alter table public.laporan alter column uraian     set default '';
alter table public.laporan alter column cv         set default '';
alter table public.laporan alter column pagu       set default 0;
alter table public.laporan alter column ppn        set default 0;
alter table public.laporan alter column pph22      set default 0;
alter table public.laporan alter column keterangan set default '';
alter table public.laporan alter column dibuat     set default now();

alter table public.laporan alter column tanggal    set not null;
alter table public.laporan alter column uraian     set not null;
alter table public.laporan alter column cv         set not null;
alter table public.laporan alter column pagu       set not null;
alter table public.laporan alter column ppn        set not null;
alter table public.laporan alter column pph22      set not null;
alter table public.laporan alter column keterangan set not null;
alter table public.laporan alter column dibuat     set not null;

-- 4) Indeks untuk mempercepat daftar laporan per pengguna
create index if not exists laporan_user_tanggal_idx
    on public.laporan (user_id, tanggal, dibuat);

-- 5) Keamanan: tiap pengguna hanya bisa mengakses datanya sendiri
alter table public.laporan enable row level security;

drop policy if exists "laporan_select_own" on public.laporan;
drop policy if exists "laporan_insert_own" on public.laporan;
drop policy if exists "laporan_update_own" on public.laporan;
drop policy if exists "laporan_delete_own" on public.laporan;

create policy "laporan_select_own" on public.laporan
    for select to authenticated
    using (auth.uid() = user_id);

create policy "laporan_insert_own" on public.laporan
    for insert to authenticated
    with check (auth.uid() = user_id);

create policy "laporan_update_own" on public.laporan
    for update to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

create policy "laporan_delete_own" on public.laporan
    for delete to authenticated
    using (auth.uid() = user_id);
