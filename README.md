# Fike Fix website

Static site for Fike Fix (handyman + computer repair, Vidalia, GA).
No build step. Published by GitHub Pages at
https://fikeaustin99-hue.github.io/FixitFike/

## Files

| File | What it is |
| --- | --- |
| `index.html` | The website |
| `reviews.js` | Reviews section: display, filters, review form, storage |
| `reviews-config.js` | Review storage settings (email, optional database keys) |
| `reviews.json` | **Review storage file** — every review in here is shown on the site |
| `supabase-setup.sql` | Optional: live database setup |

## How reviews work (no setup needed)

1. A customer clicks **Write a review**, picks 1–5 stars, and fills in the form.
2. The review is emailed to `Fikeaustin99@gmail.com` (via FormSubmit). The
   customer sees their review on their own device marked "Pending approval".
3. To publish it, open `reviews.json` on GitHub (pencil icon to edit), paste the
   JSON block from the email inside the `[ ]` brackets, and commit. The site
   updates in about a minute.

**First time only:** the very first review triggers a FormSubmit email asking
you to confirm `Fikeaustin99@gmail.com`. Click the confirm link once; after
that every review comes straight to your inbox.

### reviews.json format

```json
[
  {
    "id": "a1b2c3",
    "name": "Sarah M.",
    "town": "Vidalia",
    "service": "TV mounting",
    "rating": 5,
    "comment": "Showed up on time, mounted a 65\" TV and hid every cable.",
    "reply": "Thanks Sarah, enjoy the new setup.",
    "created_at": "2026-10-01T15:00:00.000Z"
  }
]
```

Separate multiple reviews with a comma. `town`, `service`, and `reply` are optional.
To remove a review, delete its block. To reply publicly, fill in `reply`.

## Optional: live database (Supabase)

If you'd rather have reviews saved automatically instead of pasting them:

1. Create a free project at https://supabase.com.
2. In **SQL Editor**, run all of `supabase-setup.sql`.
3. In **Settings → API**, copy the Project URL and the **anon public** key into
   `reviews-config.js` (`supabaseUrl`, `supabaseAnonKey`). Never use the
   service-role key.
4. Approve reviews in **Table Editor → reviews** by setting `approved` to `true`.

If the database is ever unreachable, the site automatically falls back to
showing `reviews.json`.
