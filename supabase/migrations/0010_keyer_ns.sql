-- ארכיון השחזורים — מרחב השם keyerProg (מפתח ההגדרה)
--
-- ההתקדמות במשחק הזיהוי: המפתח הוא "deck#item", והערך אובייקט
-- {clues, tests[], wrong[], done, order[]} — כמה רמזים נחשפו, אילו בדיקות הורצו,
-- אילו ניחושים היו שגויים, האם זוהה, ובאיזה סדר הוצגו המסיחים.
-- המיזוג בין מכשירים (cloud.js): תיק שזוהה מנצח; אחרת מי שהתקדם יותר.
--
-- כמו ב-0004: אפשר לפרוס את הקוד לפני שזה רץ. עד אז Postgres דוחה כל שורת
-- keyerProg, flush() זורק אותה, וההתקדמות נשארת מקומית בלי לפגוע בסנכרון אחר.
--
-- להרצה: Supabase Dashboard → SQL Editor → **חלון ריק** → הדבק והרץ.

alter table public.user_kv
  drop constraint if exists user_kv_ns_check;

alter table public.user_kv
  add constraint user_kv_ns_check
  check (ns in ('progress', 'seen', 'cardsRead', 'caseProg', 'shinunProg', 'seenH', 'flag', 'keyerProg'));
