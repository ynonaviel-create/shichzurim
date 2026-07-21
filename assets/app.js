/* ===== ארכיון השחזורים — מנוע =====
   מבנה נתונים:
     exams/courses.json  — רשימת המקצועות
     exams/<id>.json     — מבחן: course (מקצוע), part (חלק בתוך המקצוע), questions
     exams/manifest.json — נבנה אוטומטית ע"י sync.js

   ניווט: מקצועות → מקצוע → מבחן.
   ההפרדה למקצועות היא הנקודה: כשלומדים אלקטרו, ביוכימיה לא אמורה להיות על המסך.
*/

const KEY = 'shichzurim.v1';
const SEEN_KEY = 'shichzurim.seenIntro';
const THEME_KEY = 'shichzurim.theme';
const KIND_LABEL = { shichzur: 'שחזור', practice: 'תרגול', highyield: 'High Yield', cards: 'מהמרצה', guide: 'מפת חומרים', case: 'מקרה מתגלגל' };
/* סטטוס אבחנה בלוח המבדלת של מקרה מתגלגל. הסדר כאן הוא סדר ההצגה. */
const DDX_UI = {
  open:      { icon: '⬜', label: 'פתוח' },
  likely:    { icon: '🔺', label: 'סביר' },
  unlikely:  { icon: '🔻', label: 'פחות סביר' },
  ruled_out: { icon: '✕',  label: 'נשלל' },
  confirmed: { icon: '✓',  label: 'אושר' },
};

/* עד כמה אפשר לסמוך על מפתח התשובות — מה שהמשחזרים עצמם הצהירו.
   "לא אומתו" אינו "שגוי": הוא אומר שאיש לא בדק, וזו בדיוק הידיעה שהלומד
   צריך לפני שהוא בונה עליה. לכן שניהם כתומים ולא אדומים — אדום היה טוען
   שהתשובה שגויה, וזה לא מה שידוע לנו. */
const TRUST_TAG = {
  verified:   ['✓ אומתו בחשיפה',    'trust-ok'],
  partial:    ['⚠️ אומת חלקית',      'trust-warn'],
  unverified: ['⚠️ תשובות לא אומתו', 'trust-warn'],
};

const view = document.getElementById('view');
const el = (tag, cls, txt) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (txt != null) n.textContent = txt;
  return n;
};
const plural = (n, one, many) => (n === 1 ? `${one} אחד` : `${n} ${many}`);

/* צ'יפ נבחר בעכבר בכל בוררי התרגול, ולכן קל היה לשכוח שהוא לא כפתור אמיתי:
   בלי תפקיד ובלי tabIndex אי אפשר להגיע אליו במקלדת בכלל. בסימולציות אותה
   מחלקה כן נוצרת כ-button (ראו s.toggles) — הפער הזה הוא הסיבה שזה נשמט.
   אין כאן aria-pressed בכוונה: מצב ה-on מתחלף דרך classList בשישה מקומות
   שונים, ותכונה שלא מסונכרנת גרועה מתכונה חסרה — היא משקרת לקורא המסך. */
const chipEl = (cls, txt) => {
  const c = el('div', cls, txt);
  c.setAttribute('role', 'button');
  c.tabIndex = 0;
  c.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); c.click(); }
  });
  return c;
};

/* ---------- ערכת נושא ---------- */
/* שלושה מצבים: 'auto' (לפי הגדרות המכשיר, מתעדכן חי), 'light', 'dark'. רוב
   הלמידה כאן קורית בלילה, ומסך לבן בוהק ב-2 לפנות בוקר הוא לא ברירת מחדל
   ניטרלית — ולכן ברירת המחדל היא 'auto': המכשיר עובר ללילה, האתר איתו. בחירה
   מפורשת (בהיר/כהה) נשמרת וגוברת; לחיצה נוספת מחזירה בסוף ל'auto'. */
const systemTheme = () =>
  window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

const THEME_TITLE = {
  auto: 'ערכת נושא: אוטומטי (לפי המכשיר)',
  light: 'ערכת נושא: בהיר',
  dark: 'ערכת נושא: כהה',
};

/* mode = מה שנבחר (auto/light/dark); resolved = הצבע שנפתר בפועל (light/dark).
   data-theme נושא את ה-resolved (כל צבעי ה-CSS תלויים בו), data-theme-mode נושא
   את ה-mode (רק האייקון של הכפתור תלוי בו). */
function applyTheme(mode) {
  const resolved = mode === 'auto' ? systemTheme() : mode;
  document.documentElement.setAttribute('data-theme', resolved);
  document.documentElement.setAttribute('data-theme-mode', mode);
  const btn = document.getElementById('themeBtn');
  if (btn) { btn.title = THEME_TITLE[mode]; btn.setAttribute('aria-label', THEME_TITLE[mode]); }
  // קנבס לא יורש צבעים מ-CSS. אם סימולציה על המסך — לצייר מחדש.
  if (simRepaint) simRepaint();
}

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  const mode = saved === 'light' || saved === 'dark' || saved === 'auto' ? saved : 'auto';
  applyTheme(mode);
  document.getElementById('themeBtn').onclick = () => {
    const cur = document.documentElement.getAttribute('data-theme-mode') || 'auto';
    const next = cur === 'auto' ? 'light' : cur === 'light' ? 'dark' : 'auto';
    if (next === 'auto') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
  };
  /* מעקב חי: המכשיר עובר בין יום ללילה — ואם אנחנו במצב אוטומטי, האתר מתעדכן
     מיד, בלי רענון. בחירה מפורשת של המשתמש לא מושפעת. */
  const syncAuto = () => {
    if ((document.documentElement.getAttribute('data-theme-mode') || 'auto') === 'auto') applyTheme('auto');
  };
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncAuto);
  }
  /* גיבוי לאירוע ה-change (קפריזי בחלק מהדפדפנים/מערכות): כשחוזרים ללשונית או
     למיקוד, מסנכרנים שוב — תופס את "שיניתי את הגדרות המכשיר ואז חזרתי לאתר". */
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncAuto(); });
  window.addEventListener('focus', syncAuto);
}

/* ---------- אחסון התקדמות ---------- */
const store = {
  read() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; }
    catch { return {}; }
  },
  write(d) { localStorage.setItem(KEY, JSON.stringify(d)); },
  exam(id) { return this.read()[id] || { answers: {} }; },
  save(id, rec) { const d = this.read(); d[id] = rec; this.write(d); },
  reset(id) { const d = this.read(); delete d[id]; this.write(d); },
};

/* ---------- מה כבר ראית ----------
   מפה גלובלית של כל שאלה שנענתה אי־פעם, בכל מקום באתר:
     "examId#index" → 1 (נכון) | 0 (טעות)

   בלי זה התרגול החופשי שולף באקראי מכל הבריכה בכל פעם, אז חוזרים שוב ושוב
   על אותן שאלות בזמן שאחרות לא הוצגו מעולם. עם זה אפשר לתת קודם את מה
   שעוד לא ראית, ולהתקדם דרך הארכיון במקום להסתובב במעגל.

   נכתב גם ממבחן וגם מתרגול — שאלה שראית במבחן לא תחזור כ"חדשה" בתרגול. */
const SEEN_Q_KEY = 'shichzurim.seen';

/* המפתח הוא זהות השאלה, לא מקומה.

   עד 17/07 זה היה `examId#idx` — מיקום. כל עוד אף אחד לא נוגע בקבצים זה עובד,
   אבל הארכיון נערך כל יום: כשהוסרו שאלות הלב מאלקטרו תשפ״ה והמבחן ירד מ-38
   ל-31, כל השאלות שאחרי המחיקה זזו מקום — וההתקדמות זזה איתן. האתר הציג
   "כבר ראית" על שאלה שלא נראתה, והסתיר שאלה שכן. הכשל היה שקט לחלוטין.

   `qid` הוא md5 של הטקסט והמסיחים, מוטבע פעם אחת ואז קפוא (repeats.js) —
   הוא נשאר צמוד לשאלה גם אחרי תיקון ניסוח, ולא זז כשמוחקים שאלה אחרת.

   הנפילה ל-idx אינה זמנית: שאלה בלי qid (kind עתידי, קובץ שטרם עבר sync)
   עדיין צריכה מפתח כלשהו, ומיקום עדיף על כלום. */
const qKey = (item) => item.qid || `${item.examId}#${item.idx}`;

const seen = {
  read() {
    try { return JSON.parse(localStorage.getItem(SEEN_Q_KEY)) || {}; }
    catch { return {}; }
  },
  write(d) { localStorage.setItem(SEEN_Q_KEY, JSON.stringify(d)); },
  mark(item, correct) {
    if (item.examId == null || item.idx == null) return;
    const d = this.read();
    d[qKey(item)] = correct ? 1 : 0;
    this.write(d);
  },
  status(item) { return this.read()[qKey(item)]; },  // undefined | 0 | 1
  clear() { localStorage.removeItem(SEEN_Q_KEY); },
};

/* ---------- נתונים ---------- */
let COURSES = [];
let EXAMS = [];
let VERSION = '';
const cache = {};

/* המניפסט נטען עם no-cache כדי לאלץ אימות מול השרת — הוא קטן, וזה מה
   שמאפשר לנו לגלות שיש תוכן חדש. הוא נושא version, ואיתה נטענים קבצי
   המבחנים. בלי זה הדפדפן מגיש שאלות ישנות מהמטמון גם אחרי שעדכנו אותן. */
/* הגרסה של הקובץ הזה עצמו, מתוך ה-?v= שאיתו נטען. */
const BUILD = (() => {
  try { return new URL(document.currentScript.src).searchParams.get('v') || ''; }
  catch { return ''; }
})();

async function loadManifest() {
  const res = await fetch('exams/manifest.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error('manifest ' + res.status);
  const m = await res.json();
  COURSES = m.courses;
  EXAMS = m.exams;
  VERSION = m.version || '';

  /* המניפסט תמיד טרי (no-cache), אז הוא יודע מה הגרסה האמיתית. אם ה-index.html
     שהוגש לנו מהמטמון מצביע לגרסה ישנה של הקוד — אנחנו רצים כרגע כקוד ישן,
     והמשתמש רואה אתר "לא מעודכן" בלי לדעת. מרעננים פעם אחת עם עוקף מטמון.
     דגל ב-sessionStorage מבטיח שלא ניכנס ללולאת רענון אם משהו משתבש. */
  const freshJs = m.assets && m.assets.js;
  const freshCss = m.assets && m.assets.css;
  /* גם CSS: קוראים את ה-?v= מתגית ה-<link> שנטענה בפועל. כך גם שינוי של
     CSS בלבד (בלי שינוי JS) מפעיל את הרענון החד-פעמי — אחרת עדכון עיצוב
     נתקע במטמון ה-index.html הישן והמשתמש רואה גרסה ישנה. */
  let curCss = '';
  try {
    const link = document.querySelector('link[rel="stylesheet"][href*="style.css"]');
    if (link) curCss = new URL(link.href, location.href).searchParams.get('v') || '';
  } catch { /* התעלם */ }
  const jsStale = BUILD && freshJs && freshJs !== BUILD;
  const cssStale = curCss && freshCss && freshCss !== curCss;
  const stampKey = 'reloadedFor:' + freshJs + ':' + freshCss;
  if ((jsStale || cssStale) && !sessionStorage.getItem(stampKey)) {
    sessionStorage.setItem(stampKey, '1');
    const u = new URL(location.href);
    u.searchParams.set('b', String(freshJs || '') + String(freshCss || ''));
    location.replace(u.toString());
    await new Promise(() => {});   // עוצר את ההמשך עד שהדף מתחלף
  }
}

async function loadExam(id) {
  if (cache[id]) return cache[id];
  const meta = EXAMS.find((e) => e.id === id);
  if (!meta) throw new Error('לא נמצא מבחן: ' + id);
  const res = await fetch(`exams/${meta.file}?v=${VERSION}`);
  if (!res.ok) throw new Error('exam ' + res.status);
  const data = await res.json();
  migrateSeen(data);
  /* qIndex נגזר מ-cache, אז מבחן חדש מייתר אותו. renderGuide טוען את הכול לפני
     שהוא מרנדר ולכן זה לא אמור לקרות — אבל מטמון שנבנה על דאטה חלקי ונתקע
     הוא בדיוק סוג הבאג שנראה כמו "לפעמים חסרות שאלות בקבלה". */
  delete qIdxCache[data.course];
  return (cache[id] = data);
}

/* העברת ההתקדמות ממפתח-מיקום למפתח-זהות.

   יושבת כאן ולא באתחול, כי כאן — ורק כאן — יש ביד גם את ההתקדמות הישנה וגם
   את המיפוי מיקום→qid שמפענח אותה. מיגרציה גורפת הייתה מחייבת למשוך 1.6MB
   של שאלות בכל טעינת דף, על נייד, לפני שרואים משהו.

   אידמפוטנטית בבנייה: מעתיקה ואז מוחקת את הישן, אז אין צורך בדגל גרסה.
   ה-qid מנצח אם שניהם קיימים — הוא החדש והנכון.

   ⚠️ מה שכבר אבד נשאר אבוד: המיפוי הוא לפי הסדר של *היום*, וההתקדמות שכבר
   הוזזה כשקוצר אלקטרו תשפ״ה אינה ניתנת לשחזור — אין רישום של הסדר הישן.
   זה עוצר את הדימום, לא מרפא. */
function migrateSeen(exam) {
  if (!Array.isArray(exam.questions)) return;
  const d = seen.read();
  let touched = false;
  exam.questions.forEach((q, i) => {
    const old = `${exam.id}#${i}`;
    if (!q.qid || d[old] === undefined) return;
    if (d[q.qid] === undefined) d[q.qid] = d[old];
    delete d[old];
    touched = true;
  });
  if (touched) seen.write(d);
}

const courseOf = (id) => COURSES.find((c) => c.id === id);
/* מבחנים של מקצוע, מהמחזור החדש לישן. מבחן בלי מחזור (בנק שאלות, high-yield) בסוף.
   מקצוע שאין בו מחזורים (מבחנים רשמיים, כמו אלקטרו) — כולם שווים ב-cycle, ואז
   השנה מכריעה: מהחדש לישן. בלי זה הם ממוינים אלפביתית, שזה סדר חסר משמעות. */
const examsOf = (courseId) =>
  EXAMS.filter((e) => e.course === courseId).sort(
    (a, b) =>
      (b.cycle ?? -1) - (a.cycle ?? -1) ||
      (b.year ?? 0) - (a.year ?? 0) ||
      a.title.localeCompare(b.title, 'he'),
  );
/* רק מה שבאמת מבחן. כרטיסיות קריאה ומפת החומרים אין להן opts/a — הן לא נספרות
   בציון ולא נשאבות לתרגול החופשי או לרשימת הטעויות. */
const NOT_QUIZ = new Set(['cards', 'guide', 'case']);
const quizzesOf = (courseId) => examsOf(courseId).filter((e) => !NOT_QUIZ.has(e.kind));

/* ---------- ספירה לאחור למבחנים ---------- */
const MS = { min: 60000, hour: 3600000, day: 86400000 };

/* המועד הבא שעוד לא עבר, מבין המועדים של המקצוע. null אם כולם מאחורינו. */
function nextDate(course) {
  const now = Date.now();
  return (course.dates || [])
    .map((d) => ({ ...d, ts: new Date(d.at).getTime() }))
    .filter((d) => d.ts > now)
    .sort((a, b) => a.ts - b.ts)[0] || null;
}

/* המבחן הקרוב ביותר בכל הארכיון. */
function nextExamOverall() {
  return COURSES
    .map((c) => { const d = nextDate(c); return d ? { course: c, ...d } : null; })
    .filter(Boolean)
    .sort((a, b) => a.ts - b.ts)[0] || null;
}

/* דחיפות — קובעת את הצבע. פחות מיממה זה כבר לא "בעוד כמה ימים". */
function urgency(ts) {
  const left = ts - Date.now();
  if (left <= 0) return 'past';
  if (left < MS.day) return 'now';        // היום/מחר
  if (left < 3 * MS.day) return 'soon';   // עד 3 ימים
  if (left < 8 * MS.day) return 'near';   // עד שבוע
  return 'far';
}

/* טקסט קצר: "עוד 8 ימים" / "עוד 5 שעות" / "עוד 12 דקות" */
function countdownText(ts) {
  const left = ts - Date.now();
  if (left <= 0) return 'עבר';
  const days = Math.floor(left / MS.day);
  if (days >= 1) return `עוד ${plural(days, 'יום', 'ימים')}`;
  const hours = Math.floor(left / MS.hour);
  if (hours >= 1) return `עוד ${plural(hours, 'שעה', 'שעות')}`;
  const mins = Math.max(1, Math.floor(left / MS.min));
  return `עוד ${plural(mins, 'דקה', 'דקות')}`;
}

const fmtDate = (ts) =>
  new Date(ts).toLocaleDateString('he-IL', { day: 'numeric', month: 'long' });
const fmtTime = (ts) =>
  new Date(ts).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });

/* --- הבאנר הגדול: המבחן הבא, עם שעון שרץ --- */
let tickTimer = null;

function nextExamBanner() {
  const next = nextExamOverall();
  if (!next) return null;

  const box = el('div', 'nextup u-' + urgency(next.ts));
  box.dataset.tour = 'countdown';

  const left = el('div', 'nextup-info');
  left.append(el('div', 'nextup-label', 'המבחן הבא'));
  const title = el('div', 'nextup-title');
  title.append(el('span', 'nextup-ico', next.course.icon || '📘'));
  title.append(el('span', null, `${next.course.name} — מועד ${next.moed}׳`));
  left.append(title);
  left.append(el('div', 'nextup-when', `${fmtDate(next.ts)} · ${fmtTime(next.ts)}`));
  box.append(left);

  const clock = el('div', 'nextup-clock');
  box.append(clock);

  // שעון חי — מתעדכן כל דקה. הטיימר מנוקה בכל רינדור מחדש כדי שלא יצטברו.
  function tick() {
    const left = next.ts - Date.now();
    if (left <= 0) { clock.innerHTML = ''; clock.append(el('div', 'nextup-big', 'בהצלחה!')); return; }
    const d = Math.floor(left / MS.day);
    const h = Math.floor((left % MS.day) / MS.hour);
    const m = Math.floor((left % MS.hour) / MS.min);

    clock.innerHTML = '';
    const units = d > 0
      ? [[d, 'ימים'], [h, 'שעות'], [m, 'דקות']]
      : [[h, 'שעות'], [m, 'דקות']];
    units.forEach(([v, label]) => {
      const u = el('div', 'cd-unit');
      u.append(el('b', null, String(v).padStart(2, '0')));
      u.append(el('span', null, label));
      clock.append(u);
    });
  }
  tick();
  clearInterval(tickTimer);
  tickTimer = setInterval(tick, MS.min);

  return box;
}

/* מספר הנכונות נשמר ברשומה בזמן המענה, כדי שנוכל להציג ציון
   בלי לטעון את כל קבצי המבחנים. */
function quickScore(meta) {
  const rec = store.exam(meta.id);
  return {
    answered: Object.keys(rec.answers).length,
    correct: rec.correct ?? 0,
    total: meta.count,
  };
}

function courseProgress(courseId) {
  let answered = 0, correct = 0, total = 0;
  // כרטיסיות קריאה אינן שאלות — לא נספרות בהתקדמות ובאחוז ההצלחה.
  quizzesOf(courseId).forEach((e) => {
    const s = quickScore(e);
    answered += s.answered; correct += s.correct; total += e.count;
  });
  return { answered, correct, total };
}

/* ---------- ניווט ---------- */
function setNav(name) {
  document.querySelectorAll('.topnav a').forEach((a) =>
    a.classList.toggle('active', a.dataset.nav === name)
  );
}
function toTop() { requestAnimationFrame(() => window.scrollTo(0, 0)); }

function crumb(text, href) {
  const a = el('a', 'crumb', '→ ' + text);
  a.href = href;
  return a;
}

function router() {
  killSim();   // עמוד סימולציה משאיר אחריו ResizeObserver חי. router לא מפרק, אז מפרקים כאן.
  const [route, param, sub] = location.hash.replace(/^#\/?/, '').split('/');
  if (route === 'course' && param) return renderCourse(param);
  // #/guide/<course>/<topic> — קופץ ישר ליחידה (מגיע מכפתור "איפה ללמוד" שבמשוב)
  if (route === 'guide' && param) return renderGuide(param, sub ? decodeURIComponent(sub) : null);
  if (route === 'cards' && param) return renderCards(param);
  // #/case/<id>/<caseId> — קופץ ישר למקרה מסוים בתוך הדק
  if (route === 'case' && param) return renderCase(param, sub ? decodeURIComponent(sub) : null);
  if (route === 'sim' && param) return renderSim(param);
  if (route === 'drills' && param) return renderDrills(param);
  if (route === 'drill' && param) return renderDrill(param);
  if (route === 'formulas' && param) return renderFormulas(param, sub ? decodeURIComponent(sub) : null);
  // #/exam/<id>/<qi> — קופץ ישר לשאלה מסוימת (מגיע מקישורי התרגול שבכרטיסיות)
  if (route === 'exam' && param) return renderExam(param, sub != null ? Number(sub) : null);
  // #/practice/<course>/<topic> — נושא מכוון מראש, מגיע מעמוד סימולציה
  if (route === 'practice' && param) return renderPractice(param, sub ? decodeURIComponent(sub) : null);
  if (route === 'review' && param) return renderReview(param);
  if (route === 'about') return renderAbout();
  return renderHome();
}

/* ================= דף הבית — המקצועות ================= */
function renderHome() {
  setNav('home');
  view.innerHTML = '';

  const head = el('div', 'page-head');
  head.append(el('h1', null, 'ארכיון השחזורים'));
  head.append(el('p', null, 'בחר מקצוע. בתוכו תמצא את כל השחזורים, תרגול מעורב, ורשימת הטעויות שלך.'));
  view.append(head);

  const banner = introBanner();
  if (banner) view.append(banner);

  /* "פוש" חד-פעמי — מוצג אחרי שהעמוד התיישב, ורק אם הסיור לא רץ. */
  setTimeout(themeAnnounce, 700);

  const nextup = nextExamBanner();
  if (nextup) view.append(nextup);

  let tq = 0, ta = 0, tc = 0;
  COURSES.forEach((c) => {
    const p = courseProgress(c.id);
    tq += p.total; ta += p.answered; tc += p.correct;
  });
  const pct = ta ? Math.round((tc / ta) * 100) : 0;

  const dash = el('div', 'dash');
  dash.append(stat(COURSES.length, 'מקצועות', 'accent'));
  dash.append(stat(tq, 'שאלות בארכיון'));
  dash.append(stat(ta, 'שאלות שענית'));
  dash.append(stat(ta ? pct + '%' : '—', 'אחוז הצלחה', pct >= 70 ? 'good' : ta ? 'bad' : ''));
  view.append(dash);

  const grid = el('div', 'courses');
  COURSES.forEach((c) => grid.append(courseCard(c)));
  view.append(grid);

  toTop();
  updateFooter();
}

function courseCard(c) {
  const list = quizzesOf(c.id);
  const p = courseProgress(c.id);

  const a = el('a', 'course');
  a.dataset.tour = 'course';     // הסיור מצביע על הראשון שהוא מוצא
  a.href = '#/course/' + c.id;

  const top = el('div', 'course-top');
  top.append(el('span', 'course-ico', c.icon || '📘'));
  const nd = nextDate(c);
  if (nd) {
    const pill = el('span', 'cd-pill u-' + urgency(nd.ts), countdownText(nd.ts));
    pill.title = `מועד ${nd.moed}׳ · ${fmtDate(nd.ts)} ${fmtTime(nd.ts)}`;
    top.append(pill);
  }
  a.append(top);

  a.append(el('h2', null, c.name));
  a.append(el('p', 'blurb', c.blurb || ''));
  if (nd) a.append(el('p', 'course-when', `מועד ${nd.moed}׳ · ${fmtDate(nd.ts)} · ${fmtTime(nd.ts)}`));

  // שיידעו שזה קיים עוד לפני שנכנסים למקצוע
  const ns = simsOf(c.id).length;
  if (ns) a.append(el('p', 'course-sims', `🎛️ ${plural(ns, 'סימולציה אינטראקטיבית', 'סימולציות אינטראקטיביות')}`));

  const foot = el('div', 'course-foot');
  const bar = el('div', 'bar');
  const f = el('i');
  f.style.width = p.total ? Math.round((p.answered / p.total) * 100) + '%' : '0%';
  if (p.answered) f.classList.add(p.correct / p.answered >= 0.7 ? 'good' : 'bad');
  bar.append(f);
  foot.append(bar);

  const n = el('span', 'course-foot n' + (p.answered ? ' has' : ''));
  n.textContent = list.length
    ? p.answered
      ? `${p.answered}/${p.total} נענו`
      : `${plural(list.length, 'מבחן', 'מבחנים')} · ${p.total} שאלות`
    : 'בקרוב';
  n.className = 'n' + (p.answered ? ' has' : '');
  foot.append(n);
  a.append(foot);
  return a;
}

function stat(value, label, cls) {
  const d = el('div', 'stat' + (cls ? ' ' + cls : ''));
  d.append(el('b', null, String(value)));
  d.append(el('span', null, label));
  return d;
}

function emptyState(icon, title, text) {
  const e = el('div', 'empty');
  e.append(el('span', 'ico', icon));
  e.append(el('b', null, title));
  e.append(el('p', null, text));
  return e;
}

/* ================= דף מקצוע ================= */
function renderCourse(courseId) {
  setNav('home');
  const c = courseOf(courseId);
  view.innerHTML = '';

  if (!c) {
    view.append(emptyState('⚠️', 'מקצוע לא נמצא', 'הקישור כנראה שגוי.'));
    toTop();
    return;
  }

  view.append(crumb('כל המקצועות', '#/'));

  const head = el('div', 'page-head');
  head.append(el('h1', null, `${c.icon || ''} ${c.name}`.trim()));
  head.append(el('p', null, [c.blurb, c.code].filter(Boolean).join(' · ')));
  view.append(head);

  // הסבר על הקורס והמבחנים — הקשר ומקורות. מוצג רק אם הוגדר about ב-courses.json.
  if (c.about) {
    const box = el('div', 'course-about');
    box.append(el('div', 'course-about-title', 'על הקורס והמבחנים'));
    const body = el('div', 'course-about-body');
    String(c.about).split('\n\n').forEach((para) => body.append(el('p', null, para)));
    box.append(body);
    view.append(box);
  }

  // לוח המועדים של המקצוע — כולם, גם מה שכבר עבר
  if ((c.dates || []).length) {
    const row = el('div', 'moadim');
    c.dates
      .map((d) => ({ ...d, ts: new Date(d.at).getTime() }))
      .sort((a, b) => a.ts - b.ts)
      .forEach((d) => {
        const u = urgency(d.ts);
        const card = el('div', 'moed u-' + u);
        card.append(el('div', 'moed-label', `מועד ${d.moed}׳`));
        card.append(el('div', 'moed-date', `${fmtDate(d.ts)} · ${fmtTime(d.ts)}`));
        card.append(el('div', 'moed-cd', countdownText(d.ts)));
        row.append(card);
      });
    view.append(row);
  }

  const list = examsOf(courseId);
  if (!list.length) {
    view.append(emptyState('📭', 'עוד אין מבחנים במקצוע הזה', 'ברגע שיתווסף שחזור ראשון, הוא יופיע כאן.'));
    toTop();
    updateFooter();
    return;
  }

  const p = courseProgress(courseId);
  const pct = p.answered ? Math.round((p.correct / p.answered) * 100) : 0;

  const dash = el('div', 'dash');
  /* NOT_QUIZ ולא רשימה ידנית: הספירה הזו החריגה 'cards' בלבד, ולכן מפת החומרים
     כבר נספרה כמבחן. p.total ממילא נגזר מ-quizzesOf — הדשבורד סתר את עצמו. */
  dash.append(stat(list.filter((e) => !NOT_QUIZ.has(e.kind)).length, 'מבחנים', 'accent'));
  dash.append(stat(p.total, 'שאלות'));
  dash.append(stat(p.answered, 'שאלות שענית'));
  dash.append(stat(p.answered ? pct + '%' : '—', 'אחוז הצלחה', pct >= 70 ? 'good' : p.answered ? 'bad' : ''));
  view.append(dash);

  const actions = el('div', 'btn-row');
  actions.style.marginBottom = '30px';
  const pr = el('a', 'btn primary', `🎲 תרגול חופשי ב${c.name}`);
  pr.dataset.tour = 'practice';
  pr.href = '#/practice/' + courseId;
  actions.append(pr);
  const rv = el('a', 'btn', `🎯 הטעויות שלי ב${c.name}`);
  rv.dataset.tour = 'review';
  rv.href = '#/review/' + courseId;
  actions.append(rv);
  view.append(actions);

  /* כרטיסיות המרצה — לא מבחן, ולכן לא נכנסות לרשימת המבחנים אלא מקבלות
     באנר משלהן בראש העמוד. זה החומר הכי ישיר שיש: המרצה עצמו מסר אותו. */
  list.filter((e) => e.kind === 'cards').forEach((deck) => view.append(cardsHero(deck)));

  /* מקרים מתגלגלים — הפורמט של המבחן עצמו. גם הם לא מבחן ברשימה אלא באנר. */
  list.filter((e) => e.kind === 'case').forEach((deck) => view.append(casesHero(deck)));

  /* מפת החומרים — גם היא לא מבחן: באנר בראש, ולא שורה ברשימה. */
  const gh = guideHero(courseId);
  if (gh) view.append(gh);

  const list2 = list.filter((e) => !NOT_QUIZ.has(e.kind));

  /* סימולציות — לא מבחן ולא ב-manifest, ולכן גם הן באנר ולא שורה ברשימה. */
  const sh = simsHero(courseId);
  if (sh) view.append(sh);

  /* תרגילי החישוב — גם הם באנר. באים אחרי הסימולציות: קודם מבינים, אז מחשבים. */
  const dh = drillsHero(courseId);
  if (dh) view.append(dh);

  /* קיבוץ לפי חלק — "א׳/ב׳" בביוכימיה, "בחני אמצע/מבחני גמר" באלקטרו.
     מבחנים בלי חלק נופלים לקבוצה אחת. */
  const byPart = {};
  list2.forEach((e) => (byPart[e.part || ''] ||= []).push(e));

  Object.keys(byPart).sort().forEach((part) => {
    const sec = el('section', 'part');
    const ph = el('div', 'part-head');
    // שם המקצוע כבר בכותרת העמוד — בסקשן מספיק שם החלק עצמו.
    ph.append(el('h2', null, part || c.name));
    const n = byPart[part].reduce((a, e) => a + e.count, 0);
    ph.append(el('span', 'pill', `${plural(byPart[part].length, 'מבחן', 'מבחנים')} · ${n} שאלות`));
    sec.append(ph);

    const cards = el('div', 'cards');
    byPart[part].forEach((e) => cards.append(examCard(e)));
    sec.append(cards);
    view.append(sec);
  });

  toTop();
  updateFooter();
}

/* הבאנר של כרטיסיות המרצה. נראה אחרת מכל השאר בכוונה — זה לא עוד מבחן
   בערימה, זה מה שהמרצה אמר שיהיה במבחן. */
function cardsHero(m) {
  const done = Object.keys(cardsRead.read()).filter((k) => k.startsWith(m.id + '#')).length;
  const a = el('a', 'lhero');
  a.href = '#/cards/' + m.id;

  const left = el('div', 'lhero-main');
  /* הטקסט הזה היה קשיח ומדבר על קוקס והזום שלו — נכון לביומול בלבד. דק
     כרטיסיות של מקצוע אחר היה מציג טענה שקרית, ולכן הוא מגיע מהקובץ. */
  left.append(el('div', 'lhero-eyebrow', m.heroEyebrow || '🎓 ישירות מהמרצה'));
  left.append(el('h2', null, m.title));
  left.append(el('p', 'lhero-sub',
    m.heroSub || 'כרטיסיות קריאה — מה נשאל, מה התשובה, ולמה. עם קישור לתרגול על כל נושא.'));
  a.append(left);

  const right = el('div', 'lhero-side');
  right.append(el('div', 'lhero-n', m.count));
  right.append(el('div', 'lhero-n-lbl', 'כרטיסיות'));
  if (done) right.append(el('div', 'lhero-done', `${done} נקראו`));
  a.append(right);
  return a;
}

function examCard(m) {
  const s = quickScore(m);
  const a = el('a', 'card');
  a.dataset.tour = 'exam';       // הסיור מצביע על הראשון שהוא מוצא
  a.href = '#/exam/' + m.id;
  a.append(el('h3', null, m.title));

  const meta = el('div', 'card-meta');
  if (m.year) meta.append(el('span', 'tag year', m.year));
  meta.append(el('span', 'tag ' + m.kind, KIND_LABEL[m.kind] || m.kind));
  // רק אם הכותרת לא אומרת את זה כבר ("מועד א׳" ככותרת + תג "מועד א׳" = רעש).
  if (m.moed && !m.title.includes(`מועד ${m.moed}`)) meta.append(el('span', 'tag', `מועד ${m.moed}׳`));
  meta.append(el('span', 'tag', `${m.count} שאלות`));
  /* מאסטר רשמי מהמודל מול שחזור שכתבו סטודנטים מהזיכרון — הבדל מהותי באמינות
     המפתח, ועד עכשיו הוא היה קבור ב-note שנראה רק אחרי שנכנסים למבחן. */
  if (m.official === true) meta.append(el('span', 'tag official', '✓ מאסטר רשמי'));
  else if (m.official === false) meta.append(el('span', 'tag recon', 'שחזור סטודנטים'));
  /* האם התשובות אומתו במעמד החשיפה. עד עכשיו זה נאסף בכל ייבוא ולא הוצג
     בשום מקום — כלומר יש שחזורים שהמשחזרים עצמם כתבו בהם "כלל התשובות לא
     אומתו בחשיפה", והלומד תרגל 60 שאלות כאילו המפתח ודאי.

     על מאסטר רשמי לא מוסיפים תג: בדאטה official===true חופף בדיוק ל-
     trust==='verified', ושני תגים ירוקים זה אותו מידע פעמיים.
     היעדר תג = לא ידוע, וזה בכוונה — 13 מבחנים עוד לא סומנו, ולומר עליהם
     "אומת" יהיה שקר ולומר "לא אומת" יהיה הכפשה. */
  const tr = m.official !== true && TRUST_TAG[m.trust];
  if (tr) meta.append(el('span', 'tag ' + tr[1], tr[0]));
  a.append(meta);

  const foot = el('div', 'card-foot');
  const bar = el('div', 'bar');
  const f = el('i');
  const pct = s.answered ? (s.correct / s.answered) * 100 : 0;
  f.style.width = s.answered ? Math.round((s.answered / m.count) * 100) + '%' : '0%';
  if (s.answered) f.classList.add(pct >= 70 ? 'good' : 'bad');
  bar.append(f);
  foot.append(bar);

  const score = el('span', 'card-score');
  if (s.answered) {
    score.textContent = `${s.correct}/${s.answered} · ${Math.round(pct)}%`;
    score.classList.add(pct >= 70 ? 'has' : 'low');
  } else {
    score.textContent = 'טרם התחלת';
  }
  foot.append(score);
  a.append(foot);
  return a;
}

/* ================= נגן מבחן ================= */
async function renderExam(id, focusIdx = null) {
  setNav('home');
  view.innerHTML = '<div class="empty"><span class="ico">⏳</span><b>טוען…</b></div>';

  let exam;
  try { exam = await loadExam(id); }
  catch (err) {
    view.innerHTML = '';
    view.append(emptyState('⚠️', 'לא הצלחתי לטעון את המבחן', String(err.message)));
    return;
  }
  /* GUIDE_BY_TOPIC מתמלא רק מ-loadGuide. בכניסה ישירה למבחן (קישור ששותף
     בוואטסאפ) לא עברנו בעמוד הקורס, ובלי זה כפתור "איפה ללמוד" פשוט לא יופיע. */
  await loadGuide(exam.course).catch(() => null);

  const c = courseOf(exam.course);
  playQuestions({
    key: exam.id,
    title: exam.title,
    subtitle: `${c ? c.name : ''} ${exam.part || ''} · ${exam.questions.length} שאלות`.trim(),
    note: exam.note,
    // examId+idx מזהים כל שאלה באופן יציב, כדי שנוכל לסמן אותה כ"נראתה"
    // גם כשהיא מוצגת מתוך תרגול חופשי ולא מתוך המבחן שלה.
    questions: exam.questions.map((q, i) => ({ ...q, examId: exam.id, idx: i })),
    persist: true,
    back: { text: c ? c.name : 'חזרה', href: '#/course/' + exam.course },
  });

  /* הגענו מקישור תרגול שבכרטיסיות המרצה — לקפוץ לשאלה ולסמן אותה רגע,
     אחרת המשתמש נוחת בראש מבחן של 60 שאלות ולא מוצא את מה שחיפש.
     שני rAF: הראשון נותן ל-toTop() של playQuestions לרוץ, ורק אז גוללים —
     אחרת הוא דורס אותנו ונשארים בראש העמוד. */
  if (focusIdx != null && !Number.isNaN(focusIdx)) {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const target = document.getElementById('q-' + focusIdx);
      if (!target) return;
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      target.classList.add('q-flash');
      setTimeout(() => target.classList.remove('q-flash'), 2400);
    }));
  }
}

