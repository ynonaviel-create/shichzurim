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
const KINDS = ['shichzur', 'practice', 'highyield', 'cards', 'guide'];
/* עד כמה ידוע מה המרצה שואל: known = הדליף/מסר גבולות גזרה (קוקס), unknown = לא ידוע,
   mixed = חלק מהנושא ידוע, new = נושא שעבר למרצה השנה ואין עליו היסטוריה.
   מזין את דירוג העדיפויות במפה — ראו whatNow ב-app.js. */
const CERTAINTY = ['known', 'mixed', 'unknown', 'new'];
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
  const items = isCards ? data.cards : isGuide ? data.units : data.questions;
  if (!Array.isArray(items) || !items.length) {
    problems.push(`${file}: ${isCards ? 'אין כרטיסיות' : isGuide ? 'אין יחידות' : 'אין שאלות'}`);
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
    guides.push({ file, course: data.course, topics: items.map((u) => u.topic) });
  } else if (isCards) {
    items.forEach((c, i) => {
      const n = i + 1;
      if (!c.q) problems.push(`${file} · כרטיסייה ${n}: אין טקסט שאלה`);
      if (!c.short) problems.push(`${file} · כרטיסייה ${n}: אין תשובה קצרה`);
      if (!c.topic) problems.push(`${file} · כרטיסייה ${n}: אין נושא`);
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
  if (!isGuide && !isCards) {
    const set = (topicsByCourse[data.course] ??= new Set());
    items.forEach((q) => q.topic && set.add(q.topic));
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

console.log('\n✅ manifest.json עודכן');
console.log(`   נכסים נחתמו:  style.css?v=${cssV}   app.js?v=${jsV}\n`);
courses.forEach((c) => {
  const mine = exams.filter((e) => e.course === c.id);
  if (!mine.length) {
    console.log(`   ${c.icon} ${c.name} — אין עדיין מבחנים`);
    return;
  }
  console.log(`   ${c.icon} ${c.name}  (${mine.reduce((a, e) => a + e.count, 0)} שאלות)`);
  mine.forEach((e) =>
    console.log(`        ${e.part ? e.part + '  ' : '   '}${e.title}  — ${e.count}`)
  );
});
console.log(
  `\n   סה״כ: ${exams.length} מבחנים, ${exams.reduce((a, e) => a + e.count, 0)} שאלות\n`
);
