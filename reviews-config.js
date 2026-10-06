/*
 * Fike Fix — review storage settings
 * -----------------------------------
 * The reviews section works out of the box with no setup:
 *
 *   PUBLISHED REVIEWS  -> stored in reviews.json (in this repo).
 *                         Everything in that file shows on the site.
 *   NEW SUBMISSIONS    -> emailed to ownerEmail (with a ready-to-paste
 *                         JSON block) and kept on the customer's device
 *                         as "Pending approval" so they see it went through.
 *
 * Optional upgrade: live database (Supabase, free tier).
 *   Fill in supabaseUrl + supabaseAnonKey below and run supabase-setup.sql.
 *   Reviews are then saved to the database automatically, and you approve
 *   them by flipping "approved" to true in the Supabase Table Editor.
 *   Only ever paste the public "anon" key here, never the service-role key.
 */
window.FIKE_REVIEWS_CONFIG = {
  ownerEmail: 'Fikeaustin99@gmail.com',

  // Published reviews file (relative path so it works on GitHub Pages sub-paths).
  publishedFile: 'reviews.json',

  // Optional live database. Leave blank to use reviews.json + email.
  supabaseUrl: '',
  supabaseAnonKey: '',

  // How many reviews to show before "Show more".
  pageSize: 6
};