/* ================= כרטיסיות קריאה (מהמרצה) =================
   לא מבחן ולא תרגול: חומר שהמרצה מסר ישירות. כל כרטיסייה היא
   "מה יישאל · התשובה · למה", ומקושרת לשאלות מהארכיון לתרגול. */
const CARDS_READ_KEY = 'shichzurim.cardsRead';
const cardsRead = {
  read() { try { return JSON.parse(localStorage.getItem(CARDS_READ_KEY)) || {}; } catch { return {}; } },
  write(d) { localStorage.setItem(CARDS_READ_KEY, JSON.stringify(d)); },
  is(id, i) { return !!this.read()[`${id}#${i}`]; },
  set(id, i, v) { const d = this.read(); if (v) d[`${id}#${i}`] = 1; else delete d[`${id}#${i}`]; this.write(d); },
  clear(id) { const d = this.read(); Object.keys(d).forEach((k) => k.startsWith(id + '#') && delete d[k]); this.write(d); },
};

async function renderCards(id) {
  setNav('home');
  view.innerHTML = '<div class="empty"><span class="ico">⏳</span><b>טוען…</b></div>';

  let deck;
  try { deck = await loadExam(id); }
  catch (err) {
    view.innerHTML = '';
    view.append(emptyState('⚠️', 'לא הצלחתי לטעון', String(err.message)));
    return;
  }

  const c = courseOf(deck.course);
  view.innerHTML = '';
  view.append(crumb(c ? c.name : 'חזרה', '#/course/' + deck.course));

  const head = el('div', 'page-head');
  head.append(el('h1', null, deck.title));
  head.append(el('p', null, `${c ? c.name : ''} · ${deck.cards.length} כרטיסיות לקריאה`));
  view.append(head);

  if (deck.note) {
    const n = el('div', 'cards-note');
    n.textContent = deck.note;
    view.append(n);
  }

  const bar = el('div', 'cards-bar');
  const cnt = el('span', 'cards-count');
  bar.append(cnt);
  const reset = el('button', 'btn-ghost', 'איפוס הסימונים');
  reset.onclick = () => { cardsRead.clear(deck.id); paint(); };
  bar.append(reset);
  view.append(bar);

  const wrap = el('div', 'cards-wrap');
  view.append(wrap);

  function paint() {
    wrap.innerHTML = '';
    deck.cards.forEach((card, i) => wrap.append(cardEl(card, i)));
    const done = deck.cards.filter((_, i) => cardsRead.is(deck.id, i)).length;
    cnt.textContent = `${done} מתוך ${deck.cards.length} נקראו`;
    cnt.className = 'cards-count' + (done === deck.cards.length ? ' all' : '');
  }

  function cardEl(card, i) {
    const done = cardsRead.is(deck.id, i);
    const box = el('div', 'lcard' + (done ? ' done' : ''));

    const top = el('div', 'lcard-top');
    top.append(el('span', 'lcard-num', `${i + 1}`));
    top.append(el('span', 'lcard-topic', card.topic));
    const chk = el('button', 'lcard-chk' + (done ? ' on' : ''), done ? '✓ נקרא' : 'סמן כנקרא');
    chk.onclick = () => { cardsRead.set(deck.id, i, !cardsRead.is(deck.id, i)); paint(); };
    top.append(chk);
    box.append(top);

    box.append(el('p', 'lcard-q', card.q));

    const ans = el('div', 'lcard-ans');
    ans.append(el('span', 'lcard-ans-lbl', 'התשובה'));
    ans.append(el('p', null, card.short));
    box.append(ans);

    if (card.deep) {
      const det = el('details', 'lcard-deep');
      const sum = el('summary', null, 'הסבר מעמיק');
      det.append(sum);
      det.append(el('p', null, card.deep));
      box.append(det);
    }

    if (card.related && card.related.length) {
      const rel = el('div', 'lcard-rel');
      rel.append(el('span', 'lcard-rel-lbl', `לתרגול — ${plural(card.related.length, 'שאלה', 'שאלות')} מהארכיון על הנושא`));
      const list = el('div', 'lcard-rel-list');
      card.related.forEach((r) => {
        const a = el('a', 'rel-chip');
        a.href = `#/exam/${r.exam}/${r.idx}`;
        a.append(el('span', 'rel-q', r.q));
        a.append(el('span', 'rel-src', r.examTitle));
        list.append(a);
      });
      rel.append(list);
      box.append(rel);
    }
    return box;
  }

  paint();
  toTop();
  updateFooter();
}

/* ================= מקרה מתגלגל =================
   המבחן בעימות קליני בנוי מתיאורי מקרה שמתגלגלים: כל שאלה מוסיפה מידע ומקדמת
   את ההערכה. שאלה בודדת ועצמאית — מה שיש בכל שאר הארכיון — לא מתרגלת את זה.
   כאן המקרה נפרש בשלבים, וכל החלטה חושפת מידע חדש ומזיזה את לוח המבדלת.
   הלוח הוא העיקר: הוא הופך את "האבחנה משתנה עם הנתונים" למשהו שרואים. */
const CASE_KEY = 'shichzurim.caseProg';
const caseProg = {
  read() { try { return JSON.parse(localStorage.getItem(CASE_KEY)) || {}; } catch { return {}; } },
  write(d) { localStorage.setItem(CASE_KEY, JSON.stringify(d)); },
  get(deck, cs) { return this.read()[`${deck}#${cs}`] || []; },
  set(deck, cs, arr) { const d = this.read(); d[`${deck}#${cs}`] = arr; this.write(d); },
  clear(deck, cs) { const d = this.read(); delete d[`${deck}#${cs}`]; this.write(d); },
};
const caseDone = (deck, cs) => caseProg.get(deck.id, cs.id).filter((v) => v != null).length >= cs.stages.length;

/* הבאנר בעמוד המקצוע. */
function casesHero(m) {
  const a = el('a', 'lhero lhero-case');
  a.href = '#/case/' + m.id;
  const left = el('div', 'lhero-main');
  left.append(el('div', 'lhero-eyebrow', '🩺 תרגול חשיבה קלינית'));
  left.append(el('h2', null, m.title));
  left.append(el('p', 'lhero-sub',
    'המבחן בנוי מתיאורי מקרה מתגלגלים. כאן המקרה נפרש שלב-שלב — אנמנזה, בדיקה, בירור, אבחנה, טיפול — ' +
    'וכל החלטה שלך חושפת מידע חדש ומצמצמת את האבחנה המבדלת מול העיניים.'));
  a.append(left);
  const right = el('div', 'lhero-side');
  right.append(el('div', 'lhero-n', m.count));
  right.append(el('div', 'lhero-n-lbl', plural(m.count, 'מקרה', 'מקרים')));
  a.append(right);
  return a;
}

async function renderCase(id, caseId = null) {
  setNav('home');
  view.innerHTML = '<div class="empty"><span class="ico">⏳</span><b>טוען…</b></div>';

  let deck;
  try { deck = await loadExam(id); }
  catch (err) {
    view.innerHTML = '';
    view.append(emptyState('⚠️', 'לא הצלחתי לטעון', String(err.message)));
    return;
  }

  const c = courseOf(deck.course);
  const cs = caseId ? deck.cases.find((x) => x.id === caseId) : null;
  view.innerHTML = '';

  if (!cs) return casePicker(deck, c);

  view.append(crumb('כל המקרים', '#/case/' + deck.id));

  const head = el('div', 'page-head');
  head.append(el('h1', null, `${cs.icon || '🩺'} ${cs.title}`));
  if (cs.topic) head.append(el('p', null, cs.topic));
  view.append(head);

  const layout = el('div', 'case-layout');
  const main = el('div', 'case-main');
  const side = el('div', 'case-side');
  layout.append(main, side);
  view.append(layout);

  /* answers[i] = האינדקס שנבחר בשלב i, או null אם עוד לא נענה.
     נורמליזציה לאורך המלא היא קריטית ולא קוסמטית: findIndex על מערך ריק מחזיר
     -1, וזה בדיוק הערך שאומר "הכול נענה" — כך כל השלבים היו נחשפים מיד. */
  const stored = caseProg.get(deck.id, cs.id);
  let answers = cs.stages.map((_, i) => (stored[i] == null ? null : stored[i]));

  const save = () => caseProg.set(deck.id, cs.id, answers);

  /* לוח המבדלת נגזר מהתשובות — לא נשמר בנפרד. מצב שנגזר לא יכול להיסתר
     מהמקור שלו: מאפסים תשובה, והלוח חוזר אחורה נכון בלי טיפול מיוחד. */
  function ddxState() {
    const st = {};
    (cs.ddx || []).forEach((d) => (st[d] = 'open'));
    cs.stages.forEach((s, i) => {
      if (answers[i] == null) return;
      Object.entries(s.ddxUpdate || {}).forEach(([dx, v]) => { if (dx in st) st[dx] = v; });
    });
    return st;
  }

  function paint() {
    /* --- לוח המבדלת --- */
    side.innerHTML = '';
    const board = el('div', 'ddx-board');
    board.append(el('div', 'ddx-title', 'אבחנה מבדלת'));
    const st = ddxState();
    (cs.ddx || []).forEach((dx) => {
      const s = st[dx] || 'open';
      const row = el('div', 'ddx-row ddx-' + s);
      row.append(el('span', 'ddx-ico', DDX_UI[s].icon));
      row.append(el('span', 'ddx-name', dx));
      row.append(el('span', 'ddx-st', DDX_UI[s].label));
      board.append(row);
    });
    const answered = answers.filter((v) => v != null).length;
    board.append(el('div', 'ddx-foot', `שלב ${Math.min(answered + 1, cs.stages.length)} מתוך ${cs.stages.length}`));
    side.append(board);

    if (answered) {
      const rst = el('button', 'btn-ghost case-reset', 'התחל את המקרה מחדש');
      rst.onclick = () => {
        answers = cs.stages.map(() => null);
        caseProg.clear(deck.id, cs.id);
        paint();
        toTop();
      };
      side.append(rst);
    }

    /* --- הסיפור והשלבים --- */
    main.innerHTML = '';
    const story = el('div', 'case-story');
    story.append(el('p', null, cs.opening));
    /* כל reveal של שלב שנענה מצטרף לסיפור — ככה המקרה "מתגלגל". */
    cs.stages.forEach((s, i) => {
      if (answers[i] != null && s.reveal) story.append(el('p', 'case-reveal', s.reveal));
    });
    main.append(story);

    const upto = answers.findIndex((v) => v == null);
    const last = upto === -1 ? cs.stages.length - 1 : upto;

    cs.stages.forEach((s, i) => {
      if (i > last) return;                       // שלב עתידי — לא נחשף עד שעונים על הקודם
      main.append(stageEl(s, i));
    });

    if (answers.filter((v) => v != null).length === cs.stages.length) {
      const w = el('div', 'case-wrap');
      w.append(el('div', 'case-wrap-t', '🎯 סיכום המקרה'));
      w.append(el('p', null, cs.wrap));
      main.append(w);
      if (cs.topic) {
        const pr = el('a', 'btn', `🎲 תרגול שאלות ב${cs.topic}`);
        pr.href = '#/practice/' + deck.course + '/' + encodeURIComponent(cs.topic);
        main.append(pr);
      }
    }
  }

  function stageEl(s, i) {
    const card = el('div', 'case-stage' + (answers[i] != null ? ' done' : ''));
    card.id = 'stage-' + i;
    card.append(el('div', 'case-phase', s.phase));
    if (s.stem) card.append(el('div', 'case-stem', s.stem));
    card.append(el('div', 'case-ask', s.ask));

    const opts = el('div', 'opts');
    s.opts.forEach((text, oi) => {
      const o = el('div', 'opt');
      o.append(el('span', 'key', String(oi + 1)));
      o.append(el('span', null, text));
      if (answers[i] != null) {
        o.classList.add('locked');
        if (oi === s.a) o.classList.add('correct');
        else if (oi === answers[i]) o.classList.add('wrong');
        if (oi === answers[i]) o.classList.add('chosen');
      } else {
        o.onclick = () => {
          answers[i] = oi;
          save();
          paint();
          /* אחרי מענה גוללים לשלב שנענה — לא לראש. הרגע שאחרי הבחירה הוא
             שבו לומדים, וקפיצה לראש העמוד מושכת משם. */
          requestAnimationFrame(() => {
            const t = document.getElementById('stage-' + i);
            if (t) t.scrollIntoView({ block: 'center', behavior: 'smooth' });
          });
        };
      }
      opts.append(o);
    });
    card.append(opts);

    if (answers[i] != null) {
      const ok = answers[i] === s.a;
      const fb = el('div', 'fb show ' + (ok ? 'ok' : 'no'));
      fb.append(el('div', null, ok ? '✓ נכון' : `✗ לא — הנכון: ${s.opts[s.a]}`));
      fb.append(el('div', 'explain', s.why));
      card.append(fb);
    }
    return card;
  }

  paint();
  toTop();
  updateFooter();
}

/* בורר המקרים — הדף שרואים כשנכנסים לדק בלי מקרה מסוים. */
function casePicker(deck, c) {
  view.append(crumb(c ? c.name : 'חזרה', '#/course/' + deck.course));
  const head = el('div', 'page-head');
  head.append(el('h1', null, deck.title));
  head.append(el('p', null, `${c ? c.name : ''} · ${plural(deck.cases.length, 'מקרה', 'מקרים')}`));
  view.append(head);

  if (deck.note) {
    const n = el('div', 'cards-note');
    n.textContent = deck.note;
    view.append(n);
  }

  const grid = el('div', 'case-grid');
  deck.cases.forEach((cs) => {
    const a = el('a', 'case-card');
    a.href = '#/case/' + deck.id + '/' + encodeURIComponent(cs.id);
    a.append(el('div', 'case-card-ico', cs.icon || '🩺'));
    const b = el('div', 'case-card-body');
    b.append(el('h3', null, cs.title));
    b.append(el('p', null, cs.opening));
    const meta = el('div', 'card-meta');
    meta.append(el('span', 'tag', `${cs.stages.length} שלבים`));
    if (cs.topic) meta.append(el('span', 'topic', cs.topic));
    const done = caseProg.get(deck.id, cs.id).filter((v) => v != null).length;
    if (caseDone(deck, cs)) meta.append(el('span', 'tag good', '✓ הושלם'));
    else if (done) meta.append(el('span', 'tag', `${done}/${cs.stages.length}`));
    b.append(meta);
    a.append(b);
    grid.append(a);
  });
  view.append(grid);
  toTop();
  updateFooter();
}

/* תרגום בגבול הנגן: מה ששמור ב-localStorage ממופתח qid (v:2), ומה שהנגן
   עובד איתו ממופתח אינדקס. שתי הפונקציות האלה הן הגשר, והן היחידות שיודעות
   ששתי הצורות קיימות.

   רשומה ישנה (בלי v) נקראת כפי שהיא — המפתחות בה *הם* אינדקסים, וזו בדיוק
   המיגרציה: בשמירה הבאה היא נכתבת מחדש לפי qid. שאלה שנמחקה מהקובץ פשוט לא
   נמצאת ב-byQid והתשובה עליה נופלת בשקט, וזה הנכון — היא לא קיימת יותר. */
function fromStore(rec, questions) {
  const src = rec.answers || {};
  if (rec.v !== 2) return { ...src };            // ישן: המפתחות כבר אינדקסים
  const out = {};
  questions.forEach((q, i) => {
    if (q.qid && src[q.qid] !== undefined) out[i] = src[q.qid];
  });
  return out;
}

function toStore(answers, questions) {
  const out = {};
  let all = true;
  Object.entries(answers).forEach(([qi, oi]) => {
    const q = questions[qi];
    if (q && q.qid) out[q.qid] = oi;
    else { all = false; out[qi] = oi; }         // בלי qid — נשאר אינדקס
  });
  return { answers: out, v: all ? 2 : undefined };
}

/* הכרעת תוכן גוברת על המפתח של השחזור.

   המפתח בקובץ המקור נשאר כפי שהמבחן ההוא סימן — גם כשהוא שגוי — כי הוא הקלט
   של גילוי הסתירות ב-repeats.js: שני מופעים נחשבים חלוקים רק אם המסיח המסומן
   בהם שונה. "לתקן" אותו במקור גורם להם להסכים, והסתירה נעלמת בריצה הבאה יחד
   עם האזהרה וההכרעה. לכן ההכרעה מוחלת כאן, בגבול שבין הדאטה לתצוגה: הקובץ
   נשאר מסמך היסטורי, והנגן מדרג לפי מה שנכון. */
