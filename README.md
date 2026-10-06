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

## How reviews work

Reviews are stored in a **Supabase database** (project `rpspbwsmfnlakzcuskul`).

1. A customer clicks **Write a review** and submits the form.
2. The review is saved to the `reviews` table with `approved = false`, so it is
   hidden from the public. The customer sees it on their own device marked
   "Pending approval".
3. **To approve:** Supabase dashboard -> Table Editor -> `reviews` -> set
   `approved` to `true`. It appears on the site right away.
4. **To reply publicly:** fill in the `reply` column. **To remove:** delete the row.

### Photos

Customers can attach up to 4 photos. Each photo is shrunk on their device
(max 1600px JPEG, location data removed) and uploaded to the private
`review-photos` storage bucket as `<review id>/1.jpg`, `2.jpg`, and so on. The
paths are saved in the review's `photos` column.

- Photos are **only visible after you approve the review**. To check them
  before approving: Supabase dashboard -> Storage -> `review-photos` -> the
  folder named after the review's `id`.
- To remove one photo, delete it from Storage and remove its path from the
  review's `photos` list. To remove all, clear `photos` (set it to `{}`).
- Photos need the database. In backup mode the photo field is hidden.

Database rules (row-level security) only let visitors read approved reviews
and submit new unapproved ones. Visitors cannot approve, edit, reply to, or
delete reviews. The key in `reviews-config.js` is the public publishable key;
never put the secret/service-role key in the site.

### Backup: reviews.json + email

If the database is unreachable (for example, a free Supabase project paused
after a week of inactivity), the site automatically:

- shows reviews from `reviews.json`, and
- emails new submissions to `Fikeaustin99@gmail.com` (FormSubmit) with a
  ready-to-paste JSON block. The first email asks you to confirm the address once.

To restore the database, open the Supabase dashboard and click **Restore project**.

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

### Database schema

`supabase-setup.sql` recreates the table and security rules on a new project.
