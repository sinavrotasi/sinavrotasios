create or replace function public.protect_privileged_profile_columns()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if session_user <> 'authenticator' or auth.role() = 'service_role' then
    return new;
  end if;

  if not public.is_admin() then
    new.is_admin := old.is_admin;
    new.is_premium := old.is_premium;
    new.premium_until := old.premium_until;
    new.premium_source := old.premium_source;
  end if;

  return new;
end;
$function$;

comment on column public.profiles.role is
'Kullanıcının hedef kadrosu (memur/sef/sayman/sube-mudur). Kullanıcı kendi profilinde değiştirebilir.';

create or replace function public.get_total_question_count()
returns integer
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with selected_profile_role as (
    select p.role as role_name
    from public.profiles p
    where p.id = auth.uid()
    limit 1
  )
  select count(*)::int
  from public.questions q
  join public.topics t on t.id = q.topic_id
  cross join selected_profile_role spr
  where t.show_in_catalog = true
    and (
      coalesce(cardinality(t.kadrolar), 0) = 0
      or spr.role_name = any(t.kadrolar)
    );
$function$;

revoke all on function public.get_total_question_count() from public;
revoke all on function public.get_total_question_count() from anon;
grant execute on function public.get_total_question_count() to authenticated;
grant execute on function public.get_total_question_count() to service_role;
