-- O-01: İade hesabı ve elle verilmiş premium'un korunması.
--
-- Sorunlar:
--   * apply_purchase_void, max(granted_until) ile yeniden hesaplıyordu. Satın
--     almalar üst üste eklendiği (stacking) için ilk paket iade edildiğinde
--     sonraki paketin kümülatif tarihi değişmiyor, iade edilen günler
--     kullanıcıda kalıyordu.
--   * İade, elle (manual) verilmiş premium'u da sıfırlıyordu.
--   * apply_verified_purchase, süresiz (premium_until IS NULL) manual premium'u
--     süreli premium'a düşürüyordu.
--
-- Düzeltme:
--   * purchases.duration_days saklanır (eski satırlar premium_products'tan doldurulur).
--   * İade, premium_until'dan YALNIZCA iade edilen paketin süresini düşer.
--   * Süresiz manual premium'a hiçbir yolda dokunulmaz.

alter table public.purchases
  add column if not exists duration_days integer;

update public.purchases p
set duration_days = pp.duration_days
from public.premium_products pp
where pp.product_id = p.product_id
  and p.duration_days is null;

alter table public.purchases
  drop constraint if exists purchases_duration_days_check;
alter table public.purchases
  add constraint purchases_duration_days_check check (duration_days is null or duration_days > 0);

create or replace function public.apply_verified_purchase(
  p_user_id uuid,
  p_product_id text,
  p_purchase_token text,
  p_order_id text,
  p_raw_response jsonb default null::jsonb
)
returns table(granted_until timestamptz, already_applied boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_duration integer;
  v_profile record;
  v_new_until timestamptz;
  v_existing purchases%rowtype;
  v_lifetime boolean;
begin
  select * into v_existing from public.purchases where purchase_token = p_purchase_token;
  if found then
    return query select v_existing.granted_until, true;
    return;
  end if;

  select duration_days into v_duration
  from public.premium_products
  where product_id = p_product_id and is_active;
  if v_duration is null then
    raise exception 'Geçersiz veya pasif ürün: %', p_product_id;
  end if;

  select is_premium, premium_until, premium_source into v_profile
  from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'Kullanıcı profili bulunamadı (id: %)', p_user_id;
  end if;

  -- Süresiz manual premium: profile dokunma, yalnızca satın almayı kaydet.
  v_lifetime := v_profile.is_premium and v_profile.premium_until is null;

  v_new_until := greatest(coalesce(v_profile.premium_until, now()), now()) + make_interval(days => v_duration);

  if not v_lifetime then
    update public.profiles
    set is_premium = true,
        premium_until = v_new_until,
        premium_source = 'play_billing'
    where id = p_user_id;
  end if;

  insert into public.purchases (user_id, product_id, purchase_token, order_id, granted_until, duration_days, raw_response)
  values (p_user_id, p_product_id, p_purchase_token, p_order_id, v_new_until, v_duration, p_raw_response);

  return query select case when v_lifetime then null::timestamptz else v_new_until end, false;
end;
$function$;

create or replace function public.apply_purchase_void(p_purchase_token text, p_new_status text)
returns table(user_id uuid, new_premium_until timestamptz, found boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_purchase purchases%rowtype;
  v_profile record;
  v_duration integer;
  v_new_until timestamptz;
begin
  if p_new_status not in ('refunded', 'revoked') then
    raise exception 'Geçersiz status: % (refunded veya revoked olmalı)', p_new_status;
  end if;

  select * into v_purchase from public.purchases where purchase_token = p_purchase_token for update;
  if not found then
    return query select null::uuid, null::timestamptz, false;
    return;
  end if;

  -- Zaten işlenmişse (idempotency) tekrar işleme
  if v_purchase.status <> 'verified' then
    return query select v_purchase.user_id, null::timestamptz, true;
    return;
  end if;

  update public.purchases
  set status = p_new_status, updated_at = now()
  where purchase_token = p_purchase_token;

  select p.is_premium, p.premium_until, p.premium_source into v_profile
  from public.profiles p where p.id = v_purchase.user_id for update;

  if not found then
    return query select v_purchase.user_id, null::timestamptz, true;
    return;
  end if;

  -- Süresiz premium (manual) veya bitiş tarihi olmayan profil: dokunma.
  if v_profile.premium_until is null then
    return query select v_purchase.user_id, null::timestamptz, true;
    return;
  end if;

  v_duration := coalesce(
    v_purchase.duration_days,
    (select pp.duration_days from public.premium_products pp where pp.product_id = v_purchase.product_id),
    0
  );

  v_new_until := v_profile.premium_until - make_interval(days => v_duration);

  update public.profiles p
  set premium_until = case when v_new_until > now() then v_new_until else now() end,
      is_premium = v_new_until > now()
  where p.id = v_purchase.user_id;

  return query select v_purchase.user_id, case when v_new_until > now() then v_new_until else null end, true;
end;
$function$;

revoke all on function public.apply_verified_purchase(uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.apply_purchase_void(text, text) from public, anon, authenticated;
grant execute on function public.apply_verified_purchase(uuid, text, text, text, jsonb) to service_role;
grant execute on function public.apply_purchase_void(text, text) to service_role;
