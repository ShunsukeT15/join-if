-- Optional (Supabase): run the purge inside the database with pg_cron (spec §7.5).
-- The API server already purges on a timer; use this when the API runs serverless
-- and no long-lived process exists. Run once in the Supabase SQL editor.
create extension if not exists pg_cron;

select cron.schedule(
  'himitsu-purge-expired-rooms',
  '17 3 * * *', -- daily 03:17 UTC
  $$ delete from public.rooms where purge_after <= now() $$
);
