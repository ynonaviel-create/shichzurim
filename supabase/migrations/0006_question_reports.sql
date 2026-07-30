-- ארכיון השחזורים — דיווחי טעויות על שאלות
--
-- כפתור 🚩 על כל שאלה נותן לסטודנטים לדווח על טעות — במקום מייל חופשי שצריך
-- לפענח, מגיע דיווח מובנה: qid, סיבה, המסיח שנבחר, וטקסט חופשי.
--
-- עיקרון הפרטיות של 0002 נשמר: אין SELECT על הטבלה לאף אחד — גם לא למדווח
-- עצמו. הקריאה היחידה היא דרך admin_question_reports (למנהל בלבד), והטיפול
-- דרך admin_set_report_status.
--
-- להרצה: Supabase Dashboard → SQL Editor → הדבק והרץ.

-- ── טבלת הדיווחים ────────────────────────────────────────────────
create table public.question_reports (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  course_id  text not null,
  exam_id    text,
  qid        text not null,
  reason     text not null check (reason in ('wrong_answer', 'typo', 'unclear', 'other')),
  detail     text check (char_length(detail) <= 2000),
  chosen     int,                     -- המסיח שהמדווח בחר (אם ענה) — הקשר יקר לבירור
  q_preview  text,                    -- תחילת נוסח השאלה — כדי שהדיווח קריא גם אם השאלה תזוז
  status     text not null default 'open' check (status in ('open', 'resolved', 'rejected')),
  created_at timestamptz not null default now()
);

alter table public.question_reports enable row level security;

-- כתיבה בלבד, ורק בשם עצמך. אין policy ל-SELECT בכוונה → אין קריאה גולמית.
create policy "insert own reports"
  on public.question_reports
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create index question_reports_status_idx on public.question_reports (status, created_at);

-- ── רסן ספאם ─────────────────────────────────────────────────────
-- האתר ציבורי והכפתור זמין לכל מחובר; 20 דיווחים ביממה זה הרבה יותר ממה
-- שמדווח כן צריך, ומעט מדי בשביל להציף. SECURITY DEFINER כי למדווח אין SELECT.
create or replace function public.question_reports_rate_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if (select count(*) from question_reports
      where user_id = new.user_id
        and created_at > now() - interval '1 day') >= 20 then
    raise exception 'report rate limit reached';
  end if;
  return new;
end;
$$;

create trigger question_reports_rate
  before insert on public.question_reports
  for each row execute function public.question_reports_rate_guard();

-- ── קריאה וטיפול (רק למנהל) ──────────────────────────────────────
create or replace function public.admin_question_reports(st text default 'open', lim int default 100)
returns table(
  id bigint, course_id text, exam_id text, qid text, reason text,
  detail text, chosen int, q_preview text, status text, created_at timestamptz
)
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  return query
    select r.id, r.course_id, r.exam_id, r.qid, r.reason,
           r.detail, r.chosen, r.q_preview, r.status, r.created_at
    from question_reports r
    where st = 'all' or r.status = st
    order by r.created_at desc
    limit lim;
end;
$$;

create or replace function public.admin_set_report_status(rid bigint, new_status text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  if new_status not in ('open', 'resolved', 'rejected') then
    raise exception 'bad status';
  end if;
  update question_reports set status = new_status where id = rid;
end;
$$;

grant execute on function public.admin_question_reports(text, int)  to authenticated;
grant execute on function public.admin_set_report_status(bigint, text) to authenticated;