const rulingA = (item) => {
  const ans = item.repeat && item.repeat.ruling && item.repeat.ruling.answer;
  if (!ans) return item;
  const norm = (s) => (s || '').replace(/[֑-ׇ]/g, '').replace(/["'׳״`\s]/g, '').toLowerCase();
  const i = (item.opts || []).findIndex((o) => norm(o) === norm(ans));
  return i >= 0 && i !== item.a ? { ...item, a: i } : item;
};

function playQuestions(cfg) {
  const { key, title, subtitle, note, persist, back } = cfg;
  const questions = (cfg.questions || []).map(rulingA);
  view.innerHTML = '';

  /* התשובות פר-מבחן סבלו מאותה תקלה כמו ההתקדמות: הן ממופתחות באינדקס, אז
     אחרי שנמחקת שאלה מאמצע הקובץ הן מוצגות על השאלה הלא-נכונה — הפעם באופן
     גלוי לעין. אבל answers[qi] מופיע בשמונה מקומות בנגן הזה, והוא הנתיב החם
     של האתר. לכן מתרגמים *בגבול* בלבד: הכניסה והשמירה עוברות דרך qid,
     והפנימיות של הנגן ממשיכות לעבוד באינדקס כאילו כלום.

     `v:2` מסמן שהמפתחות כבר qid. בלי הדגל אין דרך להבחין — qid בן 8 תווים
     יכול להיות "12345678", ומפתח אינדקס נראה בדיוק אותו דבר. */
  const rec = persist ? store.exam(key) : { answers: {} };
  const answers = persist ? fromStore(rec, questions) : {};

  /* שאלות "מחוץ לחומר" (offSyllabus) — נושא שיצא מהסילבוס (למשל הלב במחזור נ״ב).
     מוצגות ומתורגלות להעשרה, אבל לא נספרות בציון, בהתקדמות ובפילוח הנושאים. */
  const scoredCount = questions.filter((q) => !q.offSyllabus).length;

  view.append(crumb(back.text, back.href));

  const head = el('div', 'page-head');
  head.append(el('h1', null, title));
  head.append(el('p', null, subtitle));
  view.append(head);

  if (note) {
    const n = el('div', 'q-note');
    n.textContent = note;
    n.style.margin = '0 0 22px';
    view.append(n);
  }

  const bar = el('div', 'exam-bar');
  const counts = el('div', 'counts');
  const cGood = el('span', 'c-good');
  const cBad = el('span', 'c-bad');
  const cLeft = el('span', 'c-left');
  counts.append(cGood, cBad, cLeft);
  bar.append(counts);

  const progress = el('div', 'bar');
  const fill = el('i');
  progress.append(fill);
  bar.append(progress);

  /* מופיע רק כשסיימת. אין גלילה אוטומטית לתוצאה, אז זה מה שמאפשר להגיע
     אליה בלחיצה — במקום להיחטף אליה. */
  const toResult = el('button', 'btn primary', 'לתוצאה ↓');
  toResult.style.display = 'none';
  bar.append(toResult);

  const resetBtn = el('button', 'btn ghost', 'איפוס');
  bar.append(resetBtn);
  view.append(bar);

  const qWrap = el('div');
  const resultBox = el('div');
  view.append(qWrap, resultBox);

  function tally() {
    let good = 0, bad = 0;
    for (const [qi, oi] of Object.entries(answers)) {
      if (questions[qi].offSyllabus) continue;   // מחוץ לחומר — לא נספר
      if (questions[qi].a === oi) good++; else bad++;
    }
    return { good, bad, answered: good + bad };
  }

  function refresh() {
    const { good, bad, answered } = tally();
    cGood.textContent = `✓ ${good}`;
    cBad.textContent = `✗ ${bad}`;
    cLeft.textContent = `נותרו ${scoredCount - answered}`;
    fill.style.width = Math.round((answered / scoredCount) * 100) + '%';
    fill.className = answered ? (good / answered >= 0.7 ? 'good' : 'bad') : '';

    if (persist) {
      store.save(key, {
        ...toStore(answers, questions),        // אינדקס → qid, בגבול בלבד
        correct: good, done: answered === scoredCount, at: Date.now(),
      });
    }

    toResult.style.display = answered === scoredCount ? '' : 'none';

    resultBox.innerHTML = '';
    if (answered !== scoredCount) return;

    const pct = Math.round((good / scoredCount) * 100);
    const box = el('div', 'result');
    box.append(el('div', 'grade ' + (pct >= 80 ? 'good' : pct >= 60 ? 'mid' : 'bad'), pct + '%'));
    box.append(el('div', 'sub', `${good} נכונות מתוך ${scoredCount}. ${
      pct >= 80 ? 'שליטה טובה בחומר.' : pct >= 60 ? 'יש בסיס, כדאי לחזור על הטעויות.' : 'שווה סבב נוסף על החומר.'
    }`));
    const row = el('div', 'btn-row');
    row.style.justifyContent = 'center';
    const again = el('button', 'btn primary', 'סבב נוסף');
    again.onclick = doReset;
    row.append(again);
    const bk = el('a', 'btn', 'חזרה ל' + back.text);
    bk.href = back.href;
    row.append(bk);
    box.append(row);
    resultBox.append(box);

    const bd = topicBreakdown();
    if (bd) resultBox.append(bd);
    /* גם כאן אין גלילה: אחרי השאלה האחרונה עדיין רוצים לקרוא את ההסבר שלה,
       ולא להיחטף אל הציון. התוצאה מחכה למטה, והסרגל העליון מראה שסיימת. */
  }

  /* פילוח לפי נושא — מראה איפה נופלים, לא רק כמה. */
  function topicBreakdown() {
    const byTopic = {};
    questions.forEach((item, qi) => {
      if (item.offSyllabus || !item.topic || answers[qi] == null) return;
      const t = (byTopic[item.topic] ||= { good: 0, total: 0 });
      t.total++;
      if (answers[qi] === item.a) t.good++;
    });

    const topics = Object.entries(byTopic);
    if (!topics.length) return null;
    topics.sort((a, b) => a[1].good / a[1].total - b[1].good / b[1].total);

    const box = el('div', 'form');
    box.append(el('h3', 'bd-title', 'פילוח לפי נושא'));
    box.append(el('p', 'bd-sub', 'ממוין מהחלש לחזק — הנושא העליון הוא זה שכדאי לפתוח בו.'));

    topics.forEach(([name, t]) => {
      const pct = Math.round((t.good / t.total) * 100);
      const r = el('div', 'bd-row');
      r.append(el('span', 'bd-name', name));
      const track = el('div', 'bar');
      const f = el('i');
      f.style.width = pct + '%';
      f.classList.add(pct >= 70 ? 'good' : 'bad');
      track.append(f);
      r.append(track);
      r.append(el('span', 'bd-score ' + (pct >= 70 ? 'ok' : 'no'), `${t.good}/${t.total}`));
      /* "נפלת בפוטנציאל הפעולה" ומיד לידו הדרך לראות אותו קורה.
         זה הרגע שבו הפילוח מפסיק להיות ציון ומתחיל להיות הוראה מה לעשות. */
      const sim = SIM_BY_TOPIC[name];
      if (sim) {
        const a = el('a', 'bd-sim', sim.icon + ' לסימולציה');
        a.href = '#/sim/' + sim.id;
        a.title = sim.title;
        r.append(a);
      }
      const gh = GUIDE_BY_TOPIC[name];
      if (gh) {
        const a = el('a', 'bd-sim bd-guide', '📚 איפה ללמוד');
        a.href = `#/guide/${gh.course}/${encodeURIComponent(name)}`;
        a.title = 'מפת החומרים — ' + name;
        r.append(a);
      }
      const dr = DRILL_BY_TOPIC[name];
      if (dr) {
        const a = el('a', 'bd-sim bd-drill', '🧮 תרגל חישוב');
        a.href = '#/drill/' + dr.id;
        a.title = dr.title;
        r.append(a);
      }
      box.append(r);
    });
    return box;
  }

  function doReset() {
    for (const k of Object.keys(answers)) delete answers[k];
    if (persist) store.reset(key);
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  resetBtn.onclick = () => {
    if (confirm('לאפס את כל התשובות במבחן הזה?')) doReset();
  };

  toResult.onclick = () => resultBox.scrollIntoView({ behavior: 'smooth', block: 'start' });

  function render() {
    qWrap.innerHTML = '';
    questions.forEach((item, qi) => qWrap.append(questionCard(item, qi)));
    refresh();
  }

  function questionCard(item, qi) {
    const card = el('div', 'q' + (item.offSyllabus ? ' off-syllabus' : ''));
    card.id = 'q-' + qi;

    const top = el('div', 'q-top');
    top.append(el('span', 'q-num', `שאלה ${qi + 1} מתוך ${questions.length}`));

    const tags = el('div', 'q-tags');

    if (item.offSyllabus) tags.append(el('span', 'off-tag', '✦ מחוץ לחומר · לא נספר בציון'));

    /* תג החזרה — הסיגנל שבשבילו כל זה נבנה. מוצג בכל מקום שבו שאלה מוצגת:
       בתוך שחזור, בתרגול חופשי, ובמבחן ה-High Yield עצמו. */
    const r = item.repeat;
    if (r && r.n > 1) {
      const tag = el('span', 'repeat' + (r.n >= 3 ? ' hot' : ''));
      tag.append(el('span', null, r.n >= 3 ? '⭐' : '🔁'));
      /* היחידה מגיעה מהנתונים (repeats.js כותב אותה), כי היא משתנה בין מקצועות:
         במולקולרית חזרה נספרת בין *מחזורים*, ובאלקטרו — בין *שנים אקדמיות*. */
      const unit = r.unit || 'מחזורים';
      tag.append(el('span', null, `הופיעה ב-${r.n} ${unit} · ${r.in.join(' · ')}`));
      tag.title =
        `שאלה שחזרה על עצמה בין ${unit} — ההימור הטוב ביותר למבחן.` +
        (r.span >= 3 ? `\nוהיא חזרה על פני ${r.span} ${unit}, לא רק בין שניים סמוכים.` : '');
      tags.append(tag);
    }
    if (item.topic) tags.append(el('span', 'topic', item.topic));
    top.append(tags);
    card.append(top);

    card.append(el('div', 'q-text', item.q));

    if (item.offSyllabus)
      card.append(el('div', 'q-warn off',
        '✦ שאלה זו עוסקת בנושא שיצא מסילבוס מחזור נ״ב (אלקטרופיזיולוגיה של הלב). ' +
        'היא כאן להעשרה בלבד — אין צורך ללמוד אותה למבחן, והיא אינה נספרת בציון.'));

    if (r && r.conflict) {
      if (r.resolved || r.ruling) {
        /* הוכרע. בנציג ה-High Yield ההסבר יושב בהערה שמתחת; בשחזור עצמו אין
           הערה כזאת, ולכן נושאים אותו כאן. */
        const w = el('div', 'q-warn ok');
        const rl = r.ruling;
        w.textContent =
          '✅ המפתחות סימנו תשובות שונות בשאלה הזאת, והיא הוכרעה מול חומרי הקורס. ' +
          (rl ? 'התשובה המסומנת כאן היא המוכרעת.' : 'המפתח כאן מתוקן — ההסבר בהערה שמתחת.') +
          (rl && rl.keys ? ` מה שסימן כל מפתח: ${rl.keys}.` : '') +
          (rl && rl.why ? ` ${rl.why}` : '');
        card.append(w);
      } else if (r.rulingMissing) {
        /* הוכרע — אבל התשובה הנכונה לא הוצעה כמסיח בגרסה הזאת. השאלה פגומה כאן,
           וזה בדיוק מה שהסטודנט צריך לדעת לפני שהוא משנן את המסיח המסומן. */
        card.append(el('div', 'q-warn',
          `⚠️ הוכרע מול חומרי הקורס שהתשובה הנכונה היא "${r.rulingMissing}" — והיא לא הוצעה כמסיח ` +
          'בגרסה הזאת של השאלה. כלומר השאלה כאן פגומה; אל תשנן את המסיח המסומן.'));
      } else {
        card.append(el('div', 'q-warn',
          '⚠️ המפתחות חלוקים על התשובה הנכונה, וטרם הוכרע מי צודק. אל תשנן את השאלה הזאת — תבין אותה.'));
      }
    }

    // מקור השחזור והמבחן שממנו הגיעה השאלה — מידע רקע, לא אזהרה.
    const src = [item.source, item.origin].filter(Boolean).join(' · ');
    if (src) card.append(el('div', 'q-origin', src));

    if (item.note) card.append(el('div', 'q-note', item.note));

    // גרף/תמונה שחולצו מה-PDF. שאלות רבות בביומול ובאלקטרו בלתי פתירות בלעדיהם.
    // באלקטרו הגרפים הם לב המבחן — לחיצה מגדילה אותם למסך מלא (זום).
    if (item.image) {
      const wrap = el('div', 'q-img');
      const img = el('img');
      img.src = item.image;
      img.alt = 'איור לשאלה';
      img.loading = 'lazy';
      img.tabIndex = 0;
      img.title = 'לחצו להגדלה';
      const open = () => openLightbox(item.image);
      img.addEventListener('click', open);
      img.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
      });
      wrap.append(img);
      card.append(wrap);
    }

    if (item.table) card.append(tableOf(item.table));

    const opts = el('div', 'opts');
    const fb = el('div', 'fb');

    /* מסיח הוא div ולא button כי button דורס את הטיפוגרפיה והעטיפה של טקסט
       ארוך בעברית. המחיר הוא שהתפקיד והמקלדת לא מגיעים בחינם — ובלעדיהם
       אפשר לענות רק בעכבר או בקיצור 1-9, וקורא מסך לא יודע שזו בחירה. */
    item.opts.forEach((text, oi) => {
      const o = el('div', 'opt');
      o.setAttribute('role', 'button');
      o.tabIndex = 0;
      o.append(el('span', 'key', String(oi + 1)));
      o.append(el('span', null, text));
      const pick = () => choose(qi, oi, card, opts, fb, item);
      o.onclick = pick;
      o.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }
      });
      opts.append(o);
    });

    card.append(opts, fb);
    if (answers[qi] != null) paint(qi, answers[qi], card, opts, fb, item);
    return card;
  }

  function choose(qi, oi, card, opts, fb, item) {
    if (answers[qi] != null) return;
    answers[qi] = oi;
    if (!item.offSyllabus) seen.mark(item, oi === item.a);   // מחוץ לחומר לא נכנס ל"טעויות שלי"
    paint(qi, oi, card, opts, fb, item);
    refresh();

    /* אין גלילה אוטומטית. הרגע שאחרי המענה הוא הרגע שבו לומדים —
       קוראים את התשובה הנכונה, את ההסבר, ומעכלים. גלילה שמושכת משם
       עובדת נגד המטרה. המשתמש גולל הלאה כשהוא מוכן. */
  }

  function paint(qi, oi, card, opts, fb, item) {
    card.classList.add('done');
    const isRight = oi === item.a;
    opts.querySelectorAll('.opt').forEach((o, i) => {
      o.classList.add('locked');
      /* אחרי המענה אין יותר מה לבחור. בלי זה הטאב ממשיך לעצור על ארבעה
         "כפתורים" מתים בדרך להסבר — שהוא מה שבאמת רוצים להגיע אליו. */
      o.tabIndex = -1;
      o.setAttribute('aria-disabled', 'true');
      if (i === item.a) o.classList.add('correct');
      else if (i === oi) o.classList.add('wrong');
      if (i === oi) o.classList.add('chosen');
    });

    fb.className = 'fb show ' + (isRight ? 'ok' : 'no');
    fb.innerHTML = '';
    fb.append(el('div', null, isRight ? '✓ נכון' : `✗ לא נכון — התשובה הנכונה: ${item.opts[item.a]}`));
    if (item.explain) fb.append(el('div', 'explain', item.explain));
    const sim = SIM_BY_TOPIC[item.topic];
    if (sim) fb.append(simButton(sim));
    /* טעית בשאלת שעתוק? הרגע הזה הוא בדיוק הרגע לדעת מאיזה עמוד ללמוד אותו. */
    const gb = guideButton(item.topic);
    if (gb) fb.append(gb);
    fb.append(notebookButton(item, oi));
  }

  render();
  toTop();
  updateFooter();
}

/* ================= העתקה ל-NotebookLM =================
   כל מה שצריך כדי לבנות את הפרומפט כבר נמצא בדפדפן: נוסח השאלה, המסיחים,
   התשובה הנכונה ומה שהמשתמש בחר. אין צורך בשרת או ב-API — רק להרכיב
   מחרוזת ולשים אותה בלוח.

   שני נוסחים, לפי מה שקרה: טעית → "למה טעיתי"; צדקת → "העמק לי את הנושא". */
function notebookPrompt(item, chosen) {
  const correct = String(item.opts[item.a]).trim();
  const picked = String(item.opts[chosen]).trim();

  /* שאלה שנשענת על טבלה או על הערה (קיצורים, ציון שהיא מבוססת גרף) לא ניתנת
     לפתרון בלעדיהן — בלי זה הפרומפט מגיע לנוטבוק חסר. */
  let q = String(item.q).trim();
  if (item.note) q += `\n(${String(item.note).trim()})`;
  if (item.table) {
    const rows = [item.table.headers, ...item.table.rows]
      .map((r) => r.join(' | '))
      .join('\n');
    q += `\n\nנתוני הטבלה בשאלה:\n${rows}`;
  }

  const parts = [`יש לי בוחן על החומר הזה ונתקלתי בשאלה הבאה: "${q}"`];

  if (chosen === item.a) {
    parts.push(`בחרתי בתשובה הנכונה: "${correct}"`);
    parts.push('עזור לי להבין את הנושא הזה יותר לעומק.');
  } else {
    parts.push(`זאת התשובה שבחרתי: "${picked}"`);
    parts.push(`זאת הייתה תשובה שגויה. התשובה הנכונה היא "${correct}"`);
    parts.push('עזור לי להבין למה התשובה שבחרתי הייתה שגויה.');
  }

  return parts.join('\n\n\n');
}

/* כתיבה ללוח. clipboard API דורש הקשר מאובטח (https / localhost) — יש נפילה
   אחורה ל-execCommand כדי שזה יעבוד גם אם משהו חוסם. */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed; opacity:0; pointer-events:none;';
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

/* מהשאלה לסימולציה. נבחר אוטומטית לפי topic — ראו SIM_BY_TOPIC.
   הרגע שאחרי טעות הוא הרגע שבו סליידר שווה יותר מפסקת הסבר. */
function simButton(sim) {
  const a = el('a', 'nb-btn sim-link');
  a.href = '#/sim/' + sim.id;
  a.append(el('span', 'nb-ico', sim.icon));
  a.append(el('span', null, `שחקו עם זה — ${sim.title}`));
  a.title = sim.blurb;
  return a;
}

function notebookButton(item, chosen) {
  const btn = el('button', 'nb-btn');
  const label = el('span', null, 'העתק ל-NotebookLM');
  btn.append(el('span', 'nb-ico', '📋'));
  btn.append(label);
  btn.title = chosen === item.a
    ? 'מעתיק פרומפט שמבקש להעמיק בנושא'
    : 'מעתיק פרומפט שמסביר למה התשובה שבחרת שגויה';

  btn.onclick = async (e) => {
    e.preventDefault();
    const ok = await copyText(notebookPrompt(item, chosen));
    btn.classList.add(ok ? 'done' : 'fail');
    label.textContent = ok ? 'הועתק! הדבק בנוטבוק' : 'ההעתקה נחסמה';
    setTimeout(() => {
      btn.classList.remove('done', 'fail');
      label.textContent = 'העתק ל-NotebookLM';
    }, 2200);
  };
  return btn;
}

function tableOf(t) {
  const wrap = el('div', 'q-table');
  const table = el('table');
  const hr = el('tr');
  t.headers.forEach((h) => hr.append(el('th', null, h)));
  table.append(hr);
  t.rows.forEach((row) => {
    const tr = el('tr');
    row.forEach((c) => tr.append(el('td', null, c)));
    table.append(tr);
  });
  wrap.append(table);
  return wrap;
}

/* לייטבוקס לגרפים — לחיצה על תמונת שאלה פותחת אותה במסך מלא, ניתן להגדיל.
   באלקטרו הגרפים הם עיקר המבחן והפרטים קטנים, לכן זום הוא חובה. */
function openLightbox(src) {
  const overlay = el('div', 'lightbox');
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'איור לשאלה — תצוגה מוגדלת');

  /* גלילה חיה בתוך העוטף היא מה שהופך את זה לזום אמיתי: התמונה יכולה לחרוג
     מהמסך, ואפשר לנוע בה. בלי זה גרף של פוטנציאל פעולה נכנס למסך הטלפון
     ונעצר שם כבול קטן — וזה כל מה שהיה כאן קודם. */
  const pane = el('div', 'lb-pane');
  const img = el('img');
  img.src = src;
  img.alt = 'איור לשאלה — תצוגה מוגדלת';

  /* לחיצה על התמונה עצמה סגרה את החלון — הקליק בעבע לרקע. זה הפך כל ניסיון
     להתמקד בגרף לסגירה, בדיוק בפעולה שהכי טבעי לעשות. */
  img.addEventListener('click', (e) => {
    e.stopPropagation();
    overlay.classList.toggle('zoomed');
  });
  img.title = 'לחיצה — הגדלה / התאמה למסך';

  const btn = el('button', 'lb-close', '✕');
  btn.type = 'button';
  btn.setAttribute('aria-label', 'סגירה');
  btn.onclick = close;

  pane.append(img);
  overlay.append(pane, btn);

  const prev = document.activeElement;
  function close() {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    if (prev && prev.focus) prev.focus();   // חזרה לתמונה שממנה נפתחנו
  }
  /* המיקוד נלכד בכפתור הסגירה: זה היחיד שאפשר לעשות כאן, ובלי זה הטאב
     ממשיך לרוץ על המבחן שמאחורי החלון. */
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'Tab') { e.preventDefault(); btn.focus(); }
  };
  overlay.addEventListener('click', close);   // רקע בלבד — התמונה עוצרת בעבוע
  document.addEventListener('keydown', onKey);
  document.body.append(overlay);
  btn.focus();
}

/* ================= תרגול חופשי =================
   לא כבול למבחן. בוחרים חלק (א׳/ב׳), נושאים, מצב, וכמות.

   ברירת המחדל היא "שאלות חדשות" — שאלות שעוד לא ראית באף מקום באתר.
   זה מה שמאפשר להתקדם דרך הארכיון במקום לחזור באקראי על אותן שאלות. */
