# ארכיון השחזורים — Liquid Glass

מערכת העיצוב של אתר לימוד רפואה בעברית. **RTL תמיד** (`<html dir="rtl" lang="he">`),
גופן Assistant, שני מצבים: בהיר (ברירת מחדל) וכהה דרך `data-theme="dark"` על `<html>`.

## חוקים שאסור לשבור

1. **טוענים את `styles.css` — הכול נשען עליו.** אין רכיבי JS; זו מערכת HTML+CSS.
   כל המחלקות אמיתיות מהאתר החי (`.card`, `.btn.primary`, `.opt`, `.bnav`…).
2. **צבע דרך משתנים בלבד — אין צבע קשיח.** `var(--text)`, `var(--muted)`,
   `var(--surface)`, `var(--accent)`. צבע-קורס: מציבים `--course-accent`
   (ו---course-accent-dk/-sl) על עוטף, וכל מה שבפנים מתכוון אליו.
   פלטת הקורסים: קליני `#0d8b84` · מולקולרית `#9a92ee` · אלקטרו `#EF9F27` ·
   פיזיקה `#5ba3e8` · ביוכימיה `#8fc24a`.
3. **הזכוכית מגיעה מהמחלקות, לא ממך.** `.card`/`.stat`/`.nextup` כבר נושאים
   backdrop-blur, קצה-אור ופס-ברק. אל תוסיף box-shadow/border משלך — עטוף
   במחלקה הנכונה. הרקע חייב הילות: `body` מקבל את האורורה אוטומטית מ-styles.css.
4. **רדיוסים וצללים מהטוקנים:** `var(--radius)` (22px), `var(--radius-sm)` (14px),
   `var(--shadow)`, `var(--shadow-lg)`. סקאלת טקסט: `--fs-xs`…`--fs-2xl`.
5. **כפתור ראשי אחד לכל אזור** (`.btn.primary` — עדשה זוהרת); השאר `.btn`/`.btn.ghost`.
   כל כפתור מקבל `title` שמסביר מה יקרה. חריג: מסיחי תשובה (`.opt`) — בלי title.
6. סמנטיקה: ירוק/אדום (`--good`/`--bad`) רק לנכון/שגוי; סגול (`--topic-*`) לתגי נושא.

## דוגמה קנונית

```html
<div style="--course-accent:#EF9F27; --course-accent-dk:#c77f13; --course-accent-sl:#33280f">
  <div class="card">
    <h3>אלקטרופיזיולוגיה</h3>
    <div class="card-meta"><span class="tag">2026</span><span class="tag official">✓ רשמי</span></div>
    <div class="btn-row"><a class="btn primary">🏋️ בחרו ותרגלו</a><a class="btn">🎯 הטעויות שלי</a></div>
  </div>
</div>
```

## איפה האמת

`styles.css` → מייבא את `tokens.css` (כל הטוקנים, שני המצבים), `style.css`
(הרכיבים + שכבת ה-Liquid Glass בסופו), `components.css`. לכל רכיב יש
`components/<קבוצה>/<שם>/<שם>.prompt.md` עם המרקאפ המדויק.
