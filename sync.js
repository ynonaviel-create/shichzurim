#!/usr/bin/env node
/* סורק את תיקיית exams/ ובונה מחדש את manifest.json.
   הרצה:  node sync.js
   מריצים את זה אחרי שמוסיפים קובץ שחזור חדש. */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const EXAMS = path.join(__dirname, 'exams');
const REQUIRED = ['id', 'course', 'title', 'kind'];   // questions / cards / units — לפי ה-kind, נבדק בהמשך
/* cards = כרטיסיות קריאה (לא מבחן): question/short/deep במקום opts/a.
   נכנס כדי לתת מקום לחומר שהמרצה מסר ישירות.
   guide = מפת חומרים (לא מבחן): units[] במקום questions[]. כל יחידה נתלית על
   נושא קנוני מהטקסונומיה של המקצוע, וזה מה שמחבר אותה לשאלות בלי הזנת דאטה —
   ראו GUIDE_BY_TOPIC ב-app.js. הנושא מאומת בהמשך מול הנושאים שבפועל בשאלות. */
/* case = מקרה מתגלגל (לא מבחן): cases[] במקום questions[]. כל מקרה נפרש בשלבים
   (אנמנזה → בדיקה → בירור → אבחנה → טיפול), וכל שלב מעדכן לוח אבחנה מבדלת חי.
   זה הפורמט של המבחן עצמו בעימות קליני — שאלה בודדת לא מתרגלת רצף. */
const KINDS = ['shichzur', 'practice', 'highyield', 'cards', 'guide', 'case'];
const DDX_STATUS = ['open', 'likely', 'unlikely', 'ruled_out', 'confirmed'];
/* עד כמה ידוע מה המרצה שואל: known = הדליף/מסר גבולות גזרה (קוקס), unknown = לא ידוע,
   mixed = חלק מהנושא ידוע, new = נושא שעבר למרצה השנה ואין עליו היסטוריה.
   מזין את דירוג העדיפויות במפה — ראו whatNow ב-app.js. */
const CERTAINTY = ['known', 'mixed', 'unknown', 'new'];
/* מה שאינו מבחן — כרטיסיות, מפת חומרים ומקרים. הפריטים שלהם אינם שאלות, ולכן
   הם לא נספרים בסיכומי ה"שאלות" (כמו NOT_QUIZ ב-app.js). */
const NOT_QUIZ = new Set(['cards', 'guide', 'case']);
const qCount = (list) => list.filter((e) => !NOT_QUIZ.has(e.kind)).reduce((a, e) => a + e.count, 0);
const NOT_EXAMS = new Set(['manifest.json', 'courses.json', 'repeats-ledger.json']);

const problems = [];

/* מזהה שאלות שחוזרות בין מחזורים, מסמן אותן בקבצי השחזור, ובונה את מבחן
   ה-High Yield. רץ *לפני* הסריקה, כי הוא כותב לקבצים שאנחנו עומדים לקרוא.
   בזכות זה כל שחזור חדש מעדכן את הספירות מעצמו. */
require('./repeats.js');

/* --- מקצועות --- */
let courses = [];
try {
  courses = JSON.parse(fs.readFileSync(path.join(EXAMS, 'courses.json'), 'utf8')).courses;
} catch (e) {
  console.error('\n❌ לא הצלחתי לקרוא את exams/courses.json — ' + e.message + '\n');
  process.exit(1);
}
const courseIds = new Set(courses.map((c) => c.id));

/* --- מבחנים --- */
const files = fs
  .readdirSync(EXAMS)
  .filter((f) => f.endsWith('.json') && !NOT_EXAMS.has(f))
  .sort();

const exams = [];
const guides = [];                  // מפות חומרים — הנושאים שלהן נבדקים אחרי הלולאה
const topicsByCourse = {};          // הנושאים שקיימים בפועל בשאלות, לכל מקצוע
const qidTopic = {};                // course → Map(qid → topic). מאמת את ה-points שבמפה