async function renderPractice(courseId, seedTopic = null) {
  setNav('home');
  const c = courseOf(courseId);
  if (!c) {
    view.innerHTML = '';
    view.append(emptyState('⚠️', 'מקצוע לא נמצא', 'הקישור כנראה שגוי.'));
    toTop();
    return;
  }
  await loadGuide(courseId).catch(() => null);   // בשביל כפתור "איפה ללמוד" במשוב

  view.innerHTML = '<div class="empty"><span class="ico">⏳</span><b>טוען את בנק השאלות…</b></div>';

  /* מבחן ה-High Yield נבנה מהשאלות של השחזורים עצמם, ולכן אסור לו להיכנס
     למאגר — אחרת כל שאלה חוזרת הייתה מופיעה כאן פעמיים. */
  /* במקביל ולא בטור. באלקטרו יש 19 קבצים (חצי מגה); await בתוך לולאה הפך
     אותם ל-19 הלוך-ושוב רצופים, כל אחד ממתין לקודמו — בטלפון על סלולרי זו
     המתנה של שניות מול "טוען את בנק השאלות…". loadExam כבר מקאש, אז קריאה
     כפולה לאותו מבחן לא עולה כלום. */
  const metas = quizzesOf(courseId).filter((m) => m.kind !== 'highyield');
  const loaded = await Promise.all(metas.map((m) => loadExam(m.id)));
  const pool = [];
  metas.forEach((m, mi) => {
    loaded[mi].questions.forEach((q, i) =>
      pool.push({ ...q, part: m.part || '', origin: loaded[mi].title, examId: m.id, idx: i })
    );
  });

  view.innerHTML = '';
  view.append(crumb(c.name, '#/course/' + courseId));

  const head = el('div', 'page-head');
  head.append(el('h1', null, `תרגול חופשי — ${c.name}`));
  head.append(el('p', null,
    'בנה לעצמך תרגול. כברירת מחדל תקבל רק שאלות שעוד לא ראית — כדי שתתקדם דרך הארכיון ולא תסתובב במעגל.'));
  view.append(head);

  if (!pool.length) {
    view.append(emptyState('📭', 'אין עדיין שאלות במקצוע הזה', 'הוסף שחזור ראשון, והתרגול ייפתח.'));
    toTop();
    updateFooter();
    return;
  }

  const strip = simStrip(courseId, '🎛️ להתנסות לפני שמתחילים — גררו סליידר וראו מה קורה');
  if (strip) view.append(strip);

  /* --- מצב הסינון --- */
  const allParts = [...new Set(pool.map((q) => q.part))].filter(Boolean).sort();
  const selParts = new Set(allParts);
  /* ריק = כל הנושאים. מגיע מלא כשנכנסים מעמוד סימולציה דרך
     #/practice/<course>/<topic> — drawTopics ינקה נושא שלא קיים במאגר. */
  const selTopics = new Set(seedTopic ? [seedTopic] : []);
  let minRepeat = 1;                    // 1 = הכול. 2/3/4 = רק שאלות שחזרו כך וכך פעמים
  let mode = 'new';                     // new | wrong | all
  let count = 20;
  let query = '';                       // חיפוש חופשי — ריק = בלי סינון
  let imagesOnly = false;               // "רק שאלות עם גרף" — הגרפים הם ליבת המבחן

  /* חיפוש טקסט בעברית: מנקים ניקוד וגרשיים ומאחדים אותיות גדולות/קטנות,
     כדי ש"טלומראז"/"הטלומראז" ו-"MDM2"/"mdm2" ייתפסו. מחפשים מחרוזת-משנה
     על גוף השאלה + המסיחים + הנושא + ההסבר, כי המונח עשוי להופיע רק שם.
     שדה החיפוש (_hay) מחושב פעם אחת לכל שאלה ונשמר. */
  const normQ = (s) => (s || '').replace(/[֑-ׇ]/g, '').replace(/["'׳״`]/g, '').toLowerCase();
  const hay = (q) => (q._hay ??= normQ([q.q, ...(q.opts || []), q.topic, q.explain].filter(Boolean).join(' ')));
  const queryTerms = () => normQ(query).split(/\s+/).filter(Boolean);
  const matchesQuery = (q) => { const t = queryTerms(); return !t.length || t.every((w) => hay(q).includes(w)); };

  /* --- מד התקדמות בארכיון --- */
  const progress = el('div', 'dash');
  view.append(progress);

  function drawProgress() {
    const map = seen.read();
    const total = pool.length;
    const done = pool.filter((q) => map[qKey(q)] !== undefined).length;
    const wrong = pool.filter((q) => map[qKey(q)] === 0).length;
    const fresh = total - done;

    progress.innerHTML = '';
    progress.append(stat(fresh, 'שאלות שלא ראית', fresh ? 'accent' : ''));
    progress.append(stat(done, 'שאלות שראית'));
    progress.append(stat(wrong, 'טעויות פתוחות', wrong ? 'bad' : ''));
    progress.append(stat(Math.round((done / total) * 100) + '%', 'מהמקצוע'));
  }

  const form = el('div', 'form');

  /* --- מצב --- */
  const modeField = el('div', 'field');
  modeField.append(el('label', null, 'מה לתרגל'));
  const modeChips = el('div', 'chips');
  const MODES = [
    { id: 'new',   label: '✨ שאלות חדשות' },
    { id: 'wrong', label: '🎯 רק מה שטעיתי' },
    { id: 'all',   label: '🔁 הכול, כולל מה שראיתי' },
  ];
  MODES.forEach((m) => {
    const ch = chipEl('chip' + (m.id === mode ? ' on' : ''), m.label);
    ch.onclick = () => {
      mode = m.id;
      modeChips.querySelectorAll('.chip').forEach((x) => x.classList.remove('on'));
      ch.classList.add('on');
      update();
    };
    modeChips.append(ch);
  });
  modeField.append(modeChips);
  form.append(modeField);

  /* --- חיפוש חופשי --- */
  const searchField = el('div', 'field');
  searchField.append(el('label', null, 'חיפוש חופשי'));
  const searchRow = el('div', 'search');
  const searchBox = el('input', 'search-box');
  searchBox.type = 'search';
  searchBox.placeholder = 'מילה שמופיעה בשאלה — למשל טלומר, MDM2, אופרון…';
  searchBox.autocomplete = 'off';
  searchBox.setAttribute('enterkeyhint', 'search');
  const searchClear = el('button', 'search-x', '✕');
  searchClear.type = 'button';
  searchClear.title = 'נקה חיפוש';
  const runSearch = () => {
    query = searchBox.value;
    searchRow.classList.toggle('has', !!query.trim());
    drawTopics();       // ספירת הנושאים תשקף רק את מה שתואם לחיפוש
    update();
  };
  searchBox.oninput = runSearch;
  searchClear.onclick = () => { searchBox.value = ''; runSearch(); searchBox.focus(); };
  searchRow.append(searchBox, searchClear);
  searchField.append(searchRow);
  searchField.append(el('p', 'hint', 'מחפש בשאלה, במסיחים, בנושא ובהסבר. אפשר כמה מילים — כולן חייבות להופיע. משתלב עם שאר המסננים.'));
  form.append(searchField);

  /* --- חלק --- */
  if (allParts.length > 1) {
    const partsField = el('div', 'field');
    partsField.append(el('label', null, 'חלק'));
    const chips = el('div', 'chips');
    allParts.forEach((p) => {
      const ch = chipEl('chip on', `${c.name} ${p}`);
      ch.onclick = () => {
        if (selParts.has(p) && selParts.size > 1) { selParts.delete(p); ch.classList.remove('on'); }
        else if (!selParts.has(p)) { selParts.add(p); ch.classList.add('on'); }
        else return;                    // לא מרשים לכבות את האחרון
        drawTopics();
        update();
      };
      chips.append(ch);
    });
    partsField.append(chips);
    form.append(partsField);
  }

  /* --- נושאים --- */
  const topicsField = el('div', 'field');
  const topicsLabel = el('label', null, 'נושאים');
  topicsField.append(topicsLabel);
  const topicChips = el('div', 'chips');
  topicsField.append(topicChips);
  form.append(topicsField);

  const inParts = (q) => !allParts.length || !q.part || selParts.has(q.part);

  function drawTopics() {
    const counts = {};
    pool.filter((q) => inParts(q) && matchesQuery(q) && (!imagesOnly || q.image)).forEach((q) => {
      if (q.topic) counts[q.topic] = (counts[q.topic] || 0) + 1;
    });
    const names = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
    [...selTopics].forEach((t) => { if (!counts[t]) selTopics.delete(t); });

    topicChips.innerHTML = '';
    if (!names.length) { topicsField.style.display = 'none'; return; }
    topicsField.style.display = '';
    topicsLabel.textContent = `נושאים ${selTopics.size ? `(${selTopics.size} נבחרו)` : '(הכול)'}`;

    const all = chipEl('chip' + (selTopics.size === 0 ? ' on' : ''), 'כל הנושאים');
    all.onclick = () => { selTopics.clear(); drawTopics(); update(); };
    topicChips.append(all);

    names.forEach((t) => {
      const ch = chipEl('chip' + (selTopics.has(t) ? ' on' : ''), `${t} · ${counts[t]}`);
      ch.onclick = () => {
        if (selTopics.has(t)) selTopics.delete(t); else selTopics.add(t);
        drawTopics();
        update();
      };
      topicChips.append(ch);
    });
  }

  /* --- חזרות --- */
  const repeatCounts = (min) => pool.filter((q) => (q.repeat?.n || 1) >= min).length;
  if (repeatCounts(2)) {
    const repField = el('div', 'field');
    repField.append(el('label', null, 'שאלות חוזרות'));
    const rc = el('div', 'chips');
    [
      { n: 1, label: 'כל השאלות' },
      { n: 2, label: '🔁 חזרו פעמיים ומעלה' },
      { n: 3, label: '⭐ חזרו 3 פעמים ומעלה' },
      { n: 4, label: '🔥 4 ומעלה' },
    ].forEach(({ n, label }) => {
      const have = repeatCounts(n);
      if (n > 1 && !have) return;                       // אל תציע מסנן שמחזיר אפס
      const ch = chipEl('chip' + (n === minRepeat ? ' on' : ''), n === 1 ? label : `${label} · ${have}`);
      ch.onclick = () => {
        minRepeat = n;
        rc.querySelectorAll('.chip').forEach((x) => x.classList.remove('on'));
        ch.classList.add('on');
        update();
      };
      rc.append(ch);
    });
    repField.append(rc);
    form.append(repField);
  }

  /* --- רק גרפים --- */
  /* הגרפים הם ליבת המבחן, אבל אין להם מצב משלהם — הם פזורים בין הנושאים.
     צ׳יפ אחד שמסנן ל-q.image הופך את בריכת התרגול ל"תרגול קריאת גרפים".
     מוצג רק אם באמת יש שאלות תמונה בבריכה. */
  if (pool.some((q) => q.image)) {
    const imgField = el('div', 'field');
    imgField.append(el('label', null, 'גרפים'));
    const ic = el('div', 'chips');
    const ch = chipEl('chip', '🖼️ רק שאלות עם גרף');
    ch.onclick = () => {
      imagesOnly = !imagesOnly;
      ch.classList.toggle('on', imagesOnly);
      drawTopics();     // ספירת הנושאים תשקף רק שאלות עם גרף
      update();
    };
    ic.append(ch);
    imgField.append(ic);
    imgField.append(el('p', 'hint', 'קריאת גרפי I/V, עקבות קיבוע-מתח ורישומי EPSP — 68 שאלות. משתלב עם שאר המסננים.'));
    form.append(imgField);
  }

  /* --- כמות --- */
  const countField = el('div', 'field');
  countField.append(el('label', null, 'כמה שאלות'));
  const cc = el('div', 'chips');
  [10, 20, 30, 50, 0].forEach((n) => {
    const ch = chipEl('chip' + (n === 20 ? ' on' : ''), n === 0 ? 'הכול' : String(n));
    ch.onclick = () => {
      count = n;
      cc.querySelectorAll('.chip').forEach((x) => x.classList.remove('on'));
      ch.classList.add('on');
      update();
    };
    cc.append(ch);
  });
  countField.append(cc);
  form.append(countField);

  const info = el('p');
  info.style.cssText = 'color:var(--dim); font-size:13.5px; margin-bottom:20px; line-height:1.6;';
  form.append(info);

  const go = el('button', 'btn primary', 'התחל תרגול');
  form.append(go);
  view.append(form);

  /* --- איפוס ההיסטוריה --- */
  const resetRow = el('p');
  resetRow.style.cssText = 'text-align:center; font-size:13px; color:var(--dim);';
  const resetLink = el('button', 'btn ghost', 'איפוס — התחל את המקצוע מחדש');
  resetLink.style.fontSize = '13px';
  resetLink.onclick = () => {
    if (!confirm(`לאפס את הסימון של כל השאלות שראית ב${c.name}?\nהציונים במבחנים עצמם יישארו.`)) return;
    const map = seen.read();
    pool.forEach((q) => delete map[qKey(q)]);
    seen.write(map);
    drawProgress();
    update();
  };
  resetRow.append(resetLink);
  view.append(resetRow);

  function filtered() {
    const map = seen.read();
    return pool.filter((q) => {
      if (!inParts(q)) return false;
      if (!matchesQuery(q)) return false;
      if (imagesOnly && !q.image) return false;
      if (selTopics.size && !selTopics.has(q.topic)) return false;
      if ((q.repeat?.n || 1) < minRepeat) return false;
      const s = map[qKey(q)];
      if (mode === 'new') return s === undefined;
      if (mode === 'wrong') return s === 0;
      return true;
    });
  }

  function update() {
    const f = filtered();
    const take = count === 0 ? f.length : Math.min(count, f.length);

    if (f.length) {
      const label = mode === 'new' ? 'שאלות שלא ראית' : mode === 'wrong' ? 'שאלות שטעית בהן' : 'שאלות';
      info.textContent = `בבריכה: ${f.length} ${label}. ייבחרו ${take} באקראי.`;
      go.disabled = false;
      go.textContent = `התחל תרגול · ${take} שאלות`;
      return;
    }

    // בריכה ריקה — מסבירים למה, ומציעים מוצא
    go.disabled = true;
    go.textContent = 'אין שאלות';
    if (query.trim() && !pool.some((q) => inParts(q) && matchesQuery(q))) {
      info.textContent = `אף שאלה לא מכילה "${query.trim()}". נסה מילה קצרה יותר (למשל "טלומר" במקום "טלומראז") או מונח אחר.`;
    } else if (mode === 'new') {
      info.textContent = 'סיימת! ראית כבר את כל השאלות שמתאימות לסינון הזה. ' +
        'עבור ל"רק מה שטעיתי" כדי לחזור על החורים, או ל"הכול" לסבב נוסף.';
    } else if (mode === 'wrong') {
      info.textContent = 'אין טעויות פתוחות בסינון הזה — או שלא ענית עדיין, או שענית נכון על הכול.';
    } else {
      info.textContent = 'אין שאלות שמתאימות לסינון הזה. הרחב את הבחירה.';
    }
  }

  drawProgress();
  drawTopics();
  update();

  go.onclick = () => {
    const f = shuffle(filtered().slice());
    const picked = count === 0 ? f : f.slice(0, count);

    const bits = [];
    bits.push(mode === 'new' ? 'שאלות חדשות' : mode === 'wrong' ? 'רק טעויות' : 'הכול');
    if (imagesOnly) bits.push('🖼️ רק גרפים');
    if (allParts.length > 1 && selParts.size < allParts.length) bits.push([...selParts].join(', '));
    if (selTopics.size) bits.push(`${selTopics.size} נושאים`);

    playQuestions({
      key: 'practice',
      title: `תרגול חופשי — ${c.name}`,
      subtitle: `${picked.length} שאלות · ${bits.join(' · ')}`,
      questions: picked,
      persist: false,
      back: { text: 'תרגול חדש', href: '#/practice/' + courseId },
    });
  };

  toTop();
  updateFooter();
}


function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* ================= הטעויות שלי (בתוך מקצוע) ================= */
async function renderReview(courseId) {
  setNav('home');
  const c = courseOf(courseId);
  if (!c) {
    view.innerHTML = '';
    view.append(emptyState('⚠️', 'מקצוע לא נמצא', 'הקישור כנראה שגוי.'));
    toTop();
    return;
  }
  await loadGuide(courseId).catch(() => null);   // בשביל כפתור "איפה ללמוד" במשוב

  view.innerHTML = '<div class="empty"><span class="ico">⏳</span><b>אוסף את הטעויות…</b></div>';

  // נשען על מפת ה"נראו" — לכן טעות שנעשתה בתרגול חופשי מגיעה לכאן גם היא,
  // ותשובה נכונה כאן מורידה את השאלה מהרשימה.
  const map = seen.read();
  const metas = quizzesOf(courseId);
  const loaded = await Promise.all(metas.map((m) => loadExam(m.id)));   // במקביל, לא בטור
  const wrong = [];
  /* שאלה חוזרת קיימת גם בשחזור וגם במבחן ה-High Yield שנבנה ממנו. מאז
     שהשניים חולקים qid הן גם חולקות מפתח התקדמות — ולכן *שתיהן* עוברות את
     התנאי, ובלי הסינון הזה אותה טעות מוצגת פעמיים. renderPractice מחריג את
     ה-HY לגמרי, אבל כאן אסור: הטעות עצמה אמיתית וצריכה להופיע — פעם אחת.
     המופע הראשון מנצח, וזה השחזור עצמו: examsOf ממיין לפי מחזור/שנה יורד,
     ול-HY אין אף אחד מהם — הוא נופל לסוף (אומת: אחרון מ-9 במולקולרית,
     אחרון מ-19 באלקטרו). ה-HY של ביוכימיה נכתב ביד ולא נבנה משחזור, ולכן
     יש לו qid משלו וממילא אין מה לאחד. */
  const shown = new Set();
  metas.forEach((m, mi) => {
    loaded[mi].questions.forEach((q, i) => {
      const item = { ...q, origin: loaded[mi].title, examId: m.id, idx: i };
      const k = qKey(item);
      if (map[k] !== 0 || shown.has(k)) return;
      shown.add(k);
      wrong.push(item);
    });
  });

  view.innerHTML = '';

  if (!wrong.length) {
    view.append(crumb(c.name, '#/course/' + courseId));
    const head = el('div', 'page-head');
    head.append(el('h1', null, `הטעויות שלי — ${c.name}`));
    view.append(head);
    view.append(emptyState('🎯', 'אין טעויות לחזור עליהן',
      'או שעוד לא ענית על שאלות במקצוע הזה, או שענית נכון על הכול. כל שאלה שתטעה בה תופיע כאן אוטומטית.'));
    toTop();
    updateFooter();
    return;
  }

  shuffle(wrong);
  playQuestions({
    key: 'review',
    title: `הטעויות שלי — ${c.name}`,
    subtitle: `${wrong.length} שאלות שטעית בהן`,
    note: 'תענה נכון — והשאלה תרד מרשימת הטעויות. תטעה שוב — היא תישאר.',
    questions: wrong,
    persist: false,
    back: { text: c.name, href: '#/course/' + courseId },
  });
}

/* ================= דף הסבר ================= */
function renderAbout() {
  setNav('about');
  view.innerHTML = '';
  localStorage.setItem(SEEN_KEY, '1');

  const head = el('div', 'page-head');
  head.append(el('h1', null, 'מה זה המקום הזה?'));
  head.append(el('p', null, 'דקה של קריאה, ואז אתה יודע להשתמש בכל מה שיש כאן.'));
  view.append(head);

  /* הסיור נשאר נגיש גם אחרי שרצה. מי שדילג בפעם הראשונה — וזה רוב האנשים —
     צריך מקום אחד וידוע לחזור אליו, אחרת הוא אבד לתמיד. */
  const tourCta = el('div', 'about-tour');
  const tt = el('div');
  tt.append(el('b', null, '🧭 מעדיף שיראו לך?'));
  tt.append(el('span', null, 'סיור קצר שמצביע על כל דבר במקום שבו הוא נמצא.'));
  tourCta.append(tt);
  const tb = el('button', 'btn primary', 'התחל סיור');
  tb.onclick = () => startTour();
  tourCta.append(tb);
  view.append(tourCta);

  [
    { icon: '🧬', title: 'ארכיון שחזורים, לא עוד קובץ במחשב',
      body: 'שחזורים של מבחנים, מסודרים לפי מקצוע. נכנסים למקצוע — ורואים רק אותו. במקום לחפש ' +
            'קבצים בוואטסאפ, הכול במקום אחד ותמיד בגרסה העדכנית.' },
    { icon: '✍️', title: 'עונים, ומקבלים תשובה מיד',
      body: 'לוחצים על מסיח. הנכון נצבע ירוק, השגוי אדום — מיד. איפה שיש הסבר, הוא מופיע גם. ' +
            'אפשר גם פשוט להקיש 1, 2, 3 על המקלדת.' },
    { icon: '🎲', title: 'תרגול חופשי — החלק החשוב',
      body: 'בונים תרגול לפי הצורך: נושא מסוים, חלק מסוים, או פשוט אקראי מהכול. השאלות נשלפות ' +
            'מכל המבחנים יחד — וזה חשוב, כי כשפותרים את אותו מבחן פעם שלישית המוח זוכר שהתשובה ' +
            'היא "השלישית" במקום לזכור את החומר. ערבוב שובר את זה.' },
    { icon: '🎯', title: 'הטעויות שלי',
      body: 'כל שאלה שטעית בה נאספת לכאן לבד. זה הדף הכי שווה לפני מבחן: בדיוק רשימת החורים שלך, ' +
            'בלי לבזבז זמן על מה שכבר ידעת.' },
    { icon: '📊', title: 'פילוח לפי נושא',
      body: 'בסוף מבחן שהשאלות בו מתויגות, מופיעה טבלה שממיינת את הנושאים מהחלש לחזק. ' +
            'במקום "קיבלת 62%", אתה רואה בדיוק במה לפתוח כשאתה חוזר.' },
    { icon: '🔒', title: 'ההתקדמות שלך היא שלך',
      body: 'הציונים נשמרים בדפדפן שלך בלבד. אף אחד — כולל מי שהעלה את האתר — לא רואה אותם. ' +
            'אין הרשמה ואין סיסמה. שים לב: ההתקדמות מהמחשב לא תעבור לטלפון.' },
  ].forEach((s) => {
    const c = el('div', 'about-card');
    const h = el('div', 'about-head');
    h.append(el('span', 'about-ico', s.icon));
    h.append(el('h3', null, s.title));
    c.append(h);
    c.append(el('p', null, s.body));
    view.append(c);
  });

  /* בסוף, פרוס. מי שהגיע לדף הזה בא לקרוא — כאן אין סיבה להסתיר מאחורי לחיצה. */
  const disc = el('div', 'about-card about-disc');
  const h = el('div', 'about-head');
  h.append(el('span', 'about-ico', '⚠️'));
  h.append(el('h3', null, 'האחריות על הלמידה היא שלך בלבד'));
  disc.append(h);
  const db = el('div', 'disc-body');
  db.innerHTML = DISC_HTML;
  disc.append(db);
  view.append(disc);

  const cta = el('div', 'result');
  cta.append(el('div', 'sub', 'זהו. עכשיו פשוט תבחר מקצוע ותתחיל.'));
  const row = el('div', 'btn-row');
  row.style.justifyContent = 'center';
  const go = el('a', 'btn primary', 'למקצועות');
  go.href = '#/';
  row.append(go);
  cta.append(row);
  view.append(cta);

  toTop();
  updateFooter();
}

function introBanner() {
  if (localStorage.getItem(SEEN_KEY)) return null;

  const b = el('div', 'intro');
  const txt = el('div');
  txt.append(el('b', null, '👋 פעם ראשונה כאן?'));
  txt.append(el('span', null, 'סיור של דקה — נעבור יחד על מה שאפשר לעשות כאן, ואיך להוציא מזה הכי הרבה.'));
  b.append(txt);

  const acts = el('div', 'btn-row');
  const read = el('button', 'btn primary', 'קחו אותי לסיור');
  read.onclick = () => startTour();
  acts.append(read);
  const skip = el('button', 'btn ghost', 'תודה, אני מסתדר');
  skip.onclick = () => { localStorage.setItem(SEEN_KEY, '1'); b.remove(); };
  acts.append(skip);
  b.append(acts);
  return b;
}

/* ================= הודעה חד-פעמית לכל המשתמשים =================
   "פוש" בתוך האתר: הודעה שמופיעה פעם אחת לכל דפדפן (נשמר ב-localStorage),
   עם זרקור על כפתור ערכת הנושא — אותו כיסוי-חור של הסיור. אין כאן שרת שידחוף
   התראות; זו הדרך להגיע לכל מי שנכנס, בלי הרשמה. להודעה חדשה בעתיד: שנה את
   המפתח (או הוסף אחד) והיא תופיע מחדש לכולם. */
const ANNOUNCE_KEY = 'shichzurim.announce.autoTheme';

function themeAnnounce() {
  if (tourStop) return;                              // לא נתנגש עם הסיור — ננסה שוב בכניסה הבאה
  if (localStorage.getItem(ANNOUNCE_KEY)) return;
  const btn = document.getElementById('themeBtn');
  if (!btn) return;
  localStorage.setItem(ANNOUNCE_KEY, '1');           // מוצג פעם אחת בלבד

  const overlay = el('div', 'tour');
  const hole = el('div', 'tour-hole');
  const pop = el('div', 'tour-pop no-arrow');        // הזרקור על הכפתור הוא ההצבעה; בלי חץ
  overlay.append(hole, pop);
  document.body.append(overlay);

  pop.append(el('div', 'tour-step', '✨ חדש באתר'));
  pop.append(el('h4', null, 'חברים יקרים 💚'));
  const p = el('p');
  p.innerHTML = 'תנו בראש עם השחזורים — אבל <b>אל תהרסו את העיניים</b>. ' +
    'הכפתור המודגש הפך תלת-מצבי, והכי נוח להשאיר אותו על <b>אוטומטי</b>: ' +
    'כשהמכשיר עובר ללילה, האתר עובר איתו לבד. 🌙';
  pop.append(p);

  const row = el('div', 'tour-acts');
  row.style.justifyContent = 'flex-end';
  const ok = el('button', 'btn primary', 'סבבה, יאללה 👍');
  ok.onclick = close;
  row.append(ok);
  pop.append(row);

  function close() {
    overlay.remove();
    window.removeEventListener('resize', place);
    window.removeEventListener('scroll', place);
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e) { if (e.key === 'Escape') close(); }
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  /* ממקם את החור על הכפתור ואת הבועה מתחתיו — נמדד ב-viewport, אז גלילה/שינוי
     גודל ממקמים מחדש (הכותרת דביקה, הכפתור זז מעט עם הגלילה). */
  function place() {
    const r = btn.getBoundingClientRect();
    const pad = 6;
    hole.style.top = r.top - pad + 'px';
    hole.style.left = r.left - pad + 'px';
    hole.style.width = r.width + pad * 2 + 'px';
    hole.style.height = r.height + pad * 2 + 'px';
    const w = Math.min(340, window.innerWidth - 24);
    pop.style.width = w + 'px';
    pop.style.left = Math.max(12, Math.min(r.left, window.innerWidth - w - 12)) + 'px';
    pop.style.top = r.bottom + 14 + 'px';
    pop.style.bottom = 'auto';
  }
  place();
  window.addEventListener('resize', place);
  window.addEventListener('scroll', place, { passive: true });
  ok.focus();
}

/* ================= סיור ההיכרות =================
   רוב מי שנכנס לכאן לא נשלח לאתר — קיבל קישור בוואטסאפ, ואין לו מושג שיש
   מפת חומרים, תרגול חוצה-מבחנים, או תג שאומר אם התשובות אומתו. ינון עונה על
   אותן שאלות בפרטי שוב ושוב. דף טקסט לא פותר את זה: אף אחד לא קורא "מה זה?".

   לכן הסיור מצביע על הדברים **במקום שבו הם באמת נמצאים**, ומנווט בין הדפים
   כדי להראות אותם. הוא נדלג בכל רגע, ורץ פעם אחת — אבל תמיד אפשר להריץ שוב
   מדף ההסבר.

   העוגנים הם `data-tour` ולא מחלקות CSS: מחלקה משנה שם כשמעצבים מחדש, ואז
   הסיור מצביע על כלום בשקט. שלב שהעוגן שלו לא נמצא פשוט מדולג — כך מקצוע
   בלי מפת חומרים לא שובר את הסיור.

   הסיור בונה את עצמו סביב **המבחן הקרוב שלך**, לא סביב מקצוע קבוע. */
const TOUR_KEY = 'shichzurim.tourDone';

/* על איזה מקצוע להעביר את הסיור.

   האינטואיציה הראשונה הייתה "המבחן הקרוב שלך" — אישי ונחמד. אבל בפועל המבחן
   הקרוב עשוי להיות מקצוע בלי מפת חומרים (קליני), ואז דווקא הפיצ׳ר שהכי צריך
   הסבר הוא היחיד שלא מוצג. הסיור נועד ללמד את האתר, לא לשקף את הלו״ז.

   לכן: המבחן הקרוב מנצח רק אם יש לו גם מפה. אחרת מקצוע שיש לו. */
function tourCourse() {
  const full = (id) => quizzesOf(id).length && guideOf(id);
  const next = nextExamOverall();
  if (next && full(next.course.id)) return next.course.id;
  const withGuide = COURSES.find((c) => full(c.id));
  if (withGuide) return withGuide.id;
  if (next && quizzesOf(next.course.id).length) return next.course.id;
  const any = COURSES.find((c) => quizzesOf(c.id).length);
  return any ? any.id : null;
}

function tourSteps() {
  const cid = tourCourse();
  const c = cid ? courseOf(cid) : null;
  const name = c ? c.name : 'המקצוע';
  return [
    { route: '#/', center: true,
      title: '👋 ברוך הבא לארכיון',
      body: 'כאן יושבים כל מבחני השחזור, בכל המקצועות — שאלות אמיתיות ממועדים קודמים, עם הסבר לכל אחת. ' +
            'הסיור הזה לוקח דקה ומראה לך מה אפשר לעשות. אפשר לדלג בכל רגע.' },
    { route: '#/', sel: '[data-tour="countdown"]',
      title: '⏳ המבחן הבא שלך',
      body: 'השעון רץ למועד האמיתי הקרוב, והצבע מתחלף ככל שמתקרבים. הוא לקוח מלוח הבחינות, לא מנוחש.' },
    { route: '#/', sel: '[data-tour="course"]',
      title: '📚 מקצוע אחד בכל פעם',
      body: 'כל מקצוע והמבחנים שלו. הפס מראה כמה כבר ענית, והוא נצבע ירוק כשאתה מעל 70%.' },
    { route: cid ? '#/course/' + cid : '#/', sel: '[data-tour="exam"]',
      title: '📄 כל שחזור — וכמה אפשר לסמוך עליו',
      body: 'לוחצים ופותרים. שימו לב לתגים: "✓ מאסטר רשמי" הוא מבחן מהמודל, ואילו ' +
            '"⚠️ תשובות לא אומתו" אומר שהמשחזרים עצמם כתבו שהמפתח לא נבדק בחשיפה. זה משנה כמה להאמין לתשובה.' },
    { route: cid ? '#/course/' + cid : '#/', sel: '[data-tour="guide"]',
      title: '🗺️ מאיפה ללמוד כל נושא',
      body: 'זה הדבר שהכי מפספסים. לכל נושא: מאיזה סיכום ומאיזה עמוד, מה המרצה אמר במפורש, ' +
            'ומה <b>לא</b> צריך ללמוד. יש גם דירוג — מה הכי כדאי לפתוח עכשיו לפי מה שכבר ידוע לך.' },
    { route: cid ? '#/course/' + cid : '#/', sel: '[data-tour="practice"]',
      title: '🎲 תרגול שחוצה את כל המבחנים',
      body: `לא כבול למבחן אחד — שואב מכל השאלות ב${name} יחד. אפשר לסנן לפי נושא, לחפש מילה, ` +
            'ולבקש רק שאלות שחזרו בכמה מחזורים. כברירת מחדל תקבל רק שאלות שעוד לא ראית.' },
    { route: cid ? '#/course/' + cid : '#/', sel: '[data-tour="review"]',
      title: '🎯 הטעויות שלי',
      body: 'כל שאלה שטעית בה — בכל מקום באתר — נאספת לכאן לבד. תענה עליה נכון והיא יורדת מהרשימה.' },
    { route: cid ? '#/course/' + cid : '#/', center: true,
      title: '✅ זהו, אתה מוכן',
      body: 'עוד שני דברים ששווה לדעת: אחרי כל תשובה יש כפתור שמעתיק שאלה מוכנה ל-NotebookLM ' +
            'אם רוצים להעמיק, ובאלקטרו יש סימולציות אינטראקטיביות. ' +
            'רוצה לראות את הסיור שוב? הוא מחכה בעמוד "מה זה?".' },
  ];
}

/* ממתין שהאלמנט יופיע. הניווט בין דפים הוא אסינכרוני (הראוטר מרנדר מחדש, וחלק
   מהמסכים טוענים קבצים), ולכן אי אפשר פשוט למדוד מיד אחרי שינוי ה-hash. */
/* פולינג ב-setTimeout ולא ב-requestAnimationFrame: rAF לא פועל כשהלשונית
   מוסתרת, ומי שעובר לשונית באמצע הסיור היה חוזר ומוצא אותו תקוע לנצח. */
function waitFor(sel, ms = 1200) {
  return new Promise((done) => {
    const t0 = Date.now();
    (function look() {
      const n = document.querySelector(sel);
      if (n) return done(n);
      if (Date.now() - t0 > ms) return done(null);
      setTimeout(look, 40);
    })();
  });
}

/* ממתין שהגלילה החלקה תיעצר, במקום להמר על מספר קבוע של אלפיות. המרחק שיש
   לגלול משתנה בין שלב לשלב, וטיימר קבוע או מודד מוקדם מדי (והזרקור נוחת ליד
   היעד) או מבזבז זמן. בלשונית מוסתרת גלילה חלקה לא רצה כלל — ואז זה נגמר
   בתקרה ופשוט ממשיך, כי מאזין ה-scroll ממקם מחדש ממילא. */
function scrollSettled(max = 900) {
  return new Promise((done) => {
    const t0 = Date.now();
    let last = window.scrollY, still = 0;
    (function look() {
      if (window.scrollY === last) still++; else { still = 0; last = window.scrollY; }
      if (still >= 3 || Date.now() - t0 > max) return done();
      setTimeout(look, 50);
    })();
  });
}

let tourStop = null;

async function startTour() {
  if (tourStop) return;                       // כבר רץ
  localStorage.setItem(SEEN_KEY, '1');
  const steps = tourSteps();
  let i = 0;

  const overlay = el('div', 'tour');
  const hole = el('div', 'tour-hole');
  const pop = el('div', 'tour-pop');
  overlay.append(hole, pop);
  document.body.append(overlay);

  const end = () => {
    localStorage.setItem(TOUR_KEY, '1');
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', reflow);
    window.removeEventListener('scroll', reflow);
    tourStop = null;
  };
  tourStop = end;

  const onKey = (e) => {
    if (e.key === 'Escape') end();
    else if (e.key === 'ArrowLeft') go(i + 1);    // RTL: שמאלה = קדימה
    else if (e.key === 'ArrowRight') go(i - 1);
  };
  document.addEventListener('keydown', onKey);
  /* הזרקור נמדד ב-viewport, אז כל גלילה מזיזה את היעד מתחתיו. passive — אין
     preventDefault, ובלעדיו הדפדפן מאט את הגלילה בטלפון. */
  const reflow = () => place(steps[i]);
  window.addEventListener('resize', reflow);
  window.addEventListener('scroll', reflow, { passive: true });

  /* ממקם את החור ואת הבועה. אם אין יעד — בועה במרכז המסך והחור מתכווץ לאפס. */
  function place(step) {
    const t = step.sel ? document.querySelector(step.sel) : null;
    if (!t || step.center) {
      hole.style.cssText = 'width:0;height:0;top:50%;left:50%;';
      pop.classList.add('center');
      pop.style.cssText = '';
      return;
    }
    pop.classList.remove('center');
    const r = t.getBoundingClientRect();
    const pad = 6;
    hole.style.top = r.top - pad + 'px';
    hole.style.left = r.left - pad + 'px';
    hole.style.width = r.width + pad * 2 + 'px';
    hole.style.height = r.height + pad * 2 + 'px';

    /* מתחת ליעד אם יש מקום, אחרת מעליו — ובשני הצירים נצמדים לגבולות המסך.
       ההצמדה האנכית אינה קישוט: אם הגלילה ליעד איחרה או נכשלה (המשתמש גלל
       בעצמו, היעד ארוך מהמסך), הבועה הייתה נוחתת מחוץ למסך והסיור נראה שבור
       בלי שום הודעה. עדיף שהיא תתנתק קצת מהיעד מאשר שתיעלם. */
    const w = Math.min(340, window.innerWidth - 24);
    pop.style.width = w + 'px';
    let left = r.left + r.width / 2 - w / 2;
    pop.style.left = Math.max(12, Math.min(left, window.innerWidth - w - 12)) + 'px';

    const ph = pop.offsetHeight;
    const below = window.innerHeight - r.bottom > ph + 24;
    let top = below ? r.bottom + 14 : r.top - 14 - ph;
    top = Math.max(12, Math.min(top, window.innerHeight - ph - 12));
    pop.style.top = top + 'px';
    pop.style.bottom = 'auto';
    /* החץ מוצג רק כשהבועה באמת צמודה ליעד. אחרי הצמדה לגבול הוא היה מצביע
       על כלום, וזה מבלבל יותר מאשר בלי חץ בכלל. */
    pop.classList.toggle('up', !below);
    const glued = below ? Math.abs(top - (r.bottom + 14)) < 2 : Math.abs(top - (r.top - 14 - ph)) < 2;
    pop.classList.toggle('no-arrow', !glued);
  }

  /* שלב יכול לחכות עד 1.2 שניות לאלמנט שעוד נטען, וכל אותו זמן "הבא" עדיין
     לחיץ. בלי הנעילה, שתי לחיצות מהירות מפעילות שני go() במקביל — הם דורסים
     זה את ה-i של זה, והסיור מדלג שלבים או מצייר שלב אחד עם היעד של אחר. */
  let busy = false;

  async function go(n) {
    if (busy || n < 0) return;
    if (n >= steps.length) return end();
    busy = true;
    try { await run(n); } finally { busy = false; }
  }

  async function run(n) {
    i = n;
    const step = steps[i];

    /* הכניסה הראשונה לאתר היא בלי hash כלל, ולכן '#/' הוא ברירת המחדל —
       בלעדיה כל שלב בדף הבית היה מנווט מחדש ומאפס את הגלילה. */
    if (step.route && (location.hash || '#/') !== step.route) location.hash = step.route;

    if (step.sel) {
      const t = await waitFor(step.sel);
      /* שלב שהעוגן שלו לא קיים (מקצוע בלי מפה, למשל) — מדלגים הלאה בשקט
         במקום להצביע על כלום. קריאה ל-run ולא ל-go: אנחנו כבר בתוך הנעילה,
         ו-go היה חוסם את עצמו והסיור היה נתקע על השלב החסר. */
      if (!t) return i + 1 < steps.length ? run(i + 1) : end();
      t.scrollIntoView({ block: 'center', behavior: 'smooth' });
      await scrollSettled();
    } else {
      await new Promise((r) => setTimeout(r, 60));
    }
    draw(step);
    place(step);
  }

  function draw(step) {
    pop.innerHTML = '';
    pop.append(el('div', 'tour-step', `${i + 1} מתוך ${steps.length}`));
    pop.append(el('h4', null, step.title));
    const body = el('p');
    body.innerHTML = step.body;               // מכיל <b> בלבד, מהמקור שלנו
    pop.append(body);

    const row = el('div', 'tour-acts');
    const skip = el('button', 'tour-skip', 'דלג');
    skip.onclick = end;
    row.append(skip);

    const right = el('div', 'tour-nav');
    if (i > 0) { const b = el('button', 'btn ghost', 'הקודם'); b.onclick = () => go(i - 1); right.append(b); }
    const nx = el('button', 'btn primary', i === steps.length - 1 ? 'סיימנו' : 'הבא');
    nx.onclick = () => go(i + 1);
    right.append(nx);
    row.append(right);
    pop.append(row);
    nx.focus();
  }

  go(0);
}

/* ================= סימולציות =================
   סוג התוכן הרביעי. מבחן הוא דאטה ולכן יושב ב-JSON; סימולציה היא משוואה,
   ומשוואה לא ניתן לבטא ב-JSON בלי להמציא שפת ביטויים. לכן ההצהרה
   (סליידרים, נושא, קריאות) היא דאטה, והפיזיקה היא פונקציה — שתיהן כאן.

   הסימולציות בכוונה לא רשומות ב-manifest: הן היו מזהמות את quizzesOf,
   את אריחי ההתקדמות, ואת מאגר התרגול. sync.js לא יודע עליהן דבר.

   הקישור לשאלות אוטומטי לפי topic — ראו SIM_BY_TOPIC. אין הזנת דאטה
   פר-שאלה: כל שאלה שמתויגת בנושא של סימולציה מקבלת אליה כפתור בחינם. */

/* קנבס לא יכול להשתמש ב-var(--x), ולכן קוראים את הערכים בזמן הציור.
   זה גם מה שמאפשר החלפת ערכת נושא בלי לרענן. */
function themeColors() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(n).trim();
  return {
    text: v('--text'), muted: v('--muted'), dim: v('--dim'),
    line: v('--line'), lineSoft: v('--line-soft'),
    surface: v('--surface'), surface2: v('--surface-2'),
    accent: v('--accent'), good: v('--good'), bad: v('--bad'),
    warn: v('--warn'), topic: v('--topic-tx'), gold: v('--gold'),
  };
}

/* מספרים קריאים: 45 ולא 45.00, 0.031 ולא 0.03 */
const num = (v, d = 2) => {
  if (!isFinite(v)) return '—';
  const a = Math.abs(v);
  const dd = a === 0 ? 0 : a < 0.01 ? 4 : a < 1 ? 3 : a < 100 ? d : a < 1000 ? 1 : 0;
  return parseFloat(v.toFixed(dd)).toLocaleString('en-US');
};

/* ערכי ציר עגולים — 1/2/5 כפול חזקה של 10 */
function ticks(min, max, n = 5) {
  const raw = (max - min) / n;
  if (!(raw > 0)) return [min];
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const k = raw / mag;
  const step = (k < 1.5 ? 1 : k < 3 ? 2 : k < 7 ? 5 : 10) * mag;
  const out = [];
  for (let t = Math.ceil(min / step) * step; t <= max + step * 1e-9; t += step) out.push(t);
  return out;
}

/* ציור גרף. זה גוף העבודה — כל הסימולציות יושבות עליו.
   הקנבס נשאר LTR גם באתר RTL: גרף מדעי עם ציר x שגדל שמאלה
   לא קיים בשום ספר, ובוודאי לא בגרפים של המבחן. */
function plot(g, o) {
  const { ctx, w, h } = g;
  const C = o.C;
  const padL = o.padL ?? 54, padR = o.padR ?? 16, padT = 18, padB = 36;
  const x0 = padL, x1 = w - padR, yB = h - padB, yT = padT;
  const sx = (x) => x0 + ((x - o.xMin) / (o.xMax - o.xMin)) * (x1 - x0);
  const sy = (y) => yB - ((y - o.yMin) / (o.yMax - o.yMin)) * (yB - yT);

  ctx.clearRect(0, 0, w, h);
  ctx.font = '11px ' + FONT;
  ctx.textBaseline = 'middle';
  /* הקנבס יורש dir=rtl מהמסמך, ואז "-70" מצויר "70-". עברית בתוך
     פסקה LTR עדיין מסודרת נכון מעצמה, אז LTR הוא הבחירה הנכונה כאן. */
  ctx.direction = 'ltr';

  // רשת
  ctx.strokeStyle = C.lineSoft; ctx.lineWidth = 1;
  ctx.fillStyle = C.dim;
  ticks(o.yMin, o.yMax).forEach((t) => {
    const y = Math.round(sy(t)) + 0.5;
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
    ctx.textAlign = 'right';
    ctx.fillText(num(t), x0 - 8, y);
  });
  ticks(o.xMin, o.xMax).forEach((t) => {
    const x = Math.round(sx(t)) + 0.5;
    ctx.beginPath(); ctx.moveTo(x, yT); ctx.lineTo(x, yB); ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillText(num(t), x, yB + 13);
  });

  // צירים
  ctx.strokeStyle = C.line; ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(x0 + 0.5, yT); ctx.lineTo(x0 + 0.5, yB); ctx.lineTo(x1, yB);
  ctx.stroke();

  // תוויות צירים
  ctx.fillStyle = C.muted;
  ctx.font = '600 11.5px ' + FONT;
  if (o.xLabel) { ctx.textAlign = 'center'; ctx.fillText(o.xLabel, (x0 + x1) / 2, h - 6); }
  if (o.yLabel) {
    ctx.save();
    ctx.translate(11, (yT + yB) / 2); ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center'; ctx.fillText(o.yLabel, 0, 0);
    ctx.restore();
  }

  // קווי ייחוס אופקיים (E_K, סף, מנוחה…)
  (o.marks || []).forEach((m) => {
    if (m.y < o.yMin || m.y > o.yMax) return;
    const y = sy(m.y);
    ctx.save();
    ctx.strokeStyle = m.color; ctx.lineWidth = 1.3; ctx.setLineDash(m.dash || [5, 4]);
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
    ctx.restore();
    if (m.label) {
      ctx.fillStyle = m.color; ctx.font = '700 10.5px ' + FONT;
      ctx.textAlign = 'left';
      ctx.fillText(m.label, x0 + 5, y - 7);
    }
  });

  // עקומות
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  (o.series || []).forEach((s) => {
    if (!s.pts || s.pts.length < 2) return;
    ctx.save();
    ctx.strokeStyle = s.color; ctx.lineWidth = s.width || 2.2;
    if (s.dash) ctx.setLineDash(s.dash);
    ctx.beginPath();
    s.pts.forEach(([x, y], i) => {
      const px = sx(x), py = sy(Math.max(o.yMin, Math.min(o.yMax, y)));
      i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    });
    ctx.stroke();
    ctx.restore();
  });

  // נקודות מסומנות
  (o.dots || []).forEach((d) => {
    ctx.fillStyle = d.color;
    ctx.beginPath(); ctx.arc(sx(d.x), sy(d.y), d.r || 4, 0, 7); ctx.fill();
    if (d.label) {
      ctx.font = '700 10.5px ' + FONT; ctx.textAlign = 'center';
      ctx.fillText(d.label, sx(d.x), sy(d.y) - 12);
    }
  });

  // עמודות (היסטוגרמה)
  (o.bars || []).forEach((b) => {
    const bx = sx(b.x - b.w / 2), bw = Math.max(1, sx(b.x + b.w / 2) - bx);
    const by = sy(b.y);
    ctx.fillStyle = b.color;
    ctx.fillRect(bx, by, bw, yB - by);
  });

  // מקרא
  if (o.legend && o.legend.length) {
    ctx.font = '700 11px ' + FONT; ctx.textAlign = 'left';
    let lx = x0 + 10;
    o.legend.forEach((L) => {
      ctx.fillStyle = L.color;
      ctx.fillRect(lx, yT + 3, 12, 3);
      ctx.fillText(L.label, lx + 17, yT + 5);
      lx += 24 + ctx.measureText(L.label).width;
    });
  }

  return { sx, sy, x0, x1, yT, yB };
}

const FONT = '"Assistant", system-ui, sans-serif';

/* קנבס מודע ל-DPR. בלי זה הכל מטושטש במסכי רטינה. */
function fitCanvas(cv) {
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth, h = cv.clientHeight;
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

/* ---------- הפיזיקה ---------- */

/* נרנסט: E = (RT/zF)·ln(out/in). RT/F ב-37° = 26.73mV. */
const RToverF = (tC) => (8.314 * (tC + 273.15)) / 96485 * 1000;   // mV
const nernst = (tC, z, out, inn) => (RToverF(tC) / z) * Math.log(out / inn);

/* גולדמן. שימו לב שכלור הפוך — הוא שלילי, ולכן out/in מתחלפים. */
function ghk(tC, P, ion) {
  const top = P.K * ion.Ko + P.Na * ion.Nao + P.Cl * ion.Cli;
  const bot = P.K * ion.Ki + P.Na * ion.Nai + P.Cl * ion.Clo;
  return RToverF(tC) * Math.log(top / bot);
}

/* הודג'קין-האקסלי, קונבנציה מודרנית (מנוחה ≈ -65mV, 6.3°C).
   α_n ו-α_m הן 0/0 בדיוק ב--55 ו--40; בלי הגבול מקבלים NaN
   ובדיוק שם עובר הסף, כך שזה היה נופל על כל פוטנציאל פעולה. */
const HH = {
  gNa: 120, gK: 36, gL: 0.3,
  ENa: 50, EK: -77, EL: -54.387,
  Cm: 1, Vrest: -65,
  an: (V) => (Math.abs(V + 55) < 1e-6 ? 0.1 : 0.01 * (V + 55) / (1 - Math.exp(-(V + 55) / 10))),
  bn: (V) => 0.125 * Math.exp(-(V + 65) / 80),
  am: (V) => (Math.abs(V + 40) < 1e-6 ? 1.0 : 0.1 * (V + 40) / (1 - Math.exp(-(V + 40) / 10))),
  bm: (V) => 4 * Math.exp(-(V + 65) / 18),
  ah: (V) => 0.07 * Math.exp(-(V + 65) / 20),
  bh: (V) => 1 / (1 + Math.exp(-(V + 35) / 10)),
};

/* מריצים את המודל מראש ומציירים את כל העקבה בבת אחת.
   זה עדיף על אנימציה: רואים את שרשרת הסיבתיות (מתח → מוליכות → שערים)
   מיושרת על אותו ציר זמן במבט אחד, וזה בדיוק מה שהמבחן שואל עליו. */
function runHH({ dur = 30, dt = 0.01, I = 0, tOn = 5, tOff = 5.5, ttx = false, tea = false, clamp = null }) {
  const H = HH;
  let V = H.Vrest;
  let n = H.an(V) / (H.an(V) + H.bn(V));
  let m = H.am(V) / (H.am(V) + H.bm(V));
  let h = H.ah(V) / (H.ah(V) + H.bh(V));
  const out = { t: [], V: [], m: [], h: [], n: [], gNa: [], gK: [], INa: [], IK: [], Im: [] };
  const gNaMax = ttx ? 0 : H.gNa;
  const gKMax = tea ? 0 : H.gK;
  const steps = Math.round(dur / dt);
  const every = Math.max(1, Math.round(steps / 1200));   // ~1200 נקודות זה יותר מדי פיקסלים ממילא

  for (let i = 0; i <= steps; i++) {
    const t = i * dt;
    const gNa = gNaMax * m * m * m * h;
    const gK = gKMax * n * n * n * n;
    const INa = gNa * (V - H.ENa);
    const IK = gK * (V - H.EK);
    const IL = H.gL * (V - H.EL);
    const Iinj = t >= tOn && t < tOff ? I : 0;

    if (i % every === 0) {
      out.t.push(t); out.V.push(V); out.m.push(m); out.h.push(h); out.n.push(n);
      out.gNa.push(gNa); out.gK.push(gK); out.INa.push(INa); out.IK.push(IK);
      out.Im.push(INa + IK + IL);
    }

    // שערים מתקדמים תמיד; המתח — רק אם לא מקובע.
    const dn = H.an(V) * (1 - n) - H.bn(V) * n;
    const dm = H.am(V) * (1 - m) - H.bm(V) * m;
    const dh = H.ah(V) * (1 - h) - H.bh(V) * h;
    n += dn * dt; m += dm * dt; h += dh * dt;

    if (clamp) V = clamp(t);
    else V += ((Iinj - INa - IK - IL) / H.Cm) * dt;
  }
  return out;
}

/* ---------- הסימולציות ---------- */
const SIMS = [
  {
    id: 'cable',
    course: 'electro',
    icon: '📉',
    title: 'קבוע הזמן וקבוע המרחב',
    blurb: 'למה ממברנה מגיבה לאט, ולמה אות דועך לפני שהוא מגיע לגוף התא',
    topics: ['תכונות פאסיביות של הממברנה'],
    insight: 'הכפילו את קוטר האקסון פי 4 — λ גדל רק פי 2, כי λ ∝ √d. ' +
             'ועכשיו שימו לב למה שלא קרה: τ לא זז בכלל. קוטר משפיע על המרחק, לא על הזמן.',
    params: [
      { k: 'Rin', label: 'התנגדות כניסה Rin', unit: 'MΩ', min: 10, max: 400, step: 5, val: 150, group: 'תא איזופוטנציאלי — קבוע הזמן' },
      { k: 'Cm', label: 'קיבול הממברנה Cmem', unit: 'pF', min: 50, max: 600, step: 10, val: 300, group: 'תא איזופוטנציאלי — קבוע הזמן' },
      { k: 'I', label: 'זרם מוזרק I', unit: 'pA', min: 50, max: 800, step: 10, val: 300, group: 'תא איזופוטנציאלי — קבוע הזמן' },
      { k: 'd', label: 'קוטר הדנדריט d', unit: 'µm', min: 0.5, max: 20, step: 0.5, val: 4, group: 'כבל — קבוע המרחב' },
      { k: 'Rm', label: 'התנגדות ממברנה סגולית Rm', unit: 'kΩ·cm²', min: 1, max: 100, step: 1, val: 20, group: 'כבל — קבוע המרחב' },
      { k: 'Ri', label: 'התנגדות ציטופלזמית Ri', unit: 'Ω·cm', min: 50, max: 400, step: 10, val: 100, group: 'כבל — קבוע המרחב' },
    ],
    readouts: (p) => {
      const tau = (p.Rin * p.Cm) / 1000;               // MΩ·pF = µs → ms
      const Vinf = (p.I * p.Rin) / 1000;               // pA·MΩ = µV → mV
      const lam = Math.sqrt((p.d * p.Rm) / (40 * p.Ri)) * 10;   // cm → mm
      return [
        { v: num(tau) + ' ms', label: 'τ = Rin · Cmem', cls: 'accent' },
        { v: num(Vinf) + ' mV', label: 'V∞ = I · Rin', cls: '' },
        { v: num(lam) + ' mm', label: 'λ = √(d·Rm / 4·Ri)', cls: 'accent' },
        { v: num(-70 + Vinf) + ' mV', label: 'מתח סופי', cls: '' },
      ];
    },
    panels: [
      {
        label: 'טעינת הממברנה בזמן — V(t) = V∞·(1 − e^(−t/τ))',
        draw: (g, p, C) => {
          const tau = (p.Rin * p.Cm) / 1000, Vinf = (p.I * p.Rin) / 1000;
          const dur = Math.max(30, tau * 4);
          const pts = [];
          for (let i = 0; i <= 300; i++) {
            const t = (i / 300) * dur;
            pts.push([t, -70 + Vinf * (1 - Math.exp(-t / tau))]);
          }
          plot(g, {
            C, xMin: 0, xMax: dur, yMin: -75, yMax: Math.max(-40, -70 + Vinf * 1.15),
            xLabel: 'זמן (ms)', yLabel: 'מתח (mV)',
            marks: [
              { y: -70 + Vinf, label: 'V∞', color: C.dim },
              { y: -70 + Vinf * 0.632, label: '63%  ·  t = τ', color: C.accent },
              { y: -50, label: 'סף', color: C.bad, dash: [3, 3] },
            ],
            series: [{ pts, color: C.accent, width: 2.6 }],
            dots: [{ x: tau, y: -70 + Vinf * 0.632, color: C.accent }],
          });
        },
      },
      {
        label: 'דעיכת האות במרחק — V(x) = V₀·e^(−x/λ)',
        draw: (g, p, C) => {
          const lam = Math.sqrt((p.d * p.Rm) / (40 * p.Ri)) * 10;
          const dur = Math.max(1, lam * 4);
          const pts = [];
          for (let i = 0; i <= 300; i++) {
            const x = (i / 300) * dur;
            pts.push([x, 100 * Math.exp(-x / lam)]);
          }
          plot(g, {
            C, xMin: 0, xMax: dur, yMin: 0, yMax: 105,
            xLabel: 'מרחק מהסינפסה (mm)', yLabel: 'אחוז מהמשרעת המקורית',
            marks: [{ y: 37, label: '37%  ·  x = λ', color: C.accent }],
            series: [{ pts, color: C.warn, width: 2.6 }],
            dots: [{ x: lam, y: 37, color: C.accent }],
          });
        },
      },
    ],
  },

  {
    id: 'nernst',
    course: 'electro',
    icon: '⚖️',
    title: 'נרנסט וגולדמן — פוטנציאל המנוחה',
    blurb: 'איפה יושב מתח המנוחה, ולמה הוא נמשך ליון בעל החדירות הגבוהה',
    topics: ['פוטנציאל מנוחה', 'תנועת חלקיקים ודיפוזיה'],
    insight: 'גררו את האשלגן החוץ-תאי מ-4 ל-10 mM — זו היפרקלמיה, והתא מתדפלר. ' +
             'עכשיו העלו את P_Na לגובה P_K: המתח קופץ לכיוון E_Na. הממברנה תמיד נמשכת ליון שהיא הכי חדירה לו.',
    params: [
      { k: 'Ko', label: 'אשלגן חוץ-תאי [K⁺]out', unit: 'mM', min: 1, max: 20, step: 0.5, val: 4, group: 'ריכוזים' },
      { k: 'Ki', label: 'אשלגן תוך-תאי [K⁺]in', unit: 'mM', min: 100, max: 160, step: 5, val: 140, group: 'ריכוזים' },
      { k: 'Nao', label: 'נתרן חוץ-תאי [Na⁺]out', unit: 'mM', min: 100, max: 160, step: 5, val: 145, group: 'ריכוזים' },
      { k: 'Nai', label: 'נתרן תוך-תאי [Na⁺]in', unit: 'mM', min: 5, max: 30, step: 1, val: 12, group: 'ריכוזים' },
      { k: 'pNa', label: 'חדירות יחסית לנתרן P_Na/P_K', unit: '', min: 0.005, max: 1, step: 0.005, val: 0.03, group: 'חדירות וטמפרטורה' },
      { k: 'pCl', label: 'חדירות יחסית לכלור P_Cl/P_K', unit: '', min: 0, max: 2, step: 0.05, val: 0.45, group: 'חדירות וטמפרטורה' },
      { k: 'T', label: 'טמפרטורה', unit: '°C', min: 0, max: 45, step: 1, val: 37, group: 'חדירות וטמפרטורה' },
    ],
    readouts: (p) => {
      const ion = { Ko: p.Ko, Ki: p.Ki, Nao: p.Nao, Nai: p.Nai, Clo: 110, Cli: 10 };
      const vm = ghk(p.T, { K: 1, Na: p.pNa, Cl: p.pCl }, ion);
      return [
        { v: num(nernst(p.T, 1, p.Ko, p.Ki)) + ' mV', label: 'E_K', cls: 'accent' },
        { v: num(nernst(p.T, 1, p.Nao, p.Nai)) + ' mV', label: 'E_Na', cls: 'bad' },
        { v: num(nernst(p.T, -1, 110, 10)) + ' mV', label: 'E_Cl', cls: '' },
        { v: num(vm) + ' mV', label: 'Vm (גולדמן)', cls: 'good' },
      ];
    },
    panels: [
      {
        label: 'איפה יושב Vm ביחס לפוטנציאלי שיווי המשקל',
        h: 150,
        draw: (g, p, C) => {
          const ion = { Ko: p.Ko, Ki: p.Ki, Nao: p.Nao, Nai: p.Nai, Clo: 110, Cli: 10 };
          const vm = ghk(p.T, { K: 1, Na: p.pNa, Cl: p.pCl }, ion);
          const EK = nernst(p.T, 1, p.Ko, p.Ki);
          const ENa = nernst(p.T, 1, p.Nao, p.Nai);
          const ECl = nernst(p.T, -1, 110, 10);
          const { ctx, w, h } = g;
          ctx.clearRect(0, 0, w, h);
          ctx.direction = 'ltr';
          const x0 = 30, x1 = w - 30, mid = h / 2 + 6;
          const lo = -110, hi = 70;
          const sx = (v) => x0 + ((v - lo) / (hi - lo)) * (x1 - x0);

          ctx.strokeStyle = C.line; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(x0, mid); ctx.lineTo(x1, mid); ctx.stroke();
          ctx.font = '11px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ticks(lo, hi, 6).forEach((t) => {
            ctx.strokeStyle = C.lineSoft;
            ctx.beginPath(); ctx.moveTo(sx(t), mid - 5); ctx.lineTo(sx(t), mid + 5); ctx.stroke();
            ctx.fillStyle = C.dim; ctx.fillText(num(t), sx(t), mid + 18);
          });

          [[EK, 'E_K', C.accent], [ECl, 'E_Cl', C.dim], [ENa, 'E_Na', C.bad]].forEach(([v, lb, col]) => {
            ctx.strokeStyle = col; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(sx(v), mid - 20); ctx.lineTo(sx(v), mid + 20); ctx.stroke();
            ctx.fillStyle = col; ctx.font = '700 11px ' + FONT;
            ctx.fillText(lb, sx(v), mid - 30);
          });

          // המחוג — Vm
          const x = sx(vm);
          ctx.fillStyle = C.good;
          ctx.beginPath();
          ctx.moveTo(x, mid - 9); ctx.lineTo(x - 7, mid - 22); ctx.lineTo(x + 7, mid - 22);
          ctx.closePath(); ctx.fill();
          ctx.beginPath(); ctx.arc(x, mid, 5, 0, 7); ctx.fill();
          ctx.font = '800 13px ' + FONT;
          ctx.fillText(num(vm) + ' mV', x, mid + 36);
          ctx.font = '700 10.5px ' + FONT; ctx.fillStyle = C.muted;
          ctx.fillText('Vm', x, mid - 32);
        },
      },
      {
        label: 'מתח המנוחה כתלות באשלגן החוץ-תאי — עקומת ההיפרקלמיה',
        draw: (g, p, C) => {
          const pts = [], nrn = [];
          for (let i = 0; i <= 200; i++) {
            const ko = 1 + (i / 200) * 19;
            const ion = { Ko: ko, Ki: p.Ki, Nao: p.Nao, Nai: p.Nai, Clo: 110, Cli: 10 };
            pts.push([ko, ghk(p.T, { K: 1, Na: p.pNa, Cl: p.pCl }, ion)]);
            nrn.push([ko, nernst(p.T, 1, ko, p.Ki)]);
          }
          const ion = { Ko: p.Ko, Ki: p.Ki, Nao: p.Nao, Nai: p.Nai, Clo: 110, Cli: 10 };
          plot(g, {
            C, xMin: 1, xMax: 20, yMin: -110, yMax: 10,
            xLabel: 'אשלגן חוץ-תאי [K⁺]out (mM)', yLabel: 'מתח (mV)',
            legend: [{ label: 'Vm — גולדמן', color: C.good }, { label: 'E_K — נרנסט', color: C.accent }],
            series: [
              { pts: nrn, color: C.accent, width: 2, dash: [5, 4] },
              { pts, color: C.good, width: 2.6 },
            ],
            dots: [{ x: p.Ko, y: ghk(p.T, { K: 1, Na: p.pNa, Cl: p.pCl }, ion), color: C.good, r: 5 }],
          });
        },
      },
    ],
  },

  {
    id: 'ap',
    course: 'electro',
    icon: '⚡',
    title: 'פוטנציאל הפעולה — הודג׳קין והאקסלי',
    blurb: 'שרשרת הסיבתיות המלאה: סף → m נפתח → h נסגר → n נפתח → מנוחה',
    topics: ['פוטנציאל הפעולה'],
    insight: 'הורידו את הזרם ל-6.9 — שום דבר. העלו ל-7.0 — פוטנציאל פעולה מלא של ‎+35mV. ' +
             'שינוי של אחוז אחד בגירוי, והתגובה קופצת ב-90mV: זו הכל-או-כלום, ואפשר למצוא את הסף בעצמכם. ' +
             'ואז הסתכלו בלוח השערים: m נפתח ראשון, ורק אחר כך h נסגר ו-n נפתח — שניהם יחד עושים את הרפרקטוריות.',
    params: [
      { k: 'I', label: 'זרם מוזרק', unit: 'µA/cm²', min: 0, max: 40, step: 0.1, val: 10, group: 'הגירוי' },
      { k: 'durI', label: 'משך הגירוי', unit: 'ms', min: 0.1, max: 5, step: 0.1, val: 1, group: 'הגירוי' },
      { k: 'gNa', label: 'ḡNa — צפיפות תעלות נתרן', unit: 'mS/cm²', min: 0, max: 200, step: 5, val: 120, group: 'הממברנה' },
      { k: 'gK', label: 'ḡK — צפיפות תעלות אשלגן', unit: 'mS/cm²', min: 0, max: 80, step: 2, val: 36, group: 'הממברנה' },
    ],
    run: (p) => {
      const save = { gNa: HH.gNa, gK: HH.gK };
      HH.gNa = p.gNa; HH.gK = p.gK;
      const r = runHH({ dur: 25, I: p.I, tOn: 3, tOff: 3 + p.durI });
      HH.gNa = save.gNa; HH.gK = save.gK;
      return r;
    },
    readouts: (p, r) => {
      const peak = Math.max(...r.V);
      const trough = Math.min(...r.V.slice(r.V.indexOf(peak)));
      const fired = peak > 0;
      const iPk = r.V.indexOf(peak);
      return [
        { v: fired ? '✓ נורה' : '✗ לא נורה', label: 'פוטנציאל פעולה', cls: fired ? 'good' : 'bad' },
        { v: num(peak) + ' mV', label: 'שיא המתח', cls: '' },
        { v: num(trough) + ' mV', label: 'היפר-פולריזציה', cls: '' },
        { v: fired ? num(r.t[iPk] - 3) + ' ms' : '—', label: 'זמן לשיא', cls: '' },
      ];
    },
    panels: [
      {
        label: 'מתח הממברנה',
        draw: (g, p, C, st, r) => {
          plot(g, {
            C, xMin: 0, xMax: 25, yMin: -90, yMax: 60,
            xLabel: 'זמן (ms)', yLabel: 'Vm (mV)',
            marks: [
              { y: -65, label: 'מנוחה', color: C.dim, dash: [4, 4] },
              { y: HH.ENa, label: 'E_Na', color: C.bad },
              { y: HH.EK, label: 'E_K', color: C.accent },
            ],
            series: [{ pts: r.t.map((t, i) => [t, r.V[i]]), color: C.text, width: 2.6 }],
          });
        },
      },
      {
        label: 'מוליכות — מה שגורם למתח לזוז',
        draw: (g, p, C, st, r) => {
          plot(g, {
            C, xMin: 0, xMax: 25, yMin: 0, yMax: Math.max(5, Math.max(...r.gNa, ...r.gK) * 1.15),
            xLabel: 'זמן (ms)', yLabel: 'מוליכות (mS/cm²)',
            legend: [{ label: 'gNa', color: C.bad }, { label: 'gK', color: C.accent }],
            series: [
              { pts: r.t.map((t, i) => [t, r.gNa[i]]), color: C.bad, width: 2.4 },
              { pts: r.t.map((t, i) => [t, r.gK[i]]), color: C.accent, width: 2.4 },
            ],
          });
        },
      },
      {
        label: 'השערים עצמם — m נפתח מהר, h נסגר, n מאחר',
        draw: (g, p, C, st, r) => {
          plot(g, {
            C, xMin: 0, xMax: 25, yMin: 0, yMax: 1.05,
            xLabel: 'זמן (ms)', yLabel: 'הסתברות שהשער פתוח',
            legend: [
              { label: 'm — אקטיבציה של Na', color: C.bad },
              { label: 'h — אינאקטיבציה של Na', color: C.warn },
              { label: 'n — אקטיבציה של K', color: C.accent },
            ],
            series: [
              { pts: r.t.map((t, i) => [t, r.m[i]]), color: C.bad, width: 2.2 },
              { pts: r.t.map((t, i) => [t, r.h[i]]), color: C.warn, width: 2.2 },
              { pts: r.t.map((t, i) => [t, r.n[i]]), color: C.accent, width: 2.2 },
            ],
          });
        },
      },
    ],
  },

  {
    id: 'vclamp',
    course: 'electro',
    icon: '🔬',
    title: 'קיבוע מתח — TTX ו-TEA',
    blurb: 'הניסוי שפירק את פוטנציאל הפעולה לשני זרמים נפרדים',
    topics: ['שיטות מחקר'],
    insight: 'קפצו ל-0mV: קודם זרם נתרן מהיר פנימה (שלילי, כלפי מטה), אחריו זרם אשלגן איטי החוצה. ' +
             'הוסיפו TTX — נשאר רק החוצה. הוסיפו TEA במקום — נשאר רק פנימה. ' +
             'בקיבוע מתח dV/dt=0, ולכן הזרם הקיבולי נעלם ומה שנמדד הוא הזרם היוני בלבד.',
    params: [
      { k: 'Vc', label: 'מתח הפקודה Vc', unit: 'mV', min: -80, max: 60, step: 5, val: 0, group: 'הפקודה' },
    ],
    toggles: [
      { k: 'ttx', label: 'TTX — חוסם נתרן' },
      { k: 'tea', label: 'TEA — חוסם אשלגן' },
    ],
    run: (p) => runHH({
      dur: 20, ttx: p.ttx, tea: p.tea,
      clamp: (t) => (t >= 2 && t < 14 ? p.Vc : HH.Vrest),
    }),
    readouts: (p, r) => {
      const w = r.t.map((t, i) => (t >= 2 && t < 14 ? i : -1)).filter((i) => i >= 0);
      const IN = Math.min(...w.map((i) => r.Im[i]));
      const OUT = Math.max(...w.map((i) => r.Im[i]));
      return [
        { v: num(IN) + ' µA/cm²', label: 'שיא הזרם פנימה (Na⁺)', cls: 'bad' },
        { v: num(OUT) + ' µA/cm²', label: 'זרם החוצה בפלאטו (K⁺)', cls: 'accent' },
        { v: num(p.Vc - HH.ENa) + ' mV', label: 'כוח מניע לנתרן (Vc − E_Na)', cls: '' },
        { v: num(p.Vc - HH.EK) + ' mV', label: 'כוח מניע לאשלגן (Vc − E_K)', cls: '' },
      ];
    },
    panels: [
      {
        label: 'מתח הפקודה',
        h: 120,
        draw: (g, p, C, st, r) => {
          plot(g, {
            C, xMin: 0, xMax: 20, yMin: -90, yMax: 70,
            xLabel: '', yLabel: 'Vc (mV)',
            series: [{ pts: r.t.map((t, i) => [t, r.V[i]]), color: C.dim, width: 2.2 }],
          });
        },
      },
      {
        label: 'זרם הממברנה הנמדד — Im',
        draw: (g, p, C, st, r) => {
          const lo = Math.min(-50, Math.min(...r.Im) * 1.15);
          const hi = Math.max(50, Math.max(...r.Im) * 1.15);
          plot(g, {
            C, xMin: 0, xMax: 20, yMin: lo, yMax: hi,
            xLabel: 'זמן (ms)', yLabel: 'זרם (µA/cm²)',
            marks: [{ y: 0, label: '', color: C.line, dash: [] }],
            legend: [
              { label: 'זרם כולל', color: C.text },
              { label: 'I_Na', color: C.bad },
              { label: 'I_K', color: C.accent },
            ],
            series: [
              { pts: r.t.map((t, i) => [t, r.INa[i]]), color: C.bad, width: 1.6, dash: [4, 3] },
              { pts: r.t.map((t, i) => [t, r.IK[i]]), color: C.accent, width: 1.6, dash: [4, 3] },
              { pts: r.t.map((t, i) => [t, r.Im[i]]), color: C.text, width: 2.6 },
            ],
          });
        },
      },
    ],
  },

  {
    id: 'quantal',
    course: 'electro',
    icon: '📊',
    title: 'התאוריה הקוונטלית של כץ',
    blurb: 'למה ההיסטוגרמה מתפצלת לפיקים בכפולות שלמות — וסיקולה אחת, שתיים, שלוש',
    topics: ['התאוריה הקוונטאלית'],
    insight: 'הורידו את הסידן ל-0.5 mM ולחצו ×200: רוב הגירויים הם כישלונות, והפיקים יוצאים ב-0, q, 2q. ' +
             'זו ההוכחה שהשחרור קוונטלי. שימו לב ש-p תלוי בסידן בחזקה ~4 — הכפלת הסידן מכפילה את השחרור הרבה יותר מפי 2.',
    params: [
      { k: 'n', label: 'מספר אתרי שחרור n', unit: '', min: 1, max: 20, step: 1, val: 6, group: 'הסינפסה' },
      { k: 'Ca', label: 'סידן חוץ-תאי [Ca²⁺]', unit: 'mM', min: 0.2, max: 5, step: 0.1, val: 1, group: 'הסינפסה' },
      { k: 'q', label: 'גודל קוונטלי q', unit: 'mV', min: 0.2, max: 2, step: 0.1, val: 0.8, group: 'הסינפסה' },
    ],
    init: () => ({ trials: [] }),
    buttons: (st, p, refresh) => [
      { label: 'גירוי בודד', cls: 'primary', run: () => { quantalDraw(st, p, 1); refresh(); } },
      { label: '×50', cls: '', run: () => { quantalDraw(st, p, 50); refresh(); } },
      { label: '×200', cls: '', run: () => { quantalDraw(st, p, 200); refresh(); } },
      { label: 'אפס', cls: 'ghost', run: () => { st.trials = []; refresh(); } },
    ],
    readouts: (p, r, st) => {
      const pr = quantalP(p.Ca);
      const N = st.trials.length;
      const fails = st.trials.filter((k) => k === 0).length;
      const obs = N ? st.trials.reduce((a, k) => a + k, 0) / N : 0;
      return [
        { v: num(pr, 3), label: 'p — הסתברות שחרור לאתר', cls: 'accent' },
        { v: num(p.n * pr), label: 'm = n · p (תוחלת)', cls: 'accent' },
        { v: N ? num(obs) : '—', label: `m נמדד (${N} גירויים)`, cls: 'good' },
        { v: N ? num((100 * fails) / N) + '%' : '—', label: 'כישלונות', cls: 'bad' },
      ];
    },
    panels: [
      {
        label: 'היסטוגרמת המשרעות — כל עמודה היא מספר וסיקולות שלם',
        draw: (g, p, C, st) => {
          const N = st.trials.length;
          const counts = {};
          st.trials.forEach((k) => { counts[k] = (counts[k] || 0) + 1; });
          const maxK = Math.max(p.n, 1);
          const maxC = Math.max(1, ...Object.values(counts));
          const bars = [];
          for (let k = 0; k <= maxK; k++) {
            if (!counts[k]) continue;
            bars.push({ x: k * p.q, y: counts[k], w: p.q * 0.45, color: k === 0 ? C.bad : C.accent });
          }
          plot(g, {
            C, xMin: -p.q * 0.6, xMax: (maxK + 0.6) * p.q, yMin: 0, yMax: maxC * 1.15,
            xLabel: 'משרעת התגובה הפוסט-סינפטית (mV)', yLabel: 'מספר גירויים',
            bars,
            marks: N ? [] : [],
          });
          if (!N) {
            const { ctx, w, h } = g;
            ctx.fillStyle = C.dim; ctx.font = '600 13px ' + FONT;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText('לחצו "גירוי" כדי להתחיל לבנות את ההיסטוגרמה', w / 2, h / 2);
          }
        },
      },
      {
        label: 'הסתברות השחרור כתלות בסידן — שיתופיות בחזקת 4',
        h: 170,
        draw: (g, p, C) => {
          const pts = [];
          for (let i = 0; i <= 200; i++) {
            const ca = 0.2 + (i / 200) * 4.8;
            pts.push([ca, quantalP(ca)]);
          }
          plot(g, {
            C, xMin: 0.2, xMax: 5, yMin: 0, yMax: 1,
            xLabel: 'סידן חוץ-תאי (mM)', yLabel: 'p',
            series: [{ pts, color: C.warn, width: 2.6 }],
            dots: [{ x: p.Ca, y: quantalP(p.Ca), color: C.warn, r: 5 }],
          });
        },
      },
    ],
  },

  /* המיקוד מבקש במפורש: "תרגלו לחשב זאת על נתוני מטופל". חמישה ספים, שלושה
     מהם תלויי-מין, ואבחנה שנקבעת בספירה — בדיוק מה שסליידרים עושים טוב. */
  {
    id: 'mets',
    course: 'clinical',
    icon: '⚖️',
    title: 'תסמונת מטבולית — חשבו על נתוני מטופל',
    blurb: 'חמישה קריטריונים, צריך 3 כדי לאבחן. הזיזו את הנתונים וראו מה מתקיים',
    topics: ['גורמי סיכון'],
    insight: 'קבעו גבר עם היקף מותניים 100 ו-HDL 45 — אפס קריטריונים. עכשיו לחצו על "מטופלת": ' +
             'אותם מספרים בדיוק, ופתאום שניים מתקיימים. שלושה מתוך חמשת הספים תלויי-מין, ' +
             'ולכן קריאת המין בווינייטה היא לא פרט רקע — היא חלק מהחישוב.',
    togglesTitle: 'מין המטופל',
    toggles: [{ k: 'female', label: '♀ מטופלת (ספים לנשים)' }],
    params: [
      { k: 'waist', label: 'היקף מותניים', unit: 'ס״מ', min: 60, max: 140, step: 1, val: 96, group: 'מדידות' },
      { k: 'sbp', label: 'לחץ דם סיסטולי', unit: 'mmHg', min: 90, max: 190, step: 1, val: 128, group: 'מדידות' },
      { k: 'dbp', label: 'לחץ דם דיאסטולי', unit: 'mmHg', min: 50, max: 120, step: 1, val: 82, group: 'מדידות' },
      { k: 'tg', label: 'טריגליצרידים', unit: 'mg/dL', min: 50, max: 350, step: 5, val: 140, group: 'מעבדה (בצום)' },
      { k: 'hdl', label: 'HDL', unit: 'mg/dL', min: 20, max: 90, step: 1, val: 45, group: 'מעבדה (בצום)' },
      { k: 'glu', label: 'גלוקוז בצום', unit: 'mg/dL', min: 70, max: 180, step: 1, val: 95, group: 'מעבדה (בצום)' },
    ],
    run: (p) => {
      const f = !!p.female;
      const c = [
        { name: 'היקף מותניים', val: p.waist + ' ס״מ', thr: f ? '> 88' : '> 102', met: p.waist > (f ? 88 : 102), sex: true },
        { name: 'טריגליצרידים', val: p.tg + ' mg/dL', thr: '> 150', met: p.tg > 150, sex: false },
        { name: 'HDL', val: p.hdl + ' mg/dL', thr: f ? '< 50' : '< 40', met: p.hdl < (f ? 50 : 40), sex: true },
        { name: 'לחץ דם', val: p.sbp + '/' + p.dbp, thr: '> 130/85', met: p.sbp > 130 || p.dbp > 85, sex: false },
        { name: 'גלוקוז בצום', val: p.glu + ' mg/dL', thr: '> 100', met: p.glu > 100, sex: false },
      ];
      const n = c.filter((x) => x.met).length;
      return { c, n, dx: n >= 3 };
    },
    readouts: (p, r) => [
      { v: r.n + ' / 5', label: 'קריטריונים שהתקיימו', cls: r.dx ? 'bad' : 'accent' },
      { v: r.dx ? 'כן' : 'לא', label: 'תסמונת מטבולית? (נדרשים 3)', cls: r.dx ? 'bad' : 'good' },
      { v: p.female ? '♀ אישה' : '♂ גבר', label: 'קובע 2 מהספים', cls: '' },
    ],
    panels: [
      {
        label: 'חמשת הקריטריונים — מה מתקיים ומה לא',
        h: 250,
        draw: (g, p, C, st, r) => {
          const { ctx, w, h } = g;
          ctx.clearRect(0, 0, w, h);
          const pad = 8;
          const rowH = (h - pad * 2) / r.c.length;
          ctx.textBaseline = 'middle';
          r.c.forEach((c, i) => {
            const y = pad + i * rowH + rowH / 2;
            /* "מתקיים" כאן = ממצא פתולוגי, ולכן אדום ולא ירוק. */
            const col = c.met ? C.bad : C.good;
            ctx.globalAlpha = 0.09;
            ctx.fillStyle = col;
            ctx.fillRect(pad, y - rowH / 2 + 3, w - pad * 2, rowH - 6);
            ctx.globalAlpha = 1;
            ctx.fillStyle = col;
            ctx.fillRect(w - pad - 4, y - rowH / 2 + 3, 4, rowH - 6);   // פס בקצה הימני (RTL)

            ctx.textAlign = 'right';
            ctx.fillStyle = C.text;
            ctx.font = '700 14px ' + FONT;
            ctx.fillText(c.name + (c.sex ? ' ⚥' : ''), w - pad - 14, y - 8);
            ctx.fillStyle = C.muted;
            ctx.font = '600 12px ' + FONT;
            ctx.fillText('הסף: ' + c.thr, w - pad - 14, y + 9);

            ctx.textAlign = 'left';
            ctx.fillStyle = col;
            ctx.font = '800 15px ' + FONT;
            ctx.fillText((c.met ? '✓  ' : '✗  ') + c.val, pad + 12, y);
          });
        },
      },
    ],
  },
];

