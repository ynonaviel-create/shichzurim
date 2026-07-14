#!/usr/bin/env node
/* סורק את תיקיית exams/ ובונה מחדש את manifest.json.
   הרצה:  node sync.js
   מריצים את זה אחרי שמוסיפים קובץ שחזור חדש. */

const fs = require('fs');
const path = require('path');

const EXAMS = path.join(__dirname, 'exams');
const REQUIRED = ['id', 'course', 'title', 'kind', 'questions'];
const KINDS = ['shichzur', 'practice', 'highyield'];

const problems = [];

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
  .filter((f) => f.endsWith('.json') && f !== 'manifest.json' && f !== 'courses.json')
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
    moed: data.moed ?? null,
    added: data.added ?? null,
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

fs.writeFileSync(
  path.join(EXAMS, 'manifest.json'),
  JSON.stringify(
    { updated: new Date().toISOString().slice(0, 10), courses, exams },
    null,
    2
  ),
  'utf8'
);

console.log('\n✅ manifest.json עודכן\n');
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
