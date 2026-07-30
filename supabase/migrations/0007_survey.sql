-- ארכיון השחזורים — סקר משוב סוף-סמסטר
--
-- עמוד #/survey באתר אוסף משוב מובנה לפני שהמשתמשים נעלמים עד המבחנים הבאים.
-- כל התשובות נשמרות כמסמך jsonb אחד — הנוסח והשאלות ישתנו בין סבבים, ולכן
-- אין טור-לכל-שאלה; version מזהה את סבב הסקר (1 = סוף סמסטר ב', יולי 2026).
--
-- עיקרון הפרטיות של 0002 נשמר: אין SELECT על הטבלה לאף אחד — גם לא למשיב
-- עצמו. הקריאה היחידה היא דרך admin_survey_results (למנהל בלבד).
-- שליחה חוזרת של אותו משתמש = שורה חדשה; בניתוח לוקחים את האחרונה.
--
-- להרצה: Supabase Dashboard → SQL Editor → הדבק והרץ.

-- ── טבלת התשובות ─────────────────────────────────────────────────
create table public.survey_responses (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  version    int not null default 1,
  answers    jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.survey_responses enable row level security;

-- כתיבה בלבד, ורק בשם עצמך. אין policy ל-SELECT בכוונה → אין קריאה גולמית.
create policy "insert own survey"
  on public.survey_responses
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create index survey_responses_user_idx on public.survey_responses (user_id, created_at);

-- ── רסן ספאם ─────────────────────────────────────────────────────
-- שליחה אחת ביממה למשתמש: מספיק כדי לתקן תשובה למחרת, מעט מדי בשביל להציף.
-- SECURITY DEFINER כי למשיב אין SELECT.
create or replace function public.survey_rate_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if (select count(*) from survey_responses
      where user_id = new.user_id
        and created_at > now() - interval '1 day') >= 1 then
    raise exception 'survey rate limit reached';
  end if;
  return new;
end;
$$;

create trigger survey_responses_rate
  before insert on public.survey_responses
  for each row execute function public.survey_rate_guard();

-- ── קריאה (רק למנהל) ─────────────────────────────────────────────
-- מחזירה את התשובה האחרונה של כל משתמש בסבב המבוקש. user_id מוחזר כדי
-- שאפשר יהיה להצליב עם events, אבל בלי מייל — הזיהוי נשאר ב-auth.users.
create or replace function public.admin_survey_results(ver int default 1)
returns table(user_id uuid, answers jsonb, created_at timestamptz)
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  return query
    select distinct on (s.user_id) s.user_id, s.answers, s.created_at
    from survey_responses s
    where s.version = ver
    order by s.user_id, s.created_at desc;
end;
$$;

grant execute on function public.admin_survey_results(int) to authenticated;
