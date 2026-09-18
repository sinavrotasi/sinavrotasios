-- K-01: get_topic_card_preview ücretsiz önizlemeyi `sort_order <= 5` ile
-- sınırlıyordu; production'da soruların ~%99,5'inin sort_order değeri 0
-- olduğundan filtre neredeyse tüm bankayı (answer_index dahil) döndürüyordu.
-- Fonksiyon ayrıca anon rolüyle çağrılabiliyordu.
--
-- Düzeltme:
--   * Önizleme, sort_order'ın içeriğinden bağımsız olarak ÇAĞRI BAŞINA ilk 5
--     satırla sınırlanır (row_number). Sıralama deterministiktir (sort_order, id).
--   * Admin ve aktif premium kullanıcı tüm satırları görmeye devam eder.
--   * total_count upsell mesajı için gerçek toplamı döndürmeye devam eder.
--   * Tek çağrıda gönderilebilecek konu kimliği sayısı sınırlanır (toplu kazıma
--     yüzeyini daraltmak için; istemci tek belgenin alt ağacını gönderir).
--   * anon ve PUBLIC çalıştırma yetkisi kaldırılır.
create or replace function public.get_topic_card_preview(p_topic_ids text[])
returns table(prompt text, options jsonb, answer_index integer, total_count integer)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_full_access boolean := public.is_admin() or public.is_premium();
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  if p_topic_ids is null or coalesce(array_length(p_topic_ids, 1), 0) = 0 then
    return;
  end if;

  if array_length(p_topic_ids, 1) > 200 then
    raise exception 'TOO_MANY_TOPICS' using errcode = 'P0001';
  end if;

  return query
    with base as (
      select
        q.prompt,
        q.options,
        q.answer_index,
        count(*) over () as total_count,
        row_number() over (order by q.sort_order, q.id) as rn
      from public.questions q
      where q.topic_id = any(p_topic_ids)
    )
    select b.prompt, b.options, b.answer_index, b.total_count::integer
    from base b
    where v_full_access or b.rn <= 5
    order by b.rn;
end;
$function$;

comment on function public.get_topic_card_preview(text[]) is
  'Kart önizlemesi: admin/premium için tüm satırlar, diğer oturum açmış kullanıcılar için çağrı başına ilk 5 satır. sort_order içeriğine bağlı DEĞİLDİR (K-01).';

revoke all on function public.get_topic_card_preview(text[]) from public;
revoke all on function public.get_topic_card_preview(text[]) from anon;
grant execute on function public.get_topic_card_preview(text[]) to authenticated;