for (const file of files) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(path.join(EXAMS, file), 'utf8'));
  } catch (e) {
    problems.push(`${file}: קובץ JSON לא תקין — ${e.message}`);
    continue;
  }

  const missing = REQUIRED.filter((k) => data[k] == null);
  if (missing.length) {
    problems.push(`${file}: חסרים שדות — ${missing.join(', ')}`);
    continue;
  }
  if (!courseIds.has(data.course)) {
    problems.push(
      `${file}: המקצוע "${data.course}" לא קיים ב-courses.json ` +
      `(קיימים: ${[...courseIds].join(', ')}). הוסף אותו שם קודם.`
    );
    continue;
  }
  if (!KINDS.includes(data.kind)) {
    problems.push(`${file}: kind לא חוקי "${data.kind}" (מותר: ${KINDS.join(' / ')})`);
    continue;
  }
  const isCards = data.kind === 'cards';
  const isGuide = data.kind === 'guide';
  const isCase = data.kind === 'case';
  const items = isCards ? data.cards : isGuide ? data.units : isCase ? data.cases : data.questions;
  if (!Array.isArray(items) || !items.length) {
    problems.push(
      `${file}: ${isCards ? 'אין כרטיסיות' : isGuide ? 'אין יחידות' : isCase ? 'אין מקרים' : 'אין שאלות'}`
    );
    continue;
  }

  if (isGuide) {
    items.forEach((u, i) => {
      const n = i + 1;
      if (!u.topic) problems.push(`${file} · יחידה ${n}: אין נושא`);
      if (!u.what) problems.push(`${file} · יחידה ${n}: אין תיאור (what)`);
      if (!u.main || !u.main.src) problems.push(`${file} · יחידה ${n}: אין מקור ראשי (main.src)`);
      if (!CERTAINTY.includes(u.certainty))
        problems.push(`${file} · יחידה ${n}: certainty לא חוקי "${u.certainty}" (מותר: ${CERTAINTY.join(' / ')})`);
    });
    const dupes = items.map((u) => u.topic).filter((t, i, a) => t && a.indexOf(t) !== i);
    if (dupes.length)
      problems.push(`${file}: נושא חוזר ביותר מיחידה אחת — ${[...new Set(dupes)].join(', ')}. יחידה = נושא.`);
    /* points — "מה באמת נשאל": הנקודות שנבדקו בפועל בנושא, כל אחת עם ה-qid של
       השאלות שבדקו אותה. הפרוזה נכתבת מראש בידי אדם; מי שאל אותה ומתי נגזר
       בזמן ריצה מה-qids. הנקודות עצמן נבדקות אחרי הלולאה — הן מצביעות על
       שאלות שאולי עוד לא נקראו. */
    items.forEach((u, i) => {
      if (u.points == null) return;
      if (!Array.isArray(u.points))
        return problems.push(`${file} · יחידה ${i + 1}: points חייב להיות מערך`);
      u.points.forEach((p, j) => {
        const at = `${file} · ${u.topic} · נקודה ${j + 1}`;
        if (!p.point) problems.push(`${at}: אין טקסט (point)`);
        if (!Array.isArray(p.qids) || !p.qids.length)
          problems.push(`${at}: אין qids. נקודה בלי שאלה שבדקה אותה היא טענה בלי ראיה.`);
      });
    });
    guides.push({
      file, course: data.course,
      topics: items.map((u) => u.topic),
      units: items,
    });
  } else if (isCards) {
    items.forEach((c, i) => {
      const n = i + 1;
      if (!c.q) problems.push(`${file} · כרטיסייה ${n}: אין טקסט שאלה`);
      if (!c.short) problems.push(`${file} · כרטיסייה ${n}: אין תשובה קצרה`);
      if (!c.topic) problems.push(`${file} · כרטיסייה ${n}: אין נושא`);
    });
  } else if (isCase) {
    const seen = new Set();
    items.forEach((cs, i) => {
      const at = `${file} · מקרה ${i + 1}`;
      if (!cs.id) problems.push(`${at}: אין מזהה (id)`);
      else if (seen.has(cs.id)) problems.push(`${at}: מזהה כפול "${cs.id}"`);
      else seen.add(cs.id);
      if (!cs.title) problems.push(`${at}: אין כותרת`);
      if (!cs.opening) problems.push(`${at}: אין פתיח (opening)`);
      if (!cs.wrap) problems.push(`${at}: אין סיכום (wrap) — בלעדיו המקרה נגמר בלי הכרעה`);
      if (!Array.isArray(cs.ddx) || cs.ddx.length < 2)
        problems.push(`${at}: צריך לפחות שתי אבחנות ב-ddx — בלי מבדלת אין מה לצמצם`);
      if (!Array.isArray(cs.stages) || !cs.stages.length) {
        problems.push(`${at}: אין שלבים`);
        return;
      }
      const ddx = new Set(cs.ddx || []);
      cs.stages.forEach((s, j) => {
        const sAt = `${at} · שלב ${j + 1}`;
        if (!s.phase) problems.push(`${sAt}: אין שלב (phase)`);
        if (!s.ask) problems.push(`${sAt}: אין שאלה (ask)`);
        if (!s.why) problems.push(`${sAt}: אין הסבר (why) — ה"למה" הוא כל העניין`);
        if (!Array.isArray(s.opts) || s.opts.length < 2)
          problems.push(`${sAt}: צריך לפחות שתי אפשרויות`);
        if (typeof s.a !== 'number' || s.a < 0 || (s.opts && s.a >= s.opts.length))
          problems.push(`${sAt}: "a"=${s.a} מצביע על אפשרות שלא קיימת`);
        /* לוח מבדלת שמצביע על אבחנה שלא ברשימה = לוח שמשקר. */
        Object.entries(s.ddxUpdate || {}).forEach(([dx, st]) => {
          if (!ddx.has(dx))
            problems.push(`${sAt}: ddxUpdate מזכיר "${dx}" שלא קיים ב-ddx של המקרה`);
          if (!DDX_STATUS.includes(st))
            problems.push(`${sAt}: סטטוס לא חוקי "${st}" ל-"${dx}" (מותר: ${DDX_STATUS.join(' / ')})`);
        });
      });
    });
  } else {
    items.forEach((q, i) => {
      const n = i + 1;
      if (!q.q) problems.push(`${file} · שאלה ${n}: אין טקסט שאלה`);
      if (!Array.isArray(q.opts) || q.opts.length < 2)
        problems.push(`${file} · שאלה ${n}: צריך לפחות שתי תשובות`);
      if (typeof q.a !== 'number' || q.a < 0 || (q.opts && q.a >= q.opts.length))
        problems.push(`${file} · שאלה ${n}: "a"=${q.a} מצביע על תשובה שלא קיימת`);
    });
  }

  /* הנושאים שבפועל בשאלות — מהם נבנית הטקסונומיה שמולה נבדקת המפה.
     רק ממה שנכנס לבריכת התרגול: כרטיסיות מוחרגות מ-quizzesOf, ולכן נושא
     שקיים רק בהן עדיין יוביל את הצ׳יפ לרשימה ריקה. */
  if (!isGuide && !isCards && !isCase) {
    const set = (topicsByCourse[data.course] ??= new Set());
    items.forEach((q) => q.topic && set.add(q.topic));

    /* qid → הנושא שלו. זה מה שמאפשר לאמת ש-points מצביעות על שאלות אמיתיות,
       ולספור כמה מהשאלות בנושא כבר ממופות. ה-High Yield מוחרג: הוא עותק של
       שאלות שכבר נספרו, והוא היה מנפח את המכנה. */
    if (data.kind !== 'highyield') {
      const map = (qidTopic[data.course] ??= new Map());
      items.forEach((q) => q.qid && map.set(q.qid, q.topic || null));
    }
  }

  exams.push({
    id: data.id,
    file,
    course: data.course,
    part: data.part ?? null,
    title: data.title,
    kind: data.kind,
    year: data.year ?? null,
    cycle: data.cycle ?? null,
    moed: data.moed ?? null,
    added: data.added ?? null,
    official: data.official ?? null,   // מאסטר רשמי מהמודל / שחזור סטודנטים — מוצג כתג בכרטיס
    /* האם התשובות אומתו במעמד החשיפה. נאסף בקפידה בכל ייבוא ולא הוצג מעולם —
       והוא בדיוק מה שהלומד צריך לדעת לפני שהוא סומך על מפתח. יש שחזורים
       שהמשחזרים עצמם כתבו בהם "כלל התשובות לא אומתו בחשיפה". */
    trust: data.trust ?? null,
    heroSub: data.heroSub ?? null,     // מפה/כרטיסיות: הטקסט בבאנר שבעמוד המקצוע, לפני שהקובץ עצמו נטען
    heroEyebrow: data.heroEyebrow ?? null,   // כרטיסיות: מי מסר את החומר — מרצה או מתרגלים
    count: items.length,
  });
}

