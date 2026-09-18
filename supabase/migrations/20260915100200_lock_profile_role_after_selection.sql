-- O-02 / O-08: "Kadro bir kez seçilir, sonradan değiştirilemez" ürün kuralı
-- yalnızca arayüzde uygulanıyordu; authenticated rolü profiles.role sütununu
-- REST API üzerinden serbestçe güncelleyebiliyordu.
--
-- Düzeltme:
--   * role yalnızca NULL iken (ilk seçim) kullanıcı tarafından yazılabilir.
--     Sonraki değişiklikler yalnızca admin veya service_role ile yapılır.
--   * role değeri geçerli kadro anahtarlarıyla sınırlandırılır.
--   * Mevcut koruma (is_admin / is_premium / premium_until) korunur;
--     premium_source da istemci tarafından değiştirilemez hale getirilir.

alter table public.profiles
  drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role is null or role in ('memur', 'sef', 'sayman', 'sube-mudur'));

create or replace function public.protect_privileged_profile_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  if not public.is_admin() then
    new.is_admin := old.is_admin;
    new.is_premium := old.is_premium;
    new.premium_until := old.premium_until;
    new.premium_source := old.premium_source;

    -- Kadro kilidi: ilk seçimden sonra kullanıcı değiştiremez.
    if old.role is not null and new.role is distinct from old.role then
      new.role := old.role;
    end if;
  end if;

  return new;
end;
$function$;

revoke all on function public.protect_privileged_profile_columns() from public, anon, authenticated;

comment on column public.profiles.role is
  'Kullanıcının kadrosu (memur/sef/sayman/sube-mudur). İlk seçimden sonra yalnızca admin değiştirebilir (O-02).';
