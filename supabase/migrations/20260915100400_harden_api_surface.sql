-- D-04 ve R-03: API yüzeyinin daraltılması.
--
--   1. anon rolünün public tablolar üzerindeki tüm tablo/sütun yetkileri
--      kaldırılır. Uygulama hiçbir tabloyu oturum açmadan okumaz; koruma
--      bugüne kadar yalnızca RLS'e dayanıyordu.
--   2. SECURITY DEFINER fonksiyonlarda PUBLIC/anon çalıştırma yetkisi
--      kaldırılır; istemcinin gerçekten çağırdıkları authenticated'a açıkça verilir.
--   3. app_settings: "ALL to public" politikası (anon için is_admin() yetki
--      hatası riski) işlem bazlı, authenticated'a özgü politikalara bölünür.
--   4. user_events: event_type biçimi ve event_data boyutu sınırlanır,
--      kullanıcı başına saatlik olay sayısı sınırlanır.
--   5. set_updated_at için sabit search_path.

-- 1) anon tablo yetkileri
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon;

-- 2) Fonksiyon yetkileri
do $$
declare
  fn text;
  client_fns text[] := array[
    'public.start_random_test(text)',
    'public.reveal_quiz_session(uuid)',
    'public.get_topic_descendant_ids(text)',
    'public.get_total_question_count()',
    'public.get_tf_pool_topic_counts()',
    'public.get_topic_question_count(text[])',
    'public.get_flashcard_count(text)',
    'public.get_question_counts()',
    'public.is_admin()',
    'public.is_premium()',
    'public.admin_delete_user(uuid)',
    'public.admin_search_users(text)',
    'public.admin_set_premium(uuid, boolean, timestamptz)'
  ];
begin
  foreach fn in array client_fns loop
    execute format('revoke all on function %s from public', fn);
    execute format('revoke all on function %s from anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

-- 3) app_settings politikaları
drop policy if exists app_settings_admin_write on public.app_settings;
drop policy if exists app_settings_read on public.app_settings;
drop policy if exists app_settings_authenticated_read on public.app_settings;
drop policy if exists app_settings_admin_insert on public.app_settings;
drop policy if exists app_settings_admin_update on public.app_settings;
drop policy if exists app_settings_admin_delete on public.app_settings;

create policy app_settings_authenticated_read on public.app_settings
  for select to authenticated
  using (true);

create policy app_settings_admin_insert on public.app_settings
  for insert to authenticated
  with check ((select public.is_admin()));

create policy app_settings_admin_update on public.app_settings
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy app_settings_admin_delete on public.app_settings
  for delete to authenticated
  using ((select public.is_admin()));

-- 4) user_events sınırları
alter table public.user_events
  drop constraint if exists user_events_event_type_format;
alter table public.user_events
  add constraint user_events_event_type_format
  check (event_type ~ '^[a-z0-9_]{1,64}$') not valid;

alter table public.user_events
  drop constraint if exists user_events_event_data_size;
alter table public.user_events
  add constraint user_events_event_data_size
  check (jsonb_typeof(event_data) = 'object' and pg_column_size(event_data) <= 4096) not valid;

create index if not exists user_events_user_created_idx on public.user_events (user_id, created_at desc);

create or replace function public.enforce_user_events_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_recent integer;
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  select count(*) into v_recent
  from public.user_events e
  where e.user_id = new.user_id
    and e.created_at > now() - interval '1 hour';

  if v_recent >= 300 then
    raise exception 'USER_EVENTS_RATE_LIMIT' using errcode = 'P0001';
  end if;

  return new;
end;
$function$;

revoke all on function public.enforce_user_events_rate_limit() from public, anon, authenticated;

drop trigger if exists trg_user_events_rate_limit on public.user_events;
create trigger trg_user_events_rate_limit
  before insert on public.user_events
  for each row execute function public.enforce_user_events_rate_limit();

drop policy if exists "user_events: kullanici kendi olayini ekleyebilir" on public.user_events;
create policy "user_events: kullanici kendi olayini ekleyebilir"
  on public.user_events for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

-- 5) search_path
alter function public.set_updated_at() set search_path = public, pg_temp;