/* הסתברות שחרור מסידן — היל בחזקת 4. השיתופיות היא העיקר:
   ארבעה יוני סידן נדרשים לקשירה, ולכן התלות כה תלולה. */
const quantalP = (ca) => Math.pow(ca, 4) / (Math.pow(ca, 4) + Math.pow(1.4, 4));

function quantalDraw(st, p, times) {
  const pr = quantalP(p.Ca);
  for (let i = 0; i < times; i++) {
    let k = 0;
    for (let s = 0; s < p.n; s++) if (Math.random() < pr) k++;
    st.trials.push(k);
  }
  if (st.trials.length > 4000) st.trials = st.trials.slice(-4000);
}

const simOf = (id) => SIMS.find((s) => s.id === id);
const simsOf = (courseId) => SIMS.filter((s) => s.course === courseId);

/* topic → סימולציה. זה כל מנגנון הקישור מהשאלות: אין שדה חדש בקבצי
   המבחן, ואין הזנת דאטה. שאלה שמתויגת בנושא מקבלת כפתור בחינם. */
const SIM_BY_TOPIC = (() => {
  const m = {};
  SIMS.forEach((s) => (s.topics || []).forEach((t) => (m[t] = s)));
  return m;
})();

/* מנקים אחרינו: router לא מפרק עמודים אף פעם, ובלי זה כל ביקור בעמוד
   סימולציה משאיר עוד ResizeObserver חי על אלמנט שכבר לא במסמך. */
