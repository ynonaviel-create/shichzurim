-- ארכיון השחזורים — טבלת מצב המשתמש (שלב 1: חשבונות + סנכרון)
--
-- טבלה אחת, מראה 1:1 של מפתחות ה-localStorage שבאתר:
--   ns='progress'  → shichzurim.v1        k=examId        v=רשומת מבחן {answers,correct,done,at,v}
--   ns='seen'      → shichzurim.seen      k=qKey (qid)    v=1|0
--   ns='cardsRead' → shichzurim.cardsRead k="cardsId#i"   v=1
--   ns='caseProg'  → shichzurim.caseProg  k="deck#case"   v=מערך תשובות
--
-- להרצה: Supabase Dashboard → SQL Editor → הדבק והרץ.

create table public.user_kv (
  user_id    uuid not null references auth.users(id) on delete cascade,
  ns         text not null check (ns in ('progress','seen','cardsRead','caseProg')),
  k          text not null,
  v          jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, ns, k)
);

alter table public.user_kv enable row level security;

-- כל משתמש רואה ונוגע רק בשורות של עצמו. אין מדיניות ל-anon בכלל.
create policy "own rows"
  on public.user_kv
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- updated_at מתעדכן אוטומטית בכל שינוי (משמש למשיכה מצטברת בעתיד).
create extension if not exists moddatetime schema extensions;

create trigger user_kv_touch
  before update on public.user_kv
  for each row execute function extensions.moddatetime(updated_at);
