-- O-10: "İlerlemeyi sıfırla" kart (Leitner) ilerlemesini temizleyemiyordu;
--       flashcard_progress için istemci DELETE politikası yoktu.
-- D-04: RLS politikalarında auth.uid() her satırda yeniden değerlendiriliyordu
--       (auth_rls_initplan) ve bazı FK sütunları indekssizdi.

drop policy if exists flashcard_progress_own_read on public.flashcard_progress;
drop policy if exists flashcard_progress_own_write on public.flashcard_progress;
drop policy if exists flashcard_progress_own_update on public.flashcard_progress;
drop policy if exists flashcard_progress_own_delete on public.flashcard_progress;

create policy flashcard_progress_own_read on public.flashcard_progress
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy flashcard_progress_own_write on public.flashcard_progress
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy flashcard_progress_own_update on public.flashcard_progress
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy flashcard_progress_own_delete on public.flashcard_progress
  for delete to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists quiz_sessions_owner_select on public.quiz_sessions;
create policy quiz_sessions_owner_select on public.quiz_sessions
  for select to authenticated
  using (user_id = (select auth.uid()));

create index if not exists flashcard_progress_deck_id_idx on public.flashcard_progress (deck_id);
create index if not exists flashcard_progress_flashcard_id_idx on public.flashcard_progress (flashcard_id);
create index if not exists flashcard_progress_user_next_review_idx on public.flashcard_progress (user_id, next_review_at);
create index if not exists quiz_sessions_user_id_idx on public.quiz_sessions (user_id);
