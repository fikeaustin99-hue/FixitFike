-- Fike Fix: OPTIONAL live review database (Supabase)
-- The site works without this (reviews.json + email). Run this only if you
-- want reviews saved to a database automatically.
--
-- 1. Create a free project at https://supabase.com
-- 2. Open SQL Editor, paste this whole file, click Run. Safe to re-run.
-- 3. Settings > API: copy the Project URL and the "anon public" key into
--    reviews-config.js (supabaseUrl, supabaseAnonKey).
--    Never paste the service-role key into the website.

begin;

create extension if not exists pgcrypto;

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 60),
  town text check (town is null or char_length(town) <= 40),
  service text check (service is null or char_length(service) <= 40),
  rating integer not null check (rating between 1 and 5),
  comment text not null check (char_length(trim(comment)) between 10 and 600),
  reply text check (reply is null or char_length(reply) <= 600),
  approved boolean not null default false,
  created_at timestamptz not null default now()
);

-- Upgrade an older version of the table if it already exists.
alter table public.reviews add column if not exists town text;
alter table public.reviews add column if not exists service text;
alter table public.reviews add column if not exists reply text;

create index if not exists reviews_approved_created_idx
  on public.reviews (approved, created_at desc);

alter table public.reviews enable row level security;

drop policy if exists "Anyone can submit a review" on public.reviews;
drop policy if exists "Anyone can read approved reviews" on public.reviews;

-- Visitors can submit, but only as unapproved, and cannot set a reply.
create policy "Anyone can submit a review"
on public.reviews for insert to anon, authenticated
with check (approved = false and reply is null);

-- Only approved reviews are public.
create policy "Anyone can read approved reviews"
on public.reviews for select to anon, authenticated
using (approved = true);

-- No public update/delete policy: approving, replying, and deleting are done
-- by you in the Supabase Table Editor.

commit;

-- To approve a review: Table Editor > reviews > set approved = true.
-- To reply publicly: fill in the "reply" column.