let simTeardown = null;
function killSim() {
  if (simTeardown) { simTeardown(); simTeardown = null; }
}

/* ה-hook שדרכו החלפת ערכת נושא מציירת מחדש את הקנבסים. */
let simRepaint = null;

function renderSim(id) {
  setNav('home');
  killSim();
  const s = simOf(id);
  if (!s) {
    view.innerHTML = '';
    view.append(emptyState('⚠️', 'סימולציה לא נמצאה', 'הקישור כנראה שגוי.'));
    toTop();
    return;
  }
  const c = courseOf(s.course);
  view.innerHTML = '';
  view.append(crumb(c ? c.name : 'חזרה', '#/course/' + s.course));

  const head = el('div', 'page-head');
  head.append(el('h1', null, `${s.icon} ${s.title}`));
  head.append(el('p', null, s.blurb));
  view.append(head);

  const p = {};
  s.params.forEach((q) => (p[q.k] = q.val));
  (s.toggles || []).forEach((t) => (p[t.k] = false));
  const st = s.init ? s.init() : {};

  const wrap = el('div', 'sim');

  /* כל פקד רושם כאן איך לחזור לברירת המחדל שלו, ו-resetAll מריץ את כולם.
     ריסט אחד לסימולציה ולא אחד לכל סליידר: אחרי שמשחקים עם שישה
     סליידרים, לחזור לנקודת התחלה שפויה צריך להיות לחיצה אחת. */
  const resets = [];

  /* --- פקדים --- */
  const controls = el('div', 'sim-controls');
  const groups = [...new Set(s.params.map((q) => q.group || ''))];
  groups.forEach((gname) => {
    const box = el('div', 'sim-group');
    if (gname) box.append(el('div', 'sim-group-t', gname));
    s.params.filter((q) => (q.group || '') === gname).forEach((q) => {
      const f = el('div', 'sim-slider');
      const lab = el('label');
      lab.append(el('span', 'sim-sl-name', q.label));
      const val = el('span', 'sim-sl-val', num(q.val) + (q.unit ? ' ' + q.unit : ''));
      lab.append(val);
      f.append(lab);

      const inp = el('input');
      inp.type = 'range';
      inp.min = q.min; inp.max = q.max; inp.step = q.step; inp.value = q.val;

      const minus = el('button', 'sim-step', '−');
      const plus = el('button', 'sim-step', '+');
      minus.type = 'button'; plus.type = 'button';
      minus.title = `פחות ${q.step}`; plus.title = `עוד ${q.step}`;
      minus.setAttribute('aria-label', `הקטן ${q.label}`);
      plus.setAttribute('aria-label', `הגדל ${q.label}`);

      /* redraw=false בטעינה בלבד: הפקדים נבנים לפני הקנבסים ולפני dash,
         ו-refresh היה מתפוצץ עליהם. */
      const upd = (redraw = true) => {
        p[q.k] = parseFloat(inp.value);
        val.textContent = num(p[q.k]) + (q.unit ? ' ' + q.unit : '');
        minus.disabled = p[q.k] <= q.min + 1e-9;
        plus.disabled = p[q.k] >= q.max - 1e-9;
        if (redraw) refresh();
      };

      /* צעד בכפתור. העיגול למספר הספרות של ה-step הוא לא קוסמטיקה:
         0.03 + 0.005 = 0.034999999999999996 בנקודה צפה, וזה גם היה
         מוצג ככה וגם מרחיק את הערך מרשת הצעדים בכל לחיצה. */
      const dec = (String(q.step).split('.')[1] || '').length;
      const stepBy = (dir) => {
        const next = parseFloat(inp.value) + dir * q.step;
        inp.value = Math.min(q.max, Math.max(q.min, +next.toFixed(dec)));
        upd();
      };
      minus.onclick = () => stepBy(-1);
      plus.onclick = () => stepBy(1);
      inp.oninput = () => upd();

      /* הסליידר עצמו LTR (מינימום משמאל), אז מינוס שמאלה ופלוס ימינה —
         גם בעמוד RTL. כפתור בכיוון ההפוך לסליידר הוא מלכודת. */
      const row = el('div', 'sim-sl-row');
      row.append(minus, inp, plus);
      f.append(row);
      box.append(f);
      upd(false);   // רק כדי לכוון את מצב הכפתורים בקצוות
      resets.push(() => { inp.value = q.val; upd(false); });
    });
    controls.append(box);
  });

  if (s.toggles) {
    const box = el('div', 'sim-group');
    /* היה קשיח "רעלנים" — נכון ל-HH ולא לשום סימולציה אחרת. */
    box.append(el('div', 'sim-group-t', s.togglesTitle || 'רעלנים'));
    const chips = el('div', 'chips');
    s.toggles.forEach((t) => {
      const b = el('button', 'chip', t.label);
      b.onclick = () => {
        p[t.k] = !p[t.k];
        b.classList.toggle('on', p[t.k]);
        refresh();
      };
      chips.append(b);
      resets.push(() => { p[t.k] = false; b.classList.remove('on'); });
    });
    box.append(chips);
    controls.append(box);
  }
  wrap.append(controls);

  /* --- ריסט --- */
  const resetBtn = el('button', 'btn ghost sim-reset');
  resetBtn.type = 'button';
  resetBtn.append(el('span', 'sim-reset-ico', '↺'));
  resetBtn.append(el('span', null, 'אפס לערכי ההתחלה'));
  resetBtn.onclick = () => {
    resets.forEach((f) => f());
    /* st עצמו חייב להישאר אותו אובייקט — הלוחות סוגרים עליו. */
    if (s.init) {
      Object.keys(st).forEach((k) => delete st[k]);
      Object.assign(st, s.init());
    }
    refresh();
  };
  const resetRow = el('div', 'sim-reset-row');
  resetRow.append(resetBtn);
  wrap.append(resetRow);

  /* משהו שונה מברירת המחדל? אם לא — אין מה לאפס, והכפתור כבוי.
     זה גם אומר לך במבט אחד אם אתה על ההגדרות המקוריות. */
  const isDirty = () =>
    s.params.some((q) => Math.abs(p[q.k] - q.val) > 1e-9) ||
    (s.toggles || []).some((t) => p[t.k]) ||
    (st.trials || []).length > 0;

  /* --- קריאות --- */
  const dash = el('div', 'dash sim-dash');
  wrap.append(dash);

  /* --- כפתורי פעולה --- */
  if (s.buttons) {
    const row = el('div', 'btn-row sim-btns');
    s.buttons(st, p, () => refresh()).forEach((b) => {
      const n = el('button', 'btn ' + (b.cls || ''), b.label);
      n.onclick = b.run;
      row.append(n);
    });
    wrap.append(row);
  }

  /* --- לוחות --- */
  const canvases = [];
  s.panels.forEach((pan) => {
    const box = el('div', 'sim-panel');
    box.append(el('div', 'sim-panel-t', pan.label));
    const cv = el('canvas', 'sim-cv');
    cv.style.height = (pan.h || 260) + 'px';
    box.append(cv);
    wrap.append(box);
    canvases.push(cv);
  });

  /* --- תובנה --- */
  if (s.insight) {
    const ins = el('div', 'sim-insight');
    ins.append(el('div', 'sim-insight-t', '💡 נסו את זה'));
    ins.append(el('div', null, s.insight));
    wrap.append(ins);
  }

  /* --- הקישור חזרה לשאלות --- */
  if (s.topics && s.topics.length && c) {
    const row = el('div', 'btn-row');
    s.topics.forEach((t) => {
      const a = el('a', 'btn primary', `תרגלו את "${t}"`);
      a.href = `#/practice/${s.course}/${encodeURIComponent(t)}`;
      row.append(a);
    });
    /* "שחקו עם המשוואה" ו"תרגלו לחשב אותה" הן שתי תשובות לאותו נושא — כאן,
       זו לצד זו. הקישור אוטומטי לפי topic, בדיוק כמו הקישור לתרגול. */
    const drill = s.topics.map((t) => DRILL_BY_TOPIC[t]).find(Boolean);
    if (drill) {
      const da = el('a', 'btn', `🧮 תרגל חישוב — ${drill.title}`);
      da.href = '#/drill/' + drill.id;
      row.append(da);
    }
    wrap.append(row);
  }

  view.append(wrap);

  function refresh() {
    const C = themeColors();
    const r = s.run ? s.run(p) : null;

    resetBtn.disabled = !isDirty();

    dash.innerHTML = '';
    s.readouts(p, r, st).forEach((o) => dash.append(stat(o.v, o.label, o.cls)));

    s.panels.forEach((pan, i) => {
      const g = fitCanvas(canvases[i]);
      pan.draw(g, p, C, st, r);
    });
  }

  simRepaint = refresh;
  const ro = new ResizeObserver(() => refresh());
  ro.observe(wrap);
  simTeardown = () => { ro.disconnect(); simRepaint = null; };

  refresh();
  toTop();
  updateFooter();
}

/* רצועה קומפקטית לעמודי התרגול. הבאנר של דף המקצוע תופס חצי מסך ולא
   מתאים שם — אבל דווקא בתרגול, לפני שמתחילים לענות, זה הרגע שבו כדאי
   ללכת לראות את הדבר עצמו. */
function simStrip(courseId, title) {
  const list = simsOf(courseId);
  if (!list.length) return null;
  const box = el('div', 'sim-strip');
  box.append(el('div', 'sim-strip-t', title));
  const row = el('div', 'sim-strip-row');
  list.forEach((s) => {
    const a = el('a', 'sim-chip');
    a.href = '#/sim/' + s.id;
    a.append(el('span', 'sim-chip-ico', s.icon));
    a.append(el('span', null, s.title));
    row.append(a);
  });
  box.append(row);
  return box;
}

/* באנר הסימולציות בדף המקצוע */
function simsHero(courseId) {
  const list = simsOf(courseId);
  if (!list.length) return null;
  const box = el('section', 'sim-hero');
  const head = el('div', 'sim-hero-head');
  head.append(el('div', 'sim-hero-eyebrow', '🎛️ סימולציות'));
  head.append(el('h2', null, 'שחקו עם המשוואות'));
  head.append(el('p', 'sim-hero-sub',
    'האלקטרו שואל בעיקר "מה יקרה ל-X אם נשנה את Y". כאן גוררים את Y ורואים.'));
  box.append(head);
  const grid = el('div', 'sim-hero-grid');
  list.forEach((s) => {
    const a = el('a', 'sim-card');
    a.href = '#/sim/' + s.id;
    a.append(el('span', 'sim-card-ico', s.icon));
    const t = el('div', 'sim-card-txt');
    t.append(el('b', null, s.title));
    t.append(el('span', null, s.blurb));
    a.append(t);
    grid.append(a);
  });
  box.append(grid);
  return box;
}

/* באנר תרגילי החישוב בדף המקצוע — מופיע רק אם יש למקצוע תרגילים. */
function drillsHero(courseId) {
  const list = drillsOf(courseId);
  if (!list.length) return null;
  const box = el('section', 'sim-hero drill-hero');
  const head = el('div', 'sim-hero-head');
  head.append(el('div', 'sim-hero-eyebrow', '🧮 תרגילי חישוב'));
  head.append(el('h2', null, 'תרגלו את החישובים — עם פתרון'));
  head.append(el('p', 'sim-hero-sub',
    'נרנסט, קבועי הזמן והמרחק, אוסמולריות, תכולה קוונטית — מספרים חדשים בכל פעם, ופתרון שלב-אחר-שלב. ' +
    'זה החלק של המבחן שמפסידים בו נקודות על דיוק.'));
  box.append(head);
  const grid = el('div', 'sim-hero-grid');
  list.forEach((d) => {
    const a = el('a', 'sim-card');
    a.href = '#/drill/' + d.id;
    a.append(el('span', 'sim-card-ico', d.icon));
    const t = el('div', 'sim-card-txt');
    t.append(el('b', null, d.title));
    t.append(el('span', null, d.blurb));
    a.append(t);
    grid.append(a);
  });
  box.append(grid);
  const row = el('div', 'btn-row');
  row.style.marginTop = '12px';
  const fa = el('a', 'btn', '📖 כרטיס הנוסחאות');
  fa.href = '#/formulas/' + courseId;
  row.append(fa);
  box.append(row);
  return box;
}

/* ═══════════════════════════════════════════════════════════════════
   תרגילי חישוב
   ═══════════════════════════════════════════════════════════════════
   הבעיה שזה פותר: ~60 שאלות במבחן הן חישוב (נרנסט, τ, λ, אוסמולריות,
   תכולה קוונטית), והמקום שמפסידים בו נקודות קלות הוא דיוק — לא הבנה.
   שאלות רב-ברירה נותנות אימון אחד; מחולל נותן אינסוף, עם מספרים מתחלפים
   בכל פעם ותשובה ידועה־בדיוק (מחושבת מאותם מנועים של הסימולציות).

   העיקרון זהה ל-SIMS: כאן המשוואה עצמה היא התוכן, ולכן זה קוד ולא JSON.
   כל drill נתלה על נושא קנוני (`topic`), ומשם מגיע החיבור הדו-כיווני בחינם —
   בדיוק כמו SIM_BY_TOPIC ו-GUIDE_BY_TOPIC. `solve` קורא למנוע קיים ומאומת
   (`nernst`, נוסחאות ה-cable, `quantalP`) — אפס מתמטיקה חדשה שאפשר לטעות בה.

   ⚠️ נכונות: נרנסט גוזר RT/zF מ-T בפועל (לא קבוע 58/61); GHK כאן הוא מודל
   המוליכות המקבילית Σ(g·E)/Σg — הצורה שהמבחן מצפה לה כשנתונה מוליכות g,
   בשונה מגולדמן שדורש חדירות P; λ משתמש בביטוי המדויק של סימולציית ה-cable. */

const drnd = (min, max, step = 1) => {
  const n = Math.round((min + Math.random() * (max - min)) / step) * step;
  return +n.toFixed(6);
};
const dpick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/* יונים לתרגיל נרנסט — טווחים פיזיולוגיים שנותנים תשובות שפויות.
   סידן הושמט בכוונה: ריכוז תוך-תאי ~100nM נותן מספרים מכוערים לתרגיל. */
const NERNST_IONS = [
  { name: 'אשלגן (K⁺)', z: 1, co: [3, 7, 0.5], ci: [120, 150, 5] },
  { name: 'נתרן (Na⁺)', z: 1, co: [140, 160, 5], ci: [8, 20, 1] },
  { name: 'כלור (Cl⁻)', z: -1, co: [100, 130, 5], ci: [5, 15, 1] },
];

const OSMO_COMPOUNDS = [
  { name: 'NaCl', n: 2 }, { name: 'KCl', n: 2 }, { name: 'CaCl₂', n: 3 },
  { name: 'AlCl₃', n: 4 }, { name: 'Na₂SO₄', n: 3 },
  { name: 'גלוקוז', n: 1 }, { name: 'אוריאה', n: 1 }, { name: 'סוכרוז', n: 1 },
];

