-- ארכיון השחזורים — מרחב השם flag ("לחזור לזה")
--
-- סימון אישי לשאלה, כדי שאפשר יהיה לחזור אליה. המפתח הוא qid, והערך 1.
--
-- ── למה אפשר לפרוס את הקוד לפני שזה רץ ──────────────────────────
-- עד שהמיגרציה הזאת תרוץ, Postgres ידחה כל שורת flag. זה בסדר גמור מאז
-- ההקשחה ב-0003: flush() מזהה דחייה קבועה (קוד Postgres בן חמישה תווים /
-- HTTP 4xx) וזורק את הפעולה במקום לחסום מאחוריה את התור. כלומר הסימון
-- פשוט יישאר מקומי עד שתריץ את זה, בלי לפגוע בשום סנכרון אחר.
--
-- אחרי ההרצה הסימונים מתחילים לעבור בין מכשירים לבד, בלי שינוי בקוד.
--
-- להרצה: Supabase Dashboard → SQL Editor → **חלון ריק** → הדבק והרץ.
-- (חלון שכבר מכיל מיגרציה קודמת יריץ אותה שוב וייכשל על "already exists".)

alter table public.user_kv
  drop constraint if exists user_kv_ns_check;

alter table public.user_kv
  add constraint user_kv_ns_check
  check (ns in ('progress', 'seen', 'cardsRead', 'caseProg', 'shinunProg', 'seenH', 'flag'));
