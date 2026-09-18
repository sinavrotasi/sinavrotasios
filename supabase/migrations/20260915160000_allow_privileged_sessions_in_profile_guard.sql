-- profiles koruma trigger'ı: ayrıcalıklı oturumlardan yapılan elle düzeltmelere izin ver.
--
-- Sorun (2026-09-15 iade testi sırasında görüldü):
--   protect_privileged_profile_columns, isteğin service_role ya da admin
--   kimliğiyle gelmediği her durumda is_premium / premium_until /
--   premium_source / is_admin / role değişikliklerini sessizce geri alıyordu.
--   SQL Editor, psql ve pg_dump gibi doğrudan veritabanı bağlantıları JWT
--   taşımadığı için (auth.role() ve auth.uid() NULL), yöneticinin SQL ile
--   yaptığı premium düzeltmeleri hata vermeden yok sayılıyordu.
--
-- Düzeltme:
--   Uygulama, admin paneli ve Edge Function istekleri PostgREST üzerinden
--   gelir; PostgREST veritabanına her zaman `authenticator` oturumuyla bağlanıp
--   `SET ROLE` ile anon/authenticated/service_role'e geçer. `session_user`
--   SET ROLE ile değişmez. Bu nedenle `session_user <> 'authenticator'`
--   yalnızca doğrudan (zaten tam yetkili) veritabanı bağlantılarında doğrudur.
--   API üzerinden gelen isteklerde koruma aynen devam eder.

create or replace function public.protect_privileged_profile_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  -- Doğrudan veritabanı oturumu (SQL Editor, psql, migration'lar) ya da
  -- service_role anahtarıyla gelen API isteği: kısıtlama yok.
  if session_user <> 'authenticator' or auth.role() = 'service_role' then
    return new;
  end if;

  if not public.is_admin() then
    new.is_admin := old.is_admin;
    new.is_premium := old.is_premium;
    new.premium_until := old.premium_until;
    new.premium_source := old.premium_source;

    -- Kadro kilidi: ilk seçimden sonra kullanıcı değiştiremez (O-02).
    if old.role is not null and new.role is distinct from old.role then
      new.role := old.role;
    end if;
  end if;

  return new;
end;
$function$;

revoke all on function public.protect_privileged_profile_columns() from public, anon, authenticated;

comment on function public.protect_privileged_profile_columns() is
  'API (authenticator oturumu) üzerinden gelen, admin olmayan isteklerde ayrıcalıklı profil alanlarını ve ilk seçimden sonra kadroyu korur. Doğrudan DB oturumları ve service_role serbesttir.';