/* יחידה במפה נתלית על נושא קנוני, ומשם מגיע הקישור לתרגול ולשאלות. נושא שלא
   קיים באף שאלה = צ׳יפ שמוביל לרשימה ריקה. נבדק כאן ולא בלולאה, כי הטקסונומיה
   נאספת מכל קבצי המקצוע וחלקם עוד לא נקראו כשהמפה נקראת. */
guides.forEach((g) => {
  const known = topicsByCourse[g.course] ?? new Set();
  g.topics.forEach((t) => {
    if (t && !known.has(t))
      problems.push(
        `${g.file}: הנושא "${t}" לא קיים באף שאלה של ${g.course} — הקישור לתרגול יוביל לריק. ` +
        `תייג שאלות בנושא הזה, או תקן את השם. (קיימים: ${[...known].join(' · ')})`
      );
  });

  /* אימות ה-points. זה הלב של "מה באמת נשאל": כל נקודה מתיימרת להיות משהו
     שבאמת נשאל, וה-qids הן הראיה. qid שלא קיים = טענה בלי ראיה, וזה נשבר כאן
     ולא מגיע לאתר. הלקח מאחורי זה מפורש: מקורות חיצוניים בודים ראיות, ולכן
     הראיה נבדקת מקומית מול הארכיון עצמו. */
  const qmap = qidTopic[g.course] ?? new Map();
  (g.units || []).forEach((u) => {
    (u.points || []).forEach((p, j) => {
      const at = `${g.file} · ${u.topic} · נקודה ${j + 1}`;
      (p.qids || []).forEach((qid) => {
        /* שתי סיבות אפשריות, ו-sync לא יכול להבחין ביניהן: או שהשאלה נמחקה
           מהארכיון, או שהמציאו qid. שתיהן דורשות טיפול אנושי, ולכן זו שגיאה
           חוסמת ולא אזהרה — נקודה שמתיימרת להישען על שאלה שאינה קיימת היא
           טענה בלי ראיה, וזה בדיוק מה שהמנגנון הזה נועד למנוע. */
        if (!qmap.has(qid))
          problems.push(
            `${at}: ה-qid "${qid}" לא קיים באף שאלה של ${g.course}.\n` +
            `     אם מחקת שאלה — הסר אותה מה-qids של הנקודה (ואם זו הראיה האחרונה, הסר את הנקודה).\n` +
            `     אם לא מחקת — ה-qid שגוי, והנקודה נשענת על ראיה שלא קיימת.`
          );
        else if (qmap.get(qid) !== u.topic)
          problems.push(
            `${at}: ה-qid "${qid}" שייך לנושא "${qmap.get(qid)}" ולא ל-"${u.topic}". ` +
            `הקבלה תציג שאלה מנושא אחר.`
          );
      });
    });
    const dupe = (u.points || []).flatMap((p) => p.qids || [])
      .filter((q, i, a) => a.indexOf(q) !== i);
    if (dupe.length)
      problems.push(
        `${g.file} · ${u.topic}: אותה שאלה משמשת ראיה לשתי נקודות — ${[...new Set(dupe)].join(', ')}. ` +
        `נקודה = טענה נפרדת, אחרת הספירה מנפחת את עצמה.`
      );
  });
});

