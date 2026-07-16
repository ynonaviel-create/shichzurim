#!/usr/bin/env node
/* סורק את תיקיית exams/ ובונה מחדש את manifest.json.
   הרצה:  node sync.js
   מריצים את זה אחרי שמוסיפים קובץ שחזור חדש. */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const EXAMS = path.join(__dirname, 'exams');
const REQUIRED = ['id', 'course', 'title', 'kind', 'questions'];
const KINDS = ['shichzur', 'practice', 'highyield'];
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
  if (!Array.isArray(data.questions) || !data.questions.length) {
    problems.push(`${file}: אין שאלות`);
    continue;
  }

  data.questions.forEach((q, i) => {
    const n = i + 1;
    if (!q.q) problems.push(`${file} · שאלה ${n}: אין טקסט שאלה`);
    if (!Array.isArray(q.opts) || q.opts.length < 2)
      problems.push(`${file} · שאלה ${n}: צריך לפחות שתי תשובות`);
    if (typeof q.a !== 'number' || q.a < 0 || (q.opts && q.a >= q.opts.length))
      problems.push(`${file} · שאלה ${n}: "a"=${q.a} מצביע על תשובה שלא קיימת`);
  });

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
    count: data.questions.length,
  });
}

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
