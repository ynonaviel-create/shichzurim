-- ארכיון השחזורים — זהות המשיבים בסקר (למנהל בלבד)
--
-- 0007 החזירה user_id בלבד; ינון צריך לדעת מי כתב מה — מי מחמיא, למי לחזור.
-- הפונקציה מוחלפת בגרסה שמצרפת מייל ושם תצוגה מ-auth.users. עדיין נעולה
-- מאחורי is_admin() — משתמש רגיל מקבל שגיאה, כמו בכל פונקציות ה-admin.
--
-- להרצה: Supabase Dashboard → SQL Editor → הדבק והרץ.

drop function if exists public.admin_survey_results(int);

create or replace function public.admin_survey_results(ver int default 1)
returns table(user_id uuid, email text, display_name text, answers jsonb, created_at timestamptz)
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  return query
    select distinct on (s.user_id)
           s.user_id,
           u.email::text,
           coalesce(u.raw_user_meta_data->>'display_name',
                    u.raw_user_meta_data->>'full_name',
                    u.raw_user_meta_data->>'name', '')::text,
           s.answers,
           s.created_at
    from survey_responses s
    join auth.users u on u.id = s.user_id
    where s.version = ver
    order by s.user_id, s.created_at desc;
end;
$$;

grant execute on function public.admin_survey_results(int) to authenticated;
