-- Напоминания: каждый час (Ташкент = UTC+5). Сервер сам решает, кому пора: выбранный час, вечернее «спасение серии» в 21:00, воскресный отчёт.
-- __URL__ подставляет workflow деплоя.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
select cron.unschedule(jobid) from cron.job where jobname like 'arise-%';
select cron.schedule('arise-hourly', '0 * * * *', $$ select net.http_post(url := '__URL__', headers := '{"Content-Type":"application/json"}'::jsonb,
  body := jsonb_build_object('action', 'push_tick', 'slot', 'hour', 'secret', (select value from public.app_config where key = 'cron_secret'))) $$);
