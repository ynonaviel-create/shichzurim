-- ארכיון השחזורים — לוח בקרה v2: תובנות מ-user_kv + תיקוני אזור זמן
--
-- ── למה מיגרציה חדשה ─────────────────────────────────────────────
-- 0002 כבר רצה בייצור — לא עורכים אותה. הפונקציות הישנות נשארות תקפות
-- (קליינט ישן שמור במטמון עוד קורא להן); הלוח החדש קורא לפונקציות כאן.
--
-- ── מה חדש ───────────────────────────────────────────────────────
-- 1. אזור זמן אחיד: כל חלוקה ל"יום" נעשית לפי Asia/Jerusalem. ב-0002 הגרפים
--    היומיים קובצו לפי UTC וגרף השעות לפי ישראל — שני גרפים באותו עמוד
--    שחלוקים על מהו "יום", ופעילות ערב ישראלית נפלה ליום הבא.
-- 2. "מתי משתמשים" סופר משתמשים ייחודיים, לא אירועים — כמו שהכותרת מבטיחה.
-- 3. קריאה ראשונה של user_kv: דירוג קושי אמיתי לשאלות, פילוח מסיחים,
--    ציונים ונטישה למבחן, ובריאות השינון — מדאטה שכבר קיים מ-116 משתמשים.
--
-- ── פרטיות ───────────────────────────────────────────────────────
-- ההבטחה "רק אתה רואה את ההתקדמות שלך" נשמרת: הכול אגרגטיבי בלבד, מאחורי
-- is_admin(), עם רצפת מינימום (min_n) על כל נתון ברמת שאלה/מבחן — כך שאי
-- אפשר להסיק מה סטודנט בודד ענה. אין drill-down לפי משתמש, אין רשימות שמות.
--
-- להרצה: Supabase Dashboard → SQL Editor → הדבק והרץ.

-- ── סקירה כללית v2 ───────────────────────────────────────────────
-- כמו admin_overview אבל "היום" לפי שעון ישראל, ועם שני מדדי נטישה:
--   never_active — נרשמו לפני שבוע+ ומעולם לא ייצרו אירוע.
--   one_and_done — כל הפעילות שלהם נכנסה ליממה אחת, לפני שבועיים+.
create or replace function public.admin_overview_v2()
returns json
language plpgsql security definer set search_path = public, auth
as $$
declare il_today date := (now() at time zone 'Asia/Jerusalem')::date;
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  return (select json_build_object(
    'total_users',  (select count(*) from auth.users),
    'new_7d',       (select count(*) from auth.users where created_at > now() - interval '7 days'),
    'new_30d',      (select count(*) from auth.users where created_at > now() - interval '30 days'),
    'active_today', (select count(distinct user_id) from events
                     where (created_at at time zone 'Asia/Jerusalem')::date = il_today),
    'active_7d',    (select count(distinct user_id) from events
                     where created_at > now() - interval '7 days'),
    'active_30d',   (select count(distinct user_id) from events
                     where created_at > now() - interval '30 days'),
    'never_active', (select count(*) from auth.users u
                     where u.created_at < now() - interval '7 days'
                       and not exists (select 1 from events e where e.user_id = u.id)),
    'one_and_done', (select count(*) from (
                       select 1 from events group by user_id
                       having max(created_at) - min(created_at) < interval '1 day'
                          and max(created_at) < now() - interval '14 days') t),
    'events_total', (select count(*) from events)
  ));
end;
$$;

-- ── פעילים ליום, שעון ישראל, עם פיצול חדש/חוזר ───────────────────
-- new_n — כמה מהפעילים באותו יום זה היום הראשון שלהם אי-פעם.
create or replace function public.admin_activity_daily(days int default 30)
returns table(day date, n bigint, new_n bigint)
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  return query
    with firsts as (
      select user_id, min((created_at at time zone 'Asia/Jerusalem')::date) as first_day
      from events group by user_id
    )
    select (e.created_at at time zone 'Asia/Jerusalem')::date as d,
           count(distinct e.user_id) as n,
           count(distinct e.user_id) filter
             (where f.first_day = (e.created_at at time zone 'Asia/Jerusalem')::date) as new_n
    from events e join firsts f using (user_id)
    where e.created_at > now() - (days || ' days')::interval
    group by 1 order by 1;
end;
$$;

