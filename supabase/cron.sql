-- Расписание напоминаний (Ташкент = UTC+5): 08:30, 14:00, 21:00. __URL__ подставляет workflow деплоя.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
select cron.unschedule(jobid) from cron.job where jobname like 'arise-%';
select cron.schedule('arise-morning', '30 3 * * *', $$ select net.http_post(url := '__URL__', headers := '{"Content-Type":"application/json"}'::jsonb,
  body := jsonb_build_object('action', 'push_tick', 'slot', 'morning', 'secret', (select value from public.app_config where key = 'cron_secret'))) $$);
select cron.schedule('arise-day', '0 9 * * *', $$ select net.http_post(url := '__URL__', headers := '{"Content-Type":"application/json"}'::jsonb,
  body := jsonb_build_object('action', 'push_tick', 'slot', 'day', 'secret', (select value from public.app_config where key = 'cron_secret'))) $$);
select cron.schedule('arise-evening', '0 16 * * *', $$ select net.http_post(url := '__URL__', headers := '{"Content-Type":"application/json"}'::jsonb,
  body := jsonb_build_object('action', 'push_tick', 'slot', 'evening', 'secret', (select value from public.app_config where key = 'cron_secret'))) $$);
