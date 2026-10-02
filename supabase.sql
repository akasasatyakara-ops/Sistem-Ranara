-- =============================================================
-- Sistem Ranara — Skema database (jalankan di Supabase → SQL Editor)
-- Satu tabel "laporan"; setiap akun Google hanya bisa melihat dan
-- mengubah data miliknya sendiri (Row Level Security).
-- =============================================================

create table if not exists public.laporan (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
    tanggal     date not null,
    uraian      text not null default '',
    cv          text not null default '',
    pagu        bigint not null check (pagu >= 0),
    ppn         bigint not null default 0 check (ppn >= 0),
    pph22       bigint not null default 0 check (pph22 >= 0),
    keterangan  text not null default '',
    dibuat      timestamptz not null default now()
);

create index if not exists laporan_user_tanggal_idx
    on public.laporan (user_id, tanggal, dibuat);

alter table public.laporan enable row level security;

drop policy if exists "laporan_select_sendiri" on public.laporan;
drop policy if exists "laporan_insert_sendiri" on public.laporan;
drop policy if exists "laporan_update_sendiri" on public.laporan;
drop policy if exists "laporan_delete_sendiri" on public.laporan;

create policy "laporan_select_sendiri" on public.laporan
    for select to authenticated using (auth.uid() = user_id);

create policy "laporan_insert_sendiri" on public.laporan
    for insert to authenticated with check (auth.uid() = user_id);

create policy "laporan_update_sendiri" on public.laporan
    for update to authenticated
    using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "laporan_delete_sendiri" on public.laporan
    for delete to authenticated using (auth.uid() = user_id);
