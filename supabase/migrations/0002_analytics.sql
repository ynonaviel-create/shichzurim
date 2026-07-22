-- ארכיון השחזורים — מעקב וסטטיסטיקות (אגרגטיבי בלבד)
--
-- עיקרון: לאף אחד אין הרשאת SELECT על events — גם לא לבעל השורה. הדרך היחידה
-- לקרוא נתונים היא דרך פונקציות admin_* (SECURITY DEFINER) שמחזירות רק אגרגטים
-- ורק למנהל (ינון). כך "רק אתה רואה את ההתקדמות שלך" נשמר: אין דרך, דרך ה-API,
-- לשלוף מה סטודנט בודד עשה.
--
-- להרצה: Supabase Dashboard → SQL Editor → הדבק והרץ.

-- ── טבלת האירועים ────────────────────────────────────────────────
create table public.events (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  type       text not null,          -- 'view' | 'answer' | 'login'
  target     text,                   -- courseId / examId / simId / route
  created_at timestamptz not null default now()
);

alter table public.events enable row level security;

-- כתיבה בלבד, ורק שורות של עצמך. אין policy ל-SELECT בכוונה → אין קריאה גולמית.
create policy "insert own events"
  on public.events
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create index events_created_idx on public.events (created_at);
create index events_type_target_idx on public.events (type, target, created_at);

-- ── מי מנהל ──────────────────────────────────────────────────────
-- רשימת האימיילים שרשאים לראות סטטיסטיקות. לעריכה: הוסף/הסר כאן.
create or replace function public.is_admin()
returns boolean
language sql stable
as $$
  select coalesce(auth.jwt() ->> 'email', '') in (
    'avielyin@post.bgu.ac.il',
    'ynonaviel@gmail.com'
  )
$$;

-- ── פונקציות אגרגטיביות (רק למנהל) ───────────────────────────────
-- כולן SECURITY DEFINER (רצות כבעלים, כדי לקרוא auth.users ולעקוף RLS על events)
-- אבל נעולות מאחורי is_admin() — משתמש רגיל שיקרא להן מקבל שגיאה.

create or replace function public.admin_overview()
returns json
language plpgsql security definer set search_path = public, auth
as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  return (select json_build_object(
    'total_users',   (select count(*) from auth.users),
    'new_7d',        (select count(*) from auth.users where created_at > now() - interval '7 days'),
    'new_30d',       (select count(*) from auth.users where created_at > now() - interval '30 days'),
    'active_today',  (select count(distinct user_id) from events where created_at::date = now()::date),
    'active_7d',     (select count(distinct user_id) from events where created_at > now() - interval '7 days'),
    'active_30d',    (select count(distinct user_id) from events where created_at > now() - interval '30 days'),
    'events_total',  (select count(*) from events)
  ));
end;
$$;

-- הרשמות ליום ב-N הימים האחרונים
create or replace function public.admin_signups_daily(days int default 30)
returns table(day date, n bigint)
language plpgsql security definer set search_path = public, auth
as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  return query
    select created_at::date as day, count(*) as n
    from auth.users
    where created_at > now() - (days || ' days')::interval
    group by 1 order by 1;
end;
$$;

-- משתמשים ייחודיים פעילים ליום
create or replace function public.admin_active_daily(days int default 30)
returns table(day date, n bigint)
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  return query
    select created_at::date as day, count(distinct user_id) as n
    from events
    where created_at > now() - (days || ' days')::interval
    group by 1 order by 1;
end;
$$;

-- שעות שיא — פעילות לפי שעה ביום (0–23), לפי אזור הזמן של ישראל
create or replace function public.admin_active_hourly(days int default 30)
returns table(hour int, n bigint)
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  return query
    select extract(hour from created_at at time zone 'Asia/Jerusalem')::int as hour,
           count(*) as n
    from events
    where created_at > now() - (days || ' days')::interval
    group by 1 order by 1;
end;
$$;

-- מה הכי בשימוש — לפי type+target
create or replace function public.admin_top_targets(days int default 30, lim int default 20)
returns table(type text, target text, n bigint, users bigint)
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  return query
    select e.type, e.target, count(*) as n, count(distinct e.user_id) as users
    from events e
    where e.created_at > now() - (days || ' days')::interval
      and e.target is not null
    group by e.type, e.target
    order by n desc
    limit lim;
end;
$$;

-- הרשאות ריצה: כל משתמש מחובר יכול לקרוא, אבל is_admin() חוסם בפועל.
grant execute on function public.admin_overview()            to authenticated;
grant execute on function public.admin_signups_daily(int)    to authenticated;
grant execute on function public.admin_active_daily(int)     to authenticated;
grant execute on function public.admin_active_hourly(int)    to authenticated;
grant execute on function public.admin_top_targets(int,int)  to authenticated;
