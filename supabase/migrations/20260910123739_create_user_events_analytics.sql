-- Production'da 2026-09-10'da uygulanmış, kaynak depoya alınmamış migration.
-- Gövde supabase_migrations.schema_migrations.statements alanından birebir alındı (O-03).
create table if not exists public.user_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  event_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.user_events is 'Basit kullanım analitiği: kullanıcı hangi olayları ne sıklıkla tetikliyor. Sadece Sait''in Supabase Studio üzerinden inceleyeceği ham veri; kullanıcıya gösterilen bir özellik değildir.';
comment on column public.user_events.event_type is 'Örn: quiz_completed, tf_completed, purchase_success, screen_view';
comment on column public.user_events.event_data is 'Olaya özel esnek ek bilgi (ör. kategori, skor, ürün id).';

create index if not exists user_events_user_id_idx on public.user_events (user_id);
create index if not exists user_events_event_type_idx on public.user_events (event_type);
create index if not exists user_events_created_at_idx on public.user_events (created_at);

alter table public.user_events enable row level security;

create policy "user_events: kullanici kendi olayini ekleyebilir"
  on public.user_events for insert
  to authenticated
  with check (auth.uid() = user_id);
