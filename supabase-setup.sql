-- Fike Fix: Supabase reviews and review-photo storage setup
-- Run this entire file once in the Supabase SQL Editor.
-- The browser must use only the Supabase anon key, never the service-role key.

begin;

create extension if not exists pgcrypto;

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 60),
  rating integer not null check (rating between 1 and 5),
  comment text not null check (char_length(trim(comment)) between 1 and 500),
  photo_url text,
  approved boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.reviews enable row level security;

-- Make this script safe to rerun after a policy was previously created.
drop policy if exists "Anyone can submit a review" on public.reviews;
drop policy if exists "Anyone can read approved reviews" on public.reviews;
drop policy if exists "Admins can update reviews" on public.reviews;

-- Public visitors may submit reviews, but cannot mark them approved.
create policy "Anyone can submit a review"
on public.reviews
for insert
to anon, authenticated
with check (approved = false);

-- Only approved reviews are exposed to the public site.
create policy "Anyone can read approved reviews"
on public.reviews
for select
to anon, authenticated
using (approved = true);

-- The dashboard/service role can moderate reviews. It bypasses RLS.
-- Do not create a public update policy: approval must remain private.

-- Create the public photo bucket if it does not already exist.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'review-photos',
  'review-photos',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Make this script safe to rerun after storage policies already exist.
drop policy if exists "Anyone can view review photos" on storage.objects;
drop policy if exists "Anyone can upload review photos" on storage.objects;

create policy "Anyone can view review photos"
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'review-photos');

create policy "Anyone can upload review photos"
on storage.objects
for insert
to anon, authenticated
with check (
  bucket_id = 'review-photos'
  and (storage.extension(name) = any (array['jpg', 'jpeg', 'png', 'webp']))
);

commit;

-- After running this script:
-- 1. Approve reviews in Table Editor by setting approved = true.
-- 2. Put the Project URL and anon key in index.html.
-- 3. Never expose a service-role key in index.html.
