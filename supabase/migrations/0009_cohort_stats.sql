-- 0009: דירוג קושי לכל המחזור — הפעם לסטודנטים, לא רק ללוח הבקרה.
--
-- ⚠️ טרם הורץ. להריץ ב-SQL Editor של Supabase, ואז לסמן ב-MIGRATIONS-RUN.md.
-- עד ההרצה — האתר פשוט לא מציג את שכבת הקושי (דעיכה שקטה מלאה בקליינט).
--
-- מה זה נותן: צ׳יפ "קשות למחזור" בתרגול החופשי ותג "N% מהמחזור טעו כאן"
-- במשוב. אותה שאילתה בדיוק כמו admin_question_stats שכבר רצה בלוח הבקרה,
-- בשני הבדלים: אין is_admin (כל משתמש *מחובר* רשאי), והתקרה רחבה יותר כדי
-- שהקליינט יוכל לסנן לפי קורס (ה-qid הוא האש אטום — הקורס ידוע רק לקליינט).
--
-- מה זה לא חושף: שום דבר אישי. אגרגט בלבד, בלי user_id, ועם רצפת הפרטיות
-- הקבועה של הפרויקט (MIGRATIONS-RUN.md): שאלה עם פחות מ-10 עונים לא
-- מוחזרת כלל. anon נשאר בחוץ — כמו בכל שאר הסכימה.

create or replace function public.cohort_question_stats(min_n int default 10, lim int default 500)
returns table(qid text, attempts bigint, wrong bigint)
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  return query
    select u.k,
           count(*) as attempts,
           count(*) filter (where u.v = '0'::jsonb) as wrong
    from user_kv u
    where u.ns = 'seen'
    group by u.k
    having count(*) >= greatest(min_n, 10)   -- הרצפה לא ניתנת לעקיפה מהקליינט
    order by (count(*) filter (where u.v = '0'::jsonb))::numeric / count(*) desc,
             count(*) desc
    limit least(lim, 1000);
end;
$$;

revoke all on function public.cohort_question_stats(int, int) from public;
grant execute on function public.cohort_question_stats(int, int) to authenticated;
