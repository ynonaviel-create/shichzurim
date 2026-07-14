/* ===== ארכיון השחזורים — מנוע =====
   מבנה: manifest.json מגדיר אילו מבחנים קיימים.
   כל מבחן הוא exams/<id>.json עם מערך שאלות.
   התקדמות נשמרת ב-localStorage בדפדפן של המשתמש.
*/

const KEY = 'shichzurim.v1';
const KIND_LABEL = { shichzur: 'שחזור', practice: 'תרגול', highyield: 'High Yield' };

const view = document.getElementById('view');
const el = (tag, cls, txt) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (txt != null) n.textContent = txt;
  return n;
};

/* ---------- אחסון ---------- */
const store = {
  read() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; }
    catch { return {}; }
  },
  write(data) { localStorage.setItem(KEY, JSON.stringify(data)); },
  exam(id) { return this.read()[id] || { answers: {}, done: false }; },
  save(id, rec) { const d = this.read(); d[id] = rec; this.write(d); },
  reset(id) { const d = this.read(); delete d[id]; this.write(d); },
};

/* ---------- נתונים ---------- */
let MANIFEST = [];
const examCache = {};

async function loadManifest() {
  const res = await fetch('exams/manifest.json');
  if (!res.ok) throw new Error('manifest ' + res.status);
  MANIFEST = (await res.json()).exams;
}

async function loadExam(id) {
  if (examCache[id]) return examCache[id];
  const meta = MANIFEST.find((e) => e.id === id);
  if (!meta) throw new Error('לא נמצא מבחן: ' + id);
  const res = await fetch('exams/' + meta.file);
  if (!res.ok) throw new Error('exam ' + res.status);
  const data = await res.json();
  examCache[id] = data;
  return data;
}

/* ---------- ניקוד ----------
   מספר הנכונות נשמר ברשומה בזמן המענה, כדי שהספרייה תוכל להציג ציון
   לכל מבחן בלי לטעון את כל קבצי המבחנים. */
function quickScore(meta) {
  const rec = store.exam(meta.id);
  const entries = Object.values(rec.answers);
  return {
    answered: entries.length,
    correct: rec.correct != null ? rec.correct : 0,
    total: meta.count,
  };
}

/* ---------- ניווט ---------- */
function setNav(name) {
  document.querySelectorAll('.topnav a').forEach((a) => {
    a.classList.toggle('active', a.dataset.nav === name);
  });
}

// גלילה לראש הדף אחרי שהתוכן כבר בעמוד. חייב לרוץ אחרי הרינדור,
// אחרת הדפדפן משחזר את מיקום הגלילה הקודם מעל הפעולה הזאת.
function toTop() {
  requestAnimationFrame(() => window.scrollTo(0, 0));
}

function router() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [route, param] = hash.split('/');

  if (route === 'exam' && param) return renderExam(param);
  if (route === 'practice') return renderPractice();
  if (route === 'review') return renderReview();
  if (route === 'about') return renderAbout();
  return renderLibrary();
}

/* ================= דף הסבר ================= */
const SEEN_KEY = 'shichzurim.seenIntro';

