-- 2026-09-30: Kullanıcı bildirimlerini ana ekrandaki rozet için Realtime'a aç.
-- RLS mevcut: kullanıcı yalnızca kendi notifications satırlarını SELECT eder.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    execute 'alter publication supabase_realtime add table public.notifications';
  end if;
end
$$;