const DRILLS = [
  {
    id: 'nernst', course: 'electro', topic: 'פוטנציאל מנוחה', icon: '⚖️',
    title: 'פוטנציאל נרנסט', unit: 'mV', floor: 0.6,
    blurb: 'פוטנציאל שיווי המשקל של יון בודד — תלוי בטמפרטורה ובמטען',
    gen() {
      const ion = dpick(NERNST_IONS);
      const T = dpick([20, 25, 37]);
      return { ion: ion.name, z: ion.z, Co: drnd(...ion.co), Ci: drnd(...ion.ci), T };
    },
    solve: (v) => nernst(v.T, v.z, v.Co, v.Ci),
    prompt: (v) => `יון <b>${v.ion}</b> (מטען z=${v.z}). ריכוז חוץ-תאי [out]=<b>${v.Co} mM</b>, תוך-תאי [in]=<b>${v.Ci} mM</b>, טמפרטורה <b>${v.T}°C</b>.<br>מהו פוטנציאל נרנסט של היון?`,
    steps: (v, ans) => [
      `נוסחת נרנסט: E = (RT/zF)·ln([out]/[in])`,
      `RT/F בטמפרטורה ${v.T}°C = <b>${num(RToverF(v.T))} mV</b> · חלוקה ב-z=${v.z} → <b>${num(RToverF(v.T) / v.z)} mV</b>`,
      `ln([out]/[in]) = ln(${v.Co}/${v.Ci}) = <b>${num(Math.log(v.Co / v.Ci), 3)}</b>`,
      `E = ${num(RToverF(v.T) / v.z)} × ${num(Math.log(v.Co / v.Ci), 3)} = <b>${num(ans)} mV</b>`,
    ],
  },
  {
    id: 'ghk', course: 'electro', topic: 'פוטנציאל מנוחה', icon: '🔀', formula: 'vm',
    title: 'מתח מנוחה — מוליכות מקבילית', unit: 'mV', floor: 0.6,
    blurb: 'כשנתונה מוליכות g (ולא חדירות P) — הממברנה היא ממוצע משוקלל של הבטריות',
    gen() {
      const gK = drnd(4, 12, 1), gNa = drnd(1, 5, 1), gCl = drnd(2, 8, 1);
      const EK = drnd(-95, -80, 5), ENa = drnd(50, 65, 5), ECl = drnd(-75, -60, 5);
      return { gK, gNa, gCl, EK, ENa, ECl };
    },
    solve: (v) => (v.gK * v.EK + v.gNa * v.ENa + v.gCl * v.ECl) / (v.gK + v.gNa + v.gCl),
    prompt: (v) => `במנוחה נתונות המוליכויות והבטריות:<br>אשלגן g=<b>${v.gK}</b>, E=<b>${v.EK} mV</b> · נתרן g=<b>${v.gNa}</b>, E=<b>${v.ENa} mV</b> · כלור g=<b>${v.gCl}</b>, E=<b>${v.ECl} mV</b>.<br>מהו מתח הממברנה (מודל המוליכות המקבילית)?`,
    steps: (v, ans) => [
      `נתונה <b>מוליכות (g)</b> → משתמשים בממוצע המשוקלל Vm = Σ(g·E) / Σg. (חדירות P הייתה מובילה לגולדמן.)`,
      `מונה = Σ(g·E) = ${v.gK}·(${v.EK}) + ${v.gNa}·(${v.ENa}) + ${v.gCl}·(${v.ECl}) = <b>${num(v.gK * v.EK + v.gNa * v.ENa + v.gCl * v.ECl)}</b>`,
      `מכנה = Σg = ${v.gK}+${v.gNa}+${v.gCl} = <b>${v.gK + v.gNa + v.gCl}</b>`,
      `Vm = מונה/מכנה = <b>${num(ans)} mV</b>`,
    ],
  },
  {
    id: 'tau', course: 'electro', topic: 'תכונות פאסיביות של הממברנה', icon: '⏱️',
    title: 'קבוע הזמן τ', unit: 'ms', floor: 0.1,
    blurb: 'כמה מהר הממברנה נטענת — τ = Rin · Cmem',
    gen: () => ({ Rin: drnd(50, 300, 10), Cm: drnd(100, 500, 20) }),
    solve: (v) => (v.Rin * v.Cm) / 1000,      // MΩ·pF → ms (זהה לסימולציית ה-cable)
    prompt: (v) => `תא איזופוטנציאלי: התנגדות כניסה Rin=<b>${v.Rin} MΩ</b>, קיבול הממברנה Cmem=<b>${v.Cm} pF</b>.<br>מהו קבוע הזמן τ?`,
    steps: (v, ans) => [
      `τ = Rin · Cmem`,
      `שימו לב ליחידות: MΩ · pF = 10⁶ · 10⁻¹² שנ׳ = מיקרו-שנייה, לכן מחלקים ב-1000 ל-ms.`,
      `τ = (${v.Rin} × ${v.Cm}) / 1000 = <b>${num(ans)} ms</b>`,
    ],
  },
  {
    id: 'lambda', course: 'electro', topic: 'תכונות פאסיביות של הממברנה', icon: '📏',
    title: 'קבוע המרחק λ', unit: 'mm', floor: 0.02,
    blurb: 'כמה רחוק אות דועך — λ = √(d·Rm / 4·Ri), ותלוי בשורש הקוטר',
    gen: () => ({ d: drnd(1, 15, 0.5), Rm: drnd(5, 50, 1), Ri: drnd(50, 300, 10) }),
    solve: (v) => Math.sqrt((v.d * v.Rm) / (40 * v.Ri)) * 10,   // ביטוי מדויק של סימולציית ה-cable
    prompt: (v) => `אקסון: קוטר d=<b>${v.d} µm</b>, התנגדות ממברנה סגולית Rm=<b>${v.Rm} kΩ·cm²</b>, התנגדות ציטופלזמית Ri=<b>${v.Ri} Ω·cm</b>.<br>מהו קבוע המרחק λ?`,
    steps: (v, ans) => [
      `λ = √(d·Rm / 4·Ri) — שימו לב שזו נוסחת הקוטר d (עם רדיוס a זה √(a·Rm / 2·Ri), אותו דבר).`,
      `λ ∝ √d — פי 4 בקוטר נותן רק פי 2 ב-λ.`,
      `λ = √(${v.d}·${v.Rm} / (4·${v.Ri})) = <b>${num(ans)} mm</b> (אחרי המרת יחידות ל-mm)`,
    ],
  },
  {
    id: 'rin', course: 'electro', topic: 'תכונות פאסיביות של הממברנה', icon: '🔌',
    title: 'התנגדות כניסה מרישום', unit: 'MΩ', floor: 1,
    blurb: 'קוראים Rin ישירות מגרף מתח־זרם — חוק אוהם על ההיסט',
    gen() {
      const V0 = dpick([-60, -65, -70]);
      const Rin = drnd(50, 300, 10);           // MΩ
      const I = drnd(0.1, 0.4, 0.05);          // nA, מהפעל (מהפולריזציה)
      const dV = Rin * I;                       // mV
      return { V0, I, V1: +(V0 - dV).toFixed(1), dV: +dV.toFixed(1) };
    },
    solve: (v) => v.dV / v.I,                   // mV / nA = MΩ
    prompt: (v) => `מזריקים לתא זרם קבוע של <b>${v.I} nA</b> (מהפעל). מתח המנוחה היה <b>${v.V0} mV</b> וירד בהתייצבות ל-<b>${v.V1} mV</b>.<br>מהי התנגדות הכניסה Rin?`,
    steps: (v, ans) => [
      `Rin = ΔV / ΔI (חוק אוהם על ההיסט במצב היציב).`,
      `ΔV = |${v.V1} − (${v.V0})| = <b>${num(v.dV)} mV</b>`,
      `Rin = ${num(v.dV)} mV / ${v.I} nA = <b>${num(ans)} MΩ</b> (mV/nA = MΩ)`,
    ],
  },
  {
    id: 'osmo', course: 'electro', topic: 'תנועת חלקיקים ודיפוזיה', icon: '🧂',
    title: 'אוסמולריות — פירוק חלקיקים', unit: 'mOsm', floor: 0.5,
    blurb: 'המלכודת הקבועה: כמה חלקיקים החומר מתפרק אליהם',
    gen() {
      const cmp = dpick(OSMO_COMPOUNDS);
      return { name: cmp.name, factor: cmp.n, C: drnd(50, 200, 10) };
    },
    solve: (v) => v.C * v.factor,
    prompt: (v) => `מהי האוסמולריות של תמיסה של <b>${v.C} mM ${v.name}</b>? (הניחו פירוק מלא)`,
    steps: (v, ans) => [
      `אוסמולריות = ריכוז מולרי × מספר החלקיקים שהחומר מתפרק אליהם.`,
      `<b>${v.name}</b> מתפרק ל-<b>${v.factor}</b> חלקיקים${v.factor === 1 ? ' (אינו מתפרק — חומר לא-אלקטרוליטי)' : ''}.`,
      `אוסמולריות = ${v.C} × ${v.factor} = <b>${num(ans)} mOsm</b>`,
    ],
  },
  {
    id: 'quantal', course: 'electro', topic: 'התאוריה הקוונטאלית', icon: '🔬',
    title: 'תכולה קוונטית m = n·p·q', unit: 'mV', floor: 0.05,
    blurb: 'משרעת התגובה הממוצעת = מספר הווזיקולות × הסתברות השחרור × גודל הקוונטום',
    gen: () => ({ n: drnd(5, 40, 1), p: drnd(0.1, 0.6, 0.05), q: drnd(0.2, 1, 0.1) }),
    solve: (v) => v.n * v.p * v.q,
    prompt: (v) => `בסינפסה: מספר וזיקולות זמינות לשחרור n=<b>${v.n}</b>, הסתברות שחרור p=<b>${v.p}</b>, וגודל קוונטום בודד q=<b>${v.q} mV</b>.<br>מהי משרעת התגובה הפוסט-סינפטית הממוצעת?`,
    steps: (v, ans) => [
      `התכולה הקוונטית m = n · p = ${v.n} × ${v.p} = <b>${num(v.n * v.p)}</b> קוונטות משתחררות בממוצע.`,
      `משרעת ממוצעת = m · q = ${num(v.n * v.p)} × ${v.q} mV = <b>${num(ans)} mV</b>`,
    ],
  },
];

const drillOf = (id) => DRILLS.find((d) => d.id === id);
const drillsOf = (courseId) => DRILLS.filter((d) => d.course === courseId);

/* נושא → תרגיל, בדיוק כמו SIM_BY_TOPIC. נותן חיבור דו-כיווני בחינם:
   מפילוח-לפי-נושא ומעמוד הסימולציה ישר לתרגיל החישוב של אותו נושא. */
const DRILL_BY_TOPIC = (() => {
  const m = {};
  DRILLS.forEach((d) => { if (!m[d.topic]) m[d.topic] = d; });
  return m;
})();

/* עמוד אינדקס — כל תרגילי החישוב של המקצוע ככרטיסיות. */
function renderDrills(courseId) {
  setNav('home');
  const c = courseOf(courseId);
  const list = drillsOf(courseId);
  view.innerHTML = '';
  view.append(crumb(c ? c.name : 'חזרה', '#/course/' + courseId));
  const head = el('div', 'page-head');
  head.append(el('h1', null, '🧮 תרגילי חישוב'));
  head.append(el('p', null,
    'מספרים אקראיים בכל פעם, תשובה מדויקת, ופתרון שלב-אחר-שלב. ' +
    'זה החלק של המבחן שמפסידים בו נקודות על דיוק — לא על הבנה.'));
  view.append(head);

  if (!list.length) {
    view.append(emptyState('🔢', 'אין עדיין תרגילי חישוב למקצוע הזה', 'הם נבנים לכל מקצוע בנפרד.'));
    toTop();
    return;
  }

  const grid = el('div', 'sim-hero-grid');
  list.forEach((d) => {
    const a = el('a', 'sim-card');
    a.href = '#/drill/' + d.id;
    a.append(el('span', 'sim-card-ico', d.icon));
    const t = el('div', 'sim-card-txt');
    t.append(el('b', null, d.title));
    t.append(el('span', null, d.blurb));
    a.append(t);
    grid.append(a);
  });
  view.append(grid);

  const row = el('div', 'btn-row');
  row.style.marginTop = '18px';
  const fa = el('a', 'btn', '📖 כרטיס הנוסחאות');
  fa.href = '#/formulas/' + courseId;
  row.append(fa);
  view.append(row);

  toTop();
  updateFooter();
}

/* תרגיל בודד — הגרל, ענה, קבל פתרון, הגרל שוב. */
function renderDrill(id) {
  setNav('home');
  const d = drillOf(id);
  if (!d) {
    view.innerHTML = '';
    view.append(emptyState('⚠️', 'תרגיל לא נמצא', 'הקישור כנראה שגוי.'));
    toTop();
    return;
  }
  const c = courseOf(d.course);
  view.innerHTML = '';
  view.append(crumb(c ? c.name : 'חזרה', '#/course/' + d.course));

  const head = el('div', 'page-head');
  head.append(el('h1', null, `${d.icon} ${d.title}`));
  head.append(el('p', null, d.blurb));
  view.append(head);

  const tally = { ok: 0, total: 0 };
  const score = el('div', 'drill-score');
  view.append(score);

  const card = el('div', 'drill-card');
  const promptBox = el('div', 'drill-prompt');
  card.append(promptBox);

  const answerRow = el('div', 'drill-answer');
  const input = el('input', 'drill-input');
  input.type = 'text';
  input.inputMode = 'decimal';
  input.autocomplete = 'off';
  input.setAttribute('enterkeyhint', 'done');
  input.dir = 'ltr';
  const unit = el('span', 'drill-unit', d.unit);
  const checkBtn = el('button', 'btn primary', 'בדוק');
  checkBtn.type = 'button';
  answerRow.append(input, unit, checkBtn);
  card.append(answerRow);

  const fb = el('div', 'drill-fb');
  card.append(fb);
  view.append(card);

  const acts = el('div', 'btn-row');
  const again = el('button', 'btn', '🎲 תרגיל נוסף');
  again.type = 'button';
  acts.append(again);
  const fa = el('a', 'btn ghost', '📖 הנוסחה');
  fa.href = `#/formulas/${d.course}/${d.formula || d.id}`;
  acts.append(fa);
  const sim = SIM_BY_TOPIC[d.topic];
  if (sim) {
    const sa = el('a', 'btn ghost', `${sim.icon} סימולציה`);
    sa.href = '#/sim/' + sim.id;
    acts.append(sa);
  }
  const pa = el('a', 'btn ghost', '🎯 שאלות אמת בנושא');
  pa.href = `#/practice/${d.course}/${encodeURIComponent(d.topic)}`;
  acts.append(pa);
  view.append(acts);

  let v, answered;
  function fresh() {
    v = d.gen();
    answered = false;
    promptBox.innerHTML = d.prompt(v);
    input.value = '';
    input.disabled = false;
    checkBtn.disabled = false;
    fb.className = 'drill-fb';
    fb.innerHTML = '';
    input.focus();
  }

  function check() {
    if (answered) return;
    const raw = input.value.trim().replace(',', '.');
    if (raw === '' || isNaN(parseFloat(raw))) {
      fb.className = 'drill-fb show warn';
      fb.innerHTML = 'הזינו מספר כדי לבדוק.';
      return;
    }
    answered = true;
    input.disabled = true;
    checkBtn.disabled = true;
    const userAns = parseFloat(raw);
    const ans = d.solve(v);
    const tol = Math.max(d.floor || 0, 0.02 * Math.abs(ans));   // 2% + רצפה מוחלטת
    const ok = Math.abs(userAns - ans) <= tol;
    tally.total++;
    if (ok) tally.ok++;
    updateScore();

    fb.className = 'drill-fb show ' + (ok ? 'ok' : 'no');
    const verdict = el('div', 'drill-verdict');
    verdict.innerHTML = ok
      ? `✓ נכון! התשובה: <b>${num(ans)} ${d.unit}</b>`
      : `✗ לא מדויק. ענית ${num(userAns)}, התשובה הנכונה: <b>${num(ans)} ${d.unit}</b>`;
    fb.append(verdict);
    const steps = el('ol', 'drill-steps');
    d.steps(v, ans).forEach((s) => {
      const li = el('li');
      li.innerHTML = s;
      steps.append(li);
    });
    fb.append(steps);
  }

  function updateScore() {
    score.textContent = tally.total ? `נכונות: ${tally.ok}/${tally.total}` : '';
  }

  checkBtn.onclick = check;
  input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); answered ? fresh() : check(); } };
  again.onclick = fresh;

  fresh();
  updateScore();
  toTop();
  updateFooter();
}

/* ═══════════════════════════════════════════════════════════════════
   כרטיס הנוסחאות — עיון + מחשבון
   ═══════════════════════════════════════════════════════════════════
   אותן נוסחאות בדיוק של תרגילי החישוב, עם מחשבון־הצבה חי. `compute` קורא
   לאותם ביטויים כמו `solve` בתרגיל — כך הכרטיס והתרגיל לא יכולים לסתור זה
   את זה. נגיש מכל תרגיל ("📖 הנוסחה") ומעמוד המקצוע. */
const FORMULAS = [
  {
    id: 'nernst', course: 'electro', title: 'פוטנציאל נרנסט', unit: 'mV',
    expr: 'E = (RT/zF) · ln([out]/[in])',
    note: 'פוטנציאל שיווי המשקל של יון בודד. RT/F ב-37°C ≈ 26.7 mV; ב-z=1 זה 61.5·log₁₀ ב-37°, 58·log₁₀ ב-20°.',
    vars: [
      { k: 'z', label: 'מטען היון z', default: 1, step: 1 },
      { k: 'T', label: 'טמפרטורה', unit: '°C', default: 37, step: 1 },
      { k: 'Co', label: '[out] חוץ-תאי', unit: 'mM', default: 145, step: 1 },
      { k: 'Ci', label: '[in] תוך-תאי', unit: 'mM', default: 12, step: 1 },
    ],
    compute: (v) => nernst(v.T, v.z, v.Co, v.Ci),
  },
  {
    id: 'vm', course: 'electro', title: 'מתח מנוחה — מוליכות מקבילית', unit: 'mV',
    expr: 'Vm = Σ(g·E) / Σg',
    note: 'כשנתונה מוליכות g — הממברנה היא ממוצע הבטריות משוקלל במוליכויות. (חדירות P → גולדמן, נוסחה אחרת.)',
    vars: [
      { k: 'gK', label: 'g אשלגן', default: 8, step: 1 }, { k: 'EK', label: 'E אשלגן', unit: 'mV', default: -90, step: 1 },
      { k: 'gNa', label: 'g נתרן', default: 2, step: 1 }, { k: 'ENa', label: 'E נתרן', unit: 'mV', default: 60, step: 1 },
      { k: 'gCl', label: 'g כלור', default: 4, step: 1 }, { k: 'ECl', label: 'E כלור', unit: 'mV', default: -70, step: 1 },
    ],
    compute: (v) => (v.gK * v.EK + v.gNa * v.ENa + v.gCl * v.ECl) / (v.gK + v.gNa + v.gCl),
  },
  {
    id: 'tau', course: 'electro', title: 'קבוע הזמן τ', unit: 'ms',
    expr: 'τ = Rin · Cmem',
    note: 'כמה מהר הממברנה נטענת. MΩ·pF → מחלקים ב-1000 ל-ms.',
    vars: [
      { k: 'Rin', label: 'התנגדות כניסה Rin', unit: 'MΩ', default: 150, step: 5 },
      { k: 'Cm', label: 'קיבול Cmem', unit: 'pF', default: 300, step: 10 },
    ],
    compute: (v) => (v.Rin * v.Cm) / 1000,
  },
  {
    id: 'lambda', course: 'electro', title: 'קבוע המרחק λ', unit: 'mm',
    expr: 'λ = √(d·Rm / 4·Ri)',
    note: 'כמה רחוק אות דועך. λ ∝ √d — פי 4 בקוטר = פי 2 ב-λ. (עם רדיוס a: √(a·Rm/2·Ri).)',
    vars: [
      { k: 'd', label: 'קוטר d', unit: 'µm', default: 4, step: 0.5 },
      { k: 'Rm', label: 'התנגדות ממברנה Rm', unit: 'kΩ·cm²', default: 20, step: 1 },
      { k: 'Ri', label: 'התנגדות ציטופלזמה Ri', unit: 'Ω·cm', default: 100, step: 10 },
    ],
    compute: (v) => Math.sqrt((v.d * v.Rm) / (40 * v.Ri)) * 10,
  },
  {
    id: 'rin', course: 'electro', title: 'התנגדות כניסה Rin', unit: 'MΩ',
    expr: 'Rin = ΔV / ΔI',
    note: 'חוק אוהם על ההיסט במצב היציב. mV/nA = MΩ.',
    vars: [
      { k: 'dV', label: 'היסט המתח ΔV', unit: 'mV', default: 30, step: 1 },
      { k: 'dI', label: 'הזרם המוזרק ΔI', unit: 'nA', default: 0.2, step: 0.05 },
    ],
    compute: (v) => v.dV / v.dI,
  },
  {
    id: 'osmo', course: 'electro', title: 'אוסמולריות', unit: 'mOsm',
    expr: 'אוסמולריות = ריכוז × מספר חלקיקים',
    note: 'המלכודת: כמה חלקיקים החומר מתפרק אליהם. NaCl→2 · CaCl₂→3 · AlCl₃→4 · גלוקוז→1.',
    vars: [
      { k: 'C', label: 'ריכוז', unit: 'mM', default: 100, step: 10 },
      { k: 'factor', label: 'חלקיקים לפירוק', options: OSMO_COMPOUNDS.map((c) => ({ label: `${c.name} (${c.n})`, val: c.n })) },
    ],
    compute: (v) => v.C * v.factor,
  },
  {
    id: 'quantal', course: 'electro', title: 'תכולה קוונטית', unit: 'mV',
    expr: 'תגובה ממוצעת = m·q = (n·p)·q',
    note: 'משרעת התגובה = מספר הווזיקולות × הסתברות שחרור × גודל קוונטום.',
    vars: [
      { k: 'n', label: 'וזיקולות זמינות n', default: 20, step: 1 },
      { k: 'p', label: 'הסתברות שחרור p', default: 0.3, step: 0.05 },
      { k: 'q', label: 'גודל קוונטום q', unit: 'mV', default: 0.4, step: 0.1 },
    ],
    compute: (v) => v.n * v.p * v.q,
  },
];

const formulasOf = (courseId) => FORMULAS.filter((f) => f.course === courseId);