-- ── הרשמות ליום, שעון ישראל ──────────────────────────────────────
create or replace function public.admin_signups_daily_v2(days int default 30)
returns table(day date, n bigint)
language plpgsql security definer set search_path = public, auth
as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  return query
    select (created_at at time zone 'Asia/Jerusalem')::date as d, count(*) as n
    from auth.users
    where created_at > now() - (days || ' days')::interval
    group by 1 order by 1;
end;
$$;

-- ── משתמשים ייחודיים לפי שעה ביום (0–23), שעון ישראל ─────────────
-- בניגוד ל-admin_active_hourly הישן שספר אירועים: כאן משתמש נספר פעם אחת
-- לשעה, ולכן הצורה לא מתנפחת ממי שמקליק הרבה.
create or replace function public.admin_hourly_users(days int default 30)
returns table(hour int, n bigint)
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  return query
    select extract(hour from created_at at time zone 'Asia/Jerusalem')::int as h,
           count(distinct user_id) as n
    from events
    where created_at > now() - (days || ' days')::interval
    group by 1 order by 1;
end;
$$;

-- ── דירוג קושי אמיתי — מ-ns='seen' ───────────────────────────────
-- שורה לכל (משתמש, שאלה): v=1 המצב האחרון נכון, v=0 שגוי. attempts = כמה
-- משתמשים ענו אי-פעם; wrong = אצל כמה המצב האחרון שגוי. ממוין מהקשה לקלה.
-- מכסה גם תרגול חופשי (שכותב ל-seen), בניגוד לפילוח המסיחים שלמטה.
-- רצפת פרטיות: שאלה עם פחות מ-min_n עונים לא מוחזרת כלל.
create or replace function public.admin_question_stats(min_n int default 10, lim int default 25)
returns table(qid text, attempts bigint, wrong bigint)
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  return query
    select u.k,
           count(*) as attempts,
           count(*) filter (where u.v = '0'::jsonb) as wrong
    from user_kv u
    where u.ns = 'seen'
    group by u.k
    having count(*) >= min_n
    order by (count(*) filter (where u.v = '0'::jsonb))::numeric / count(*) desc,
             count(*) desc
    limit lim;
end;
$$;