/* כמה מהשאלות בנושא כבר ממופות לנקודה. **אזהרה ולא שגיאה** — כיסוי חלקי הוא
   מצב לגיטימי (הכתיבה מתקדמת נושא-נושא), אבל בלי התזכורת הזאת שחזור חדש
   נכנס והפיצ׳ר מרקיב בשקט: נקודות שמתארות עבר, ושאלות שאיש לא מיפה. */
const coverage = [];
guides.forEach((g) => {
  const qmap = qidTopic[g.course] ?? new Map();
  (g.units || []).forEach((u) => {
    if (!u.points) return;
    const mapped = new Set(u.points.flatMap((p) => p.qids || []));
    let total = 0;
    qmap.forEach((t) => { if (t === u.topic) total++; });
    const miss = total - [...mapped].filter((q) => qmap.get(q) === u.topic).length;
    if (miss > 0) coverage.push(`${g.file} · ${u.topic}: ${miss} מתוך ${total} השאלות לא ממופות לאף נקודה`);
  });
});

const seen = {};
exams.forEach((e) => {
  if (seen[e.id]) problems.push(`מזהה כפול "${e.id}" — גם ב-${seen[e.id]} וגם ב-${e.file}`);
  seen[e.id] = e.file;
});

if (problems.length) {
  console.error('\n❌ נמצאו בעיות:\n');
  problems.forEach((p) => console.error('   • ' + p));
  console.error('\nהמניפסט לא עודכן. תקן ונסה שוב.\n');
  process.exit(1);
}

