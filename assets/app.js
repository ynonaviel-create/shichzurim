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
const KIND_LABEL = { shichzur: 'שחזור', practice: 'תרגול', highyield: 'High Yield' };

const view = document.getElementById('view');
const el = (tag, cls, txt) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (txt != null) n.textContent = txt;
  return n;
};
const plural = (n, one, many) => (n === 1 ? `${one} אחד` : `${n} ${many}`);

/* ---------- ערכת נושא ---------- */
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  const btn = document.getElementById('themeBtn');
  if (btn) btn.title = t === 'dark' ? 'מעבר למצב בהיר' : 'מעבר למצב כהה';
}
function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  applyTheme(saved || 'light');
  document.getElementById('themeBtn').onclick = () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
  };
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
const qKey = (item) => `${item.examId}#${item.idx}`;

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
  const fresh = m.assets && m.assets.js;
  if (BUILD && fresh && fresh !== BUILD && !sessionStorage.getItem('reloadedFor:' + fresh)) {
    sessionStorage.setItem('reloadedFor:' + fresh, '1');
    const u = new URL(location.href);
    u.searchParams.set('b', fresh);
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
  return (cache[id] = await res.json());
}

const courseOf = (id) => COURSES.find((c) => c.id === id);
// מבחנים של מקצוע, מהמחזור החדש לישן. מבחן בלי מחזור (בנק שאלות, high-yield) בסוף.
const examsOf = (courseId) =>
  EXAMS.filter((e) => e.course === courseId).sort(
    (a, b) => (b.cycle ?? -1) - (a.cycle ?? -1) || a.title.localeCompare(b.title, 'he'),
  );

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
  examsOf(courseId).forEach((e) => {
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
  const [route, param] = location.hash.replace(/^#\/?/, '').split('/');
  if (route === 'course' && param) return renderCourse(param);
  if (route === 'exam' && param) return renderExam(param);
  if (route === 'practice' && param) return renderPractice(param);
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
  const list = examsOf(c.id);
  const p = courseProgress(c.id);

  const a = el('a', 'course');
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
  dash.append(stat(list.length, 'מבחנים', 'accent'));
  dash.append(stat(p.total, 'שאלות'));
  dash.append(stat(p.answered, 'שאלות שענית'));
  dash.append(stat(p.answered ? pct + '%' : '—', 'אחוז הצלחה', pct >= 70 ? 'good' : p.answered ? 'bad' : ''));
  view.append(dash);

  const actions = el('div', 'btn-row');
  actions.style.marginBottom = '30px';
  const pr = el('a', 'btn primary', `🎲 תרגול חופשי ב${c.name}`);
  pr.href = '#/practice/' + courseId;
  actions.append(pr);
  const rv = el('a', 'btn', `🎯 הטעויות שלי ב${c.name}`);
  rv.href = '#/review/' + courseId;
  actions.append(rv);
  view.append(actions);

  // קיבוץ לפי חלק (א׳ / ב׳). מבחנים בלי חלק נופלים לקבוצה אחת.
  const byPart = {};
  list.forEach((e) => (byPart[e.part || ''] ||= []).push(e));

  Object.keys(byPart).sort().forEach((part) => {
    const sec = el('section', 'part');
    const ph = el('div', 'part-head');
    ph.append(el('h2', null, part ? `${c.name} ${part}` : c.name));
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

function examCard(m) {
  const s = quickScore(m);
  const a = el('a', 'card');
  a.href = '#/exam/' + m.id;
  a.append(el('h3', null, m.title));

  const meta = el('div', 'card-meta');
  meta.append(el('span', 'tag ' + m.kind, KIND_LABEL[m.kind] || m.kind));
  if (m.moed) meta.append(el('span', 'tag', `מועד ${m.moed}׳`));
  meta.append(el('span', 'tag', `${m.count} שאלות`));
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
async function renderExam(id) {
  setNav('home');
  view.innerHTML = '<div class="empty"><span class="ico">⏳</span><b>טוען…</b></div>';

  let exam;
  try { exam = await loadExam(id); }
  catch (err) {
    view.innerHTML = '';
    view.append(emptyState('⚠️', 'לא הצלחתי לטעון את המבחן', String(err.message)));
    return;
  }

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
}

function playQuestions(cfg) {
  const { key, title, subtitle, note, questions, persist, back } = cfg;
  view.innerHTML = '';

  const rec = persist ? store.exam(key) : { answers: {} };
  const answers = persist ? rec.answers : {};

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
      if (questions[qi].a === oi) good++; else bad++;
    }
    return { good, bad, answered: good + bad };
  }

  function refresh() {
    const { good, bad, answered } = tally();
    cGood.textContent = `✓ ${good}`;
    cBad.textContent = `✗ ${bad}`;
    cLeft.textContent = `נותרו ${questions.length - answered}`;
    fill.style.width = Math.round((answered / questions.length) * 100) + '%';
    fill.className = answered ? (good / answered >= 0.7 ? 'good' : 'bad') : '';

    if (persist) {
      store.save(key, { answers, correct: good, done: answered === questions.length, at: Date.now() });
    }

    toResult.style.display = answered === questions.length ? '' : 'none';

    resultBox.innerHTML = '';
    if (answered !== questions.length) return;

    const pct = Math.round((good / questions.length) * 100);
    const box = el('div', 'result');
    box.append(el('div', 'grade ' + (pct >= 80 ? 'good' : pct >= 60 ? 'mid' : 'bad'), pct + '%'));
    box.append(el('div', 'sub', `${good} נכונות מתוך ${questions.length}. ${
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
      if (!item.topic || answers[qi] == null) return;
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
    const card = el('div', 'q');
    card.id = 'q-' + qi;

    const top = el('div', 'q-top');
    top.append(el('span', 'q-num', `שאלה ${qi + 1} מתוך ${questions.length}`));

    const tags = el('div', 'q-tags');

    /* תג החזרה — הסיגנל שבשבילו כל זה נבנה. מוצג בכל מקום שבו שאלה מוצגת:
       בתוך שחזור, בתרגול חופשי, ובמבחן ה-High Yield עצמו. */
    const r = item.repeat;
    if (r && r.n > 1) {
      const tag = el('span', 'repeat' + (r.n >= 3 ? ' hot' : ''));
      tag.append(el('span', null, r.n >= 3 ? '⭐' : '🔁'));
      tag.append(el('span', null, `הופיעה ב-${r.n} מחזורים · ${r.in.join(' · ')}`));
      tag.title =
        'שאלה שחזרה על עצמה בין מחזורים — ההימור הטוב ביותר למבחן.' +
        (r.span >= 3 ? `\nוהיא חזרה על פני ${r.span} מחזורים, לא רק בין שניים סמוכים.` : '');
      tags.append(tag);
    }
    if (item.topic) tags.append(el('span', 'topic', item.topic));
    top.append(tags);
    card.append(top);

    card.append(el('div', 'q-text', item.q));

    if (r && r.conflict)
      card.append(el('div', 'q-warn', '⚠️ המחזורים חלוקים על התשובה הנכונה לשאלה הזאת. אחד המפתחות טועה — אל תשנן, תבין.'));

    // מקור השחזור והמבחן שממנו הגיעה השאלה — מידע רקע, לא אזהרה.
    const src = [item.source, item.origin].filter(Boolean).join(' · ');
    if (src) card.append(el('div', 'q-origin', src));

    if (item.note) card.append(el('div', 'q-note', item.note));

    // גרף/תמונה שחולצו מה-PDF. שאלות רבות בביומול ובאלקטרו בלתי פתירות בלעדיהם.
    if (item.image) {
      const wrap = el('div', 'q-img');
      const img = el('img');
      img.src = item.image;
      img.alt = 'איור לשאלה';
      img.loading = 'lazy';
      wrap.append(img);
      card.append(wrap);
    }

    if (item.table) card.append(tableOf(item.table));

    const opts = el('div', 'opts');
    const fb = el('div', 'fb');

    item.opts.forEach((text, oi) => {
      const o = el('div', 'opt');
      o.append(el('span', 'key', String(oi + 1)));
      o.append(el('span', null, text));
      o.onclick = () => choose(qi, oi, card, opts, fb, item);
      opts.append(o);
    });

    card.append(opts, fb);
    if (answers[qi] != null) paint(qi, answers[qi], card, opts, fb, item);
    return card;
  }

  function choose(qi, oi, card, opts, fb, item) {
    if (answers[qi] != null) return;
    answers[qi] = oi;
    seen.mark(item, oi === item.a);   // נרשם גם במבחן וגם בתרגול
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
      if (i === item.a) o.classList.add('correct');
      else if (i === oi) o.classList.add('wrong');
      if (i === oi) o.classList.add('chosen');
    });

    fb.className = 'fb show ' + (isRight ? 'ok' : 'no');
    fb.innerHTML = '';
    fb.append(el('div', null, isRight ? '✓ נכון' : `✗ לא נכון — התשובה הנכונה: ${item.opts[item.a]}`));
    if (item.explain) fb.append(el('div', 'explain', item.explain));
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
/* ================= תרגול חופשי =================
   לא כבול למבחן. בוחרים חלק (א׳/ב׳), נושאים, מצב, וכמות.

   ברירת המחדל היא "שאלות חדשות" — שאלות שעוד לא ראית באף מקום באתר.
   זה מה שמאפשר להתקדם דרך הארכיון במקום לחזור באקראי על אותן שאלות. */
async function renderPractice(courseId) {
  setNav('home');
  const c = courseOf(courseId);
  if (!c) {
    view.innerHTML = '';
    view.append(emptyState('⚠️', 'מקצוע לא נמצא', 'הקישור כנראה שגוי.'));
    toTop();
    return;
  }

  view.innerHTML = '<div class="empty"><span class="ico">⏳</span><b>טוען את בנק השאלות…</b></div>';

  /* מבחן ה-High Yield נבנה מהשאלות של השחזורים עצמם, ולכן אסור לו להיכנס
     למאגר — אחרת כל שאלה חוזרת הייתה מופיעה כאן פעמיים. */
  const pool = [];
  for (const m of examsOf(courseId).filter((m) => m.kind !== 'highyield')) {
    const exam = await loadExam(m.id);
    exam.questions.forEach((q, i) =>
      pool.push({ ...q, part: m.part || '', origin: exam.title, examId: m.id, idx: i })
    );
  }

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

  /* --- מצב הסינון --- */
  const allParts = [...new Set(pool.map((q) => q.part))].filter(Boolean).sort();
  const selParts = new Set(allParts);
  const selTopics = new Set();          // ריק = כל הנושאים
  let minRepeat = 1;                    // 1 = הכול. 2/3/4 = רק שאלות שחזרו כך וכך פעמים
  let mode = 'new';                     // new | wrong | all
  let count = 20;

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
    const ch = el('div', 'chip' + (m.id === mode ? ' on' : ''), m.label);
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

  /* --- חלק --- */
  if (allParts.length > 1) {
    const partsField = el('div', 'field');
    partsField.append(el('label', null, 'חלק'));
    const chips = el('div', 'chips');
    allParts.forEach((p) => {
      const ch = el('div', 'chip on', `${c.name} ${p}`);
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
    pool.filter(inParts).forEach((q) => {
      if (q.topic) counts[q.topic] = (counts[q.topic] || 0) + 1;
    });
    const names = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
    [...selTopics].forEach((t) => { if (!counts[t]) selTopics.delete(t); });

    topicChips.innerHTML = '';
    if (!names.length) { topicsField.style.display = 'none'; return; }
    topicsField.style.display = '';
    topicsLabel.textContent = `נושאים ${selTopics.size ? `(${selTopics.size} נבחרו)` : '(הכול)'}`;

    const all = el('div', 'chip' + (selTopics.size === 0 ? ' on' : ''), 'כל הנושאים');
    all.onclick = () => { selTopics.clear(); drawTopics(); update(); };
    topicChips.append(all);

    names.forEach((t) => {
      const ch = el('div', 'chip' + (selTopics.has(t) ? ' on' : ''), `${t} · ${counts[t]}`);
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
      { n: 3, label: '⭐ 3 מחזורים ומעלה' },
      { n: 4, label: '🔥 4 ומעלה' },
    ].forEach(({ n, label }) => {
      const have = repeatCounts(n);
      if (n > 1 && !have) return;                       // אל תציע מסנן שמחזיר אפס
      const ch = el('div', 'chip' + (n === minRepeat ? ' on' : ''), n === 1 ? label : `${label} · ${have}`);
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

  /* --- כמות --- */
  const countField = el('div', 'field');
  countField.append(el('label', null, 'כמה שאלות'));
  const cc = el('div', 'chips');
  [10, 20, 30, 50, 0].forEach((n) => {
    const ch = el('div', 'chip' + (n === 20 ? ' on' : ''), n === 0 ? 'הכול' : String(n));
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
    if (mode === 'new') {
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

  view.innerHTML = '<div class="empty"><span class="ico">⏳</span><b>אוסף את הטעויות…</b></div>';

  // נשען על מפת ה"נראו" — לכן טעות שנעשתה בתרגול חופשי מגיעה לכאן גם היא,
  // ותשובה נכונה כאן מורידה את השאלה מהרשימה.
  const map = seen.read();
  const wrong = [];
  for (const m of examsOf(courseId)) {
    const exam = await loadExam(m.id);
    exam.questions.forEach((q, i) => {
      const item = { ...q, origin: exam.title, examId: m.id, idx: i };
      if (map[qKey(item)] === 0) wrong.push(item);
    });
  }

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
  txt.append(el('span', null, 'דקה של הסבר על מה שאפשר לעשות באתר — ואיך להוציא ממנו הכי הרבה.'));
  b.append(txt);

  const acts = el('div', 'btn-row');
  const read = el('a', 'btn primary', 'ספר לי');
  read.href = '#/about';
  acts.append(read);
  const skip = el('button', 'btn ghost', 'תודה, אני מסתדר');
  skip.onclick = () => { localStorage.setItem(SEEN_KEY, '1'); b.remove(); };
  acts.append(skip);
  b.append(acts);
  return b;
}

/* ---------- כותרת תחתונה ---------- */
function updateFooter() {
  const n = EXAMS.reduce((a, e) => a + e.count, 0);
  document.getElementById('footerStats').textContent =
    `${plural(COURSES.length, 'מקצוע', 'מקצועות')} · ${plural(EXAMS.length, 'מבחן', 'מבחנים')} · ${n} שאלות · ההתקדמות נשמרת בדפדפן הזה בלבד`;
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