-- ── פילוח מסיחים — מ-ns='progress' ───────────────────────────────
-- לכל qid מבוקש: כמה משתמשים בחרו כל אינדקס מסיח. רק רשומות v=2 (ממופתחות
-- qid); אותה שאלה חיה גם בשחזור וגם ב-High Yield שנבנה ממנו — משתמש שענה
-- בשניהם נספר פעם אחת, לפי הרשומה העדכנית.
-- הקליינט (שמכיר את תוכן השאלה) מסמן מי מהאינדקסים הוא הנכון.
-- סייג שמוצג גם בלוח: תרגול חופשי ו"הטעויות שלי" רצים בלי שמירה — הבחירה
-- שם לא קיימת כאן. הפילוח משקף מענה במבחנים בלבד.
create or replace function public.admin_answer_breakdown(qids text[], min_n int default 10)
returns table(qid text, choice int, n bigint)
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  return query
    with latest as (
      select distinct on (u.user_id, a.key)
             a.key as q, (a.value #>> '{}')::int as c
      from user_kv u, jsonb_each(u.v -> 'answers') a
      where u.ns = 'progress'
        and (u.v ->> 'v') = '2'
        and jsonb_typeof(a.value) = 'number'
        and a.key = any(qids)
      order by u.user_id, a.key, u.updated_at desc
    ),
    ok as (select l.q from latest l group by l.q having count(*) >= min_n)
    select l.q, l.c, count(*) as n
    from latest l join ok using (q)
    group by l.q, l.c
    order by l.q, l.c;
end;
$$;

-- ── ציונים ונטישה לפי מבחן — מ-ns='progress' ─────────────────────
-- started  — פתחו וענו לפחות שאלה אחת.
-- finished — סיימו (done=true).
-- zero     — נפתחה רשומה ולא נענתה אף שאלה (נטישה מיידית).
-- hist     — התפלגות מספר הנכונות בקרב המסיימים, {"12": 3, ...}. הקליינט,
--            שיודע כמה שאלות במבחן, ממיר לאחוזים. מוחזר רק כשיש לפחות
--            min_n מסיימים — רצפת הפרטיות.
create or replace function public.admin_exam_stats(min_n int default 10)
returns table(exam_id text, started bigint, finished bigint, zero bigint, hist jsonb)
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  return query
    with p as (
      select u.k as ex,
             coalesce(u.v ->> 'done', '') = 'true' as done,
             coalesce(u.v -> 'answers', '{}'::jsonb) <> '{}'::jsonb as answered,
             nullif(u.v ->> 'correct', '')::numeric as correct
      from user_kv u
      where u.ns = 'progress'
    ),
    sums as (
      select p.ex,
             count(*) filter (where p.answered) as started,
             count(*) filter (where p.done) as finished,
             count(*) filter (where not p.answered) as zero
      from p group by p.ex
    ),
    h as (
      select p.ex, p.correct::int as c, count(*) as cnt
      from p where p.done and p.correct is not null
      group by p.ex, p.correct::int
    ),
    hh as (select h.ex, jsonb_object_agg(h.c::text, h.cnt) as hist from h group by h.ex)
    select s.ex, s.started, s.finished, s.zero,
           case when s.finished >= min_n then hh.hist else null end
    from sums s left join hh on hh.ex = s.ex
    order by s.started desc;
end;
$$;

-- ── בריאות השינון — מ-ns='shinunProg' ────────────────────────────
-- boxes — כמה פריטים בכל קופסת לייטנר (0–3), על פני כל המשתמשים.
-- stuck — פריטים שיושבים בקופסה 0 ולא נגעו בהם שבועיים+ (leech).
create or replace function public.admin_shinun_health()
returns json
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  return (select json_build_object(
    'users', (select count(distinct user_id) from user_kv where ns = 'shinunProg'),
    'items', (select count(*) from user_kv where ns = 'shinunProg'),
    'boxes', (select coalesce(json_object_agg(b, cnt), '{}'::json) from (
                select coalesce(nullif(v ->> 'b', '')::int, 0) as b, count(*) as cnt
                from user_kv where ns = 'shinunProg' group by 1) t),
    'stuck', (select count(*) from user_kv
              where ns = 'shinunProg'
                and coalesce(nullif(v ->> 'b', '')::int, 0) = 0
                and updated_at < now() - interval '14 days')
  ));
end;
$$;

-- ── בריאות תפעולית ───────────────────────────────────────────────
-- הגלאי לתקלה מסוג 0003: אם "פעילים היום לפי אירועים" גבוה משמעותית מ"כתבו
-- ל-user_kv היום" — הסנכרון שבור אצל חלק מהמשתמשים והם לא יודעים. וכן
-- כותבים לפי namespace בשבוע — מרחב שם שצנח לאפס הוא תור מורעל.
create or replace function public.admin_ops_health()
returns json
language plpgsql security definer set search_path = public
as $$
declare il_today date := (now() at time zone 'Asia/Jerusalem')::date;
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  return (select json_build_object(
    'events_1h',         (select count(*) from events where created_at > now() - interval '1 hour'),
    'last_event_at',     (select max(created_at) from events),
    'event_users_today', (select count(distinct user_id) from events
                          where (created_at at time zone 'Asia/Jerusalem')::date = il_today),
    'kv_users_today',    (select count(distinct user_id) from user_kv
                          where (updated_at at time zone 'Asia/Jerusalem')::date = il_today),
    'ns_7d', (select coalesce(json_agg(row_to_json(t) order by t.users desc), '[]'::json) from (
                select ns, count(distinct user_id) as users, count(*) as rows
                from user_kv
                where updated_at > now() - interval '7 days'
                group by ns) t)
  ));
end;
$$;

-- ── הרשאות ריצה ──────────────────────────────────────────────────
-- כמו ב-0002: כל מחובר רשאי לקרוא, is_admin() חוסם בפועל.
grant execute on function public.admin_overview_v2()                to authenticated;
grant execute on function public.admin_activity_daily(int)          to authenticated;
grant execute on function public.admin_signups_daily_v2(int)        to authenticated;
grant execute on function public.admin_hourly_users(int)            to authenticated;
grant execute on function public.admin_question_stats(int, int)     to authenticated;
grant execute on function public.admin_answer_breakdown(text[], int) to authenticated;
grant execute on function public.admin_exam_stats(int)              to authenticated;
grant execute on function public.admin_shinun_health()              to authenticated;
grant execute on function public.admin_ops_health()                 to authenticated;
