CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule('campaign-tick-every-minute')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'campaign-tick-every-minute');

SELECT cron.unschedule('sweep-stuck-calls-every-minute')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sweep-stuck-calls-every-minute');

SELECT cron.schedule(
  'campaign-tick-every-minute',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--c2d455c6-ca10-450b-8639-635c2ce68556.lovable.app/api/public/hooks/campaign-tick',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhvaHV2c2xjZG9ub2txdXVvcXhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMzOTk1NjUsImV4cCI6MjA5ODk3NTU2NX0.ONYtxBbS1ewM2Khi5lGRbEINzPV1y57qMvkCRLlK290"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  ) AS request_id;
  $$
);

SELECT cron.schedule(
  'sweep-stuck-calls-every-minute',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--c2d455c6-ca10-450b-8639-635c2ce68556.lovable.app/api/public/hooks/sweep-stuck-calls',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFub24iLCJpYXQiOjE3ODMzOTk1NjUsImV4cCI6MjA5ODk3NTU2NX0.ONYtxBbS1ewM2Khi5lGRbEINzPV1y57qMvkCRLlK290"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  ) AS request_id;
  $$
);