function renderFormulas(courseId, focusId = null) {
  setNav('home');
  const c = courseOf(courseId);
  const list = formulasOf(courseId);
  view.innerHTML = '';
  view.append(crumb(c ? c.name : 'חזרה', '#/course/' + courseId));
  const head = el('div', 'page-head');
  head.append(el('h1', null, '📖 כרטיס הנוסחאות'));
  head.append(el('p', null, 'כל נוסחה עם מחשבון־הצבה חי — הציבו ערכים וראו את התוצאה משתנה. אלה בדיוק הנוסחאות של תרגילי החישוב.'));
  view.append(head);

  if (!list.length) {
    view.append(emptyState('📖', 'אין עדיין כרטיס נוסחאות למקצוע הזה', 'הוא נבנה לכל מקצוע בנפרד.'));
    toTop();
    return;
  }

  list.forEach((f) => {
    const box = el('section', 'formula-card');
    box.id = 'f-' + f.id;
    box.append(el('div', 'formula-title', f.title));
    box.append(el('div', 'formula-expr', f.expr));
    if (f.note) box.append(el('p', 'formula-note', f.note));

    const p = {};
    f.vars.forEach((q) => (p[q.k] = q.options ? q.options[0].val : q.default));

    const result = el('div', 'formula-result');
    const recompute = () => {
      result.innerHTML = '';
      result.append(stat(num(f.compute(p)) + ' ' + f.unit, 'תוצאה', 'accent'));
    };

    const grid = el('div', 'formula-vars');
    f.vars.forEach((q) => {
      const field = el('label', 'formula-var');
      field.append(el('span', 'formula-var-lbl', q.label + (q.unit ? ` (${q.unit})` : '')));
      let inp;
      if (q.options) {
        inp = el('select', 'formula-select');
        q.options.forEach((o) => {
          const opt = el('option', null, o.label);
          opt.value = o.val;
          inp.append(opt);
        });
        inp.value = q.options[0].val;
        inp.onchange = () => { p[q.k] = parseFloat(inp.value); recompute(); };
      } else {
        inp = el('input', 'formula-num');
        inp.type = 'number';
        inp.step = q.step || 1;
        inp.value = q.default;
        inp.dir = 'ltr';
        inp.oninput = () => { const x = parseFloat(inp.value); if (isFinite(x)) { p[q.k] = x; recompute(); } };
      }
      field.append(inp);
      grid.append(field);
    });
    box.append(grid);
    box.append(result);
    recompute();
    view.append(box);
  });

  if (focusId) {
    const t = document.getElementById('f-' + focusId);
    if (t) setTimeout(() => t.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
  } else toTop();
  updateFooter();
}

/* ═══════════════════════════════════════════════════════════════════
   מפת החומרים
   ═══════════════════════════════════════════════════════════════════
   הבעיה שזה פותר: יש תשעה סיכומים משבעה מחזורים, חמישה מרצים, וסילבוס
   שזז כל שנה. השאלה "מאיפה ללמוד את זה" לקחה עד היום שיחת וואטסאפ.

   העיקרון: יחידה במפה = נושא קנוני אחד מהטקסונומיה, בדיוק כמו ש-SIMS
   נתלות על topics. משם מגיע הקישור הדו-כיווני בחינם — שאלה מתויגת בנושא
   מקבלת כפתור "איפה ללמוד", והיחידה מקבלת כפתור תרגול. אין הזנת דאטה
   לאף שאלה. sync.js מוודא שכל נושא במפה קיים בפועל, אחרת הצ׳יפ מוביל לריק.

   התוכן ב-JSON ולא כאן: מפה היא תוכן, לא קוד (בשונה מהסימולציות, ששם
   המשוואה עצמה היא הקוד). ככה היא מקבלת גם גיבוב-גרסה ו-cache-busting. */

const guideCache = {};
async function loadGuide(courseId) {
  if (courseId in guideCache) return guideCache[courseId];
  const meta = EXAMS.find((e) => e.course === courseId && e.kind === 'guide');
  if (!meta) return (guideCache[courseId] = null);
  try {
    const res = await fetch(`exams/${meta.file}?v=${VERSION}`);
    guideCache[courseId] = res.ok ? await res.json() : null;
  } catch { guideCache[courseId] = null; }
  const g = guideCache[courseId];
  if (g) g.units.forEach((u) => (GUIDE_BY_TOPIC[u.topic] = { unit: u, course: courseId }));
  return g;
}

/* נושא → יחידה. מתמלא ב-loadGuide, ולכן כל מסך שמציג שאלות טוען את המפה
   לפני playQuestions — אחרת כניסה ישירה ל-#/exam/... לא תראה את הכפתור. */
const GUIDE_BY_TOPIC = {};
const guideOf = (courseId) => EXAMS.find((e) => e.course === courseId && e.kind === 'guide');

/* כמה מהנושא אתה כבר יודע. שאלה שלא נענתה נספרת כלא-נשלטת — זו לא החמרה,
   זה בדיוק המצב: לא ידוע אם אתה יודע אותה. */
function masteryOf(courseId, topic) {
  const d = seen.read();
  let total = 0, correct = 0;
  /* לפי מפתח ייחודי ולא לפי מופע. שאלה חוזרת קיימת גם בשחזור וגם במבחן ה-
     High Yield שנבנה ממנו, ולכן נספרה כאן פעמיים — המכנה של שעתוק היה 79
     במקום 67, ו"כמה אתה יודע" יצא נמוך מהאמת. הדירוג במפה נגזר מזה ישירות
     (freq × (1-mastery)), אז הטעות דחפה נושאים למעלה בלי סיבה.

     דה-דופליקציה דרך qKey ולא החרגה של ה-HY: שני שחזורים שונים שבהם אותה
     שאלה מקבלים qid שונה (ה-examId בגיבוב) — ואלה באמת שני מופעים נפרדים
     שראוי לספור פעמיים. רק העותק שה-HY לקח מהמקור הוא כפילות אמיתית. */
  const counted = new Set();
  quizzesOf(courseId).forEach((m) => {
    const q = cache[m.id];
    if (!q) return;
    /* דרך qKey ולא במפתח ידני. זה המקום היחיד שבנה את המפתח בעצמו, ולכן
       הוא המקום שהכי קל היה לשכוח — והכישלון שלו שקט: דירוג העדיפויות במפה
       ולוח הימים היו מתאפסים בלי שום הודעת שגיאה. */
    (q.questions || []).forEach((qq, i) => {
      if (qq.topic !== topic) return;
      const k = qKey({ ...qq, examId: m.id, idx: i });
      if (counted.has(k)) return;
      counted.add(k);
      total++;
      if (d[k] === 1) correct++;
    });
  });
  return { total, correct, ratio: total ? correct / total : 0 };
}

/* משקל הוודאות: מרצה שמסר גבולות גזרה (קוקס) שווה פחות זמן לנקודה — לא כי
   הנושא לא במבחן, אלא כי כבר ידוע מה בדיוק לקרוא. מרצה שלא הדליף = סיכון מלא. */
const CERTAINTY_W = { known: 0.6, mixed: 0.85, unknown: 1.0, new: 0.75 };

/* ארבע הרמות מודדות תמיד את אותו דבר — כמה ידוע לנו מה ייכנס — אבל מה שמייצר
   את הידיעה שונה לגמרי בין מקצועות: בביומול זה מרצה שמסר גבולות גזרה, ובאלקטרו
   זה מאגר רשמי בן חמש שנים ששואל את אותו נושא באותו היקף כל שנה. אותה סקאלה,
   אותם משקלים, ניסוח אחר — ולכן התוויות מגיעות מהנתונים (`certaintyTags`). */
const CERTAINTY_TAG = {
  known:   ['✓ ידוע',        'tag-known'],
  mixed:   ['⚠️ חלקית ידוע', 'tag-risk'],
  unknown: ['🎧 לא ידוע',    'tag-risk'],
  new:     ['❓ חדש למרצה',  'tag-risk'],
};
const certaintyTag = (g, c) =>
  (g.certaintyTags && g.certaintyTags[c]) || CERTAINTY_TAG[c] || CERTAINTY_TAG.unknown;

function priorityList(courseId, g) {
  return g.units
    .map((u) => {
      const m = masteryOf(courseId, u.topic);
      return { u, m, score: u.freq * (1 - m.ratio) * (CERTAINTY_W[u.certainty] ?? 1) };
    })
    .sort((a, b) => b.score - a.score);
}

/* לוח הימים נגזר מהספירה לאחור ולא נכתב ביד — אחרת הוא נכון ליום אחד.
   היום האחרון שמור תמיד ל-High Yield ולטעויות; את השאר ממלאים לפי עדיפות
   בשיבוץ חמדני לדלי הכי ריק, כדי שהעומס יתחלק ולא ייפול הכל על יום אחד. */
function dayPlan(courseId, ranked) {
  const c = courseOf(courseId);
  const next = nextDate(c);            // {moed, at, ts} — לא חותמת זמן
  if (!next || !next.ts) return null;
  const days = Math.max(1, Math.ceil((next.ts - Date.now()) / MS.day));
  const studyDays = Math.max(1, Math.min(days - 1, 7));
  const bins = Array.from({ length: studyDays }, () => ({ items: [], load: 0 }));
  ranked.forEach((r) => {
    const b = bins.reduce((min, x) => (x.load < min.load ? x : min), bins[0]);
    b.items.push(r);
    b.load += r.score;
  });
  return { days, bins };
}

/* ---------- הדיסקליימר ----------
   שלושה מקומות, אף אחד מהם לא חוסם: שורה מתקפלת במפה (המסך היחיד שאומר
   "אל תלמדו את זה"), סעיף פרוס בדף ההסבר, ושורה בפוטר של כל עמוד.
   הדרישה היא שהוא ייקרא, לא שיתפוס מקום — קופסה קבועה בראש הדף נהיית
   רעש שגוללים מעליו תוך יומיים, וזה בדיוק הכישלון של דיסקליימר. */
const DISC_LEAD =
  'כל מה שכאן נבנה על ידי סטודנטים: השחזורים שוחזרו מהזיכרון, ההסברים והתיוגים נכתבו כאן, ' +
  'ומפות החומרים מבוססות על סיכומים של מחזורים קודמים. ' +
  '<b>זה לא רשמי, זה לא מטעם הפקולטה, ואף אחד לא מתחייב שמה שכתוב נכון, מדויק או מלא.</b>';

/* הסייגים עצמם משתנים בין מקצועות, והנוסח הזה נכון לשחזורים: "נספרו משחזורים",
   "המשחזרים לא אימתו". באלקטרו המקור הוא מאגר רשמי, ולומר עליו שהוא שוחזר
   מהזיכרון זה פשוט לא נכון — ולכן מפה יכולה לספק סייגים משלה ב-`disclaimer`. */
const DISC_BULLETS = [
  '<b>התדירויות הן הערכה מהעבר</b> — נספרו משחזורים של מחזורים קודמים, שבחלקם המרצים והסילבוס היו אחרים. הן לא תחזית.',
  '<b>הציטוטים הם ממחזורים קודמים</b> — מרצה יכול לשנות את דעתו, ולשנות את המבחן.',
  '<b>"מה לא ללמוד" הוא אות, לא הבטחה.</b> "אין ראיה" פירושו שחיפשנו ולא מצאנו — לא שזה בוודאות לא יופיע.',
  '<b>יש שחזורים שהמשחזרים עצמם כתבו שהתשובות בהם לא אומתו.</b> החומר הרשמי הוא ההרצאות, המצגות והסילבוס.',
];

const DISC_TAIL =
  'תשתמשו בזה כדי לחסוך זמן ולהחליט מאיפה להתחיל — לא כדי להחליט על מה לוותר. ' +
  '<b>ההחלטה מה ללמוד, וההחלטה כמה לסמוך על מה שכאן, הן שלכם בלבד — והאחריות לתוצאה שלכם בלבד.</b>';

const discHtml = (bullets) =>
  DISC_LEAD + '<ul>' + (bullets ?? DISC_BULLETS).map((b) => '<li>' + b + '</li>').join('') + '</ul>' + DISC_TAIL;

/* הנוסח הכללי — לדף ההסבר ולפוטר, שמדברים על האתר כולו ולא על מקצוע אחד. */
const DISC_HTML = discHtml();

/* במפה — שורה אחת שנפתחת. המפה היא המסך שאומר "אל תלמדו את זה",
   אז היא לא מסתפקת בפוטר, אבל גם לא חוסמת את התוכן. */
function guideDisclaimer(g) {
  const d = el('details', 'g-disc');
  const s = el('summary', null, '⚠️ האחריות על הלמידה היא שלך בלבד — מה המקור של כל דבר כאן, ומה הוא שווה');
  d.append(s);
  const body = el('div', 'disc-body');
  body.innerHTML = discHtml(g && g.disclaimer);
  d.append(body);
  return d;
}

function guideHero(courseId) {
  const meta = guideOf(courseId);
  if (!meta) return null;
  const a = el('a', 'lhero guide-hero');
  a.dataset.tour = 'guide';
  a.href = '#/guide/' + courseId;
  const left = el('div', 'lhero-main');
  left.append(el('div', 'lhero-eyebrow', '📚 מפת החומרים'));
  left.append(el('h2', null, 'מאיפה ללמוד כל נושא — ומה לא ללמוד'));
  /* מה נסרק ומה נמצא שונה בין מקצועות (לביומול יש סילבוס וסרטונים מאומתים,
     לאלקטרו יש מאגר רשמי ואין אף אחד משניהם) — ולכן הכותרת מגיעה מהנתונים. */
  left.append(el('p', 'lhero-sub', meta.heroSub ||
    'תשעה סיכומים משבעה מחזורים נסרקו מול הסילבוס הרשמי ומול כל השאלות בארכיון. ' +
    'לכל נושא: מאיזה סיכום ומאיזה עמוד, איזה סרטון באמת מכסה אותו, ומה המרצה אמר במפורש שלא צריך.'));
  a.append(left);
  const right = el('div', 'lhero-side');
  right.append(el('div', 'lhero-n', String(meta.count)));
  right.append(el('div', 'lhero-n-lbl', 'יחידות'));
  a.append(right);
  return a;
}

function srcLine(s, cls) {
  const d = el('div', 'g-src ' + (cls || ''));
  const head = el('div', 'g-src-head');
  head.append(el('b', null, s.src));
  if (s.pages) head.append(el('span', 'g-pages', s.pages));
  d.append(head);
  if (s.section) d.append(el('div', 'g-section', '📑 ' + s.section));
  if (s.anchor) {
    const an = el('div', 'g-anchor');
    an.append(el('span', 'g-anchor-lbl', '🔍 Ctrl+F'));
    an.append(el('span', 'g-anchor-txt', '„' + s.anchor + '”'));
    d.append(an);
  }
  return d;
}

/* הסרטון נטען רק בלחיצה. שנים-עשר iframes של יוטיוב בטעינת דף = דף מת,
   ורוב הסטודנטים ממילא פותחים אחד. */
function videoCard(v) {
  if (v.src === 'osmosis') {
    const d = el('div', 'g-vid g-vid-osmo');
    d.append(el('span', 'g-vid-ico', '🧫'));
    const t = el('div', 'g-vid-txt');
    t.append(el('b', null, v.title));
    t.append(el('span', 'g-vid-note', 'אוסמוזיס — חפשו בחשבון שלכם'));
    d.append(t);
    return d;
  }
  const d = el('div', 'g-vid' + (v.verified === 'partial' ? ' g-vid-part' : ''));
  const thumb = el('button', 'g-vid-thumb');
  thumb.type = 'button';
  thumb.style.backgroundImage = `url(https://i.ytimg.com/vi/${v.id}/mqdefault.jpg)`;
  thumb.append(el('span', 'g-vid-play', '▶'));
  thumb.setAttribute('aria-label', 'נגן: ' + v.title);
  thumb.onclick = () => {
    const f = document.createElement('iframe');
    f.src = `https://www.youtube-nocookie.com/embed/${v.id}?autoplay=1&rel=0`;
    f.title = v.title;
    f.allow = 'accelerometer; autoplay; encrypted-media; picture-in-picture';
    f.allowFullscreen = true;
    f.className = 'g-vid-frame';
    thumb.replaceWith(f);
  };
  d.append(thumb);
  const t = el('div', 'g-vid-txt');
  t.append(el('b', null, v.title));
  if (v.verified === true)
    t.append(el('span', 'g-vid-ok', '✅ אומת מול התמלול · ' + (v.covers || []).join(' · ')));
  else if (v.verified === 'partial') {
    t.append(el('span', 'g-vid-part-lbl', '⚠️ מכסה חלקית · ' + (v.covers || []).join(' · ')));
    if (v.missing) t.append(el('span', 'g-vid-note', v.missing));
  } else t.append(el('span', 'g-vid-note', '⚠️ לא אומת — אין תמלול זמין'));
  d.append(t);
  return d;
}

/* qid → איפה השאלה יושבת בפועל. נבנה מהמבחנים שכבר בזיכרון (renderGuide טוען
   את כולם ממילא), ולכן לא עולה בקשה אחת.

   ⚠️ ה-High Yield מוחרג. הוא עותק של שאלות שכבר קיימות ומאז 17/07 הוא חולק
   איתן qid — בלי ההחרגה כל שאלה חוזרת הייתה נספרת פעמיים בקבלה ("נשאל
   ב-3 מועדים" במקום 2), וזה בדיוק הניפוח שכבר תיקנו ב-masteryOf. */
/* "שחזור מחזור מ״ז — מועד א׳" → "מ״ז א׳". התגית צריכה להיכנס בגלולה ברוחב
   375px, וכל המילים שמוסרות מכאן זהות בכל הכותרות ולכן לא מבדילות בין מועד
   למועד. נופל בחזרה לכותרת המלאה אם הדפוס לא מזוהה — עדיף ארוך מאשר שגוי. */
const shortExam = (t) => (t || '')
  .replace(/^שחזור\s+/, '')
  .replace(/^מחזור\s+/, '')
  .replace(/\s*—\s*מועד\s+/, ' ')
  .trim() || t;

const qIdxCache = {};
function qIndex(courseId) {
  /* נבנה פעם אחת למקצוע: unitCard נקרא לכל יחידה (12 בביומול), ובלי המטמון
     היינו סורקים את כל 383 השאלות 12 פעמים לחינם. נמחק כשנטען מבחן חדש. */
  if (qIdxCache[courseId]) return qIdxCache[courseId];
  const idx = {};
  quizzesOf(courseId).forEach((m) => {
    if (m.kind === 'highyield') return;
    const ex = cache[m.id];
    if (!ex) return;
    (ex.questions || []).forEach((q, i) => {
      /* `trust` נשמר כאן כי הקבלה חייבת לשאת אותו. נקודה יכולה להישען על
         שחזור שהמשחזרים עצמם כתבו עליו שהתשובות לא אומתו — ובלי הסימון,
         "נשאל 3 פעמים" נראה מוצק בדיוק כמו ראיה ממאסטר רשמי. התג כבר קיים
         בכרטיס המבחן; כאן הוא פשוט נוסע עם הראיה. */
      if (q.qid && !idx[q.qid]) idx[q.qid] = { examId: m.id, idx: i, title: ex.title, trust: m.trust };
    });
  });
  return (qIdxCache[courseId] = idx);
}

/* "מה באמת נשאל" — הפרוזה נכתבה מראש, אבל **הקבלה נגזרת כאן ועכשיו**.
   אם היה כתוב בדאטה "נשאל ב-4 מועדים", המספר היה מתיישן בשחזור הבא ונהיה
   שקר שקט. במקום זה הנקודה מצביעה על qids, והספירה קורית בכל טעינה — אז היא
   לא יכולה לשקר. אותו היגיון בדיוק שבגללו `asked` לא קיים בסכימה.

   הנקודות ממוינות לפי מספר השאלות שבדקו אותן: מה שנשאל שש פעמים עולה למעלה.
   זה מה שסיכום לא יכול לעשות — הוא לא יודע מה נשאל. */
function pointsPanel(courseId, u, idx) {
  if (!(u.points || []).length) return null;

  const seenMap = seen.read();
  const ranked = u.points
    .map((p) => {
      const hits = (p.qids || []).filter((q) => idx[q]).map((q) => ({ qid: q, ...idx[q] }));
      const solid = hits.filter((h) => h.trust !== 'unverified' && h.trust !== 'partial');
      return {
        p, hits,
        moadim: [...new Set(hits.map((h) => h.title))],
        wrong: hits.filter((h) => seenMap[h.qid] === 0).length,
        /* כל הראיות מגיעות משחזורים שלא אומתו — כלומר הטענה עצמה נשענת על
           מפתחות שאיש לא בדק. תגית על קישור בודד לא מספיקה כאן: ההבדל בין
           "אחת מארבע ראיות רעועה" ל"כל הראיות רעועות" הוא ההבדל בין הערה
           לבין אזהרה. */
        allShaky: hits.length > 0 && solid.length === 0,
      };
    })
    .sort((a, b) => b.hits.length - a.hits.length);

  const det = el('details', 'g-points');
  const nQ = new Set(u.points.flatMap((p) => p.qids || [])).size;
  det.append(el('summary', null,
    `📌 מה באמת נשאל — ${ranked.length} נקודות, מתוך ${nQ} שאלות שנשאלו בפועל`));

  /* המסגור הזה הוא של ינון, אחרי שקרא את הפיילוט: **זו החזרה השנייה, לא
     הראשונה.** זה גם מיישב את החשש המתודולוגי — הנקודות נדחסו מהשאלות שבארכיון,
     ולכן הן לא "מלמדות" נושא מאפס; מי שיקרא רק אותן ילמד לענות ולא יבין.
     אבל אחרי שקראת את הסיכום והבנת, "מה מתוך זה באמת נבחן" הוא בדיוק מה
     שחזרה אמורה לעשות. לומר את זה במפורש עדיף על שהלומד יגלה לבד. */
  const lead = el('p', 'g-points-lead');
  lead.textContent = 'זה לא תחליף לסיכום, וזה לא מקום להתחיל בו — זו החזרה השנייה. ' +
    'אחרי שקראת את החומר והבנת אותו, כאן רואים מה מתוכו באמת נבחן, כמה פעמים, ואיפה נופלים.';
  det.append(lead);

  ranked.forEach(({ p, hits, wrong, allShaky }) => {
    const row = el('div', 'g-point');
    row.append(el('div', 'g-point-txt', p.point));

    const meta = el('div', 'g-point-meta');
    meta.append(el('span', 'g-point-n', hits.length === 1 ? 'נשאל פעם אחת' : `נשאל ${hits.length} פעמים`));
    if (allShaky) meta.append(el('span', 'g-point-shaky', '⚠️ אף מפתח כאן לא אומת'));
    /* צביעה אישית: מגיעה בחינם מהמפתח היציב. "נפלת כאן" הוא בדיוק מה
       שמבדיל בין רשימת עובדות לבין משהו שמדבר אליך. */
    if (wrong) meta.append(el('span', 'g-point-bad', `✗ נפלת ב-${wrong}`));
    row.append(meta);

    if (p.trap) {
      const t = el('div', 'g-point-trap');
      t.innerHTML = '<b>המלכודת:</b> ' + p.trap;
      row.append(t);
    }

    /* קישור דו-כיווני בחינם — ה-qids כבר יודעות איפה השאלה יושבת.
       כל קישור נושא את שם המועד שלו, ולכן הוא **גם** הקבלה: אין צורך בשורת
       "נשאל במ״ח · מ״ז · נ׳" נפרדת מעליהם. שורה כזאת הייתה חוזרת על אותו
       מידע בלי להיות לחיצה. */
    if (hits.length) {
      const links = el('div', 'g-point-qs');
      hits.forEach((h) => {
        const shaky = h.trust === 'unverified' || h.trust === 'partial';
        const a = el('a', 'g-point-q' + (shaky ? ' shaky' : ''), (shaky ? '⚠️ ' : '') + shortExam(h.title) + ' ↗');
        a.href = `#/exam/${h.examId}/${h.idx}`;
        a.title = shaky
          ? h.title + ' — התשובות בשחזור הזה לא אומתו בחשיפה'
          : h.title;
        links.append(a);
      });
      row.append(links);
    }
    det.append(row);
  });
  return det;
}

function unitCard(courseId, g, r, focus) {
  const u = r.u;
  const sec = el('section', 'g-unit' + (focus ? ' q-flash' : ''));
  sec.id = 'g-' + encodeURIComponent(u.topic);

  const head = el('div', 'g-unit-head');
  const ttl = el('div', 'g-unit-ttl');
  ttl.append(el('h3', null, u.topic));
  const meta = el('div', 'g-unit-meta');
  u.lecturers.forEach((l) => meta.append(el('span', 'lecturer', l)));
  const [tag, cls] = certaintyTag(g, u.certainty);
  meta.append(el('span', 'lecturer ' + cls, tag));
  meta.append(el('span', 'g-lessons', u.lessons));
  ttl.append(meta);
  head.append(ttl);
  const freq = el('div', 'g-freq');
  freq.append(el('div', 'g-freq-n', u.freq + '%'));
  freq.append(el('div', 'g-freq-l', 'מהשאלות'));
  head.append(freq);
  sec.append(head);

  sec.append(el('p', 'g-what', u.what));

  const body = el('div', 'g-body');
  body.append(el('div', 'g-lbl', '📖 מאיפה ללמוד'));
  body.append(srcLine(u.main, 'g-main'));
  (u.sup || []).forEach((s) => body.append(srcLine(s, 'g-sup')));

  if (u.gap) {
    const gap = el('div', 'g-gap');
    gap.innerHTML = '<b>⚠️ פער:</b> ' + u.gap;
    body.append(gap);
  }

  /* יושב מיד אחרי "מאיפה ללמוד" ולפני הסרטונים, כי זה הדבר שמצדיק את הפתיחה
     של הסיכום מלכתחילה. מקופל כברירת מחדל: בעמוד עם 12 יחידות, 22 נקודות
     פתוחות היו הופכות אותו לגלילה אינסופית — כלומר לסיכום המשעמם, שוב.
     יחידה בלי points פשוט לא מציגה כלום — אין fallback לרשימת הסברים, כי
     רשימה כזאת היא הכישלון עצמו ולא גרסת ביניים. */
  const pts = pointsPanel(courseId, u, qIndex(courseId));
  if (pts) body.append(pts);

  if ((u.videos || []).length) {
    body.append(el('div', 'g-lbl', '▶️ סרטונים'));
    const vs = el('div', 'g-vids');
    u.videos.forEach((v) => vs.append(videoCard(v)));
    body.append(vs);
  }

  if ((u.intel || []).length) {
    const det = el('details', 'g-intel');
    det.append(el('summary', null, `🔒 מה נאמר בהקלטות (${u.intel.length})`));
    u.intel.forEach((it) => {
      const q = el('div', 'g-quote');
      q.innerHTML = '<span class="g-q">„' + it.quote + '”</span><span class="g-qsrc">📼 ' + it.src + '</span>';
      det.append(q);
    });
    body.append(det);
  }

  const acts = el('div', 'g-acts');
  const p = el('a', 'btn btn-sm');
  p.href = `#/practice/${courseId}/${encodeURIComponent(u.topic)}`;
  p.textContent = `🎲 תרגל ${u.topic}`;
  acts.append(p);
  /* ליחידה ולסימולציה יש בדיוק אותו עוגן — הנושא הקנוני — ולכן החיבור בחינם,
     בדיוק כמו הכפתור ההפוך שכבר קיים במשוב. "קרא את זה" ו"שחק עם זה" הם שתי
     תשובות לגיטימיות לאותו נושא, וכאן הן עומדות זו לצד זו. */
  const sim = SIM_BY_TOPIC[u.topic];
  if (sim) {
    const sa = el('a', 'btn btn-sm g-sim');
    sa.href = '#/sim/' + sim.id;
    sa.textContent = `${sim.icon} ${sim.title}`;
    sa.title = sim.blurb;
    acts.append(sa);
  }
  const prog = el('span', 'g-prog');
  prog.textContent = r.m.total ? `${r.m.correct}/${r.m.total} נכונות בארכיון` : 'טרם תרגלת';
  acts.append(prog);
  body.append(acts);

  sec.append(body);
  return sec;
}

async function renderGuide(courseId, focusTopic = null) {
  setNav('home');
  view.innerHTML = '<div class="empty"><span class="ico">⏳</span><b>טוען…</b></div>';
  const c = courseOf(courseId);
  if (!c) {
    view.innerHTML = '';
    view.append(emptyState('⚠️', 'מקצוע לא נמצא', 'הקישור כנראה שגוי.'));
    toTop();
    return;
  }
  const g = await loadGuide(courseId);
  if (!g) {
    view.innerHTML = '';
    view.append(emptyState('📭', 'אין מפת חומרים למקצוע הזה', 'היא נבנית לכל מקצוע בנפרד.'));
    toTop();
    return;
  }

  /* צריך את השאלות עצמן כדי לספור שליטה לפי נושא — המניפסט מחזיק רק מטא-דאטה. */
  await Promise.all(quizzesOf(courseId).map((m) => loadExam(m.id).catch(() => null)));

  view.innerHTML = '';
  view.append(crumb(c.name, '#/course/' + courseId));
  const h = el('header', 'g-head');
  h.append(el('h1', null, '📚 מפת החומרים — ' + c.name));
  h.append(el('p', 'g-head-sub', g.method));
  view.append(h);

  /* לא בקובץ התוכן אלא כאן, בכוונה: המסך הזה אומר לאנשים מה לא ללמוד, וזו
     האמירה הכי מסוכנת באתר. מקודד ברינדור כדי שמפה של מקצוע חדש תקבל אותו
     אוטומטית — אי אפשר לשכוח להוסיף אותו. */
  view.append(guideDisclaimer(g));

  if (g.headline) {
    const hl = el('section', 'g-headline');
    hl.append(el('h2', null, g.headline.title));
    const p = el('p', null); p.innerHTML = g.headline.body;
    hl.append(p);
    view.append(hl);
  }

  if (g.stack) {
    const st = el('section', 'g-stack');
    st.append(el('div', 'g-lbl', '⚡ ההכרעה בשורה אחת'));
    ['spine', 'patch', 'warn'].forEach((k) => {
      if (!g.stack[k]) return;
      const d = el('div', 'g-stack-row g-stack-' + k);
      d.innerHTML = g.stack[k];
      st.append(d);
    });
    view.append(st);
  }

  const ranked = priorityList(courseId, g);

  /* "מה עכשיו" — הנושא עם הפער הגדול ביותר בין המשקל שלו במבחן למה שאתה
     כבר יודע. מוצג עם החישוב גלוי, כי הנחיה בלי נימוק היא עוד מקור ללחץ. */
  const top = ranked[0];
  if (top) {
    const now = el('section', 'g-now');
    now.append(el('div', 'g-now-eyebrow', '⚡ מה עכשיו'));
    now.append(el('h2', null, top.u.topic));
    const why = el('p', 'g-now-why');
    const pct = Math.round(top.m.ratio * 100);
    /* הנימוק למה דווקא הנושא הזה — תלוי במה שמייצר את הוודאות במקצוע,
       ולכן ניתן לדריסה ב-`nowWhy` לפי רמת הוודאות. */
    const nowWhy = (g.nowWhy && g.nowWhy[top.u.certainty]) ||
      (top.u.certainty === 'known'
        ? ' המרצה מסר גבולות גזרה — תקרא את מסמך החזרה, תסמן וי, תעבור הלאה.'
        : ' ומרצה שלא הדליף מה ייכנס.');
    why.innerHTML = `<b>${top.u.freq}%</b> מהמבחן` +
      (top.m.total ? `, ואתה יודע <b>${pct}%</b> ממנו (${top.m.correct}/${top.m.total}).` : `, ועוד לא תרגלת אותו בכלל.`) +
      nowWhy;
    now.append(why);
    const acts = el('div', 'g-now-acts');
    const a1 = el('a', 'btn'); a1.href = '#/guide/' + courseId + '/' + encodeURIComponent(top.u.topic);
    a1.textContent = '📖 ' + top.u.main.src + (top.u.main.pages ? ' · ' + top.u.main.pages : '');
    const a2 = el('a', 'btn btn-ghost'); a2.href = `#/practice/${courseId}/${encodeURIComponent(top.u.topic)}`;
    a2.textContent = '🎲 תרגל עכשיו';
    acts.append(a1, a2);
    now.append(acts);
    if (top.u.gap) {
      const gp = el('div', 'g-now-gap');
      gp.innerHTML = '<b>⚠️ פער:</b> ' + top.u.gap;
      now.append(gp);
    }
    view.append(now);
  }

  const plan = dayPlan(courseId, ranked);
  if (plan) {
    const sec = el('section', 'g-plan');
    sec.append(el('div', 'g-lbl', `🗓️ ${plan.days} ימים למבחן — הצעה לחלוקה`));
    const grid = el('div', 'g-plan-grid');
    plan.bins.forEach((b, i) => {
      const d = el('div', 'g-day');
      d.append(el('div', 'g-day-n', 'יום ' + (i + 1)));
      b.items.forEach((r) => {
        const a = el('a', 'g-day-t');
        a.href = '#/guide/' + courseId + '/' + encodeURIComponent(r.u.topic);
        a.textContent = r.u.topic;
        d.append(a);
      });
      grid.append(d);
    });
    const last = el('div', 'g-day g-day-last');
    last.append(el('div', 'g-day-n', 'היום האחרון'));
    const hy = EXAMS.find((e) => e.course === courseId && e.kind === 'highyield');
    if (hy) { const a = el('a', 'g-day-t'); a.href = '#/exam/' + hy.id; a.textContent = '🎯 High Yield'; last.append(a); }
    const rv = el('a', 'g-day-t'); rv.href = '#/review/' + courseId; rv.textContent = '❌ הטעויות שלי';
    last.append(rv);
    grid.append(last);
    sec.append(grid);
    view.append(sec);
  }

  const unitsSec = el('section', 'g-units');
  unitsSec.append(el('h2', 'g-h2', '📖 הנושאים — לפי המשקל שלהם במבחן'));
  ranked.slice().sort((a, b) => b.u.freq - a.u.freq)
    .forEach((r) => unitsSec.append(unitCard(courseId, g, r, focusTopic === r.u.topic)));
  view.append(unitsSec);

  if ((g.skipList || []).length) view.append(skipPanel(g));
  if ((g.sources || []).length) view.append(sourcesPanel(g));
  if ((g.caveats || []).length) {
    const cv = el('section', 'g-caveats');
    cv.append(el('h2', 'g-h2', '🔬 איך זה נמדד — והסייגים'));
    g.caveats.forEach((t) => { const p = el('p', null); p.innerHTML = t; cv.append(p); });
    view.append(cv);
  }

  if (focusTopic) {
    const t = document.getElementById('g-' + encodeURIComponent(focusTopic));
    if (t) setTimeout(() => t.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
  } else toTop();
}

/* המסך שמוריד את הלחץ. שלוש רמות ודאות, ולא מתחזים לוודאות שאין:
   "ציטוט" = המרצה אמר את זה. "אין ראיה" = חיפשנו ולא מצאנו, וזה לא אותו דבר. */
function skipPanel(g) {
  const sec = el('section', 'g-skip');
  sec.append(el('h2', 'g-h2', '🎯 מה לא ללמוד'));
  sec.append(el('p', 'g-skip-sub',
    'זה החלק שמחזיר לכם שעות. כל שורה כאן היא או ציטוט מפורש של המרצה, או נושא שחיפשנו בכל הסיכומים ובכל השאלות ולא מצאנו לו זכר.'));
  /* כמה סיכומים וכמה שאלות נסרקו — עובדה של המקצוע, לא של המנוע. */
  const CATS = [
    ['quoted', '🔒 המרצה אמר במפורש שלא', 'המילים שלו, לא הפרשנות שלנו.'],
    ['no-evidence', '🕳️ אין לזה שום ראיה', 'אפס אזכורים בכל 8 הסיכומים ובכל 333 השאלות. <b>זה לא אומר "בוודאות לא במבחן"</b> — אף אחד לא מחזיק את שקופיות שיעורים 22 ו-26. זה אומר: אל תתחילו מכאן.'],
    ['off-syllabus', '📕 לא בסילבוס של נ״ב', 'קיים בסיכום, אבל לא בקורס שלכם.'],
  ].map(([cat, title, sub]) => [cat, title, (g.skipNotes && g.skipNotes[cat]) || sub]);
  CATS.forEach(([cat, title, sub]) => {
    const items = g.skipList.filter((s) => s.cat === cat);
    if (!items.length) return;
    const box = el('div', 'g-skip-cat');
    box.append(el('h3', null, title));
    const p = el('p', 'g-skip-note'); p.innerHTML = sub; box.append(p);
    items.forEach((s) => {
      const d = el('div', 'g-skip-row');
      const top = el('div', 'g-skip-top');
      top.append(el('b', null, s.term));
      const w = el('span', 'g-skip-why'); w.innerHTML = s.why; top.append(w);
      if (s.src) top.append(el('span', 'g-skip-src', '📼 ' + s.src));
      d.append(top);
      /* מה שהארכיון אומר על הפריט, באותה שורה. אמירת "אל תלמדו" בלי הראיה
         הנגדית לידה היא בדיוק איך שטעות כזאת מסתתרת — וכבר קרה שדילגנו
         על נושא שנשאל ארבע פעמים. */
      if (s.asked) {
        const a = el('div', 'g-skip-asked');
        a.innerHTML = '<b>אבל בארכיון:</b> ' + s.asked;
        d.append(a);
      }
      box.append(d);
    });
    sec.append(box);
  });
  return sec;
}

function sourcesPanel(g) {
  const sec = el('section', 'g-sources');
  sec.append(el('h2', 'g-h2', '🗂️ תיק על כל סיכום'));
  sec.append(el('p', 'g-skip-sub', g.sourcesNote ||
    'מי כתב, מאיזה מחזור, ומה זה שווה לכם היום. הצלב שכדאי לזכור: מאז מ״ה כמעט כל נושא בקורס החליף מרצה — רק אלקבץ נשאר.'));
  const grid = el('div', 'g-src-grid');
  g.sources.forEach((s) => {
    const d = el('div', 'g-scard tier-' + (s.cls || 'c'));
    d.append(el('span', 'g-tier', s.tier));
    d.append(el('h4', null, s.name));
    d.append(el('div', 'g-scard-meta', `מחזור ${s.cycle} · ${s.pages} עמ׳`));
    const u = el('p', 'g-scard-use'); u.innerHTML = s.use; d.append(u);
    const l = el('div', 'g-scard-lack'); l.innerHTML = '<b>החיסרון:</b> ' + s.lack; d.append(l);
    grid.append(d);
  });
  sec.append(grid);
  return sec;
}

/* מהשאלה למפה. נבחר אוטומטית לפי topic — ראו GUIDE_BY_TOPIC. */
function guideButton(topic) {
  const hit = GUIDE_BY_TOPIC[topic];
  if (!hit) return null;
  const a = el('a', 'fb-guide');
  a.href = `#/guide/${hit.course}/${encodeURIComponent(topic)}`;
  a.textContent = `📚 איפה ללמוד את ${topic}`;
  return a;
}

/* ---------- כותרת תחתונה ---------- */
function updateFooter() {
  const n = EXAMS.reduce((a, e) => a + e.count, 0);
  const f = document.getElementById('footerStats');
  f.textContent =
    `${plural(COURSES.length, 'מקצוע', 'מקצועות')} · ${plural(EXAMS.length, 'מבחן', 'מבחנים')} · ${n} שאלות · ההתקדמות נשמרת בדפדפן הזה בלבד`;
  /* מופיע בכל עמוד: הארכיון כולו הוא שחזורי סטודנטים, לא חומר רשמי. */
  let d = document.getElementById('footerDisc');
  if (!d) {
    d = el('span', 'footer-disc');
    d.id = 'footerDisc';
    f.parentElement.append(d);
  }
  d.textContent = 'אתר לא רשמי מתוצרת סטודנטים · אינו מטעם הפקולטה · האחריות על הלמידה היא של הלומד בלבד';
}

/* ---------- מקשי קיצור: 1-9 ---------- */
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.metaKey || e.ctrlKey) return;
  const n = parseInt(e.key, 10);
  if (!n || n < 1 || n > 9) return;

  const target = [...document.querySelectorAll('.q:not(.done)')].find((c) => {
    const r = c.getBoundingClientRect();
    return r.top < window.innerHeight * 0.6 && r.bottom > 0;
  });
  target?.querySelectorAll('.opt')[n - 1]?.click();
});

/* ---------- הפעלה ---------- */
window.addEventListener('hashchange', router);

/* קישור אל הכתובת שכבר פתוחה לא מפעיל hashchange, ולכן לא מרנדר מחדש.
   זה שובר את "תרגול חדש" (שמצביע חזרה לדף התרגול שממנו הגעת) ואת כל
   כפתור חזרה שמצביע לדף הנוכחי. מכריחים רינדור במקרה הזה. */
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="#"]');
  if (!a) return;
  if (a.getAttribute('href') === location.hash) {
    e.preventDefault();
    router();
  }
});

(async function init() {
  initTheme();
  try {
    await loadManifest();
  } catch {
    view.innerHTML = '';
    view.append(emptyState('⚠️', 'לא הצלחתי לטעון את רשימת המבחנים',
      'אם פתחת את הקובץ ישירות מהמחשב (file://), הדפדפן חוסם קריאת קבצים. הרץ את start.command בתיקייה, או פתח את האתר מהכתובת המקוונת.'));
    return;
  }
  router();
})();