function renderAbout() {
  setNav('about');
  view.innerHTML = '';
  localStorage.setItem(SEEN_KEY, '1');

  const head = el('div', 'page-head');
  head.append(el('h1', null, 'מה זה המקום הזה?'));
  head.append(el('p', null, 'דקה של קריאה, ואז אתה יודע להשתמש בכל מה שיש כאן.'));
  view.append(head);

  const sections = [
    {
      icon: '🧬',
      title: 'ארכיון שחזורים, לא עוד קובץ במחשב',
      body: 'כאן נאספים שחזורים של מבחנים מכל המקצועות של שנה א׳ — כל שאלה עם המסיחים שלה ' +
            'והתשובה הנכונה. במקום לחפש קבצים בוואטסאפ, הכול במקום אחד, ותמיד בגרסה העדכנית.',
    },
    {
      icon: '✍️',
      title: 'עונים, ומקבלים תשובה מיד',
      body: 'לוחצים על מסיח. התשובה הנכונה נצבעת ירוק, והשגויה אדום — מיד, בלי להמתין לסוף. ' +
            'אפשר גם פשוט להקיש על המקלדת 1, 2, 3 כדי לבחור. בסוף מקבלים ציון.',
    },
    {
      icon: '🎲',
      title: 'תרגול מעורב — החלק החשוב',
      body: 'זה שולף שאלות אקראיות מכמה מבחנים יחד. למה זה חשוב? כי כשפותרים את אותו מבחן ' +
            'פעם שלישית, המוח זוכר שהתשובה היא "השלישית" במקום לזכור את החומר. ערבוב שובר ' +
            'את זה, ומראה לך מה אתה באמת יודע.',
    },
    {
      icon: '🎯',
      title: 'הטעויות שלי',
      body: 'כל שאלה שטעית בה — בכל מבחן — נאספת לכאן לבד. זה הדף הכי שווה לחזור אליו לפני ' +
            'מבחן: הוא בדיוק רשימת החורים שלך, בלי הזמן שמבזבזים על מה שכבר ידעת.',
    },
    {
      icon: '🔒',
      title: 'ההתקדמות שלך היא שלך',
      body: 'הציונים והתשובות שלך נשמרים בדפדפן שלך בלבד, על המכשיר שלך. אף אחד אחר — כולל מי ' +
            'שהעלה את האתר — לא רואה אותם. אין הרשמה ואין סיסמה. שים לב: מכיוון שזה נשמר במכשיר, ' +
            'ההתקדמות מהמחשב לא תופיע בטלפון.',
    },
  ];

  sections.forEach((s) => {
    const c = el('div', 'about-card');
    const h = el('div', 'about-head');
    h.append(el('span', 'about-ico', s.icon));
    h.append(el('h3', null, s.title));
    c.append(h);
    c.append(el('p', null, s.body));
    view.append(c);
  });

  const cta = el('div', 'result');
  cta.append(el('div', 'sub', 'זהו. עכשיו פשוט תבחר מבחן ותתחיל.'));
  const row = el('div', 'btn-row');
  row.style.justifyContent = 'center';
  const go = el('a', 'btn primary', 'לספריית המבחנים');
  go.href = '#/';
  row.append(go);
  cta.append(row);
  view.append(cta);

  toTop();
  updateFooter();
}

/* באנר שמופיע פעם אחת בלבד, למי שנכנס לראשונה */
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
  skip.onclick = () => {
    localStorage.setItem(SEEN_KEY, '1');
    b.remove();
  };
  acts.append(skip);
  b.append(acts);
  return b;
}

