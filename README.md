# Fike Fix static deployment and reviews

## One-click deployment

This is a static HTML site and can be deployed without a build step.

### GitHub Pages

1. Open **Settings → Pages** in this repository.
2. Under **Build and deployment**, choose **Deploy from a branch**.
3. Choose `main` and `/ (root)`.
4. Click **Save**.

GitHub will publish the site at:

`https://fikeaustin99-hue.github.io/FixitFike/`

The included `reviews.json` file is served as a public fallback.

### Netlify Drop

1. Download or clone the repository.
2. Open https://app.netlify.com/drop.
3. Drag the repository folder into the drop area.

No build command or publish directory configuration is required.

## Supabase configuration

In `index.html`, replace the placeholders with the browser-safe Supabase project URL and anon key:

```js
const SUPABASE_URL = 'https://YOUR_PROJECT.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';
```

Never put a Supabase service-role key in a static page.

## Database SQL

Run this in the Supabase SQL editor:

```sql
create extension if not exists pgcrypto;

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  rating integer not null check (rating between 1 and 5),
  comment text not null check (char_length(comment) between 1 and 500),
  photo_url text,
  approved boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.reviews enable row level security;

create policy "Anyone can submit a review"
on public.reviews for insert to anon, authenticated
with check (approved = false);

create policy "Anyone can read approved reviews"
on public.reviews for select to anon, authenticated
using (approved = true);
```

Create a **public** Storage bucket named `review-photos`, then run:

```sql
create policy "Anyone can view review photos"
on storage.objects for select to anon, authenticated
using (bucket_id = 'review-photos');

create policy "Anyone can upload review photos"
on storage.objects for insert to anon, authenticated
with check (bucket_id = 'review-photos');
```

Approve reviews manually in **Table Editor → reviews** by changing `approved` to `true`.

## JSON fallback behavior

The public fallback is intended for read-only continuity. A static browser cannot safely write changes back to `reviews.json`. The page should:

1. Fetch approved reviews from Supabase.
2. If the request fails, fetch `/reviews.json`.
3. Display the fallback reviews and label them as fallback data.
4. Keep new submissions disabled or queued until Supabase is available.

Do not treat fallback JSON as a moderation or write database.
