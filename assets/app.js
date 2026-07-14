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
  if (btn) {
    btn.textContent = t === 'dark' ? '☀️' : '🌙';
    btn.title = t === 'dark' ? 'מעבר למצב בהיר' : 'מעבר למצב כהה';
  }
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

/* ---------- נתונים ---------- */
let COURSES = [];
let EXAMS = [];
const cache = {};

async function loadManifest() {
  const res = await fetch('exams/manifest.json');
  if (!res.ok) throw new Error('manifest ' + res.status);
  const m = await res.json();
  COURSES = m.courses;
  EXAMS = m.exams;
}

async function loadExam(id) {
  if (cache[id]) return cache[id];
  const meta = EXAMS.find((e) => e.id === id);
  if (!meta) throw new Error('לא נמצא מבחן: ' + id);
  const res = await fetch('exams/' + meta.file);
  if (!res.ok) throw new Error('exam ' + res.status);
  return (cache[id] = await res.json());
}

const courseOf = (id) => COURSES.find((c) => c.id === id);
const examsOf = (courseId) => EXAMS.filter((e) => e.course === courseId);

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
  a.append(el('span', 'course-ico', c.icon || '📘'));
  a.append(el('h2', null, c.name));
  a.append(el('p', 'blurb', c.blurb || ''));

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
  head.append(el('p', null, c.blurb || ''));
  view.append(head);

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
  const pr = el('a', 'btn primary', `🎲 תרגול מעורב ב${c.name}`);
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
    questions: exam.questions,
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
    resultBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
    if (item.topic) top.append(el('span', 'topic', item.topic));
    card.append(top);

    card.append(el('div', 'q-text', item.q));
    if (item.origin) card.append(el('div', 'q-origin', item.origin));
    if (item.note) card.append(el('div', 'q-note', item.note));
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
    paint(qi, oi, card, opts, fb, item);
    refresh();

    // גלילה לשאלה הבאה — אבל לא כשיש הסבר לקרוא,
    // אחרת נגלול את המשתמש מעל ההסבר בדיוק ברגע שהוא נחשף.
    if (item.explain) return;
    const next = questions.findIndex((_, i) => answers[i] == null);
    if (next > -1) {
      setTimeout(() => {
        document.getElementById('q-' + next)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 320);
    }
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
  }

  render();
  toTop();
  updateFooter();
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

/* ================= תרגול מעורב (בתוך מקצוע) ================= */
function renderPractice(courseId) {
  setNav('home');
  const c = courseOf(courseId);
  view.innerHTML = '';

  if (!c) {
    view.append(emptyState('⚠️', 'מקצוע לא נמצא', 'הקישור כנראה שגוי.'));
    toTop();
    return;
  }

  view.append(crumb(c.name, '#/course/' + courseId));

  const head = el('div', 'page-head');
  head.append(el('h1', null, `תרגול מעורב — ${c.name}`));
  head.append(el('p', null,
    'שאלות אקראיות מכמה מבחנים יחד. זה שובר את הזיכרון של סדר השאלות, ומראה מה אתה באמת יודע.'));
  view.append(head);

  const list = examsOf(courseId);
  const chosen = new Set(list.map((e) => e.id));
  let count = 20;

  const form = el('div', 'form');

  const f1 = el('div', 'field');
  f1.append(el('label', null, 'מאילו מבחנים'));
  const chips = el('div', 'chips');
  list.forEach((e) => {
    const ch = el('div', 'chip on', e.part ? `${e.part} · ${e.title}` : e.title);
    ch.onclick = () => {
      if (chosen.has(e.id)) { chosen.delete(e.id); ch.classList.remove('on'); }
      else { chosen.add(e.id); ch.classList.add('on'); }
      updateInfo();
    };
    chips.append(ch);
  });
  f1.append(chips);
  form.append(f1);

  const f2 = el('div', 'field');
  f2.append(el('label', null, 'כמה שאלות'));
  const cc = el('div', 'chips');
  [10, 20, 30, 50, 0].forEach((n) => {
    const ch = el('div', 'chip' + (n === 20 ? ' on' : ''), n === 0 ? 'הכול' : String(n));
    ch.onclick = () => {
      count = n;
      cc.querySelectorAll('.chip').forEach((x) => x.classList.remove('on'));
      ch.classList.add('on');
      updateInfo();
    };
    cc.append(ch);
  });
  f2.append(cc);
  form.append(f2);

  const info = el('p');
  info.style.cssText = 'color:var(--dim); font-size:13.5px; margin-bottom:20px;';
  form.append(info);

  const go = el('button', 'btn primary', 'התחל תרגול');
  form.append(go);
  view.append(form);

  const pool = () => list.filter((e) => chosen.has(e.id));
  function updateInfo() {
    const p = pool();
    const total = p.reduce((a, e) => a + e.count, 0);
    info.textContent = p.length
      ? `בבריכה: ${total} שאלות מתוך ${plural(p.length, 'מבחן', 'מבחנים')}. ייבחרו ${count === 0 ? total : Math.min(count, total)} באקראי.`
      : 'בחר לפחות מבחן אחד.';
    go.disabled = !p.length;
  }
  updateInfo();

  go.onclick = async () => {
    go.disabled = true;
    go.textContent = 'טוען שאלות…';
    const p = pool();
    const all = [];
    for (const m of p) {
      const exam = await loadExam(m.id);
      exam.questions.forEach((q) => all.push({ ...q, origin: exam.title }));
    }
    shuffle(all);
    const picked = count === 0 ? all : all.slice(0, count);
    playQuestions({
      key: 'practice',
      title: `תרגול מעורב — ${c.name}`,
      subtitle: `${picked.length} שאלות אקראיות מתוך ${plural(p.length, 'מבחן', 'מבחנים')}`,
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

  const saved = store.read();
  const wrong = [];
  for (const m of examsOf(courseId)) {
    const rec = saved[m.id];
    if (!rec || !Object.keys(rec.answers || {}).length) continue;
    const exam = await loadExam(m.id);
    for (const [qi, oi] of Object.entries(rec.answers)) {
      const q = exam.questions[qi];
      if (q && q.a !== oi) wrong.push({ ...q, origin: exam.title });
    }
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
    note: 'זה סבב חזרה — התשובות כאן לא נשמרות. הטעויות המקוריות נשארות עד שתאפס מבחן.',
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
    { icon: '🎲', title: 'תרגול מעורב — החלק החשוב',
      body: 'שולף שאלות אקראיות מכמה מבחנים יחד. כשפותרים את אותו מבחן פעם שלישית, המוח זוכר ' +
            'שהתשובה היא "השלישית" במקום לזכור את החומר. ערבוב שובר את זה.' },
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