/* ================= ספרייה ================= */
function renderLibrary() {
  setNav('library');
  view.innerHTML = '';

  const head = el('div', 'page-head');
  head.append(el('h1', null, 'ספריית השחזורים'));
  head.append(el('p', null, 'כל השחזורים והתרגולים במקום אחד. ההתקדמות נשמרת אוטומטית.'));
  view.append(head);

  const banner = introBanner();
  if (banner) view.append(banner);

  // לוח מחוונים
  let totalQ = 0, totalAnswered = 0, totalCorrect = 0;
  MANIFEST.forEach((m) => {
    const s = quickScore(m);
    totalQ += m.count;
    totalAnswered += s.answered;
    totalCorrect += s.correct;
  });
  const pct = totalAnswered ? Math.round((totalCorrect / totalAnswered) * 100) : 0;

  const dash = el('div', 'dash');
  dash.append(stat(MANIFEST.length, 'מבחנים בארכיון', 'accent'));
  dash.append(stat(totalQ, 'שאלות סה״כ'));
  dash.append(stat(totalAnswered, 'שאלות שענית'));
  dash.append(stat(totalAnswered ? pct + '%' : '—', 'אחוז הצלחה', pct >= 70 ? 'good' : totalAnswered ? 'bad' : ''));
  view.append(dash);

  // חיפוש
  const search = el('div', 'searchbar');
  const input = el('input');
  input.type = 'search';
  input.placeholder = 'חיפוש לפי מקצוע, שם מבחן או שנה…';
  search.append(input);
  view.append(search);

  const list = el('div');
  view.append(list);

  const draw = (filter) => {
    list.innerHTML = '';
    const q = (filter || '').trim().toLowerCase();
    const matches = MANIFEST.filter((m) =>
      !q ||
      [m.subject, m.title, m.year, KIND_LABEL[m.kind]].join(' ').toLowerCase().includes(q)
    );

    if (!matches.length) {
      list.append(emptyState('🔍', 'אין תוצאות', 'לא נמצא מבחן שמתאים לחיפוש.'));
      return;
    }

    const bySubject = {};
    matches.forEach((m) => (bySubject[m.subject] ||= []).push(m));

    for (const [subject, exams] of Object.entries(bySubject)) {
      const sec = el('section', 'subject');
      const sh = el('div', 'subject-head');
      sh.append(el('h2', null, subject));
      const n = exams.reduce((a, e) => a + e.count, 0);
      sh.append(el('span', 'pill', `${exams.length} מבחנים · ${n} שאלות`));
      sec.append(sh);

      const cards = el('div', 'cards');
      exams.forEach((m) => cards.append(examCard(m)));
      sec.append(cards);
      list.append(sec);
    }
  };

  input.addEventListener('input', () => draw(input.value));
  draw('');

  toTop();
  updateFooter();
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

function examCard(m) {
  const s = quickScore(m);
  const a = el('a', 'card');
  a.href = '#/exam/' + m.id;

  const top = el('div', 'card-top');
  top.append(el('h3', null, m.title));
  a.append(top);

  const meta = el('div', 'card-meta');
  meta.append(el('span', 'tag ' + m.kind, KIND_LABEL[m.kind] || m.kind));
  if (m.moed) meta.append(el('span', 'tag', `מועד ${m.moed}׳`));
  meta.append(el('span', 'tag', `${m.count} שאלות`));
  a.append(meta);

  const foot = el('div', 'card-foot');
  const bar = el('div', 'bar');
  const fill = el('i');
  const pct = s.answered ? (s.correct / s.answered) * 100 : 0;
  fill.style.width = s.answered ? Math.round((s.answered / m.count) * 100) + '%' : '0%';
  if (s.answered) fill.classList.add(pct >= 70 ? 'good' : 'bad');
  bar.append(fill);
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
  setNav('library');
  view.innerHTML = '<div class="empty"><span class="ico">⏳</span><b>טוען…</b></div>';

  let exam;
  try { exam = await loadExam(id); }
  catch (err) {
    view.innerHTML = '';
    view.append(emptyState('⚠️', 'לא הצלחתי לטעון את המבחן', String(err.message)));
    return;
  }

  playQuestions({
    key: exam.id,
    title: exam.title,
    subtitle: `${exam.subject}${exam.moed ? ' · מועד ' + exam.moed + '׳' : ''} · ${exam.questions.length} שאלות`,
    note: exam.note,
    questions: exam.questions,
    persist: true,
    backHref: '#/',
    backLabel: 'חזרה לספרייה',
  });
}

/* מנוע המשחק המשותף — משמש גם למבחן, גם לתרגול מעורב וגם לחזרה על טעויות */
function playQuestions(cfg) {
  const { key, title, subtitle, note, questions, persist, backHref, backLabel } = cfg;
  view.innerHTML = '';

  const rec = persist ? store.exam(key) : { answers: {} };
  // התקדמות זמנית לסשן שלא נשמר (תרגול מעורב)
  const answers = persist ? rec.answers : {};

  const head = el('div', 'page-head');
  head.append(el('h1', null, title));
  head.append(el('p', null, subtitle));
  view.append(head);

  if (note) {
    const n = el('div', 'q-note');
    n.textContent = note;
    n.style.marginBottom = '18px';
    view.append(n);
  }

  // סרגל התקדמות דביק
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
  const backBtn = el('a', 'btn ghost', backLabel);
  backBtn.href = backHref;
  bar.append(backBtn);
  view.append(bar);

  const qWrap = el('div');
  view.append(qWrap);

  const resultBox = el('div');
  view.append(resultBox);

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
    fill.className = answered ? (good / Math.max(answered, 1) >= 0.7 ? 'good' : 'bad') : '';

    if (persist) {
      store.save(key, { answers, correct: good, done: answered === questions.length, at: Date.now() });
    }

    resultBox.innerHTML = '';
    if (answered === questions.length) {
      const pct = Math.round((good / questions.length) * 100);
      const box = el('div', 'result');
      const grade = el('div', 'grade ' + (pct >= 80 ? 'good' : pct >= 60 ? 'mid' : 'bad'), pct + '%');
      box.append(grade);
      box.append(el('div', 'sub', `${good} נכונות מתוך ${questions.length}. ${
        pct >= 80 ? 'שליטה טובה בחומר.' : pct >= 60 ? 'יש בסיס, כדאי לחזור על הטעויות.' : 'שווה סבב נוסף על החומר.'
      }`));
      const row = el('div', 'btn-row');
      row.style.justifyContent = 'center';
      const again = el('button', 'btn primary', 'סבב נוסף');
      again.onclick = doReset;
      row.append(again);
      const rev = el('a', 'btn', 'לחזרה על הטעויות');
      rev.href = '#/review';
      row.append(rev);
      box.append(row);
      resultBox.append(box);
      resultBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
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

    card.append(el('div', 'q-num', `שאלה ${qi + 1} מתוך ${questions.length}`));
    card.append(el('div', 'q-text', item.q));

    if (item.origin) {
      const o = el('div', 'q-num', item.origin);
      o.style.color = 'var(--accent)';
      o.style.marginTop = '4px';
      card.append(o);
    }
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

    card.append(opts);
    card.append(fb);

    // אם כבר נענתה — צייר את המצב השמור
    if (answers[qi] != null) paint(qi, answers[qi], card, opts, fb, item);
    return card;
  }

  function choose(qi, oi, card, opts, fb, item) {
    if (answers[qi] != null) return; // כבר נענתה
    answers[qi] = oi;
    paint(qi, oi, card, opts, fb, item);
    refresh();

    // גלילה אוטומטית לשאלה הבאה שטרם נענתה
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
    fb.textContent = isRight
      ? '✓ נכון'
      : `✗ לא נכון — התשובה הנכונה: ${item.opts[item.a]}`;
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

/* ================= תרגול מעורב ================= */
function renderPractice() {
  setNav('practice');
  view.innerHTML = '';

  const head = el('div', 'page-head');
  head.append(el('h1', null, 'תרגול מעורב'));
  head.append(el('p', null, 'שאלות אקראיות מכמה מבחנים יחד — הדרך הטובה ביותר לבדוק אם באמת הפנמת.'));
  view.append(head);

  const subjects = [...new Set(MANIFEST.map((m) => m.subject))];
  const chosen = new Set(subjects);
  let count = 20;

  const form = el('div', 'form');

  // מקצועות
  const f1 = el('div', 'field');
  f1.append(el('label', null, 'מקצועות'));
  const chips = el('div', 'chips');
  subjects.forEach((s) => {
    const c = el('div', 'chip on', s);
    c.onclick = () => {
      if (chosen.has(s)) { chosen.delete(s); c.classList.remove('on'); }
      else { chosen.add(s); c.classList.add('on'); }
      updateInfo();
    };
    chips.append(c);
  });
  f1.append(chips);
  form.append(f1);

  // כמות
  const f2 = el('div', 'field');
  f2.append(el('label', null, 'כמה שאלות'));
  const cChips = el('div', 'chips');
  [10, 20, 30, 50, 0].forEach((n) => {
    const c = el('div', 'chip' + (n === 20 ? ' on' : ''), n === 0 ? 'הכול' : String(n));
    c.onclick = () => {
      count = n;
      cChips.querySelectorAll('.chip').forEach((x) => x.classList.remove('on'));
      c.classList.add('on');
      updateInfo();
    };
    cChips.append(c);
  });
  f2.append(cChips);
  form.append(f2);

  const info = el('p');
  info.style.cssText = 'color:var(--dim); font-size:13px; margin-bottom:18px;';
  form.append(info);

  const go = el('button', 'btn primary', 'התחל תרגול');
  form.append(go);
  view.append(form);

  function pool() {
    return MANIFEST.filter((m) => chosen.has(m.subject));
  }
  function updateInfo() {
    const p = pool();
    const total = p.reduce((a, m) => a + m.count, 0);
    info.textContent = p.length
      ? `בבריכה: ${total} שאלות מתוך ${p.length} מבחנים. ייבחרו ${count === 0 ? total : Math.min(count, total)} באקראי.`
      : 'בחר לפחות מקצוע אחד.';
    go.disabled = !p.length;
  }
  updateInfo();

  toTop();

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
      title: 'תרגול מעורב',
      subtitle: `${picked.length} שאלות אקראיות מתוך ${p.length} מבחנים`,
      questions: picked,
      persist: false,
      backHref: '#/practice',
      backLabel: 'תרגול חדש',
    });
  };

  updateFooter();
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* ================= הטעויות שלי ================= */
async function renderReview() {
  setNav('review');
  view.innerHTML = '<div class="empty"><span class="ico">⏳</span><b>אוסף את הטעויות…</b></div>';

  const saved = store.read();
  const wrong = [];

  for (const m of MANIFEST) {
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
    const head = el('div', 'page-head');
    head.append(el('h1', null, 'הטעויות שלי'));
    head.append(el('p', null, 'כאן נאספות כל השאלות שטעית בהן, מכל המבחנים.'));
    view.append(head);
    view.append(
      emptyState(
        '🎯',
        'אין טעויות לחזור עליהן',
        'או שעוד לא ענית על שאלות, או שענית נכון על הכול. פתח מבחן מהספרייה — כל שאלה שתטעה בה תופיע כאן אוטומטית.'
      )
    );
    toTop();
    updateFooter();
    return;
  }

  shuffle(wrong);
  playQuestions({
    key: 'review',
    title: 'הטעויות שלי',
    subtitle: `${wrong.length} שאלות שטעית בהן, מכל המבחנים`,
    note: 'התשובות כאן לא נשמרות — זה סבב חזרה. הטעויות המקוריות נשארות בספרייה עד שתאפס מבחן.',
    questions: wrong,
    persist: false,
    backHref: '#/',
    backLabel: 'חזרה לספרייה',
  });
}

/* ---------- כותרת תחתונה ---------- */
function updateFooter() {
  const n = MANIFEST.reduce((a, m) => a + m.count, 0);
  document.getElementById('footerStats').textContent =
    `${MANIFEST.length} מבחנים · ${n} שאלות · ההתקדמות נשמרת בדפדפן הזה בלבד`;
}

/* ---------- מקשי קיצור: 1-9 לבחירת תשובה בשאלה שבמוקד ---------- */
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.metaKey || e.ctrlKey) return;
  const n = parseInt(e.key, 10);
  if (!n || n < 1 || n > 9) return;

  // מצא את השאלה הראשונה שטרם נענתה ונמצאת בשדה הראייה
  const cards = [...document.querySelectorAll('.q:not(.done)')];
  const target = cards.find((c) => {
    const r = c.getBoundingClientRect();
    return r.top < window.innerHeight * 0.6 && r.bottom > 0;
  });
  if (!target) return;
  const opt = target.querySelectorAll('.opt')[n - 1];
  if (opt) opt.click();
});

/* ---------- הפעלה ---------- */
window.addEventListener('hashchange', router);

(async function init() {
  try {
    await loadManifest();
  } catch (err) {
    view.innerHTML = '';
    const e = emptyState(
      '⚠️',
      'לא הצלחתי לטעון את רשימת המבחנים',
      'אם פתחת את הקובץ ישירות מהמחשב (file://), הדפדפן חוסם קריאת קבצים. הרץ את start.command בתיקייה, או פתח את האתר מהכתובת המקוונת.'
    );
    view.append(e);
    return;
  }
  router();
})();