courses.sort((a, b) => (a.order ?? 99) - (b.order ?? 99));

/* גרסת התוכן — חתימה של כל קבצי המבחנים יחד.
   האתר מוסיף אותה לכל בקשת קובץ מבחן (?v=...), כדי שעדכון תוכן
   לא ייתקע במטמון הדפדפן של המשתמשים. */
const contentHash = crypto
  .createHash('md5')
  .update(
    exams
      .map((e) => fs.readFileSync(path.join(EXAMS, e.file)))
      .reduce((a, b) => Buffer.concat([a, b]), Buffer.alloc(0))
  )
  .digest('hex')
  .slice(0, 8);

/* חתימת קובץ לפי תוכנו. */
const stamp = (file) =>
  crypto
    .createHash('md5')
    .update(fs.readFileSync(path.join(__dirname, file)))
    .digest('hex')
    .slice(0, 8);

/* החתימות נכתבות גם ל-index.html (למטה) וגם למניפסט (כאן).
   המניפסט נטען תמיד עם no-cache ולכן הוא תמיד עדכני — האתר משווה אליו את
   הגרסה של עצמו, ואם ה-index.html שהוגש לו מהמטמון ישן, הוא מרענן את עצמו.
   בלי זה כל דחיפה משאירה חלון של 10 דקות שבו משתמשים רואים גרסה ישנה. */
const cssV = stamp('assets/style.css');
const jsV = stamp('assets/app.js');

fs.writeFileSync(
  path.join(EXAMS, 'manifest.json'),
  JSON.stringify(
    {
      updated: new Date().toISOString().slice(0, 10),
      version: contentHash,
      assets: { css: cssV, js: jsV },
      courses,
      exams,
    },
    null,
    2
  ),
  'utf8'
);

/* חותם את אותן חתימות על index.html, כדי שהדפדפן יוריד CSS/JS מחדש
   בדיוק כשהם באמת השתנו. */
const indexPath = path.join(__dirname, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');
html = html
  .replace(/assets\/style\.css(\?v=[a-f0-9]+)?/g, `assets/style.css?v=${cssV}`)
  .replace(/assets\/app\.js(\?v=[a-f0-9]+)?/g, `assets/app.js?v=${jsV}`);
fs.writeFileSync(indexPath, html, 'utf8');

if (coverage.length) {
  console.log('\n⚠️  כיסוי "מה באמת נשאל" — מה שנשאר למפות:');
  coverage.forEach((c) => console.log('   • ' + c));
}

console.log('\n✅ manifest.json עודכן');
console.log(`   נכסים נחתמו:  style.css?v=${cssV}   app.js?v=${jsV}\n`);
courses.forEach((c) => {
  const mine = exams.filter((e) => e.course === c.id);
  if (!mine.length) {
    console.log(`   ${c.icon} ${c.name} — אין עדיין מבחנים`);
    return;
  }
  console.log(`   ${c.icon} ${c.name}  (${qCount(mine)} שאלות)`);
  mine.forEach((e) =>
    console.log(`        ${e.part ? e.part + '  ' : '   '}${e.title}  — ${e.count}`)
  );
});
console.log(
  `\n   סה״כ: ${exams.filter((e) => !NOT_QUIZ.has(e.kind)).length} מבחנים, ${qCount(exams)} שאלות\n`
);
