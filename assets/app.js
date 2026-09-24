/* ===== ארכיון השחזורים — מנוע =====
   מבנה נתונים:
     exams/courses.json  — רשימת המקצועות
     exams/<id>.json     — מבחן: course (מקצוע), part (חלק בתוך המקצוע), questions
     exams/manifest.json — נבנה אוטומטית ע"י sync.js

   ניווט: מקצועות → מקצוע → מבחן.
   ההפרדה למקצועות היא הנקודה: כשלומדים אלקטרו, ביוכימיה לא אמורה להיות על המסך.
*/

const KEY = 'shichzurim.v1';
/* .v2 — אחרי הוספת החשבונות והסנכרון. שינוי המפתח מאפס את "כבר ראיתי":
   הבאנר והסיור המעודכנים מופיעים שוב, פעם אחת, לכל מי שכבר היה כאן. */
const SEEN_KEY = 'shichzurim.seenIntro.v2';
const THEME_KEY = 'shichzurim.theme';

/* המתג של "אתר סגור": כשדולק, כל האתר (חוץ מ"מה זה?") דורש התחברות.
   ההשקה דו-צעדית — קודם ההתחברות אופציונלית וכולם ממשיכים כרגיל, ורק אחרי
   שהסנכרון הוכח יציב על משתמשים אמיתיים הופכים את זה ל-true. קומיט של שורה
   אחת, בבוקר שקט, לא בערב מבחן. כיבוי חזרה = אותה שורה. */
const REQUIRE_LOGIN = true;
const KIND_LABEL = { shichzur: 'שחזור', practice: 'תרגול', highyield: 'High Yield', cards: 'מהמרצה', guide: 'מפת חומרים', case: 'מקרה מתגלגל', shinun: 'שננת' };
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
/* fem=true לשמות עצם נקביים. בלי זה יצא "שאלה אחד" — וזה כבר קרה בכרטיסיות
   ("לתרגול — שאלה אחד מהארכיון"). ברירת המחדל נשארת זכר, כך שכל קריאה קיימת
   מתנהגת בדיוק כמו קודם. */
const plural = (n, one, many, fem) => (n === 1 ? `${one} ${fem ? 'אחת' : 'אחד'}` : `${n} ${many}`);

/* נרמול לחיפוש: מסיר ניקוד וגרשיים, כי אף אחד לא מקליד אותם. היה מקומי
   לבורר התרגול; הועלה לכאן כדי שהחיפוש הגלובלי לא יהיה עותק חמישי של
   נרמול עברית בקובץ (כבר יש norm ב-repeats.js, shinunNorm, ואחד ב-rulingA).
   ⚠️ זה **לא** ה-norm שמייצר qid — אותו אסור לגעת, הוא מגבב את הארכיון. */
const searchNorm = (s) => (s || '').replace(/[֑-ׇ]/g, '').replace(/["'׳״`]/g, '').toLowerCase();

/* ---------- הקראה ----------
   speechSynthesis הוא חלק מהדפדפן: בלי שרת, בלי מפתח, ועובד אופליין. הקול
   העברי במק/אייפון הוא "כרמית" (יש גם גרסה משופרת), ושניהם מקומיים.

   ⚠️ אם אין קול עברי מותקן, הדפדפן ייפול לקול ברירת המחדל ויקרא עברית
   באנגלית — צליל ג׳יבריש. לכן בודקים שיש he לפני שמציעים את המצב בכלל. */
const speechOK = () => typeof window.speechSynthesis !== 'undefined';
let heVoice = null;
function pickHeVoice() {
  if (!speechOK()) return null;
  if (heVoice) return heVoice;
  const v = speechSynthesis.getVoices().filter((x) => /^he/i.test(x.lang));
  /* "משופר"/Enhanced קודם — אותו מנוע, איכות גבוהה יותר. */
  heVoice = v.find((x) => /משופר|enhanced|premium/i.test(x.name)) || v[0] || null;
  return heVoice;
}
if (speechOK()) speechSynthesis.onvoiceschanged = () => { heVoice = null; pickHeVoice(); };

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

function speak(text) {
  return new Promise((resolve) => {
    if (!speechOK() || !text) return resolve();
    const u = new SpeechSynthesisUtterance(String(text));
    const v = pickHeVoice();
    if (v) u.voice = v;
    u.lang = 'he-IL';
    u.rate = 0.95;
    /* גם onend וגם onerror פותרים: אחרת הקראה שנקטעה (ניווט, נעילת מסך)
       הייתה תוקעת את הלולאה לנצח. */
    u.onend = () => resolve();
    u.onerror = () => resolve();
    try { speechSynthesis.speak(u); } catch { resolve(); }
  });
}
function stopSpeech() { try { if (speechOK()) speechSynthesis.cancel(); } catch {} }

/* צ'יפ נבחר בעכבר בכל בוררי התרגול, ולכן קל היה לשכוח שהוא לא כפתור אמיתי:
   בלי תפקיד ובלי tabIndex אי אפשר להגיע אליו במקלדת בכלל. בסימולציות אותה
   מחלקה כן נוצרת כ-button (ראו s.toggles) — הפער הזה הוא הסיבה שזה נשמט.
   אין כאן aria-pressed בכוונה: מצב ה-on מתחלף דרך classList בשישה מקומות
   שונים, ותכונה שלא מסונכרנת גרועה מתכונה חסרה — היא משקרת לקורא המסך. */
const chipEl = (cls, txt, tip) => {
  const c = el('div', cls, txt);
  if (tip) c.title = tip;
  c.setAttribute('role', 'button');
  c.tabIndex = 0;
  c.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); c.click(); }
  });
  return c;
};

/* ═══════════════ שכבת התגמול — חגיגות, רצפים, פנייה אישית ═══════════════
   משוב דופמינרגי על הצלחה, כדי לתת כוח להמשיך לאורך שעות לימוד. העיקרון:
   הסלמה, לא חזרה — מיקרו-תגמול על כל תשובה נכונה, טוסט חוגג באבני-רצף,
   ופיצוץ מלא ברגעים הגדולים (שיא אישי, מבחן מושלם, כיסוי מקצוע).
   נשען על הפנייה האישית הקיימת (Cloud.user.firstName). הכל מכבד את מתג
   הכיבוי ואת prefers-reduced-motion, והצליל כבוי כברירת מחדל. */

const CELEBRATE_KEY = 'shichzurim.celebrate';   // דלוק כברירת מחדל
const SFX_KEY       = 'shichzurim.sfx';         // כבוי כברירת מחדל
const BEST_STREAK_KEY = 'shichzurim.bestStreak';
const MILESTONES_KEY  = 'shichzurim.milestones';

const prefOn = (key, dflt) => { const v = localStorage.getItem(key); return v == null ? dflt : v === '1'; };
const celebrateOn = () => prefOn(CELEBRATE_KEY, true);
const sfxOn = () => prefOn(SFX_KEY, false);
const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const firstName = () => window.Cloud?.user?.firstName || '';

const bestStreak = () => Number(localStorage.getItem(BEST_STREAK_KEY) || 0);
const setBestStreak = (n) => localStorage.setItem(BEST_STREAK_KEY, String(n));

/* אבני דרך שכבר נחגגו — כדי לירות פעם אחת בלבד, לתמיד. */
const milestoneHit = (id) => (localStorage.getItem(MILESTONES_KEY) || '').split('|').includes(id);
const markMilestone = (id) => {
  const s = new Set((localStorage.getItem(MILESTONES_KEY) || '').split('|').filter(Boolean));
  s.add(id);
  localStorage.setItem(MILESTONES_KEY, [...s].join('|'));
};

/* מאגרי הודעות מתחלפות, בטעם רפואי. {name} מוזרק אם יש שם, אחרת נופל בחן. */
const STREAK_LINES = {
  low:  ['אבחנה מדויקת! 🎯', 'רפלקס מהיר ⚡', 'דופק חזק 💓', 'ישר בול 🎯', 'יפה, {name}! 👏', 'קולע/ת 💪'],
  mid:  ['על גל, {name}! 🔥', 'בלתי עציר/ה 🚀', 'המוח מפריש דופמין — וגם אנחנו 🧠', 'רצף חם! 🔥', 'שולט/ת בחומר, {name}! 💪'],
  high: ['וירטואוז/ית, {name}! 🩺', 'רצף מפלצתי 🐉', 'אין עליך, {name}! 👑', 'פרופסור/ית כבר עכשיו 🎓', 'על אש! 🔥🔥'],
};
const BEST_LINES = ['שיא אישי חדש! 🏆', 'שברת את השיא שלך, {name}! 🏆', 'הכי טוב שהיה לך אי פעם 🥇'];

const formatLine = (line, name) =>
  name
    ? line.replace(/\{name\}/g, name)
    : line.replace(/\{name\}\s*,\s*/g, '').replace(/[,\s]*\{name\}/g, '').replace(/\s{2,}/g, ' ').trim();

const _lastLine = {};
function pickLine(poolName, pool, name) {
  let idx, tries = 0;
  do { idx = Math.floor(Math.random() * pool.length); }
  while (pool.length > 1 && idx === _lastLine[poolName] && ++tries < 6);
  _lastLine[poolName] = idx;
  return formatLine(pool[idx], name);
}

/* אבני-רצף. מתחת ל-3 אין טוסט (רק הפיל מתקדם); מעל 20 כל 5. */
const STREAK_TIERS = [3, 5, 8, 12, 16, 20];
const isStreakMilestone = (n) => STREAK_TIERS.includes(n) || (n > 20 && n % 5 === 0);
const streakTier = (n) => (n >= 12 ? 'high' : n >= 5 ? 'mid' : 'low');

/* --- קונפטי: CSS בלבד, בלי ספרייה ובלי canvas. מושתק ב-reduced-motion. --- */
function confettiBurst(n = 16) {
  if (reduceMotion()) return;
  const box = el('div', 'confetti');
  const colors = ['var(--good)', 'var(--accent)', 'var(--warn)', 'var(--topic-tx)', 'var(--bad)'];
  for (let i = 0; i < n; i++) {
    const p = el('i');
    p.style.setProperty('--x', (Math.random() * 2 - 1).toFixed(2));
    p.style.setProperty('--r', Math.floor(Math.random() * 720 - 360) + 'deg');
    p.style.setProperty('--d', (0.9 + Math.random() * 0.7).toFixed(2) + 's');
    p.style.setProperty('--delay', (Math.random() * 0.12).toFixed(2) + 's');
    p.style.background = colors[i % colors.length];
    p.style.left = (44 + Math.random() * 12) + '%';
    box.append(p);
  }
  document.body.append(box);
  setTimeout(() => box.remove(), 2100);
}

/* --- צליל מסונתז ב-WebAudio, בלי קובץ נכס. רק אם הודלק במפורש. --- */
let _actx;
function blip(kind) {
  if (!sfxOn()) return;
  try {
    _actx = _actx || new (window.AudioContext || window.webkitAudioContext)();
    const ctx = _actx;
    if (ctx.state === 'suspended') ctx.resume();   // דפדפנים פותחים אותו רדום עד מחווה
    const now = ctx.currentTime;
    const notes = kind === 'big' ? [523.25, 659.25, 783.99] : [659.25, 987.77];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      const t = now + i * 0.075;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.14, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0008, t + 0.22);
      o.connect(g); g.connect(ctx.destination);
      o.start(t); o.stop(t + 0.24);
    });
  } catch { /* דפדפן בלי WebAudio — פשוט בלי צליל */ }
}

/* --- הטוסט החוגג. לא חוסם, מכריז לקורא-מסך, מתחלף אם עוד מוצג. --- */
let _toastTimer;
function celebrate({ line, sub, tier = 'mid', confetti = 0, sound = 'pop' }) {
  if (!celebrateOn()) return;
  if (sound) blip(sound);
  if (confetti) confettiBurst(confetti);

  document.querySelector('.cheer')?.remove();
  clearTimeout(_toastTimer);
  const t = el('div', 'cheer t-' + tier);
  t.setAttribute('role', 'status');
  t.setAttribute('aria-live', 'polite');
  t.append(el('div', 'cheer-line', line));
  if (sub) t.append(el('div', 'cheer-sub', sub));
  document.body.append(t);
  requestAnimationFrame(() => t.classList.add('in'));
  _toastTimer = setTimeout(() => {
    t.classList.remove('in');
    setTimeout(() => t.remove(), 320);
  }, tier === 'high' ? 2600 : 1900);
}

function celebrateStreak(streak) {
  const name = firstName(), tier = streakTier(streak);
  celebrate({
    line: pickLine(tier, STREAK_LINES[tier], name),
    sub: `${streak} ברצף 🔥`,
    tier,
    confetti: tier === 'high' ? 28 : tier === 'mid' ? 16 : 8,
    sound: tier === 'high' ? 'big' : 'pop',
  });
}

function celebrateBest(streak) {
  celebrate({
    line: pickLine('best', BEST_LINES, firstName()),
    sub: `${streak} ברצף — הכי הרבה שהיה לך`,
    tier: 'high', confetti: 32, sound: 'big',
  });
}

/* אבן דרך: כיסית את כל שאלות המקצוע. נבדק מול המפה הגלובלית של seen,
   ונחגג פעם אחת בלבד לתמיד (markMilestone). m = {courseId, courseName, total, qids}. */
function checkCourseMilestone(m) {
  if (!m || !m.total) return;
  const id = `${m.courseId}:cov100`;
  if (milestoneHit(id)) return;
  const map = seenH.read();
  const done = m.qids.filter((k) => seenH.has(k, map)).length;
  if (done < m.total) return;
  markMilestone(id);
  const name = firstName();
  celebrate({
    line: `🎓 כיסית את כל ${m.courseName}${name ? ', ' + name : ''}!`,
    sub: `${m.total} שאלות — ראית את כולן`,
    tier: 'high', confetti: 36, sound: 'big',
  });
}

/* חגיגת סיום סבב — נקראת ממסך התוצאה על ציון גבוה. */
function celebrateResult(pct, scoredCount, name) {
  if (pct < 90) return;
  const perfect = pct === 100 && scoredCount >= 5;
  celebrate({
    line: perfect
      ? (name ? `מושלם, ${name}! 💯` : 'מושלם! 💯')
      : (name ? `כמעט מושלם, ${name}! 🌟` : 'כמעט מושלם! 🌟'),
    sub: `${pct}% בסבב הזה`,
    tier: 'high', confetti: perfect ? 40 : 26, sound: 'big',
  });
}

/* מתגי שליטה לסרגל הנגן: צליל (כבוי כברירת מחדל) וכיבוי כללי. */
function rewardToggles() {
  const wrap = el('div', 'reward-toggles');
  const mk = (key, dflt, on, off, title) => {
    const b = el('button', 'bar-toggle');
    const sync = () => { const v = prefOn(key, dflt); b.textContent = v ? on : off; b.title = title + (v ? ' — דלוק' : ' — כבוי'); b.setAttribute('aria-pressed', String(v)); };
    b.onclick = () => { localStorage.setItem(key, prefOn(key, dflt) ? '0' : '1'); sync(); };
    sync();
    return b;
  };
  wrap.append(mk(SFX_KEY, false, '🔔', '🔕', 'צליל'));
  wrap.append(mk(CELEBRATE_KEY, true, '🎉', '😴', 'חגיגות'));
  return wrap;
}

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
  /* עטוף, כמו shinunCeleb. הכתיבה הזאת יושבת על הנתיב החם של המענה, ודפדפן
     שקרוב למכסת האחסון (או גלישה פרטית) זורק QuotaExceededError — שהיה
     מתפוצץ בתוך choose() ושובר את הלחיצה עצמה. עדיף לאבד שמירה מלאבד מענה;
     הענן ממילא מקבל את אותו ערך בנפרד. */
  write(d) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch {} },
  exam(id) { return this.read()[id] || { answers: {} }; },
  save(id, rec) { const d = this.read(); d[id] = rec; this.write(d); window.Cloud?.queue('progress', id, rec); },
  reset(id) { const d = this.read(); delete d[id]; this.write(d); window.Cloud?.queueDelete('progress', id); },
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

/* ---------- קושי המחזור ----------
   qid → {n: כמה ענו, w: אצל כמה המצב האחרון שגוי}. אגרגט אנונימי מהענן
   (מיגרציה 0009), עם רצפת 10 עונים בשרת. נטען פעם אחת בעצלתיים; כשאין
   ענן/מיגרציה/התחברות — נשאר null וכל שכבת ה-UI פשוט לא מופיעה. */
let COHORT = null, cohortAsked = false;
function loadCohort(onReady) {
  if (COHORT || cohortAsked || !window.Cloud || !window.Cloud.cohortStats) {
    if (COHORT && onReady) onReady();
    return;
  }
  cohortAsked = true;
  window.Cloud.cohortStats().then((map) => {
    if (map && Object.keys(map).length) {
      COHORT = map;
      if (onReady) onReady();
    }
  }).catch(() => {});
}
/* שאלה "קשה למחזור": לפחות שליש מהעונים עדיין טועים בה. */
const cohortHard = (q) => {
  const s = COHORT && q.qid && COHORT[q.qid];
  return !!(s && s.n >= 10 && s.w / s.n >= 0.35);
};

const seen = {
  read() {
    try { return JSON.parse(localStorage.getItem(SEEN_Q_KEY)) || {}; }
    catch { return {}; }
  },
  write(d) { try { localStorage.setItem(SEEN_Q_KEY, JSON.stringify(d)); } catch {} },
  /* כותב לשתי המפות. הכפילות מכוונת ולזמן קצוב: כל עוד היא כאן, החזרה
     לגרסה קודמת של app.js לא מאבדת את העובדה שענית — הקוד הישן ימשיך לקרוא
     את המפה הישנה וימצא אותה מלאה. להסיר בשחרור שאחרי, לא לפני. */
  mark(item, correct, chosen) {
    if (item.examId == null || item.idx == null) return;
    const d = this.read();
    d[qKey(item)] = correct ? 1 : 0;
    this.write(d);
    window.Cloud?.queue('seen', qKey(item), correct ? 1 : 0);
    seenH.mark(item, correct, chosen);
  },
  status(item) { return this.read()[qKey(item)]; },  // undefined | 0 | 1
  clear() {
    localStorage.removeItem(SEEN_Q_KEY); window.Cloud?.queueClear('seen');
    seenH.clear();
  },
};

/* ---------- היסטוריית מענה לכל שאלה ----------

   המפה שלמעלה יודעת דבר אחד: "בפעם האחרונה צדקת או טעית". זה מספיק כדי לצבוע
   שאלה, ולא מספיק לשום דבר אחר — היא לא יודעת מתי זה היה, כמה פעמים ניסית,
   ואיזו תשובה שגויה בחרת. משלוש החוסרים האלה נובעים שני עיוותים אמיתיים:
   "הטעויות שלי" מתרוקן אחרי נכונה אחת (גם אם מלפני שלושה שבועות), ומד השליטה
   מטפס ל-100% למי שגמר סבב, גם אם שכח הכול.

   ⚠️ מפתח חדש, ולא שדרוג של הישן — וזו ההחלטה הכי חשובה כאן.
   שתי הצורות היו נפגשות בענן: משתמש עם app.js מהמטמון מעלה `1` לשורה שכבר
   מכילה אובייקט, `winner('seen')` מחזיר `1`, ו-writeLS דורס את ההיסטוריה
   במספר. אובדן שקט, דווקא במכשיר שכבר עבר מיגרציה. עם מפתח נפרד אין חלון
   צורות מעורבות בכלל, הקוד הישן ממשיך לקרוא מפה שלא נגענו בה, ו-rollback של
   app.js חוזר לעבוד מלא. המחיר — שתי מפות במקביל — נסבל (~35KB). */
const SEENH_KEY = 'shichzurim.seenH';
/* מתי שווה לחזור, לפי התיבה. קצר בכוונה, מאותה סיבה שמרווחי השינון קצרים:
   המבחן בעוד ימים, לא חודשים. */
const SEENH_IVL  = [0, 6 * 3600e3, 24 * 3600e3, 3 * 24 * 3600e3];
/* כמה מהר הידיעה דועכת, לפי התיבה. תיבה גבוהה = זיכרון עמיד יותר. */
const SEENH_HALF = [6 * 3600e3, 24 * 3600e3, 3 * 24 * 3600e3, 7 * 24 * 3600e3];

/* מטמון קריאה. בלעדיו masteryOf עושה JSON.parse בתוך עצמו, priorityList קורא
   לו לכל יחידה (~30 פרסורים בכל רינדור של המפה), ו-filtered() פרסר בכל הקלדה
   בשדה החיפוש. הרשומה החדשה גדולה יותר מהישנה, אז זה עובר מ"בזבוז" ל"מורגש". */
let seenHCache = null;

const seenH = {
  read() {
    if (seenHCache) return seenHCache;
    try { seenHCache = JSON.parse(localStorage.getItem(SEENH_KEY)) || {}; }
    catch { seenHCache = {}; }
    return seenHCache;
  },
  write(d) {
    seenHCache = d;
    try { localStorage.setItem(SEENH_KEY, JSON.stringify(d)); } catch {}
  },
  drop() { seenHCache = null; },     // אחרי מיזוג ענן או כתיבה מטאב אחר

  /* ערך שאינו אובייקט — מגיבוי שהודבק, או משורת ענן שנכתבה בגרסה אחרת —
     נקרא כניסיון בודד. הכשל היחיד שהצורה הזאת יכולה לייצר הוא רשומה דלה,
     לא זבל. */
  rec(k, d) {
    const v = (d || this.read())[k];
    if (v == null) return null;
    if (typeof v === 'number') return { b: v ? 1 : 0, n: 1, w: v ? 0 : 1, f: v ? 1 : 0 };
    return v;
  },
  has(k, d) { return this.rec(k, d) != null; },

  /* b = תיבת לייטנר 0–3. שדה אחד בשני תפקידים: גם לוח הזמנים של החזרה, וגם
     "כמה נכונות ברצף מאז הכשל האחרון" — כי נכון מעלה ב-1 וטעות מאפסת. לכן
     b>=2 הוא בדיוק "שתי נכונות ברצף", שזה כלל הגמילה מרשימת הטעויות.
     f נרשם רק בניסיון הראשון ולא זז אחר כך — הוא הרכיב היחיד שהופך את מד
     השליטה לכן, כי מי שצדק רק בסבב השני לא באמת ידע.
     c = המסיח האחרון שנבחר בטעות. זה מה שמאפשר "אתה מחליף בין X ל-Y" במקום
     "טעית". נשמר רק כשטועים — בתשובה נכונה אין מה ללמוד ממנה. */
  mark(item, correct, chosen) {
    const k = qKey(item);
    const d = this.read();
    const p = this.rec(k, d);
    const rec = {
      b: correct ? Math.min(3, (p ? p.b : 0) + 1) : 0,
      t: Date.now(),
      n: (p ? p.n : 0) + 1,
      w: (p ? p.w : 0) + (correct ? 0 : 1),
      f: p ? p.f : (correct ? 1 : 0),
    };
    if (!correct && typeof chosen === 'number') rec.c = chosen;
    else if (p && p.c != null) rec.c = p.c;
    d[k] = rec;
    this.write(d);
    window.Cloud?.queue('seenH', k, rec);
  },

  /* פריט שלא נראה מעולם נחשב בשל — "לא יודעים" זו סיבה לחזור, לא להימנע.
     חסר t (רשומה מהמיגרציה) — גם כן בשל, מאותה סיבה בדיוק. */
  due(k, now, d) {
    const r = this.rec(k, d);
    if (!r) return true;
    if (!r.t) return true;
    return (now - r.t) >= SEENH_IVL[Math.min(3, r.b)];
  },

  /* כמה אתה יודע את זה *עכשיו*, בין 0 ל-1. הזיכרון דועך, ולכן גם המדד.
     רשומה בלי t מקבלת מקדם ניטרלי 0.75 ולא 0: אין לנו נתון על מתי היא נענתה,
     ולהעניש על חוסר ידיעה שלנו זה להציג לכל המשתמשים קריסה מדומה בבוקר
     שאחרי המיגרציה. */
  strength(r, now) {
    if (!r || !r.n) return 0;
    const fresh = r.t ? Math.pow(0.5, (now - r.t) / SEENH_HALF[Math.min(3, r.b)]) : 0.75;
    return (r.b / 3) * fresh;
  },

  /* טעות פתוחה = טעית בה, ועוד לא נגמלת. הגמילה דורשת שתי נכונות ברצף ולא
     אחת — נכונה אחת אחרי טעות היא לא ראיה לידיעה, וזה בדיוק ה-leech שברח. */
  isOpenMistake(r) { return !!(r && r.w > 0 && r.b < 2); },

  clear() {
    seenHCache = null;
    localStorage.removeItem(SEENH_KEY);
    window.Cloud?.queueClear('seenH');
  },
};

/* ---------- "לחזור לזה" ----------
   סימון אישי לשאלה. מפה נפרדת ולא שדה בתוך seenH, ובכוונה: כלל המיזוג של
   seenH הוא max(n) — מי שענה יותר מנצח — וסימון שנעשה במכשיר שלא ענה היה
   נבלע. מרחב משלו מקבל כלל משלו: הפעולה האחרונה קובעת, כך שגם ביטול סימון
   מתפשט (ולא רק סימון, כמו במפת ה"נראו").

   ⚠️ מרחב flag ייכנס למסד רק כשמיגרציה 0004 תרוץ. עד אז Postgres דוחה,
   וההקשחה של flush זורקת את הפעולה — הסימון נשאר מקומי ושום סנכרון אחר
   לא נפגע. */
const FLAG_KEY = 'shichzurim.flag';
const flags = {
  read() { try { return JSON.parse(localStorage.getItem(FLAG_KEY)) || {}; } catch { return {}; } },
  write(d) { try { localStorage.setItem(FLAG_KEY, JSON.stringify(d)); } catch {} },
  has(k) { return !!this.read()[k]; },
  toggle(k) {
    const d = this.read();
    if (d[k]) { delete d[k]; this.write(d); window.Cloud?.queueDelete('flag', k); return false; }
    d[k] = 1; this.write(d); window.Cloud?.queue('flag', k, 1);
    return true;
  },
};

/* ---------- נתונים ---------- */
let COURSES = [];
let EXAMS = [];
let VERSION = '';
const cache = {};

/* צבע-זהות לכל מקצוע — נגזר מ-courses.json (השדה accent) ומוזרק כ-CSS פעם אחת
   באתחול. משתמשים בכללי [data-course] ולא ב-style inline כדי ששני דברים יעבדו
   מעצמם: החלפת light/dark בזמן ריצה, ושימוש באותו צבע גם על עמוד שלם וגם על
   כרטיס בודד (מספיק לתלות data-course על אלמנט עוטף). ברירת המחדל בטוקנים היא
   --accent הגלובלי, אז מקצוע בלי accent פשוט נראה כמו קודם. */
function injectCourseAccents(courses) {
  const rules = [];
  (courses || []).forEach((c) => {
    const a = c.accent;
    if (!a || !Array.isArray(a.light)) return;
    const [lb, ld, ls] = a.light;
    rules.push(`[data-course="${c.id}"]{--course-accent:${lb};--course-accent-dk:${ld};--course-accent-sl:${ls};}`);
    if (Array.isArray(a.dark)) {
      const [db, dd, ds] = a.dark;
      rules.push(`:root[data-theme="dark"] [data-course="${c.id}"]{--course-accent:${db};--course-accent-dk:${dd};--course-accent-sl:${ds};}`);
    }
  });
  let tag = document.getElementById('course-accents');
  if (!tag) { tag = document.createElement('style'); tag.id = 'course-accents'; document.head.append(tag); }
  tag.textContent = rules.join('\n');
}

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
  injectCourseAccents(COURSES);
  /* אינדקס האנקי (כ-1KB) נטען כאן ולא בדף האנקי, כי הקישור בעמוד הקורס
     מוצג רק כשיש חפיסה — ובלי טעינה מוקדמת הוא היה חסר בכניסה הראשונה. */
  ankiIndex();

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
  /* גם cloud.js נחתם ומושווה — עדכון בלוגיקת הסנכרון חייב להגיע לכולם. */
  const freshCloud = m.assets && m.assets.cloud;
  let curCloud = '';
  try {
    const sc = document.querySelector('script[src*="cloud.js"]');
    if (sc) curCloud = new URL(sc.src, location.href).searchParams.get('v') || '';
  } catch { /* התעלם */ }
  const jsStale = BUILD && freshJs && freshJs !== BUILD;
  const cssStale = curCss && freshCss && freshCss !== curCss;
  const cloudStale = curCloud && freshCloud && freshCloud !== curCloud;
  const stampKey = 'reloadedFor:' + freshJs + ':' + freshCss + ':' + (freshCloud || '');
  if ((jsStale || cssStale || cloudStale) && !sessionStorage.getItem(stampKey)) {
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
  migrateSeenH(data);   // אחרי הראשונה — היא צריכה מפה שכבר עברה נרמול idx→qid
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
  const moved = [];   // המיגרציה כותבת דרך write ההמוני, לא דרך mark — הענן צריך לשמוע עליה בנפרד
  exam.questions.forEach((q, i) => {
    const old = `${exam.id}#${i}`;
    if (!q.qid || d[old] === undefined) return;
    if (d[q.qid] === undefined) d[q.qid] = d[old];
    delete d[old];
    moved.push({ qid: q.qid, val: d[q.qid], old });
  });
  if (moved.length) {
    seen.write(d);
    moved.forEach((m) => {
      window.Cloud?.queue('seen', m.qid, m.val);
      window.Cloud?.queueDelete('seen', m.old);
    });
  }
}

/* מ"מה ראית" ל"מה קרה". יושבת כאן ולא באתחול, מאותה סיבה בדיוק שקודמתה
   יושבת כאן: רק בטעינת מבחן יש ביד את השאלות עצמן.

   שלושה הבדלים מ-migrateSeen, וכולם מכוונים:
   1. היא **לא מוחקת** מהמפה הישנה. הישנה נשארת כתיבה חוקית של כל טאב שעוד רץ
      על קוד מהמטמון, וגם תיבת דואר נכנס: תשובה שנרשמה שם אחרי המיגרציה
      תיקלט בטעינה הבאה.
   2. אין דגל גרסה — האידמפוטנטיות היא מזה שהיא כותבת רק לתא ריק.
   3. **בלי t.** אין שום נתון על מתי השאלה נענתה. t=עכשיו הוא שקר שמנפח את
      מד השליטה, ו-t=0 הוא שקר שמרסק אותו — וכל המשתמשים היו רואים בבוקר
      שההתקדמות שלהם "נעלמה". חסר t מטופל במפורש ב-due ו-strength. */
function migrateSeenH(exam) {
  if (!Array.isArray(exam.questions)) return;
  const old = seen.read();
  const d = seenH.read();
  const moved = [];
  exam.questions.forEach((q, i) => {
    const k = q.qid || `${exam.id}#${i}`;
    if (d[k] !== undefined) return;              // כבר הוגר — לא נוגעים
    const v = old[k];
    if (v === undefined) return;
    d[k] = v ? { b: 1, n: 1, w: 0, f: 1 } : { b: 0, n: 1, w: 1, f: 0 };
    moved.push(k);
  });
  if (moved.length) {
    seenH.write(d);
    moved.forEach((k) => window.Cloud?.queue('seenH', k, d[k]));
  }
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
const NOT_QUIZ = new Set(['cards', 'guide', 'case', 'shinun', 'keyer']);
const quizzesOf = (courseId) => examsOf(courseId).filter((e) => !NOT_QUIZ.has(e.kind));

/* ---------- תתי-קורסים: מקצועות בתוך מבחן בלוק ----------

   עקרונות המדע א׳/ב׳ הם מבחן אחד כל אחד, אבל ארבעה מקצועות נלמדים בו
   במקביל. ינון (23/09/2026): „לפתוח קורסי משנה לכל אחד מהקורסים, ולא
   שהכל יהיה ביחד — אבל שתהיה אופציה לתרגול ׳מבחן׳ של כל הבלוק”.

   ההכרעה: הקורס נשאר יחידת הדאטה (מועדים, סימולציה, חזרות, היסטוריה),
   והמקצוע הוא *תצוגה* עליו — `subjects[]` בכרטיס. מקצוע = כל המבחנים
   שה-`part` שלהם הוא המקצוע, וכל הנושאים שב-`topics` שלו. אף שאלה לא זזה
   ואף qid לא משתנה, ולכן ההתקדמות של כולם שורדת כמו שהיא.

   בראוטים של כלים (תרגול, טעויות, סימולציה, מפה) היקף מקצוע נכתב כ-`@key`
   בפרמטר השני — שם יכול לשבת גם שם נושא, וה-@ מבדיל ביניהם. */
const subjectsOf = (c) => (c && c.subjects) || [];
const subjectOf = (courseId, key) =>
  (key && subjectsOf(courseOf(courseId)).find((s) => s.key === key)) || null;
const subjectOfTopic = (courseId, topic) =>
  subjectsOf(courseOf(courseId)).find((s) => (s.topics || []).includes(topic)) || null;
/* '@immuno' → 'immuno'; כל דבר אחר (נושא, ריק) → null */
const scopeKey = (sub) => (sub && sub.startsWith('@') ? decodeURIComponent(sub.slice(1)) : null);
const examsOfSubject = (courseId, s) => examsOf(courseId).filter((e) => e.part === s.part);
/* חלקו של המקצוע בסימולציית הבלוק: המכסה שלו, וזמן יחסי לזמן המבחן. */
function subjectSim(c, s) {
  const se = c && c.simExam;
  const n = se && se.blocks && se.blocks[s.block];
  if (!n) return null;
  return { questions: n, minutes: Math.round((se.minutes * n) / se.questions), blocks: { [s.block]: n } };
}
/* הלומדה של נושא: של המקצוע שלו, אם יש לו לומדה משלו; אחרת של הקורס.
   כך טעות בתרגול, תוצאת חיפוש ועץ הידע קופצים לפרק בלומדה הנכונה. */
function studyDocFor(courseId, topic) {
  const s = subjectOfTopic(courseId, topic);
  if (s && s.studyDoc) return s.studyDoc;
  const c = courseOf(courseId);
  return (c && c.studyDoc) || null;
}

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

/* ---------- מתי מקצוע נכנס לארכיון ----------

   הקיבוץ לפי שנה/סמסטר ומדף הארכיון היו בנויים מזמן, ומעולם לא עשו כלום:
   הפילטר חיפש `status === 'archived'` — ערך שאינו חוקי בסכימה בכלל (מותר
   active/done/soon). כלומר המדף לא יכול היה להתמלא, וכל הקורסים נערמו
   בשורה אחת.

   התיקון גם עונה על „מי יתחזק את זה”: אף אחד. הארכוב נגזר מהתאריכים שכבר
   קיימים — מקצוע יורד מהחזית כשעברו שבועיים מהמועד האחרון שלו. `status`
   נשאר כעקיפה ידנית לשני המקרים שהתאריך לא יודע עליהם: `soon` (הקורס טרם
   התחיל) ו-`done` (נגמר, בלי קשר למה שכתוב בתאריכים).

   שבועיים ולא יום: מי שניגש למועד ב׳ עדיין חוזר על החומר בימים שאחריו. */
const ARCHIVE_GRACE_MS = 14 * 24 * 3600e3;

function lastExamAt(course) {
  const ts = (course.dates || []).map((d) => new Date(d.at).getTime()).filter((t) => !Number.isNaN(t));
  return ts.length ? Math.max(...ts) : null;
}

function isArchived(course) {
  if (course.status === 'done') return true;
  if (course.status === 'soon') return false;
  const last = lastExamAt(course);
  return last != null && Date.now() > last + ARCHIVE_GRACE_MS;
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
  return progressOf(quizzesOf(courseId));
}
/* אותה ספירה על רשימה כלשהי — משמשת גם את עמוד המקצוע בתוך בלוק. */
function progressOf(metas) {
  let answered = 0, correct = 0, total = 0;
  // כרטיסיות קריאה אינן שאלות — לא נספרות בהתקדמות ובאחוז ההצלחה.
  metas.filter((e) => !NOT_QUIZ.has(e.kind)).forEach((e) => {
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
  stopSpeech();   // הקראה ששרדה ניווט הייתה ממשיכה לדבר על עמוד אחר
  delete view.dataset.course;  // איפוס scope-הצבע; כל רנדרר ממוקד-מקצוע קובע אותו מחדש
  const [route, param, sub] = location.hash.replace(/^#\/?/, '').split('/');
  /* שער הכניסה של האתר הסגור. "מה זה?" נשאר פתוח — שאפשר יהיה להבין מה
     האתר לפני שמתחברים. כשהענן כבוי (קונפיג ריק / file://) אין את מי לשאול
     מי מחובר, אז השער לא נאכף — האתר לא ננעל בטעות על עצמו. */
  if (REQUIRE_LOGIN && window.Cloud?.enabled && !window.Cloud.user && route !== 'about') return renderLogin();
  /* מעקב אגרגטיבי: אירוע צפייה על הנתיבים המשמעותיים. הפרמטר (מזהה קורס/מבחן/
     סימולציה) הוא ה-target. דה-דופ ושתיקה-כשמנותק חיים ב-Cloud.track עצמו. */
  if (['course','exam','sim','drill','practice','review','guide','traps','shinun','cards','case','keyer','formulas','sheet','simexam','survey','ecg'].includes(route)) {
    window.Cloud?.track('view', param ? `${route}:${param}` : route);
  }
  /* חזרה לכתובת שממנה נפתח סבב חי — מנגנים אותו מחדש במקום לצייר את הבורר
     מאפס. חייב לרוץ אחרי המעקב (זו עדיין צפייה) ולפני כל רנדרר. */
  if (resumeRound(location.hash)) return;

  if (route === 'admin') return renderAdmin();
  if (route === 'account') return renderAccount();
  if (route === 'survey') return renderSurvey();
  // #/course/<id>/<מקצוע> — עמוד מקצוע בתוך מבחן בלוק (subjects בכרטיס)
  if (route === 'course' && param) return renderCourse(param, sub ? decodeURIComponent(sub) : null);
  // #/guide/<course>/<topic> — קופץ ישר ליחידה (מגיע מכפתור "איפה ללמוד" שבמשוב)
  if (route === 'guide' && param) return renderGuide(param, sub ? decodeURIComponent(sub) : null);
  if (route === 'cards' && param) return renderCards(param);
  // #/shinun/<course>?topic=<נושא> — מסך השינון, אופציונלית מסונן לנושא
  if (route === 'shinun' && param) return renderShinun(param, sub ? decodeURIComponent(sub) : null);
  // #/case/<id>/<caseId> — קופץ ישר למקרה מסוים בתוך הדק
  if (route === 'case' && param) return renderCase(param, sub ? decodeURIComponent(sub) : null);
  // #/keyer/<id>/<itemId> — מפתח ההגדרה: משחק זיהוי ברמזים; עם itemId קופץ לתיק מסוים
  if (route === 'keyer' && param) return renderKeyer(param, sub ? decodeURIComponent(sub) : null);
  if (route === 'sim' && param) return renderSim(param);
  // #/ecg/<mode> — מעבדת אק״ג (זיהוי; מעבדה ומדידה יתווספו)
  if (route === 'ecg') return renderEcgLab(param || 'id');
  // #/simexam/<course> — סימולציית מבחן מלאה: N שאלות, טיימר, משוב רק בסוף
  if (route === 'simexam' && param) return renderSimExam(param, scopeKey(sub));
  if (route === 'drills' && param) return renderDrills(param);
  if (route === 'drill' && param) return renderDrill(param);
  if (route === 'formulas' && param) return renderFormulas(param, sub ? decodeURIComponent(sub) : null);
  // #/sheet/<course> — דף הנוסחאות הרשמי, לעיון מחוץ לתרגול
  if (route === 'sheet' && param) return renderSheet(param);
  // #/anki/<course> — חפיסות אנקי להורדה
  if (route === 'anki' && param) return renderAnki(param);
  // #/exam/<id>/<qi> — קופץ ישר לשאלה מסוימת (מגיע מקישורי התרגול שבכרטיסיות)
  if (route === 'exam' && param) return renderExam(param, sub != null ? Number(sub) : null);
  // #/practice/<course>/<topic> — נושא מכוון מראש, מגיע מעמוד סימולציה
  if (route === 'practice' && param) return renderPractice(param, sub ? decodeURIComponent(sub) : null);
  if (route === 'review' && param) return renderReview(param, scopeKey(sub));
  if (route === 'traps' && param) return renderTraps(param);
  if (route === 'tree' && param) return renderTree(param);
  if (route === 'semester' && param) return renderSemester(param);
  if (route === 'q' && param) return renderOneQuestion(param);
  if (route === 'tonight' && param) return renderTonight(param);
  if (route === 'flagged' && param) return renderFlagged(param);
  if (route === 'about') return renderAbout();
  return renderHome();
}

/* ברכה לפי שעה ביום. שם ריק → רק הברכה. */
function timeGreeting() {
  const h = new Date().getHours();
  if (h < 5 || h >= 22) return 'לילה טוב';
  if (h < 12) return 'בוקר טוב';
  if (h < 17) return 'צהריים טובים';
  return 'ערב טוב';
}

/* ================= דף הבית — המקצועות ================= */
function renderHome() {
  setNav('home');
  view.innerHTML = '';
  delete view.dataset.course;  // מנקה צבע-מקצוע שנשאר מעמוד מקצוע קודם

  const head = el('div', 'page-head');
  const nm = window.Cloud?.user?.firstName;
  head.append(el('h1', null, nm ? `${timeGreeting()}, ${nm} 👋` : 'ארכיון השחזורים'));
  head.append(el('p', null, 'שחזורי מבחנים אמיתיים — לפתור, להבין, ולחזור על מה שטעית.'));
  view.append(head);

  /* ── באנר אחד לכל היותר ──

     ינון (13/08/2026): „הכי חשוב שהאתר יהיה מאוד מאוד נוח לשימוש, מאוד
     ברור.” הבעיה הייתה מדידה: דף הבית רינדר עד **שמונה** באנרים לפני
     שהעין הגיעה לקורס הראשון — סקר, בקשת שם, סיור, התחברות, ערכת נושא,
     ספירה לאחור ופוש שננת. כל אחד מהם היה הגיוני בנפרד; ביחד הם קיר.

     מעכשיו: תור לפי עדיפות, והראשון שיש לו תוכן הוא היחיד שמוצג. השאר
     ימתינו לביקור הבא. סדר התור הוא סדר הדחיפות למשתמש חדש. */
  const bannerQueue = [whatsNewBanner, namePrompt, introBanner, loginBanner, shinunHomePush];
  for (const make of bannerQueue) {
    let b = null;
    try { b = make(); } catch { b = null; }
    if (b) { view.append(b); break; }
  }

  /* ── אזור 1: מה קרוב ──
     תמיד מוצג, גם כשאין מבחן. „אין מבחנים כרגע” הוא מידע — הוא אומר
     לסטודנט שהוא לא מפספס כלום, וזה עדיף על שקט שנראה כמו תקלה. */
  const nextup = nextExamBanner();
  if (nextup) view.append(nextup);
  else {
    const calm = el('div', 'nextup-none');
    calm.append(el('b', null, 'אין מבחנים בקרוב'));
    calm.append(el('span', null, 'זה הזמן לחזור על מה שטעית, או לעבור על החומר בשקט.'));
    view.append(calm);
  }

  /* המדף: הסמסטר הפעיל למעלה, ושנים/סמסטרים קודמים מקופלים בארכיון.
     כך האתר "גדל בחן" — ריבוי שנים לא נערם מול העיניים. */
  const active = COURSES.filter((c) => !isArchived(c));
  const archived = COURSES.filter(isArchived);

  groupBySemester(active).forEach((g) => view.append(shelfGroup(g.label, g.courses, false)));

  if (archived.length) {
    const det = el('details', 'shelf-arch');
    const sum = el('summary');
    sum.append(el('span', 'chev', '⌄'));
    /* מה שכתוב על המגירה צריך לומר מה בפנים. כשכל הארכיון הוא שנה אחת —
       אומרים אותה בשם, כי „ארכיון סמסטרים קודמים” לא מרמז על כלום. */
    const years = [...new Set(archived.map(semLabel))];
    sum.append(el('span', null, years.length === 1 ? years[0] + ' — הסתיים' : 'מקצועות שהסתיימו'));
    sum.append(el('span', 'shelf-arch-line'));
    sum.append(el('span', 'shelf-head-n', plural(archived.length, 'מקצוע', 'מקצועות')));
    det.append(sum);
    groupBySemester(archived).forEach((g) => det.append(shelfGroup(g.label, g.courses, true)));
    view.append(det);
  }

  /* הסיור של השדרוג קופץ אוטומטית — פעם אחת — למי שעוד לא ראה אותו (TOUR_KEY).
     נדחה בכמה מאיות כדי שהמדף כבר יצויר, ורק אם עדיין בדף הבית. */
  if (!localStorage.getItem(TOUR_KEY) && !tourStop) {
    setTimeout(() => {
      if (!localStorage.getItem(TOUR_KEY) && !tourStop && (location.hash || '#/') === '#/') startTour();
    }, 850);
  }

  toTop();
  updateFooter();
}

/* תווית סמסטר קריאה מתוך year/semester שב-courses.json. */
function semLabel(c) {
  const yr = { 1: 'א׳', 2: 'ב׳', 3: 'ג׳', 4: 'ד׳', 5: 'ה׳', 6: 'ו׳' }[c.year] || (c.year || '');
  const parts = [];
  if (yr) parts.push('שנה ' + yr);
  if (c.semester) parts.push('סמסטר ' + c.semester + '׳');
  return parts.join(' · ') || 'מקצועות';
}

/* קיבוץ קורסים לפי סמסטר, בשמירת הסדר. */
function groupBySemester(courses) {
  const order = [];
  const byKey = {};
  courses.forEach((c) => {
    const key = semLabel(c);
    if (!byKey[key]) { byKey[key] = []; order.push(key); }
    byKey[key].push(c);
  });
  return order.map((k) => ({ label: k, courses: byKey[k] }));
}

function shelfGroup(label, courses, inArchive) {
  const wrap = el('div', 'shelf-group');
  if (!inArchive) {
    const h = el('div', 'shelf-head');
    h.append(el('span', 'shelf-head-t', label));
    h.append(el('span', 'shelf-head-line'));
    h.append(el('span', 'shelf-head-n', plural(courses.length, 'מקצוע', 'מקצועות')));
    wrap.append(h);
  }
  const grid = el('div', 'shelf-grid');
  courses.forEach((c) => grid.append(courseCard(c)));
  wrap.append(grid);
  return wrap;
}

/* הפעולות הזמינות במקצוע — הצצה לפני כניסה. תרגום kind→פועַל. */
function courseVerbs(c) {
  const list = examsOf(c.id) || [];
  const has = (k) => list.some((e) => e.kind === k);
  const out = [];
  if (has('shichzur')) out.push('שחזורים');
  if (has('practice') || has('highyield') || has('case') || has('keyer') || simsOf(c.id).length || labsOf(c.id).length) out.push('תרגול');
  if (has('guide') || has('cards') || has('shinun') || c.studyDoc) out.push('ללמוד');
  return out;
}

function courseCard(c) {
  const p = courseProgress(c.id);
  const hasQ = quizzesOf(c.id).length;
  const readiness = p.total ? Math.round((p.correct / p.total) * 100) : 0;

  const a = el('a', 'ccard');
  a.dataset.tour = 'course';       // הסיור מצביע על הראשון שהוא מוצא
  a.dataset.course = c.id;         // מפעיל את --course-accent (שדרת-הצבע + הטבעת)
  a.href = '#/course/' + c.id;

  const top = el('div', 'ccard-top');
  const idw = el('div', 'ccard-id');
  idw.append(el('span', 'ccard-ico', c.icon || '📘'));
  const txt = el('div');
  txt.append(el('h2', 'ccard-name', c.name));
  if (c.blurb) txt.append(el('p', 'ccard-blurb', c.blurb));
  idw.append(txt);
  top.append(idw);

  if (hasQ) {
    const rw = el('div', 'ccard-ring');
    rw.append(ring(readiness, 50));
    rw.append(el('div', 'ccard-ring-l', 'מוכנוּת'));
    top.append(rw);
  }
  a.append(top);

  const subs = subjectsOf(c);
  const verbs = subs.length ? [] : courseVerbs(c);
  if (subs.length) {
    /* מבחן בלוק: ארבעה צ׳יפים — קיצור ישר לכל מקצוע. הכרטיס עצמו מוביל
       לעמוד המבחן. (הכרעת ינון, 23/09: „שני כרטיסים עם קיצורים”.) */
    const chips = el('div', 'ccard-subj');
    subs.forEach((sj) => {
      const ch = el('a', 'ccard-subj-chip');
      ch.href = '#/course/' + c.id + '/' + encodeURIComponent(sj.key);
      ch.title = `ישר אל ${sj.name}`;
      ch.append(el('span', null, sj.icon || '📘'));
      ch.append(el('span', null, sj.short || sj.name));
      chips.append(ch);
    });
    a.append(chips);
  } else if (verbs.length) {
    const acts = el('div', 'ccard-acts');
    verbs.forEach((v, i) => acts.append(el('span', 'pill ' + (i === 0 ? 'pill-accent' : 'pill-muted'), v)));
    a.append(acts);
  } else {
    const acts = el('div', 'ccard-acts');
    acts.append(el('span', 'pill pill-muted', 'בקרוב'));
    a.append(acts);
  }

  const nd = nextDate(c);
  if (nd) {
    const cd = el('div', 'ccard-cd u-' + urgency(nd.ts));
    cd.append(el('span', null, `🕐 מועד ${nd.moed}׳ · ${countdownText(nd.ts)}`));
    cd.title = `${fmtDate(nd.ts)} ${fmtTime(nd.ts)}`;
    a.append(cd);
  }
  if (!subs.length) return a;
  /* קישור בתוך קישור אסור, ולכן כרטיס עם צ׳יפים הוא div: הקישור הראשי
     נמתח על כל הכרטיס (::after ב-CSS), והצ׳יפים יושבים מעליו. */
  const card = el('div', 'ccard ccard-block');
  card.dataset.tour = 'course';
  card.dataset.course = c.id;
  const main = el('a', 'ccard-main');
  main.href = a.href;
  main.setAttribute('aria-label', `${c.name} — עמוד המבחן`);
  card.append(main, ...a.childNodes);
  return card;
}

function stat(value, label, cls) {
  const d = el('div', 'stat' + (cls ? ' ' + cls : ''));
  d.append(el('b', null, String(value)));
  d.append(el('span', null, label));
  return d;
}

/* Ring — טבעת מוכנוּת. pct 0..100. הצבע = --course-accent (יורש מ-data-course). */
function ring(pct, size) {
  size = size || 52;
  const r = size / 2 - 4;
  const circ = 2 * Math.PI * r;
  const off = circ * (1 - Math.max(0, Math.min(100, pct)) / 100);
  const NS = 'http://www.w3.org/2000/svg';
  const wrap = el('div', 'ring');
  wrap.style.width = size + 'px';
  wrap.style.height = size + 'px';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  const mk = (cls) => {
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', size / 2);
    c.setAttribute('cy', size / 2);
    c.setAttribute('r', r);
    c.setAttribute('fill', 'none');
    c.setAttribute('stroke-width', '5');
    c.setAttribute('class', cls);
    return c;
  };
  const fill = mk('ring-fill');
  fill.setAttribute('stroke-dasharray', circ.toFixed(1));
  fill.setAttribute('stroke-dashoffset', off.toFixed(1));
  svg.append(mk('ring-track'), fill);
  wrap.append(svg);
  wrap.append(el('span', 'ring-val', Math.round(pct) + '%'));
  return wrap;
}

function emptyState(icon, title, text) {
  const e = el('div', 'empty');
  e.append(el('span', 'ico', icon));
  e.append(el('b', null, title));
  e.append(el('p', null, text));
  return e;
}

/* ================= דף מקצוע ================= */
/* הסבר על הקורס — פסקאות מופרדות בשורה ריקה. */
function aboutBox(text, title) {
  const box = el('div', 'course-about');
  box.append(el('div', 'course-about-title', title || 'על הקורס והמבחנים'));
  const body = el('div', 'course-about-body');
  String(text).split('\n\n').forEach((para) => body.append(el('p', null, para)));
  box.append(body);
  return box;
}

/* לוח המועדים של המקצוע — כולם, גם מה שכבר עבר */
function moadimRow(c) {
  if (!(c.dates || []).length) return null;
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
  return row;
}

function renderCourse(courseId, subKey = null) {
  setNav('home');
  const c = courseOf(courseId);
  view.innerHTML = '';

  if (!c) {
    view.append(emptyState('⚠️', 'מקצוע לא נמצא', 'הקישור כנראה שגוי.'));
    toTop();
    return;
  }

  view.dataset.course = courseId;  // מפעיל את --course-accent על כל העמוד

  /* מבחן בלוק: בלי מקצוע — עמוד המבחן; עם מקצוע — אותו עמוד, מסונן אליו. */
  const s = subjectOf(courseId, subKey);
  if (subKey && !s) {
    view.append(crumb(c.name, '#/course/' + courseId));
    view.append(emptyState('⚠️', 'מקצוע לא נמצא', 'הקישור כנראה שגוי.'));
    toTop();
    return;
  }
  if (!s && subjectsOf(c).length) return renderBlockHub(c);
  const sfx = s ? '/@' + encodeURIComponent(s.key) : '';   // היקף המקצוע בכל הכלים
  const sim = s ? subjectSim(c, s) : c.simExam;

  view.append(s ? crumb(c.name, '#/course/' + courseId) : crumb('כל המקצועות', '#/'));

  const head = el('div', 'page-head');
  if (s) {
    head.append(el('h1', null, `${s.icon || ''} ${s.name}`.trim()));
    head.append(el('p', null, `חלק מ${c.name}` + (sim ? ` · כ-${sim.questions} מתוך ${c.simExam.questions} השאלות במבחן` : '')));
  } else {
    head.append(el('h1', null, `${c.icon || ''} ${c.name}`.trim()));
    head.append(el('p', null, [c.blurb, c.code].filter(Boolean).join(' · ')));
  }
  view.append(head);

  // הסבר על הקורס והמבחנים — הקשר ומקורות. מוצג רק אם הוגדר about ב-courses.json.
  const about = s ? s.about : c.about;
  if (about) view.append(aboutBox(about, s ? `על ${s.name} במבחן` : null));

  const moadim = moadimRow(c);
  if (moadim) view.append(moadim);

  const list = s ? examsOfSubject(courseId, s) : examsOf(courseId);
  if (!list.length) {
    view.append(emptyState('📭', 'עוד אין מבחנים במקצוע הזה', 'ברגע שיתווסף שחזור ראשון, הוא יופיע כאן.'));
    toTop();
    updateFooter();
    return;
  }

  const p = s ? progressOf(list) : courseProgress(courseId);
  const pct = p.answered ? Math.round((p.correct / p.answered) * 100) : 0;

  /* NOT_QUIZ ולא רשימה ידנית: הספירה הזו החריגה 'cards' בלבד, ולכן מפת החומרים
     כבר נספרה כמבחן. p.total ממילא נגזר מ-quizzesOf — הדשבורד סתר את עצמו. */
  const nQuiz = list.filter((e) => !NOT_QUIZ.has(e.kind)).length;
  if (p.answered) {
    const dash = el('div', 'dash');
    dash.append(stat(nQuiz, 'מבחנים', 'accent'));
    dash.append(stat(p.total, 'שאלות'));
    dash.append(stat(p.answered, 'שאלות שענית'));
    dash.append(stat(pct + '%', 'אחוז הצלחה', pct >= 70 ? 'good' : 'bad'));
    view.append(dash);
  } else {
    /* לפני שענית — אין מה למדוד: שורה דקה במקום ארבע קוביות של אפסים. */
    view.append(el('div', 'dash-slim', `${plural(nQuiz, 'מבחן', 'מבחנים')} · ${p.total} שאלות — המספרים שלך יופיעו כאן אחרי שתתחיל לענות`));
  }

  /* ===== עמוד המקצוע — זרימה לפי סדר עדיפויות השימוש =====
     תרגול (באנר-גיבור בראש) › שחזורים › ללמוד › מעבדות(מקופל). התרגול הוא באנר
     יחיד, ולכן הוא בראש — נגיש מיד, בלי לדחוף את השחזורים רחוק. מדלגים על ריק. */
  const practiceExams = list.filter((e) => e.kind === 'practice' || e.kind === 'highyield');
  const testExams = list.filter((e) => e.kind === 'shichzur');
  const caseDecks = list.filter((e) => e.kind === 'case');
  const keyerDecks = list.filter((e) => e.kind === 'keyer');
  const cardDecks = list.filter((e) => e.kind === 'cards');
  /* חפיסת השינון היא של הקורס כולו (בלי part); בעמוד מקצוע היא מוצגת בהיקף המקצוע. */
  const shinunDeck = list.find((e) => e.kind === 'shinun') || (s ? EXAMS.find((e) => e.course === courseId && e.kind === 'shinun') : null);
  /* המפה שייכת לקורס כולו (בלי part), ולכן בעמוד מקצוע היא לא ברשימה המסוננת. */
  const hasGuide = !!guideOf(courseId);

  /* צ'יפי הניווט — גלילה חלקה לסקשן (עוגן, לא מסנן). */
  const nav = el('div', 'verbnav');
  const addChip = (id, label) => {
    const ch = el('button', 'verb-chip', label);
    ch.title = 'גלילה מהירה אל הסקשן הזה בעמוד';
    ch.onclick = () => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    nav.append(ch);
  };
  addChip('sec-practice', '🏋️ תרגול');
  if (keyerDecks.length || caseDecks.length || shinunDeck || list.some((e) => e.kind === 'practice' && e.play) || (s && (simsOf(courseId, s).length || drillsOf(courseId, s).length || labsOf(courseId, s).length))) addChip('sec-play', '🎮 לשחק');
  if (testExams.length) addChip('sec-test', '📝 שחזורים');
  /* אנקי הוא „אופציה צדדית” לפי הכרעת ינון — קישור בסרגל, לא באנר. הוא מוצג
     רק כשיש חפיסה בפועל, כדי שלא יוביל לדף ריק. */
  if (!s && hasAnkiDeck(courseId)) {
    const a = el('a', 'verb-chip');
    a.href = '#/anki/' + courseId;
    a.textContent = '🃏 אנקי';
    a.title = 'חפיסת אנקי להורדה — כרטיסים ממפת החומרים';
    nav.append(a);
  }
  view.append(nav);

  /* 1) תרגול — באנר-גיבור בראש (הדבר ה-2 הכי בשימוש, אבל באנר יחיד קומפקטי). */
  const hero = el('div', 'practice-hero');
  hero.id = 'sec-practice';
  hero.append(el('h2', null, '🏋️ תרגול'));
  hero.append(el('p', null,
    'בחרו נושאים, כמה שאלות, ומה להציג — חדשות, מה שטעיתם, או הכול. או פשוט התחילו לתרגל מעורב.'));
  const lRow = el('div', 'btn-row');
  const pr = el('a', 'btn primary', '🏋️ בחרו ותרגלו');
  pr.title = 'בחירת נושאים, כמות ומה להציג — ותרגול מותאם אישית';
  pr.dataset.tour = 'practice';
  pr.href = '#/practice/' + courseId + sfx;
  lRow.append(pr);
  const rv = el('a', 'btn', '🎯 הטעויות שלי');
  rv.title = 'סבב חוזר על כל השאלות שטעית בהן';
  rv.dataset.tour = 'review';
  rv.href = '#/review/' + courseId + sfx;
  lRow.append(rv);
  /* סימולציית מבחן — רק למקצוע שהגדיר simExam ב-courses.json (כרגע פיזיקה:
     אין שחזורים, אז חוויית "מבחן אמיתי" חסרה — וזה התחליף). */
  if (sim) {
    const sx = el('a', 'btn', s ? `🎓 סימולציה — ${s.name}` : '🎓 סימולציית מבחן');
    sx.href = '#/simexam/' + courseId + sfx;
    sx.title = s
      ? `${sim.questions} שאלות · ${sim.minutes} דקות — החלק של ${s.name} במבחן, בתנאי אמת`
      : `${sim.questions} שאלות · ${Math.round(sim.minutes / 60)} שעות · בתנאי אמת`;
    lRow.append(sx);
  }
  /* המלכודות — רק למקצוע שיש לו מפה, כי משם מגיע התוכן. בקליני ובביוכימיה
     הדף היה מציג מצב ריק, וכפתור שמוביל לכלום גרוע מכפתור שאינו. */
  if (guideOf(courseId)) {
    const tr = el('a', 'btn', '🪤 המלכודות שלי');
    tr.title = 'המלכודות שנפלת בהן בתרגול — מה הטעות, מה הנכון, ואיפה ללמוד';
    tr.href = '#/traps/' + courseId;
    lRow.append(tr);
    /* עץ הידע — אותו תנאי בדיוק: התוכן נגזר מהמפה. */
    const kt = el('a', 'btn', '🌳 עץ הידע');
    kt.title = 'מפת השליטה שלך — כל נושא נצבע לפי כמה אתה יודע אותו עכשיו, ובמה כדאי לגעת';
    kt.href = '#/tree/' + courseId;
    lRow.append(kt);
  }
  /* "הלילה לפני" — רק כשהמבחן באמת קרוב. באמצע הסמסטר זה רעש; שלושה ימים
     לפני זה הדבר היחיד שרוצים ללחוץ עליו. */
  const nd = nextDate(c);
  if (nd && nd.ts - Date.now() < 8 * MS.day) {
    const tn = el('a', 'btn', '🌙 הלילה לפני');
    tn.title = 'מסלול חזרה מרוכז לערב שלפני המבחן — לפי הזמן שנשאר לך';
    tn.href = '#/tonight/' + courseId;
    lRow.append(tn);
  }
  /* המסומנות — רק אם יש מה להראות. */
  if (Object.keys(flags.read()).length) {
    const fg = el('a', 'btn', '🔖 מה שסימנתי');
    fg.title = 'כל השאלות שסימנת בדגלון — במקום אחד';
    fg.href = '#/flagged/' + courseId;
    lRow.append(fg);
  }
  hero.append(lRow);
  /* בנקי-תרגול — כקישורים קומפקטיים בתוך הבאנר, לא כבלוקים נפרדים.
     (מקרים ומפתחות הגדרה עברו לאזור „לשחק עם זה” — הם דלת בפני עצמה.) */
  if (practiceExams.length) {
    const extra = el('div', 'practice-hero-extra');
    extra.append(el('span', 'lbl', 'גם:'));
    practiceExams.forEach((m) => {
      const a = el('a', null, `🔁 ${m.title}`); a.dataset.tour = 'exam'; a.href = '#/exam/' + m.id;
      /* בנק תרגול מוצג כאן כקישור קומפקטי בלי מטא — ולכן מבחן חריג היה נבלע
         בשורה. התג נכנס גם כאן, אחרת הסימון קיים רק אחרי שכבר נכנסים. */
      if (m.spotlight) a.append(el('span', 'tag spotlight', m.spotlight.tag));
      extra.append(a);
    });
    hero.append(extra);
  }
  view.append(hero);

  /* 1ב) לשחק עם זה — הדלת השביעית של הנושא: כלים שבהם *עושים* משהו עם החומר
     (מזהים חיידק מרמזים, פותרים מקרה, משננים) ולא רק עונים על שאלה. כולם
     מונעי-דאטה; מקצוע בלי אף אחד מהם פשוט לא מציג את האזור. */
  const playCards = [];
  const playCard = (ico, ttl, sub, href, badge) => {
    const a = el('a', 'learn-card');
    a.href = href;
    a.append(el('span', 'learn-card-ico', ico));
    const t = el('div');
    const ttlRow = el('div', 'learn-card-ttl', ttl);
    if (badge) ttlRow.append(el('span', 'learn-card-badge', badge));
    t.append(ttlRow);
    if (sub) t.append(el('div', 'learn-card-sub', sub));
    a.append(t);
    return a;
  };
  keyerDecks.forEach((d) => playCards.push(playCard('🔑', d.title, d.heroSub || `${plural(d.count, 'תיק', 'תיקים')} — לזהות מרמזים, בכמה שפחות בדיקות`, '#/keyer/' + d.id, '✨ חדש')));
  /* בנקי תרגול מסומנים play (hotspot על רישום, אילנות יוחסין) — משחק על איור. */
  list.filter((e) => e.kind === 'practice' && e.play).forEach((d) => playCards.push(playCard('🖱️', d.title, d.heroSub || `${plural(d.count, 'שאלה', 'שאלות')} על איור`, '#/exam/' + d.id)));
  caseDecks.forEach((d) => playCards.push(playCard('🩺', d.title, d.heroSub || `${plural(d.count, 'מקרה', 'מקרים')} — תיק שמתפתח, החלטה אחרי החלטה`, '#/case/' + d.id)));
  if (shinunDeck) playCards.push(playCard('🧠', 'i❤️Shinun', s ? 'עובדות לבעל־פה במקצוע הזה — היפוך, כסה-וגלה, מבחן' : `${shinunDeck.count} עובדות לבעל־פה — היפוך, כסה-וגלה, מבחן`, '#/shinun/' + courseId + (s ? '/@' + encodeURIComponent(s.key) : '')));
  /* בעמוד מקצוע הסימולציות והחישובים הם כרטיסים כאן, בין שאר הכלים — ולא
     אקורדיון „מעבדות” נפרד בתחתית (זה נשאר לקורס בלי מקצועות, כמו אלקטרו). */
  const subSims = s ? simsOf(courseId, s) : [];
  const subDrills = s ? drillsOf(courseId, s) : [];
  (s ? labsOf(courseId, s) : []).forEach((l) => playCards.push(playCard(l.icon, l.title, l.blurb, l.route, '✨ חדש')));
  subSims.forEach((x) => playCards.push(playCard(x.icon, x.title, x.blurb, '#/sim/' + x.id, '🎛️ סימולציה')));
  if (subDrills.length) {
    const sub = subDrills.length === 1 ? subDrills[0].title : subDrills.map((d) => d.title).slice(0, 3).join(' · ') + (subDrills.length > 3 ? ` ועוד ${subDrills.length - 3}` : '');
    playCards.push(playCard('🧮', `${plural(subDrills.length, 'תרגיל חישוב', 'תרגילי חישוב')} — מספרים חדשים בכל פעם`, sub, '#/drill/' + subDrills[0].id));
    playCards.push(playCard('📖', 'כרטיס הנוסחאות', `${plural(formulasOf(courseId, s).length, 'נוסחה', 'נוסחאות')} עם מחשבון-הצבה חי`, `#/formulas/${courseId}/@${encodeURIComponent(s.key)}`));
  }
  if (playCards.length) {
    const sec = el('section', 'verb-zone');
    sec.id = 'sec-play';
    const h = el('div', 'zone-head');
    h.append(el('span', 'zone-head-t', '🎮 לשחק עם זה'));
    h.append(el('span', 'zone-head-line'));
    sec.append(h);
    const g = el('div', 'learn-grid');
    playCards.forEach((x) => g.append(x));
    sec.append(g);
    view.append(sec);
  }

  /* 2) שחזורים — הרשימה הכי בשימוש, מיד מתחת לתרגול. */
  if (testExams.length) {
    const sec = el('section', 'verb-zone');
    sec.id = 'sec-test';
    const h = el('div', 'zone-head');
    h.append(el('span', 'zone-head-t', '📝 שחזורים'));
    h.append(el('span', 'zone-head-line'));
    sec.append(h);
    sec.append(examListFrag(testExams, c));
    view.append(sec);
  }

  /* 3) ללמוד — מפה + סיכום + כרטיסים, כקלפים ברורים (לא באנרים ענקיים). */
  const learnCard = (ico, ttl, sub, href, badge) => {
    const a = el('a', 'learn-card');
    a.href = href;
    a.append(el('span', 'learn-card-ico', ico));
    const t = el('div');
    const ttlRow = el('div', 'learn-card-ttl', ttl);
    if (badge) ttlRow.append(el('span', 'learn-card-badge', badge));
    t.append(ttlRow);
    if (sub) t.append(el('div', 'learn-card-sub', sub));
    a.append(t);
    return a;
  };
  const lg = el('div', 'learn-grid');
  const studyDoc = s ? s.studyDoc : c.studyDoc;
  if (studyDoc) {
    /* הלומדה — הכניסה הראשית ללמידה, עם שלושת מצבי הקריאה כקישורים נפרדים.
       div ולא <a> כמו שאר הקלפים: קישור בתוך קישור אסור, וכאן המצבים הם
       שלושה יעדים אמיתיים. מסמך ישן שלא הוזרק לו מנוע המצבים פשוט יתעלם
       מהפרמטר — ולכן אין צורך בדגל בדאטה. */
    const sd = studyDoc;
    const card = el('div', 'learn-card learn-card-doc');
    card.append(el('span', 'learn-card-ico', '📖'));
    const t = el('div');
    t.append(el('div', 'learn-card-ttl', 'הלומדה — הסיכום המלא'));
    t.append(el('div', 'learn-card-sub', sd.meta || 'קריאה לעומק'));
    const modes = el('div', 'learn-modes');
    [['📖 קריאה מלאה', '', 'כל התוכן, כמעבר ראשון על החומר'],
     ['⚡ מרוכז', '?m=focus', 'רק התמצית, המלכודות ומה שבאמת נשאל — לחזרה מהירה'],
     ['🎮 אינטראקטיבי', '?m=play', 'תרגילי התאמה, מפות חשיבה ושערי "נסה קודם"']]
      .forEach(([lbl, q, tip]) => {
        const a = el('a', 'learn-mode', lbl);
        a.href = sd.href + q;
        a.title = tip;
        modes.append(a);
      });
    t.append(modes);
    card.append(t);
    lg.append(card);
  }
  /* מסמכים נוספים לצד הסיכום — מוגדרים כולם בדאטה (courses.json), אפס ידע במנוע. */
  (c.extraDocs || []).forEach((d) => lg.append(learnCard(d.icon || '📄', d.title, d.sub, d.href, d.badge)));
  /* ליווי הסמסטר — רק לקורס שהוגדרה לו תוכנית הוראה (teaching). */
  if (c.teaching && c.teaching.start && (c.teaching.weeks || []).length) {
    lg.append(learnCard('🗓️', s ? 'השבוע בבלוק' : 'השבוע בקורס',
      s ? `מה נלמד השבוע ב${s.name} ובשאר המקצועות, ומה אתה אמור כבר לדעת`
        : 'איפה ההוראה עומדת, מה אתה אמור לדעת כבר, ומה נשאר לסגור',
      '#/semester/' + courseId));
  }
  if (hasGuide) {
    const gcard = learnCard('🗺️', s ? `מפת החומרים — ${s.name}` : 'מפת החומרים', 'מה ללמוד, מאיפה, ותמצית', '#/guide/' + courseId + sfx);
    gcard.dataset.tour = 'guide';   // עוגן לסיור
    lg.append(gcard);
  }
  cardDecks.forEach((d) => lg.append(learnCard('🎓', d.title, plural(d.count, 'כרטיסייה', 'כרטיסיות'), '#/cards/' + d.id)));
  if (lg.children.length) {
    addChip('sec-learn', '📖 ללמוד');
    const sec = el('section', 'verb-zone');
    sec.id = 'sec-learn';
    const h = el('div', 'zone-head');
    h.append(el('span', 'zone-head-t', '📖 ללמוד'));
    h.append(el('span', 'zone-head-line'));
    sec.append(h);
    sec.append(lg);
    view.append(sec);
  }

  /* 4) מעבדות — הכי פחות בשימוש: accordion מקופל בתחתית, שלא יפריע לעיקר. */
  const sh = s ? null : simsHero(courseId);
  const dh = s ? null : drillsHero(courseId);
  if (sh || dh) {
    const acc = el('details', 'labs-acc');
    acc.dataset.tour = 'sim';   // עוגן לסיור — על האקורדיון (גלוי), לא על התוכן המקופל
    const sum = el('summary');
    sum.append(el('span', null, '🔬 כלים אינטראקטיביים — מעבדות וחישוב'));
    sum.append(el('span', 'chev', '⌄'));
    acc.append(sum);
    const body = el('div', 'labs-acc-body');
    if (sh) body.append(sh);
    if (dh) body.append(dh);
    acc.append(body);
    view.append(acc);
  }

  toTop();
  updateFooter();
}


/* ================= עמוד מבחן בלוק =================
   כרטיס של קורס עם subjects מוביל לכאן: המבחן עצמו (מועדים, סימולציה של
   הבלוק כולו, השחזורים שחוצים מקצועות) ומעליו ארבעה אריחים — אחד לכל
   מקצוע, עם המוכנות שלך בו. כך רואים במבט אחד איזה מקצוע מפגר, ונכנסים
   אליו בלחיצה. כל השאר (שחזורים לפי מקצוע, מפה, לומדה) גר בעמוד המקצוע. */
function renderBlockHub(c) {
  const courseId = c.id;
  const subs = subjectsOf(c);
  view.append(crumb('כל המקצועות', '#/'));

  const head = el('div', 'page-head');
  head.append(el('h1', null, `${c.icon || ''} ${c.name}`.trim()));
  head.append(el('p', null, [c.blurb, c.code].filter(Boolean).join(' · ')));
  view.append(head);

  const moadim = moadimRow(c);
  if (moadim) view.append(moadim);

  const p = courseProgress(courseId);
  if (p.answered) {
    const pct = Math.round((p.correct / p.answered) * 100);
    const dash = el('div', 'dash');
    dash.append(stat(subs.length, 'מקצועות', 'accent'));
    dash.append(stat(p.total, 'שאלות'));
    dash.append(stat(p.answered, 'שאלות שענית'));
    dash.append(stat(pct + '%', 'אחוז הצלחה', pct >= 70 ? 'good' : 'bad'));
    view.append(dash);
  } else {
    view.append(el('div', 'dash-slim',
      `${plural(subs.length, 'מקצוע', 'מקצועות')} · ${p.total} שאלות — המספרים שלך יופיעו כאן אחרי שתתחיל לענות`));
  }

  /* 1) המקצועות — הדרך הראשית פנימה */
  const zone = el('section', 'verb-zone');
  zone.id = 'sec-subjects';
  const zh = el('div', 'zone-head');
  zh.append(el('span', 'zone-head-t', '📚 המקצועות'));
  zh.append(el('span', 'zone-head-line'));
  zone.append(zh);
  const grid = el('div', 'subj-grid');
  subs.forEach((s) => {
    const list = examsOfSubject(courseId, s);
    const sp = progressOf(list);
    const nQ = list.filter((e) => !NOT_QUIZ.has(e.kind)).length;
    const sim = subjectSim(c, s);
    const a = el('a', 'subj-tile');
    a.href = '#/course/' + courseId + '/' + encodeURIComponent(s.key);
    a.title = `כל מה שיש ב${s.name}: שחזורים, תרגול, סימולציה, מפה ולומדה`;
    const txt = el('div', 'subj-tile-txt');
    const nm = el('div', 'subj-tile-name');
    nm.append(el('span', 'subj-tile-ico', s.icon || '📘'));
    nm.append(el('span', null, s.name));
    txt.append(nm);
    txt.append(el('div', 'subj-tile-sub', `${plural(nQ, 'מבחן', 'מבחנים')} · ${sp.total} שאלות`));
    if (sim) txt.append(el('div', 'subj-tile-q', `כ-${sim.questions} שאלות במבחן`));
    a.append(txt);
    const rw = el('div', 'ccard-ring');
    rw.append(ring(sp.total ? Math.round((sp.correct / sp.total) * 100) : 0, 46));
    rw.append(el('div', 'ccard-ring-l', 'מוכנוּת'));
    a.append(rw);
    grid.append(a);
  });
  zone.append(grid);
  view.append(zone);

  /* 2) מבחן הבלוק — כל המקצועות יחד, כמו ביום המבחן */
  const hero = el('div', 'practice-hero');
  hero.id = 'sec-practice';
  hero.append(el('h2', null, '🎓 מבחן הבלוק — הכול יחד'));
  hero.append(el('p', null,
    'כשרוצים לבדוק את עצמכם על כל החומר: סימולציה בתנאי אמת, תרגול מעורב מכל המקצועות, והטעויות מכל הבלוק במקום אחד.'));
  const row = el('div', 'btn-row');
  if (c.simExam) {
    const sx = el('a', 'btn primary', '🎓 סימולציה של המבחן המלא');
    sx.href = '#/simexam/' + courseId;
    sx.title = `${c.simExam.questions} שאלות · ${Math.round(c.simExam.minutes / 60)} שעות · בחלוקה של המבחן האמיתי`;
    row.append(sx);
  }
  const pr = el('a', 'btn', '🏋️ תרגול מעורב');
  pr.href = '#/practice/' + courseId;
  pr.title = 'בחירת נושאים מכל המקצועות, כמות ומה להציג';
  row.append(pr);
  const rv = el('a', 'btn', '🎯 הטעויות שלי');
  rv.href = '#/review/' + courseId;
  rv.title = 'סבב חוזר על כל השאלות שטעית בהן, מכל ארבעת המקצועות';
  row.append(rv);
  if (guideOf(courseId)) {
    const kt = el('a', 'btn', '🌳 עץ הידע');
    kt.href = '#/tree/' + courseId;
    kt.title = 'כל נושא בבלוק נצבע לפי כמה אתה יודע אותו עכשיו';
    row.append(kt);
  }
  const nd = nextDate(c);
  if (nd && nd.ts - Date.now() < 8 * MS.day) {
    const tn = el('a', 'btn', '🌙 הלילה לפני');
    tn.href = '#/tonight/' + courseId;
    tn.title = 'מסלול חזרה מרוכז לערב שלפני המבחן — לפי הזמן שנשאר לך';
    row.append(tn);
  }
  if (Object.keys(flags.read()).length) {
    const fg = el('a', 'btn', '🔖 מה שסימנתי');
    fg.href = '#/flagged/' + courseId;
    fg.title = 'כל השאלות שסימנת בדגלון — במקום אחד';
    row.append(fg);
  }
  hero.append(row);
  view.append(hero);

  /* 3) מה שחוצה מקצועות: שחזור מבחן הבלוק עצמו, ו-High Yield */
  const ownParts = new Set(subs.map((s) => s.part));
  const cross = examsOf(courseId).filter((e) => !NOT_QUIZ.has(e.kind) && !ownParts.has(e.part));
  if (cross.length) {
    const sec = el('section', 'verb-zone');
    sec.id = 'sec-test';
    const h = el('div', 'zone-head');
    h.append(el('span', 'zone-head-t', '📝 שחזורים של המבחן כולו'));
    h.append(el('span', 'zone-head-line'));
    sec.append(h);
    sec.append(examListFrag(cross, c));
    view.append(sec);
  }

  /* 4) ללמוד — מה ששייך לבלוק כולו */
  const lg = el('div', 'learn-grid');
  const card = (ico, ttl, sub, href) => {
    const a = el('a', 'learn-card');
    a.href = href;
    a.append(el('span', 'learn-card-ico', ico));
    const t = el('div');
    t.append(el('div', 'learn-card-ttl', ttl));
    t.append(el('div', 'learn-card-sub', sub));
    a.append(t);
    return a;
  };
  if (c.teaching && c.teaching.start && (c.teaching.weeks || []).length)
    lg.append(card('🗓️', 'השבוע בבלוק', 'מה נלמד השבוע בכל המקצועות, ומה אתה אמור כבר לדעת', '#/semester/' + courseId));
  if (guideOf(courseId))
    lg.append(card('🗺️', 'מפת החומרים — כל הבלוק', 'כל הנושאים של כל המקצועות, לפי כמה הם נשאלים', '#/guide/' + courseId));
  if (lg.children.length) {
    const sec = el('section', 'verb-zone');
    sec.id = 'sec-learn';
    const h = el('div', 'zone-head');
    h.append(el('span', 'zone-head-t', '📖 ללמוד'));
    h.append(el('span', 'zone-head-line'));
    sec.append(h);
    sec.append(lg);
    view.append(sec);
  }

  /* ההקשר בסוף: קודם עושים, אחר כך קוראים על המבחן. */
  if (c.about) view.append(aboutBox(c.about, 'על המבחן'));

  toTop();
  updateFooter();
}

/* רשימת מבחנים מקובצת (flat / לפי חלק) — משותפת לזונת "נבחנים" ולזונת
   "מתרגלים", כדי ששחזורים ובנקי-תרגול יוצגו באותה שפה. */
function examListFrag(exams, c) {
  const wrap = el('div');

  /* כשכל המבחנים בקבוצה רשמיים — התג עולה לכותרת הקבוצה במקום לחזור על כל
     כרטיס (20× "✓ רשמי" היה רעש). בקבוצה מעורבת התג נשאר פר-כרטיס, כי שם
     הוא באמת מבחין. */
  const allOfficial = (arr) => arr.every((e) => e.official === true);

  /* קיפול שנים ישנות: שלוש השנים האחרונות גלויות, השאר מאחורי "שנים קודמות".
     חיתוך לפי שנה ולא לפי מספר מבחנים — כך מועד א׳+ב׳ של אותה שנה לא נפרדים.
     מבחן בלי שנה נשאר תמיד גלוי. */
  const yearSplitGrid = (arr, hideOff) => {
    const frag = document.createDocumentFragment();
    const years = [...new Set(arr.map((e) => e.year).filter(Boolean))].sort((a, b) => b - a);
    const recent = new Set(years.slice(0, 3));
    const fresh = arr.filter((e) => !e.year || recent.has(e.year));
    const old = arr.filter((e) => e.year && !recent.has(e.year));
    const grid = el('div', 'exam-cgrid');
    fresh.forEach((e) => grid.append(examCardCompact(e, hideOff)));
    frag.append(grid);
    if (old.length) {
      const acc = el('details', 'years-acc');
      const sum = el('summary');
      sum.append(el('span', null,
        `🗓️ שנים קודמות — ${plural(old.length, 'מבחן', 'מבחנים')} (${years.slice(3).join(' · ')})`));
      sum.append(el('span', 'chev', '⌄'));
      sum.title = 'הצגת השחזורים מהשנים הישנות יותר';
      acc.append(sum);
      const g = el('div', 'exam-cgrid');
      old.forEach((e) => g.append(examCardCompact(e, hideOff)));
      acc.append(g);
      frag.append(acc);
    }
    return frag;
  };

  /* מבחן בלוק: בתוך כל מקצוע, קבוצות לפי סוג הבנק (series) — מבחני סוף קודם,
     אחר כך בחנים ומעבדות, רשמיים ואוספים. ינון (23/09): „שיהיה נעים לעין, לא
     מבלבל, וניתן למעקב.” בתוך קבוצה הסדר נשאר של examsOf — מהמחזור החדש לישן. */
  const SERIES_HEAD = {
    exam: ['📝 מבחני סוף', 'המבחנים של הקורסים שקדמו לתוכנית'],
    quiz: ['🧪 בחנים ומעבדות', 'בחני כניסה, בחני מעבדה ובחנים לאורך הקורס'],
    official: ['✓ מאגרים וחשיפות רשמיים', 'נוסח ומפתח של הקורס עצמו'],
    bank: ['📚 אוספים נוספים', 'שאלות שנאספו מכמה מקורות'],
  };
  if (subjectsOf(c).length && exams.every((e) => e.series)) {
    const byPart = {};
    exams.forEach((e) => (byPart[e.part || ''] ||= []).push(e));
    const parts = Object.keys(byPart);
    parts.forEach((part) => {
      if (part && parts.length > 1) {
        const ph = el('div', 'part-head');
        ph.append(el('h3', null, part));
        wrap.append(ph);
      }
      Object.keys(SERIES_HEAD).forEach((sr) => {
        const arr = byPart[part].filter((e) => e.series === sr);
        if (!arr.length) return;
        const [ttl, sub] = SERIES_HEAD[sr];
        const ph = el('div', 'part-head');
        ph.append(el('h3', null, ttl));
        const n = arr.reduce((t, e) => t + e.count, 0);
        const pill = el('span', 'pill', `${plural(arr.length, 'מבחן', 'מבחנים')} · ${n} שאלות`);
        pill.title = sub;
        ph.append(pill);
        wrap.append(ph);
        const grid = el('div', 'exam-cgrid');
        /* בעמוד המקצוע שם המקצוע כבר בכותרת — „פרזיטולוגיה · ” בכל כרטיס הוא רעש.
           הכותרת המלאה נשארת בכל מקום אחר (תרגול מעורב, חיפוש, סימולציה). */
        const pre = part ? part + ' · ' : null;
        arr.forEach((e) => grid.append(examCardCompact(e, sr === 'official',
          pre && e.title.startsWith(pre) ? e.title.slice(pre.length) : null)));
        wrap.append(grid);
      });
    });
    return wrap;
  }

  if (c.flatExams) {
    const hideOff = allOfficial(exams);
    if (hideOff && exams.length > 2) wrap.append(el('div', 'zone-note', '✓ כל המבחנים כאן רשמיים'));
    wrap.append(yearSplitGrid(exams, hideOff));
  } else {
    const byPart = {};
    exams.forEach((e) => (byPart[e.part || ''] ||= []).push(e));
    Object.keys(byPart).sort().forEach((part) => {
      const hideOff = allOfficial(byPart[part]);
      if (part) {
        const ph = el('div', 'part-head');
        ph.append(el('h3', null, part));
        const n = byPart[part].reduce((a, e) => a + e.count, 0);
        const bits = [`${plural(byPart[part].length, 'מבחן', 'מבחנים')} · ${n} שאלות`];
        if (hideOff && byPart[part].length > 2) bits.push('✓ כולם רשמיים');
        ph.append(el('span', 'pill', bits.join(' · ')));
        wrap.append(ph);
      }
      wrap.append(yearSplitGrid(byPart[part], hideOff && byPart[part].length > 2));
    });
  }
  return wrap;
}

/* כרטיס שחזור צפוף — כותרת, שנה, מס' שאלות, אינדיקציה קטנה של "רשמי", ופס דק.
   בלי התגיות החוזרות (שחזור/מאסטר רשמי בכל כרטיס) שהיו רעש; המידע הזה עולה
   ממילא מכותרת הזונה. משאיר את הרשימה קצרה ומסודרת. */
function examCardCompact(m, hideOfficial, shownTitle) {
  const s = quickScore(m);
  const a = el('a', 'exam-c');
  a.dataset.tour = 'exam';
  a.href = '#/exam/' + m.id;
  a.append(el('div', 'exam-c-ttl', shownTitle || m.title));
  if (shownTitle && shownTitle !== m.title) a.title = m.title;
  const meta = el('div', 'exam-c-meta');
  /* שנה שכבר כתובה בכותרת לא חוזרת במטא (בנקי מבחן בלוק: „… · 2022 · מועד א׳”) */
  if (m.year && !(shownTitle || m.title).includes(String(m.year))) meta.append(el('span', 'exam-c-yr', m.year));
  meta.append(el('span', null, `${m.count} שאלות`));
  if (m.official === true && !hideOfficial) meta.append(el('span', 'exam-c-off', '✓ רשמי'));
  else if (m.official === false) meta.append(el('span', null, 'שחזור סטודנטים'));
  a.append(meta);
  const pct = s.answered ? (s.correct / s.answered) * 100 : 0;
  const bar = el('div', 'exam-c-bar');
  const f = el('i');
  f.style.width = s.answered ? Math.round((s.answered / m.count) * 100) + '%' : '0%';
  if (s.answered) f.classList.add(pct >= 70 ? 'good' : 'bad');
  bar.append(f);
  a.append(bar);
  if (s.answered) {
    /* ירדן בסקר: „ראיתי כזה 50/50 שאלות שעשית על שחזור מ״ז, ועכשיו האפליקציה
       השתנתה ואני לא רואה את זה. זה היה פיצ׳ר טוב.” היא צודקת — המספר הזה
       הוסר בשדרוג העיצוב, והנשאר (`נכונות/נענו · אחוז`) עונה על שאלה אחרת
       לגמרי. **כיסוי** ו**איכות** הם שני דברים: „ענית על 50 מתוך 50” אומר
       שסיימת, „42 מתוך 50 נכונות” אומר כמה ידעת. הרוחב של הפס תמיד קידד את
       הכיסוי, אבל בלי מספר אי אפשר לדעת אם נשארו שאלות. */
    const sc = el('div', 'exam-c-score');
    const cov = el('span', 'exam-c-cov',
      s.answered >= m.count ? `הושלם · ${m.count} שאלות` : `${s.answered}/${m.count} נענו`);
    sc.append(cov);
    const qual = el('span', null, `${s.correct}/${s.answered} · ${Math.round(pct)}%`);
    qual.style.color = pct >= 70 ? 'var(--good)' : 'var(--bad)';
    sc.append(qual);
    a.append(sc);
  }
  return a;
}

/* ================= קופסת ההסבר =================
   ההסברים בארכיון נכתבו כפסקה אחת ארוכה, אבל המבנה שלהם קבוע: קודם למה
   התשובה הנכונה נכונה, ואחר כך פסילה של כל מסיח בנפרד. כשזה מוצג כבלוק
   טקסט אחד צריך לסרוק אותו בעיניים כדי למצוא את המסיח שבחרת — אז המנוע
   מפרק את הפסקה לתבנית: כותרת "למה זה נכון", ומתחתיה פסילה לכל מסיח, עם
   מספר המסיח כמו בשאלה עצמה, והפסילה שלך מסומנת.

   כל זה קורה ברינדור בלבד: אין שינוי בקבצי ה-JSON, וכשההסבר לא בנוי כך
   (רוב הבנקים) הוא מוצג בדיוק כמו קודם, רק עם ריווח וטיפוגרפיה טובים יותר.

   ⚠️ עברית ורג׳קס: אסור לכתוב `מסיחים?` — ה-? נדבק ל-ם ומייצר "מסיחי".
   כל ריבוי בקבוצה מפורשת: (?:מסיח|מסיחים). */
const EX_ORD_M = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי'];
const EX_ORD_F = ['ראשונה', 'שנייה', 'שלישית', 'רביעית', 'חמישית'];
const EX_WEND = '(?![א-ת])';                       // סוף מילה עברית (\b לא עובד על עברית)
const EX_MAS = '(?:ה)?(?:מסיח|מסיחים)';
const EX_REJ_START = new RegExp(
  '^(?:' + EX_MAS + EX_WEND + '|(?:התשובה|הקביעה)\\s+ה(?:' + EX_ORD_F.join('|') + ')' + EX_WEND + ')');
const exNorm = (s) => (s || '').replace(/[֑-ׇ"'׳״`]/g, '').replace(/\s+/g, ' ').trim();

/* מה נכתב בפתיח הפסילה: "המסיח הרביעי" → סידורי 4; "מסיח 2" → אינדקס
   0-בסיס; "המסיח שטוען „…”" → ציטוט שאפשר להצליב מול המסיחים עצמם. */
function exReadMark(s) {
  /* "המסיח הראשון והשני שגויים כי…" — פסילה אחת שמדברת על שני מסיחים.
     אין לזה שבב אחד נכון, והורדת הפתיח הייתה משאירה "והשני שגויים כי…".
     אז לא נוגעים: הבולט מוצג בשלמותו, בלי מספר. */
  const SECOND = '\\s+ו(?:' + EX_MAS + '\\s+)?(?:ה)?(?:' +
    EX_ORD_M.concat(EX_ORD_F, ['אחרון', 'אחרונה']).join('|') + ')' + EX_WEND;
  let m = s.match(new RegExp('^' + EX_MAS + '\\s+ה(' + EX_ORD_M.join('|') + ')' + EX_WEND + '(' + SECOND + ')?'));
  if (m) return m[2] ? { kind: 'none', len: 0 } : { kind: 'ord', n: EX_ORD_M.indexOf(m[1]) + 1, len: m[0].length };
  m = s.match(new RegExp('^(?:' + EX_MAS + '|התשובה|הקביעה)\\s+ה(' + EX_ORD_F.join('|') + ')' + EX_WEND + '(' + SECOND + ')?'));
  if (m) return m[2] ? { kind: 'none', len: 0 } : { kind: 'ord', n: EX_ORD_F.indexOf(m[1]) + 1, len: m[0].length };
  m = s.match(new RegExp('^' + EX_MAS + '\\s+(\\d)(?!\\d)'));
  if (m) return { kind: 'zero', n: +m[1], len: m[0].length };
  return { kind: 'none', len: 0 };
}

/* זוגות מירכאות, כל זוג בנפרד — כך גרש בתוך ציטוט („המוט 'אוסף' שדות”)
   לא חותך את הלכידה באמצע. הגרש הבודד אחרון, כי הוא גם משמש לקיצורים. */
const EX_Q_PAIRS = [['„', '”'], ['"', '"'], ['״', '״'], ["'", "'"]];
const exQuoteRe = (a, b, anchor) =>
  new RegExp((anchor ? '^' + EX_MAS + '\\s+(?:שטוען|הטוען|על)\\s*' : '') +
    a + '([^' + b + ']{5,})' + b + (anchor ? '\\s*' : ''));
/* מוציא את הציטוט מהמשפט. anchor=true → רק כפתיח, ואז len מאפשר להוריד אותו. */
function exQuoteOf(s, anchor) {
  for (const [a, b] of EX_Q_PAIRS) {
    const m = s.match(exQuoteRe(a, b, anchor));
    if (m) return { q: m[1], len: m[0].length };
  }
  return null;
}

/* "המסיח שטוען שהתדירות תקטן שגוי כי…" / "המסיח על מבנה מוצק…" — פתיח
   שמצטט את המסיח בלי מירכאות. group1 = כל הפתיח (מה שמורידים כשיש שבב),
   group2 = הטענה עצמה, שאותה מצליבים מול המסיחים. */
const EX_CLAIM = new RegExp(
  '^(' + EX_MAS + '\\s+(?:שטוען|הטוען|על)\\s+(.{6,140}?))' +
  '(?:\\s+(?:שגוי|שגויה|שגויים|מפתה|נכון|נכונה|מתאר|מתארת|מבלבל|מחליף|מגזים|מייבא|מפספס|מייחס|הופך|אינו|אינה|אינם|הוא|היא)' + EX_WEND + '|[.,]|$)');
/* מילות קישור — נשארות בכל מסיח ולכן לא מזהות אף אחד מהם. */
const EX_STOP = new Set(['של', 'את', 'כי', 'אבל', 'אינו', 'אינה', 'לא', 'הוא', 'היא', 'כך', 'ולכן', 'לכן',
  'יותר', 'אשר', 'גם', 'רק', 'כל', 'זה', 'זו', 'שגוי', 'מפתה', 'נכון', 'בגלל', 'עקב', 'מכיוון', 'משום',
  'אך', 'או', 'עם', 'ללא', 'בין', 'על', 'אל', 'מן', 'יש', 'אין', 'כאשר', 'אם', 'כמו', 'בעוד', 'ואילו',
  'שהם', 'שהוא', 'שהיא']);

/* מצליב טענה מצוטטת מול המסיחים לפי מילות תוכן. דורש שני מילים משותפות
   לפחות ומנצח יחיד — אחרת אין שבב. */
function exMatchClaim(claim, opts, aIdx) {
  const toks = [...new Set(exNorm(claim).split(' ')
    .map((w) => w.replace(/[^א-תa-zA-Z0-9]/g, ''))
    .filter((w) => w.length >= 3 && !EX_STOP.has(w)))];
  if (toks.length < 2) return null;
  const scores = opts.map((o, k) => {
    if (k === aIdx) return -1;
    const no = exNorm(o);
    return toks.filter((t) => no.includes(t)).length;
  });
  let best = -1, at = -1, second = -1;
  scores.forEach((s, k) => { if (s > best) { second = best; best = s; at = k; } else if (s > second) second = s; });
  return best >= 2 && best > second ? at : null;
}

/* מפרק הסבר ל-{head, items}. מחזיר null אם אין בו פסילות — ואז המנוע
   מציג את הטקסט כמו שהוא. */
function parseExplain(text, item) {
  const raw = (text || '').trim();
  if (!raw) return null;
  const lead = [], rej = [];
  /* חלק מההסברים כבר כתובים בבולטים: "…הסבר. • 'לא תשתנה' — נכון רק אם…".
     שם הפיצול הוא ה-• עצמו, ולא תחילת משפט. */
  if (raw.includes('•')) {
    const parts = raw.split(/\s*•\s*/).filter(Boolean);
    lead.push(parts[0]);
    parts.slice(1).forEach((s) => rej.push({ sents: [s] }));
  } else {
    for (const s of raw.split(/(?<=\.)\s+(?=\S)/)) {
      if (EX_REJ_START.test(s)) rej.push({ sents: [s] });
      else if (rej.length) rej[rej.length - 1].sents.push(s);   // המשך של אותה פסילה
      else lead.push(s);
    }
  }
  if (!rej.length) return null;

  const opts = item.opts || [];
  const nOpt = opts.length;
  const marks = rej.map((r) => exReadMark(r.sents[0]));

  /* מיפוי לפי ציטוט — הוודאי מכולם: הטקסט המצוטט מופיע במסיח אחד ויחיד.
     כשהציטוט הוא הפתיח ("המסיח שטוען „…”"), הוא גם יורד מהטקסט: השבב
     והרמז המרחף כבר אומרים באיזה מסיח מדובר. */
  rej.forEach((r, i) => {
    const lead = exQuoteOf(r.sents[0], true);
    const hit = lead || exQuoteOf(r.sents[0], false);
    if (!hit) return;
    /* ציטוט מקוצר נגמר ב"…" — שלוש נקודות שלא קיימות באף מסיח, והיו
       מפילות את ההשוואה בדיוק בציטוטים הקצרים. */
    const nq = exNorm(hit.q).replace(/[…]|\.\.\./g, '').trim().slice(0, 16);
    if (nq.length < 4) return;
    const hits = opts.map((o, k) => (k !== item.a && exNorm(o).includes(nq) ? k : -1)).filter((k) => k >= 0);
    if (hits.length !== 1) return;
    r.opt = hits[0];
    if (lead) marks[i] = { kind: 'quote', len: lead.len };
  });

  /* מיפוי לפי טענה מצוטטת בלי מירכאות ("המסיח שטוען ש…"). */
  rej.forEach((r, i) => {
    if (r.opt != null || marks[i].kind !== 'none') return;
    const m = r.sents[0].match(EX_CLAIM);
    if (!m) return;
    /* "שטוען ש<טענה>" — ה-ש׳ הזאת היא לרוב מילת שעבוד, אבל לא תמיד: ב"המסיח
       שטוען שמאלה" היא האות הראשונה של המילה. אז מנסים קודם כמו שנכתב, ורק
       אם זה לא נצמד לאף מסיח מנסים בלי ה-ש׳. */
    const hit = exMatchClaim(m[2], opts, item.a) ?? exMatchClaim(m[2].replace(/^ש/, ''), opts, item.a);
    if (hit == null) return;
    r.opt = hit;
    /* מורידים את הפתיח רק כשהוא באמת נגמר לפני "שגוי כי" — בטענה קצרה
       הרג׳קס מגלגל מעליו, ואז חיתוך היה משאיר משפט קטוע. */
    if (!/\s(?:שגוי|מפתה|נכון|מתאר)/.test(m[2])) marks[i] = { kind: 'claim', len: m[1].length };
  });

  /* מיפוי לפי מספר סידורי. בארכיון יש שתי אמנות: "המסיח השני" = התשובה
     השנייה בשאלה, או המסיח השני מבין המסיחים (בלי לספור את הנכונה). אמנה
     תקפה רק אם *כל* המספרים בהסבר מתיישבים איתה — מסיח קיים, לא הנכונה,
     ובלי כפילות. בוחרים רק כשאמנה אחת תקפה, או ששתיהן מסכימות.
     שבב שמצביע על המסיח הלא-נכון גרוע בהרבה מאין שבב בכלל. */
  const ords = marks.map((m) => (m.kind === 'ord' || m.kind === 'zero' ? m.n : null));
  const dis = opts.map((_, k) => k).filter((k) => k !== item.a);
  const byPos = ords.map((n) => (n == null ? null : n - 1));           // מקום התשובה בשאלה
  const byDis = ords.map((n) => (n == null ? null : dis[n - 1] ?? null)); // מקום בין המסיחים
  const byZero = ords.slice();                                        // "מסיח 2" — כבר אינדקס
  const fits = (arr) => {
    const seen = new Set();
    for (let i = 0; i < arr.length; i++) {
      if (ords[i] == null) continue;
      const v = arr[i];
      if (v == null || !(v >= 0 && v < nOpt) || v === item.a || seen.has(v)) return false;
      seen.add(v);
    }
    return ords.some((n) => n != null);
  };
  let map = null;
  if (marks.some((m) => m.kind === 'zero')) map = fits(byZero) ? byZero : null;
  else {
    const okP = fits(byPos), okD = fits(byDis);
    if (okP && okD) map = byPos.every((v, i) => v === byDis[i]) ? byPos : null;
    else map = okP ? byPos : okD ? byDis : null;
  }
  if (map) map.forEach((v, i) => { if (rej[i].opt == null && v != null) rej[i].opt = v; });

  /* כשיש שבב עם המספר, הפתיח "המסיח הרביעי" מיותר — הוא כבר על השבב.
     אבל אם מה שנשאר קצר מדי או פותח ב-ו׳ החיבור, הפתיח היה חלק מהמשפט
     ולא תווית — ואז משאירים את הבולט כמו שנכתב. */
  const items = rej.map((r, i) => {
    const full = r.sents.join(' ');
    let t = full;
    if (r.opt != null && marks[i].len) {
      const cut = full.slice(marks[i].len).replace(/^[\s,–—:־-]+/, '');
      /* ו׳ החיבור או מילת זיקה ("שבה", "בו") בפתח מה שנשאר = הפתיח היה חלק
         מהמשפט, וחיתוך משאיר משפט שתלוי באוויר. */
      if (cut.length >= 15 && !/^(?:ו|ש?ב[הוםן]?\s|שב?[הו]\s)/.test(cut)) t = cut;
    }
    return { opt: r.opt ?? null, text: t };
  });
  /* סדר לפי מספר המסיח — אותו סדר שבו הוא קרא אותם בשאלה. הלא-ממופים
     בסוף, בסדר שבו נכתבו. */
  items.sort((a, b) => (a.opt == null) - (b.opt == null) || (a.opt ?? 0) - (b.opt ?? 0));

  /* "התשובה הנכונה נכונה כי…" — מיותר מתחת לכותרת "למה זה נכון". */
  const head = lead.join(' ').replace(/^התשובה\s+הנכונה\s+נכונה\s+(?:כי|משום\s+ש|מפני\s+ש)\s*/, '');
  return { head, items };
}

/* קופסת ההסבר להצגה. chosen = המסיח שנבחר (אם נבחר), כדי לסמן את הפסילה
   שמסבירה בדיוק את הטעות שלך. */
function explainBox(text, item, chosen = null) {
  const box = el('div', 'explain');
  const p = parseExplain(text, item);
  /* הסבר שאינו בנוי כתבנית מקבל את אותה כותרת בלבד — כך לכל קופסת משוב
     באתר יש אותה אנטומיה, גם במקצועות שההסברים בהם פסקה אחת. */
  if (!p) {
    box.append(el('div', 'ex-t', 'ההסבר'));
    box.append(el('p', 'ex-head', text));
    return box;
  }

  if (p.head) {
    box.append(el('div', 'ex-t', 'למה זה נכון'));
    box.append(el('p', 'ex-head', p.head));
  }
  /* תמיד בלשון רבים: בולט אחד לא אומר שנפסל מסיח אחד — לפעמים הוא פוסל
     את כל השאר במשפט אחד. */
  box.append(el('div', 'ex-t', 'למה השאר נפסלים'));
  const ul = el('ul', 'ex-rej');
  p.items.forEach((r) => {
    const mine = r.opt != null && r.opt === chosen;
    const li = el('li', mine ? 'mine' : null);
    li.append(el('span', 'ex-n', r.opt != null ? String(r.opt + 1) : '✗'));
    /* מספר המסיח לבד לא מזכיר מה היה כתוב בו — הטקסט המלא יושב ברמז מרחף,
       כמו בכל כפתור באתר, בלי להכריח לקרוא את המסיח פעם שנייה. */
    if (r.opt != null && item.opts && item.opts[r.opt]) li.title = item.opts[r.opt];
    const body = el('span', 'ex-b', r.text);
    if (mine) body.prepend(el('b', 'ex-mine', 'זה מה שבחרת · '));
    li.append(body);
    ul.append(li);
  });
  box.append(ul);
  return box;
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
  if (exam.course) view.dataset.course = exam.course;
  playQuestions({
    key: exam.id,
    courseId: exam.course,
    title: exam.title,
    subtitle: `${c ? c.name : ''} ${exam.part || ''} · ${exam.questions.length} שאלות`.trim(),
    note: exam.note,
    spotlight: exam.spotlight || null,
    // examId+idx מזהים כל שאלה באופן יציב, כדי שנוכל לסמן אותה כ"נראתה"
    // גם כשהיא מוצגת מתוך תרגול חופשי ולא מתוך המבחן שלה.
    questions: exam.questions.map((q, i) => ({ ...q, examId: exam.id, idx: i })),
    persist: true,
    allowExam: true,   // מבחן ספציפי → מציעים גם "מצב מבחן" (משוב בסוף)
    /* בשחזור אמיתי מספור המסיחים הוא חלק מהמסמך ההיסטורי — סטודנטים מצליבים
       אותו מול ה-PDF ומול מפתח הפתרונות, ו"תשובה 3" חייבת להישאר תשובה 3.
       בבנקי תרגול וב-High Yield אין מסמך להצליב מולו, ושם מערבבים. */
    keepOptOrder: exam.kind === 'shichzur',
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
  set(id, i, v) {
    const d = this.read(); if (v) d[`${id}#${i}`] = 1; else delete d[`${id}#${i}`]; this.write(d);
    if (v) window.Cloud?.queue('cardsRead', `${id}#${i}`, 1); else window.Cloud?.queueDelete('cardsRead', `${id}#${i}`);
  },
  clear(id) {
    const d = this.read(); Object.keys(d).forEach((k) => k.startsWith(id + '#') && delete d[k]); this.write(d);
    window.Cloud?.queueClearPrefix('cardsRead', id + '#');
  },
};

/* התקדמות השננת — לייטנר עם ריווח (SRS). לכל פריט רשומה {b,t}: b=תיבה
   (0=חדש/נכשל … 3=נשלט), t=זמן הנראות האחרונה (ms). ממופתח לפי מפתח יציב
   `${deckId}#${מפתח-הפריט}`. תאימות לאחור: ערך מספרי ישן נקרא כ-{b:n,t:0}.
   ה"בשלוּת" לחזרה נגזרת מ-t + מרווח לפי התיבה: ככל שנשלט יותר, חוזר בהמשך. */
const SHINUN_KEY = 'shichzurim.shinunProg';
/* מרווחים קצרים בכוונה — המבחן בעוד ימים, לא חודשים. */
const SHINUN_IVL = [0, 10 * 60e3, 24 * 3600e3, 3 * 24 * 3600e3];
const shinunProg = {
  read() { try { return JSON.parse(localStorage.getItem(SHINUN_KEY)) || {}; } catch { return {}; } },
  write(d) { localStorage.setItem(SHINUN_KEY, JSON.stringify(d)); },
  rec(key, d) { const v = (d || this.read())[key]; if (v == null) return null; return typeof v === 'number' ? { b: v, t: 0 } : v; },
  box(key, d) { const r = this.rec(key, d); return r ? r.b : 0; },
  seen(key, d) { return this.rec(key, d) != null; },
  /* בשל לחזרה: פריט חדש תמיד, אחרת אם עבר מספיק זמן מאז שנראה. */
  due(key, now, d) { const r = this.rec(key, d); if (!r) return true; return (now - (r.t || 0)) >= SHINUN_IVL[Math.min(3, r.b)]; },
  mark(key, box, now) {
    const d = this.read();
    d[key] = { b: box, t: now };
    this.write(d);
    window.Cloud?.queue('shinunProg', key, d[key]);
  },
  reset(key) {
    const d = this.read(); delete d[key]; this.write(d);
    window.Cloud?.queueDelete('shinunProg', key);
  },
  clear(id) {
    const d = this.read(); Object.keys(d).forEach((k) => k.startsWith(id + '#') && delete d[k]); this.write(d);
    window.Cloud?.queueClearPrefix('shinunProg', id + '#');
  },
};
/* חגיגת שליטה בקבוצה — נשמר כדי לחגוג פעם אחת בלבד לכל קבוצה. */
const SHINUN_CELEB_KEY = 'shichzurim.shinunCeleb';
const shinunCeleb = {
  read() { try { return JSON.parse(localStorage.getItem(SHINUN_CELEB_KEY)) || {}; } catch { return {}; } },
  has(k) { return !!this.read()[k]; },
  add(k) { const d = this.read(); d[k] = 1; try { localStorage.setItem(SHINUN_CELEB_KEY, JSON.stringify(d)); } catch {} },
  del(k) { const d = this.read(); delete d[k]; try { localStorage.setItem(SHINUN_CELEB_KEY, JSON.stringify(d)); } catch {} },
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
  if (deck.course) view.dataset.course = deck.course;
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
  reset.title = 'מחיקת סימוני „נקרא” מכל הכרטיסים';
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
    chk.title = done ? 'ביטול סימון הקריאה' : 'סימון הכרטיס כנקרא — מתעדכן במונה ההתקדמות';
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
      rel.append(el('span', 'lcard-rel-lbl', `לתרגול — ${plural(card.related.length, 'שאלה', 'שאלות', true)} מהארכיון על הנושא`));
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

/* ================= שננת — שינון בעל־פה =================
   מסך אחד, שלושה מצבים: 🎴 היפוך (לייטנר) · 📋 כסה־וגלה · 📝 מבחן.
   התוכן מונע־דאטה (kind:'shinun', groups[].items[]). המסיחים במצב המבחן
   נשלפים רק מאותה `family` — תשובות בנות־בלבול — ופריט בלי משפחה מספקת
   פשוט לא נכלל במבחן, כדי לא לזייף אתגר. */
const shinunNorm = (s) => (s || '').replace(/[֑-ׇ]/g, '').replace(/["'׳״`\s]/g, '').toLowerCase();

async function renderShinun(courseId, topicFilter) {
  setNav('home');
  view.innerHTML = '<div class="empty"><span class="ico">⏳</span><b>טוען…</b></div>';
  /* הראוט הוא #/shinun/<course> — מאתרים את חפיסת השננת של הקורס (אחת לקורס). */
  const meta = EXAMS.find((e) => e.course === courseId && e.kind === 'shinun');
  if (!meta) { view.innerHTML = ''; view.append(emptyState('🤷', 'אין שננת למקצוע הזה', 'עדיין לא נבנתה.')); return; }
  const id = meta.id;
  let deck;
  try { deck = await loadExam(id); }
  catch (err) { view.innerHTML = ''; view.append(emptyState('⚠️', 'לא הצלחתי לטעון', String(err.message))); return; }

  const c = courseOf(deck.course);
  if (deck.course) view.dataset.course = deck.course;
  /* '@pharma' — היקף מקצוע בתוך חפיסת הקורס (בלוק): רק הפריטים שהנושא שלהם
     שייך למקצוע. המפתח של ההתקדמות לא משתנה, אז מה שנלמד נשאר. */
  const sKey = scopeKey(topicFilter);
  const subj = sKey ? subjectOf(courseId, sKey) : null;
  if (sKey) topicFilter = null;

  /* השטחה: כל פריט נושא את הקבוצה שלו ומפתח יציב לפי front. */
  const all = [];
  (deck.groups || []).forEach((g) => (g.items || []).forEach((it) => {
    if (!it.front || !it.back) return;
    if (subj && !(subj.topics || []).includes(it.topic)) return;
    all.push({ ...it, group: g.label, key: id + '#' + shinunNorm(it.front) });
  }));
  const groupLabels = [...new Set(all.map((it) => it.group))];
  const topics = [...new Set(all.map((it) => it.topic).filter(Boolean))];

  /* משפחות למסיחים. פריט "כשיר למבחן" = יש לו family עם לפחות 2 חברים
     (כדי שיהיה לפחות מסיח אחד); עדיף 4. */
  const fam = {};
  all.forEach((it) => { if (it.family) (fam[it.family] ||= []).push(it); });

  view.innerHTML = '';
  view.append(crumb(subj ? `${c.name} · ${subj.name}` : c ? c.name : 'חזרה', '#/course/' + deck.course + (subj ? '/' + encodeURIComponent(subj.key) : '')));
  const head = el('div', 'page-head');
  head.append(el('h1', null, subj ? `🧠 i❤️Shinun — ${subj.name}` : '🧠 ' + (deck.title || 'i❤️Shinun')));
  if (deck.heroSub && !subj) head.append(el('p', null, deck.heroSub));
  if (subj) head.append(el('p', null, `${all.length} עובדות לבעל-פה במקצוע הזה — היפוך, כסה-וגלה, מבחן`));
  view.append(head);
  if (deck.draft) {
    const d = el('div', 'cards-note');
    d.innerHTML = '📝 <b>טיוטה</b> — התוכן נשאב מהמילון, הנוסחאות והכרטיסיות; טרם עבר ליטוש והעשרה.';
    view.append(d);
  }

  /* פוש חד-פעמי למי שנכנס לאופציה החדשה — מסביר את שלושת המצבים, ואז נעלם. */
  const INTRO_KEY = 'shichzurim.shinunIntro';
  if (!localStorage.getItem(INTRO_KEY)) {
    const intro = el('div', 'intro shn-intro');
    const txt = el('div');
    txt.append(el('b', null, '🧠 חדש: i❤️Shinun — לדעת בעל־פה'));
    txt.append(el('span', null, 'כאן עוברים על החומר צד-מול-צד, בלי מסיחים ובלי ניחושים. ' +
      'שלושה מצבים: 🎴 היפוך (ידעתי/לא), 📋 כסה־וגלה לחזרה מהירה, ו-📝 מבחן קצר.'));
    intro.append(txt);
    const close = el('button', 'btn ghost', 'הבנתי, בואו נתחיל');
    close.title = 'סגירת ההסבר — לא יופיע שוב';
    close.onclick = () => { localStorage.setItem(INTRO_KEY, '1'); intro.remove(); };
    const acts = el('div', 'btn-row'); acts.append(close); intro.append(acts);
    view.append(intro);
  }

  /* מצב פעיל + מסנן קבוצה. topicFilter (מקישור מהסיכום) מצמצם התחלתית. */
  const state = { mode: 'flip', group: 'all', topic: topicFilter || null };
  const filtered = () => all.filter((it) =>
    (state.group === 'all' || it.group === state.group) &&
    (!state.topic || it.topic === state.topic));

  /* ---- סרגל מצבים ---- */
  const tabs = el('div', 'shn-tabs');
  /* מצב השמע מוצג רק אם לדפדפן יש בכלל מנוע הקראה. את *קיום הקול העברי*
     אי אפשר לבדוק כאן — רשימת הקולות נטענת אסינכרונית ולעיתים ריקה ברינדור
     הראשון — ולכן זה נבדק בתוך המצב עצמו. */
  const MODES = [
    ['flip', '🎴 היפוך', 'כרטיסי היפוך — ידעתי/עוד לא, עם חזרה חכמה על מה שקשה'],
    ['list', '📋 כסה־וגלה', 'רשימה לחזרה מהירה — לחיצה על שורה חושפת את התשובה'],
    ['quiz', '📝 מבחן', 'מבחן אמריקאי קצר עם מסיחים דומים מאותה משפחה']];
  if (speechOK()) MODES.push(['audio', '🎧 שמע', 'הקראה רציפה של הכרטיסים — לשינון בהאזנה']);
  const tabBtns = {};
  MODES.forEach(([m, label, tip]) => {
    const b = el('button', 'shn-tab', label); b.type = 'button';
    b.title = tip;
    b.addEventListener('click', () => { state.mode = m; sync(); });
    tabBtns[m] = b; tabs.append(b);
  });
  view.append(tabs);

  /* ---- מסנני קבוצה + נושא ---- */
  const filters = el('div', 'shn-filters');
  const mkChip = (label, active, on) => {
    const b = el('button', 'shn-chip' + (active ? ' on' : ''), label); b.type = 'button';
    b.title = 'סינון — הצגת הפריטים של הקבוצה הזאת בלבד (המספר: כמה כבר נשלטו)';
    b.addEventListener('click', on); return b;
  };
  /* מד שליטה: כמה מכל קבוצה כבר נשלטו (box≥3). מוצג על הצ׳יפ, ו-✓ כשהכול נשלט. */
  const groupStats = () => {
    const d = shinunProg.read();
    const st = {};
    all.forEach((it) => {
      const s = (st[it.group] ||= { done: 0, total: 0 });
      s.total++; if (shinunProg.box(it.key, d) >= 3) s.done++;
    });
    return st;
  };
  const buildFilters = () => {
    filters.innerHTML = '';
    const st = groupStats();
    const allDone = all.filter((it) => shinunProg.box(it.key) >= 3).length;
    filters.append(mkChip(`הכל · ${allDone}/${all.length}`, state.group === 'all', () => { state.group = 'all'; sync(); }));
    groupLabels.forEach((g) => {
      const s = st[g] || { done: 0, total: 0 };
      const full = s.total && s.done === s.total;
      const chip = mkChip(`${full ? '✓ ' : ''}${g} · ${s.done}/${s.total}`, state.group === g, () => { state.group = g; sync(); });
      if (full) chip.classList.add('done');
      filters.append(chip);
    });
    if (state.topic) {
      const t = el('span', 'shn-topic', '🎯 ' + state.topic + ' ✕');
      t.addEventListener('click', () => { state.topic = null; sync(); });
      filters.append(t);
    }
  };
  view.append(filters);

  const body = el('div', 'shn-body');
  view.append(body);

  /* מאזין המקלדת של מצב ההיפוך — מוסר בכל החלפת מצב/מסנן כדי לא לדלוף. */
  let keyHandler = null;
  function sync() {
    if (keyHandler) { document.removeEventListener('keydown', keyHandler); keyHandler = null; }
    MODES.forEach(([m]) => tabBtns[m].classList.toggle('on', state.mode === m));
    buildFilters();
    body.innerHTML = '';
    stopSpeech();                    // החלפת מצב/מסנן עוצרת הקראה שרצה
    if (state.mode === 'flip') flipMode();
    else if (state.mode === 'list') listMode();
    else if (state.mode === 'audio') audioMode();
    else quizMode();
    toTop();
  }

  /* ═════ מצב שמע — לימוד בהליכה ═════
     עד היום שום דבר בארכיון לא היה שמיש בלי עיניים, וסטודנטים נוסעים והולכים
     המון. speechSynthesis הוא חלק מהדפדפן: בלי שרת, בלי מפתח, ועובד אופליין.

     ⚠️ מגבלה אמיתית שלא מסתירים מהמשתמש: הקול העברי (כרמית) קורא מונחים
     לטיניים כמו SNARE ו-NADP באיות עברי משובש. לכן הכיתוב אומר את זה מראש,
     והטקסט המוקרא מוצג על המסך במקביל — מי שהמונח יצא לו מוזר יכול לקרוא. */
  function audioMode() {
    const items = filtered();
    if (!items.length) {
      body.append(emptyState('🎧', 'אין פריטים', 'בחר קבוצה או נושא אחר.'));
      return;
    }
    /* בלי קול עברי הדפדפן יקרא עברית במנוע אנגלי, וזה ג׳יבריש גמור. עדיף
       לומר את זה מאשר לתת למישהו ללחוץ ולשמוע רעש. */
    if (!pickHeVoice()) {
      body.append(emptyState('🔇', 'אין קול עברי במכשיר הזה',
        'ההקראה דורשת קול עברי מותקן (במק ובאייפון זו „כרמית”, והיא מגיעה מובנית). ' +
        'בווינדוס/אנדרואיד לפעמים צריך להוסיף אותו בהגדרות השפה.'));
      return;
    }

    const wrap = el('div', 'shn-audio');
    wrap.append(el('p', 'shn-audio-note',
      'הקראה רצופה: רמז, שקט קצר, ואז העובדה. אפשר לנעול מסך ולהמשיך ללכת. ' +
      'מונחים באנגלית עלולים להישמע משובש — הם מוצגים גם על המסך.'));

    const now = el('div', 'shn-audio-now');
    const front = el('div', 'shn-audio-front');
    const back = el('div', 'shn-audio-back');
    now.append(front, back);
    const pos = el('div', 'shn-audio-pos');

    const row = el('div', 'btn-row');
    const playBtn = el('button', 'btn primary', '▶ הפעל');
    playBtn.type = 'button';
    playBtn.title = 'הפעלה או השהיה של ההקראה הרציפה';
    const stopBtn = el('button', 'btn ghost', '⏹ עצור');
    stopBtn.type = 'button';
    stopBtn.title = 'עצירה מלאה וחזרה לתחילת הרשימה';
    stopBtn.disabled = true;
    row.append(playBtn, stopBtn);

    wrap.append(row, pos, now);
    body.append(wrap);

    let i = 0, playing = false;

    const paint = () => {
      const it = items[i];
      pos.textContent = `${i + 1} מתוך ${items.length}`;
      front.textContent = it ? it.front : '';
      back.textContent = '';
    };
    paint();

    async function loop() {
      while (playing && i < items.length) {
        const it = items[i];
        front.textContent = it.front;
        back.textContent = '';
        await speak(it.front);
        if (!playing) break;
        await pause(900);                 // השהייה לשליפה — זה כל העניין
        if (!playing) break;
        back.textContent = it.back;
        await speak(it.back);
        if (!playing) break;
        await pause(500);
        i++;
        pos.textContent = `${Math.min(i + 1, items.length)} מתוך ${items.length}`;
      }
      if (i >= items.length) { i = 0; paint(); }
      playing = false;
      playBtn.textContent = '▶ הפעל';
      stopBtn.disabled = true;
    }

    playBtn.onclick = () => {
      if (playing) { playing = false; stopSpeech(); playBtn.textContent = '▶ הפעל'; stopBtn.disabled = true; return; }
      playing = true;
      playBtn.textContent = '⏸ השהה';
      stopBtn.disabled = false;
      loop();
    };
    stopBtn.onclick = () => {
      playing = false; stopSpeech(); i = 0; paint();
      playBtn.textContent = '▶ הפעל'; stopBtn.disabled = true;
    };
  }

  /* ═════ מצב היפוך (לייטנר + SRS) ═════ */
  function flipMode() {
    const all0 = filtered();
    if (!all0.length) { body.append(emptyState('🤷', 'אין פריטים', 'נסה מסנן אחר.')); return; }

    let reviewAll = false, flipped = false, queue = [];
    let sess = { right: 0, wrong: 0, wrongItems: [] };

    const bar = el('div', 'shn-scorebar'); body.append(bar);
    const celebBox = el('div', 'shn-celeb'); body.append(celebBox);
    const card = el('div', 'shn-flip'); body.append(card);
    /* כפתורי ההערכה מתחת לקלף — קליק עליהם מקדם, קליק על הקלף מהפך. */
    const judge = el('div', 'shn-judge');
    const no = el('button', 'btn shn-no', '✗ עוד לא'); no.type = 'button';
    no.title = 'עוד לא זוכר — הכרטיס יחזור בקרוב (או חץ שמאלה במקלדת)';
    const yes = el('button', 'btn shn-yes', '✓ ידעתי'); yes.type = 'button';
    yes.title = 'ידעתי — הכרטיס יתקדם קופסה ויחזור מאוחר יותר (או חץ ימינה)';
    judge.append(no, yes); body.append(judge);
    const acts = el('div', 'btn-row'); body.append(acts);
    const resetB = el('button', 'btn ghost', '↻ אפס התקדמות'); resetB.type = 'button';
    resetB.title = 'איפוס כל ההתקדמות בשינון — כל הכרטיסים חוזרים להתחלה';

    /* התור: פריטים חדשים או ש„הגיע זמנם” לחזרה (SRS). מה שנשלט ולא בשל — מחוץ
       לסבב, אלא אם ביקשת „חזרה על הכל”. סדר: חדשים קודם, ואז תיבה נמוכה קודם. */
    function buildQueue() {
      const now = Date.now(), d = shinunProg.read();
      let items = all0.filter((it) => reviewAll || !shinunProg.seen(it.key, d) || shinunProg.due(it.key, now, d));
      items = shuffle(items.slice());
      items.sort((a, b) => {
        const na = shinunProg.seen(a.key, d) ? 1 : 0, nb = shinunProg.seen(b.key, d) ? 1 : 0;
        if (na !== nb) return na - nb;
        return shinunProg.box(a.key, d) - shinunProg.box(b.key, d);
      });
      return items;
    }
    function counts() {
      const d = shinunProg.read();
      let nw = 0, learning = 0, known = 0;
      all0.forEach((it) => {
        const seen = shinunProg.seen(it.key, d), b = shinunProg.box(it.key, d);
        if (!seen) nw++; else if (b >= 3) known++; else learning++;
      });
      bar.innerHTML = `חדשים <b>${nw}</b> · בלמידה <b>${learning}</b> · נשלטו <b>${known}</b> · בתור: ${queue.length}`;
    }
    /* חגיגה חד-פעמית כשקבוצה שלמה נשלטה — זה ה„השלמתי נושא”. */
    function checkCeleb(it) {
      const d = shinunProg.read();
      const gitems = all.filter((x) => x.group === it.group);
      const full = gitems.every((x) => shinunProg.box(x.key, d) >= 3);
      const ck = deck.id + '#' + it.group;
      if (full && !shinunCeleb.has(ck)) {
        shinunCeleb.add(ck);
        celebBox.innerHTML = '';
        celebBox.append(el('div', 'shn-celeb-in', `🎉 שלטת בכל „${it.group}”! כל הכבוד.`));
        try { blip('big'); } catch { /* אין סאונד — לא נורא */ }
        setTimeout(() => { if (celebBox.firstChild) celebBox.innerHTML = ''; }, 4500);
      } else if (!full) {
        shinunCeleb.del(ck);   // ירד מתחת למלא (איפוס) — לאפשר חגיגה חוזרת בעתיד
      }
    }
    function renderFace() {
      const it = queue[0];
      card.innerHTML = '';
      card.className = 'shn-flip' + (flipped ? ' is-open' : '');
      card.append(el('div', 'shn-flip-grp', it.group + (it.topic ? ' · ' + it.topic : '')));
      card.append(el('div', 'shn-flip-front', it.front));
      if (flipped) {
        card.append(el('div', 'shn-flip-back', it.back));
        if (it.mnem) { const m = el('div', 'shn-mnem'); m.innerHTML = '💡 ' + it.mnem; card.append(m); }
      } else {
        card.append(el('div', 'shn-flip-hint', 'קליק כדי לחשוף · רווח / →ידעתי / ←עוד לא'));
      }
    }
    function summary() {
      judge.style.display = 'none';
      card.innerHTML = ''; card.className = 'shn-flip is-summary';
      const total = sess.right + sess.wrong, pct = total ? Math.round(sess.right / total * 100) : 0;
      const box = el('div', 'shn-summary');
      box.append(el('div', 'shn-done', total ? '🎉 סבב הושלם!' : '✓ הכול נשלט כרגע'));
      box.append(el('div', 'shn-summary-line', total
        ? `נשלטו ${sess.right} · לחזרה ${sess.wrong} · ${pct}% הצלחה`
        : 'אין פריטים שממתינים לחזרה עכשיו. חזור מאוחר יותר, או „חזרה על הכל”.'));
      card.append(box);
      acts.innerHTML = '';
      if (sess.wrongItems.length) {
        const again = el('button', 'btn primary', '↻ עוד סבב על החלשים'); again.type = 'button';
        again.title = 'סבב חוזר רק על הכרטיסים שסימנת „עוד לא”';
        again.onclick = () => {
          const weak = sess.wrongItems.slice();
          sess = { right: 0, wrong: 0, wrongItems: [] };
          queue = shuffle(weak); acts.innerHTML = ''; acts.append(resetB);
          judge.style.display = ''; flipped = false; renderFace(); counts();
        };
        acts.append(again);
      }
      const allBtn = el('button', 'btn', '🔁 חזרה על הכל'); allBtn.type = 'button';
      allBtn.title = 'סבב על כל הכרטיסים — כולל אלה שכבר נשלטו';
      allBtn.onclick = () => { reviewAll = true; sess = { right: 0, wrong: 0, wrongItems: [] }; restart(); };
      acts.append(allBtn, resetB);
    }
    function next() {
      queue.shift();
      if (!queue.length) { counts(); summary(); return; }
      flipped = false; renderFace(); counts();
    }
    function rate(known) {
      const it = queue[0]; if (!it) return;
      const b = shinunProg.box(it.key);
      if (known) { shinunProg.mark(it.key, Math.min(3, b + 1), Date.now()); sess.right++; }
      else { shinunProg.mark(it.key, 0, Date.now()); sess.wrong++; sess.wrongItems.push(it); }
      checkCeleb(it);
      buildFilters();   // רענון מדי השליטה בצ׳יפים
      next();
    }
    function restart() {
      acts.innerHTML = ''; acts.append(resetB);
      judge.style.display = ''; celebBox.innerHTML = '';
      queue = buildQueue(); flipped = false; counts();
      if (!queue.length) summary(); else renderFace();
    }

    card.onclick = () => { if (queue.length) { flipped = !flipped; renderFace(); } };
    no.addEventListener('click', () => rate(false));
    yes.addEventListener('click', () => rate(true));
    resetB.addEventListener('click', () => {
      all0.forEach((it) => shinunProg.reset(it.key));
      reviewAll = false; sess = { right: 0, wrong: 0, wrongItems: [] };
      buildFilters(); restart();
    });

    keyHandler = (e) => {
      if (!document.body.contains(card)) { document.removeEventListener('keydown', keyHandler); return; }
      if (!queue.length || e.metaKey || e.ctrlKey) return;
      if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); flipped = !flipped; renderFace(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); rate(true); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); rate(false); }
    };
    document.addEventListener('keydown', keyHandler);

    restart();
  }

  /* ═════ מצב כסה־וגלה ═════ */
  function listMode() {
    const pool = filtered();
    if (!pool.length) { body.append(emptyState('🤷', 'אין פריטים', 'נסה מסנן אחר.')); return; }
    const bar = el('div', 'shn-listbar');
    const revealAll = el('button', 'btn btn-sm', '👁️ גלה הכל'); revealAll.type = 'button';
    revealAll.title = 'חשיפה או הסתרה של כל התשובות בבת אחת';
    let open = false;
    revealAll.addEventListener('click', () => {
      open = !open;
      body.querySelectorAll('.shn-row').forEach((r) => r.classList.toggle('open', open));
      revealAll.textContent = open ? '🙈 הסתר הכל' : '👁️ גלה הכל';
    });
    bar.append(el('span', null, `${pool.length} פריטים`), revealAll);
    body.append(bar);

    const byGroup = {};
    pool.forEach((it) => (byGroup[it.group] ||= []).push(it));
    Object.keys(byGroup).forEach((g) => {
      body.append(el('h3', 'shn-grp-h', g));
      byGroup[g].forEach((it) => {
        const row = el('div', 'shn-row');
        row.append(el('div', 'shn-row-f', it.front));
        const b = el('div', 'shn-row-b');
        b.append(el('span', 'shn-row-btext', it.back));
        if (it.mnem) { const m = el('span', 'shn-row-mnem'); m.innerHTML = ' · 💡 ' + it.mnem; b.append(m); }
        row.append(b);
        row.addEventListener('click', () => row.classList.toggle('open'));
        body.append(row);
      });
    });
  }

  /* ═════ מצב מבחן (MCQ, מסיחים מאותה משפחה) ═════ */
  function quizMode() {
    const pool = filtered().filter((it) => it.family && fam[it.family].length >= 2);
    if (!pool.length) {
      body.append(emptyState('🚫', 'אין פריטים כשירים למבחן כאן',
        'מבחן דורש פריטים עם „משפחה” של תשובות בנות־בלבול. נסה קבוצה אחרת, או השתמש בהיפוך.'));
      return;
    }
    let queue = shuffle(pool.slice());
    const tally = { ok: 0, total: 0 };
    const bar = el('div', 'shn-scorebar'); body.append(bar);
    const qbox = el('div', 'shn-quiz'); body.append(qbox);
    const acts = el('div', 'btn-row');
    const next = el('button', 'btn primary', 'הבא ⟵'); next.type = 'button';
    next.title = 'שאלה חדשה מהמאגר';
    acts.append(next); body.append(acts);
    next.addEventListener('click', draw);

    function draw() {
      if (!queue.length) queue = shuffle(pool.slice());
      const it = queue.shift();
      const distract = shuffle(fam[it.family].filter((o) => o.key !== it.key && o.back !== it.back))
        .slice(0, 3).map((o) => o.back);
      const opts = shuffle([it.back, ...distract]);
      bar.innerHTML = tally.total ? `ציון: <b>${tally.ok}/${tally.total}</b>` : 'בחר את התשובה הנכונה';
      qbox.innerHTML = '';
      qbox.append(el('div', 'shn-flip-grp', it.family));
      qbox.append(el('div', 'shn-q', it.front));
      const list = el('div', 'shn-opts');
      let done = false;
      opts.forEach((o) => {
        const b = el('button', 'shn-opt', o); b.type = 'button';
        b.addEventListener('click', () => {
          if (done) return; done = true;
          tally.total++;
          const correct = o === it.back;
          if (correct) tally.ok++;
          list.querySelectorAll('.shn-opt').forEach((x) => {
            x.classList.add('locked');
            if (x.textContent === it.back) x.classList.add('right');
          });
          if (!correct) b.classList.add('wrong');
          if (it.mnem) { const m = el('div', 'shn-mnem'); m.innerHTML = '💡 ' + it.mnem; qbox.append(m); }
          bar.innerHTML = `ציון: <b>${tally.ok}/${tally.total}</b>`;
        });
        list.append(b);
      });
      qbox.append(list);
    }
    draw();
  }

  sync();
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
  set(deck, cs, arr) { const d = this.read(); d[`${deck}#${cs}`] = arr; this.write(d); window.Cloud?.queue('caseProg', `${deck}#${cs}`, arr); },
  clear(deck, cs) { const d = this.read(); delete d[`${deck}#${cs}`]; this.write(d); window.Cloud?.queueDelete('caseProg', `${deck}#${cs}`); },
};
const caseDone = (deck, cs) => caseProg.get(deck.id, cs.id).filter((v) => v != null).length >= cs.stages.length;


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
  if (deck.course) view.dataset.course = deck.course;
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

  // פסילת תשובות בשלבי המקרה — זיכרון בלבד, כמו בנגן הראשי.
  const elim = new Map();   // אינדקס שלב → Set של מסיחים פסולים

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
      rst.title = 'מחיקת התשובות והפסילות במקרה הזה והתחלה מההתחלה';
      rst.onclick = () => {
        answers = cs.stages.map(() => null);
        elim.clear();
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
        const pr = el('a', 'btn', `🏋️ תרגול שאלות ב${cs.topic}`);
    pr.title = 'שאלות אמת מהמאגר על הנושא של המקרה';
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
    const exSet = elim.get(i) || elim.set(i, new Set()).get(i);
    s.opts.forEach((text, oi) => {
      const o = el('div', 'opt');
      o.append(el('span', 'key', String(oi + 1)));
      o.append(el('span', null, text));
      if (exSet.has(oi)) o.classList.add('ruledout');
      if (answers[i] != null) {
        o.classList.add('locked');
        if (oi === s.a) o.classList.add('correct');
        else if (oi === answers[i]) o.classList.add('wrong');
        if (oi === answers[i]) o.classList.add('chosen');
      } else {
        const ex = el('button', 'opt-x');
        ex.type = 'button';
        ex.tabIndex = -1;
        ex.textContent = exSet.has(oi) ? '↺' : '✕';
        ex.title = exSet.has(oi) ? 'ביטול הפסילה' : 'פסילת המסיח';
        ex.setAttribute('aria-label', ex.title);
        ex.onclick = (e) => {
          e.stopPropagation();
          if (exSet.has(oi)) exSet.delete(oi); else exSet.add(oi);
          paint();
        };
        o.append(ex);
        o.onclick = () => {
          // מסיח פסול מוגן מבחירה בטעות — לחיצה עליו מחזירה אותו לחיים.
          if (exSet.has(oi)) { exSet.delete(oi); paint(); return; }
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
      fb.append(explainBox(s.why, s, answers[i]));
      /* משוב מלא ואחיד כמו בנגן — סים/מפה/NotebookLM לפי נושא המקרה. */
      const topic = s.topic || cs.topic;
      const sim = SIM_BY_TOPIC[topic];
      if (sim) fb.append(simButton(sim));
      const gb = guideButton(topic);
      if (gb) fb.append(gb);
      fb.append(notebookButton({ q: s.ask || s.stem || '', opts: s.opts, a: s.a, explain: s.why, topic }, answers[i]));
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

/* ================= מפתח ההגדרה =================
   המשחק החסר בכל מקצועות הבלוק: לא „מה התשובה” אלא „מה תבדוק עכשיו”. תיק
   נפתח ברמז אחד, וכל צעד עולה נקודות — רמז נוסף, בדיקה, או ניחוש שגוי.
   מי שמזהה מוקדם ובזול לומד בדיוק את מה שהמבחן בודק: איזה רמז מכריע.
   מונע-דאטה (kind:'keyer', items[]): רמזים, בדיקות, ומסיחי זיהוי מאותה family
   — בדיוק כמו מצב המבחן בשננת. ההתקדמות נשמרת לפי תיק, כמו במקרים. */
const KEYER_KEY = 'shichzurim.keyerProg';
const KEYER_COST = { clue: 10, test: 15, wrong: 20, min: 10 };
const keyerProg = {
  read() { try { return JSON.parse(localStorage.getItem(KEYER_KEY)) || {}; } catch { return {}; } },
  write(d) { localStorage.setItem(KEYER_KEY, JSON.stringify(d)); },
  get(deck, it) { return this.read()[`${deck}#${it}`] || null; },
  /* הענן: ns 'keyerProg' נכנס ל-user_kv במיגרציה 0010. עד שתרוץ, Postgres דוחה
     את השורה ו-flush() זורק אותה (הקשחת 0003) — ההתקדמות נשארת מקומית ותו לא. */
  set(deck, it, st) { const d = this.read(); d[`${deck}#${it}`] = st; this.write(d); window.Cloud?.queue('keyerProg', `${deck}#${it}`, st); },
  clear(deck, it) { const d = this.read(); delete d[`${deck}#${it}`]; this.write(d); window.Cloud?.queueDelete('keyerProg', `${deck}#${it}`); },
};
const keyerScore = (it, st) => {
  const cost = (arr, i, def) => (arr && arr[i] && arr[i].cost != null ? arr[i].cost : def);
  let sc = 100;
  for (let i = 1; i < (st.clues || 1); i++) sc -= cost(it.clues, i, KEYER_COST.clue);
  (st.tests || []).forEach((ti) => { sc -= cost(it.tests, ti, KEYER_COST.test); });
  sc -= (st.wrong || []).length * KEYER_COST.wrong;
  return Math.max(KEYER_COST.min, sc);
};
/* מסיחי הזיהוי: options מפורשות אם יש, אחרת כל התשובות מאותה family (עד 5).
   הסדר נקבע פעם אחת ונשמר בהתקדמות — כדי שהרשימה לא תתערבב מתחת לידיים. */
function keyerOptions(deck, it, st) {
  if (st.order) return st.order;
  let pool = Array.isArray(it.options) && it.options.length ? it.options.slice()
    : [...new Set(deck.items.filter((x) => x.family === it.family && x.answer !== it.answer).map((x) => x.answer))];
  pool = shuffle(pool).slice(0, 4);
  st.order = shuffle([it.answer, ...pool]);
  return st.order;
}

async function renderKeyer(id, itemId = null) {
  setNav('home');
  view.innerHTML = '<div class="empty"><span class="ico">⏳</span><b>טוען…</b></div>';
  let deck;
  try { deck = await loadExam(id); }
  catch (err) { view.innerHTML = ''; view.append(emptyState('⚠️', 'לא הצלחתי לטעון', String(err.message))); return; }
  const c = courseOf(deck.course);
  if (deck.course) view.dataset.course = deck.course;
  const it = itemId ? deck.items.find((x) => x.id === itemId) : null;
  view.innerHTML = '';
  if (!it) return keyerPicker(deck, c);

  const sj = subjectOfTopic(deck.course, it.topic);
  view.append(crumb('כל התיקים', '#/keyer/' + deck.id));
  const head = el('div', 'page-head');
  head.append(el('h1', null, `${it.icon || '🔑'} ${it.title || 'תיק ' + (deck.items.indexOf(it) + 1)}`));
  head.append(el('p', null, [it.topic, sj ? sj.name : null].filter(Boolean).join(' · ')));
  view.append(head);

  const layout = el('div', 'case-layout');
  const main = el('div', 'case-main');
  const side = el('div', 'case-side');
  layout.append(main, side);
  view.append(layout);

  let st = keyerProg.get(deck.id, it.id) || { clues: 1, tests: [], wrong: [], done: false };
  const save = () => keyerProg.set(deck.id, it.id, st);
  const opts = keyerOptions(deck, it, st);
  if (!keyerProg.get(deck.id, it.id)) save();   // הסדר של המסיחים נקבע — לשמור

  const nextUnfinished = () => {
    const i = deck.items.indexOf(it);
    const rest = deck.items.slice(i + 1).concat(deck.items.slice(0, i));
    return rest.find((x) => !(keyerProg.get(deck.id, x.id) || {}).done) || null;
  };

  function paint() {
    /* --- לוח הניקוד --- */
    side.innerHTML = '';
    const board = el('div', 'ddx-board');
    board.append(el('div', 'ddx-title', 'התיק'));
    const sc = keyerScore(it, st);
    const big = el('div', 'keyer-score');
    big.append(el('b', null, String(sc)));
    big.append(el('span', null, 'נקודות'));
    board.append(big);
    const rows = [
      ['💡', 'רמזים שנחשפו', `${st.clues}/${it.clues.length}`],
      ['🧪', 'בדיקות שהרצת', `${st.tests.length}/${(it.tests || []).length}`],
      ['✗', 'ניחושים שגויים', String(st.wrong.length)],
    ];
    rows.forEach(([ico, lbl, val]) => {
      const r = el('div', 'ddx-row');
      r.append(el('span', 'ddx-ico', ico)); r.append(el('span', 'ddx-name', lbl)); r.append(el('span', 'ddx-st', val));
      board.append(r);
    });
    board.append(el('div', 'ddx-foot', st.done ? '✓ זוהה' : `רמז −${KEYER_COST.clue} · בדיקה −${KEYER_COST.test} · טעות −${KEYER_COST.wrong}`));
    side.append(board);
    if (st.clues > 1 || st.tests.length || st.wrong.length || st.done) {
      const rst = el('button', 'btn-ghost case-reset', 'התחל את התיק מחדש');
      rst.title = 'מחיקת ההתקדמות בתיק הזה והתחלה מהרמז הראשון';
      rst.onclick = () => { keyerProg.clear(deck.id, it.id); st = { clues: 1, tests: [], wrong: [], done: false }; st.order = null; keyerOptions(deck, it, st); save(); paint(); toTop(); };
      side.append(rst);
    }

    /* --- התיק: פתיח, רמזים ותוצאות --- */
    main.innerHTML = '';
    const story = el('div', 'case-story');
    story.append(el('p', null, it.intro));
    it.clues.slice(0, st.clues).forEach((cl, i) => {
      const p = el('p', 'case-reveal');
      p.append(el('b', null, `רמז ${i + 1}: `));
      p.append(document.createTextNode(cl.text));
      story.append(p);
    });
    st.tests.forEach((ti) => {
      const t = it.tests[ti]; if (!t) return;
      const p = el('p', 'case-reveal keyer-result');
      p.append(el('b', null, `🧪 ${t.name}: `));
      p.append(document.createTextNode(t.result));
      story.append(p);
    });
    main.append(story);

    if (!st.done) {
      /* --- מה תעשה עכשיו --- */
      const act = el('div', 'case-stage');
      act.append(el('div', 'case-phase', 'מה תעשה עכשיו?'));
      const row = el('div', 'keyer-acts');
      if (st.clues < it.clues.length) {
        const b = el('button', 'btn', `💡 רמז נוסף (−${it.clues[st.clues].cost ?? KEYER_COST.clue})`);
        b.title = 'חשיפת הרמז הבא בתיק — עולה נקודות';
        b.onclick = () => { st.clues += 1; save(); paint(); };
        row.append(b);
      }
      (it.tests || []).forEach((t, ti) => {
        if (st.tests.includes(ti)) return;
        const b = el('button', 'btn', `🧪 ${t.name} (−${t.cost ?? KEYER_COST.test})`);
        b.title = 'הרצת הבדיקה וקריאת התוצאה — עולה נקודות';
        b.onclick = () => { st.tests.push(ti); save(); paint(); };
        row.append(b);
      });
      if (!row.children.length) row.append(el('span', 'keyer-none', 'אין עוד מה לבדוק — לזהות.'));
      act.append(row);
      main.append(act);
    }

    /* --- הזיהוי --- */
    const idc = el('div', 'case-stage' + (st.done ? ' done' : ''));
    idc.id = 'keyer-id';
    idc.append(el('div', 'case-phase', 'מה זה?'));
    idc.append(el('div', 'case-ask', it.ask || 'בחר את הזיהוי — ניחוש שגוי עולה נקודות, אבל התיק ממשיך.'));
    const box = el('div', 'opts');
    opts.forEach((name, oi) => {
      const o = el('div', 'opt');
      o.append(el('span', 'key', String(oi + 1)));
      o.append(el('span', null, name));
      const isAns = name === it.answer;
      if (st.wrong.includes(oi)) { o.classList.add('locked', 'wrong', 'chosen'); }
      if (st.done) {
        o.classList.add('locked');
        if (isAns) o.classList.add('correct', 'chosen');
      } else if (!st.wrong.includes(oi)) {
        o.onclick = () => {
          if (isAns) st.done = true; else st.wrong.push(oi);
          save(); paint();
          requestAnimationFrame(() => document.getElementById('keyer-id')?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
        };
      }
      box.append(o);
    });
    idc.append(box);
    if (st.done) {
      const fb = el('div', 'fb show ok');
      fb.append(el('div', null, `✓ ${it.answer} — ${keyerScore(it, st)} נקודות`));
      fb.append(explainBox(it.why, { q: it.intro, opts, a: opts.indexOf(it.answer), explain: it.why, topic: it.topic }, null));
      const gb = guideButton(it.topic);
      if (gb) fb.append(gb);
      idc.append(fb);
      const nav = el('div', 'btn-row keyer-next');
      const nx = nextUnfinished();
      if (nx) {
        const a = el('a', 'btn primary', '🔑 התיק הבא');
        a.href = '#/keyer/' + deck.id + '/' + encodeURIComponent(nx.id);
        a.title = 'התיק הבא שעוד לא זיהית';
        nav.append(a);
      } else {
        const a = el('a', 'btn primary', '🏁 כל התיקים זוהו — חזרה לרשימה');
        a.href = '#/keyer/' + deck.id;
        nav.append(a);
      }
      const pr = el('a', 'btn', `🏋️ שאלות אמת על ${it.topic}`);
      pr.title = 'תרגול השאלות מהמבחנים על הנושא של התיק';
      pr.href = '#/practice/' + deck.course + '/' + encodeURIComponent(it.topic);
      nav.append(pr);
      idc.append(nav);
    } else if (st.wrong.length) {
      const fb = el('div', 'fb show no');
      fb.append(el('div', null, '✗ לא זה. יש עוד רמזים ובדיקות — או לנחש שוב.'));
      idc.append(fb);
    }
    main.append(idc);
  }

  paint();
  toTop();
  updateFooter();
}

/* בורר התיקים — הדף שרואים כשנכנסים לחפיסה בלי תיק מסוים. */
function keyerPicker(deck, c) {
  const sj = deck.items.map((it) => subjectOfTopic(deck.course, it.topic)).find(Boolean);
  view.append(crumb(sj ? `${c.name} · ${sj.name}` : c ? c.name : 'חזרה', '#/course/' + deck.course + (sj ? '/' + encodeURIComponent(sj.key) : '')));
  const head = el('div', 'page-head');
  head.append(el('h1', null, '🔑 ' + deck.title));
  const doneN = deck.items.filter((it) => (keyerProg.get(deck.id, it.id) || {}).done).length;
  head.append(el('p', null, `${c ? c.name : ''} · ${plural(deck.items.length, 'תיק', 'תיקים')}` + (doneN ? ` · זוהו ${doneN}` : '')));
  view.append(head);
  if (deck.note) { const n = el('div', 'cards-note'); n.textContent = deck.note; view.append(n); }

  const row = el('div', 'btn-row');
  const first = deck.items.find((it) => !(keyerProg.get(deck.id, it.id) || {}).done);
  if (first) {
    const go = el('a', 'btn primary', doneN ? '▶️ להמשיך — התיק הבא' : '▶️ להתחיל');
    go.href = '#/keyer/' + deck.id + '/' + encodeURIComponent(first.id);
    go.title = 'התיק הראשון שעוד לא זוהה';
    row.append(go);
  }
  view.append(row);

  /* מקובץ לפי נושא — כמו כל השאר באתר, כדי שהתיקים ידברו עם המפה והתרגול. */
  const byTopic = new Map();
  deck.items.forEach((it) => { (byTopic.get(it.topic) || byTopic.set(it.topic, []).get(it.topic)).push(it); });
  byTopic.forEach((items, topic) => {
    const sec = el('section', 'verb-zone');
    const h = el('div', 'zone-head');
    h.append(el('span', 'zone-head-t', topic));
    h.append(el('span', 'zone-head-line'));
    sec.append(h);
    const grid = el('div', 'case-grid keyer-grid');
    items.forEach((it) => {
      const st = keyerProg.get(deck.id, it.id) || null;
      const a = el('a', 'case-card');
      a.href = '#/keyer/' + deck.id + '/' + encodeURIComponent(it.id);
      a.append(el('div', 'case-card-ico', it.icon || '🔑'));
      const b = el('div', 'case-card-body');
      b.append(el('h3', null, it.title || (st && st.done ? it.answer : 'תיק ' + (deck.items.indexOf(it) + 1))));
      b.append(el('p', null, it.intro));
      const meta = el('div', 'card-meta');
      meta.append(el('span', 'tag', `${it.clues.length} רמזים · ${(it.tests || []).length} בדיקות`));
      if (st && st.done) meta.append(el('span', 'tag good', `✓ ${keyerScore(it, st)} נק׳`));
      else if (st && (st.clues > 1 || st.tests.length || st.wrong.length)) meta.append(el('span', 'tag', 'באמצע'));
      b.append(meta);
      a.append(b);
      grid.append(a);
    });
    sec.append(grid);
    view.append(sec);
  });
  toTop();
  updateFooter();
}

/* ═══════════════════════════════════════════════════════════════════
   מעבדת אק״ג — מצב זיהוי
   ═══════════════════════════════════════════════════════════════════
   הבעיה שזה פותר: „באק״ג שלפניך, הפרעת הקצב יכולה להיות מסווגת כ…” חוזרת
   בארבעה מחזורים, ואת הרישומים עצמם אין לנו. כאן הקוד מצייר רישום חדש בכל
   פעם — עשר שניות על נייר אק״ג — והסטודנט מסווג על שלושת הצירים של הקורס
   (מיקום · תדירות · מנגנון) ונותן שם. הרישומים פרוצדורליים (לא תמונות של
   חולים), ולכן יש אינסוף וריאציות, אבל הם סכמטיים במתכוון.

   LABS הוא רישום של „מעבדות” — כלים אינטראקטיביים שאינם סימולציית סליידרים
   ואינם מונעי-דאטה. כמו SIMS, הקישור לנושא אוטומטי דרך topics. */
const LABS = [
  {
    id: 'ecg', course: 'ekronot-b', icon: '📈', route: '#/ecg/id',
    title: 'מעבדת אק״ג — זיהוי הפרעות קצב',
    blurb: 'רישום חדש בכל פעם: לסווג על שלושת הצירים (מיקום · תדירות · מנגנון) ולתת שם',
    topics: ['הפרעות קצב', 'אק"ג'],
  },
];
const labsOf = (courseId, s = null) => LABS.filter((x) => x.course === courseId && (!s || x.topics.some((t) => (s.topics || []).includes(t))));
const LAB_BY_TOPIC = (() => { const m = {}; LABS.forEach((l) => l.topics.forEach((t) => (m[t] = l))); return m; })();

const ECG_KEY = 'shichzurim.ecgLab';
const ecgStats = {
  read() { try { return JSON.parse(localStorage.getItem(ECG_KEY) || '{}'); } catch { return {}; } },
  write(d) { try { localStorage.setItem(ECG_KEY, JSON.stringify(d)); } catch { /* מצב פרטי */ } },
};

/* ---------- הצירים של הקורס ---------- */
const ECG_AXES = {
  loc: { label: 'מיקום', opts: ['על-חדרי', 'חדרי'] },
  rate: { label: 'תדירות', opts: ['ברדי (פחות מ-60)', 'תקין (60–100)', 'טכי (מעל 100)'] },
  mech: { label: 'מנגנון', opts: ['תקין — אין הפרעה', 'אוטומטיות', 'הולכה (חסימה)', 're-entry'] },
};
const rateClass = (bpm) => (bpm < 60 ? 0 : bpm <= 100 ? 1 : 2);

/* ---------- מחולל הרישומים ----------
   כל קצב מחזיר: beats — רשימת פעימות (זמן R, יש P?, PR, רחב?), bg — פונקציית
   רקע (פרפור, רפרוף, VF), ו-notes — מה שמבדיל אותו, למשוב. */
const rnd = (a, b) => a + Math.random() * (b - a);
const rndi = (a, b) => Math.floor(rnd(a, b + 1));
const ECG_DUR = 10.4;
const ECG_RHYTHMS = [
  {
    id: 'sinus', name: 'קצב סינוס תקין', loc: 0, mech: 0,
    gen() { const bpm = rndi(62, 96); return { beats: sinusBeats(bpm, rnd(0.13, 0.18)), bg: null, bpm,
      why: `גל P לפני כל QRS, R-R סדיר, PR קצר מ-200 מילישניות ו-QRS צר — והקצב ${bpm} לדקה, בטווח התקין. זה לא הפרעת קצב, וגם זו תשובה שהמבחן מצפה שתדע לתת.` }; },
  },
  {
    id: 'sinus-tachy', name: 'סינוס טכיקרדיה', loc: 0, mech: 1,
    gen() { const bpm = rndi(106, 145); return { beats: sinusBeats(bpm, rnd(0.12, 0.16)), bg: null, bpm,
      why: `כל המבנה תקין — P לפני כל QRS, סדיר, PR ו-QRS תקינים — רק מהר: ${bpm} לדקה. הקוצב עצמו יורה מהר מדי (כמו בפעילות יתר של בלוטת התריס), ולכן זו הפרעה על-חדרית באוטומטיות. המלכודת של המאגר: לסמן re-entry. לא — אין מעגל, יש קוצב מהיר.` }; },
  },
  {
    id: 'sinus-brady', name: 'סינוס ברדיקרדיה', loc: 0, mech: 1,
    gen() { const bpm = rndi(36, 54); return { beats: sinusBeats(bpm, rnd(0.14, 0.19)), bg: null, bpm,
      why: `P לפני כל QRS, PR תקין, סדיר — ואיטי: ${bpm} לדקה. מספר ה-P שווה למספר ה-QRS (זה מה שמבדיל מחסימה). הקוצב יורה לאט — אוטומטיות מופחתת, למשל בטונוס ואגלי גבוה.` }; },
  },
  {
    id: 'af', name: 'פרפור עליות', loc: 0, mech: 3,
    gen() {
      const beats = []; let t = rnd(0.2, 0.5); const mean = rnd(0.42, 0.8);
      while (t < ECG_DUR) { beats.push({ t, hasP: false, pr: 0, wide: false }); t += Math.max(0.3, mean + rnd(-0.28, 0.28)); }
      const ph = [rnd(0, 6), rnd(0, 6), rnd(0, 6)], fr = [rnd(5, 6.5), rnd(6.5, 8), rnd(8, 10)];
      const bg = (x) => 0.035 * Math.sin(2 * Math.PI * fr[0] * x + ph[0]) + 0.03 * Math.sin(2 * Math.PI * fr[1] * x + ph[1]) + 0.02 * Math.sin(2 * Math.PI * fr[2] * x + ph[2]);
      const bpm = Math.round(beats.length * 60 / ECG_DUR);
      return { beats, bg, bpm, why: `אין גלי P — במקומם קו בסיס רועד (גלי f) — וה-R-R לא סדיר לחלוטין, בלי שום תבנית. QRS צר, כי ההולכה לחדרים דרך AV node תקינה. קצב חדרי ${bpm} לדקה. מעגלי re-entry רבים ולא מסודרים בעליות — על-חדרי, במנגנון re-entry.` };
    },
  },
  {
    id: 'flutter', name: 'רפרוף עליות', loc: 0, mech: 3,
    gen() {
      const ratio = dpick([2, 3, 4]); const f = 300 / 60; const t0 = rnd(0.1, 0.3);
      const beats = []; for (let k = 0; ; k++) { const t = t0 + (k * ratio) / f + 0.12; if (t > ECG_DUR) break; beats.push({ t, hasP: false, pr: 0, wide: false }); }
      const bg = (x) => 0.17 * (2 * ((((x - t0) * f) % 1 + 1) % 1) - 1) * -1;   // שיני מסור
      const bpm = Math.round(300 / ratio);
      return { beats, bg, bpm, why: `במקום P — גלי רפרוף בצורת שיני מסור, סדירים, כ-300 לדקה. ה-AV node מעביר אחד מכל ${ratio} (הולכה ${ratio}:1), ולכן ה-QRS סדיר ב-${bpm} לדקה. מעגל re-entry אחד וגדול בעלייה הימנית — על-חדרי, re-entry.` };
    },
  },
  {
    id: 'avb1', name: 'חסימת AV מדרגה ראשונה', loc: 0, mech: 2,
    gen() { const bpm = rndi(58, 88); const pr = rnd(0.24, 0.34); return { beats: sinusBeats(bpm, pr), bg: null, bpm,
      why: `כל P מלווה ב-QRS ומספריהם שווים — אבל ה-PR קבוע וארוך: ${Math.round(pr * 1000)} מילישניות, מעל 200. ההשהיה ב-AV node ארוכה מדי — הפרעה בהתפשטות (חסימה), לא באוטומטיות. הקצב עצמו ${bpm}, ${bpm < 60 ? 'ברדי' : 'תקין'}.` }; },
  },
  {
    id: 'mobitz1', name: 'חסימת AV מדרגה שנייה — מוביץ 1 (ונקבך)', loc: 0, mech: 2,
    gen() {
      const pbpm = rndi(72, 92); const prr = 60 / pbpm; const n = dpick([3, 4, 5]);
      const beats = []; let tP = rnd(0.2, 0.4); let k = 0;
      const prs = { 3: [0.16, 0.24, 0.34], 4: [0.16, 0.22, 0.28, 0.36], 5: [0.15, 0.2, 0.25, 0.3, 0.37] }[n];
      while (tP < ECG_DUR + 0.5) {
        const i = k % (n + 1);
        if (i < n) beats.push({ t: tP + prs[i], hasP: true, pr: prs[i], wide: false });
        else beats.push({ t: tP + 0.16, hasP: true, pr: 0.16, wide: false, dropped: true });
        tP += prr; k++;
      }
      const bpm = Math.round(beats.filter((b) => !b.dropped).length * 60 / ECG_DUR);
      return { beats, bg: null, bpm, why: `גלי P סדירים, אבל ה-PR מתארך מפעימה לפעימה — עד ש-P אחד נשאר בלי QRS, ואז המחזור מתחיל מחדש (הולכה ${n + 1}:${n}). יותר P מ-QRS. זו הפרעת הולכה ב-AV node עצמו — QRS צר. קצב חדרי ${bpm}.` };
    },
  },
  {
    id: 'mobitz2', name: 'חסימת AV מדרגה שנייה — מוביץ 2', loc: 0, mech: 2,
    gen() {
      const pbpm = rndi(70, 90); const prr = 60 / pbpm; const k0 = dpick([3, 4]); const pr = rnd(0.15, 0.19); const wide = Math.random() < 0.5;
      const beats = []; let tP = rnd(0.2, 0.4); let k = 0;
      while (tP < ECG_DUR + 0.5) { beats.push({ t: tP + pr, hasP: true, pr, wide, dropped: k % k0 === k0 - 1 }); tP += prr; k++; }
      const bpm = Math.round(beats.filter((b) => !b.dropped).length * 60 / ECG_DUR);
      return { beats, bg: null, bpm, why: `גלי P סדירים, PR קבוע (${Math.round(pr * 1000)} מילישניות) — ופתאום P בלי QRS, בלי הארכה הדרגתית לפניו (הולכה ${k0}:${k0 - 1}). ${wide ? 'ה-QRS רחב, כי החסימה מתחת ל-AV node, בצרור או בענפים.' : 'כאן ה-QRS צר — אבל בדרך כלל במוביץ 2 הוא רחב, כי החסימה מתחת ל-AV node.'} הפרעת הולכה; יותר P מ-QRS. קצב חדרי ${bpm}.` };
    },
  },
  {
    id: 'avb3', name: 'חסימת AV מלאה (דרגה שלישית)', loc: 1, mech: 2,
    gen() {
      const pbpm = rndi(70, 95), vbpm = rndi(30, 42);
      const beats = []; let tP = rnd(0.1, 0.4);
      while (tP < ECG_DUR + 0.3) { beats.push({ t: tP, hasP: true, pr: 0, wide: false, pOnly: true }); tP += 60 / pbpm; }
      let tV = rnd(0.3, 1.2); while (tV < ECG_DUR) { beats.push({ t: tV, hasP: false, pr: 0, wide: true }); tV += 60 / vbpm; }
      return { beats, bg: null, bpm: vbpm, why: `שני קצבים שאינם קשורים זה לזה: גלי P סדירים ב-${pbpm} לדקה (מה-SA node), ו-QRS רחבים וסדירים ב-${vbpm} לדקה — קצב מילוט מסיבי פורקינייה. ה-PR משתנה באקראי כי שום P לא עובר. יותר P מ-QRS; ה-QRS מקורו בחדרים — ולכן הציר „מיקום” כאן חדרי, בקצב ברדי, במנגנון חסימה.` };
    },
  },
  {
    id: 'pvc', name: 'פעימות חדריות מוקדמות (PVC)', loc: 1, mech: 1,
    gen() {
      const bpm = rndi(64, 86); const rr = 60 / bpm; const every = dpick([3, 4, 5, 6]); const pr = rnd(0.14, 0.17);
      const beats = []; let t = rnd(0.3, 0.6); let k = 0;
      while (t < ECG_DUR) {
        beats.push({ t, hasP: true, pr, wide: false });
        if ((k + 1) % every === 0) { beats.push({ t: t + rr * rnd(0.55, 0.65), hasP: false, pr: 0, wide: true, pvc: true }); }
        t += rr; k++;   // הפסקה מפצה: הסינוס הבא בזמנו המקורי
      }
      return { beats, bpm, bg: null, why: `קצב סינוס בסיסי ב-${bpm}, ובכל ${every} פעימות מופיעה פעימה מוקדמת, רחבה ומעוותת, בלי גל P לפניה, עם T הפוך — ואחריה הפסקה מפצה עד לפעימת הסינוס הבאה. מוקד בחדר שיורה מעצמו (DAD/EAD) — חדרי, אוטומטיות. הקצב הכללי נשאר בטווח התקין.` };
    },
  },
  {
    id: 'vt', name: 'טכיקרדיה חדרית (VT)', loc: 1, mech: 3,
    gen() { const bpm = rndi(150, 200); const beats = []; let t = rnd(0.1, 0.3); while (t < ECG_DUR) { beats.push({ t, hasP: false, pr: 0, wide: true }); t += 60 / bpm; }
      return { beats, bg: null, bpm, why: `QRS רחבים, סדירים ומהירים — ${bpm} לדקה — בלי גלי P. המקור בחדרים (ולכן רחב: ההולכה עוברת תא-לתא ולא בפורקינייה). VT מונומורפית סדירה היא בדרך כלל מעגל re-entry סביב צלקת או אזור הולכה איטית — חדרי, טכי, re-entry.` }; },
  },
  {
    id: 'vf', name: 'פרפור חדרים (VF)', loc: 1, mech: 3,
    gen() {
      const fr = [rnd(3, 4.5), rnd(4.5, 6), rnd(6, 8)], ph = [rnd(0, 6), rnd(0, 6), rnd(0, 6)], am = [rnd(0.25, 0.45), rnd(0.15, 0.3), rnd(0.08, 0.18)];
      const bg = (x) => am[0] * Math.sin(2 * Math.PI * fr[0] * x + ph[0] + 0.8 * Math.sin(0.7 * x)) + am[1] * Math.sin(2 * Math.PI * fr[1] * x + ph[1]) + am[2] * Math.sin(2 * Math.PI * fr[2] * x + ph[2]);
      return { beats: [], bg, bpm: 400, why: `אין QRS, אין P, אין שום מבנה — רק גלים כאוטיים בגובה ובתדירות משתנים. אינספור מעגלי re-entry בחדרים; אין תפוקת לב. חדרי, „טכי” (אין קצב אמיתי), re-entry. זה הרישום היחיד שבו לא סופרים כלום — מטפלים.` };
    },
  },
];
function sinusBeats(bpm, pr) {
  const beats = []; let t = rnd(0.25, 0.6); const rr = 60 / bpm;
  while (t < ECG_DUR) { beats.push({ t, hasP: true, pr, wide: false }); t += rr + rnd(-0.012, 0.012); }
  return beats;
}
const ecgG = (t, c, w, a) => a * Math.exp(-((t - c) * (t - c)) / (2 * w * w));
function ecgTrace(model) {
  const beats = model.beats;
  return (t) => {
    let v = model.bg ? model.bg(t) : 0;
    for (const b of beats) {
      if (Math.abs(t - b.t) > 0.9) continue;
      if (b.hasP) v += ecgG(t, b.t - (b.pr || 0.16) + 0.045, 0.022, 0.15);
      if (b.pOnly || b.dropped) continue;
      if (b.wide) { v += ecgG(t, b.t, 0.03, 1.15) - ecgG(t, b.t + 0.05, 0.02, 0.35); v -= ecgG(t, b.t + 0.34, 0.06, 0.45); }
      else { v += -ecgG(t, b.t - 0.014, 0.005, 0.12) + ecgG(t, b.t, 0.0075, 1.0) - ecgG(t, b.t + 0.016, 0.006, 0.25); v += ecgG(t, b.t + 0.27, 0.045, 0.28); }
    }
    return v + 0.008 * Math.sin(37 * t) + 0.006 * Math.sin(53 * t + 1);
  };
}
/* נייר אק״ג: 25 מ״מ לשנייה, 10 מ״מ ל-mV. 4 פיקסלים למ״מ → 10.4 שניות = 1040px. */
const ECG_PX_MM = 4, ECG_W = Math.round(ECG_DUR * 25 * ECG_PX_MM), ECG_H = 220;
function drawEcgStrip(cv, model, showMarks) {
  const { ctx, w, h } = fitCanvas(cv);
  ctx.direction = 'ltr';
  ctx.fillStyle = '#fff8f6'; ctx.fillRect(0, 0, w, h);
  for (let x = 0; x <= w; x += ECG_PX_MM) { ctx.strokeStyle = (x / ECG_PX_MM) % 5 === 0 ? '#f0aeae' : '#f8d6d6'; ctx.lineWidth = (x / ECG_PX_MM) % 5 === 0 ? 1 : 0.5; ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, h); ctx.stroke(); }
  for (let y = 0; y <= h; y += ECG_PX_MM) { ctx.strokeStyle = (y / ECG_PX_MM) % 5 === 0 ? '#f0aeae' : '#f8d6d6'; ctx.lineWidth = (y / ECG_PX_MM) % 5 === 0 ? 1 : 0.5; ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(w, y + 0.5); ctx.stroke(); }
  const base = h * 0.62, mv = 10 * ECG_PX_MM;
  const f = ecgTrace(model);
  ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 1.8; ctx.lineJoin = 'round'; ctx.beginPath();
  for (let i = 0; i <= w; i++) { const t = i / (25 * ECG_PX_MM); const y = base - f(t) * mv; i ? ctx.lineTo(i, y) : ctx.moveTo(i, y); }
  ctx.stroke();
  // ציר זמן — שנייה בכל 25 מ״מ
  ctx.fillStyle = '#9a6b6b'; ctx.font = '600 11px ' + FONT; ctx.textAlign = 'center';
  for (let s = 1; s <= 10; s++) ctx.fillText(s + ' ש׳', s * 25 * ECG_PX_MM, h - 5);
  if (showMarks) {
    ctx.fillStyle = '#2f6db5'; ctx.font = '700 12px ' + FONT;
    model.beats.forEach((b) => { if (b.hasP) { const x = (b.t - (b.pr || 0.16) + 0.045) * 25 * ECG_PX_MM; ctx.fillText('P', x, base - 0.15 * mv - 8); } });
    ctx.fillStyle = '#b5472f';
    model.beats.forEach((b) => { if (!b.pOnly && !b.dropped) { const x = b.t * 25 * ECG_PX_MM; ctx.fillText(b.wide ? 'V' : 'R', x, base - 1.15 * mv - 6); } });
  }
}

async function renderEcgLab(mode = 'id') {
  setNav('home');
  killSim();
  const lab = LABS.find((l) => l.id === 'ecg');
  const c = courseOf(lab.course);
  view.dataset.course = lab.course;
  view.innerHTML = '';
  const subj = subjectOfTopic(lab.course, lab.topics[0]);
  view.append(crumb(subj ? `${c.name} · ${subj.name}` : c ? c.name : 'חזרה', '#/course/' + lab.course + (subj ? '/' + encodeURIComponent(subj.key) : '')));
  const head = el('div', 'page-head');
  head.append(el('h1', null, '📈 מעבדת אק״ג — זיהוי הפרעות קצב'));
  head.append(el('p', null, 'רישום של עשר שניות, חדש בכל פעם. סווגו על שלושת הצירים של הקורס ותנו שם — ואז תראו למה.'));
  view.append(head);

  const how = el('details', 'ecg-how');
  const sum = el('summary'); sum.textContent = '🔍 איך קוראים רישום — חמש שאלות בסדר הזה'; how.append(sum);
  const ol = el('ol');
  ['יש גל P לפני כל QRS? (אין P בכלל → פרפור/רפרוף/חדרי; יותר P מ-QRS → חסימה)',
   'ה-R-R סדיר? (לא סדיר לחלוטין → פרפור עליות; לא סדיר עם תבנית → מוביץ / PVC)',
   'ה-PR קבוע וקצר מ-200 מילישניות (5 משבצות קטנות)? (ארוך וקבוע → דרגה 1; מתארך → מוביץ 1; משתנה באקראי → דרגה 3)',
   'ה-QRS צר (עד 3 משבצות קטנות)? (רחב → מקור בחדרים, או הולכה מתחת ל-AV node)',
   'הקצב: ספרו QRS בעשר השניות וכפלו ב-6. פחות מ-60 ברדי, מעל 100 טכי.'].forEach((t) => ol.append(el('li', null, t)));
  how.append(ol); view.append(how);

  const stats = ecgStats.read();
  const score = el('div', 'drill-score');
  const updScore = () => { score.textContent = stats.n ? `${stats.n} רישומים · ${stats.ok4 || 0} מזוהים במלואם · דיוק: מיקום ${pct('loc')} · תדירות ${pct('rate')} · מנגנון ${pct('mech')} · שם ${pct('name')}` : 'עוד לא זיהית רישום — הראשון למטה.'; };
  const pct = (k) => (stats.n ? Math.round(100 * ((stats.parts || {})[k] || 0) / stats.n) + '%' : '—');
  updScore(); view.append(score);

  const card = el('div', 'drill-card ecg-card');
  const wrap = el('div', 'ecg-wrap');
  const cv = el('canvas', 'ecg-strip'); cv.style.width = ECG_W + 'px'; cv.style.height = ECG_H + 'px';
  wrap.append(cv); card.append(wrap);
  card.append(el('div', 'ecg-hint', 'נייר אק״ג: משבצת קטנה = 40 מילישניות, גדולה = 200. גררו לצדדים בטלפון.'));

  const axes = el('div', 'ecg-axes');
  const chosen = { loc: null, rate: null, mech: null, name: null };
  const chipRows = {};
  const paint = () => Object.entries(chipRows).forEach(([k, row]) => row.querySelectorAll('.verb-chip').forEach((b, i) => b.classList.toggle('on', chosen[k] === i)));
  Object.entries(ECG_AXES).forEach(([k, ax]) => {
    const row = el('div', 'ecg-axis');
    row.append(el('span', 'lbl', ax.label));
    ax.opts.forEach((o, i) => { const b = el('button', 'verb-chip', o); b.type = 'button'; b.title = `${ax.label}: ${o}`; b.onclick = () => { if (answered) return; chosen[k] = i; paint(); syncCheck(); }; row.append(b); });
    chipRows[k] = row; axes.append(row);
  });
  const nameRow = el('div', 'ecg-axis');
  nameRow.append(el('span', 'lbl', 'השם'));
  const sel = el('select', 'formula-select');
  const o0 = el('option', null, 'בחרו…'); o0.value = ''; sel.append(o0);
  ECG_RHYTHMS.forEach((r, i) => { const o = el('option', null, r.name); o.value = i; sel.append(o); });
  sel.title = 'שם הפרעת הקצב';
  sel.onchange = () => { if (answered) return; chosen.name = sel.value === '' ? null : +sel.value; syncCheck(); };
  nameRow.append(sel); axes.append(nameRow);
  card.append(axes);

  const acts = el('div', 'btn-row');
  const checkBtn = el('button', 'btn primary', '✔ בדוק'); checkBtn.type = 'button'; checkBtn.title = 'בדיקת הסיווג — אחרי שבחרתם בכל ארבעת השדות';
  const nextBtn = el('button', 'btn', '🎲 רישום חדש'); nextBtn.type = 'button'; nextBtn.title = 'רישום אקראי חדש';
  const marksBtn = el('button', 'btn ghost', '🏷️ סמן P ו-R'); marksBtn.type = 'button'; marksBtn.title = 'סימון גלי P ושיאי R על הרישום (עוזר לספור)';
  acts.append(checkBtn, nextBtn, marksBtn); card.append(acts);
  const fb = el('div', 'drill-fb'); card.append(fb);
  view.append(card);

  /* הקישורים הצידה — אותם נושאים קנוניים, אותו מנגנון כמו בסימולציות */
  const links = el('div', 'btn-row');
  const ky = keyerFor(lab.course, 'הפרעות קצב');
  if (ky) { const a = el('a', 'btn', '🔑 אותן הפרעות — מתיאור במילים'); a.href = '#/keyer/' + ky.id; a.title = ky.title; links.append(a); }
  const sim = simOf('ecg-dipole'); if (sim) { const a = el('a', 'btn', `${sim.icon} למה הרישום נראה ככה — הדיפול`); a.href = '#/sim/' + sim.id; a.title = sim.blurb; links.append(a); }
  lab.topics.forEach((t) => { const a = el('a', 'btn ghost', `תרגלו את "${t}"`); a.href = `#/practice/${lab.course}/${encodeURIComponent(t)}`; a.title = 'שאלות אמת מהמאגר על הנושא'; links.append(a); });
  view.append(links);

  let model, rhythm, answered, marks = false;
  const syncCheck = () => { checkBtn.disabled = answered || Object.values(chosen).some((v) => v == null); };
  function fresh() {
    rhythm = dpick(ECG_RHYTHMS); model = rhythm.gen(); answered = false; marks = false;
    Object.keys(chosen).forEach((k) => (chosen[k] = null)); sel.value = ''; paint(); syncCheck();
    fb.className = 'drill-fb'; fb.innerHTML = '';
    drawEcgStrip(cv, model, false);
    wrap.scrollLeft = 0;
  }
  function check() {
    if (answered) return;
    answered = true; syncCheck();
    const truth = { loc: rhythm.loc, rate: rateClass(model.bpm), mech: rhythm.mech, name: ECG_RHYTHMS.indexOf(rhythm) };
    const oks = Object.fromEntries(Object.keys(truth).map((k) => [k, chosen[k] === truth[k]]));
    const nOk = Object.values(oks).filter(Boolean).length;
    stats.n = (stats.n || 0) + 1; stats.parts = stats.parts || {};
    Object.keys(oks).forEach((k) => { if (oks[k]) stats.parts[k] = (stats.parts[k] || 0) + 1; });
    if (nOk === 4) stats.ok4 = (stats.ok4 || 0) + 1;
    ecgStats.write(stats); updScore();
    fb.className = 'drill-fb show ' + (nOk === 4 ? 'ok' : nOk >= 2 ? 'warn' : 'no');
    const v = el('div', 'drill-verdict');
    v.textContent = nOk === 4 ? `✓ זיהוי מלא — ${rhythm.name}` : `${nOk}/4 — הרישום: ${rhythm.name}`;
    fb.append(v);
    const grid = el('div', 'ecg-verdict');
    const lbl = { loc: 'מיקום', rate: 'תדירות', mech: 'מנגנון', name: 'השם' };
    Object.keys(truth).forEach((k) => {
      const t = k === 'name' ? rhythm.name : ECG_AXES[k].opts[truth[k]];
      const mine = chosen[k] == null ? '—' : k === 'name' ? ECG_RHYTHMS[chosen[k]].name : ECG_AXES[k].opts[chosen[k]];
      const row = el('div', 'ecg-vrow ' + (oks[k] ? 'ok' : 'no'));
      row.innerHTML = `<b>${oks[k] ? '✓' : '✗'} ${lbl[k]}:</b> ${t}` + (oks[k] ? '' : ` <span class="dim">(סימנת: ${mine})</span>`);
      grid.append(row);
    });
    fb.append(grid);
    const why = el('p', 'ecg-why'); why.textContent = model.why; fb.append(why);
    if (model.bpm < 300) fb.append(el('div', 'dim', `קצב חדרי ברישום: ${model.bpm} לדקה (ספרו ${model.beats.filter((b) => !b.pOnly && !b.dropped).length} קומפלקסים בעשר שניות וכפלו ב-6).`));
    marks = true; drawEcgStrip(cv, model, true);
    nextBtn.focus();
  }
  checkBtn.onclick = check;
  nextBtn.onclick = fresh;
  marksBtn.onclick = () => { marks = !marks; drawEcgStrip(cv, model, marks); };
  const ro = new ResizeObserver(() => drawEcgStrip(cv, model, marks));
  ro.observe(wrap);
  simTeardown = () => ro.disconnect();
  fresh();
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

/* מה שמותר להגיד רק *אחרי* שנענתה.

   הסקר (57 תשובות) העלה את זה כתלונה מפורשת: "בשאלות מסוימות כתוב בפסקת טקסט
   את התשובה הנכונה לפני המענה". הבדיקה מצאה 21 מקומות כאלה. השורש: כל טקסט
   ההקשר — הערה, אזהרת סתירת מפתחות, הכרעה — נבנה מעל המסיחים, גם כשהוא נוקב
   בתשובה במפורש. `explain` היה חסום נכון מלכתחילה; השאר לא.

   הכלל מכאן: טקסט שנוקב בתשובה חי ב-`noteAfter` (או נגזר מ-`repeat.ruling`)
   ומגיע לכאן. `note` נשאר להקשר שבלעדיו אי אפשר לענות — תיאור גרף, מקרא
   קיצורים, הערת המרה — ו-189 מתוך 210 ההערות בארכיון הן בדיוק זה. */
function lateNotes(item) {
  const out = [];
  const r = item.repeat;
  if (r && r.conflict) {
    const rl = r.ruling;
    if (rl && (rl.keys || rl.why))
      out.push(el('div', 'q-note late',
        (rl.keys ? `מה שסימן כל מפתח: ${rl.keys}.` : '') + (rl.why ? ` ${rl.why}` : '')));
    else if (r.rulingMissing)
      out.push(el('div', 'q-note late',
        `הוכרע מול חומרי הקורס שהתשובה הנכונה היא "${r.rulingMissing}" — והיא לא הוצעה ` +
        'כמסיח בגרסה הזאת של השאלה.'));
  }
  if (item.noteAfter) out.push(el('div', 'q-note late', item.noteAfter));
  return out;
}

/* ================= הסבב החי =================

   סבב תרגול הוא DOM שמצויר *מתחת* לכתובת שכבר היית בה — `playQuestions` לא
   נוגע ב-hash. לכן לדפדפן אין רשומת היסטוריה שאומרת "אני באמצע סבב": קפיצה
   למפת החומרים וחזרה מחזירה אותך לכתובת `#/practice/<course>`, הראוטר מצייר
   את הבורר מאפס, והתשובות והפילטרים נעלמים. רק מבחן וסימולציה שרדו, כי שם
   `persist:true` שומר לאחסון.

   בסקר זה הופיע כ"בחזרות אחורה זה תמיד היה מוציא אותך מהסשן ומתחיל מהתחלה".

   הפתרון: הסבב האחרון נשמר כאן יחד עם ה-cfg שיצר אותו, והראוטר מנגן אותו
   מחדש כשחוזרים לכתובת שממנה נפתח. `answers` ו-`elim` הם אותם אובייקטים
   שהנגן עובד עליהם, ולכן אין מה לסנכרן — הם תמיד עדכניים.

   יציאה מכוונת (הפירורים למעלה, "חזרה ל..." בסוף) מוחקת אותו — אחרת הכפתור
   שאמור להוציא אותך היה מחזיר אותך פנימה. */
let liveRound = null;

function forgetRound() { liveRound = null; }

/* מחזיר true אם היה סבב חי לכתובת הזאת והוא נוגן מחדש. */
function resumeRound(hash) {
  if (!liveRound || liveRound.hash !== hash) return false;
  if (!Object.keys(liveRound.answers).length) return false;   // סבב שלא נגעו בו — אין מה לשחזר
  const cfg = liveRound.cfg;
  playQuestions({ ...cfg, _resume: { answers: liveRound.answers, elim: liveRound.elim, order: liveRound.order } });
  return true;
}

/* עוטף קישור יציאה כך שלחיצה עליו סוגרת את הסבב. */
function exitLink(node) {
  node.addEventListener('click', forgetRound);
  return node;
}

function playQuestions(cfg) {
  const { key, title, subtitle, note, persist, back } = cfg;
  /* קושי המחזור לתגית שבמשוב — נטען ברקע; אם לא יגיע, התג פשוט לא יופיע. */
  loadCohort();
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
  const answers = persist ? fromStore(rec, questions)
                : (cfg._resume ? cfg._resume.answers : {});

  /* פסילת תשובות — עבודה כמו על דף מבחן אמיתי: מוחקים בקו את המסיחים שברור
     שהם לא, ורק אז מכריעים בין מה שנשאר. הפסילות חיות בזיכרון בלבד ולא
     נשמרות: הן חלק מרגע החשיבה על השאלה, לא מההתקדמות. */
  const elim = (cfg._resume && cfg._resume.elim) || new Map();   // qi → Set של אינדקסי מסיחים פסולים

  /* סדר התצוגה של המסיחים בכל שאלה — נקבע פעם אחת לסבב, כדי שרינדור מחדש
     (אחרי מענה, או חזרה לסבב חי) לא יערבב מתחת לידיים. */
  const order = (cfg._resume && cfg._resume.order) || new Map();   // qi → מערך אינדקסים מקוריים

  /* סבב שלא נשמר לאחסון נרשם כאן, כדי שחזרה לכתובת שממנה נפתח תנגן אותו
     מחדש במקום לצייר את הבורר. מבחן וסימולציה לא צריכים את זה — הם persist. */
  if (!persist) liveRound = { hash: back.href, cfg, answers, elim, order };

  /* שאלות "מחוץ לחומר" (offSyllabus) — נושא שיצא מהסילבוס (למשל הלב במחזור נ״ב).
     מוצגות ומתורגלות להעשרה, אבל לא נספרות בציון, בהתקדמות ובפילוח הנושאים. */
  const scoredCount = questions.filter((q) => !q.offSyllabus).length;

  view.append(exitLink(crumb(back.text, back.href)));

  const head = el('div', 'page-head');
  head.append(el('h1', null, title));
  head.append(el('p', null, subtitle));
  view.append(head);

  /* ההסבר המלא — למה המבחן הזה חריג, ומה זה אומר על איך לתרגל אותו.
     לפני ה-note ולפני השאלות: מי שמתחיל לענות בלי לדעת את זה, לומד לא נכון. */
  if (cfg.spotlight) {
    const sp = el('div', 'spotlight-box');
    sp.append(el('b', null, cfg.spotlight.title));
    const body = el('p', null); body.innerHTML = cfg.spotlight.body;
    sp.append(body);
    view.append(sp);
  }

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
  /* פיל הרצף — מנגנון האנטיציפציה. מופיע מ-2 ומעלה ומתקתק בפופ קטן, כדי
     שתרגיש את הרצף בונה עוד לפני החגיגה הבאה. */
  const streakPill = el('div', 'streak-pill');
  streakPill.hidden = true;
  counts.append(cGood, cBad, cLeft, streakPill);
  bar.append(counts);

  const progress = el('div', 'bar');
  const fill = el('i');
  progress.append(fill);
  bar.append(progress);

  /* מופיע רק כשסיימת. אין גלילה אוטומטית לתוצאה, אז זה מה שמאפשר להגיע
     אליה בלחיצה — במקום להיחטף אליה. */
  const toResult = el('button', 'btn primary', 'לתוצאה ↓');
  toResult.title = 'גלילה אל הציון וסיכום הסבב';
  toResult.style.display = 'none';
  bar.append(toResult);

  const resetBtn = el('button', 'btn ghost', 'איפוס');
  resetBtn.title = 'מחיקת התשובות של הסבב הזה והתחלה מחדש';
  bar.append(resetBtn);

  /* דף הנוסחאות זמין כאן *לפני* התשובה, ובכוונה: במבחן הוא על השולחן. תרגול
     שמחזיק אותו רק במשוב מאמן פתרון-מהזיכרון, וזה לא מה שנבחן. */
  if (sheetOf(cfg.courseId)) {
    const sb = el('button', 'btn ghost sheet-open', '📄 דף נוסחאות');
    sb.type = 'button';
    sb.title = 'הדף הרשמי שמחולק במבחן — פתיחה בלי לצאת מהשאלה';
    sb.onclick = () => openSheet(cfg.courseId);
    bar.append(sb);
  }
  bar.append(rewardToggles());

  /* מצב מבחן — רק בשחזורים (cfg.allowExam). מבחן = משוב נדחה לסוף; לימוד = מיידי. */
  const examToggle = el('button', 'exam-toggle');
  examToggle.type = 'button';
  examToggle.dataset.tour = 'exammode';   // עוגן לסיור
  const revealBtn = el('button', 'btn ghost reveal-btn', '👁️ הצג תשובות');
  revealBtn.type = 'button';
  revealBtn.title = 'חשיפת התשובות וההסברים עכשיו, בלי לחכות לסוף המבחן';
  revealBtn.style.display = 'none';
  if (cfg.allowExam) {
    examToggle.onclick = () => setExamMode(!examMode);
    revealBtn.onclick = () => revealAnswers();
    bar.append(examToggle, revealBtn);
  }
  view.append(bar);

  /* --- מצב הרצף (בזיכרון, פר-סבב) --- */
  let streak = 0;
  let celebratedResult = false;

  /* מצב מבחן: כשדולק, המשוב (נכון/שגוי/הסבר) והספירה נדחים עד סוף המבחן או עד
     לחיצה על "הצג תשובות". ברירת מחדל: מצב לימוד (revealed=true, משוב מיידי).
     בסימולציה (cfg.startExam) מתחילים ישר במצב מבחן — זו כל הפואנטה. */
  let examMode = !!cfg.startExam;
  let revealed = !examMode;
  function updateExamUI() {
    examToggle.setAttribute('aria-pressed', examMode ? 'true' : 'false');
    examToggle.textContent = examMode ? '📝 מצב מבחן' : '💡 מצב לימוד';
    examToggle.title = examMode
      ? 'מצב מבחן: התשובות נחשפות רק בסוף. לחצו למעבר למצב לימוד'
      : 'מצב לימוד: משוב מיד אחרי כל שאלה. לחצו למעבר למצב מבחן';
    revealBtn.style.display = (examMode && !revealed) ? '' : 'none';
  }
  function setExamMode(on) { examMode = on; revealed = !on; updateExamUI(); render(); }
  function revealAnswers() { revealed = true; updateExamUI(); render(); }

  /* טיימר ספירה לאחור — סימולציית מבחן. הזמן נמדד מ-startedAt (שנשמר ע"י
     הקורא), כך שרענון או יציאה-וחזרה לא מאפסים את השעון.

     בתום הזמן **לא קורה כלום** חוץ מהודעה: לא הגשה כפויה, לא נעילה, לא חשיפה.
     המטרה כאן היא ללמוד, לא להיפסל — מי שרוצה לדעת אם הספיק בזמן מסתכל
     בשעון, ומי שרוצה לסיים את השאלה ה-47 בנחת ממשיך. */
  if (cfg.timer) {
    const clock = el('div', 'exam-clock');
    bar.insertBefore(clock, resetBtn);
    const endAt = cfg.timer.startedAt + cfg.timer.minutes * 60000;
    const fmt = (s) => {
      const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
      return (h ? h + ':' : '') + String(m).padStart(h ? 2 : 1, '0') + ':' + String(ss).padStart(2, '0');
    };
    let clockIv = null;
    const tick = () => {
      /* עזבו את העמוד (SPA — הסרגל הוחלף) → הטיימר מנקה את עצמו. */
      if (!document.contains(clock)) { clearInterval(clockIv); return; }
      const left = Math.max(0, Math.round((endAt - Date.now()) / 1000));
      clock.classList.toggle('warn', left <= 30 * 60 && left > 10 * 60);
      clock.classList.toggle('crit', left > 0 && left <= 10 * 60);
      clock.title = left <= 10 * 60 ? 'פחות מ-10 דקות!' : left <= 30 * 60 ? 'חצי שעה אחרונה' : 'הזמן שנותר';
      if (left === 0) {
        clearInterval(clockIv);
        clock.textContent = '⏰ הזמן נגמר — אפשר להמשיך';
        clock.classList.add('crit');
        clock.title = 'במבחן האמיתי היו אוספים כאן. פה לא — סיימו בקצב שלכם.';
        return;
      }
      clock.textContent = '⏱ ' + fmt(left);
    };
    clockIv = setInterval(tick, 1000);
    tick();
  }
  /* השיא כפי שהיה *בתחילת* הסבב. "שיא אישי" נחגג רק כשעוברים אותו — כלומר
     שוברים שיא מסבב קודם, לא סתם מתקדמים בתוך הסבב הנוכחי. */
  const bestAtStart = bestStreak();
  function paintStreak() {
    if (streak >= 2) {
      streakPill.hidden = false;
      streakPill.innerHTML = '';
      streakPill.append(el('span', 'flame', '🔥'), el('span', 'sn', String(streak)));
      streakPill.classList.remove('bump'); void streakPill.offsetWidth; streakPill.classList.add('bump');
    } else {
      streakPill.hidden = true;
    }
  }
  /* נקרא מ-choose על תשובה נכונה. off-syllabus לא נספר (כמו בציון). */
  function bumpStreak(isRight, item) {
    if (item.offSyllabus) return;
    if (!isRight) { streak = 0; paintStreak(); return; }
    streak++;
    paintStreak();
    if (streak > bestStreak()) setBestStreak(streak);        // שומרים את השיא לכל החיים
    if (isStreakMilestone(streak)) {
      if (streak > bestAtStart && bestAtStart >= 3) celebrateBest(streak);   // שברת שיא מסבב קודם
      else celebrateStreak(streak);
    }
    if (cfg.milestone) checkCourseMilestone(cfg.milestone);
  }

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
    /* במצב מבחן לפני חשיפה — לא מדליפים נכון/שגוי: ספירה ניטרלית ופס ללא צבע. */
    const hideScore = examMode && !revealed;
    cGood.textContent = hideScore ? `נענו ${answered}` : `✓ ${good}`;
    cBad.textContent = hideScore ? '' : `✗ ${bad}`;
    cLeft.textContent = `נותרו ${scoredCount - answered}`;
    fill.style.width = Math.round((answered / scoredCount) * 100) + '%';
    fill.className = hideScore ? '' : (answered ? (good / answered >= 0.7 ? 'good' : 'bad') : '');

    if (persist) {
      store.save(key, {
        ...toStore(answers, questions),        // אינדקס → qid, בגבול בלבד
        correct: good, done: answered === scoredCount, at: Date.now(),
      });
    }

    toResult.style.display = (answered === scoredCount && !hideScore) ? '' : 'none';

    resultBox.innerHTML = '';
    if (answered !== scoredCount || hideScore) return;

    const pct = Math.round((good / scoredCount) * 100);
    /* חגיגת סיום — פעם אחת לסבב, על ציון גבוה. הדגל מגן מפני ירי כפול
       אם refresh ייקרא שוב אחרי שכבר סיימת. */
    if (!celebratedResult) { celebratedResult = true; celebrateResult(pct, scoredCount, firstName()); }
    const box = el('div', 'result');
    box.append(el('div', 'grade ' + (pct >= 80 ? 'good' : pct >= 60 ? 'mid' : 'bad'), pct + '%'));
    /* פנייה אישית כשהצליח: "כל הכבוד, ___!" — רק כשיש שם וציון טוב. */
    const nm = window.Cloud?.user?.firstName;
    const praise = pct >= 80 ? (nm ? `כל הכבוד, ${nm}! שליטה טובה בחומר.` : 'שליטה טובה בחומר.')
      : pct >= 60 ? 'יש בסיס, כדאי לחזור על הטעויות.' : 'שווה סבב נוסף על החומר.';
    box.append(el('div', 'sub', `${good} נכונות מתוך ${scoredCount}. ${praise}`));
    const row = el('div', 'btn-row');
    row.style.justifyContent = 'center';
    /* „אחרי סבב של 10 שאלות למשל לעשות עוד סבב של אותו דבר בלחיצת כפתור ולא
       לחזור אחורה לבחור נושאים מחדש” (גלב, בסקר). היה כפתור „סבב נוסף” — אבל
       הוא הגיש בדיוק את אותן עשר שאלות, והדרך היחידה לעשרה חדשים הייתה לחזור
       לבורר, ששם כל הפילטרים מתאפסים. עכשיו החדשות הן ברירת המחדל. */
    if (cfg.reroll) {
      const fresh = el('button', 'btn primary', 'עוד סבב — שאלות חדשות');
      fresh.title = 'סבב חדש באותם נושאים ובאותו סינון, עם שאלות אחרות';
      fresh.onclick = () => { forgetRound(); cfg.reroll(); };
      row.append(fresh);
    }
    const again = el('button', 'btn' + (cfg.reroll ? '' : ' primary'), cfg.reroll ? 'לחזור על אלה' : 'סבב נוסף');
    again.title = 'איפוס והתחלת סבב חדש על אותן שאלות';
    again.onclick = doReset;
    row.append(again);
    const bk = exitLink(el('a', 'btn', 'חזרה ל' + back.text));
    bk.title = 'יציאה מהתרגול — ההתקדמות שלך נשמרת';
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
      const ky = keyerFor(courseId, name);
      if (ky) {
        const a = el('a', 'bd-sim bd-drill', '🔑 לזהות מרמזים');
        a.href = '#/keyer/' + ky.id;
        a.title = ky.title;
        r.append(a);
      }
      box.append(r);
    });
    return box;
  }

  function doReset() {
    for (const k of Object.keys(answers)) delete answers[k];
    elim.clear();
    if (persist) store.reset(key);
    streak = 0; celebratedResult = false; paintStreak();
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

    /* "לחזור לזה" — סימון שאלה לחזרה. (כפתור 🔗 להעתקת קישור לשאלה היה כאן
       ובוטל ב-14/08/2026 — ינון: מיותר. הראוט #/q/<qid> נשאר חי, כדי
       שקישורים שכבר שותפו ימשיכו לעבוד.) */
    if (item.qid) {
      const tools = el('div', 'q-tools');

      const fl = el('button', 'q-tool' + (flags.has(item.qid) ? ' on' : ''));
      fl.type = 'button';
      const paintFlag = () => {
        const on = flags.has(item.qid);
        fl.textContent = on ? '🔖' : '🏷️';
        fl.classList.toggle('on', on);
        fl.title = on ? 'מסומנת — לחץ להסרה' : 'לסמן: לחזור לזה';
        fl.setAttribute('aria-label', fl.title);
      };
      paintFlag();
      fl.onclick = () => { flags.toggle(item.qid); paintFlag(); };
      tools.append(fl);

      /* פתיחת דף הנוסחאות ישר על הסעיף של השאלה הזאת — לפני התשובה, כי זה
         בדיוק מה שעושים במבחן: מזהים את סוג החישוב ומדפדפים למקום הנכון. */
      const sec = sheetRefFor(cfg.courseId, item);
      if (sec) {
        /* בסימולציה זה מזיק במקום לעזור: שחף כתב בסקר „כשאני פותח דף נוסחאות
           לא יקבע אותי לאיור ספציפי — חלק מהאתגר זה למצוא לבד; בתרגול זה טוב
           אבל בדימוי מבחן לא רציתי לעבוד על עצמי”. במבחן האמיתי הדף מגיע שלם.
           גם ה-tooltip הסגיר את שם הסעיף עוד לפני הלחיצה. */
        const blind = examMode;
        const sq = el('button', 'q-tool');
        sq.type = 'button';
        sq.textContent = '📄';
        sq.title = blind ? 'דף הנוסחאות' : `דף הנוסחאות · ${sec.label}`;
        sq.setAttribute('aria-label', sq.title);
        sq.onclick = () => openSheet(cfg.courseId, blind ? null : sec.k);
        tools.append(sq);
      }

      /* דיווח על טעות. הארכיון בנוי משחזורים — טעויות מפתח וניסוח הן חלק
         מהמציאות, והדרך הכי מהירה לתפוס אותן היא הסטודנט שנתקל בהן. הדיווח
         מגיע מובנה (qid + סיבה + מה נבחר) במקום "יש טעות באתר" בוואטסאפ. */
      const rp = el('button', 'q-tool');
      rp.type = 'button';
      rp.textContent = '🚩';
      rp.title = 'דיווח על טעות בשאלה';
      rp.setAttribute('aria-label', rp.title);
      rp.onclick = () => openReport({
        courseId: cfg.courseId, item, chosen: answers[qi] ?? null,
      });
      tools.append(rp);
      top.append(tools);
    }

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

    /* ‼️ כל מה שמוצג כאן יושב *מעל* המסיחים — כלומר מול העיניים לפני הבחירה.
       לכן שום טקסט כאן לא נוקב בתשובה. הפירוט שנוקב בה נדחה ל-lateNotes,
       שרץ בתוך paint אחרי המענה. הסקר תפס בדיוק את זה: "בשאלות מסוימות כתוב
       בפסקת טקסט את התשובה הנכונה לפני המענה". */
    if (r && r.conflict) {
      if (r.resolved || r.ruling) {
        card.append(el('div', 'q-warn ok',
          '✅ המפתחות סימנו תשובות שונות בשאלה הזאת, והיא הוכרעה מול חומרי הקורס. ' +
          (r.ruling ? 'התשובה המסומנת כאן היא המוכרעת.' : 'המפתח כאן מתוקן.') +
          ' הפירוט — אחרי שתענה.'));
      } else if (r.rulingMissing) {
        /* הוכרע — אבל התשובה הנכונה לא הוצעה כמסיח בגרסה הזאת. שהשאלה פגומה
           זה בדיוק מה שצריך לדעת *לפני* המענה; מהי התשובה — רק אחריו. */
        card.append(el('div', 'q-warn',
          '⚠️ השאלה הזאת פגומה בגרסה שלפניך: התשובה שהוכרעה כנכונה לא הוצעה כאן ' +
          'כמסיח כלל. אל תשנן את המסיח המסומן — הפירוט אחרי המענה.'));
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

    /* ---------- שאלת hotspot: "לחצו על האזור הנכון" ----------
       סכימה: type:'hotspot' + image + regions:[{x,y,w,h,label}] באחוזים
       (כמו מלבני דף הנוסחאות) + a = אינדקס האזור הנכון. המסיחים נגזרים
       מתוויות האזורים, כך שכל צנרת המענה/משוב/התקדמות הקיימת עובדת כרגיל
       — האזורים על התמונה הם פשוט דרך שנייה ללחוץ על אותו מסיח. */
    const isHotspot = item.type === 'hotspot' && (item.regions || []).length && item.image;
    if (isHotspot && !item.opts) item.opts = item.regions.map((r) => r.label);

    const opts = el('div', 'opts');
    const fb = el('div', 'fb');

    const exSet = elim.get(qi) || elim.set(qi, new Set()).get(qi);
    const paintFns = [];
    const clearEx = el('button', 'elim-reset');
    clearEx.type = 'button';
    clearEx.title = 'החזרת כל המסיחים שפסלת בשאלה הזאת';
    clearEx.textContent = 'ביטול כל הפסילות';
    clearEx.onclick = () => { exSet.clear(); paintFns.forEach((f) => f()); };
    const syncClear = () => { clearEx.hidden = exSet.size === 0 || answers[qi] != null; };

    /* מסיח הוא div ולא button כי button דורס את הטיפוגרפיה והעטיפה של טקסט
       ארוך בעברית. המחיר הוא שהתפקיד והמקלדת לא מגיעים בחינם — ובלעדיהם
       אפשר לענות רק בעכבר או בקיצור 1-9, וקורא מסך לא יודע שזו בחירה. */
    const ord = order.get(qi) || order.set(qi, optOrder(item, cfg.keepOptOrder)).get(qi);
    ord.forEach((oi, di) => {
      const text = item.opts[oi];
      const o = el('div', 'opt');
      o.setAttribute('role', 'button');
      o.tabIndex = 0;
      /* המספר שרואים הוא מקום התצוגה (וגם קיצור המקלדת), ולא האינדקס
         בקובץ — `oi` נשאר המקורי ומזין את כל מה שנשמר. */
      o.append(el('span', 'key', String(di + 1)));
      o.append(el('span', null, text));

      const ex = el('button', 'opt-x');
      ex.type = 'button';
      ex.tabIndex = -1;   // פסילה היא ג'סטה משנית — לא עוצרים עליה בטאב
      const paintX = () => {
        const off = exSet.has(oi);
        o.classList.toggle('ruledout', off);
        ex.textContent = off ? '↺' : '✕';
        ex.title = off ? 'ביטול הפסילה' : 'פסילת המסיח';
        ex.setAttribute('aria-label', ex.title);
        syncClear();
      };
      paintFns.push(paintX);
      paintX();
      ex.onclick = (e) => {
        e.stopPropagation();
        if (answers[qi] != null) return;
        if (exSet.has(oi)) exSet.delete(oi); else exSet.add(oi);
        paintX();
      };
      o.append(ex);

      const pick = () => {
        /* מסיח פסול מוגן מבחירה בטעות — לחיצה עליו קודם מחזירה אותו לחיים. */
        if (answers[qi] == null && exSet.has(oi)) { exSet.delete(oi); paintX(); return; }
        choose(qi, oi, card, opts, fb, item);
        syncClear();
      };
      o.onclick = pick;
      o.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }
      });
      opts.append(o);
    });

    /* שכבת האזורים של hotspot — מעל התמונה שכבר רונדרה למעלה. */
    if (isHotspot) {
      const imgWrap = card.querySelector('.q-img');
      if (imgWrap) {
        imgWrap.classList.add('q-hotspot');
        const rects = [];
        const paintRects = () => {
          const done = answers[qi] != null;
          rects.forEach(({ r, oi }) => {
            r.classList.toggle('hs-ok', done && oi === item.a);
            r.classList.toggle('hs-bad', done && oi === answers[qi] && oi !== item.a);
            r.classList.toggle('hs-idle', !done);
          });
        };
        item.regions.forEach((rg, oi) => {
          const r = el('button', 'hs-rect');
          r.type = 'button';
          r.style.left = rg.x + '%';
          r.style.top = rg.y + '%';
          r.style.width = rg.w + '%';
          r.style.height = rg.h + '%';
          r.title = 'בחירת האזור הזה';
          r.setAttribute('aria-label', rg.label);
          r.onclick = (e) => {
            e.stopPropagation();   // בלי הזום של התמונה
            if (answers[qi] != null) return;
            /* אותו מסלול בדיוק כמו לחיצה על המסיח — כולל שמירה ומשוב. */
            choose(qi, oi, card, opts, fb, item);
            paintRects();
          };
          rects.push({ r, oi });
          imgWrap.append(r);
        });
        /* מענה דרך רשימת המסיחים חייב לצבוע גם את האזורים. */
        opts.addEventListener('click', () => setTimeout(paintRects, 0), true);
        paintRects();
      }
    }

    card.append(opts, clearEx, fb);
    syncClear();
    if (answers[qi] != null) paint(qi, answers[qi], card, opts, fb, item);
    return card;
  }

  function choose(qi, oi, card, opts, fb, item) {
    if (answers[qi] != null) return;
    answers[qi] = oi;
    const isRight = oi === item.a;
    /* oi נוסע פנימה כדי שהמסיח שנבחר יישמר. עד היום הוא נזרק, ולכן "טעית"
       ו"אתה מחליף בין X ל-Y" נראו לאתר אותו דבר. */
    if (!item.offSyllabus) seen.mark(item, isRight, oi);   // מחוץ לחומר לא נכנס ל"טעויות שלי"
    paint(qi, oi, card, opts, fb, item);
    /* החגיגה חיה כאן ולא ב-paint, כי paint רץ מחדש בכל רינדור של שאלה שכבר
       נענתה — והיה יורה טוסט/קונפטי שוב על שאלה ישנה. choose רץ פעם אחת.
       במצב מבחן לפני חשיפה הרצף/החגיגה מדליפים אם צדקת — אז דוחים אותם. */
    if (!(examMode && !revealed)) bumpStreak(isRight, item);
    refresh();
    /* סוף המבחן = כל השאלות הנספרות נענו → חשיפה אוטומטית ("הגשה"). */
    if (examMode && !revealed) {
      const done = questions.reduce((n, q, i) => n + ((!q.offSyllabus && answers[i] != null) ? 1 : 0), 0);
      if (done === scoredCount) revealAnswers();
    }

    /* אין גלילה אוטומטית. הרגע שאחרי המענה הוא הרגע שבו לומדים —
       קוראים את התשובה הנכונה, את ההסבר, ומעכלים. גלילה שמושכת משם
       עובדת נגד המטרה. המשתמש גולל הלאה כשהוא מוכן. */
  }

  function paint(qi, oi, card, opts, fb, item) {
    card.classList.add('done');
    const isRight = oi === item.a;
    const hide = examMode && !revealed;   // מצב מבחן לפני חשיפה — נעילה בלי לחשוף נכונות
    const ord = order.get(qi) || item.opts.map((_, k) => k);
    opts.querySelectorAll('.opt').forEach((o, di) => {
      const i = ord[di];
      o.classList.add('locked');
      /* אחרי המענה אין יותר מה לבחור. בלי זה הטאב ממשיך לעצור על ארבעה
         "כפתורים" מתים בדרך להסבר — שהוא מה שבאמת רוצים להגיע אליו. */
      o.tabIndex = -1;
      o.setAttribute('aria-disabled', 'true');
      if (i === oi) o.classList.add('chosen');
      if (!hide) {
        if (i === item.a) o.classList.add('correct');
        else if (i === oi) o.classList.add('wrong');
      }
    });

    if (hide) {
      fb.className = 'fb show exam-pending';
      fb.innerHTML = '';
      fb.append(el('div', null, '✓ נענתה · התשובה תיחשף בסוף המבחן'));
      return;
    }

    fb.className = 'fb show ' + (isRight ? 'ok' : 'no');
    fb.innerHTML = '';
    fb.append(el('div', null, isRight ? '✓ נכון' : `✗ לא נכון — התשובה הנכונה: ${item.opts[item.a]}`));
    lateNotes(item).forEach((n) => fb.append(n));
    if (item.explain) fb.append(explainBox(item.explain, item, oi));

    /* הפסילות הן חלון לחשיבה שהובילה לתשובה, ולא רק לתוצאה. שני מצבים
       שווים אמירה: פסלת את הנכונה (הטעות קרתה לפני הבחירה — שם צריך לתקן),
       או צמצמת נכון והכרעת נכון (זה מה שהמיומנות הזאת אמורה לעשות). */
    const ex = elim.get(qi);
    if (ex && ex.size) {
      if (ex.has(item.a))
        fb.append(el('div', 'elim-note bad',
          '⚠︎ פסלת את התשובה הנכונה. הטעות כאן קרתה עוד לפני הבחירה — שווה להבין למה היא נראתה לך פסולה.'));
      else if (isRight && ex.size >= item.opts.length - 2)
        fb.append(el('div', 'elim-note ok',
          `✓ צמצמת ל-${item.opts.length - ex.size} והכרעת נכון — בדיוק מה שפסילה טובה אמורה לעשות.`));
    }

    /* קושי המחזור — רק כשהשאלה באמת קשה (≥25% טועים). למי שטעה זו נחמה
       מעוגנת בנתונים; למי שצדק — הישג. שאלות קלות לא מקבלות תג, כי
       "8% טעו" הוא רעש. */
    const cs = COHORT && item.qid && COHORT[item.qid];
    if (cs && cs.n >= 10 && cs.w / cs.n >= 0.25) {
      const pct = Math.round((cs.w / cs.n) * 100);
      fb.append(el('div', 'fb-cohort',
        `🌡️ שאלה קשה למחזור — ${pct}% מהעונים עדיין נופלים בה`));
    }

    const sim = SIM_BY_TOPIC[item.topic];
    if (sim) fb.append(simButton(sim));
    /* טעית בשאלת שעתוק? הרגע הזה הוא בדיוק הרגע לדעת מאיזה עמוד ללמוד אותו. */
    const gb = guideButton(item.topic);
    if (gb) fb.append(gb);
    /* ובשאלת חישוב — הנוסחה קיימת על השולחן במבחן, והמיומנות היא למצוא אותה. */
    const sh = sheetButton(cfg.courseId, sheetRefFor(cfg.courseId, item));
    if (sh) fb.append(sh);
    fb.append(notebookButton(item, oi));
  }

  if (cfg.allowExam) updateExamUI();
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
  btn.title = 'סגירה (או Esc)';
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

/* ================= דף הנוסחאות הרשמי =================
   הדף שמחולק על השולחן במבחן. הוא לא עוד תמונה בארכיון אלא הכלי שאיתו פותרים,
   ולכן הוא נגיש משלושה מצבים שונים: כפתור קבוע בתרגול — זמין *לפני* התשובה,
   בדיוק כמו במבחן; שבב במשוב שמצביע על הסעיף הרלוונטי דווקא — *אחרי* התשובה,
   כשהשאלה "איפה זה היה בדף" היא בדיוק מה שצריך ללמוד; ועמוד עצמאי לעיון.

   הסעיפים אינם חיתוכים אלא מלבנים מנורמלים מעל עמוד המקור. זה מכוון: מי
   שלומד לזהות "זה בעמוד השני, שליש מלמטה" מוצא את זה במבחן בשניות, ומי
   שרואה רק חיתוך לומד נוסחה מרחפת בלי מפה. הקואורדינטות נגזרו מ-blocks
   של ה-PDF ולא מהערכה בעין. */
const SHEET = {
  electro: {
    title: 'דף נוסחאות — פיזיולוגיה כללית ואלקטרופיזיולוגיה',
    sub: 'הדף הרשמי שמחולק במבחן (תשפ״ה). לדעת איפה כל דבר יושב שווה דקות.',
    img: (p) => `assets/img/electro-sheet-${p}.png`,
    pages: [
      { p: 1, title: 'דיפוזיה ונרנסט' },
      { p: 2, title: 'הממברנה כמעגל חשמלי' },
      { p: 3, title: 'סינפסות והבסיס הקוונטאלי' },
    ],
    /* סדר הרשימה = סדר הסריקה. מהספציפי לכללי, כי "התנגדות כניסה" מופיעה גם
       בשאלת כבל וגם בשאלת צימוד, ומי שנסרק ראשון מנצח. */
    sections: [
      { k: 'quantal',  p: 3, y: 0.8545, h: 0.1440, label: 'הבסיס הקוונטאלי — m=EPP/mEPP · npq',
        re: /תכולה קוונטית|קוונטל|קוונטא?לי|mEPP|EPP|npq/ },
      { k: 'coupling', p: 3, y: 0.6340, h: 0.2144, label: 'מקדם צימוד · Rin של תא מצומד',
        re: /מקדם צימוד|סינפסה חשמלית|gap.?junction|קונקסין|connexin/i },
      { k: 'clamp',    p: 3, y: 0.4441, h: 0.1868, label: 'קיבוע מתח — I_H ו-I_syn',
        re: /קיבוע מתח|voltage.?clamp|זרם החזקה|פוטנציאל החזקה/i },
      { k: 'erev',     p: 3, y: 0.3706, h: 0.0674, label: 'פוטנציאל היפוך סינפטי — Erev',
        re: /פוטנציאל היפוך|E ?rev|Esyn|E_syn/i },
      { k: 'gsyn',     p: 3, y: 0.2328, h: 0.1317, label: 'Vmem לפי מוליכות סינפטית יחסית',
        re: /מוליכות סינפטית יחסית|g ?syn|gsyn/i },
      { k: 'epsp',     p: 3, y: 0.0551, h: 0.1746, label: 'פוטנציאל סינפטי במצב עמיד — EPSPss',
        re: /EPSP|gExc|gInh|מעורר.{0,25}מעכב.{0,25}מוליכות/ },
      { k: 'rinput',   p: 2, y: 0.8849, h: 0.1084, label: 'התנגדות כניסה בכבל אין-סופי',
        re: /כבל אין.?סופי|r ?input|התנגדות כניסה/i },
      { k: 'lambda',   p: 2, y: 0.7765, h: 0.1084, label: 'קבוע המרחק — λ=√(aRm/2Ri)',
        re: /קבוע המרחק|קבוע מרחק|λ|למבדה/ },
      { k: 'tau',      p: 2, y: 0.6862, h: 0.0767, label: 'קבוע הזמן — τ=RmCm',
        re: /קבוע הזמן|τ/ },
      { k: 'decay',    p: 2, y: 0.5869, h: 0.0858, label: 'דעיכת מתח לפי קבוע מרחק',
        re: /דעיכת המתח|דועך|Vx ?=|V0 ?e/ },
      { k: 'charge',   p: 2, y: 0.4379, h: 0.1490, label: 'טעינת הממברנה — I_R, I_C, ΔV',
        re: /זרם קיבולי|טעינת הקבל|נטען|הזרקת זרם|הזרקה של זרם/ },
      { k: 'vmem',     p: 2, y: 0.3070, h: 0.1309, label: 'Vmem — מוליכות מקבילית',
        re: /מוליכות מקביל|Vmem|V ?mem/i },
      { k: 'basics',   p: 2, y: 0.0045, h: 0.3025, label: 'חוק אוהם · קיבול · זרם כללי',
        re: /חוק אוהם|V ?= ?IR|קיבול הממברנה/ },
      { k: 'nernst',   p: 1, y: 0.5762, h: 0.4015, label: 'פוטנציאל נרנסט — 58/z ו-61.5/z',
        re: /נרנסט|nernst|61\.5|58\/z|פוטנציאל שיווי המשקל/i },
      { k: 'diff',     p: 1, y: 0.2825, h: 0.2937, label: 'דיפוזיה — γ²=2Dt וקבוע הדיפוזיה',
        /* "דיפוזיה" לבדה רחבה מדי — פעפוע המוליך במרווח הסינפטי מופיע בעשרות
           הסברים ואין לו שום קשר ל-γ²=2Dt. רק סימני הנוסחה עצמה נחשבים. */
        re: /חזית הדיפוזיה|קבוע הדיפוזיה|מקדם הדיפוזיה|צמיגות|אבוגדרו|2Dt/ },
      { k: 'geom',     p: 1, y: 0.1227, h: 0.1152, label: 'גאומטריה — שטח פנים, נפח, היקף',
        re: /שטח פנים|נפח הכדור|היקף/ },
    ],
    /* נפילה-לאחור כשאין התאמת מילים: הסעיף שהנושא חי בו. רק נושאים שבאמת יש
       להם בית בדף — נושא בלי נוסחה לא יקבל שבב, ועדיף כך מאשר להצביע לחלל. */
    byTopic: {
      /* 'תנועת חלקיקים ודיפוזיה' אינו כאן בכוונה: רוב שאלותיו הן אוסמולריות,
         ואוסמולריות פשוט אינה בדף הנוסחאות. עדיף בלי שבב מאשר שבב שמצביע
         על הנוסחה השכנה. */
      'פוטנציאל מנוחה': 'nernst',
      'תכונות פאסיביות של הממברנה': 'tau',
      'הסינפסה: המודל החשמלי': 'epsp',
      'התאוריה הקוונטאלית': 'quantal',
      /* גם 'רצפטורים ותגובה פוסט-סינפטית' אינו כאן: רובו ביולוגיה של קולטנים
         ולא חישוב, ושבב "פוטנציאל היפוך" על שאלת AChR הוא רעש. מי שכן שואל
         על Erev כותב את המילים, והביטוי תופס אותו. */
    },
  },

  /* פיזיקה ב׳ — הדף הרשמי, שלושה עמודים בשתי עמודות כל אחד. שלא כמו באלקטרו,
     כאן המבחן הוא הבנתי כמעט לגמרי ולא חישובי: הדף הזה הוא בעיקר *מפת מושגים*
     — "מה בכלל קיים בנושא הזה ואיך הגדלים קשורים" — ולכן לכל סעיף יש `info`
     שמסביר את הרעיון במשפטיים, לא הוראות הצבה. */
  physics: {
    title: 'דף נוסחאות — פיסיקה לרפואנים ב׳',
    sub: 'הדף הרשמי שמחולק במבחן. במבחן הבנתי הוא פחות "מאיפה להציב" ויותר "מה קשור למה" — לחצו על סעיף לקבל את הרעיון שמאחוריו.',
    topicFirst: true,
    img: (p) => `assets/img/physics-sheet-${p}.png`,
    pages: [
      { p: 1, title: 'חשמל — כוח, שדה, פוטנציאל, זרם ומעגלים' },
      { p: 2, title: 'קבלים · קירכהוף · RC · תנודות וגלים · מגנטיות' },
      { p: 3, title: 'מגנטיות והשראה · הידרוסטטיקה · הידרודינמיקה · צמיגות' },
    ],
    /* סדר הסריקה: מהספציפי לכללי. "לחץ" מופיע גם בברנולי וגם בהידרוסטטיקה,
       ומי שנסרק ראשון מנצח — אז הספציפי (ברנולי, ריינולדס) קודם. */
    sections: [
      /* --- עמוד 3 --- */
      { k: 'viscosity', p: 3, x: 0.060, w: 0.475, y: 0.613, h: 0.252,
        label: 'צמיגות — פואזיי, ריינולדס, זרימה למינרית מול טורבולנטית',
        re: /צמיגות|פואז|ריינולדס|reynolds|למינרי|טורבולנט|פרופיל מהירויות/i,
        info: 'הנושא: איך נוזל אמיתי (עם חיכוך פנימי) זורם בצינור. ΔP=8QηL/πR⁴ — ההתנגדות לזרימה תלויה ברדיוס בחזקה רביעית, ולכן היצרות קטנה בכלי דם מייקרת את הלחץ הדרוש בצורה דרמטית. פרופיל המהירויות פרבולי: מהיר במרכז, אפס בדופן. ריינולדס Re=ρvd/η הוא מספר חסר יחידות שמכריע אם הזרימה חלקה (Re<2000) או מערבולתית (Re>4000) — מערבולת היא מקור האוושה שנשמעת בסטטוסקופ.' },
      { k: 'bernoulli', p: 3, x: 0.060, w: 0.475, y: 0.430, h: 0.180,
        label: 'הידרודינמיקה — ספיקה ומשוואת ברנולי',
        re: /ברנולי|bernoulli|ספיקה|רציפות|Q ?= ?Av|היצרות/i,
        info: 'שתי אמירות. רציפות (Q=Av, קבוע לאורך הצינור): כשהחתך קטן — המהירות גדלה. ברנולי הוא שימור אנרגיה לנוזל: P + ρgh + ½ρv² קבוע. המסקנה שנבחנת: איפה שהנוזל מהיר יותר, הלחץ שם נמוך יותר. זה מסביר למה בהיצרות הלחץ יורד, ולמה כלי דם צר יכול לקרוס.' },
      { k: 'hydrostatic', p: 3, x: 0.060, w: 0.475, y: 0.085, h: 0.335,
        label: 'הידרוסטטיקה — לחץ, ארכימדס, מתח פנים ולפלס',
        re: /הידרוסטט|ארכימדס|צף|ציפה|מתח פנים|לפלס|laplace|בועה|טיפה|surfactant|סורפקטנט|ρgh|לחץ הידרוסטטי|קני מידה|mmHg/i,
        info: 'נוזל במנוחה. P=P₀+ρgh — הלחץ תלוי רק בעומק ובצפיפות, לא בצורת הכלי. ארכימדס: כוח הציפה שווה למשקל הנוזל שנדחק, ולכן היחס בין הצפיפויות הוא היחס בין הנפח השקוע לכולו. מתח פנים ולפלס ΔP=2γ/r (ובבועת סבון, עם שני משטחים, 4γ/r): ככל שהרדיוס קטן — הלחץ הפנימי הדרוש גדול. זה בדיוק למה נאדית ריאה קטנה נוטה לקרוס, ולמה הסורפקטנט (שמוריד את γ) חיוני.' },
      { k: 'induction', p: 3, x: 0.544, w: 0.404, y: 0.340, h: 0.450,
        label: 'שטף מגנטי, פאראדיי-לנץ וכא"מ מושרה',
        re: /שטף מגנטי|פאראדיי|faraday|לנץ|lenz|כא.?מ|אינדוקצי|induction|מושר|EMF|ε ?= ?-/i,
        info: 'הרעיון היחיד: **שינוי** בשטף המגנטי דרך לולאה יוצר מתח. שטף Φ=B·A·sinα — כמה קווי שדה עוברים דרך השטח. (שימו לב: בדף הרשמי α היא הזווית בין השדה ל**מישור** הלולאה, ולכן sin; אם מודדים לנורמל של המשטח זה cos. אותו דבר בדיוק — נצח הבהיר בשיעור החזרה שאין פה מלכוד.) פאראדיי: ε=−ΔΦ/Δt, כלומר לא השדה עצמו מייצר מתח אלא קצב השינוי שלו. סימן המינוס הוא לנץ: הזרם המושרה תמיד מתנגד לשינוי שיצר אותו. שלוש דרכים לשנות שטף — לשנות את B, את השטח, או את הזווית. זה הבסיס לסלילי ה-MRI ולכל גלאי אינדוקטיבי.' },
      { k: 'biosavart', p: 3, x: 0.544, w: 0.404, y: 0.085, h: 0.255,
        label: 'ביו-סבר · תנועה מעגלית של מטען בשדה מגנטי',
        re: /ביו.?סב|biot|כריכה מעגלית|רדיוס סיבוב|תדירות סיבוב|ציקלוטרון|פסיעה|תנועה בורגית/i,
        info: 'שתי משפחות. ביו-סבר נותן את השדה שיוצר זרם — B∝I/r, ובמרכז כריכה B=μ₀I/2a. וכשמטען נכנס לשדה מגנטי בניצב, הכוח תמיד מאונך למהירות ולכן מסלולו מעגלי: R=mv⊥/qB. שימו לב שתדירות הסיבוב f=qB/2πm אינה תלויה במהירות — מטען מהיר פשוט נע במעגל גדול יותר באותו זמן מחזור.' },
      /* --- עמוד 2 --- */
      { k: 'magnetism', p: 2, x: 0.126, w: 0.382, y: 0.453, h: 0.457,
        label: 'מגנטיות — כוח לורנץ, כוח על תיל, חוק אמפר, סליל',
        re: /לורנץ|lorentz|כוח מגנטי|שדה מגנטי|טסלה|tesla|אמפר(?!\])|סולנואיד|סליל|ליפופים|qvB|ILB|μ0/i,
        info: 'איך שדה מגנטי מפעיל כוח, ומי יוצר שדה. כוח לורנץ F=qvB·sinθ — מאונך גם למהירות וגם לשדה (כלל יד ימין), ולכן הוא **לא מבצע עבודה**: הוא מסובב, לא מאיץ. מטען שנע במקביל לשדה לא מרגיש כוח כלל (sin0=0). על תיל נושא זרם: F=ILB·sinα. בכיוון ההפוך — זרם יוצר שדה: תיל אינסופי B∝I/r, וסליל ארוך נותן שדה אחיד בפנים B=μ₀nI. חוק אמפר הוא הניסוח הכללי.' },
      { k: 'shm', p: 2, x: 0.126, w: 0.382, y: 0.113, h: 0.340,
        label: 'תנועה הרמונית פשוטה וגלים — T, f, ω, v=λf',
        re: /הרמונ|קפיץ|מטוטלת|תנודה|אמפליטודה|משרעת|תדירות|אורך גל|v ?= ?λ|למדה.{0,10}תדירות|ω ?=/i,
        info: 'תנועה סביב נקודת שיווי משקל עם כוח מחזיר פרופורציוני להיסט (F=−kΔx). המסקנה הנבחנת: התדירות ω=√(k/m) נקבעת רק ממאפייני המערכת — הקפיץ והמסה — ו**לא** מהמשרעת. מהירות מקסימלית במרכז, תאוצה מקסימלית בקצוות. לגלים: v=λf, כשהמהירות נקבעת מהתווך (ולכן כשגל עובר לתווך אחר התדירות נשמרת ואורך הגל משתנה).' },
      { k: 'rc', p: 2, x: 0.508, w: 0.365, y: 0.525, h: 0.385,
        label: 'מעגל RC — טעינה, פריקה וקבוע הזמן τ=RC',
        re: /RC|קבוע הזמן|טעינת קבל|פריקת קבל|פריקה|אקספוננציאל|τ ?=/i,
        info: 'קבל נטען ונפרק בקצב אקספוננציאלי, וכל ההתנהגות נדחסת למספר אחד: τ=RC. אחרי זמן τ הקבל הגיע ל-63% מהטעינה (או ירד ל-37% בפריקה). התנגדות גדולה או קיבול גדול → תהליך איטי יותר. בביולוגיה זה קבוע הזמן של הממברנה, שקובע כמה מהר פוטנציאל מקומי עולה ודועך.' },
      { k: 'kirchhoff', p: 2, x: 0.508, w: 0.365, y: 0.354, h: 0.171,
        label: 'חוקי קירכהוף — צומת ולולאה',
        re: /קירכהוף|kirchhoff|צומת|לולאה|עניבה|סכום הזרמים|סכום המתחים/i,
        info: 'שני חוקי שימור. בצומת: כל הזרם שנכנס יוצא (שימור מטען). בלולאה סגורה: סכום עליות המתח שווה לסכום הירידות (שימור אנרגיה). מכאן נובע כל ניתוח מעגל מורכב — כולל למה בחיבור טורי הזרם משותף ובמקבילי המתח משותף.' },
      { k: 'capacitors', p: 2, x: 0.508, w: 0.365, y: 0.113, h: 0.241,
        label: 'קבלים — חיבור טורי/מקבילי ואנרגיה אצורה',
        re: /קבל|קיבול|capacit|פאראד|אנרגיה אצורה|אנרגיה עצורה|C ?= ?Q|דיאלקטר/i,
        info: 'קבל אוגר מטען ואנרגיה בשדה שבין הלוחות. C=Q/U תלוי בגאומטריה ובחומר (הדיאלקטרי), לא במתח שמפעילים. שימו לב להיפוך מול נגדים: קבלים **במקביל** מתחברים בחיבור פשוט (C_T=C₁+C₂), ובטור בהופכיים. האנרגיה E=CU²/2 — ולכן הכפלת המתח מרבעת את האנרגיה (הבסיס לדפיברילטור).' },
      /* --- עמוד 1 --- */
      { k: 'circuits', p: 1, x: 0.163, w: 0.351, y: 0.499, h: 0.411,
        label: 'מעגלי זרם ישר — טור, מקביל, מתח הדקים וקיבול',
        re: /טור|מקביל|R ?T|מתח הדקים|התנגדות פנימית|סוללה|מקור מתח|נגדים/i,
        info: 'בטור הזרם משותף וההתנגדויות מתחברות; במקביל המתח משותף וההתנגדות הכוללת קטנה מכל אחת מהן. מתח ההדקים U=ε−Ir מסביר למה מתח הסוללה יורד כשמושכים ממנה זרם גדול — ההתנגדות הפנימית "גונבת" חלק.' },
      { k: 'power', p: 1, x: 0.163, w: 0.351, y: 0.351, h: 0.148,
        label: 'הספק חשמלי ואנרגיה — P=IU, חום ג׳אול',
        re: /הספק|וואט|watt|אנרגיה חשמלית|חום|קילוואט|P ?= ?I ?U|ג.אול/i,
        info: 'הספק = קצב המרת האנרגיה: P=IU, ובנגד גם I²R או U²/R. בנגד כל ההספק הופך לחום — זה חימום ג׳אול, ההסבר לצריבת רקמה בדיאתרמיה ולחימום של מוליך.' },
      { k: 'current', p: 1, x: 0.163, w: 0.351, y: 0.129, h: 0.222,
        label: 'זרם, התנגדות וחוק אוהם — I=Δq/Δt, R=ρL/S',
        re: /חוק אוהם|אוהם|התנגדות|resist|זרם|אמפר\]|ρL|מוליכות סגולית/i,
        info: 'זרם הוא קצב מעבר מטען. חוק אוהם I=U/R הוא היחס בין הדחיפה (מתח) לעכבה (התנגדות). ההתנגדות עצמה R=ρL/S היא תכונה גאומטרית: ארוך וצר → התנגדות גבוהה; קצר ורחב → נמוכה. זו בדיוק הסיבה שאקסון עבה מוליך טוב יותר.' },
      { k: 'energyKin', p: 1, x: 0.514, w: 0.334, y: 0.880, h: 0.030,
        label: 'שימור אנרגיה — קינטית ופוטנציאלית חשמלית',
        re: /שימור אנרגיה|אנרגיה קינטית|qU ?=|מואץ.{0,15}מתח|מאיץ/i,
        info: 'מטען שמואץ בהפרש פוטנציאל ממיר אנרגיה חשמלית לקינטית: qU=½mv². זה החישוב שמאחורי שפופרת הרנטגן — מתח האצה גבוה יותר נותן אלקטרונים מהירים יותר, ולכן פוטונים אנרגטיים יותר.' },
      { k: 'potential', p: 1, x: 0.514, w: 0.334, y: 0.621, h: 0.259,
        label: 'אנרגיה פוטנציאלית ופוטנציאל חשמלי — V, U, E=ΔV/Δx',
        re: /פוטנציאל חשמלי|אנרגיה פוטנציאלית|מתח בין|וולט|V ?= ?Kq|ΔV|עבודה.{0,20}מטען/i,
        info: 'פוטנציאל V הוא האנרגיה שיחידת מטען הייתה מקבלת בנקודה — גודל סקלרי, בלי כיוון. מתח הוא הפרש פוטנציאלים בין שתי נקודות, וזה מה שמניע זרם. הקשר E=ΔV/Δx אומר ששדה הוא שיפוע הפוטנציאל: איפה שהפוטנציאל משתנה בחדות, השדה חזק. בתוך מוליך במצב עמיד הפוטנציאל אחיד ולכן השדה אפס.' },
      { k: 'field', p: 1, x: 0.514, w: 0.334, y: 0.256, h: 0.365,
        label: 'שדה חשמלי וחוק גאוס — נקודתי, תיל, לוח וכדור',
        re: /שדה חשמלי|חוק גאוס|gauss|צפיפות מטען|לוחות טעונים|קבל לוחות|E ?= ?Kq|σ|כדור מוליך/i,
        info: 'שדה הוא הכוח ליחידת מטען, ולכן F=qE. הצורה תלויה בגאומטריה של המקור — וזה בדיוק מה שנבחן: מטען נקודתי דועך כ-1/r², תיל אינסופי כ-1/r, ולוח אינסופי נותן שדה **אחיד** שלא תלוי במרחק כלל. חוק גאוס הוא הקיצור שמאפשר להסיק זאת מסימטריה, והוא גם נותן את התוצאה שבתוך מוליך טעון השדה אפס.' },
      { k: 'coulomb', p: 1, x: 0.514, w: 0.334, y: 0.129, h: 0.127,
        label: 'כוח חשמלי — חוק קולון',
        re: /קולון|coulomb|כוח חשמלי|Kq1q2|מטענים נקודתיים/i,
        info: 'הכוח בין שני מטענים: פרופורציוני למכפלתם ויורד כריבוע המרחק. הכפלת המרחק מחלישה את הכוח פי ארבעה. אותו מבנה מתמטי בדיוק כמו כוח הכבידה — רק שכאן הכוח יכול גם לדחות.' },
    ],
    byTopic: {
      'מטען, שדה ופוטנציאל חשמלי': 'field',
      'חוק גאוס ויישומיו': 'field',
      'קבלים — חיבור ואנרגיה': 'capacitors',
      'זרם, התנגדות וחוק אוהם': 'current',
      'מעגלים וחוקי קירכהוף': 'kirchhoff',
      'מעגל RC': 'rc',
      'האקסון כמוליך — תיאוריית הכבל': 'rc',
      'שדה מגנטי וכוח לורנץ': 'magnetism',
      'כוח מגנטי על תיל, ביו-סבאר ואמפר': 'biosavart',
      'אינדוקציה — פאראדיי-לנץ': 'induction',
      'תנועה הרמונית פשוטה': 'shm',
      'גלים, קול ואפקט דופלר': 'shm',
      'לחץ וצפיפות': 'hydrostatic',
      'עקרון ארכימדס והציפה': 'hydrostatic',
      'מתח פנים וחוק לפלס': 'hydrostatic',
      'משוואת ברנולי וספיקה': 'bernoulli',
      /* null = "אין לזה בית בדף, ואל תנחשו". בלי הסימון המפורש הביטויים היו
         תופסים את שאלות הדימות ומצמידים להן שבבים אבסורדיים (PET → צמיגות,
         רנטגן → קבלים). הדימות כמעט כולו מושגי; הדף לא עוזר לו. */
      'הספקטרום האלקטרומגנטי והאפקט הפוטואלקטרי': null,
      'רנטגן ו-CT': null,
      'רפואה גרעינית ו-PET': null,
      'MRI': null,
      'גלים אלקטרומגנטיים': null,
      /* שאלות הכיתה והניסויים חוצות נושאים ואין להן יחידה קנונית — שם דווקא
         הביטויים הם הראיה היחידה, ולכן הן נשארות בנפילה-לאחור. */
    },
  },
};

const sheetOf = (courseId) => SHEET[courseId] || null;
function sheetSection(courseId, key) {
  const s = sheetOf(courseId);
  return s ? s.sections.find((x) => x.k === key) || null : null;
}

/* מהשאלה לסעיף. קודם מילים בגוף השאלה — הן הראיה החזקה; ורק אם אין, הנושא.
   מחזיר null בשמחה: שבב שמצביע על הסעיף הלא-נכון גרוע משבב שאינו קיים.

   `topicFirst` הופך את הסדר, ובפיזיקה זה הנכון: שם הנושאים הם 21 היחידות
   הקנוניות של מפת החומרים — תיוג מדויק שנעשה ידנית — בעוד שגוף השאלה מלא
   במילים משותפות ("לולאה", "טור", "בועה") שמושכות לסעיף השכן. במקרה כזה
   הביטויים נשארים כנפילה-לאחור לנושאים שאין להם בית ב-byTopic. */
function sheetRefFor(courseId, item) {
  const s = sheetOf(courseId);
  if (!s || !item) return null;
  /* null מפורש ב-byTopic = "לנושא הזה אין בית בדף, ואל תנחשו". מחזיר את
     המחרוזת 'none' כדי שהקורא יבחין בינו לבין "לא ידוע" ולא ייפול לביטויים. */
  const byTopic = () => {
    if (Object.prototype.hasOwnProperty.call(s.byTopic, item.topic) && s.byTopic[item.topic] === null) return 'none';
    const k = s.byTopic[item.topic];
    return k ? sheetSection(courseId, k) : null;
  };
  const byWords = () => {
    const hay = [item.q, (item.opts || []).join(' '), item.explain || ''].join(' ');
    return s.sections.find((sec) => sec.re && sec.re.test(hay)) || null;
  };
  const t = s.topicFirst ? byTopic() : null;
  if (t === 'none') return null;
  const res = s.topicFirst ? (t || byWords()) : (byWords() || byTopic());
  return res === 'none' ? null : res;
}

/* גוף התצוגה — אותו קוד לעמוד העצמאי ולחלון הצף, כי זה אותו דף.
   focusKey מדליק מלבן על סעיף אחד וגולל אליו. */
function sheetNode(courseId, focusKey = null) {
  const s = sheetOf(courseId);
  const wrap = el('div', 'sheet');
  if (!s) return wrap;

  const idx = el('div', 'sheet-idx');
  const marks = {};
  s.sections.forEach((sec) => {
    const b = el('button', 'sheet-chip', sec.label);
    b.type = 'button';
    b.title = 'הדגשת הסעיף על הדף וגלילה אליו';
    b.dataset.k = sec.k;
    b.onclick = () => focus(sec.k);
    idx.append(b);
  });
  wrap.append(idx);

  /* "מה הרעיון כאן" — פאנל ההסבר. במבחן הבנתי הנוסחה לבדה לא עוזרת: מה
     שחסר הוא מה כל גודל אומר ומה נובע מהיחס ביניהם. מוצג רק לסעיפים שיש
     להם `info`, כך שמקצוע בלי הסברים מתנהג בדיוק כמו קודם. */
  const infoBox = el('div', 'sheet-info');
  infoBox.hidden = true;
  if (s.sections.some((sec) => sec.info)) wrap.append(infoBox);

  const pagesBox = el('div', 'sheet-pages');
  s.pages.forEach((pg) => {
    const box = el('div', 'sheet-page');
    const cap = el('div', 'sheet-cap', `עמוד ${pg.p} — ${pg.title}`);
    const holder = el('div', 'sheet-holder');
    const img = el('img');
    img.src = s.img(pg.p);
    img.alt = `דף הנוסחאות, עמוד ${pg.p} — ${pg.title}`;
    img.loading = 'lazy';
    holder.append(img);
    s.sections.filter((sec) => sec.p === pg.p).forEach((sec) => {
      const m = el('div', 'sheet-mark');
      m.style.top = (sec.y * 100).toFixed(2) + '%';
      m.style.height = (sec.h * 100).toFixed(2) + '%';
      /* x/w אופציונליים. באלקטרו הדף חד-טורי ומלבן ברוחב מלא מדויק; בפיזיקה
         הוא דו-טורי, ובלי זה כל סימון היה בולע גם את הטור השכן. */
      if (sec.x != null) {
        m.style.insetInlineStart = 'auto';
        m.style.left = (sec.x * 100).toFixed(2) + '%';
        m.style.right = 'auto';
        m.style.width = ((sec.w ?? 1 - sec.x) * 100).toFixed(2) + '%';
      }
      m.append(el('span', 'sheet-mark-tag', sec.label));
      holder.append(m);
      marks[sec.k] = m;
    });
    box.append(cap, holder);
    pagesBox.append(box);
  });
  wrap.append(pagesBox);

  function focus(k) {
    Object.entries(marks).forEach(([key, m]) => m.classList.toggle('is-on', key === k));
    idx.querySelectorAll('.sheet-chip').forEach((b) => b.classList.toggle('on', b.dataset.k === k));
    const sec = s.sections.find((x) => x.k === k);
    infoBox.innerHTML = '';
    infoBox.hidden = !sec?.info;
    if (sec?.info) {
      infoBox.append(el('div', 'sheet-info-t', '💡 ' + sec.label));
      const p = el('p');
      /* **הדגשה** → <b>. הטקסט נכתב על ידינו ולא מגיע מקלט משתמש. */
      p.innerHTML = String(sec.info).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
      infoBox.append(p);
    }
    const m = marks[k];
    if (m) setTimeout(() => m.scrollIntoView({ behavior: 'smooth', block: 'center' }), 40);
  }
  if (focusKey) focus(focusKey);
  return wrap;
}

/* החלון הצף. אותה התנהגות כמו הלייטבוקס של האיורים — Escape סוגר, המיקוד
   נלכד, לחיצה על הרקע סוגרת — כדי שלא יהיו כאן שני חוזי-מקלדת שונים. */
function openSheet(courseId, focusKey = null) {
  if (!sheetOf(courseId)) return;
  const overlay = el('div', 'lightbox sheet-lb');
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'דף הנוסחאות');

  const pane = el('div', 'lb-pane sheet-pane');
  pane.addEventListener('click', (e) => e.stopPropagation());
  pane.append(sheetNode(courseId, focusKey));

  const btn = el('button', 'lb-close', '✕');
  btn.type = 'button';
  btn.title = 'סגירה (או Esc)';
  btn.setAttribute('aria-label', 'סגירה');
  btn.onclick = close;

  overlay.append(pane, btn);
  const prev = document.activeElement;
  function close() {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    if (prev && prev.focus) prev.focus();
  }
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'Tab') { e.preventDefault(); btn.focus(); }
  };
  overlay.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.append(overlay);
  btn.focus();
}

/* ================= דיווח על טעות בשאלה =================
   חלון צף כמו openSheet — Escape סוגר, לחיצה על הרקע סוגרת. בלי מלכודת
   Tab לכפתור הסגירה: כאן יש טופס, והמקלדת צריכה לנוע בין השדות. */
const REPORT_REASONS = [
  ['wrong_answer', 'התשובה המסומנת כנכונה — שגויה'],
  ['typo',         'טעות הקלדה או ניסוח'],
  ['unclear',      'השאלה לא ברורה או חסר בה מידע'],
  ['other',        'משהו אחר'],
];

function openReport({ courseId, item, chosen }) {
  const overlay = el('div', 'lightbox report-lb');
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'דיווח על טעות בשאלה');

  const pane = el('div', 'lb-pane report-pane');
  pane.addEventListener('click', (e) => e.stopPropagation());

  pane.append(el('h3', 'report-title', '🚩 דיווח על טעות בשאלה'));
  pane.append(el('p', 'report-q', (item.q || '').slice(0, 140) + ((item.q || '').length > 140 ? '…' : '')));

  const C = window.Cloud;
  if (!C || !C.enabled || !C.user) {
    /* בלי חשבון אין למי לשייך את הדיווח (וזה גם רסן הספאם). לא טופס מת —
       הסבר וכפתור התחברות במקום. */
    pane.append(el('p', 'report-note',
      C && C.enabled
        ? 'כדי לשלוח דיווח צריך להתחבר — כך אפשר לחזור אליך אם יהיו שאלות על הדיווח.'
        : 'הדיווחים זמינים רק בגרסה המקוונת של האתר.'));
    if (C && C.enabled) {
      const lg = el('button', 'btn primary', 'התחברות עם Google');
      lg.type = 'button';
      lg.title = 'התחברות לחשבון — ואז אפשר לדווח';
      lg.onclick = () => C.login();
      pane.append(lg);
    }
  } else {
    let reason = null;
    const pills = el('div', 'report-reasons');
    const pillEls = [];
    REPORT_REASONS.forEach(([k, label]) => {
      const b = el('button', 'report-reason', label);
      b.type = 'button';
      b.title = 'בחירת סיבת הדיווח';
      b.onclick = () => {
        reason = k;
        pillEls.forEach((x) => x.classList.toggle('on', x === b));
        syncSend();
      };
      pillEls.push(b);
      pills.append(b);
    });
    pane.append(pills);

    const ta = el('textarea', 'report-ta');
    ta.rows = 3;
    ta.maxLength = 2000;
    ta.placeholder = 'פירוט (לא חובה) — למשל: לפי ההרצאה של שיעור 4, התשובה הנכונה היא ג׳';
    ta.addEventListener('input', () => syncSend());
    pane.append(ta);

    const row = el('div', 'report-actions');
    const send = el('button', 'btn primary', 'שליחת הדיווח');
    send.type = 'button';
    send.title = 'שליחת הדיווח לבדיקה';
    const msg = el('span', 'report-msg');
    row.append(send, msg);
    pane.append(row);

    /* "משהו אחר" בלי מילה אחת של הסבר הוא דיווח שאי אפשר לעשות איתו כלום. */
    const ready = () => reason && (reason !== 'other' || ta.value.trim());
    function syncSend() { send.disabled = !ready(); }
    syncSend();

    send.onclick = async () => {
      if (!ready() || send.disabled) return;
      send.disabled = true;
      msg.textContent = 'שולח…';
      msg.className = 'report-msg';
      const r = await C.report({
        courseId,
        examId: item.examId,
        qid: item.qid,
        reason,
        detail: ta.value,
        chosen,
        qPreview: (item.q || '').slice(0, 160),
      });
      if (r.ok) {
        msg.textContent = '✓ הדיווח נשלח — תודה! נבדוק מול חומרי הקורס.';
        msg.classList.add('ok');
        setTimeout(close, 1600);
      } else {
        /* `saved` = נשמר מקומית ויישלח כשתחזור רשת. זו לא שגיאה מבחינת
           המשתמש — הדיווח שלו לא אבד — ולכן גם הצבע ירוק. */
        msg.textContent = r.saved
          ? '✓ אין רשת כרגע — הדיווח נשמר ויישלח אוטומטית כשתחזור.'
          : r.reason === 'net' ? '✗ אין חיבור — נסה שוב עוד רגע.'
          : '✗ השליחה נכשלה. נסה שוב מאוחר יותר.';
        msg.classList.add(r.saved ? 'ok' : 'bad');
        send.disabled = false;
      }
    };
  }

  const btn = el('button', 'lb-close', '✕');
  btn.type = 'button';
  btn.title = 'סגירה (או Esc)';
  btn.setAttribute('aria-label', 'סגירה');
  btn.onclick = close;

  overlay.append(pane, btn);
  const prev = document.activeElement;
  function close() {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    if (prev && prev.focus) prev.focus();
  }
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  overlay.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.append(overlay);
}

/* ================= סקר המשוב — סוף סמסטר ב׳ =================

   עמוד #/survey. אחרי המבחנים המשתמשים נעלמים עד דצמבר, וזה החלון היחיד
   לשמוע מהם מה עבד ומה לבנות. אשף בן חמישה חלקים, רובו לחיצות — 5–10 דקות.
   טיוטה נשמרת מקומית בכל שינוי, כך שרענון או יציאה לא מוחקים כלום; השליחה
   היא INSERT יחיד דרך Cloud.survey — מסמך jsonb אחד, כי הנוסח ישתנה בין
   סבבים ואין טעם לטור-לכל-שאלה. */

const SURVEY_VERSION   = 1;
const SURVEY_DRAFT_KEY = 'shichzurim.surveyDraft.v1';
const SURVEY_DONE_KEY  = 'shichzurim.surveyDone.v1';

/* הפוגות קומיות בין חלקי הסקר — מם קופץ אחרי כל "המשך". בלי כיתוב מעל:
   המם מדבר בעד עצמו. ארבעה ממים לארבעה מעברים; מעבר בלי מם ממשיך ישר. */
const SURVEY_MEMES = [
  'assets/img/mail/meme-biomol-electro.jpg',
  'assets/img/mail/meme-atp.jpg',
  'assets/img/mail/meme-almog.jpg',
  'assets/img/mail/meme-ai-site.jpg',
];

const SURVEY_FEATURES = [
  ['exams',    '📝 שחזורים ותרגול שאלות'],
  ['simexam',  '🎓 סימולציית מבחן מלאה'],
  ['review',   '🔁 חזרה על טעויות'],
  ['shinun',   '🧠 שינון — i❤️Shinun'],
  ['guides',   '📖 הסיכומים המלאים'],
  ['formulas', '📄 דף הנוסחאות'],
];

/* השאלות, חלק-חלק. required חוסם את "המשך" — רק על שאלות לחיצה: טקסט חופשי
   לעולם לא חובה, כדי שהסקר ירגיש קל ולא כמו טופס ביורוקרטי. */
function surveySteps() {
  return [
    { icon: '👋', title: 'קצת עליך', sub: 'חצי דקה של רקע — כדי שנדע לקרוא את שאר התשובות נכון.', qs: [
      { k: 'courses', type: 'multi', required: true,
        label: 'עם אילו מקצועות למדת כאן?', hint: 'אפשר לסמן כמה',
        opts: COURSES.map((c) => [c.id, c.name]) },
      { k: 'usage', type: 'single', required: true,
        label: 'באיזו תדירות השתמשת באתר בתקופת המבחנים?',
        opts: [['daily', 'כמעט כל יום'], ['weekly', 'כמה פעמים בשבוע'],
               ['before', 'בעיקר בימים שלפני כל מבחן'], ['rare', 'פעמים בודדות']] },
      { k: 'device', type: 'multi', required: true,
        label: 'מאיפה בעיקר נכנסת?', hint: 'אפשר לסמן כמה',
        opts: [['phone', '📱 טלפון'], ['computer', '💻 מחשב'], ['tablet', 'טאבלט']] },
      { k: 'heard', type: 'single', required: true,
        label: 'איך הגעת לאתר בפעם הראשונה?',
        opts: [['friend', 'חבר/ה שלחו לי'], ['group', 'קבוצת הווטסאפ של השנתון'],
               ['class', 'שמעתי בכיתה'], ['other', 'אחר / לא זוכר/ת']] },
    ]},
    { icon: '⭐', title: 'מה עבד', sub: 'דירוג כן עוזר: ככה נדע במה להשקיע ומה לחשוב עליו מחדש.', qs: [
      { k: 'ratings', type: 'grid', required: true,
        label: 'איך היית מדרג/ת כל חלק באתר?',
        hint: '1 = לא עזר · 5 = הציל אותי. לא הכרתם? סמנו „לא השתמשתי”.',
        opts: SURVEY_FEATURES },
      { k: 'topFeature', type: 'single', required: true,
        label: 'ואם חייבים לבחור אחד — מה הדבר שהכי עזר לך?',
        opts: SURVEY_FEATURES },
      { k: 'moment', type: 'text',
        label: 'היה רגע שבו האתר ממש הציל אותך? נשמח לשמוע 🙂',
        ph: 'לא חובה — למשל: „ערב לפני אלקטרו עברתי על כל הטעויות שלי ו…”' },
    ]},
    { icon: '🧩', title: 'מה חסר', sub: 'כאן אנחנו הכי צריכים אתכם — ביקורת אמיתית שווה יותר ממחמאה.', qs: [
      { k: 'friction', type: 'multi', required: true,
        label: 'מה הפריע או תסכל בשימוש?', hint: 'אפשר לסמן כמה',
        opts: [['mistakes', 'טעויות בשאלות או בתשובות'], ['coverage', 'חסרו שאלות בנושאים מסוימים'],
               ['explain', 'הסברים לא מספיק ברורים'], ['ui', 'הממשק — ניווט, עיצוב, נוחות'],
               ['bugs', 'באגים ותקלות טכניות'], ['none', 'כלום — היה מצוין']] },
      { k: 'frictionDetail', type: 'text',
        label: 'אם משהו הפריע — איפה בדיוק?',
        ph: 'לא חובה, אבל ככל שתפרטו כך נתקן טוב יותר — קורס, עמוד, דוגמה…' },
      { k: 'missing', type: 'text',
        label: 'מה הכי חשוב שיהיה כאן במבחני דצמבר?',
        ph: 'קורסים, סוגי חומרים, פיצ׳רים — מה שהיה חסר לכם הסמסטר' },
      { k: 'oneChange', type: 'text',
        label: 'אם היית משנה דבר אחד באתר — מה?',
        ph: 'לא חובה' },
    ]},
    { icon: '💎', title: 'כמה זה שווה', sub: 'שאלה כנה, בלי התחייבות משום צד.', qs: [
      { k: 'impact', type: 'scale', required: true,
        label: 'כמה האתר תרם להצלחה שלך במבחנים?',
        lo: 'בקושי', hi: 'תרומה מכרעת' },
      { k: 'nps', type: 'nps', required: true,
        label: 'באיזו סבירות תמליץ/י על האתר לחבר/ה מהשנתון?',
        lo: 'ממש לא', hi: 'בטוח' },
      { k: '_payNote', type: 'note',
        label: 'האתר חינמי, וכל מה שקיים בו יישאר פתוח. כדי שנוכל להמשיך לפתח ברצינות ' +
               '(שרתים, כלים, המון שעות), אנחנו בודקים אפשרות שחלק מהתוספות העתידיות יהיו ' +
               'בתשלום סמלי. שום דבר לא הוחלט — קודם שואלים אתכם.' },
      { k: 'price', type: 'single', required: true,
        label: 'אם חלק מהתוספות העתידיות יהיו בתשלום — כמה היה מרגיש לך הוגן לשלם לשנה?',
        opts: [['0', '0 ₪ — רק החלק החינמי'], ['20', '20 ₪'], ['50', '50 ₪'],
               ['100', '100 ₪'], ['200', '200 ₪']] },
      { k: 'payFor', type: 'multi', required: true,
        label: 'ועל מה היה שווה בעיניך לשלם?', hint: 'אפשר לסמן כמה',
        opts: [['exams', 'עוד שחזורים ותרגול'], ['guides', 'סיכומים מלאים לכל קורס'],
               ['sim', 'סימולציות מבחן'], ['shinun', 'חבילות שינון'],
               ['anki', 'חפיסות אנקי מוכנות'], ['personal', 'מעקב אישי — מה לתרגל ומתי'],
               ['nothing', 'שום דבר — רק חינמי']] },
    ]},
    { icon: '💜', title: 'מילה אחרונה', sub: 'זהו, כמעט סיימנו.', qs: [
      { k: 'vacation', type: 'text',
        label: 'ושאלה אחרונה, הכי חשובה: לאן אתם טסים בחופש? ✈️',
        ph: 'ארץ או יעד — יוון, תאילנד, הספה בסלון…' },
      { k: 'freeText', type: 'text', tall: true,
        label: 'במה עוד בא לך לשתף?',
        ph: 'ביקורת, רעיון, בקשה, מילה טובה — הכול מתקבל באהבה' },
    ]},
  ];
}

function surveyThanks(already) {
  const w = el('div', 'survey-thanks');
  w.append(el('div', 'survey-thanks-ico', '💜'));
  w.append(el('h2', null, already ? 'כבר קיבלנו ממך תשובה — תודה!' : 'זהו! תודה ענקית 🙏'));
  w.append(el('p', null,
    'המשוב הזה הוא בדיוק מה שיקבע מה נבנה לקראת מבחני דצמבר. ' +
    'חופשה נעימה — ונתראה בסמסטר הבא.'));
  const again = el('button', 'btn ghost', 'למלא שוב');
  again.title = 'מילוי חוזר — התשובה החדשה מחליפה את הקודמת (פעם ביום)';
  again.onclick = () => {
    try { localStorage.removeItem(SURVEY_DONE_KEY); } catch { /* ממשיכים */ }
    renderSurvey();
  };
  w.append(again);
  const home = el('a', 'btn', 'חזרה לארכיון');
  home.title = 'חזרה למסך הבית';
  home.href = '#/';
  w.append(home);
  return w;
}

function renderSurvey() {
  setNav('home');
  view.innerHTML = '';
  const C = window.Cloud;
  /* בלי חשבון אין למי לשייך את התשובה (וזה גם רסן הספאם) — כמו הדיווחים. */
  if (C && C.enabled && !C.user) return renderLogin();

  view.append(crumb('לארכיון', '#/'));

  let alreadyDone = false;
  try { alreadyDone = !!localStorage.getItem(SURVEY_DONE_KEY); } catch { /* ממשיכים */ }
  if (alreadyDone) { view.append(surveyThanks(true)); toTop(); return; }

  const steps = surveySteps();
  let draft = {};
  try { draft = JSON.parse(localStorage.getItem(SURVEY_DRAFT_KEY)) || {}; } catch { /* טיוטה חדשה */ }
  if (!draft.startedAt) draft.startedAt = Date.now();
  if (typeof draft.step !== 'number' || draft.step < 0 || draft.step >= steps.length) draft.step = 0;
  const a = draft.answers = draft.answers || {};
  const save = () => { try { localStorage.setItem(SURVEY_DRAFT_KEY, JSON.stringify(draft)); } catch { /* בלי טיוטה */ } };
  save();

  const head = el('div', 'page-head');
  const nm = C?.user?.firstName;
  head.append(el('h1', null, nm ? `${nm}, יש לנו בקשה קטנה 💜` : 'יש לנו בקשה קטנה 💜'));
  head.append(el('p', null,
    'סמסטר שלם למדנו יחד — עכשיו תורנו להקשיב. 5–10 דקות, רובן לחיצות, ' +
    'והתשובות שלך יקבעו מה ייבנה כאן עד דצמבר. הטיוטה נשמרת — אפשר לצאת ולחזור.'));
  view.append(head);

  const wrap = el('div', 'survey');
  view.append(wrap);

  function answered(q) {
    if (q.type === 'multi')  return Array.isArray(a[q.k]) && a[q.k].length > 0;
    if (q.type === 'single') return a[q.k] != null;
    if (q.type === 'scale' || q.type === 'nps') return typeof a[q.k] === 'number';
    if (q.type === 'grid')   return q.opts.every(([fk]) => a[q.k] && a[q.k][fk] != null);
    return true;   // text/note — לעולם לא חוסמים
  }

  function drawStep() {
    wrap.innerHTML = '';
    const si = draft.step;
    const step = steps[si];
    const paints = [];   // כל שאלה רושמת כאן צביעה-מחדש; שינוי קורא לכולן
    const repaint = () => { paints.forEach((f) => f()); syncFoot(); };

    /* פס התקדמות */
    const prog = el('div', 'sv-progress');
    const bar = el('div', 'sv-progress-bar');
    bar.style.width = Math.round(((si + 1) / steps.length) * 100) + '%';
    prog.append(bar);
    wrap.append(prog);
    wrap.append(el('div', 'sv-progress-label', `חלק ${si + 1} מתוך ${steps.length}`));

    const card = el('div', 'sv-card');
    const sh = el('div', 'sv-step-head');
    sh.append(el('span', 'sv-step-ico', step.icon));
    const sht = el('div');
    sht.append(el('h2', null, step.title));
    sht.append(el('p', null, step.sub));
    sh.append(sht);
    card.append(sh);

    step.qs.forEach((q) => {
      if (q.type === 'note') {
        card.append(el('p', 'sv-note', q.label));
        return;
      }
      const box = el('div', 'sv-q');
      const lab = el('div', 'sv-q-label', q.label);
      if (q.required) lab.append(el('span', 'sv-req', ' *'));
      box.append(lab);
      if (q.hint) box.append(el('div', 'sv-q-hint', q.hint));

      if (q.type === 'single' || q.type === 'multi') {
        const g = el('div', 'sv-chips');
        q.opts.forEach(([val, label]) => {
          const b = el('button', 'sv-chip', label);
          b.type = 'button';
          b.title = q.type === 'multi' ? 'אפשר לסמן כמה תשובות' : 'בחירת תשובה';
          const isOn = () => (q.type === 'multi' ? (a[q.k] || []).includes(val) : a[q.k] === val);
          paints.push(() => b.classList.toggle('on', isOn()));
          b.onclick = () => {
            if (q.type === 'multi') {
              const cur = a[q.k] || [];
              a[q.k] = isOn() ? cur.filter((x) => x !== val) : [...cur, val];
            } else {
              a[q.k] = a[q.k] === val ? null : val;
            }
            save(); repaint();
          };
          g.append(b);
        });
        box.append(g);
      }

      if (q.type === 'scale' || q.type === 'nps') {
        const g = el('div', 'sv-scale');
        g.append(el('span', 'sv-scale-edge', q.lo));
        const nums = q.type === 'nps'
          ? Array.from({ length: 11 }, (_, i) => i)
          : [1, 2, 3, 4, 5];
        nums.forEach((n) => {
          const b = el('button', 'sv-chip sv-num', String(n));
          b.type = 'button';
          b.title = 'בחירת ' + n;
          paints.push(() => b.classList.toggle('on', a[q.k] === n));
          b.onclick = () => { a[q.k] = a[q.k] === n ? null : n; save(); repaint(); };
          g.append(b);
        });
        g.append(el('span', 'sv-scale-edge', q.hi));
        box.append(g);
      }

      if (q.type === 'grid') {
        const g = el('div', 'sv-grid');
        q.opts.forEach(([fk, flabel]) => {
          const row = el('div', 'sv-grid-row');
          row.append(el('span', 'sv-grid-name', flabel));
          const cells = el('div', 'sv-grid-cells');
          const vals = [[0, '✕'], [1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5']];
          vals.forEach(([v, t]) => {
            const b = el('button', 'sv-chip sv-num' + (v === 0 ? ' sv-skip' : ''), t);
            b.type = 'button';
            b.title = v === 0 ? 'לא השתמשתי בזה' : 'דירוג ' + v + ' מתוך 5';
            paints.push(() => b.classList.toggle('on', a[q.k] && a[q.k][fk] === v));
            b.onclick = () => {
              a[q.k] = a[q.k] || {};
              a[q.k][fk] = a[q.k][fk] === v ? null : v;
              if (a[q.k][fk] == null) delete a[q.k][fk];
              save(); repaint();
            };
            cells.append(b);
          });
          row.append(cells);
          g.append(row);
        });
        box.append(g);
      }

      if (q.type === 'text') {
        const ta = el('textarea', 'sv-ta');
        ta.rows = q.tall ? 4 : 2;
        ta.maxLength = 2000;
        ta.placeholder = q.ph || '';
        ta.value = a[q.k] || '';
        ta.addEventListener('input', () => { a[q.k] = ta.value; save(); });
        box.append(ta);
      }

      card.append(box);
    });

    /* ניווט בין החלקים */
    const foot = el('div', 'sv-foot');
    const back = el('button', 'btn ghost', '→ חזרה');
    back.type = 'button';
    back.title = 'חזרה לחלק הקודם — התשובות נשמרות';
    back.style.visibility = si === 0 ? 'hidden' : 'visible';
    back.onclick = () => { draft.step = si - 1; save(); drawStep(); toTop(); };
    const last = si === steps.length - 1;
    const next = el('button', 'btn primary', last ? '💜 שליחת המשוב' : 'המשך ←');
    next.type = 'button';
    next.title = last ? 'שליחת כל התשובות' : 'לחלק הבא';
    const msg = el('span', 'sv-msg');
    const missing = () => step.qs.filter((q) => q.required && !answered(q));

    function syncFoot() {
      const m = missing();
      next.disabled = m.length > 0;
      msg.textContent = m.length ? `נשאר לענות על ${m.length === 1 ? 'שאלה אחת' : m.length + ' שאלות'} בחלק הזה` : '';
      msg.className = 'sv-msg';
    }

    /* מעבר עם הפוגת מם: ההתקדמות כבר נשמרה, אז רענון באמצע המם פשוט
       ינחת על החלק הבא. */
    function showMeme(idx) {
      const m = SURVEY_MEMES[idx];
      if (!m) { drawStep(); toTop(); return; }
      wrap.innerHTML = '';
      const card = el('div', 'sv-card sv-meme');
      const img = document.createElement('img');
      img.src = m;
      img.alt = 'מם להפוגה';
      img.className = 'sv-meme-img';
      card.append(img);
      const go = el('button', 'btn primary', 'ממשיכים ←');
      go.type = 'button';
      go.title = 'לחלק הבא של הסקר';
      go.onclick = () => { drawStep(); toTop(); };
      card.append(go);
      wrap.append(card);
      toTop();
    }

    next.onclick = async () => {
      if (next.disabled) return;
      if (!last) { draft.step = si + 1; save(); showMeme(si); return; }

      next.disabled = true;
      msg.textContent = 'שולח…';
      const answers = {
        ...a,
        meta: {
          tookSec: Math.round((Date.now() - draft.startedAt) / 1000),
          build: BUILD || null,
        },
      };
      const r = C && C.enabled
        ? await C.survey(answers, SURVEY_VERSION)
        : { ok: false, reason: 'disabled' };
      if (r.ok || r.reason === 'rate') {
        /* rate = כבר נקלטה תשובה היום — מבחינת המשתמש זה "נשלח". */
        try {
          localStorage.setItem(SURVEY_DONE_KEY, '1');
          localStorage.removeItem(SURVEY_DRAFT_KEY);
        } catch { /* ממשיכים */ }
        head.remove();
        wrap.innerHTML = '';
        wrap.append(surveyThanks(false));
        celebrate({ line: 'תודה ענקית! 💜', sub: 'המשוב נשלח — הוא באמת ישפיע', tier: 'high', confetti: 32, sound: 'big' });
        toTop();
      } else {
        msg.textContent = r.saved
          ? '✓ אין רשת כרגע — התשובות נשמרו ויישלחו אוטומטית כשתחזרו.'
          : r.reason === 'net' ? '✗ אין חיבור — התשובות שמורות אצלך, נסו שוב עוד רגע.'
          : '✗ השליחה נכשלה — התשובות שמורות אצלך, נסו שוב מאוחר יותר.';
        msg.classList.add(r.saved ? 'ok' : 'bad');
        next.disabled = false;
      }
    };

    foot.append(back, next, msg);
    card.append(foot);
    wrap.append(card);
    repaint();
  }

  drawStep();
  toTop();
  updateFooter();
}

/* השבב במשוב: לא "הנה דף הנוסחאות" אלא "זה היה בעמוד 2, סעיף קבוע הזמן". */
function sheetButton(courseId, sec, label) {
  if (!sec) return null;
  const b = el('button', 'btn sheet-btn', label || `📄 בדף הנוסחאות · ${sec.label}`);
  b.type = 'button';
  b.title = 'פתיחת דף הנוסחאות של המבחן, ממוקד על הסעיף הזה';
  b.onclick = () => openSheet(courseId, sec.k);
  return b;
}

/* ================= אנקי — דף ההורדות =================

   ינון (13/08/2026): „אחד הכלים הכי הכי מרכזיים זה הכלי של האנקי.”

   ההחלטה שקובעת את כל השאר: **קובץ אחד לכל קורס, עם תת-חפיסה לכל נושא.**
   כך מורידים פעם אחת ובוחרים באנקי מה ללמוד — במקום לייצר קובץ לכל שילוב
   נושאים אפשרי, שזה מה שהופך את זה לבלתי מתחזק.

   החפיסות נבנות מחוץ לאתר ב-`anki-build.py`, מתוך מפת החומרים: כל נקודה
   ומלכודת הופכות לכרטיס, והגרף מהשאלה המקושרת נכנס לצד האחורי. האתר רק
   מציג ומקשר — הוא לא מייצר כלום בזמן ריצה. */
let ankiIndexCache = null;
async function ankiIndex() {
  if (ankiIndexCache) return ankiIndexCache;
  try {
    const r = await fetch('exams/anki-index.json?v=' + (VERSION || ''));
    ankiIndexCache = r.ok ? await r.json() : { decks: [] };
  } catch { ankiIndexCache = { decks: [] }; }
  return ankiIndexCache;
}

/* יש חפיסה למקצוע הזה?

   נבדק דרך המניפסט ולא דרך אינדקס האנקי, ובכוונה: האינדקס נטען אסינכרונית,
   ועמוד המקצוע מרונדר סינכרונית — כלומר בכניסה הראשונה הקישור היה נעלם.
   התנאי כאן זהה לתנאי הבנייה ב-anki-build.py: חפיסה נבנית ממפת החומרים,
   אז מקצוע שיש לו מפה יש לו חפיסה. */
function hasAnkiDeck(courseId) {
  return examsOf(courseId).some((e) => e.kind === 'guide');
}

async function renderAnki(courseId) {
  setNav('home');
  const c = courseOf(courseId);
  view.innerHTML = '';
  if (!c) { view.append(emptyState('⚠️', 'מקצוע לא נמצא', 'הקישור כנראה שגוי.')); toTop(); return; }
  view.append(crumb(c.name, '#/course/' + courseId));
  view.dataset.course = courseId;

  const idx = await ankiIndex();
  const deck = (idx.decks || []).find((d) => d.course === courseId);

  const head = el('div', 'page-head');
  head.append(el('h1', null, `🃏 חפיסת אנקי — ${c.name}`));
  view.append(head);

  if (!deck) {
    view.append(emptyState('🃏', 'אין עדיין חפיסה למקצוע הזה',
      'חפיסה נבנית ממפת החומרים של המקצוע. כשתהיה מפה — תהיה חפיסה.'));
    toTop(); updateFooter(); return;
  }

  const box = el('div', 'course-about');
  box.append(el('div', 'course-about-title', 'מה יש בחפיסה'));
  const p = el('p');
  p.textContent =
    `${deck.cards} כרטיסים ב-${deck.topics.length} נושאים` +
    '. כל כרטיס הוא שאלה אחת קצרה ותשובה של משפט או שניים — מה ששואלים במבחן, ' +
    'לפי מפת החומרים של המקצוע. אפשר להוריד את הכול כקובץ אחד עם תת-חפיסה ' +
    'לכל נושא, או נושא-נושא; שילוב של השניים לא ישכפל כרטיסים.';
  box.append(p);
  view.append(box);

  const act = el('div', 'btn-row');
  const dl = el('a', 'btn primary');
  dl.href = deck.file;
  dl.setAttribute('download', '');
  dl.textContent = `⬇️ כל החפיסה · ${Math.round(deck.bytes / 1024)} KB`;
  dl.title = 'הקובץ נפתח באנקי בלחיצה — אין צורך בייבוא ידני';
  act.append(dl);
  view.append(act);

  /* נושא-נושא: שורה עם הורדה נפרדת, ותצוגה מקדימה של כרטיסים אמיתיים.
     ההורדה יושבת מחוץ ל-summary — קישור בתוך summary גם מוריד וגם מקפל,
     וזה מרגיש כמו באג. */
  const list = el('div', 'anki-topics');
  deck.topics.forEach((t) => {
    const row = el('div', 'anki-topic');
    const head = el('div', 'anki-topic-head');
    head.append(el('b', null, t.topic));
    head.append(el('span', null, plural(t.cards, 'כרטיס', 'כרטיסים', true)));
    if (t.file) {
      const tdl = el('a', 'btn anki-topic-dl');
      tdl.href = t.file;
      tdl.setAttribute('download', '');
      tdl.textContent = '⬇️';
      tdl.title = `הורדת הנושא הזה בלבד · ${Math.round((t.bytes || 0) / 1024)} KB`;
      head.append(tdl);
    }
    row.append(head);
    if (t.preview && t.preview.length) {
      const det = el('details', 'anki-prev');
      const sum = el('summary');
      sum.append(el('span', null, 'איך נראים הכרטיסים'));
      sum.append(el('span', 'chev', '⌄'));
      det.append(sum);
      const body = el('div', 'anki-prev-body');
      t.preview.forEach((c) => {
        const card = el('div', 'anki-prev-card');
        card.append(el('div', 'anki-prev-q', c.q));
        card.append(el('div', 'anki-prev-a', c.a));
        body.append(card);
      });
      det.append(body);
      row.append(det);
    }
    list.append(row);
  });
  view.append(list);

  const note = el('p', 'anki-note');
  note.textContent = 'צריך את אפליקציית אנקי (חינמית, למחשב ולטלפון). ' +
    'עדכון של החפיסה לא ישכפל כרטיסים — לכל כרטיס מזהה קבוע, ואנקי מעדכן את הקיים.';
  view.append(note);

  toTop();
  updateFooter();
}

function renderSheet(courseId) {
  setNav('home');
  const c = courseOf(courseId);
  const s = sheetOf(courseId);
  if (c) view.dataset.course = courseId;
  view.innerHTML = '';
  view.append(crumb(c ? c.name : 'חזרה', '#/course/' + courseId));
  if (!s) { view.append(emptyState('📄', 'אין דף נוסחאות למקצוע הזה', 'הוא מוגדר לכל מקצוע בנפרד.')); return toTop(); }
  const head = el('div', 'page-head');
  head.append(el('h1', null, '📄 ' + s.title));
  head.append(el('p', null, s.sub));
  view.append(head);
  view.append(sheetNode(courseId));
  toTop();
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
  view.dataset.course = courseId;
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
  /* #/practice/<course>/@<מקצוע> — המאגר מצטמצם לנושאי המקצוע. לפי נושא ולא
     לפי part: כך גם שאלות המקצוע שבשחזור מבחן הבלוק נכנסות. */
  const scope = subjectOf(courseId, scopeKey(seedTopic));
  if (scope) {
    seedTopic = null;
    const ts = new Set(scope.topics || []);
    for (let i = pool.length - 1; i >= 0; i--) if (!ts.has(pool[i].topic)) pool.splice(i, 1);
  }
  const scopeName = scope ? scope.name : c.name;

  view.innerHTML = '';
  view.append(scope
    ? crumb(scope.name, '#/course/' + courseId + '/' + encodeURIComponent(scope.key))
    : crumb(c.name, '#/course/' + courseId));

  const head = el('div', 'page-head');
  head.append(el('h1', null, `תרגול חופשי — ${scopeName}`));
  head.append(el('p', null,
    'בנה לעצמך תרגול. כברירת מחדל תקבל רק שאלות שעוד לא ראית — כדי שתתקדם דרך הארכיון ולא תסתובב במעגל.'));
  view.append(head);

  if (!pool.length) {
    view.append(emptyState('📭', 'אין עדיין שאלות במקצוע הזה', 'הוסף שחזור ראשון, והתרגול ייפתח.'));
    toTop();
    updateFooter();
    return;
  }

  /* (הוסר באנר הסימולציה מכאן — המעבדות הן הכי פחות בשימוש, ומקומן במקופל
     בעמוד המקצוע. עמוד התרגול צריך להוביל לתרגול, לא לכלי צדדי.) */

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
  const normQ = searchNorm;   // מועלה למודול כדי שהחיפוש הגלובלי ישתמש באותו נרמול
  const hay = (q) => (q._hay ??= normQ([q.q, ...(q.opts || []), q.topic, q.explain].filter(Boolean).join(' ')));
  const queryTerms = () => normQ(query).split(/\s+/).filter(Boolean);
  const matchesQuery = (q) => { const t = queryTerms(); return !t.length || t.every((w) => hay(q).includes(w)); };

  /* --- מד התקדמות בארכיון --- */
  const progress = el('div', 'dash');
  view.append(progress);

  function drawProgress() {
    const map = seenH.read();
    const nowTs = Date.now();
    const total = pool.length;
    const done = pool.filter((q) => seenH.has(qKey(q), map)).length;
    /* "טעויות פתוחות" ולא "הטעות האחרונה": שאלה שטעית בה וענית נכון פעם אחת
       עדיין פתוחה, כי נכונה אחת אינה ראיה לידיעה. */
    const wrong = pool.filter((q) => seenH.isOpenMistake(seenH.rec(qKey(q), map))).length;
    const due = pool.filter((q) => {
      const r = seenH.rec(qKey(q), map);
      return r && r.b > 0 && seenH.due(qKey(q), nowTs, map);
    }).length;
    const fresh = total - done;

    progress.innerHTML = '';
    progress.append(stat(fresh, 'שאלות שלא ראית', fresh ? 'accent' : ''));
    progress.append(stat(done, 'שאלות שראית'));
    progress.append(stat(wrong, 'טעויות פתוחות', wrong ? 'bad' : ''));
    progress.append(stat(due, 'בשל לחזרה', due ? 'accent' : ''));
    progress.append(stat(Math.round((done / total) * 100) + '%', 'מהמקצוע'));
  }

  const form = el('div', 'form');

  /* --- מצב --- */
  const modeField = el('div', 'field');
  modeField.append(el('label', null, 'מה לתרגל'));
  const modeChips = el('div', 'chips');
  /* מוצב כאן כדי שמחליף-המצב יוכל לקרוא לו; מאוכלס אחרי שצ׳יפי הכמות נבנים. */
  let setCount = null;

  const MODES = [
    { id: 'new',   label: '✨ שאלות חדשות', tip: 'רק שאלות שעוד לא ראית — להרחבת הכיסוי' },
    { id: 'wrong', label: '🎯 רק מה שטעיתי', tip: 'רק שאלות שהמענה האחרון שלך בהן היה שגוי' },
    /* התשלום של כל מנגנון ההיסטוריה: שאלות שידעת, ושהגיע הזמן לוודא שאתה
       עדיין יודע. כמצב נוסף ולא כברירת מחדל — מי שלא נוגע בו לא מרגיש שינוי. */
    { id: 'due',   label: '🔁 בשל לחזרה', tip: 'שאלות שידעת בעבר והגיע הזמן לוודא שאתה עדיין יודע' },
    { id: 'all',   label: '📚 הכול, כולל מה שראיתי', tip: 'כל השאלות שעוברות את המסננים, בלי התחשבות בהיסטוריה' },
  ];
  /* צ׳יפ "קשות למחזור" — מצטרף רק כשיש דאטה (מיגרציה 0009 + התחברות) ויש
     לפחות 5 שאלות כאלה במקצוע. עד אז אף אחד לא יודע שהוא חסר. */
  loadCohort(() => {
    if (pool.filter(cohortHard).length < 5) return;
    if (modeChips.querySelector('[data-mode="hard"]')) return;
    MODES.push({ id: 'hard', label: '🌡️ קשות למחזור', tip: 'השאלות שלפחות שליש מהמחזור עדיין טועה בהן — אגרגט אנונימי' });
    addModeChip(MODES[MODES.length - 1]);
  });
  function addModeChip(m) {
    const ch = chipEl('chip' + (m.id === mode ? ' on' : ''), m.label, m.tip);
    ch.dataset.mode = m.id;
    ch.onclick = () => {
      mode = m.id;
      modeChips.querySelectorAll('.chip').forEach((x) => x.classList.remove('on'));
      ch.classList.add('on');
      /* „הייתי שמח שהיה תרגול של כל הטעויות שעשיתי — זה לא תמיד עבד” (שחף).
         אחת הסיבות: תקרת 20 שאלות שחלה גם על „רק מה שטעיתי”. מי שצבר 80
         טעויות קיבל 20 מהן, והחיווי על כך היה שורה אפורה קטנה. אלה קבוצות
         סופיות שהמשתמש רוצה *לגמור*, ולכן ברירת המחדל בהן היא הכול. */
      if ((m.id === 'wrong' || m.id === 'due') && setCount) setCount(0);
      update();
    };
    modeChips.append(ch);
  }
  MODES.forEach(addModeChip);
  modeField.append(modeChips);
  form.append(modeField);

  /* --- סינון מתקדם (מתקפל) --- גילוי־הדרגתי: מצב+כמות+התחל גלויים תמיד,
     והשאר (חיפוש/חלקים/נושאים/חזרות/גרפים) מאחורי לחיצה, כדי לא להציף. */
  const adv = el('details', 'adv-filters');
  const advSum = el('summary');
  advSum.append(el('span', null, '🔧 סינון מתקדם'));
  advSum.append(el('span', 'adv-hint', 'נושאים · חיפוש · חלקים · גרפים · חזרות'));
  adv.append(advSum);
  const advBody = el('div', 'adv-body');
  adv.append(advBody);
  if (seedTopic) adv.open = true;   // הגיע עם נושא מכוון — פותחים כדי שיראה את הסינון הפעיל
  form.append(adv);

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
  advBody.append(searchField);

  /* --- חלק --- */
  if (allParts.length > 1) {
    const partsField = el('div', 'field');
    partsField.append(el('label', null, 'חלק'));
    const chips = el('div', 'chips');
    allParts.forEach((p) => {
      const ch = chipEl('chip on', `${c.name} ${p}`, 'הכללת או הסרת החלק הזה מהתרגול');
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
    advBody.append(partsField);
  }

  /* --- נושאים --- */
  const topicsField = el('div', 'field');
  const topicsLabel = el('label', null, 'נושאים');
  topicsField.append(topicsLabel);
  const topicChips = el('div', 'chips');
  topicsField.append(topicChips);
  advBody.append(topicsField);

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

    const all = chipEl('chip' + (selTopics.size === 0 ? ' on' : ''), 'כל הנושאים',
      'ביטול סינון הנושאים — שאלות מכל הנושאים');
    all.onclick = () => { selTopics.clear(); drawTopics(); update(); };
    topicChips.append(all);

    names.forEach((t) => {
      const ch = chipEl('chip' + (selTopics.has(t) ? ' on' : ''), `${t} · ${counts[t]}`,
        'הוספת או הסרת הנושא מהתרגול — המספר: כמה שאלות תואמות עכשיו');
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
      const ch = chipEl('chip' + (n === minRepeat ? ' on' : ''), n === 1 ? label : `${label} · ${have}`,
        n === 1 ? 'בלי סינון לפי חזרות' : 'רק שאלות שחזרו במבחנים לפחות ' + n + ' פעמים — סימן שהן אהובות על המרצים');
      ch.onclick = () => {
        minRepeat = n;
        rc.querySelectorAll('.chip').forEach((x) => x.classList.remove('on'));
        ch.classList.add('on');
        update();
      };
      rc.append(ch);
    });
    repField.append(rc);
    advBody.append(repField);
  }

  /* --- רק גרפים --- */
  /* הגרפים הם ליבת המבחן, אבל אין להם מצב משלהם — הם פזורים בין הנושאים.
     צ׳יפ אחד שמסנן ל-q.image הופך את בריכת התרגול ל"תרגול קריאת גרפים".
     מוצג רק אם באמת יש שאלות תמונה בבריכה. */
  if (pool.some((q) => q.image)) {
    const imgField = el('div', 'field');
    imgField.append(el('label', null, 'גרפים'));
    const ic = el('div', 'chips');
    const ch = chipEl('chip', '🖼️ רק שאלות עם גרף', 'סינון לשאלות עם גרף או תמונה בלבד — ליבת המבחן');
    ch.onclick = () => {
      imagesOnly = !imagesOnly;
      ch.classList.toggle('on', imagesOnly);
      drawTopics();     // ספירת הנושאים תשקף רק שאלות עם גרף
      update();
    };
    ic.append(ch);
    imgField.append(ic);
    imgField.append(el('p', 'hint', 'קריאת גרפי I/V, עקבות קיבוע-מתח ורישומי EPSP — 68 שאלות. משתלב עם שאר המסננים.'));
    advBody.append(imgField);
  }

  /* --- כמות --- */
  const countField = el('div', 'field');
  countField.append(el('label', null, 'כמה שאלות'));
  const cc = el('div', 'chips');
  [10, 20, 30, 50, 0].forEach((n) => {
    const ch = chipEl('chip' + (n === 20 ? ' on' : ''), n === 0 ? 'הכול' : String(n),
      n === 0 ? 'כל השאלות שעוברות את המסננים — בלי הגבלת כמות' : 'סבב של עד ' + n + ' שאלות');
    ch.onclick = () => {
      count = n;
      cc.querySelectorAll('.chip').forEach((x) => x.classList.remove('on'));
      ch.classList.add('on');
      update();
    };
    cc.append(ch);
  });
  setCount = (n) => {
    count = n;
    [...cc.querySelectorAll('.chip')].forEach((x) =>
      x.classList.toggle('on', x.textContent === (n === 0 ? 'הכול' : String(n))));
  };
  countField.append(cc);
  form.append(countField);

  const info = el('p');
  info.style.cssText = 'color:var(--dim); font-size:13.5px; margin-bottom:20px; line-height:1.6;';
  form.append(info);

  const go = el('button', 'btn primary', 'התחל תרגול');
  go.title = 'התחלת סבב לפי הנושאים, הכמות והמקור שבחרת';
  form.append(go);
  view.append(form);

  /* --- איפוס ההיסטוריה --- */
  const resetRow = el('p');
  resetRow.style.cssText = 'text-align:center; font-size:13px; color:var(--dim);';
  const resetLink = el('button', 'btn ghost', 'איפוס — התחל את המקצוע מחדש');
  resetLink.title = 'איפוס סימון „נצפתה” לכל שאלות המקצוע — הציונים במבחנים נשארים';
  resetLink.style.fontSize = '13px';
  resetLink.onclick = () => {
    if (!confirm(`לאפס את הסימון של כל השאלות שראית ב${scopeName}?\nהציונים במבחנים עצמם יישארו.`)) return;
    const map = seen.read();
    /* המחיקה חייבת לנסוע גם לענן. בלעדיה האיפוס ביטל את עצמו: המפתח נמחק
       מקומית בלבד, ובמיזוג הבא `l === undefined` והשורה שנשארה בענן חוזרת
       ומנצחת. מבחוץ זה נראה כמו "לחצתי איפוס והכול חזר". */
    /* משתי המפות. אם רק הישנה נמחקת, migrateSeenH לא רואה הבדל (היא כותבת
       רק לתא ריק) והחדשה נשארת מלאה; ואם רק החדשה — המיגרציה מייבאת אותה
       בחזרה מהישנה בטעינת המבחן הבאה. בשני המקרים האיפוס מבטל את עצמו. */
    const h = seenH.read();
    pool.forEach((q) => {
      const k = qKey(q);
      if (map[k] !== undefined) { delete map[k]; window.Cloud?.queueDelete('seen', k); }
      if (h[k] !== undefined) { delete h[k]; window.Cloud?.queueDelete('seenH', k); }
    });
    seen.write(map);
    seenH.write(h);
    drawProgress();
    update();
  };
  resetRow.append(resetLink);
  view.append(resetRow);

  function filtered() {
    const map = seenH.read();
    const nowTs = Date.now();
    return pool.filter((q) => {
      if (!inParts(q)) return false;
      if (!matchesQuery(q)) return false;
      if (imagesOnly && !q.image) return false;
      if (selTopics.size && !selTopics.has(q.topic)) return false;
      if ((q.repeat?.n || 1) < minRepeat) return false;
      const r = seenH.rec(qKey(q), map);
      if (mode === 'due') return r && r.b > 0 && seenH.due(qKey(q), nowTs, map);
      const s = r == null ? undefined : (r.b >= 1 ? 1 : 0);
      if (mode === 'wrong') return seenH.isOpenMistake(r);
      if (mode === 'new') return s === undefined;
      if (mode === 'hard') return cohortHard(q);
      return true;
    });
  }

  function update() {
    const f = filtered();
    const take = count === 0 ? f.length : Math.min(count, f.length);

    if (f.length) {
      const label = mode === 'new' ? 'שאלות שלא ראית'
        : mode === 'wrong' ? 'שאלות שטעית בהן ועוד לא נגמלת מהן'
        : mode === 'due' ? 'שאלות שהגיע הזמן לרענן'
        : mode === 'hard' ? 'שאלות שהמחזור נופל בהן'
        : 'שאלות';
      info.textContent = `בבריכה: ${f.length} ${label}. ייבחרו ${take} באקראי.`;
      /* פילטר נושא נדבק כשמגיעים מכרטיס מלכודת או מפילוח, והפאנל שמציג אותו
         מקופל — אז המשתמש רואה „רק מה שטעיתי” ולא מבין למה חסרות טעויות.
         מציגים את זה בגובה העיניים, עם דרך אחת לנקות. */
      if (selTopics.size) {
        const clear = el('button', 'linky', `מסונן ל-${selTopics.size} נושאים · הצג הכול`);
        clear.type = 'button';
        clear.title = 'ניקוי סינון הנושאים — חזרה לכל השאלות בבריכה';
        clear.onclick = () => { selTopics.clear(); drawTopics(); update(); };
        info.append(' ', clear);
      }
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
      courseId,
      title: `תרגול חופשי — ${scopeName}`,
      subtitle: `${picked.length} שאלות · ${bits.join(' · ')}`,
      questions: picked,
      persist: false,
      back: { text: 'תרגול חדש', href: '#/practice/' + courseId + (scope ? '/@' + encodeURIComponent(scope.key) : '') },
      /* אבן דרך "כיסית את כל המקצוע" — נמדדת מול כל בריכת השאלות, לא רק
         תת-הקבוצה שנבחרה לסבב הזה. */
      milestone: { courseId, courseName: scopeName, total: pool.length, qids: pool.map(qKey) },
      /* אותה בחירה בדיוק, הגרלה חדשה — הבורר עדיין חי בקלוז׳ר הזה, כולל
         `selTopics`, `mode`, `count` וכל השאר. */
      reroll: () => go.onclick(),
    });
  };

  toTop();
  updateFooter();
}


/* ================= סדר המסיחים =================

   שניים ביקשו את זה בסקר בנפרד: "בתרגול טעויות לשנות את סדר התשובות כדי
   שהזיכרון הצילומי לא ישחק תפקיד", ו"לערבב את הסדר של המסיחים בכל פעם".
   הם צודקים — בלי זה "הטעויות שלי" מלמד איפה לסמן, לא מה נכון.

   שתי משפחות של מסיחים לא סובלות ערבוב עיוור:

   • **מפנים למיקום** — "תשובות א+ד נכונות", "1+3", "כל המצבים בסעיפים 1-4".
     אלה נשברים לגמרי אם משהו זז. השאלה כולה נשארת בסדר המקורי.
   • **מסיחי סיכום** — "כל התשובות נכונות", "אין תשובה נכונה". המשמעות שלהם
     אינה תלויה בסדר, אבל מקומם המוסכם הוא בתחתית. מערבבים סביבם ומצמידים
     אותם למטה.

   ‼️ הערבוב הוא של **התצוגה בלבד**. מה שנשמר — התשובה שנבחרה, הפסילות,
   ופילוח המסיחים בלוח הבקרה — ממשיך לדבר במספור המקורי של הקובץ, אחרת
   1,059 רשומות ההתקדמות שכבר בענן היו הופכות לג'יבריש. */
const OPT_REFS = /(תשובות|סעיפים|תשובה)\s*[0-9א-ה]['’׳]?\s*([+]|ו-|,|[-–]\s*[0-9])|^\s*[0-9]\s*[+]\s*[0-9]|[א-ה]['’׳]\s*[+]\s*[א-ה]/;
const OPT_TAIL = /^\s*(כל|אף|אין)\s+(ה)?תשוב|^\s*כל\s+ה?נ["'״׳]?ל/;

function optOrder(item, keep) {
  const opts = item.opts || [];
  const idx = opts.map((_, i) => i);
  if (keep || opts.length < 3) return idx;
  if (opts.some((o) => OPT_REFS.test(String(o)))) return idx;
  const tail = idx.filter((i) => OPT_TAIL.test(String(opts[i])));
  if (tail.length === idx.length) return idx;
  const body = idx.filter((i) => !tail.includes(i));
  return [...shuffle(body.slice()), ...tail];
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* ================= סימולציית מבחן מלאה =================
   מדמה את המבחן האמיתי מקצה לקצה: N שאלות בפיזור הנושאים של המבחן, טיימר,
   ומשוב שנחשף רק בהגשה. ההגדרות (כמות, זמן, מכסות לפי בלוק) יושבות
   ב-courses.json תחת simExam — המנגנון גנרי לכל מקצוע שיגדיר אותן.

   הדגימה: קודם מכסת "שאלות הכיתה" (בפיזיקה המרצה אמר שייקח מהן — הן הכי
   קרובות למבחן), אחר כך מכסה לכל בלוק לפי מפת החומרים (topic→בלוק), ולבסוף
   השלמה אקראית אם מכסה כלשהי לא התמלאה. בתוך כל מאגר — שאלות שטרם נראו
   קודמות, כדי שכל סימולציה תרחיב את הכיסוי ולא תמחזר.

   הסבב שנדגם נשמר (רשימת qids + שעת התחלה), כך שרענון בטעות באמצע שלוש
   השעות לא מוחק כלום — חוזרים לאותן שאלות ולאותו שעון. */
async function renderSimExam(courseId, subKey = null) {
  setNav('home');
  const c = courseOf(courseId);
  /* #/simexam/<course>/@<מקצוע> — החלק של המקצוע במבחן הבלוק: המכסה שלו,
     וזמן יחסי. אותו מנגנון בדיוק, מאגר מצומצם לנושאים שלו. */
  const scope = subjectOf(courseId, subKey);
  const se = scope ? subjectSim(c, scope) : c?.simExam;
  const scopeName = scope ? scope.name : c?.name;
  const home = '#/course/' + courseId + (scope ? '/' + encodeURIComponent(scope.key) : '');
  const dur = (m) => (m >= 120 ? `${Math.round(m / 60)} שעות` : `${m} דקות`);
  if (!se) {
    view.innerHTML = '';
    view.append(emptyState('⚠️', 'אין סימולציה למקצוע הזה', 'הקישור כנראה שגוי.'));
    toTop();
    return;
  }
  view.dataset.course = courseId;
  view.innerHTML = '<div class="empty"><span class="ico">⏳</span><b>מרכיב את המבחן…</b></div>';

  const g = await loadGuide(courseId).catch(() => null);
  const metas = quizzesOf(courseId).filter((m) => m.kind !== 'highyield');
  const loaded = await Promise.all(metas.map((m) => loadExam(m.id)));
  const pool = [];
  metas.forEach((m, mi) => {
    loaded[mi].questions.forEach((q, i) => {
      if (q.offSyllabus) return;   // במבחן אמיתי אין שאלות מחוץ לחומר
      if (scope && !(scope.topics || []).includes(q.topic)) return;
      pool.push({ ...q, part: m.part || '', origin: loaded[mi].title, examId: m.id, idx: i });
    });
  });
  const byQid = new Map(pool.map((q) => [q.qid, q]));

  /* topic → שם בלוק, מתוך מפת החומרים. שאלות שהנושא שלהן לא במפה (שאלות
     הכיתה, הניסויים) נכנסות דרך מכסת classBanks או דרך ההשלמה. */
  const blockOf = {};
  (g?.blocks || []).forEach((b) => (b.topics || []).forEach((t) => { blockOf[t] = b.title; }));
  /* במבחן בלוק המקצועות עצמם מגדירים את הבלוקים — גם לפני שהמפה עלתה.
     בלי זה המכסות לא נאכפו, והסימולציה נבנתה מהשלמה אקראית בלבד. */
  subjectsOf(c).forEach((sj) => (sj.topics || []).forEach((t) => { blockOf[t] ??= sj.block; }));

  const KEY = 'simexam-' + courseId + (scope ? '-' + scope.key : '');
  const META_KEY = 'simexam-meta-' + courseId + (scope ? '-' + scope.key : '');
  const meta = (() => { try { return JSON.parse(localStorage.getItem(META_KEY)); } catch { return null; } })();
  const savedQs = (meta?.qids || []).map((id) => byQid.get(id)).filter(Boolean);
  const rec = store.exam(KEY);
  const unfinished = savedQs.length > 0 && !rec.done;

  function sample() {
    const map = seenH.read();
    const unseenFirst = (arr) => {
      const sh = shuffle([...arr]);
      return [...sh.filter((q) => !seenH.has(qKey(q), map)), ...sh.filter((q) => seenH.has(qKey(q), map))];
    };
    const picked = [], used = new Set();
    const take = (arr, n) => {
      for (const q of arr) {
        if (n <= 0 || picked.length >= se.questions) return;
        if (used.has(q.qid)) continue;
        picked.push(q); used.add(q.qid); n--;
      }
    };
    take(unseenFirst(pool.filter((q) => (se.classBanks || []).includes(q.examId))), se.classQuota || 0);
    for (const [block, quota] of Object.entries(se.blocks || {}))
      take(unseenFirst(pool.filter((q) => blockOf[q.topic] === block)), quota);
    take(unseenFirst(pool), se.questions - picked.length);   // השלמה אם מאגר כלשהו קצר
    return shuffle(picked);
  }

  function start(questions, startedAt) {
    playQuestions({
      key: KEY,
      courseId,
      title: `🎓 סימולציית מבחן — ${scopeName}`,
      subtitle: `${questions.length} שאלות · ${dur(se.minutes)} · התשובות נחשפות בהגשה`,
      note: 'כמו במבחן: אין משוב תוך כדי. עונים על הכול, והציון וההסברים מחכים בסוף. ' +
        'אפשר לצאת ולחזור — השאלות והשעון נשמרים.',
      persist: true,
      allowExam: true,
      startExam: true,
      timer: { minutes: se.minutes, startedAt },
      back: { text: scopeName, href: home },
      questions,
    });
  }

  /* --- מסך פתיחה --- */
  view.innerHTML = '';
  view.append(crumb(scopeName, home));
  const head = el('div', 'page-head');
  head.append(el('h1', null, `🎓 סימולציית מבחן — ${scopeName}`));
  head.append(el('p', null, scope
    ? `החלק של ${scope.name} במבחן ${c.name}: אותו מספר שאלות שהוא מקבל במבחן האמיתי, בזמן היחסי שלו — ובלי משוב עד ההגשה.`
    : 'הדבר הכי קרוב למבחן האמיתי: אותו מספר שאלות, אותו זמן, אותו פיזור נושאים — ובלי משוב עד ההגשה.'));
  view.append(head);

  const box = el('div', 'form');
  const dash = el('div', 'dash');
  dash.append(stat(se.questions, 'שאלות'));
  if (se.minutes >= 120) dash.append(stat(Math.round(se.minutes / 60), 'שעות'));
  else dash.append(stat(se.minutes, 'דקות'));
  if (!scope) dash.append(stat(Object.keys(se.blocks || {}).length, subjectsOf(c).length ? 'מקצועות בפיזור אמיתי' : 'בלוקים בפיזור אמיתי'));
  box.append(dash);
  const mix = scope
    ? `כל נושאי ${scope.name}, בלי שאלות מחוץ לחומר.`
    : se.classQuota
      ? `${se.classQuota} משאלות הכיתה (המרצה אמר שייקח מהן), והשאר לפי משקל הבלוקים במבחן.`
      : subjectsOf(c).length
        ? 'כל מקצוע מקבל את מספר השאלות שהוא מקבל במבחן האמיתי.'
        : 'לפי משקל הבלוקים במבחן.';
  box.append(el('p', 'bd-sub',
    `ההרכב: ${mix} שאלות שטרם ראית מקבלות עדיפות — כל סימולציה מרחיבה את הכיסוי.`));

  const row = el('div', 'btn-row');
  if (unfinished) {
    const cont = el('button', 'btn primary', '⏵ המשך את הסימולציה שהתחלת');
    cont.title = 'המשך בדיוק מאיפה שעצרת — השאלות והשעון נשמרו';
    cont.onclick = () => start(savedQs, meta.startedAt);
    row.append(cont);
    const fresh = el('button', 'btn ghost', '🎲 סימולציה חדשה (מוחק את הנוכחית)');
    fresh.title = 'הגרלת סט שאלות חדש — התשובות מהסימולציה הנוכחית יימחקו';
    fresh.onclick = () => {
      if (!confirm('להתחיל סימולציה חדשה? התשובות מהסימולציה הנוכחית יימחקו.')) return;
      store.reset(KEY);
      const qs = sample();
      localStorage.setItem(META_KEY, JSON.stringify({ qids: qs.map((q) => q.qid), startedAt: Date.now() }));
      start(qs, Date.now());
    };
    row.append(fresh);
  } else {
    const go = el('button', 'btn primary', '▶ התחל סימולציה');
    go.title = 'הגרלת שאלות והפעלת השעון — אפשר לצאת ולחזור בלי לאבד כלום';
    go.onclick = () => {
      store.reset(KEY);
      const qs = sample();
      const startedAt = Date.now();
      localStorage.setItem(META_KEY, JSON.stringify({ qids: qs.map((q) => q.qid), startedAt }));
      start(qs, startedAt);
    };
    row.append(go);
  }
  box.append(row);
  view.append(box);
  toTop();
  updateFooter();
}

/* ================= הטעויות שלי (בתוך מקצוע) ================= */
async function renderReview(courseId, subKey = null) {
  setNav('home');
  const c = courseOf(courseId);
  if (!c) {
    view.innerHTML = '';
    view.append(emptyState('⚠️', 'מקצוע לא נמצא', 'הקישור כנראה שגוי.'));
    toTop();
    return;
  }
  view.dataset.course = courseId;
  await loadGuide(courseId).catch(() => null);   // בשביל כפתור "איפה ללמוד" במשוב

  view.innerHTML = '<div class="empty"><span class="ico">⏳</span><b>אוסף את הטעויות…</b></div>';

  // נשען על מפת ההיסטוריה — לכן טעות שנעשתה בתרגול חופשי מגיעה לכאן גם היא.
  const metas = quizzesOf(courseId);
  const loaded = await Promise.all(metas.map((m) => loadExam(m.id)));   // במקביל, לא בטור
  /* אחרי הטעינה ולא לפניה: loadExam הוא מה שמריץ את migrateSeenH, ומפה
     שנקראה קודם לא הייתה מכילה את השאלות שזה עתה הוגרו. */
  const hmap = seenH.read();
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
  const scope = subjectOf(courseId, subKey);
  const scopeTopics = scope ? new Set(scope.topics || []) : null;
  const scopeName = scope ? scope.name : c.name;
  const home = '#/course/' + courseId + (scope ? '/' + encodeURIComponent(scope.key) : '');
  metas.forEach((m, mi) => {
    loaded[mi].questions.forEach((q, i) => {
      const item = { ...q, origin: loaded[mi].title, examId: m.id, idx: i };
      if (scopeTopics && !scopeTopics.has(q.topic)) return;   // היקף מקצוע
      const k = qKey(item);
      /* עד היום: `map[k] !== 0` — כלומר נכונה אחת הורידה שאלה מהרשימה לנצח,
         גם אם היא הייתה לפני שלושה שבועות. זה ה-leech שבורח. עכשיו הגמילה
         דורשת שתי נכונות ברצף (b>=2), ורשומה שאין בה טעות כלל לא נכנסת. */
      if (!seenH.isOpenMistake(seenH.rec(k, hmap)) || shown.has(k)) return;
      shown.add(k);
      wrong.push(item);
    });
  });

  view.innerHTML = '';

  if (!wrong.length) {
    view.append(crumb(scopeName, home));
    const head = el('div', 'page-head');
    head.append(el('h1', null, `הטעויות שלי — ${scopeName}`));
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
    courseId,
    title: `הטעויות שלי — ${scopeName}`,
    subtitle: `${wrong.length} שאלות שטעית בהן`,
    note: 'תענה נכון פעמיים ברצף — והשאלה תרד מהרשימה. תטעה — היא מתאפסת. ' +
          'פעם אחת לא מספיקה: זה בדיוק מה שגרם לשאלות לברוח מהרשימה בלי שידעת אותן.',
    questions: wrong,
    persist: false,
    back: { text: scopeName, href: home },
  });
}

/* ================= חיפוש גלובלי =================

   עד היום היה חיפוש רק בתוך בריכת התרגול של מקצוע אחד — כלומר כדי למצוא
   משהו היית צריך כבר לדעת באיזה מקצוע הוא. כאן מחפשים בכל הארכיון בבת אחת:
   שאלות, נקודות מהמפה, כרטיסיות ופריטי שינון.

   נבנה על דרישה (בפתיחה הראשונה) ולא באתחול: זה 1.6MB של JSON, ואין סיבה
   לשלם עליו במכשיר של מי שלא יחפש. */
let searchIdx = null;
let searchBuilding = null;

async function buildSearchIndex() {
  if (searchIdx) return searchIdx;
  if (searchBuilding) return searchBuilding;
  searchBuilding = (async () => {
    const rows = [];
    for (const c of COURSES) {
      const metas = EXAMS.filter((e) => e.course === c.id);
      const loaded = await Promise.all(metas.map((m) =>
        (m.kind === 'guide' ? loadGuide(c.id) : loadExam(m.id)).catch(() => null)));
      metas.forEach((m, mi) => {
        const d = loaded[mi];
        if (!d) return;
        if (m.kind === 'guide') {
          (d.units || []).forEach((u) => {
            /* פרק בלומדה — תוצאה שקופצת ישר לפרק הנכון דרך עוגן #top-.
               ה-hay כולל את התמצית והסיכום, כי המונח שמחפשים חי לרוב שם. */
            const sdu = studyDocFor(c.id, u.topic);
            if (sdu) rows.push({
              kind: 'doc', course: c, icon: '📖',
              title: u.topic, body: 'פרק בלומדה — ' + (u.what || '').slice(0, 70),
              href: sdu.href + '#top-' + encodeURIComponent(u.topic),
              newTab: true,
              hay: searchNorm([u.topic, u.what, u.summary].filter(Boolean).join(' ')),
            });
            (u.points || []).forEach((p) => rows.push({
              kind: 'point', course: c, icon: '🎯',
              title: u.topic, body: p.point,
              href: `#/guide/${c.id}/${encodeURIComponent(u.topic)}`,
              hay: searchNorm([u.topic, p.point, p.trap].filter(Boolean).join(' ')),
            }));
          });
          return;
        }
        if (m.kind === 'cards') {
          (d.cards || []).forEach((cd) => rows.push({
            kind: 'card', course: c, icon: '📇',
            title: cd.q, body: cd.short,
            href: '#/cards/' + m.id,
            hay: searchNorm([cd.q, cd.short, cd.deep, cd.topic].filter(Boolean).join(' ')),
          }));
          return;
        }
        if (m.kind === 'shinun') {
          (d.groups || []).forEach((gr) => (gr.items || []).forEach((it) => rows.push({
            kind: 'shinun', course: c, icon: '🧠',
            title: it.front, body: it.back,
            href: '#/shinun/' + c.id,
            hay: searchNorm([it.front, it.back, it.topic].filter(Boolean).join(' ')),
          })));
          return;
        }
        if (m.kind === 'case' || m.kind === 'keyer') return;
        /* שאלות. ה-HY מוחרג — הוא עותק, והיה מכפיל כל תוצאה. */
        if (m.kind === 'highyield') return;
        (d.questions || []).forEach((q, i) => rows.push({
          kind: 'q', course: c, icon: '❓',
          title: q.q, body: q.topic || d.title,
          href: q.qid ? '#/q/' + q.qid : `#/exam/${m.id}/${i}`,
          hay: searchNorm([q.q, ...(q.opts || []), q.topic, q.explain].filter(Boolean).join(' ')),
        }));
      });
    }
    searchIdx = rows;
    searchBuilding = null;
    return rows;
  })();
  return searchBuilding;
}

let searchOpen = false;
function openSearch() {
  if (searchOpen) return;
  searchOpen = true;

  const ov = el('div', 'srch');
  const box = el('div', 'srch-box');
  const inp = el('input', 'srch-inp');
  inp.type = 'search';
  inp.placeholder = 'חיפוש בכל הארכיון — שאלה, מושג, נושא…';
  inp.setAttribute('aria-label', 'חיפוש בכל הארכיון');
  box.append(inp);
  const res = el('div', 'srch-res');
  box.append(res);
  ov.append(box);
  document.body.append(ov);
  inp.focus();

  res.append(el('div', 'srch-hint', 'טוען את הארכיון…'));
  let ready = false;
  buildSearchIndex().then(() => { ready = true; run(); });

  function run() {
    const terms = searchNorm(inp.value).split(/\s+/).filter(Boolean);
    res.innerHTML = '';
    if (!ready) { res.append(el('div', 'srch-hint', 'טוען את הארכיון…')); return; }
    if (!terms.length) {
      res.append(el('div', 'srch-hint',
        `${searchIdx.length} פריטים בארכיון — שאלות, נקודות מהמפה, כרטיסיות ושינון. הקלד כדי לחפש.`));
      return;
    }
    const hits = searchIdx.filter((r) => terms.every((t) => r.hay.includes(t))).slice(0, 40);
    if (!hits.length) { res.append(el('div', 'srch-hint', 'לא נמצא כלום.')); return; }
    /* הדגשת מונחי החיפוש בתוצאה — העין מוצאת מיד למה השורה עלתה.
       ההדגשה על הטקסט הגולמי (התאמה משוערת, כי האינדקס מנורמל) — מונח
       שלא נמצא בטקסט המוצג פשוט לא יודגש, וזה בסדר. */
    const hiLite = (parent, text, cls) => {
      const s = el(cls === 'b' ? 'b' : 'span', null);
      const raw = String(text);
      /* הנרמול מוחק תווים (ניקוד, גרשיים) — אז אינדקס במחרוזת המנורמלת לא
         מצביע לאותו מקום בגולמית. בונים מפה תו-לתו מהמנורמל אל הגולמי. */
      let norm = ''; const map = [];
      for (let i = 0; i < raw.length; i++) {
        const ch = searchNorm(raw[i]);
        for (let k = 0; k < ch.length; k++) { norm += ch[k]; map.push(i); }
      }
      let pos = 0;
      while (pos < raw.length) {
        let best = null;
        terms.forEach((t) => {
          const j = norm.indexOf(t, map.findIndex((m) => m >= pos));
          if (j >= 0 && (best == null || j < best.j)) best = { j, len: t.length };
        });
        if (!best) { s.append(raw.slice(pos)); break; }
        const from = map[best.j];
        const to = map[best.j + best.len - 1] + 1;
        if (from < pos) break;   // ביטחון — לא אמור לקרות
        s.append(raw.slice(pos, from));
        s.append(el('mark', 'srch-hl', raw.slice(from, to)));
        pos = to;
      }
      parent.append(s);
    };
    hits.forEach((r) => {
      const a = el('a', 'srch-row');
      a.href = r.href;
      if (r.newTab) { a.target = '_blank'; a.rel = 'noopener'; }
      a.onclick = close;
      a.append(el('span', 'srch-ico', r.icon));
      const d = el('div', 'srch-txt');
      hiLite(d, String(r.title).slice(0, 110), 'b');
      hiLite(d, `${r.course.icon || ''} ${r.course.name}${r.body ? ' · ' + String(r.body).slice(0, 80) : ''}`, 'span');
      a.append(d);
      res.append(a);
    });
    if (searchIdx.filter((r) => terms.every((t) => r.hay.includes(t))).length > 40) {
      res.append(el('div', 'srch-hint', 'מוצגות 40 התוצאות הראשונות — צמצם את החיפוש.'));
    }
  }

  let t = null;
  inp.oninput = () => { clearTimeout(t); t = setTimeout(run, 120); };
  ov.onclick = (e) => { if (e.target === ov) close(); };
  function onKey(e) { if (e.key === 'Escape') close(); }
  document.addEventListener('keydown', onKey);

  function close() {
    searchOpen = false;
    document.removeEventListener('keydown', onKey);
    ov.remove();
  }
}

/* ================= שאלה בודדת =================
   #/q/<qid> — הקישור שאפשר לשלוח בוואטסאפ. הארכיון מתפשט ככה ממילא, ועד
   היום אפשר היה לקשר רק למבחן שלם ("תפתח את מועד א׳ ותגלול לשאלה 24").

   סורק את כל הקורסים עד שנמצא ה-qid, כי הקישור לא נושא מקצוע — ומי ששולח
   אותו לא אמור לדעת מה זה. הסריקה זולה: המניפסט כבר בזיכרון, והמבחנים
   נטענים במקביל ובמטמון. */
async function renderOneQuestion(qid) {
  setNav('home');
  view.innerHTML = '<div class="empty"><span class="ico">⏳</span><b>מחפש את השאלה…</b></div>';

  let found = null;
  for (const c of COURSES) {
    const metas = quizzesOf(c.id);
    const loaded = await Promise.all(metas.map((m) => loadExam(m.id).catch(() => null)));
    metas.forEach((m, mi) => {
      if (found || !loaded[mi]) return;
      const i = (loaded[mi].questions || []).findIndex((q) => q.qid === qid);
      if (i < 0) return;
      found = { course: c, meta: m, exam: loaded[mi], idx: i };
    });
    if (found) break;
  }

  if (!found) {
    view.innerHTML = '';
    view.append(emptyState('🔍', 'לא מצאתי את השאלה',
      'ייתכן שהיא הוסרה מהארכיון מאז ששותף הקישור, או שהקישור לא שלם.'));
    toTop(); updateFooter();
    return;
  }

  view.dataset.course = found.course.id;
  await loadGuide(found.course.id).catch(() => null);   // בשביל המלכודת וכפתור "איפה ללמוד"
  const q = found.exam.questions[found.idx];

  playQuestions({
    key: 'one',
    courseId: found.course.id,
    title: 'שאלה מהארכיון',
    subtitle: `${found.course.name} · ${found.exam.title} · שאלה ${found.idx + 1}`,
    note: 'שאלה בודדת ששותפה בקישור. התשובה נספרת בהתקדמות שלך כרגיל.',
    questions: [{ ...q, origin: found.exam.title, examId: found.meta.id, idx: found.idx }],
    persist: false,
    back: { text: found.course.name, href: '#/course/' + found.course.id },
  });
}

/* ================= הלילה לפני המבחן =================

   מסלול דחוס שנבנה משלושה דברים שכבר קיימים באתר, ושאף אחד מהם לא ניחוש:
   `freq` — כמה הנושא באמת שווה במבחן, נספר מהשחזורים עצמם;
   `strength` — כמה אתה יודע אותו *עכשיו*, כולל דעיכה עם הזמן;
   והמלכודות שנפלת בהן.

   זה לא "תרגול אקראי עם טיימר". זו הקצאת זמן: אם נשארו לך שעה וחצי, השאלה
   היחידה היא במה לגעת — וזו בדיוק השאלה שאי אפשר לענות עליה בלי שלושת
   הנתונים האלה יחד. */
async function renderTonight(courseId) {
  setNav('home');
  const c = courseOf(courseId);
  if (!c) {
    view.innerHTML = '';
    view.append(emptyState('⚠️', 'מקצוע לא נמצא', 'הקישור כנראה שגוי.'));
    toTop(); return;
  }
  view.dataset.course = courseId;
  view.innerHTML = '<div class="empty"><span class="ico">⏳</span><b>בונה לך מסלול…</b></div>';

  const g = await loadGuide(courseId).catch(() => null);
  const metas = quizzesOf(courseId);
  const loaded = await Promise.all(metas.map((m) => loadExam(m.id).catch(() => null)));

  /* בריכה אחת, בלי High Yield — הוא עותק והיה מכפיל שאלות במסלול. */
  const pool = [];
  const seenQ = new Set();
  metas.forEach((m, mi) => {
    if (!loaded[mi] || m.kind === 'highyield') return;
    (loaded[mi].questions || []).forEach((q, i) => {
      const item = { ...q, origin: loaded[mi].title, examId: m.id, idx: i };
      const k = qKey(item);
      if (seenQ.has(k)) return;
      seenQ.add(k);
      pool.push(item);
    });
  });

  view.innerHTML = '';
  view.append(crumb(c.name, '#/course/' + courseId));
  const head = el('div', 'page-head');
  head.append(el('h1', null, `🌙 הלילה לפני — ${c.name}`));
  head.append(el('p', null,
    'כמה זמן נשאר לך? האתר יבנה מסלול לפי מה שבאמת כבד במבחן, מה שאתה חלש בו, ומה שנפלת בו.'));
  view.append(head);

  if (!pool.length) {
    view.append(emptyState('📭', 'אין שאלות במקצוע הזה', 'המסלול נבנה מבריכת השאלות.'));
    toTop(); updateFooter(); return;
  }

  const hmap = seenH.read();
  const now = Date.now();

  /* משקל לכל נושא. עם מפה — freq אמיתי שנספר מהשחזורים. בלי מפה (קליני,
     ביוכימיה) נופלים לחלק היחסי של הנושא בבריכה, שזה הקירוב הכן ביותר
     שאפשר: כמה מהשאלות בארכיון עוסקות בו. */
  const topicW = {};
  if (g) {
    priorityList(courseId, g).forEach(({ u, m }) => {
      topicW[u.topic] = { w: Math.max(0.01, u.freq * (1 - m.strength)), strength: m.strength, freq: u.freq };
    });
  } else {
    const cnt = {};
    pool.forEach((q) => { if (q.topic) cnt[q.topic] = (cnt[q.topic] || 0) + 1; });
    const tot = Object.values(cnt).reduce((a, b) => a + b, 0) || 1;
    Object.entries(cnt).forEach(([t, n]) => {
      const m = masteryOf(courseId, t, hmap, now);
      topicW[t] = { w: Math.max(0.01, (100 * n / tot) * (1 - m.strength)), strength: m.strength, freq: 100 * n / tot };
    });
  }

  /* בתוך נושא: קודם מה שנפלת בו ועוד לא נגמלת, אז מה שבשל לרענון, אז מה
     שלא ראית, ורק בסוף מה שאתה כבר יודע. */
  const rank = (q) => {
    const r = seenH.rec(qKey(q), hmap);
    if (seenH.isOpenMistake(r)) return 0;
    if (r && r.b > 0 && seenH.due(qKey(q), now, hmap)) return 1;
    if (!r) return 2;
    return 3;
  };

  const controls = el('div', 'tonight-ctl');
  const info = el('p', 'tonight-info');
  let minutes = 60;
  const chips = el('div', 'chips');
  [[30, '30 דקות'], [60, 'שעה'], [90, 'שעה וחצי'], [150, 'שעתיים וחצי']].forEach(([mn, lbl]) => {
    const ch = chipEl('chip' + (mn === minutes ? ' on' : ''), lbl,
      'כמה זמן יש לך הערב — המסלול ייבנה בהתאם');
    ch.onclick = () => {
      minutes = mn;
      chips.querySelectorAll('.chip').forEach((x) => x.classList.remove('on'));
      ch.classList.add('on');
      draw();
    };
    chips.append(ch);
  });
  controls.append(chips);
  view.append(controls, info);

  const plan = el('div', 'tonight-plan');
  view.append(plan);

  const row = el('div', 'btn-row');
  const go = el('button', 'btn primary', '🌙 התחל את המסלול');
  go.title = 'בניית מסלול חזרה מותאם לזמן שבחרת — והתחלה';
  row.append(go);
  view.append(row);

  let picked = [];

  function build() {
    /* ~50 שניות לשאלה: קריאה, מענה, וקריאת ההסבר. לא מדעי — אבל הרבה יותר
       כן מ"שאלה בדקה", שמניח שלא קוראים את ההסבר, וזה בדיוק מה שלא רוצים
       בלילה לפני. */
    const budget = Math.max(8, Math.round(minutes * 60 / 50));
    const topics = Object.entries(topicW).sort((a, b) => b[1].w - a[1].w);
    const totW = topics.reduce((a, [, v]) => a + v.w, 0) || 1;

    const byTopic = {};
    pool.forEach((q) => { (byTopic[q.topic || '—'] ??= []).push(q); });
    Object.values(byTopic).forEach((arr) => arr.sort((a, b) => rank(a) - rank(b)));

    const out = [];
    const used = {};
    topics.forEach(([t, v]) => {
      const want = Math.round(budget * (v.w / totW));
      const arr = byTopic[t] || [];
      const take = arr.slice(0, Math.min(want, arr.length));
      used[t] = take.length;
      out.push(...take);
    });
    /* עיגול כלפי מטה משאיר מקום — ממלאים בנושאים הכבדים לפי אותו סדר. */
    if (out.length < budget) {
      for (const [t] of topics) {
        const arr = byTopic[t] || [];
        while (out.length < budget && used[t] < arr.length) out.push(arr[used[t]++]);
        if (out.length >= budget) break;
      }
    }
    return { list: out.slice(0, budget), used, topics };
  }

  function draw() {
    const { list, used, topics } = build();
    picked = list;
    info.textContent =
      `${plural(list.length, 'שאלה', 'שאלות', true)} · ` +
      `${plural(topics.filter(([t]) => used[t]).length, 'נושא', 'נושאים')} · ` +
      'מסודר מהכבד לקל.';
    plan.innerHTML = '';
    topics.filter(([t]) => used[t]).slice(0, 10).forEach(([t, v]) => {
      const r = el('div', 'tonight-row');
      r.append(el('span', 'tonight-n', String(used[t])));
      const d = el('div', 'tonight-txt');
      d.append(el('b', null, t));
      d.append(el('span', null,
        `${v.freq.toFixed(1)}% מהמבחן · אתה ב-${Math.round(v.strength * 100)}%`));
      r.append(d);
      const bar = el('div', 'tonight-bar');
      const fill = el('i');
      fill.style.width = Math.round(v.strength * 100) + '%';
      bar.append(fill);
      r.append(bar);
      plan.append(r);
    });
  }
  draw();

  go.onclick = () => {
    if (!picked.length) return;
    playQuestions({
      key: 'tonight',
      courseId,
      title: `🌙 הלילה לפני — ${c.name}`,
      subtitle: `${picked.length} שאלות · ${minutes} דקות`,
      note: 'המסלול מסודר מהנושא הכבד ביותר שאתה הכי חלש בו, ובתוכו — קודם מה שנפלת בו.',
      questions: picked,
      persist: false,
      back: { text: 'בניית מסלול', href: '#/tonight/' + courseId },
    });
  };

  toTop();
  updateFooter();
}

/* ================= מה שסימנתי ================= */
async function renderFlagged(courseId) {
  setNav('home');
  const c = courseOf(courseId);
  if (!c) {
    view.innerHTML = '';
    view.append(emptyState('⚠️', 'מקצוע לא נמצא', 'הקישור כנראה שגוי.'));
    toTop(); return;
  }
  view.dataset.course = courseId;
  view.innerHTML = '<div class="empty"><span class="ico">⏳</span><b>אוסף את המסומנות…</b></div>';
  await loadGuide(courseId).catch(() => null);

  const metas = quizzesOf(courseId);
  const loaded = await Promise.all(metas.map((m) => loadExam(m.id).catch(() => null)));
  const f = flags.read();
  const picked = [];
  const shown = new Set();
  metas.forEach((m, mi) => {
    if (!loaded[mi]) return;
    (loaded[mi].questions || []).forEach((q, i) => {
      if (!q.qid || !f[q.qid] || shown.has(q.qid)) return;
      shown.add(q.qid);
      picked.push({ ...q, origin: loaded[mi].title, examId: m.id, idx: i });
    });
  });

  view.innerHTML = '';
  if (!picked.length) {
    view.append(crumb(c.name, '#/course/' + courseId));
    const head = el('div', 'page-head');
    head.append(el('h1', null, `מה שסימנתי — ${c.name}`));
    view.append(head);
    view.append(emptyState('🏷️', 'עוד לא סימנת שאלות',
      'בכל שאלה יש כפתור 🏷️ בפינה. סימון שם אותה כאן, כדי שתוכל לחזור אליה בלי לחפש.'));
    toTop(); updateFooter();
    return;
  }

  playQuestions({
    key: 'flagged',
    courseId,
    title: `מה שסימנתי — ${c.name}`,
    subtitle: `${plural(picked.length, 'שאלה מסומנת', 'שאלות מסומנות', true)}`,
    note: 'להסרת סימון — לחץ על 🔖 בפינת השאלה.',
    questions: picked,
    persist: false,
    back: { text: c.name, href: '#/course/' + courseId },
  });
}

/* ================= המלכודות שלי =================

   הצד השני של "הטעויות שלי". שם רואים *אילו שאלות* טעית; כאן רואים **למה** —
   מקובץ לפי התפיסה השגויה עצמה, כי חמש טעויות שנובעות מאותו בלבול אינן חמש
   בעיות אלא אחת. כל התוכן כאן כבר קיים בשדה `trap` שבמפת החומרים; הדף הזה
   רק מצליב אותו עם מה שבאמת נפלת בו. */
async function renderTraps(courseId) {
  setNav('home');
  const c = courseOf(courseId);
  if (!c) {
    view.innerHTML = '';
    view.append(emptyState('⚠️', 'מקצוע לא נמצא', 'הקישור כנראה שגוי.'));
    toTop();
    return;
  }
  view.dataset.course = courseId;
  view.innerHTML = '<div class="empty"><span class="ico">⏳</span><b>מחפש את המלכודות…</b></div>';

  const g = await loadGuide(courseId).catch(() => null);
  const metas = quizzesOf(courseId);
  await Promise.all(metas.map((m) => loadExam(m.id).catch(() => null)));
  const hmap = seenH.read();

  view.innerHTML = '';
  view.append(crumb(c.name, '#/course/' + courseId));
  const head = el('div', 'page-head');
  head.append(el('h1', null, `המלכודות שלי — ${c.name}`));
  /* בלי הדגשות בכוכביות: המנוע מכניס טקסט דרך textContent ולא מרנדר Markdown,
     אז ‎**‎ היה מוצג כתווים. */
  head.append(el('p', null,
    'לא "אילו שאלות טעית" אלא למה. חמש טעויות שנובעות מאותו בלבול הן בעיה אחת, ' +
    'וכאן הן מקובצות יחד.'));
  view.append(head);

  if (!g) {
    view.append(emptyState('🗺️', 'אין עדיין מפת חומרים למקצוע הזה',
      'המלכודות נשענות על "מה באמת נשאל" שבמפה. במקצועות שיש בהם מפה — אלקטרו, ביומול ופיזיקה — הדף הזה מלא.'));
    toTop(); updateFooter();
    return;
  }

  /* אוספים כל נקודה שיש לה trap, וסופרים בכמה מה-qids שלה יש טעות פתוחה. */
  const rows = [];
  (g.units || []).forEach((u) => {
    (u.points || []).forEach((p) => {
      if (!p.trap) return;
      const qids = p.qids || [];
      const fell = qids.filter((q) => seenH.isOpenMistake(seenH.rec(q, hmap)));
      const seenCnt = qids.filter((q) => seenH.has(q, hmap)).length;
      if (!fell.length) return;
      rows.push({ u, p, qids, fell, seenCnt });
    });
  });
  rows.sort((a, b) => b.fell.length - a.fell.length || b.u.freq - a.u.freq);

  if (!rows.length) {
    view.append(emptyState('🎯', 'אין מלכודות פתוחות',
      'או שעוד לא ענית מספיק במקצוע הזה, או שלא נפלת באף מלכודת שמופתה. ' +
      'כל טעות בשאלה שממופה לנקודה תופיע כאן.'));
    toTop(); updateFooter();
    return;
  }

  const sum = el('p', 'traps-sum');
  sum.textContent = `${plural(rows.length, 'מלכודת פתוחה', 'מלכודות פתוחות', true)} · ` +
    `${rows.reduce((n, r) => n + r.fell.length, 0)} שאלות. מדורג לפי כמה נפלת, ואז לפי משקל הנושא במבחן.`;
  view.append(sum);

  rows.forEach((r) => {
    const card = el('div', 'trapcard');
    const top = el('div', 'trapcard-top');
    top.append(el('span', 'trapcard-topic', r.u.topic));
    top.append(el('span', 'trapcard-n', `✗ ${r.fell.length} מתוך ${r.qids.length}`));
    card.append(top);
    card.append(el('div', 'trap-text', r.p.trap));
    /* הנקודה עצמה — מה שנכון — מתחת למלכודת ולא מעליה, כדי שהקריאה תהיה
       "זו הטעות" ואז "וזה הנכון", ולא להפך. */
    card.append(el('div', 'trapcard-point', r.p.point));
    const acts = el('div', 'trapcard-acts');
    const gA = el('a', 'btn ghost', '📚 איפה ללמוד');
    gA.title = 'פתיחת הנושא במפת החומרים — סרטונים, סיכום ומקורות';
    gA.href = `#/guide/${courseId}/${encodeURIComponent(r.u.topic)}`;
    acts.append(gA);
    const pA = el('a', 'btn ghost', '🏋️ תרגל את הנושא');
    pA.title = 'תרגול שאלות אמת בנושא הזה בלבד';
    pA.href = `#/practice/${courseId}/${encodeURIComponent(r.u.topic)}`;
    acts.append(pA);
    card.append(acts);
    view.append(card);
  });

  toTop();
  updateFooter();
}

/* ================= עץ הידע =================
   מפת-מצב מיידית: כל נושא נצבע לפי strength — כמה אתה יודע *עכשיו*, עם
   דעיכה בזמן. בנוי קודם כול ללחץ של לפני-מבחן (רוב השימוש באתר): שורת
   "במה לגעת עכשיו" בראש, והעץ עצמו קריא גם בכניסה ראשונה אחרי סבב תרגול
   אחד. רצף והתמדה — שורה קטנה בתחתית, בכוונה לא במרכז הבמה. */
async function renderTree(courseId) {
  setNav('home');
  view.innerHTML = '<div class="empty"><span class="ico">⏳</span><b>טוען…</b></div>';
  const c = courseOf(courseId);
  const g = c && await loadGuide(courseId);
  if (!g) {
    view.innerHTML = '';
    view.append(emptyState('📭', 'אין עדיין מפת חומרים', 'עץ הידע נבנה ממנה.'));
    toTop();
    return;
  }
  await Promise.all(quizzesOf(courseId).map((m) => loadExam(m.id).catch(() => null)));

  view.innerHTML = '';
  view.dataset.course = courseId;
  view.append(crumb(c.name, '#/course/' + courseId));
  const head = el('div', 'page-head');
  head.append(el('h1', null, '🌳 עץ הידע — ' + c.name));
  head.append(el('p', null,
    'כל נושא נצבע לפי כמה אתה שולט בו עכשיו — הציון דועך עם הזמן, כמו הזיכרון. לחיצה מובילה לתרגול.'));
  view.append(head);

  const ranked = priorityList(courseId, g);
  const touched = ranked.filter((r) => r.m.total && r.m.strength > 0).length;

  /* במה לגעת עכשיו — שלושת הנושאים עם הציון הגבוה (חלש × כבד במבחן). */
  const nowRow = el('section', 'tree-now');
  nowRow.append(el('h2', 'g-h2', '🎯 במה לגעת עכשיו'));
  const nowSub = el('p', 'tree-now-sub');
  nowSub.textContent = touched
    ? 'השילוב של "כמה זה נשאל" עם "כמה אתה שולט" — הכי כבד למעלה.'
    : 'עדיין לא תרגלת כאן — הסדר הוא לפי המשקל במבחן. אחרי סבב אחד העץ ייצבע.';
  nowRow.append(nowSub);
  const chips = el('div', 'tree-now-chips');
  ranked.slice(0, 3).forEach((r) => {
    const a = el('a', 'tree-chip');
    a.href = `#/practice/${courseId}/${encodeURIComponent(r.u.topic)}`;
    a.innerHTML = `<b>${r.u.topic}</b><span>${r.u.freq}% מהשאלות · שליטה ${Math.round(r.m.strength * 100)}%</span>`;
    a.title = 'תרגול הנושא הזה עכשיו';
    chips.append(a);
  });
  nowRow.append(chips);
  view.append(nowRow);

  /* העץ — לפי הבלוקים של המפה; מפה שטוחה מקבלת קבוצה אחת. */
  const lvl = (s) => (s >= 0.67 ? 'high' : s >= 0.34 ? 'mid' : s > 0 ? 'low' : 'none');
  const byTopic = {};
  ranked.forEach((r) => { byTopic[r.u.topic] = r; });
  const groups = (g.blocks && g.blocks.length)
    ? g.blocks.map((b) => ({ title: `${b.icon || ''} ${b.title}`, topics: b.topics || [] }))
    : [{ title: '📖 כל הנושאים', topics: ranked.map((r) => r.u.topic) }];
  groups.forEach((grp) => {
    const sec = el('section', 'tree-block');
    sec.append(el('h3', null, grp.title));
    const wrap = el('div', 'tree-nodes');
    grp.topics.forEach((t) => {
      const r = byTopic[t];
      if (!r) return;
      const pct = Math.round(r.m.strength * 100);
      /* תא עוטף: הקישור ללומדה יושב כאח של קישור התרגול ולא בתוכו —
         קישור בתוך קישור אסור, והדפדפן מפרק אותו בשקט. */
      const cell = el('div', 'tree-cell');
      const node = el('a', 'tree-node lv-' + lvl(r.m.strength));
      node.href = `#/practice/${courseId}/${encodeURIComponent(t)}`;
      /* נושא שלא נגעת בו מציג "—" ולא "0%": קיר של אפסים זהים לא אומר כלום,
         ומקו-מקף שקט ההיררכיה עוברת ל"כמה מהמבחן" — שזה מה שמכריע בהתחלה. */
      const virgin = !r.m.total || r.m.strength <= 0;
      node.title = !virgin
        ? `${t} — שליטה ${pct}% · ${r.m.correct}/${r.m.total} נכונות בארכיון · לחיצה לתרגול`
        : `${t} — טרם תורגל · לחיצה לתרגול`;
      node.innerHTML = `<span class="tree-pct">${virgin ? '—' : pct + '%'}</span>` +
        `<span class="tree-topic">${t}</span>` +
        `<span class="tree-meta">${r.u.freq}% מהמבחן</span>`;
      cell.append(node);
      const sd = studyDocFor(c.id, t);
      if (sd) {
        /* קישור משני, קטן, ללומדה — התרגול הוא הראשי. */
        const doc = el('a', 'tree-doc', '📖');
        doc.href = sd.href + '#top-' + encodeURIComponent(t);
        doc.target = '_blank';
        doc.rel = 'noopener';
        doc.title = 'הפרק של ' + t + ' בלומדה';
        cell.append(doc);
      }
      wrap.append(cell);
    });
    sec.append(wrap);
    view.append(sec);
  });

  /* שורת ההתמדה — בתחתית ובקטן, בכוונה. רצף = ימים עם תרגול, נגזר
     מחותמות "המגע האחרון" שב-seenH; זה קירוב שמחמיר לרעתנו (יום ישן
     שנדרס לא נספר), ולכן לא מציגים מספרים גרנדיוזיים — רק את הרצף החי. */
  const d = seenH.read();
  const days = new Set();
  Object.values(d).forEach((r) => { if (r && r.t) days.add(new Date(r.t).toDateString()); });
  /* רצף שמסתיים היום או אתמול — היום שעוד לא תרגלת בו לא שובר אותו. */
  let streak = 0;
  const start = days.has(new Date().toDateString()) ? 0 : 1;
  while (days.has(new Date(Date.now() - (start + streak) * MS.day).toDateString())) streak++;
  const foot = el('div', 'tree-foot');
  const bits = [];
  if (streak >= 2) bits.push(`🔥 ${streak} ימים ברצף`);
  bits.push(`${touched}/${ranked.length} נושאים תורגלו`);
  if (touched === ranked.length && ranked.length) bits.push('🏅 נגעת בהכול');
  foot.textContent = bits.join(' · ');
  view.append(foot);

  toTop();
  updateFooter();
}

/* ================= ליווי סמסטר =================
   "השבוע בקורס" — עמוד פסיבי לגמרי (בלי התראות ובלי דיוור): מיישר את
   החומר לשבועות ההוראה לפי `teaching` בכרטיס המקצוע. הביקוש הכי חזק בסקר.

   ולפי ההנחיה שרוב השימוש הוא לפני מבחנים: כשהמבחן קרוב (או כשהשבועות
   נגמרו) המסך מתהפך מ"איפה אנחנו השבוע" ל"מה נשאר לסגור" — כל הנושאים
   שטרם נשלטו, מדורגים לפי המפה. מי שמגיע רק בסוף מקבל בדיוק את מה
   שהוא צריך, בלי להרגיש שאיחר את הרכבת. */
async function renderSemester(courseId) {
  setNav('home');
  view.innerHTML = '<div class="empty"><span class="ico">⏳</span><b>טוען…</b></div>';
  const c = courseOf(courseId);
  const t = c && c.teaching;
  if (!t || !t.start || !(t.weeks || []).length) {
    view.innerHTML = '';
    view.append(emptyState('🗓️', 'אין תוכנית סמסטר למקצוע הזה',
      'ליווי שבועי נבנה רק לקורסים שנפתחים איתנו מתחילת הסמסטר — בקורס הזה פשוט מתרגלים רגיל.'));
    toTop();
    return;
  }
  const g = await loadGuide(courseId);
  await Promise.all(quizzesOf(courseId).map((m) => loadExam(m.id).catch(() => null)));

  view.innerHTML = '';
  view.dataset.course = courseId;
  view.append(crumb(c.name, '#/course/' + courseId));

  const startTs = new Date(t.start + 'T00:00').getTime();
  /* ימים שלמים (עיגול) ואז שבועות — שעת שעון החורף לא מזיזה את יום ראשון לשבוע הקודם. */
  const weekIdx = Math.floor(Math.floor((Date.now() - startTs + MS.hour) / MS.day) / 7);
  const nd = nextDate(c);
  const examSoon = nd && nd.ts - Date.now() < 14 * MS.day;
  const over = weekIdx >= t.weeks.length;

  const d = seenH.read(), nowTs = Date.now();
  const mastery = (topic) => masteryOf(courseId, topic, d, nowTs);
  const byTopic = {};
  (g && g.units || []).forEach((u) => { byTopic[u.topic] = u; });

  /* שורת פעולות לנושא — אותו עוגן קנוני בכל היעדים. */
  /* מבחן בלוק: נושא שמיקומו בלוח משוער (אין לו תאריך באף סיכום) מסומן. */
  const estSet = new Set(t.weeks.flatMap((w) => w.est || []));
  const topicRow = (topic, extra) => {
    const row = el('div', 'sem-topic');
    if (!extra && estSet.has(topic)) extra = 'משוער';
    const m = mastery(topic);
    const pct = m.total ? Math.round(m.strength * 100) + '%' : '—';
    row.innerHTML = `<b>${topic}</b><span class="sem-pct">${pct}</span>`;
    if (extra) row.append(el('span', 'sem-note', extra));
    const acts = el('span', 'sem-acts');
    const sdt = studyDocFor(courseId, topic);
    if (sdt) {
      const a = el('a', null, '📖');
      a.href = sdt.href + '#top-' + encodeURIComponent(topic);
      a.target = '_blank'; a.rel = 'noopener';
      a.title = 'הפרק בלומדה';
      acts.append(a);
    }
    if (byTopic[topic]) {
      const a = el('a', null, '🗺️');
      a.href = `#/guide/${courseId}/${encodeURIComponent(topic)}`;
      a.title = 'הנושא במפת החומרים';
      acts.append(a);
    }
    const p = el('a', null, '✍️');
    p.href = `#/practice/${courseId}/${encodeURIComponent(topic)}`;
    p.title = 'תרגול הנושא';
    acts.append(p);
    row.append(acts);
    return row;
  };

  const head = el('div', 'page-head');
  if (examSoon || over) {
    /* מצב לפני-מבחן: המסלול השבועי כבר לא מעניין — רק מה נשאר. */
    head.append(el('h1', null, '🗓️ ' + c.name + ' — מה נשאר לסגור'));
    head.append(el('p', null, over
      ? 'ההוראה נגמרה. אלה כל הנושאים שעוד לא סגרת, לפי הסדר שכדאי לסגור אותם.'
      : 'המבחן קרוב, אז במקום "איפה אנחנו השבוע" — כל מה שעוד פתוח, החשוב קודם.'));
    view.append(head);
    const list = el('section', 'sem-week is-now');
    const openTopics = [...new Set(t.weeks.flatMap((w) => w.topics || []))]
      .map((topic) => ({ topic, m: mastery(topic), u: byTopic[topic] }))
      .filter((x) => x.m.strength < 0.5)
      .sort((a, b) => ((b.u?.freq || 0) * (1 - b.m.strength)) - ((a.u?.freq || 0) * (1 - a.m.strength)));
    if (!openTopics.length) {
      view.append(emptyState('🏅', 'הכול סגור', 'כל נושאי הסמסטר בשליטה. סבב רענון ב"בשל לחזרה"?'));
    } else {
      openTopics.forEach((x) => list.append(topicRow(x.topic,
        x.u ? `${x.u.freq}% מהמבחן` : null)));
      view.append(list);
    }
  } else {
    const subs = subjectsOf(c);
    head.append(el('h1', null, '🗓️ ' + c.name + (subs.length ? ' — השבוע בבלוק' : ' — השבוע בקורס')));
    head.append(el('p', null, weekIdx < 0
      ? `ההוראה מתחילה ב-${fmtDate(startTs)}. ${t.weeks.length} שבועות, והאחוז ליד כל נושא — כמה אתה שולט בו.`
      : `שבוע ${weekIdx + 1} מתוך ${t.weeks.length}. הצבע ליד כל נושא — כמה אתה שולט בו עכשיו.`));
    view.append(head);
    if (t.basis) view.append(el('p', 'sem-basis', t.basis));

    /* מבחן בלוק שנלמד במקביל לבלוק אחר (עקרונות א׳ ו-ב׳): באותו שבוע
       מציגים גם מה נלמד שם, עם קישור — הסטודנט לומד את שניהם יחד. */
    const sib = COURSES.find((x) => x.id !== courseId && subjectsOf(x).length &&
      x.teaching && x.teaching.start === t.start);
    const dm = (ts) => new Date(ts).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' });

    t.weeks.forEach((w, i) => {
      const state = i < weekIdx ? 'past' : i === weekIdx ? 'now' : 'future';
      const sec = el(state === 'now' ? 'section' : 'details', 'sem-week is-' + state);
      /* לפי ימים בלוח השנה ולא לפי מילישניות: שעון החורף (25/10) מזיז
         חיבור של 7×24 שעות בשעה, והשבוע השני הוצג כ-25.10–30.10. */
      const day = (n) => { const x = new Date(startTs); x.setDate(x.getDate() + n); return x.getTime(); };
      const title = `שבוע ${i + 1}` + ` (${dm(day(i * 7))}–${dm(day(i * 7 + 6))})` +
        (state === 'now' ? ' — אתם כאן' : '') + (w.note ? ` · ${w.note}` : '');
      if (state === 'now') sec.append(el('h2', 'g-h2', '📍 ' + title));
      else {
        const s = el('summary', null, (state === 'past' ? '✓ ' : '') + title);
        sec.append(s);
        if (state === 'past') sec.open = false;
        if (weekIdx < 0 && i === 0) sec.open = true;   // לפני הפתיחה — השבוע הראשון פתוח
      }
      if (subs.length) {
        /* קיבוץ לפי מקצוע — שמונה מקצועות במקביל נקראים רק כך. */
        subs.forEach((sj) => {
          const tops = (w.topics || []).filter((x) => (sj.topics || []).includes(x));
          if (!tops.length) return;
          const h = el('a', 'sem-subj', `${sj.icon || ''} ${sj.name}`.trim());
          h.href = '#/course/' + courseId + '/' + encodeURIComponent(sj.key);
          h.title = `עמוד המקצוע — ${sj.name}`;
          sec.append(h);
          tops.forEach((topic) => sec.append(topicRow(topic)));
        });
      } else {
        (w.topics || []).forEach((topic) => sec.append(topicRow(topic)));
      }
      const sw = sib && sib.teaching.weeks[i];
      if (sw && (sw.topics || []).length) {
        const par = el('a', 'sem-sib');
        par.href = '#/semester/' + sib.id;
        par.title = `השבוע הזה ב${sib.name}`;
        const names = subjectsOf(sib).filter((sj) => sw.topics.some((x) => (sj.topics || []).includes(x)))
          .map((sj) => `${sj.icon || ''} ${sj.short || sj.name}`.trim());
        par.textContent = `במקביל ב${sib.name}: ${names.join(' · ')} ←`;
        sec.append(par);
      }
      view.append(sec);
    });
  }

  toTop();
  updateFooter();
}

/* ================= דף הסבר ================= */
function renderAbout() {
  setNav('about');
  view.innerHTML = '';
  localStorage.setItem(SEEN_KEY, '1');

  const head = el('div', 'page-head');
  head.append(el('h1', null, 'איך זה עובד'));
  head.append(el('p', null, 'דקה של קריאה — ואתם יודעים להשתמש בכל מה שיש כאן.'));
  view.append(head);

  /* הסיור נשאר נגיש גם אחרי שרצה. מי שדילג בפעם הראשונה — וזה רוב האנשים —
     צריך מקום אחד וידוע לחזור אליו, אחרת הוא אבד לתמיד. */
  const tourCta = el('div', 'about-tour');
  const tt = el('div');
  tt.append(el('b', null, '🧭 מעדיפים שיראו לכם?'));
  tt.append(el('span', null, 'סיור של דקה שמצביע על כל דבר במקום שבו הוא נמצא.'));
  tourCta.append(tt);
  const tb = el('button', 'btn primary', 'התחל סיור');
  tb.title = 'סיור מודרך קצר שמצביע על כל דבר במקום שבו הוא נמצא';
  tb.onclick = () => startTour();
  tourCta.append(tb);
  view.append(tourCta);

  /* המסלול — שלושת הצעדים שכל השאר נשען עליהם. */
  const path = el('div', 'about-path');
  [['1', '📚 בוחרים מקצוע', 'כל מקצוע בצבע שלו, וכל מה שיש לו — בפנים'],
   ['2', '🏋️ מתרגלים', 'שחזורים אמיתיים ותרגול לפי נושא, עם הסבר מיד אחרי כל שאלה'],
   ['3', '🎯 סוגרים חורים', 'הטעויות נאספות לבד, והאתר אומר בדיוק במה לגעת']]
    .forEach(([n, t, sub]) => {
      const st = el('div', 'about-step');
      st.append(el('span', 'about-step-n', n));
      const tx = el('div');
      tx.append(el('b', null, t));
      tx.append(el('span', null, sub));
      st.append(tx);
      path.append(st);
    });
  view.append(path);

  /* הפיצ׳רים — מקובצים לפי הפעלים של האתר, באותו סדר כמו בעמוד קורס.
     כל קבוצה: כותרת-אזור + כרטיסים. תוכן-עניינים צ׳יפים למעלה. */
  const GROUPS = [
    { id: 'ab-test', title: '📝 נבחנים', cards: [
      { icon: '📝', title: 'שחזורים — הדבר המרכזי',
        body: 'המבחנים האמיתיים של השנים האחרונות, משוחזרים ומסודרים. עונים — והתשובה ' +
              'הנכונה עם ההסבר מופיעים מיד, כי הלמידה קורית ברגע שאחרי השאלה. ' +
              '(אפשר גם להקיש 1, 2, 3 במקלדת.) שנים ישנות מחכות מקופלות בתחתית.' },
      { icon: '🔀', title: 'מצב לימוד ומצב מבחן',
        body: 'מתג בתוך כל שחזור: "מצב לימוד" נותן משוב מיד אחרי כל שאלה; "מצב מבחן" ' +
              'מסתיר הכול עד הסוף — לדמות מבחן אמיתי, ואז לחשוף בבת אחת.' },
      { icon: '📊', title: 'פילוח לפי נושא',
        body: 'בסוף מבחן מתויג מופיעה טבלה מהחלש לחזק — במקום "קיבלת 62%", רואים בדיוק ' +
              'במה לפתוח כשחוזרים.' },
    ]},
    { id: 'ab-practice', title: '🏋️ מתרגלים', cards: [
      { icon: '🏋️', title: 'תרגול לפי נושא וכמות',
        body: 'בוחרים כמה שאלות ומה להציג (חדשות / מה שטעיתם / הכול), ו"סינון מתקדם" ' +
              'נפתח לנושאים וגרפים. השאלות מעורבבות מכל המבחנים — שהמוח יזכור את החומר, ' +
              'לא את "התשובה השלישית".' },
      { icon: '🎯', title: 'הטעויות שלי',
        body: 'כל שאלה שטעיתם בה נאספת לכאן לבד. הדף הכי שווה לפני מבחן: רשימת החורים ' +
              'המדויקת שלכם, בלי לבזבז זמן על מה שכבר יושב.' },
      { icon: '🌳', title: 'עץ הידע והמלכודות',
        body: 'העץ צובע כל נושא לפי כמה אתם שולטים בו עכשיו (הציון דועך עם הזמן, כמו ' +
              'הזיכרון) ואומר במה לגעת. המלכודות אוספות את הפחים שנפלתם בהם — מה הטעות, ' +
              'מה הנכון, ואיפה ללמוד.' },
      { icon: '🔬', title: 'סימולציות וכלים אינטראקטיביים',
        body: 'מעבדות חיות (פוטנציאל פעולה, מעגלים), תרגילי חישוב עם פתרון שלב-אחר-שלב, ' +
              'ודפי נוסחאות — בתחתית עמוד הקורס, בצבע המקצוע.' },
    ]},
    { id: 'ab-learn', title: '📖 לומדים', cards: [
      { icon: '📖', title: 'הלומדה — הסיכום המלא, בשלושה מצבים',
        body: 'סיכום מלא עם איורים, סרטונים, הקראה ותרגילים. 📖 קריאה מלאה — מעבר ראשון ' +
              'על החומר; ⚡ מרוכז — רק התמצית, המלכודות ו"מה באמת נשאל", לחזרה לפני מבחן; ' +
              '🎮 אינטראקטיבי — תרגילים ושערי "נסה קודם". אפשר לסמן במרקר (נשמר), ומכל ' +
              'נושא קופצים ישר לתרגול שלו.' },
      { icon: '🗺️', title: 'מפת החומרים',
        body: 'לכל נושא: מאיפה ללמוד, מה באמת נשאל עליו בשחזורים (עם קישור לכל שאלה), ' +
              'ומה לא ללמוד. מתג סידור: לפי סדר הלימוד או לפי נפח במבחן.' },
      { icon: '🗓️', title: 'ליווי הסמסטר',
        body: 'בקורסים שנפתחים איתנו מתחילת הסמסטר — "השבוע בקורס": איפה ההוראה עומדת, ' +
              'מה כבר אמור לשבת, ומה נשאר לסגור. לפני מבחן זה מתהפך ל"מה נשאר".' },
    ]},
    { id: 'ab-repeat', title: '🧠 חוזרים', cards: [
      { icon: '🧠', title: 'i❤️Shinun — לדעת בעל־פה',
        body: 'העובדות היבשות שאי אפשר להסיק, רק לזכור: חלבונים, תרופות, בופרים, קיצורים. ' +
              'שלושה מצבים: 🎴 כרטיס-היפוך (מה שלא ידעתם חוזר), 📋 כסה-וגלה להדפסה, ' +
              'ו-📝 מבחן קצר שהמסיחים בו תמיד מאותה משפחה — אתגר אמיתי.' },
      { icon: '🃏', title: 'אנקי מוכן להורדה',
        body: 'חפיסות אנקי מושקעות לפי נושא, נבנות ממפת החומרים — למי שחי באנקי. ' +
              'מורידים מעמוד הקורס ומשננים בקצב שלכם.' },
    ]},
    { id: 'ab-tools', title: '🧰 ומסביב', cards: [
      { icon: '🔑', title: 'חשבון אחד, התקדמות בכל מכשיר',
        body: 'נכנסים עם Google וכל תשובה נשמרת וממשיכה מכל מכשיר. רק אתם רואים את ' +
              'ההתקדמות שלכם — אף אחד אחר, כולל מי שהעלה את האתר, לא ניגש אליה. ' +
              '(נאספות רק סטטיסטיקות אנונימיות מצטברות — כמה אנשים, אילו נושאים.)' },
      { icon: '🧭', title: 'ניווט וחיפוש מכל מקום',
        body: 'בטלפון — סרגל תחתון קבוע: בית · הקורס · תרגול · חיפוש · חשבון. החיפוש ' +
              '(או מקש /) מגיע לכל שאלה, נקודה במפה, כרטיסייה ולומדה בארכיון.' },
      { icon: '⏳', title: 'השעון למבחן הבא',
        body: 'בראש הבית רץ שעון למועד האמיתי הקרוב, מלוח הבחינות. הצבע מתחמם ככל ' +
              'שמתקרבים — רגוע, שבוע, שלושה ימים, היום.' },
      { icon: '🌙', title: 'בהיר, כהה, או לפי המכשיר',
        body: 'הכפתור למעלה מחליף ערכת נושא. ללילה שלפני — כהה, שהמסך לא יסנוור.' },
    ]},
  ];

  /* תוכן-עניינים: צ׳יפים שגוללים לקבוצה. */
  const toc = el('div', 'chips about-toc');
  GROUPS.forEach((g) => {
    const ch = el('button', 'verb-chip', g.title);
    ch.title = 'גלילה אל ' + g.title;
    ch.onclick = () => document.getElementById(g.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    toc.append(ch);
  });
  view.append(toc);

  GROUPS.forEach((g) => {
    const sec = el('section', 'verb-zone about-zone');
    sec.id = g.id;
    const h = el('div', 'zone-head');
    h.append(el('span', 'zone-head-t', g.title));
    h.append(el('span', 'zone-head-line'));
    sec.append(h);
    g.cards.forEach((s2) => {
      const c = el('div', 'about-card');
      const hh = el('div', 'about-head');
      hh.append(el('span', 'about-ico', s2.icon));
      hh.append(el('h3', null, s2.title));
      c.append(hh);
      c.append(el('p', null, s2.body));
      sec.append(c);
    });
    view.append(sec);
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
  cta.append(el('div', 'sub', 'זהו. עכשיו פשוט בוחרים מקצוע ומתחילים.'));
  const row = el('div', 'btn-row');
  row.style.justifyContent = 'center';
  const go = el('a', 'btn primary', 'למקצועות');
  go.title = 'מעבר למסך הבית — בחירת מקצוע';
  go.href = '#/';
  row.append(go);
  cta.append(row);
  view.append(cta);

  toTop();
  updateFooter();
}

/* פוש במסך הבית ל-i❤️Shinun — באנר חד-פעמי (עד סגירה) שמפנה למקצוע שיש בו
   שננת. מוצג רק אם קיימת חפיסת שינון כלשהי, ורק למי שעדיין לא ראה/סגר. */
function shinunHomePush() {
  try { if (localStorage.getItem('shichzurim.shinunHomePush')) return null; } catch { return null; }
  /* החפיסה של המקצוע שהמבחן שלו הכי קרוב, ולא "הראשונה שנמצאה". הבחירה
     הגלובלית עבדה רק כל עוד יש חפיסה אחת בארכיון, ו-i❤️Shinun הוא סטנדרט
     לכל מקצוע (PROMPT.md) — כלומר היא הייתה נשברת בשקט עם החפיסה השנייה,
     ומפנה את כולם למקצוע שרירותי. */
  const decks = EXAMS.filter((e) => e.kind === 'shinun');
  if (!decks.length) return null;
  const deck = decks
    .map((d) => {
      const c = courseOf(d.course);
      const nd = c && nextDate(c);
      return { d, ts: nd ? nd.ts : Infinity };
    })
    .sort((a, b) => a.ts - b.ts)[0].d;
  const b = el('a', 'intro shinun-push');
  b.href = '#/shinun/' + deck.course;
  const txt = el('div');
  txt.append(el('b', null, '🧠 חדש: i❤️Shinun — שינון בעל־פה'));
  txt.append(el('span', null, 'המקום לעבור על החומר צד-מול-צד, בלי מסיחים. ' +
    'כרטיסי היפוך, כסה־וגלה, ומבחן קצר. נסה עכשיו ←'));
  b.append(txt);
  const x = el('button', 'intro-x', '✕');
  x.type = 'button';
  x.title = 'סגירה — ההודעה לא תופיע שוב';
  x.setAttribute('aria-label', 'סגירה');
  x.onclick = (e) => { e.preventDefault(); e.stopPropagation(); try { localStorage.setItem('shichzurim.shinunHomePush', '1'); } catch {} b.remove(); };
  b.append(x);
  return b;
}

/* ================= הכרזת החידושים =================

   באנר חד-פעמי במסך הבית שמסביר מה חדש. אותה תבנית כמו shinunHomePush:
   נסגר לתמיד בלחיצה, ולא חוזר.

   ⚠️ המפתח נושא מספר גרסה. גל חידושים הבא מקבל v6 והבאנר יופיע שוב לכולם —
   כולל למי שסגר את הקודם. זה מכוון: מי שסגר הודעה על פיצ׳ר א׳ עדיין צריך
   לשמוע על פיצ׳ר ב׳. */
/* באנר הסקר — גדול ובולט בראש עמוד הבית, בכוונה בלי כפתור סגירה קבוע:
   הוא יורד לכולם רק כשנוריד אותו בקוד, ולמי שכבר מילא — מיד. "אחר כך"
   מסתיר עד הביקור הבא (sessionStorage), לא לתמיד. */
function whatsNewBanner() {
  /* ── הסקר נסגר ב-09/08/2026, אחרי 57 תשובות ──
     ינון: „אפשר להוריד אותו; אנשים כבר לא יענו עליו”. הבאנר יורד; עמוד
     הסקר עצמו (#/survey) נשאר נגיש למי שיש לו קישור, וגם התשובות שנשמרו
     מקומית בלי רשת עדיין יישלחו. הסקר הבא: להעלות את SURVEY_VERSION,
     לכתוב את הנוסח החדש, ולהחזיר את השורה הזאת עם תאריך תפוגה. */
  return null;
  try { if (localStorage.getItem(SURVEY_DONE_KEY)) return null; } catch { return null; }
  try { if (sessionStorage.getItem('shichzurim.surveyHeroHide')) return null; } catch { /* מציגים */ }

  const b = el('div', 'survey-hero');
  b.append(el('div', 'survey-hero-ico', '🎉'));
  b.append(el('h2', null, 'דקה לפני קו הסיום של שנה א׳'));
  b.append(el('p', 'survey-hero-sub',
    'כל הכבוד על השנה הזאת 💪 ולפני שכולם מתפזרים לחופשה — יש לנו בקשה אחת קטנה: ' +
    '5–10 דקות של משוב. מה עזר, מה חסר, ומה לבנות לכם עד מבחני דצמבר. ' +
    'זה הזמן היחיד בשנה לשמוע אתכם — והתשובות באמת קובעות מה יהיה כאן.'));

  const acts = el('div', 'btn-row survey-hero-acts');
  const go = el('a', 'btn primary survey-hero-cta', '💜 למילוי הסקר');
  go.title = 'סקר המשוב — 5–10 דקות שקובעות את הגרסה הבאה';
  go.href = '#/survey';
  acts.append(go);
  const later = el('button', 'btn ghost', 'אחר כך');
  later.title = 'הסתרה לביקור הזה — הבאנר יחזור בפעם הבאה, והסקר תמיד זמין';
  later.onclick = () => {
    try { sessionStorage.setItem('shichzurim.surveyHeroHide', '1'); } catch { /* מסתירים */ }
    b.remove();
  };
  acts.append(later);
  b.append(acts);

  b.append(el('p', 'survey-hero-mail',
    '📮 דרך אגב: הכתובת שאיתה נכנסת (מגוגל) שמורה אצלנו, ונשתמש בה מדי פעם לעדכונים חשובים — ' +
    'חומרים חדשים ומבחנים קרבים. בלי ספאם. מעדיפים בלי? כתבו לנו ל-shichzurim52@gmail.com ונסיר מיד.'));
  return b;
}

function introBanner() {
  if (localStorage.getItem(SEEN_KEY)) return null;

  const b = el('div', 'intro');
  const txt = el('div');
  /* היה כאן „✨ חדש: חשבון אישי וסנכרון” — הכרזה על פיצ׳ר מ-22/07 שהוצגה
     לכל נכנס חדש עוד שבועות אחרי שהיא הפסיקה להיות חדשה. באנר הפתיחה נראה
     פעם אחת בחיים של משתמש, ולכן הוא צריך להסביר *מה זה המקום הזה* — לא מה
     נוסף בו לאחרונה. חידושים מוכרזים בבאנר „מה חדש”, שנושא מספר גרסה. */
  txt.append(el('b', null, '👋 ברוכים הבאים לארכיון'));
  txt.append(el('span', null, 'שחזורי מבחנים אמיתיים לתרגול, עם הסבר לכל שאלה ומעקב אחרי מה שטעיתם. סיור של דקה עובר על הכול.'));
  b.append(txt);

  const acts = el('div', 'btn-row');
  const read = el('button', 'btn primary', 'קחו אותי לסיור');
  read.title = 'סיור מודרך של דקה על כל מה שיש באתר';
  read.onclick = () => startTour();
  acts.append(read);
  const skip = el('button', 'btn ghost', 'תודה, אני מסתדר');
  skip.title = 'סגירה — אפשר לחזור לסיור בכל רגע מעמוד „אודות”';
  skip.onclick = () => { localStorage.setItem(SEEN_KEY, '1'); b.remove(); };
  acts.append(skip);
  b.append(acts);
  return b;
}

/* ================= חשבון וענן =================
   הענן עצמו חי ב-cloud.js; כאן רק הממשק. כל הפניות דרך window.Cloud?. —
   כשהענן כבוי שום דבר מזה לא מופיע והאתר נראה בדיוק כמו קודם. */

/* כפתור G של גוגל — הצבעים הרשמיים, על כפתור לבן. */
function googleLoginBtn(label) {
  const btn = el('button', 'btn btn-google');
  btn.title = 'התחברות עם חשבון Google — ההתקדמות נשמרת וממשיכה מכל מכשיר';
  btn.innerHTML =
    '<svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true">' +
    '<path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>' +
    '<path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>' +
    '<path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>' +
    '<path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>' +
    '</svg>';
  btn.append(el('span', null, label || 'המשך עם Google'));
  btn.onclick = () => window.Cloud?.login();
  return btn;
}

/* מסך הכניסה של האתר הסגור. מוצג מהראוטר כש-REQUIRE_LOGIN דולק ואין משתמש. */
function renderLogin() {
  setNav('home');
  view.innerHTML = '';

  const wrap = el('div', 'login-hero');
  const mark = el('img', 'login-mark');
  mark.src = 'assets/img/logo.png';
  mark.alt = '';            // דקורטיבי — הכותרת שמתחתיו כבר אומרת את השם
  wrap.append(mark);
  wrap.append(el('h1', null, 'ארכיון השחזורים'));
  wrap.append(el('p', 'login-sub',
    'הארכיון פתוח לסטודנטים של הפקולטה — נכנסים עם חשבון Google, וההתקדמות ' +
    'שלך נשמרת בחשבון וממשיכה מכל מכשיר: טלפון, מחשב, ספרייה.'));
  wrap.append(googleLoginBtn('התחברות עם Google'));

  const about = el('a', 'login-about', 'איך זה עובד? →');
  about.href = '#/about';
  wrap.append(about);

  view.append(wrap);
  toTop();
}

/* עמוד החשבון: מי מחובר, מצב הסנכרון, התנתקות, וייצוא גיבוי ידני. */
function renderAccount() {
  setNav('home');
  view.innerHTML = '';
  const C = window.Cloud;

  if (!C || !C.enabled) {
    view.append(emptyState('☁️', 'הסנכרון עוד לא הופעל',
      'הגרסה הזו של האתר רצה בלי חיבור לענן — ההתקדמות נשמרת בדפדפן הזה בלבד.'));
    return;
  }
  if (!C.user) return renderLogin();

  view.append(crumb('לארכיון', '#/'));
  const head = el('div', 'page-head');
  head.append(el('h1', null, 'החשבון שלי'));
  view.append(head);

  const card = el('div', 'account-card');
  const who = el('div', 'account-who');
  who.append(el('div', 'account-avatar', (C.user.name || C.user.email || '?').trim().charAt(0).toUpperCase()));
  const ident = el('div');
  ident.append(el('b', null, C.user.name || ''));
  ident.append(el('div', 'account-email', C.user.email));
  who.append(ident);
  card.append(who);

  /* עריכת שם התצוגה — איך האתר פונה אליך. */
  const nameRow = el('div', 'account-name');
  nameRow.append(el('label', null, 'איך לקרוא לך?'));
  const nameInp = el('input', 'name-input');
  nameInp.type = 'text';
  nameInp.value = C.user.firstName || '';
  nameInp.maxLength = 40;
  const nameSave = el('button', 'btn ghost', 'שמור');
  nameSave.title = 'שמירת השם — ככה האתר יפנה אליך';
  const saveName = async () => {
    const v = nameInp.value.trim();
    if (!v) return;
    nameSave.disabled = true; nameSave.textContent = 'נשמר ✓';
    await C.setName(v);
    setTimeout(() => { nameSave.disabled = false; nameSave.textContent = 'שמור'; }, 1500);
  };
  nameSave.onclick = saveName;
  nameInp.onkeydown = (e) => { if (e.key === 'Enter') saveName(); };
  nameRow.append(nameInp, nameSave);
  card.append(nameRow);

  /* שורת מצב חיה — מתעדכנת מאירועי cloud:sync כל עוד העמוד מוצג. */
  const syncLine = el('div', 'account-sync');
  const renderSync = () => {
    const s = C.status();
    if (s.syncing) syncLine.textContent = '⏳ מסנכרן…';
    else if (s.pending > 0) syncLine.textContent = `⬆️ ${s.pending} שינויים ממתינים לשליחה`;
    else syncLine.textContent = '✅ ההתקדמות מסונכרנת לחשבון';
  };
  renderSync();
  const onSync = () => { if (document.body.contains(syncLine)) renderSync(); else document.removeEventListener('cloud:sync', onSync); };
  document.addEventListener('cloud:sync', onSync);
  card.append(syncLine);

  const acts = el('div', 'btn-row');
  const exp = el('button', 'btn ghost', 'העתקת גיבוי התקדמות');
  exp.title = 'העתקת גיבוי מלא של כל ההתקדמות ללוח — לשמירה בצד';
  exp.onclick = async () => {
    const dump = {};
    /* כל מפתח שנושא התקדמות אמיתית. השינון נשכח כאן כשהוא נוסף, והגיבוי
       הבטיח יותר ממה שנתן — מי ששחזר ממנו קיבל חזרה מבחנים בלי הקופסאות. */
    [KEY, SEEN_Q_KEY, SEENH_KEY, CARDS_READ_KEY, CASE_KEY, SHINUN_KEY, SHINUN_CELEB_KEY, FLAG_KEY]
      .forEach((k) => { dump[k] = localStorage.getItem(k); });
    try {
      await navigator.clipboard.writeText(JSON.stringify(dump));
      exp.textContent = '✓ הועתק ללוח';
    } catch { exp.textContent = 'ההעתקה נחסמה'; }
  };
  acts.append(exp);
  const out = el('button', 'btn ghost logout', 'התנתקות');
  out.title = 'התנתקות מהחשבון — ההתקדמות שמורה בענן ותחזור בהתחברות הבאה';
  out.onclick = async () => {
    out.disabled = true;
    await C.logout();
    location.hash = '#/';
    router();
  };
  acts.append(out);
  card.append(acts);

  card.append(el('p', 'account-note',
    'ההתקדמות נשמרת גם במכשיר וגם בחשבון. התנתקות לא מוחקת כלום — ' +
    'ההתחברות הבאה תאחה בין המכשיר לחשבון.'));

  view.append(card);

  /* כניסה ללוח הבקרה — מוצג רק למנהל, ולא בתפריט הציבורי. */
  if (C.isAdmin) {
    const a = el('a', 'btn ghost admin-link', '📊 לוח הבקרה');
    a.title = 'סטטיסטיקות שימוש ובריאות האתר — נראה למנהל בלבד';
    a.href = '#/admin';
    a.style.marginTop = '14px';
    view.append(a);
  }

  toTop();
  updateFooter();
}

/* ================= לוח בקרה — סטטיסטיקות (מנהל בלבד) =================
   כל הנתונים אגרגטיביים ומגיעים מפונקציות admin_* בשרת, שנעולות מאחורי
   is_admin(). אין כאן שום מידע על סטודנט בודד — רק מספרים ומגמות. */

/* כרטיס KPI — אייקון, מספר גדול, תווית. */
function kpiCard(n, label, icon, cls) {
  const c = el('div', 'adm-kpi' + (cls ? ' ' + cls : ''));
  c.append(el('span', 'adm-kpi-ico', icon));
  c.append(el('b', 'adm-kpi-n', n == null ? '—' : String(n)));
  c.append(el('span', 'adm-kpi-l', label));
  return c;
}

/* כרטיס סקשן עם כותרת ורמז אופציונלי. */
function admCard(title, hint) {
  const c = el('section', 'adm-card');
  const h = el('div', 'adm-card-head');
  h.append(el('h3', null, title));
  if (hint) h.append(el('span', 'adm-hint', hint));
  c.append(h);
  return c;
}

/* כותרת סקשן בלוח — מקבצת כמה כרטיסים תחת נושא אחד. extra (אופציונלי)
   נכנס לצד הכותרת — כך הצ׳יפים 7/30/90 יושבים *בתוך* סקשן המגמות, וברור
   שהם חלים רק עליו ולא על ה-KPI שלמעלה. */
function admSection(title, extra, fold) {
  const s = el('div', 'adm-sec');
  const h = el('div', 'adm-sec-head');
  h.append(el('h2', null, title));
  if (extra) h.append(extra);
  s.append(h);
  /* fold — "קומה 3" של הלוח: הסקשן קיים ונטען, אבל מקופל עד לחיצה על
     הכותרת. תצוגה בלבד — הטעינה עצמה רצה כרגיל. */
  if (fold) {
    s.classList.add('fold', 'closed');
    const ch = el('span', 'chev', '⌄');
    h.append(ch);
    h.style.cursor = 'pointer';
    h.title = 'הצגה/קיפול';
    h.onclick = () => s.classList.toggle('closed');
  }
  return s;
}

/* רשימה מדורגת עם פסים — "מה הכי בשימוש".
   rows: [{label, n, users}]. n מוצג תמיד; users (ייחודיים) אם קיים —
   ההבחנה בין "נפתח הרבה" ל"נפתח על-ידי רבים". */
function rankBars(rows) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  const box = el('div', 'rank');
  if (!rows.length) { box.append(el('p', 'adm-empty', 'אין עדיין נתונים בטווח הזה.')); return box; }
  rows.forEach((r, i) => {
    const row = el('div', 'rank-row');
    row.append(el('span', 'rank-i', String(i + 1)));
    const name = el('span', 'rank-name', r.label);
    name.title = r.label;
    row.append(name);
    const track = el('div', 'rank-bar');
    const f = el('i'); f.style.width = Math.round((r.n / max) * 100) + '%';
    track.append(f); row.append(track);
    row.append(el('span', 'rank-n', String(r.n)));
    if (r.users != null) row.append(el('span', 'rank-u', `👤 ${r.users}`));
    box.append(row);
  });
  return box;
}

/* תקרה "עגולה" לציר ה-Y: המספר הנוח הקטן ביותר שגדול מהמקסימום, כזה
   שגם חצי ממנו הוא מספר שלם — כדי שקו האמצע יציג ערך קריא. */
function niceMax(v) {
  if (v <= 2) return 2;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 3, 4, 5, 6, 8, 10, 20]) {
    const c = m * p;
    if (c >= v && (c / 2) % 1 === 0) return c;
  }
  return 10 * p;
}

/* היסטוגרמת עמודות עם ציר אמיתי: קווי-רשת עם ערכים (0 / אמצע / תקרה),
   תוויות X, ו-tooltip שעובד גם במגע (hover בעכבר, הקשה בטלפון) — במקום
   ה-title הנייטיב שלא עבד במגע. direction:ltr כדי שציר הזמן יזרום
   שמאל→ימין כמקובל בגרף, גם בעמוד RTL.

   rows: [{label, vals:[..], tip}] — vals נערמים, סדרה 0 בתחתית.
   opts: everyNth — כל כמה עמודות תווית; colors — מחלקת צבע לכל סדרה
   ('accent'/'good'); legend — [{label, cls}]. */
function axisChart(rows, opts = {}) {
  const { everyNth = 1, colors = ['accent'], legend = null } = opts;
  const box = el('div', 'chx');
  box.dir = 'ltr';
  const totals = rows.map((r) => r.vals.reduce((a, b) => a + b, 0));
  if (!rows.length || !totals.some((t) => t > 0)) {
    box.append(el('p', 'adm-empty', 'אין עדיין נתונים בטווח הזה.'));
    return box;
  }
  const max = niceMax(Math.max(...totals));

  const plot = el('div', 'chx-plot');
  [[0, 0], [50, max / 2], [100, max]].forEach(([pct, val]) => {
    const g = el('div', 'chx-gl');
    g.style.bottom = pct + '%';
    g.append(el('span', 'chx-gv', String(val)));
    plot.append(g);
  });

  const tip = el('div', 'chx-tip');
  const bars = el('div', 'chx-bars');
  rows.forEach((r, i) => {
    const col = el('div', 'chx-col');
    const bar = el('div', 'chx-bar');
    r.vals.forEach((v, si) => {
      const seg = el('i', 'chx-s ' + (colors[si] || 'accent'));
      seg.style.height = (v / max * 100) + '%';
      bar.append(seg);
    });
    col.append(bar);
    col.append(el('span', 'chx-lab', i % everyNth === 0 ? r.label : ''));

    const show = () => {
      tip.textContent = r.tip || `${r.label} · ${totals[i]}`;
      tip.classList.add('on');
      col.classList.add('lit');
      /* ממקמים אחרי שהטקסט נכנס, כדי שהרוחב ידוע ואפשר להצמיד לגבולות */
      const x = col.offsetLeft + col.offsetWidth / 2;
      const w = tip.offsetWidth, pw = plot.offsetWidth;
      tip.style.left = Math.max(0, Math.min(pw - w, x - w / 2)) + 'px';
    };
    const hide = () => { tip.classList.remove('on'); col.classList.remove('lit'); };
    col.addEventListener('pointerenter', show);
    col.addEventListener('pointerleave', hide);
    col.addEventListener('click', () => (col.classList.contains('lit') ? hide() : show()));
    bars.append(col);
  });
  plot.append(bars, tip);
  box.append(plot);

  if (legend) {
    const lg = el('div', 'chx-legend');
    lg.dir = 'rtl';
    legend.forEach((l) => {
      const item = el('span', 'chx-lg');
      item.append(el('i', 'chx-s ' + l.cls));
      item.append(document.createTextNode(l.label));
      lg.append(item);
    });
    box.append(lg);
  }
  return box;
}

/* ציר של N הימים האחרונים לפי שעון ישראל — תואם לחלוקה היומית בשרת (v2).
   ימים בלי פעילות מקבלים 0, כך הגרף רציף ולא מדלג על ימים שקטים.
   keys — אילו שדות מספריים להעתיק מכל שורה. */
const IL_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' });  // YYYY-MM-DD
function lastDaysIL(n) {
  const out = [], now = Date.now();
  for (let i = n - 1; i >= 0; i--) out.push(IL_DAY.format(new Date(now - i * 864e5)));
  return out;
}
function fillDays(rows, n, keys = ['n']) {
  const map = {};
  (rows || []).forEach((r) => { map[String(r.day).slice(0, 10)] = r; });
  return lastDaysIL(n).map((day) => {
    const src = map[day] || {};
    const out = { day };
    keys.forEach((k) => { out[k] = Number(src[k] || 0); });
    return out;
  });
}

/* "לפני X" קצר — לשורת הבריאות התפעולית. */
function admAgo(ts) {
  if (!ts) return '—';
  const m = Math.round((Date.now() - new Date(ts).getTime()) / 60000);
  if (m < 1) return 'ממש עכשיו';
  if (m < 60) return `לפני ${m} דק׳`;
  const h = Math.round(m / 60);
  if (h < 24) return `לפני ${h} שע׳`;
  return `לפני ${Math.round(h / 24)} ימים`;
}

/* מפת qid → שאלה + מטא — נטענת פעם אחת (בעצלנות) לצורך סקשן בריאות התוכן:
   הופכת qid עירום מהשרת לטקסט שאלה, מסיחים ותשובה נכונה. HY שנבנה משחזור
   חולק qid עם המקור — המופע הראשון (השחזור עצמו) מנצח, כמו ב"הטעויות שלי". */
let admContent = null;
async function admLoadContent() {
  if (admContent) return admContent;
  const byQid = new Map();
  const exams = new Map();
  for (const c of COURSES) {
    const metas = quizzesOf(c.id);
    const loaded = await Promise.all(metas.map((m) => loadExam(m.id).catch(() => null)));
    metas.forEach((m, mi) => {
      const d = loaded[mi];
      if (!d) return;
      const qs = d.questions || [];
      exams.set(m.id, {
        title: d.title || m.title || m.id, course: c.name,
        scored: qs.filter((q) => !q.offSyllabus).length,
      });
      qs.forEach((q, i) => {
        if (q.qid && !byQid.has(q.qid)) {
          byQid.set(q.qid, { q, examId: m.id, examTitle: d.title || m.title || m.id, courseName: c.name, idx: i });
        }
      });
    });
  }
  admContent = { byQid, exams };
  return admContent;
}

async function renderAdmin() {
  setNav(null);
  view.innerHTML = '';
  const C = window.Cloud;

  if (!C || !C.enabled || !C.isAdmin) {
    view.append(emptyState('🔒', 'אין גישה', 'לוח הבקרה פתוח למנהל בלבד.'));
    toTop();
    return;
  }

  view.append(crumb('לארכיון', '#/'));
  const head = el('div', 'page-head');
  head.append(el('h1', null, '📊 לוח הבקרה'));
  head.append(el('p', null,
    'אגרגטיבי בלבד — מספרים ומגמות, בלי מידע על משתמש בודד. ' +
    'הנתונים נטענים ברגע הפתיחה; „רענון" מושך אותם מחדש.'));
  view.append(head);

  /* עוזר: מריץ טעינה לתוך מכל, עם מצבי טעינה/שגיאה אחידים. fill מקבל את
     המכל הריק ואחראי למלא אותו. */
  function section(target, fill) {
    target.innerHTML = '';
    target.append(el('div', 'adm-loading', 'טוען…'));
    Promise.resolve().then(async () => {
      const frag = el('div');
      await fill(frag);
      target.innerHTML = '';
      while (frag.firstChild) target.append(frag.firstChild);
    }).catch((err) => {
      target.innerHTML = '';
      target.append(el('p', 'adm-empty', '⚠️ לא הצלחתי לטעון: ' + String(err && err.message || err)));
    });
  }
  /* RPC של Supabase לא זורק — מחזיר {error}. מיישרים לזריקה כדי ש-section יתפוס. */
  const rpc = async (p) => {
    const r = await p;
    if (r.error) throw new Error(r.error.message || 'שגיאת שרת');
    return r.data;
  };

  /* ── 1. מצב הקהילה — חלונות קבועים, מוצהרים בתווית ─────────────── */
  const refreshBtn = el('button', 'adm-chip', '🔄 רענון');
  refreshBtn.title = 'טעינה מחדש של כל נתוני הלוח';
  refreshBtn.onclick = () => renderAdmin();
  const s1 = admSection('👥 מצב הקהילה', refreshBtn);
  const kpis = el('div', 'adm-kpis');
  s1.append(kpis);
  view.append(s1);

  section(kpis, async (box) => {
    const o = await rpc(C.admin.overviewV2());
    box.append(kpiCard(o.total_users, 'משתמשים רשומים', '👥', 'accent'));
    box.append(kpiCard(o.active_today, 'פעילים היום', '🟢', 'good'));
    box.append(kpiCard(o.active_7d, 'פעילים · 7 ימים', '📅'));
    box.append(kpiCard(o.active_30d, 'פעילים · 30 יום', '🗓️'));
    box.append(kpiCard(o.new_7d, 'הצטרפו · 7 ימים', '🆕'));
    /* דביקות: איזה חלק מהפעילים החודשיים חוזר בשבוע האחרון. */
    const stick = o.active_30d ? Math.round((o.active_7d / o.active_30d) * 100) + '%' : '—';
    const stickC = kpiCard(stick, 'דביקות (7 מתוך 30)', '🧲');
    stickC.title = 'איזה אחוז מהפעילים ב-30 הימים האחרונים היה פעיל גם בשבוע האחרון';
    box.append(stickC);
    /* נטישה: נרשמו ולא ייצרו אף אירוע + כאלה שכל הפעילות שלהם ביממה אחת. */
    const lost = (o.never_active ?? 0) + (o.one_and_done ?? 0);
    const lostC = kpiCard(lost, 'באו ולא נשארו', '👻');
    lostC.title = `${o.never_active ?? 0} נרשמו ומעולם לא פעלו · ${o.one_and_done ?? 0} פעלו יממה אחת ונעלמו`;
    box.append(lostC);
    if (o.new_30d != null) box.append(kpiCard(o.new_30d, 'הצטרפו · 30 יום', '🌱'));
    if (o.events_total != null) box.append(kpiCard(o.events_total, 'אירועים מאז ומעולם', '♾️'));
  });

  /* ── 2. בריאות תפעולית — הגלאי לתקלות שקטות כמו תקלת shinunProg ── */
  const s2 = admSection('🩺 בריאות תפעולית — פירוט', null, true);
  const opsBox = el('div');
  s2.append(opsBox);
  view.append(s2);

  section(opsBox, async (box) => {
    const o = await rpc(C.admin.opsHealth());
    const card = admCard('דופק הענן', 'אירועים מול כתיבות user_kv');
    const line = el('div', 'adm-ops');
    line.append(el('span', 'adm-ops-stat', `⚡ ${o.events_1h ?? 0} אירועים בשעה האחרונה`));
    line.append(el('span', 'adm-ops-stat', `🕓 אירוע אחרון: ${admAgo(o.last_event_at)}`));
    line.append(el('span', 'adm-ops-stat', `📥 היום: ${o.event_users_today ?? 0} פעילים לפי אירועים · ${o.kv_users_today ?? 0} כתבו לענן`));
    card.append(line);

    /* פער בין "פעיל" ל"כותב לענן" = תור סנכרון מורעל אצל חלק מהמשתמשים —
       בדיוק התקלה של 0003, שלא נראתה בשום מקום. */
    const a = o.event_users_today ?? 0, b = o.kv_users_today ?? 0;
    if (a >= 5 && b < a / 2) {
      card.append(el('p', 'adm-alert bad',
        `⚠️ פער חשוד: רק ${b} מתוך ${a} פעילים כתבו היום ל-user_kv. ` +
        'ייתכן שתור הסנכרון מורעל אצל חלק מהמשתמשים (כמו תקלת shinunProg) — שווה לבדוק.'));
    } else {
      card.append(el('p', 'adm-alert ok', '✓ אין פער חשוד בין פעילות לכתיבה לענן.'));
    }

    /* כותבים לפי namespace בשבוע. מרחב מוכר שצנח לאפס = דגל אדום. */
    const KNOWN_NS = ['progress', 'seen', 'seenH', 'shinunProg', 'cardsRead', 'caseProg', 'flag'];
    const got = {};
    (o.ns_7d || []).forEach((r) => { got[r.ns] = r; });
    const nsWrap = el('div', 'adm-ns');
    KNOWN_NS.forEach((ns) => {
      const r = got[ns];
      const chip = el('span', 'adm-ns-chip' + (r ? '' : ' dead'));
      chip.textContent = r ? `${ns} · ${r.users} כותבים` : `${ns} · 0 ‼️`;
      chip.title = r ? `${r.rows} שורות עודכנו ב-7 הימים האחרונים` : 'אף משתמש לא כתב למרחב הזה השבוע — תקלה, או פיצ׳ר שטרם הופץ';
      nsWrap.append(chip);
    });
    card.append(el('p', 'adm-hint', 'כותבים ייחודיים לכל מרחב שם ב-7 הימים האחרונים:'));
    card.append(nsWrap);
    box.append(card);
  });

  /* ── 2.5 דיווחי טעויות — מה שהסטודנטים סימנו בכפתור ה-🚩 ─────────── */
  const sR = admSection('🚩 מה דורש טיפול — דיווחים על שאלות');
  const repBox = el('div');
  sR.append(repBox);
  view.append(sR);

  section(repBox, async (box) => {
    const rows = await rpc(C.admin.reports('open', 100));
    if (!rows || !rows.length) {
      box.append(el('p', 'adm-empty', 'אין דיווחים פתוחים 🎉'));
      return;
    }
    const REASON_HE = {
      wrong_answer: 'התשובה המסומנת שגויה',
      typo: 'טעות הקלדה/ניסוח',
      unclear: 'שאלה לא ברורה',
      other: 'אחר',
    };
    rows.forEach((r) => {
      const card = admCard(
        `${REASON_HE[r.reason] || r.reason} · ${r.course_id}`,
        `${admAgo(r.created_at)}${r.chosen != null ? ` · המדווח בחר מסיח ${r.chosen + 1}` : ''}`);
      if (r.q_preview) card.append(el('p', 'adm-rep-q', r.q_preview));
      if (r.detail) card.append(el('p', 'adm-rep-d', '💬 ' + r.detail));

      const acts = el('div', 'adm-rep-acts');
      const link = el('a', 'adm-chip', 'לשאלה ↗');
      link.href = '#/q/' + r.qid;
      link.title = 'פתיחת השאלה המדווחת';
      acts.append(link);

      /* טופל/נדחה מעלימים את הכרטיס מיד — הרשימה היא תור עבודה, לא ארכיון. */
      [['resolved', '✓ טופל', 'סימון שהדיווח טופל'], ['rejected', '✗ נדחה', 'סימון שהדיווח אינו טעות']]
        .forEach(([st, label, tip]) => {
          const b = el('button', 'adm-chip', label);
          b.title = tip;
          b.onclick = async () => {
            b.disabled = true;
            const res = await C.admin.setReportStatus(r.id, st);
            if (res.error) { b.disabled = false; return; }
            card.remove();
          };
          acts.append(b);
        });
      card.append(acts);
      box.append(card);
    });
  });

  /* ── 2.7 סקר המשוב — התשובה האחרונה של כל משיב, אגרגטים + טקסטים ── */
  const sSv = admSection('📋 סקר המשוב', null, true);
  const svBox = el('div');
  sSv.append(svBox);
  view.append(sSv);

  section(svBox, async (box) => {
    const rows = await rpc(C.admin.surveyResults(1));
    if (!rows || !rows.length) {
      box.append(el('p', 'adm-empty', 'עוד אין תשובות לסקר.'));
      return;
    }
    const answers = rows.map((r) => r.answers || {});
    const n = answers.length;

    /* תוויות התשובות — מאותה הגדרה של הסקר עצמו, כדי שאין שתי אמיתות. */
    const labelOf = {};
    surveySteps().forEach((st) => st.qs.forEach((q) => {
      if (q.opts) { labelOf[q.k] = {}; q.opts.forEach(([v, l]) => { labelOf[q.k][v] = l; }); }
    }));

    /* פס התפלגות אחד: שם, פס יחסי למקסימום, ומונה. */
    const dist = (title, counts, denom) => {
      const entries = Object.entries(counts).sort((x, y) => y[1] - x[1]);
      if (!entries.length) return null;
      const max = entries[0][1];
      const card = admCard(title);
      const wrapD = el('div', 'adm-sv-dist');
      entries.forEach(([name, cnt]) => {
        const row = el('div', 'adm-sv-row');
        row.append(el('span', 'adm-sv-name', name));
        const bar = el('div', 'adm-sv-bar');
        const fill = el('div', 'adm-sv-fill');
        fill.style.width = Math.round((cnt / max) * 100) + '%';
        bar.append(fill);
        row.append(bar);
        row.append(el('span', 'adm-sv-n', `${cnt} · ${Math.round((cnt / (denom || n)) * 100)}%`));
        wrapD.append(row);
      });
      card.append(wrapD);
      return card;
    };
    const countBy = (k, multi) => {
      const c = {};
      answers.forEach((ans) => {
        const v = ans[k];
        (multi ? (Array.isArray(v) ? v : []) : (v == null ? [] : [v])).forEach((x) => {
          const l = (labelOf[k] && labelOf[k][x]) || String(x);
          c[l] = (c[l] || 0) + 1;
        });
      });
      return c;
    };

    /* KPI: משיבים, תרומה ממוצעת, NPS, זמן מילוי חציוני */
    const kpisSv = el('div', 'adm-kpis');
    kpisSv.append(kpiCard(n, 'משיבים', '🗳️', 'accent'));
    const impacts = answers.map((x) => x.impact).filter((x) => typeof x === 'number');
    if (impacts.length) {
      kpisSv.append(kpiCard((impacts.reduce((s, x) => s + x, 0) / impacts.length).toFixed(1) + '/5',
        'תרומה להצלחה', '📈', 'good'));
    }
    const npsV = answers.map((x) => x.nps).filter((x) => typeof x === 'number');
    if (npsV.length) {
      /* NPS קלאסי: אחוז ממליצים (9–10) פחות אחוז מסתייגים (0–6). */
      const promo = npsV.filter((x) => x >= 9).length, detr = npsV.filter((x) => x <= 6).length;
      kpisSv.append(kpiCard(Math.round(((promo - detr) / npsV.length) * 100), 'NPS', '💜'));
    }
    const times = answers.map((x) => x.meta && x.meta.tookSec).filter((x) => typeof x === 'number').sort((a2, b2) => a2 - b2);
    if (times.length) kpisSv.append(kpiCard(Math.round(times[Math.floor(times.length / 2)] / 60) + ' דק׳', 'זמן מילוי חציוני', '⏱️'));
    box.append(kpisSv);

    /* מי ענה — שם ומייל (0008). נראה למנהל בלבד, כמו כל הלוח. */
    const svWho = (r) => {
      const nm = (r.display_name || '').trim();
      return nm ? `${nm} · ${r.email || ''}` : (r.email || r.user_id);
    };
    const whoCard = admCard(`🗳️ מי ענה · ${n}`, 'התשובה האחרונה של כל משיב');
    rows.forEach((r) => {
      const p = el('div', 'adm-sv-txt adm-sv-who');
      p.textContent = svWho(r);
      p.append(el('small', null, admAgo(r.created_at)));
      whoCard.append(p);
    });
    box.append(whoCard);

    /* דירוגי הפיצ׳רים: ממוצע בקרב מי שהשתמש + כמה השתמשו. */
    const rCard = admCard('⭐ דירוג לפי פיצ׳ר', 'ממוצע 1–5 בקרב מי שהשתמש · ✕ = לא השתמשו');
    const rWrap = el('div', 'adm-sv-dist');
    SURVEY_FEATURES.forEach(([fk, fl]) => {
      const vals = answers.map((x) => x.ratings && x.ratings[fk]).filter((x) => typeof x === 'number');
      const used = vals.filter((x) => x > 0);
      const avg = used.length ? used.reduce((s, x) => s + x, 0) / used.length : 0;
      const row = el('div', 'adm-sv-row');
      row.append(el('span', 'adm-sv-name', fl));
      const bar = el('div', 'adm-sv-bar');
      const fill = el('div', 'adm-sv-fill');
      fill.style.width = Math.round((avg / 5) * 100) + '%';
      bar.append(fill);
      row.append(bar);
      row.append(el('span', 'adm-sv-n', used.length ? `${avg.toFixed(1)} · ${used.length}👤` : '—'));
      row.title = `${used.length} השתמשו מתוך ${vals.length} שענו`;
      rWrap.append(row);
    });
    rCard.append(rWrap);
    box.append(rCard);

    [
      dist('🏆 הדבר האחד שהכי עזר', countBy('topFeature')),
      dist('📚 עם אילו מקצועות למדו', countBy('courses', true)),
      dist('🕐 תדירות שימוש', countBy('usage')),
      dist('🧩 מה הפריע', countBy('friction', true)),
      dist('💰 מחיר הוגן לסמסטר', countBy('price')),
      dist('🛒 על מה שווה לשלם', countBy('payFor', true)),
      dist('📱 מכשירים', countBy('device', true)),
      dist('📣 איך שמעו עלינו', countBy('heard')),
    ].forEach((c2) => { if (c2) box.append(c2); });

    /* הטקסטים החופשיים — הזהב האמיתי. כל תשובה עם הקשר קצר. */
    const TEXT_QS = [
      ['moment', '🙂 רגע שהאתר הציל'],
      ['frictionDetail', '🔧 מה הפריע — פירוט'],
      ['missing', '🎯 מה חשוב לדצמבר'],
      ['oneChange', '🪄 הדבר האחד לשינוי'],
      ['vacation', '✈️ לאן טסים בחופש'],
      ['freeText', '💬 מילים אחרונות'],
    ];
    TEXT_QS.forEach(([k, title]) => {
      const items = rows
        .map((r) => ({ t: (((r.answers || {})[k]) || '').trim(), who: svWho(r) }))
        .filter((x) => x.t);
      if (!items.length) return;
      const card = admCard(`${title} · ${items.length}`);
      items.forEach(({ t, who }) => {
        const p = el('div', 'adm-sv-txt');
        p.textContent = t;
        if (who) p.append(el('small', null, who));
        card.append(p);
      });
      box.append(card);
    });

    /* ייצוא גולמי — הצינור לניתוח עומק מחוץ ללוח. */
    const expRow = el('div', 'adm-rep-acts');
    const expBtn = el('button', 'adm-chip', '📋 העתקת כל התשובות (JSON)');
    expBtn.title = 'העתקה ללוח של כל התשובות הגולמיות — לניתוח מעמיק';
    expBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(JSON.stringify(rows, null, 1));
        expBtn.textContent = '✓ הועתק ללוח';
      } catch { expBtn.textContent = 'ההעתקה נחסמה'; }
    };
    expRow.append(expBtn);
    box.append(expRow);
  });

  /* ── 3. מגמות שימוש — הצ׳יפים חלים על הסקשן הזה בלבד ─────────────── */
  let days = 30;
  const chipRow = el('div', 'adm-range');
  const s3 = admSection('📈 מגמות שימוש', chipRow);
  const charts = el('div');
  s3.append(charts);
  view.append(s3);

  function drawChips() {
    chipRow.innerHTML = '';
    [[7, '7 ימים'], [30, '30 יום'], [90, '90 יום']].forEach(([d, l]) => {
      const b = el('button', 'adm-chip' + (d === days ? ' on' : ''), l);
      b.title = 'הצגת הגרפים על טווח של ' + l;
      b.onclick = () => { if (days === d) return; days = d; drawChips(); loadCharts(); };
      chipRow.append(b);
    });
  }

  function loadCharts() {
    section(charts, async (box) => {
      const [activity, hourly, targets, signups] = await Promise.all([
        rpc(C.admin.activityDaily(days)),
        rpc(C.admin.hourlyUsers(days)),
        rpc(C.admin.topTargets(days, 10)),
        rpc(C.admin.signupsDailyV2(days)),
      ]);

      // ── פעילים ליום: חוזרים (תכלת) + חדשים (ירוק) ──
      const aRows = fillDays(activity, days, ['n', 'new_n']);
      const nth = Math.max(1, Math.ceil(aRows.length / 7));
      const cA = admCard('📈 פעילים ליום', `שעון ישראל · ${days} הימים האחרונים`);
      cA.append(axisChart(aRows.map((r) => ({
        label: fmtDay(r.day),
        vals: [r.n - r.new_n, r.new_n],
        tip: `${fmtDay(r.day)} · ${r.n} פעילים` + (r.new_n ? ` (${r.new_n} חדשים)` : ''),
      })), {
        everyNth: nth, colors: ['accent', 'good'],
        legend: [{ label: 'חוזרים', cls: 'accent' }, { label: 'ביום הראשון שלהם', cls: 'good' }],
      }));
      box.append(cA);

      // ── מתי לומדים: משתמשים ייחודיים לפי שעה ──
      const byHour = {};
      (hourly || []).forEach((r) => { byHour[r.hour] = Number(r.n); });
      const cH = admCard('🕐 מתי לומדים', 'משתמשים ייחודיים בכל שעה · שעון ישראל · מצטבר על הטווח');
      cH.append(axisChart(Array.from({ length: 24 }, (_, h) => ({
        label: String(h).padStart(2, '0'),
        vals: [byHour[h] || 0],
        tip: `${String(h).padStart(2, '0')}:00–${String((h + 1) % 24).padStart(2, '0')}:00 · ${byHour[h] || 0} משתמשים`,
      })), { everyNth: 3 }));
      box.append(cH);

      // ── מה הכי בשימוש: פתיחות + כמה משתמשים שונים ──
      const cT = admCard('🔥 מה הכי בשימוש', 'פתיחות בטווח · 👤 מכמה משתמשים שונים');
      cT.append(rankBars((targets || []).map((r) => ({
        label: prettyTarget(r.target, r.type), n: r.n, users: r.users,
      }))));
      box.append(cT);

      // ── הצטרפות לפי יום ──
      const sRows = fillDays(signups, days);
      const cS = admCard('🆕 הצטרפות לפי יום', `שעון ישראל · ${days} הימים האחרונים`);
      cS.append(axisChart(sRows.map((r) => ({
        label: fmtDay(r.day), vals: [r.n],
        tip: `${fmtDay(r.day)} · ${r.n} נרשמו`,
      })), { everyNth: nth, colors: ['good'] }));
      box.append(cS);
    });
  }

  drawChips();
  loadCharts();

  /* ── 4. בריאות התוכן — הנתונים מ-user_kv, כל הזמנים ──────────────── */
  const s4 = admSection('🔬 בריאות התוכן — לעומק', null, true);
  s4.append(el('p', 'adm-note',
    'נצבר מכל הזמנים ולא מושפע מבחירת הטווח. סייג חשוב: תרגול חופשי ו„הטעויות שלי" ' +
    'לא שומרים את המסיח שנבחר — פילוח המסיחים משקף מענה במבחנים בלבד, בעוד אחוזי ' +
    'הטעות (מ-seen) מכסים הכול. רצפת פרטיות: נתון ברמת שאלה/מבחן מוצג רק מ-10 עונים ומעלה.'));
  const qBox = el('div'), eBox = el('div'), shBox = el('div');
  s4.append(qBox, eBox, shBox);
  view.append(s4);

  // ── השאלות שנופלים בהן ──
  section(qBox, async (box) => {
    const [stats, content] = await Promise.all([
      rpc(C.admin.questionStats(10, 25)),
      admLoadContent(),
    ]);
    const card = admCard('🧗 השאלות שהכי נופלים בהן',
      'לפי המצב האחרון של כל משתמש (seen) · ממוין מהקשה לקלה');
    if (!stats || !stats.length) {
      card.append(el('p', 'adm-empty', 'עוד אין שאלה שענו עליה 10 משתמשים.'));
      box.append(card);
      return;
    }
    let breakdown = {};
    try {
      const rows = await rpc(C.admin.answerBreakdown(stats.map((r) => r.qid), 10));
      (rows || []).forEach((r) => { (breakdown[r.qid] = breakdown[r.qid] || []).push(r); });
    } catch { /* בלי פילוח — הרשימה עצמה עדיין שווה הצגה */ }

    stats.forEach((r, rank) => {
      const pct = Math.round((r.wrong / r.attempts) * 100);
      const info = content.byQid.get(r.qid);
      const det = el('details', 'adm-q');
      const sum = el('summary', 'adm-q-sum');

      const pcts = el('span', 'adm-q-pct' + (pct >= 60 ? ' bad' : pct >= 40 ? ' warn' : ''), pct + '%');
      pcts.title = `${r.wrong} מתוך ${r.attempts} — המצב האחרון שלהם בשאלה הוא טעות`;
      sum.append(el('span', 'rank-i', String(rank + 1)));
      sum.append(pcts);

      const txt = el('span', 'adm-q-txt');
      if (info) {
        txt.append(el('b', null, (info.q.q || '').slice(0, 90) + ((info.q.q || '').length > 90 ? '…' : '')));
        txt.append(el('span', 'adm-q-src', `${info.courseName} · ${info.examTitle} · ${r.attempts} ענו`));
      } else {
        txt.append(el('b', null, `שאלה ${r.qid}`));
        txt.append(el('span', 'adm-q-src', `לא נמצאה בארכיון (הוסרה?) · ${r.attempts} ענו`));
      }
      sum.append(txt);

      /* מתחת ל-25% הצלחה — גרוע מניחוש אקראי בשאלת 4 מסיחים. כך נמצאו
         ידנית שתי טעויות המפתח הקודמות; עכשיו זה צף מעצמו. */
      if (100 - pct < 25) sum.append(el('span', 'adm-flag', '🚨 חשד למפתח שגוי'));

      if (info) {
        const link = el('a', 'adm-q-link', 'לשאלה ↗');
        link.href = '#/q/' + r.qid;
        link.onclick = (e) => e.stopPropagation();
        sum.append(link);
      }
      det.append(sum);

      /* גוף: פילוח המסיחים. rulingA — הכרעת תוכן גוברת על מפתח שגוי במקור. */
      const body = el('div', 'adm-q-body');
      const bd = breakdown[r.qid];
      if (info && bd) {
        const q = rulingA(info.q);
        const total = bd.reduce((s, x) => s + Number(x.n), 0);
        const byChoice = {};
        bd.forEach((x) => { byChoice[x.choice] = Number(x.n); });
        const topWrong = Object.entries(byChoice)
          .filter(([c]) => Number(c) !== q.a)
          .sort((x, y) => y[1] - x[1])[0];
        (q.opts || []).forEach((opt, oi) => {
          const n = byChoice[oi] || 0;
          const p = total ? Math.round((n / total) * 100) : 0;
          const isC = oi === q.a;
          const isTrap = topWrong && Number(topWrong[0]) === oi && p >= 35;
          const row = el('div', 'adm-opt' + (isC ? ' correct' : isTrap ? ' trap' : ''));
          const bar = el('div', 'adm-opt-bar');
          const f = el('i'); f.style.width = p + '%';
          bar.append(f);
          row.append(bar);
          row.append(el('span', 'adm-opt-n', `${p}% · ${n}`));
          row.append(el('span', 'adm-opt-t', (isC ? '✓ ' : isTrap ? '🪤 ' : '') + opt));
          body.append(row);
        });
        body.append(el('p', 'adm-hint',
          `${total} בחירות במבחנים.` +
          (topWrong && Math.round((topWrong[1] / total) * 100) >= 35
            ? ' המסיח 🪤 מושך שליש ומעלה — כנראה תפיסה שגויה משותפת, חומר למלכודת במפה.'
            : '')));
      } else {
        body.append(el('p', 'adm-empty',
          info ? 'אין פילוח מסיחים — פחות מ-10 ענו עליה בתוך מבחן (תרגול חופשי לא שומר את הבחירה).'
               : 'אין תוכן להצגת מסיחים.'));
      }
      det.append(body);
      card.append(det);
    });
    box.append(card);
  });

  // ── ציונים ונטישה לפי מבחן ──
  section(eBox, async (box) => {
    const [stats, content] = await Promise.all([
      rpc(C.admin.examStats(10)),
      admLoadContent(),
    ]);
    const card = admCard('🎯 ציונים ונטישה לפי מבחן',
      'התפלגות ציונים מוצגת רק כשיש 10 מסיימים');
    const rows = (stats || []).filter((r) => content.exams.has(r.exam_id));
    if (!rows.length) {
      card.append(el('p', 'adm-empty', 'עוד אין נתוני מבחנים בענן.'));
      box.append(card);
      return;
    }
    rows.slice(0, 15).forEach((r) => {
      const meta = content.exams.get(r.exam_id);
      const row = el('div', 'adm-exam');
      const t = el('a', 'adm-exam-t', meta.title);
      t.href = '#/exam/' + r.exam_id;
      row.append(t);
      const drop = Number(r.zero) || 0;
      row.append(el('span', 'adm-exam-s',
        `${meta.course} · ${r.started} התחילו · ${r.finished} סיימו` +
        (drop ? ` · ${drop} פתחו ולא ענו` : '')));

      if (r.hist && meta.scored) {
        /* היסטוגרמת correct → אחוזים לפי מספר השאלות שנספרות בציון. */
        const buckets = [0, 0, 0, 0, 0];   // ‹60 / 60–69 / 70–79 / 80–89 / 90+
        let sum = 0, cnt = 0;
        Object.entries(r.hist).forEach(([c, n]) => {
          const p = (Number(c) / meta.scored) * 100;
          sum += p * n; cnt += n;
          buckets[p >= 90 ? 4 : p >= 80 ? 3 : p >= 70 ? 2 : p >= 60 ? 1 : 0] += n;
        });
        const avg = cnt ? Math.round(sum / cnt) : 0;
        const dist = el('div', 'adm-dist');
        dist.append(el('b', 'adm-dist-avg' + (avg >= 80 ? ' good' : avg < 60 ? ' bad' : ''), `ממוצע ${avg}%`));
        const labels = ['‹60', '60–69', '70–79', '80–89', '90+'];
        buckets.forEach((n, i) => {
          const seg = el('span', 'adm-dist-b b' + i, `${labels[i]}: ${n}`);
          if (!n) seg.classList.add('zero');
          dist.append(seg);
        });
        row.append(dist);
      } else if (Number(r.finished) > 0) {
        row.append(el('span', 'adm-hint', 'פחות מ-10 מסיימים — אין התפלגות (פרטיות).'));
      }
      card.append(row);
    });
    if (rows.length > 15) card.append(el('p', 'adm-hint', `מוצגים 15 מתוך ${rows.length} מבחנים (לפי מספר מתחילים).`));
    box.append(card);
  });

  // ── בריאות השינון ──
  section(shBox, async (box) => {
    const o = await rpc(C.admin.shinunHealth());
    const card = admCard('🧠 בריאות השינון', 'קופסאות לייטנר · כל המשתמשים יחד');
    if (!o || !o.users) {
      card.append(el('p', 'adm-empty',
        'אף פריט שינון לא הגיע לענן. אם יש משתמשים פעילים בשינון — זה סימן לתקלת סנכרון (ר׳ בריאות תפעולית).'));
      box.append(card);
      return;
    }
    card.append(el('p', 'adm-ops-stat',
      `👤 ${o.users} משתמשים · 🗂️ ${o.items} פריטים מדורגים · ` +
      `🐌 ${o.stuck} תקועים בקופסה 0 שבועיים ומעלה`));
    const boxes = o.boxes || {};
    card.append(axisChart([0, 1, 2, 3].map((b) => ({
      label: 'קופסה ' + b,
      vals: [Number(boxes[b] || 0)],
      tip: `קופסה ${b} · ${Number(boxes[b] || 0)} פריטים`,
    })), { colors: ['accent'] }));
    card.append(el('p', 'adm-hint',
      'קופסה 3 = יודעים; קופסה 0 = בתחילת הדרך. הרבה פריטים תקועים ב-0 = חומר שכדאי לפשט או לפצל.'));
    box.append(card);
  });

  /* ── סדר הקומות: append חוזר מזיז ב-DOM, אפס שינוי בלוגיקת הטעינה ──
     קומה 1 "מה קורה עכשיו": קהילה + מגמות (גרפים יומיים/שעתיים + החמים).
     קומה 2 "מה דורש טיפול": דיווחים.
     קומה 3 (מקופלת): תפעול לעומק, בריאות תוכן, סקר. */
  [s1, s3, sR, s2, s4, sSv].forEach((s) => view.append(s));

  toTop();
  updateFooter();
}

/* מזהה target → שם קריא. 'course:electro' → 'אלקטרו', 'exam:<id>' → כותרת המבחן.
   מסלול בלי פרמטר (target='course' בלי ':') מקבל תווית כללית — בעבר זה
   רינדר '📚 undefined'. */
function prettyTarget(target, type) {
  if (!target) return type;
  const [kind, id] = String(target).split(':');
  if (id === undefined) {
    const plain = {
      course: '📚 עמוד מקצוע', exam: '📄 מבחן', sim: '🎛️ סימולציה', drill: '🧮 תרגיל',
      practice: '🏋️ תרגול', review: '🎯 טעויות', guide: '🗺️ מפה', traps: '🪤 מלכודות',
      shinun: '🧠 שינון', cards: '📇 כרטיסיות', case: '🩺 מקרים', formulas: '🧾 נוסחאות',
    };
    return plain[kind] || target;
  }
  const cName = (x) => { const c = courseOf(x); return c ? c.name : x; };
  const eTitle = (x) => { const e = EXAMS.find((v) => v.id === x); return e ? e.title : x; };
  if (kind === 'course')   return '📚 ' + cName(id);
  if (kind === 'exam')     return '📄 ' + eTitle(id);
  if (kind === 'sim')      return '🎛️ סימולציה: ' + id;
  if (kind === 'drill')    return '🧮 תרגיל: ' + id;
  if (kind === 'practice') return '🏋️ תרגול: ' + cName(id);
  if (kind === 'review')   return '🎯 טעויות: ' + cName(id);
  if (kind === 'guide')    return '🗺️ מפה: ' + cName(id);
  if (kind === 'traps')    return '🪤 מלכודות: ' + cName(id);
  if (kind === 'shinun')   return '🧠 שינון: ' + cName(id);
  if (kind === 'cards')    return '📇 כרטיסיות: ' + eTitle(id);
  if (kind === 'case')     return '🩺 מקרים: ' + eTitle(id);
  if (kind === 'keyer')    return '🔑 מפתח ההגדרה: ' + eTitle(id);
  if (kind === 'formulas') return '🧾 נוסחאות: ' + cName(id);
  if (kind === 'sheet')    return '📄 דף נוסחאות: ' + cName(id);
  return target;
}

/* תאריך קצר לגרפים: '15/07'. מקבל 'YYYY-MM-DD' מ-Postgres. */
function fmtDay(d) {
  const s = String(d);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}` : s;
}

/* הצעת התחברות בדף הבית — רק למי שעוד לא התחבר, פעם אחת. */
const LOGIN_NUDGE_KEY = 'shichzurim.loginNudge';
function loginBanner() {
  const C = window.Cloud;
  if (!C || !C.enabled || C.user) return null;
  if (localStorage.getItem(LOGIN_NUDGE_KEY)) return null;

  const b = el('div', 'intro cloud-nudge');
  const txt = el('div');
  txt.append(el('b', null, '☁️ ההתקדמות שלך שמורה רק בדפדפן הזה'));
  txt.append(el('span', null, 'התחברות עם Google מגבה אותה, וממשיכה אותה מכל מכשיר — טלפון, מחשב, ספרייה.'));
  b.append(txt);

  const acts = el('div', 'btn-row');
  acts.append(googleLoginBtn('התחברות עם Google'));
  const later = el('button', 'btn ghost', 'אולי אחר כך');
  later.title = 'סגירת התזכורת — לא תופיע שוב';
  later.onclick = () => { localStorage.setItem(LOGIN_NUDGE_KEY, '1'); b.remove(); };
  acts.append(later);
  b.append(acts);
  return b;
}

/* בקשת שם חד-פעמית — למי שמחובר ועדיין לא בחר שם. ממולא מראש בשם מגוגל,
   כך שזה אישור בלחיצה, לא מילוי מאפס. */
const NAME_ASKED_KEY = 'shichzurim.nameAsked';
function namePrompt() {
  const C = window.Cloud;
  if (!C || !C.enabled || !C.user || C.user.namedByUser) return null;
  if (localStorage.getItem(NAME_ASKED_KEY)) return null;

  const b = el('div', 'intro name-prompt');
  const txt = el('div');
  txt.append(el('b', null, '👋 איך שנקרא לך?'));
  txt.append(el('span', null, 'כדי שנפנה אליך בשם. אפשר לשנות בכל רגע בעמוד החשבון.'));
  b.append(txt);

  const acts = el('div', 'btn-row');
  const input = el('input', 'name-input');
  input.type = 'text';
  input.value = C.user.firstName || '';
  input.maxLength = 40;
  input.setAttribute('aria-label', 'השם שלך');
  acts.append(input);
  const save = el('button', 'btn primary', 'שמור');
  save.title = 'שמירת השם בחשבון — אפשר לשנות בעמוד החשבון';
  const done = () => {
    const v = input.value.trim();
    localStorage.setItem(NAME_ASKED_KEY, '1');
    if (v) window.Cloud?.setName(v);   // cloud:user יגרום ל-router לרנדר מחדש עם השם
    b.remove();
    router();
  };
  save.onclick = done;
  input.onkeydown = (e) => { if (e.key === 'Enter') done(); };
  acts.append(save);
  b.append(acts);
  return b;
}

/* כפתור החשבון ב-topbar: "התחברות" כשמנותקים, עיגול עם אות כשמחוברים. */
function updateAccountBtn() {
  const btn = document.getElementById('accountBtn');
  if (!btn) return;
  const C = window.Cloud;
  if (!C || !C.enabled) { btn.hidden = true; return; }
  btn.hidden = false;
  if (C.user) {
    btn.textContent = (C.user.name || C.user.email || '?').trim().charAt(0).toUpperCase();
    btn.classList.add('in');
    btn.title = C.user.email;
    btn.onclick = () => { location.hash = '#/account'; };
  } else {
    btn.textContent = 'התחברות';
    btn.classList.remove('in');
    btn.title = 'התחברות עם Google';
    btn.onclick = () => C.login();
  }
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
const TOUR_KEY = 'shichzurim.tourDone.v4';   // .v4 — סיור פתיחת השנה: קצר וממוקד; קופץ אוטומטית לכל מי שעוד לא ראה אותו

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
  const courseRoute = cid ? '#/course/' + cid : '#/';
  /* מבחן להדגמה — השחזור הראשון של מקצוע הסיור. עליו נדגים משוב ומצב-מבחן. */
  const demoExam = cid ? ((examsOf(cid) || []).find((e) => e.kind === 'shichzur') || {}).id : null;

  /* v4 — קצר וממוקד: שישה צעדים, תוך דקה מסיימים. נכתב לנכנסים החדשים של
     תחילת השנה — מה שחשוב זה המסלול (קורס → תרגול → משוב), לא כל פיצ׳ר. */
  const steps = [
    { route: '#/', center: true,
      title: '🎉 ברוכים הבאים לארכיון השחזורים!',
      body: 'כל המבחנים האמיתיים של המחזור, עם הסבר לכל שאלה ומעקב אחרי מה שטעיתם. ' +
            'דקה אחת של סיור — ואתם יודעים להשתמש בהכול. אפשר לדלג בכל רגע.' },
    { route: '#/', sel: '[data-tour="course"]',
      title: '🎨 בוחרים מקצוע — וזה כל מה שצריך',
      body: 'כל מקצוע בצבע שלו, והטבעת מראה כמה אתם מוכנים. כל מה שיש למקצוע — ' +
            'שחזורים, תרגול, סיכומים — מחכה בפנים.' },
    { route: courseRoute, sel: '[data-tour="practice"]',
      title: '🏋️ תרגול — הלב של האתר',
      body: 'בוחרים נושאים וכמות — או פשוט מתחילים. השאלות מעורבבות מכל המבחנים, ' +
            'וכל טעות נאספת אוטומטית ל"הטעויות שלי" לסבב חוזר.' },
  ];

  /* הדגמה חיה אחת — עונים שאלה אמיתית כדי שהמשוב יופיע. */
  if (demoExam) {
    steps.push(
      { route: '#/exam/' + demoExam, sel: '.q .fb.show',
        before: async () => {
          const opt = await waitFor('.q .opt', 2500);
          const q = opt && opt.closest('.q');
          if (opt && q && !q.classList.contains('done')) opt.click();
        },
        title: '✍️ עונים — ולומדים מיד',
        body: 'לחצנו תשובה בשבילכם: ירוק/אדום מיד, הסבר מתחת, וקישורים להמשך למידה. ' +
              'מתג <b>מצב מבחן</b> למעלה מסתיר את המשוב עד הסוף — לתרגול בתנאי אמת.' },
    );
  }

  steps.push(
    { route: courseRoute, sel: '.bnav, .topnav',
      title: '🧭 איפה הכול נמצא',
      body: 'הסרגל הזה איתכם בכל מסך: בית · הקורס · תרגול · חיפוש · חשבון. ' +
            'החיפוש (🔍) מגיע לכל שאלה, נקודה במפה וסיכום בארכיון.' },
    { route: '#/', center: true,
      title: '✅ זהו — בהצלחה!',
      body: 'יש עוד הרבה בפנים (מפות, לומדות, שינון, סימולציות) — הכול מוסבר בעמוד ' +
            '"איך זה עובד", והסיור הזה מחכה שם אם תרצו שוב. 🚀' },
  );

  return steps;
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

let tourStop = null;

async function startTour() {
  if (tourStop) return;                       // כבר רץ
  localStorage.setItem(SEEN_KEY, '1');
  localStorage.setItem(TOUR_KEY, '1');        // מסומן כ"נראה" כבר עכשיו — קופץ פעם אחת, גם אם מדלגים באמצע
  const steps = tourSteps();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let i = 0;
  let curTarget = null;   // היעד שכבר אותר לשלב הנוכחי — place משתמש בו במקום לשאול שוב (מונע מרוץ)

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
    let t = step.center ? null : curTarget;
    /* אם היעד השמור התנתק או עוד לא נפרס (rect אפס) — שואלים מחדש. הסרגל הדביק
       בעמוד המבחן נפרס לפעמים רגע אחרי המדידה. */
    if (t && step.sel && !t.getBoundingClientRect().width) {
      const q = document.querySelector(step.sel);
      if (q) t = curTarget = q;
    }
    if (!t) {
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
    const navigated = step.route && (location.hash || '#/') !== step.route;
    if (navigated) location.hash = step.route;

    /* אחרי ניווט נותנים לרנדרר לצייר (מסכי מבחן/מפה טוענים קבצים). מבחן איטי
       יותר, אז ממתינים לו קצת יותר. */
    if (navigated || step.before) await sleep(step.route && step.route.startsWith('#/exam') ? 320 : 130);

    /* hook אופציונלי: מדגים בפועל — למשל עונה על שאלה כדי שהמשוב יופיע, ואז
       העוגן של השלב (.fb) קיים באמת. */
    if (step.before) { try { await step.before(); } catch (e) { /* לא נתקע על דמו */ } }

    if (step.sel) {
      const t = await waitFor(step.sel);
      /* שלב שהעוגן שלו לא קיים (מקצוע בלי מפה, למשל) — מדלגים הלאה בשקט
         במקום להצביע על כלום. קריאה ל-run ולא ל-go: אנחנו כבר בתוך הנעילה,
         ו-go היה חוסם את עצמו והסיור היה נתקע על השלב החסר. */
      if (!t) return i + 1 < steps.length ? run(i + 1) : end();
      curTarget = t;   // שומרים את היעד — place ישתמש בו, בלי לשאול מחדש
      /* גלילה מיידית (לא חלקה) — מדויקת ובלי ריצוד. setTimeout ולא rAF: rAF
         לא רץ כשהלשונית מוסתרת, ואז הסיור היה נתקע לנצח. delay קצר מספיק
         לפריסה מחדש אחרי הגלילה. יעד בסרגל דביק (step.top) — גוללים לראש
         העמוד במקום, אחרת scrollIntoView נלחם בהצמדה והזרקור נוחת גבוה מדי. */
      if (step.top) window.scrollTo(0, 0);
      else t.scrollIntoView({ block: 'center', behavior: 'auto' });
      await sleep(70);
    } else {
      curTarget = null;
      await sleep(50);
    }
    draw(step);
    place(step);
    /* מיקום שני אחרי שהפריסה נחה — תופס מקרים שבהם היעד (סרגל דביק, תוכן
       שנטען) קיבל את גודלו רק רגע אחרי הציור הראשון. */
    if (step.sel) setTimeout(() => { if (i === n) place(step); }, 300);
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
    skip.title = 'יציאה מהסיור — אפשר לחזור אליו מעמוד „אודות”';
    skip.onclick = end;
    row.append(skip);

    const right = el('div', 'tour-nav');
    if (i > 0) { const b = el('button', 'btn ghost', 'הקודם'); b.title = 'חזרה לצעד הקודם'; b.onclick = () => go(i - 1); right.append(b); }
    const nx = el('button', 'btn primary', i === steps.length - 1 ? 'סיימנו' : 'הבא');
    nx.title = i === steps.length - 1 ? 'סגירת הסיור' : 'הצעד הבא בסיור';
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
  /* קוראים מ-#view (ולא מהשורש) כי שם יושב data-course שממפה --accent לצבע
     המקצוע — כך גרפי ה-canvas של הסימולציה צבועים כמו שאר עמוד המקצוע. */
  const cs = getComputedStyle(document.getElementById('view') || document.documentElement);
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
  /* noYTicks / noXTicks — לגרף קטגוריאלי (עמודות עם שמות) המספרים על הציר רק מבלבלים. */
  if (!o.noYTicks) ticks(o.yMin, o.yMax).forEach((t) => {
    const y = Math.round(sy(t)) + 0.5;
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
    ctx.textAlign = 'right';
    ctx.fillText(num(t), x0 - 8, y);
  });
  if (!o.noXTicks) ticks(o.xMin, o.xMax).forEach((t) => {
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

/* מלבן מעוגל בקנבס — roundRect לא קיים בכל הדפדפנים שהסטודנטים מביאים. */
function rrect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y); ctx.lineTo(x + w - rr, y); ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr); ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr); ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
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
      { label: 'גירוי בודד', cls: 'primary', tip: 'הגרלת גירוי אחד והוספתו להיסטוגרמה', run: () => { quantalDraw(st, p, 1); refresh(); } },
      { label: '×50', cls: '', tip: 'הגרלת 50 גירויים בבת אחת', run: () => { quantalDraw(st, p, 50); refresh(); } },
      { label: '×200', cls: '', tip: 'הגרלת 200 גירויים בבת אחת', run: () => { quantalDraw(st, p, 200); refresh(); } },
      { label: 'אפס', cls: 'ghost', tip: 'מחיקת כל הגירויים שנצברו', run: () => { st.trials = []; refresh(); } },
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
  /* ═══════════ עקרונות המדע ב׳ — פרמקולוגיה ═══════════ */
  {
    id: 'pk-curve',
    course: 'ekronot-b',
    icon: '💊',
    title: 'עקומת ריכוז-זמן — מנה, פינוי ומצב יציב',
    blurb: 'מנה, F, נפח התפזרות ופינוי — ואיך מגיעים למצב יציב בארבעה זמני מחצית חיים',
    topics: ['פיזור, מטבוליזם ופינוי', 'ספיגה ודרכי מתן'],
    insight: 'הורידו את הפינוי בחצי (כשל כליות): זמן מחצית החיים מוכפל, הריכוז במצב יציב מוכפל — וגם הזמן להגיע אליו. ' +
             'עכשיו הכפילו את המנה במקום: המצב היציב עולה, אבל הזמן להגיע אליו לא זז. זו בדיוק ההבחנה שהמאגר שואל עליה.',
    params: [
      { k: 'D', label: 'מנה', unit: 'mg', min: 25, max: 1000, step: 25, val: 200, group: 'המתן' },
      { k: 'F', label: 'זמינות ביולוגית F (פומי)', unit: '', min: 0.1, max: 1, step: 0.05, val: 0.6, group: 'המתן' },
      { k: 'tau', label: 'מרווח בין מנות τ', unit: 'h', min: 4, max: 48, step: 2, val: 12, group: 'המתן' },
      { k: 'ka', label: 'קצב ספיגה ka (פומי)', unit: '1/h', min: 0.2, max: 3, step: 0.1, val: 1, group: 'המתן' },
      { k: 'V', label: 'נפח התפזרות V', unit: 'L', min: 5, max: 300, step: 5, val: 40, group: 'המטופל' },
      { k: 'CL', label: 'פינוי CL', unit: 'L/h', min: 0.5, max: 40, step: 0.5, val: 4, group: 'המטופל' },
      { k: 'winLo', label: 'סף החלון התרפויטי', unit: 'mg/L', min: 0.5, max: 20, step: 0.5, val: 2, group: 'החלון התרפויטי' },
      { k: 'winHi', label: 'סף הרעילות', unit: 'mg/L', min: 1, max: 40, step: 0.5, val: 8, group: 'החלון התרפויטי' },
    ],
    togglesTitle: 'דרך המתן',
    toggles: [
      { k: 'iv', label: 'מתן תוך-ורידי (בולוס: F=1, בלי שלב ספיגה)' },
      { k: 'load', label: 'מנת העמסה במנה הראשונה' },
    ],
    run: (p) => {
      const k = p.CL / p.V;                                // קבוע הפינוי
      const t12 = Math.LN2 / k;
      const F = p.iv ? 1 : p.F;
      const css = (F * p.D) / (p.CL * p.tau);              // ריכוז ממוצע במצב יציב
      const loadDose = (css * p.V) / F;                    // D* = Css·V (מתוקן ל-F)
      const one = (t) => {                                 // מנה בודדת, t בשעות
        if (t < 0) return 0;
        if (p.iv || Math.abs(p.ka - k) < 1e-6) return (F * p.D / p.V) * Math.exp(-k * t);
        return ((F * p.D * p.ka) / (p.V * (p.ka - k))) * (Math.exp(-k * t) - Math.exp(-p.ka * t));
      };
      const conc = (t) => {                                // סופרפוזיציה של כל המנות עד t
        let c = 0;
        for (let n = 0; n * p.tau <= t; n++) {
          const d = one(t - n * p.tau);
          c += p.load && n === 0 ? d * (loadDose / p.D) : d;
        }
        return c;
      };
      const T = Math.min(240, Math.max(48, 6 * t12));
      const pts = [];
      for (let i = 0; i <= 480; i++) { const t = (i / 480) * T; pts.push([t, conc(t)]); }
      const T1 = Math.min(T, 5 * t12 + 12);
      const single = [];
      for (let i = 0; i <= 240; i++) { const t = (i / 240) * T1; single.push([t, one(t)]); }
      const peak = single.reduce((a, b) => (b[1] > a[1] ? b : a), single[0]);
      return { k, t12, css, pts, single, T, peak, tss: 3.3 * t12, auc: (F * p.D) / p.CL, loadDose, F };
    },
    readouts: (p, r) => [
      { v: num(r.t12) + ' h', label: 't½ = 0.693·V/CL', cls: 'accent' },
      { v: num(r.tss) + ' h', label: 'זמן ל-90% מצב יציב (≈3.3·t½)', cls: '' },
      { v: num(r.css) + ' mg/L', label: 'Css ממוצע = F·D/(CL·τ)', cls: r.css > p.winHi || r.css < p.winLo ? 'bad' : 'good' },
      { v: num(r.auc) + ' mg·h/L', label: 'AUC למנה = F·D/CL', cls: '' },
      { v: num(r.loadDose) + ' mg', label: 'מנת העמסה = Css·V/F', cls: '' },
    ],
    panels: [
      {
        label: 'מנה בודדת — פומי (עלייה ואז ירידה) מול ורידי (ירידה מיידית), ואיפה Cmax',
        h: 220,
        draw: (g, p, C, st, r) => {
          const yMax = Math.max(r.peak[1] * 1.2, p.winHi * 1.1, 1);
          plot(g, {
            C, xMin: 0, xMax: r.single[r.single.length - 1][0], yMin: 0, yMax, xLabel: 'זמן (שעות)', yLabel: 'ריכוז (mg/L)',
            series: [{ pts: r.single, color: C.accent, width: 2.4 }],
            marks: [{ y: p.winLo, color: C.good, label: 'סף תרפויטי' }, { y: p.winHi, color: C.bad, label: 'רעילות' }],
            dots: p.iv ? [] : [{ x: r.peak[0], y: r.peak[1], color: C.warn, label: 'Cmax' }],
          });
        },
      },
      {
        label: 'מנות חוזרות — הצטברות עד מצב יציב',
        h: 260,
        draw: (g, p, C, st, r) => {
          const yMax = Math.max(...r.pts.map((q) => q[1]), p.winHi) * 1.15;
          plot(g, {
            C, xMin: 0, xMax: r.T, yMin: 0, yMax, xLabel: 'זמן (שעות)', yLabel: 'ריכוז (mg/L)',
            series: [{ pts: r.pts, color: C.accent, width: 2.2 }],
            marks: [
              { y: p.winLo, color: C.good, label: 'סף תרפויטי' },
              { y: p.winHi, color: C.bad, label: 'רעילות' },
              { y: r.css, color: C.warn, dash: [2, 3], label: 'Css ממוצע' },
            ],
            dots: [{ x: Math.min(r.tss, r.T), y: r.css, color: C.warn, label: '≈90% מצב יציב' }],
          });
        },
      },
    ],
  },

  {
    id: 'dose-response',
    course: 'ekronot-b',
    icon: '📈',
    title: 'עקומת מינון-תגובה — אגוניסטים ואנטגוניסטים',
    blurb: 'מי מזיז את העקומה ימינה ומי מוריד את התקרה — פוטנטיות מול יעילות',
    topics: ['פרמקודינמיקה'],
    insight: 'הוסיפו אנטגוניסט תחרותי: העקומה זזה ימינה אבל התקרה נשארת (אפשר להתגבר עם עוד אגוניסט). ' +
             'אפסו, וחסמו 50% מהרצפטורים לא-תחרותית: התקרה יורדת. עכשיו הוסיפו „רצפטורים עודפים” — התקרה חוזרת, ' +
             'כי מספיק חלק מהרצפטורים כדי לקבל תגובה מלאה. ואגוניסט חלקי? הורידו את הפעילות הפנימית.',
    params: [
      { k: 'ec50', label: 'EC50 של האגוניסט', unit: 'µM', min: 0.1, max: 30, step: 0.1, val: 3, group: 'האגוניסט' },
      { k: 'alpha', label: 'פעילות פנימית α (1 = אגוניסט מלא, פחות = חלקי)', unit: '', min: 0.1, max: 1, step: 0.05, val: 1, group: 'האגוניסט' },
      { k: 'nH', label: 'תלילות (מקדם היל)', unit: '', min: 0.5, max: 3, step: 0.1, val: 1, group: 'האגוניסט' },
      { k: 'B', label: 'אנטגוניסט תחרותי [B]', unit: 'µM', min: 0, max: 30, step: 0.5, val: 0, group: 'אנטגוניסטים' },
      { k: 'KB', label: 'זיקת האנטגוניסט KB', unit: 'µM', min: 0.2, max: 10, step: 0.2, val: 2, group: 'אנטגוניסטים' },
      { k: 'nc', label: 'חסימה לא-תחרותית (% מהרצפטורים)', unit: '%', min: 0, max: 90, step: 5, val: 0, group: 'אנטגוניסטים' },
      { k: 'spare', label: 'רצפטורים עודפים (% שאפשר לאבד ועדיין לקבל Emax)', unit: '%', min: 0, max: 80, step: 5, val: 0, group: 'המערכת' },
    ],
    run: (p) => {
      const ratio = 1 + p.B / p.KB;                                          // יחס המינון של שילד
      const f = p.nc / 100, r = p.spare / 100;
      /* חסימה לא-תחרותית מורידה תקרה — אלא אם יש רזרבת רצפטורים שסופגת אותה;
         כל עוד הרזרבה סופגת, העקומה רק זזה ימינה. */
      const emax = 100 * p.alpha * Math.min(1, (1 - f) / (1 - r));
      const ec50app = p.ec50 * ratio * (r > 0 ? 1 / (1 - Math.min(f, r)) : 1);
      const curve = (E, ec, n) => {
        const pts = [];
        for (let i = 0; i <= 160; i++) { const x = -2 + (i / 160) * 5; const c = Math.pow(10, x); pts.push([x, (E * Math.pow(c, n)) / (Math.pow(ec, n) + Math.pow(c, n))]); }
        return pts;
      };
      return { ec50app, emax, ratio, base: curve(100, p.ec50, p.nH), cur: curve(emax, ec50app, p.nH) };
    },
    readouts: (p, r) => [
      { v: num(r.ec50app) + ' µM', label: 'EC50 נראה — פוטנטיות (שמאלה = פוטנטי יותר)', cls: 'accent' },
      { v: num(r.emax, 0) + '%', label: 'Emax נראה — יעילות (התקרה)', cls: r.emax < 99 ? 'bad' : 'good' },
      { v: num(r.ratio), label: 'יחס מינון 1 + [B]/KB', cls: '' },
    ],
    panels: [
      {
        label: 'תגובה כנגד log הריכוז — מקווקו: אגוניסט מלא לבדו',
        h: 280,
        draw: (g, p, C, st, r) => {
          plot(g, {
            C, xMin: -2, xMax: 3, yMin: 0, yMax: 105, xLabel: 'log₁₀ ריכוז האגוניסט (µM)', yLabel: 'תגובה (% מהמרבי)',
            series: [{ pts: r.base, color: C.dim, width: 1.8, dash: [5, 4] }, { pts: r.cur, color: C.accent, width: 2.6 }],
            marks: [{ y: 50, color: C.lineSoft, dash: [2, 4] }],
            dots: [{ x: Math.log10(r.ec50app), y: r.emax / 2, color: C.warn, label: 'EC50' }],
            legend: [{ color: C.dim, label: 'אגוניסט מלא לבדו' }, { color: C.accent, label: 'המצב שבחרת' }],
          });
        },
      },
    ],
  },

  /* ═══════════ עקרונות המדע ב׳ — גנטיקה ═══════════ */
  {
    id: 'hardy-weinberg',
    course: 'ekronot-b',
    icon: '🧬',
    title: 'הרדי-ויינברג — משכיחות המחלה לסיכון בייעוץ',
    blurb: 'שכיחות המחלה ← שורש ← כפול שתיים = נשאים; ואז הסיכון לזוג, לפי מי במשפחה חולה',
    topics: ['גנטיקה של אוכלוסיות'],
    insight: 'קבעו מחלה של 1:2,500 (CF): הנשאים הם 1:25. עכשיו „אח חולה”: בן הזוג נשא ב-2/3 ולא ב-1/2 — ' +
             'כי האפשרות שהוא חולה בעצמו כבר ירדה. הסיכון לילד: 2/3 × 1/25 × 1/4 = 1:150. ' +
             'הזיזו את השכיחות פי 100 וראו: הנשאים זזים רק פי 10, כי זה שורש.',
    params: [
      { k: 'logN', label: 'שכיחות המחלה 1:N (סליידר לוגריתמי: 2 = 1:100 … 6 = 1:1,000,000)', unit: '', min: 2, max: 6, step: 0.05, val: 3.4, group: 'האוכלוסייה' },
    ],
    togglesTitle: 'מי במשפחה',
    toggles: [
      { k: 'sib', label: 'לבן/בת הזוג הראשון יש אח או אחות חולים (נשא ב-2/3)' },
      { k: 'child', label: 'בן/בת הזוג הראשון הם ילד של חולה (נשא ודאי)' },
      { k: 'sib2', label: 'גם לשני יש אח או אחות חולים' },
    ],
    run: (p) => {
      const N = Math.pow(10, p.logN);
      const q2 = 1 / N, q = Math.sqrt(q2), pp = 1 - q, carriers = 2 * pp * q;
      const c1 = p.child ? 1 : p.sib ? 2 / 3 : carriers;
      const c2 = p.sib2 ? 2 / 3 : carriers;
      return { N, q, pp, q2, carriers, c1, c2, risk: c1 * c2 * 0.25 };
    },
    readouts: (p, r) => {
      const inv = (x) => '1:' + Math.round(1 / x).toLocaleString('en-US');
      return [
        { v: inv(r.q2), label: 'שכיחות המחלה q²', cls: '' },
        { v: inv(r.q), label: 'שכיחות האלל q = √(q²)', cls: 'accent' },
        { v: inv(r.carriers), label: 'נשאים 2pq ≈ 2q', cls: 'good' },
        { v: inv(r.risk), label: 'סיכון לילד חולה = c₁ · c₂ · ¼', cls: 'bad' },
      ];
    },
    panels: [
      {
        label: '100 אנשים מהאוכלוסייה — הנשאים בכתום (חולה יש בערך אחד על כל N)',
        h: 150,
        draw: (g, p, C, st, r) => {
          const { ctx, w, h } = g;
          ctx.clearRect(0, 0, w, h); ctx.direction = 'ltr';
          const cols = 25, rows = 4, cell = Math.min((w - 40) / cols, (h - 44) / rows);
          const x0 = (w - cols * cell) / 2, y0 = 10;
          const nCar = Math.round(r.carriers * 100);
          for (let i = 0; i < 100; i++) {
            const cx = x0 + (i % cols) * cell, cy = y0 + Math.floor(i / cols) * cell;
            ctx.fillStyle = i < nCar ? C.warn : C.surface2; ctx.strokeStyle = C.line;
            rrect(ctx, cx + 2, cy + 2, cell - 4, cell - 4, 3); ctx.fill(); ctx.stroke();
          }
          ctx.fillStyle = C.muted; ctx.font = '700 12px ' + FONT; ctx.textAlign = 'center';
          ctx.fillText(`${nCar} נשאים מתוך 100 · חולה אחד על כל ${Math.round(r.N).toLocaleString('en-US')} אנשים`, w / 2, h - 10);
        },
      },
      {
        label: 'הסיכון לילד חולה — לפי מי במשפחה חולה (סקאלה לוגריתמית: כל מדרגה = פי 10)',
        h: 240,
        draw: (g, p, C, st, r) => {
          const bars = [
            ['שני', 'זרים', (r.carriers * r.carriers) / 4],
            ['אח/ות של', 'חולה + זר', ((2 / 3) * r.carriers) / 4],
            ['ילד של', 'חולה + זר', r.carriers / 4],
            ['שניהם', 'אחים של חולים', (2 / 3) * (2 / 3) / 4],
            ['המצב', 'שבחרת', r.risk],
          ];
          /* 1:9 לצד 1:2,600 — בסקאלה ליניארית העמודות הקטנות נעלמות. לוג שומר על הסדר וגם על הנראות. */
          const lg = (v) => Math.log10(1 / v);
          const yMax = Math.max(...bars.map((b) => lg(b[2]))) + 0.8;
          const o = plot(g, {
            C, xMin: 0, xMax: bars.length, yMin: 0, yMax, padL: 24, padR: 10, noXTicks: true, noYTicks: true,
            bars: bars.map((b, i) => ({ x: i + 0.5, w: 0.62, y: yMax - lg(b[2]), color: i === bars.length - 1 ? C.accent : C.dim })),
          });
          const { ctx } = g;
          ctx.font = '700 10.5px ' + FONT; ctx.textAlign = 'center';
          bars.forEach((b, i) => {
            const top = o.sy(yMax - lg(b[2]));
            ctx.fillStyle = C.text; ctx.fillText('1:' + Math.round(1 / b[2]).toLocaleString('en-US'), o.sx(i + 0.5), top - 8);
            ctx.fillStyle = C.muted; ctx.fillText(b[0], o.sx(i + 0.5), o.yB + 12); ctx.fillText(b[1], o.sx(i + 0.5), o.yB + 25);
          });
        },
      },
    ],
  },

  /* ═══════════ עקרונות המדע ב׳ — פיזיולוגיה של הלב ═══════════ */
  {
    id: 'cardiac-ap',
    course: 'ekronot-b',
    icon: '🫀',
    title: 'פוטנציאל הפעולה בלב — חוסמים על הפאזות, מתווכים על הקוצב',
    blurb: 'TTX, נימודיפין, אמיודרון ולידוקאין על סיב פורקינייה; קטכולאמינים ו-ACh על שיפוע הקוצב',
    topics: ['תעלות יונים וזרמים בלב', 'פוטנציאל פעולה ותקופה רפרקטורית', 'רקמות מהירות מול איטיות'],
    insight: 'חסמו 60% מ-IKs (אמיודרון): הפלאטו מתארך, וגם התקופה הרפרקטורית ו-QT. אפסו, וחסמו 60% מתעלות הסידן (נימודיפין): ' +
             'הפלאטו מתקצר. ואז חסמו נתרן (TTX): ה-upstroke נחלש ומהירות ההולכה יורדת — הפלאטו כמעט לא זז. ' +
             'בקוצב: גררו את ה-cAMP לצד הקטכולאמינים — שיפוע פאזה 4 תלול יותר, הסף מגיע מהר יותר, הקצב עולה.',
    params: [
      { k: 'na', label: 'חסימת תעלות נתרן מהירות (TTX)', unit: '%', min: 0, max: 90, step: 5, val: 0, group: 'חוסמים — סיב פורקינייה' },
      { k: 'ca', label: 'חסימת תעלות סידן L (נימודיפין)', unit: '%', min: 0, max: 90, step: 5, val: 0, group: 'חוסמים — סיב פורקינייה' },
      { k: 'ks', label: 'חסימת IKs (אמיודרון)', unit: '%', min: 0, max: 90, step: 5, val: 0, group: 'חוסמים — סיב פורקינייה' },
      { k: 'late', label: 'חסימת זרם הנתרן המתמשך (לידוקאין)', unit: '%', min: 0, max: 100, step: 5, val: 0, group: 'חוסמים — סיב פורקינייה' },
      { k: 'camp', label: 'cAMP בקוצב: −1 = ואגוס/ACh … +1 = קטכולאמינים', unit: '', min: -1, max: 1, step: 0.1, val: 0, group: 'הקוצב (SA node)' },
    ],
    run: (p) => {
      /* מודל פנומנולוגי, לא הודג׳קין-האקסלי: כל פאזה נבנית מהמוליכות שנשארה.
         מספיק כדי לראות מי מאריך, מי מקצר ומי מחליש — וזה מה שהמאגר שואל. */
      const gNa = 1 - p.na / 100, gCa = 1 - p.ca / 100, gKs = 1 - p.ks / 100, gLate = 1 - p.late / 100;
      /* הקוצב: שיפוע פאזה 4 ∝ cAMP (If + ICa-T). הקצב נגזר מכמה זמן לוקח להגיע לסף. */
      const slope = 0.0314 * (1 + 0.45 * p.camp);                    // mV/ms
      const rise = 20 / slope;                                        // מ-−60 ל-−40
      const clSA = rise + 220;
      const hr = 60000 / clSA;
      const sa = [];
      for (let i = 0; i <= 500; i++) {
        const t = (i / 500) * 2 * clSA, u = t % clSA;
        let v;
        if (u < rise) v = -60 + slope * u;
        else if (u < rise + 120) v = -40 + 55 * Math.sin((Math.PI * (u - rise)) / 120);   // upstroke איטי (סידן), לא חד
        else v = -40 - 20 * ((u - rise - 120) / 100);
        sa.push([t, v]);
      }
      /* פורקינייה */
      const build = (gNa, gCa, gKs, gLate) => {
        const dvdt = 1500 * gNa;                                      // V/s — פאזה 0
        const peak = -90 + 120 * Math.sqrt(gNa);
        const rate = Math.max(0.6, Math.min(1, 1 - (hr - 70) / 250)); // בקצב מהיר פוטנציאל הפעולה מתקצר
        const up = 120 / dvdt;                                        // ms
        const pl = 180 * (0.55 + 0.45 * gCa) * (0.8 + 0.2 * gLate) / (0.45 + 0.55 * gKs) * rate;
        const p3 = (60 / (0.4 + 0.6 * gKs)) * rate;
        const V = (t) => {
          if (t < 0) return -90;
          if (t < up) return -90 + (peak + 90) * (t / up);
          const t1 = t - up;
          if (t1 < 15) return peak - 20 * (t1 / 15);                  // פאזה 1 — Ito
          const t2 = t1 - 15;
          if (t2 < pl) return peak - 20 - 20 * (t2 / pl);             // פאזה 2 — הפלאטו יורד לאט
          const t3 = t2 - pl;
          return -90 + (peak - 40 + 90) * Math.exp((-3 * t3) / p3);   // פאזה 3
        };
        let erp = 0;
        for (let t = up + 15; t < clSA; t += 1) { if (V(t) <= -60) { erp = t; break; } }
        return { V, dvdt, peak, apd: up + 15 + pl + p3, erp };
      };
      const cur = build(gNa, gCa, gKs, gLate), base = build(1, 1, 1, 1);
      const T = 2 * clSA, pts = [], bpts = [];
      for (let i = 0; i <= 700; i++) { const t = (i / 700) * T; pts.push([t, cur.V(t % clSA)]); bpts.push([t, base.V(t % clSA)]); }
      return { hr, cl: clSA, sa, pts, bpts, ...cur, qt: cur.apd * 1.15, T };
    },
    readouts: (p, r) => [
      { v: num(r.dvdt, 0) + ' V/s', label: 'מהירות פאזה 0 — קובעת את מהירות ההולכה', cls: 'accent' },
      { v: num(r.apd, 0) + ' ms', label: 'משך פוטנציאל הפעולה', cls: '' },
      { v: num(r.erp, 0) + ' ms', label: 'תקופה רפרקטורית (עד −60 mV, כשתעלות הנתרן חוזרות)', cls: r.erp > 320 ? 'bad' : 'good' },
      { v: num(r.qt, 0) + ' ms', label: 'QT משוער', cls: r.qt > 380 ? 'bad' : '' },
      { v: num(r.hr, 0) + ' /min', label: 'קצב הקוצב', cls: '' },
    ],
    panels: [
      {
        label: 'סיב פורקינייה — שתי פעימות (מקווקו: ברירת המחדל, בלי חוסמים)',
        h: 280,
        draw: (g, p, C, st, r) => {
          plot(g, {
            C, xMin: 0, xMax: r.T, yMin: -100, yMax: 50, xLabel: 'זמן (ms)', yLabel: 'Vm (mV)',
            series: [{ pts: r.bpts, color: C.dim, width: 1.6, dash: [5, 4] }, { pts: r.pts, color: C.accent, width: 2.4 }],
            marks: [{ y: -60, color: C.warn, label: '−60: תעלות הנתרן חוזרות להיות זמינות' }, { y: 0, color: C.lineSoft, dash: [2, 4] }],
          });
        },
      },
      {
        label: 'SA node — פוטנציאל הקוצב: שיפוע פאזה 4 קובע מתי מגיעים לסף, ולכן את הקצב',
        h: 220,
        draw: (g, p, C, st, r) => {
          plot(g, {
            C, xMin: 0, xMax: r.sa[r.sa.length - 1][0], yMin: -70, yMax: 30, xLabel: 'זמן (ms)', yLabel: 'Vm (mV)',
            series: [{ pts: r.sa, color: C.good, width: 2.4 }],
            marks: [{ y: -40, color: C.warn, label: 'סף — נפתחות תעלות סידן' }, { y: -60, color: C.dim, label: 'הנקודה השלילית ביותר (אין מנוחה אמיתית)' }],
          });
        },
      },
    ],
  },

  {
    id: 'ecg-dipole',
    course: 'ekronot-b',
    icon: '📉',
    title: 'הדיפול של האק״ג — למה השיא הוא בחצי הדרך',
    blurb: 'גל האקסיטציה מתפשט בסינציטיום, והרישום הוא ההפרש בין מה שכבר עבר למה שעוד לא',
    topics: ['אק"ג', 'הפרעות קצב'],
    insight: 'גררו את ההתקדמות ל-50%: הרישום בשיא. ל-100%: אפס — כל הרקמה באותו מצב, וזה מקטע ST האיזואלקטרי. ' +
             'הפעילו איסכמיה: בזמן ה-ST נשאר הפרש בין הרקמה הבריאה בפלאטו לאזור הפגוע — ST elevation. ' +
             'ומה אם הרפולריזציה הייתה מתחילה מהאנדוקרד? ה-T היה מתהפך.',
    params: [
      { k: 'prog', label: 'התקדמות גל האקסיטציה בסינציטיום', unit: '%', min: 0, max: 100, step: 1, val: 50, group: 'הגל' },
      { k: 'isch', label: 'אזור איסכמי (% מהדופן)', unit: '%', min: 0, max: 40, step: 5, val: 0, group: 'איסכמיה' },
    ],
    togglesTitle: 'ניסוי מחשבתי',
    toggles: [{ k: 'endo', label: 'רפולריזציה מהאנדוקרד (במקום מהאפיקרד) — מה היה קורה ל-T' }],
    run: (p) => {
      const x = p.prog / 100;
      const dip = 4 * x * (1 - x);                                    // הדיפול מקסימלי כשחצי בדפולריזציה
      const isch = p.isch / 100;
      const T = 800, pts = [];
      for (let i = 0; i <= 400; i++) {
        const t = (i / 400) * T;
        const bump = (c, w, a) => a * Math.exp(-((t - c) * (t - c)) / (2 * w * w));
        let v = bump(120, 22, 0.18);                                    // P
        v += -bump(288, 5, 0.12) + bump(300, 7, 1) - bump(314, 5, 0.25); // QRS
        v += (p.endo ? -1 : 1) * bump(520, 40, 0.3);                    // T
        if (isch > 0 && t > 320 && t < 470) v += (0.35 * isch) / 0.4;   // ST elevation
        if (isch > 0 && (t < 280 || t > 600)) v -= (0.1 * isch) / 0.4;  // TP מונמך
        pts.push([t, v]);
      }
      return { x, dip, isch, pts, T };
    },
    readouts: (p, r) => [
      { v: num(r.dip * 100, 0) + '%', label: 'עוצמת הדיפול הנרשם', cls: 'accent' },
      { v: r.x < 0.02 ? 'הכול במנוחה' : r.x > 0.98 ? 'הכול בפלאטו' : 'גל בתנועה', label: 'מצב הסינציטיום', cls: '' },
      { v: r.isch ? 'ST elevation' : 'איזואלקטרי', label: 'מקטע ST', cls: r.isch ? 'bad' : 'good' },
    ],
    panels: [
      {
        label: 'הסינציטיום (משמאל: כבר עבר, מימין: עוד במנוחה) — והמתח שהאלקטרודה רואה',
        h: 180,
        draw: (g, p, C, st, r) => {
          const { ctx, w, h } = g;
          ctx.clearRect(0, 0, w, h); ctx.direction = 'ltr';
          const x0 = 30, x1 = w - 30, y0 = 22, bh = 54;
          ctx.fillStyle = C.surface2; ctx.strokeStyle = C.line;
          rrect(ctx, x0, y0, x1 - x0, bh, 10); ctx.fill(); ctx.stroke();
          const xf = x0 + (x1 - x0) * r.x;
          if (r.x > 0) { ctx.fillStyle = C.accent; rrect(ctx, x0, y0, xf - x0, bh, 10); ctx.fill(); }
          if (r.isch) { ctx.fillStyle = C.bad; rrect(ctx, x1 - (x1 - x0) * r.isch, y0, (x1 - x0) * r.isch, bh, 10); ctx.fill(); }
          ctx.font = '700 11.5px ' + FONT;
          ctx.fillStyle = C.accent; ctx.textAlign = 'left'; ctx.fillText('◼ דפולריזציה (−)', x0, y0 + bh + 16);
          ctx.fillStyle = C.muted; ctx.textAlign = 'right'; ctx.fillText('מנוחה (+) ◻', x1, y0 + bh + 16);
          if (r.isch) { ctx.fillStyle = C.bad; ctx.textAlign = 'center'; ctx.fillText('◼ איסכמי — תקוע', (x0 + x1) / 2, y0 + bh + 16); }
          const my = y0 + bh + 44;
          ctx.strokeStyle = C.line; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(x0, my); ctx.lineTo(x1, my); ctx.stroke();
          const mx = x0 + (x1 - x0) * r.dip;
          ctx.fillStyle = C.good; ctx.beginPath(); ctx.arc(mx, my, 7, 0, 7); ctx.fill();
          ctx.fillStyle = C.text; ctx.font = '800 12px ' + FONT;
          ctx.fillText(`מתח נרשם: ${num(r.dip * 100, 0)}% מהמרבי`, w / 2, my + 24);
        },
      },
      {
        label: 'הרישום — P, PQ, QRS, ST, T',
        h: 220,
        draw: (g, p, C, st, r) => {
          plot(g, {
            C, xMin: 0, xMax: r.T, yMin: -0.5, yMax: 1.2, xLabel: 'זמן (ms)', yLabel: 'mV',
            series: [{ pts: r.pts, color: r.isch ? C.bad : C.accent, width: 2.4 }],
            marks: [{ y: 0, color: C.lineSoft, dash: [2, 4] }],
            dots: [
              { x: 120, y: 0.22, color: C.dim, label: 'P' }, { x: 300, y: 1.05, color: C.dim, label: 'R' },
              { x: 520, y: p.endo ? -0.34 : 0.34, color: C.dim, label: 'T' },
              { x: 400, y: r.isch ? 0.42 : 0.06, color: C.warn, label: 'ST' },
            ],
          });
        },
      },
    ],
  },

  /* ═══════════ עקרונות המדע א׳ — אימונולוגיה ═══════════ */
  {
    id: 'clonal',
    course: 'ekronot-a',
    icon: '🛡️',
    title: 'הסלקציה בתימוס — רפרטואר מול אוטואימוניות',
    blurb: 'הזיזו את סף הסלקציה השלילית וראו מה קורה לתאי ה-T הנאיביים, ל-Tregs ולסיכון לאוטואימוניות',
    topics: ['הפעלת תאי T וסבילות'],
    insight: 'העלו את סף הסלקציה השלילית („עכבר סלחן”): יותר תאים שקושרים עצמי חזק בורחים לפריפריה — אוטואימוניות. ' +
             'הורידו אותו: בטוח יותר, אבל הרפרטואר מצטמק וגם ה-Tregs נעלמים. ' +
             'והעלו את סף הסלקציה החיובית: תאים שלא מזהים MHC בכלל מתים מהזנחה — לא מאפופטוזיס מכוון.',
    params: [
      { k: 'lo', label: 'סף הסלקציה החיובית (זיקה מינימלית ל-MHC — מתחתיה: מוות מהזנחה)', unit: '', min: 0.5, max: 3, step: 0.1, val: 1.2, group: 'הספים' },
      { k: 'hi', label: 'סף הסלקציה השלילית (זיקה לעצמי שמעליה — אפופטוזיס)', unit: '', min: 2, max: 8, step: 0.1, val: 5, group: 'הספים' },
      { k: 'treg', label: 'רוחב חלון ה-Tregs (ממש מתחת לסף השלילי)', unit: '', min: 0, max: 2, step: 0.1, val: 0.8, group: 'הספים' },
    ],
    run: (p) => {
      const pdf = (a) => Math.exp(-Math.pow(Math.log(a / 2.2), 2) / (2 * 0.55 * 0.55)) / a;   // התפלגות זיקה סכמטית
      let tot = 0, neglect = 0, naive = 0, tregs = 0, deleted = 0, esc = 0;
      const bars = [];
      for (let a = 0.1; a <= 10; a += 0.1) {
        const m = pdf(a) * 0.1; tot += m;
        if (a < p.lo) neglect += m;
        else if (a >= p.hi) deleted += m;
        else if (a >= p.hi - p.treg) tregs += m;
        else naive += m;
        if (a >= 3.5 && a < p.hi - p.treg) esc += m;                    // קושרי-עצמי חזקים שיצאו כנאיביים
        bars.push([a, pdf(a)]);
      }
      return { neglect: neglect / tot, naive: naive / tot, tregs: tregs / tot, deleted: deleted / tot, esc: esc / tot, bars };
    },
    readouts: (p, r) => [
      { v: num(r.naive * 100, 0) + '%', label: 'תאי T נאיביים — הרפרטואר שיוצא לפריפריה', cls: 'good' },
      { v: num(r.tregs * 100, 0) + '%', label: 'Tregs — כמעט-עצמי שהופנה לבלימה', cls: 'accent' },
      { v: num(r.deleted * 100, 0) + '%', label: 'נמחקו בסלקציה שלילית', cls: '' },
      { v: num(r.neglect * 100, 0) + '%', label: 'מתו מהזנחה (לא זיהו MHC)', cls: '' },
      { v: num(r.esc * 100, 1) + '%', label: 'קושרי-עצמי חזקים שיצאו כנאיביים — הסיכון לאוטואימוניות', cls: r.esc > 0.1 ? 'bad' : 'good' },
    ],
    panels: [
      {
        label: 'התפלגות הזיקה לעצמי/MHC של התימוציטים — ומה קורה לכל אזור',
        h: 260,
        draw: (g, p, C, st, r) => {
          const o = plot(g, {
            C, xMin: 0, xMax: 10, yMin: 0, yMax: Math.max(...r.bars.map((b) => b[1])) * 1.25, xLabel: 'זיקה ל-MHC + פפטיד עצמי', yLabel: 'מספר תאים',
            bars: r.bars.map(([a, y]) => ({ x: a, w: 0.1, y, color: a < p.lo ? C.lineSoft : a >= p.hi ? C.bad : a >= p.hi - p.treg ? C.accent : C.good })),
            legend: [{ color: C.lineSoft, label: 'הזנחה' }, { color: C.good, label: 'נאיביים' }, { color: C.accent, label: 'Tregs' }, { color: C.bad, label: 'נמחקו' }],
          });
          const { ctx } = g;
          [[p.lo, 'סף חיובי'], [p.hi, 'סף שלילי']].forEach(([x, lb]) => {
            ctx.save(); ctx.strokeStyle = C.warn; ctx.setLineDash([4, 4]); ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(o.sx(x), o.yT + 34); ctx.lineTo(o.sx(x), o.yB); ctx.stroke(); ctx.restore();
            ctx.fillStyle = C.warn; ctx.font = '700 11px ' + FONT; ctx.textAlign = 'center'; ctx.fillText(lb, o.sx(x), o.yT + 27);
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
/* עם מקצוע (s) — רק הסימולציות שנוגעות בנושאים שלו. כך עמוד הפרמקו לא מציג
   את פוטנציאל הפעולה של הלב, ולהפך. */
const simsOf = (courseId, s = null) => SIMS.filter((x) => x.course === courseId && (!s || (x.topics || []).some((t) => (s.topics || []).includes(t))));

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
  if (s.course) view.dataset.course = s.course;
  const c = courseOf(s.course);
  view.innerHTML = '';
  const subj = (s.topics || []).map((t) => subjectOfTopic(s.course, t)).find(Boolean);
  view.append(crumb(subj ? `${c.name} · ${subj.name}` : c ? c.name : 'חזרה', '#/course/' + s.course + (subj ? '/' + encodeURIComponent(subj.key) : '')));

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
      b.title = 'הפעלה או כיבוי של הגורם הזה בסימולציה';
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
  resetBtn.title = 'החזרת כל הסליידרים והמתגים לערכי ההתחלה';
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
      if (b.tip) n.title = b.tip;
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
      a.title = 'שאלות אמת מהמאגר על הנושא הזה';
      a.href = `#/practice/${s.course}/${encodeURIComponent(t)}`;
      row.append(a);
    });
    /* "שחקו עם המשוואה" ו"תרגלו לחשב אותה" הן שתי תשובות לאותו נושא — כאן,
       זו לצד זו. הקישור אוטומטי לפי topic, בדיוק כמו הקישור לתרגול. */
    const drill = s.topics.map((t) => DRILL_BY_TOPIC[t]).find(Boolean);
    if (drill) {
      const da = el('a', 'btn', `🧮 תרגל חישוב — ${drill.title}`);
      da.title = 'תרגיל חישוב עם מספרים מתחלפים ובדיקה מיידית';
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
  fa.title = 'כל הנוסחאות של המקצוע עם הסבר מה כל גודל אומר';
  fa.href = '#/formulas/' + courseId;
  row.append(fa);
  if (sheetOf(courseId)) {
    const sa = el('a', 'btn', '📄 דף הנוסחאות של המבחן');
    sa.title = 'הדף הרשמי שמחולק במבחן — כדאי להתאמן למצוא בו דברים';
    sa.href = '#/sheet/' + courseId;
    row.append(sa);
  }
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
  /* ═══════════ עקרונות המדע ב׳ — פרמקוקינטיקה ═══════════
     שבעת החישובים של הבלוק. כולם נגזרים משלוש זהויות: k = CL/V,
     t½ = 0.693/k, ו-Css = קצב כניסה / CL. הסליידרים בסימולציית pk-curve
     משתמשים באותן נוסחאות בדיוק. */
  {
    id: 'f-auc', course: 'ekronot-b', topic: 'ספיגה ודרכי מתן', icon: '📊',
    title: 'זמינות ביולוגית F מ-AUC', unit: '%', floor: 0.5,
    blurb: 'משווים את השטח מתחת לעקומה פומי מול ורידי — ומתקנים למנה',
    gen: () => ({ Div: dpick([100, 200, 250, 500]), Dpo: dpick([200, 250, 400, 500, 1000]), AUCiv: drnd(20, 80, 1), F: drnd(0.2, 0.9, 0.05) }),
    solve: (v) => v.F * 100,
    prompt: (v) => `תרופה ניתנה תוך-ורידית במנה <b>${v.Div} mg</b> ונמדד AUC של <b>${v.AUCiv} mg·h/L</b>. אותה תרופה ניתנה פומית במנה <b>${v.Dpo} mg</b> ונמדד AUC של <b>${num((v.AUCiv * v.Dpo / v.Div) * v.F)} mg·h/L</b>.<br>מהי הזמינות הביולוגית (באחוזים)?`,
    steps: (v, ans) => [
      `F = (AUC<sub>פומי</sub> / AUC<sub>ורידי</sub>) × (D<sub>ורידי</sub> / D<sub>פומי</sub>) — השטח משקף כמה תרופה הגיעה לדם, אבל צריך לנרמל למנה.`,
      `יחס השטחים: ${num((v.AUCiv * v.Dpo / v.Div) * v.F)} / ${v.AUCiv} = <b>${num((v.Dpo / v.Div) * v.F, 3)}</b>`,
      `תיקון המנה: × ${v.Div}/${v.Dpo} = × ${num(v.Div / v.Dpo, 3)}`,
      `F = <b>${num(ans)}%</b> — מלכודת: אם המנות שוות, יחס השטחים לבדו הוא F; אם לא — חובה לתקן.`,
    ],
  },
  {
    id: 'vd', course: 'ekronot-b', topic: 'פיזור, מטבוליזם ופינוי', icon: '🫙',
    title: 'נפח התפזרות V', unit: 'L', floor: 0.5,
    blurb: 'כמה „נפח” היה צריך כדי שהמנה תיתן את הריכוז שנמדד — נפח מדומה, לא אנטומי',
    gen: () => ({ D: dpick([50, 100, 200, 250, 500]), C0: drnd(0.5, 12, 0.25) }),
    solve: (v) => v.D / v.C0,
    prompt: (v) => `מנה של <b>${v.D} mg</b> ניתנה בבולוס תוך-ורידי. הריכוז בפלזמה, מוחזר לזמן אפס (אקסטרפולציה), הוא <b>${v.C0} mg/L</b>.<br>מהו נפח ההתפזרות?`,
    steps: (v, ans) => [
      `V = D / C₀ — המנה חלקי הריכוז שהיה מתקבל אילו התפזרה מיד.`,
      `V = ${v.D} / ${v.C0} = <b>${num(ans)} L</b>`,
      `אם V גדול בהרבה מנפח הפלזמה (~3 L) או מנוזלי הגוף (~42 L) — התרופה יושבת ברקמות (שומן, קשירה לרקמה), לא בדם.`,
    ],
  },
  {
    id: 'cl', course: 'ekronot-b', topic: 'פיזור, מטבוליזם ופינוי', icon: '🚿', formula: 'cl',
    title: 'פינוי CL מ-V ומ-t½', unit: 'L/h', floor: 0.05,
    blurb: 'הפינוי הוא נפח הפלזמה שמנוקה ליחידת זמן — נגזר מקבוע הפינוי ומהנפח',
    gen: () => ({ V: dpick([10, 20, 35, 40, 50, 70, 100, 140]), t12: dpick([1, 2, 3, 4, 6, 8, 12, 24]) }),
    solve: (v) => (Math.LN2 * v.V) / v.t12,
    prompt: (v) => `נפח ההתפזרות של תרופה הוא <b>${v.V} L</b> וזמן מחצית החיים שלה <b>${v.t12} שעות</b>.<br>מהו הפינוי (CL)?`,
    steps: (v, ans) => [
      `k = 0.693 / t½ = 0.693 / ${v.t12} = <b>${num(Math.LN2 / v.t12, 3)} 1/h</b> — קבוע הפינוי (איזה חלק מהתרופה מתפנה בשעה).`,
      `CL = k · V = ${num(Math.LN2 / v.t12, 3)} × ${v.V} = <b>${num(ans)} L/h</b>`,
      `מלכודת: t½ תלוי גם ב-V וגם ב-CL. תרופה עם V ענק יכולה להיות עם t½ ארוך למרות פינוי מהיר.`,
    ],
  },
  {
    id: 'thalf', course: 'ekronot-b', topic: 'פיזור, מטבוליזם ופינוי', icon: '⏳', formula: 'thalf',
    title: 'זמן מחצית חיים t½', unit: 'h', floor: 0.05,
    blurb: 'מ-V ומ-CL — ומכאן כמה זמן עד מצב יציב, וכמה זמן עד שהתרופה נעלמת',
    gen: () => ({ V: dpick([10, 20, 35, 40, 50, 70, 100, 140, 200]), CL: dpick([0.5, 1, 2, 2.5, 4, 5, 7, 10, 20]) }),
    solve: (v) => (Math.LN2 * v.V) / v.CL,
    prompt: (v) => `נפח ההתפזרות <b>${v.V} L</b>, פינוי <b>${v.CL} L/h</b>.<br>מהו זמן מחצית החיים?`,
    steps: (v, ans) => [
      `t½ = 0.693 · V / CL`,
      `t½ = 0.693 × ${v.V} / ${v.CL} = <b>${num(ans)} h</b>`,
      `ומכאן: ~90% ממצב יציב אחרי 3.3·t½ (≈${num(3.3 * ans)} h), ~97% אחרי 5·t½. הזמן למצב יציב לא תלוי במנה — רק ב-t½.`,
    ],
  },
  {
    id: 'k0', course: 'ekronot-b', topic: 'פיזור, מטבוליזם ופינוי', icon: '💉', formula: 'k0',
    title: 'קצב הזלפה למצב יציב', unit: 'mg/h', floor: 0.05,
    blurb: 'במצב יציב קצב הכניסה שווה לקצב הפינוי — ולכן k₀ = Css · CL',
    gen: () => ({ Css: drnd(0.5, 20, 0.5), CL: dpick([1, 2, 2.5, 3, 4, 5, 6, 8, 10, 12]) }),
    solve: (v) => v.Css * v.CL,
    prompt: (v) => `רוצים להגיע לריכוז יציב של <b>${v.Css} mg/L</b> בהזלפה רציפה. הפינוי של התרופה <b>${v.CL} L/h</b>.<br>מהו קצב ההזלפה הדרוש?`,
    steps: (v, ans) => [
      `במצב יציב: קצב כניסה = קצב יציאה. קצב היציאה = CL · C.`,
      `k₀ = Css · CL = ${v.Css} × ${v.CL} = <b>${num(ans)} mg/h</b>`,
      `שימו לב מה לא בנוסחה: V. הנפח קובע רק כמה זמן ייקח להגיע לשם (דרך t½) — לא את הקצב.`,
    ],
  },
  {
    id: 'load', course: 'ekronot-b', topic: 'פיזור, מטבוליזם ופינוי', icon: '🚀', formula: 'load',
    title: 'מנת העמסה', unit: 'mg', floor: 0.5,
    blurb: 'כשאין זמן לחכות ארבעה זמני מחצית חיים — ממלאים את הנפח בבת אחת',
    gen: () => ({ Css: drnd(1, 20, 0.5), V: dpick([10, 20, 35, 40, 50, 70, 100, 140]), F: dpick([1, 1, 0.5, 0.8, 0.6]) }),
    solve: (v) => (v.Css * v.V) / v.F,
    prompt: (v) => `ריכוז המטרה <b>${v.Css} mg/L</b>, נפח ההתפזרות <b>${v.V} L</b>${v.F < 1 ? `, והתרופה ניתנת פומית עם F=<b>${v.F}</b>` : ', מתן תוך-ורידי'}.<br>מהי מנת ההעמסה?`,
    steps: (v, ans) => [
      `מנת העמסה = Css · V — כמה תרופה צריך כדי „למלא” את נפח ההתפזרות לריכוז המטרה.`,
      `${v.Css} × ${v.V} = <b>${num(v.Css * v.V)} mg</b>` + (v.F < 1 ? ` — אבל רק F=${v.F} מהמנה הפומית מגיע לדם, ולכן מחלקים ב-F: ${num(v.Css * v.V)} / ${v.F} = <b>${num(ans)} mg</b>` : ''),
      `מלכודת: מנת ההעמסה תלויה ב-V ולא ב-CL. הפינוי קובע את מנת ה<b>אחזקה</b>.`,
    ],
  },
  {
    id: 'maint', course: 'ekronot-b', topic: 'פיזור, מטבוליזם ופינוי', icon: '🔁', formula: 'maint',
    title: 'מנת אחזקה פומית', unit: 'mg', floor: 0.5,
    blurb: 'כמה לתת בכל מרווח מתן כדי להחזיק ריכוז ממוצע — עם תיקון ל-F',
    gen: () => ({ Css: drnd(1, 15, 0.5), CL: dpick([1, 2, 2.5, 3, 4, 5, 6, 8]), tau: dpick([6, 8, 12, 24]), F: dpick([0.4, 0.5, 0.6, 0.75, 0.8, 0.9]) }),
    solve: (v) => (v.Css * v.CL * v.tau) / v.F,
    prompt: (v) => `רוצים ריכוז ממוצע במצב יציב של <b>${v.Css} mg/L</b>. פינוי <b>${v.CL} L/h</b>, מתן פומי כל <b>${v.tau} שעות</b>, זמינות ביולוגית F=<b>${v.F}</b>.<br>מהי מנת האחזקה לכל מתן?`,
    steps: (v, ans) => [
      `במצב יציב: F · D / τ = Css · CL (מה שנכנס בממוצע לשעה = מה שמתפנה).`,
      `לכן D = Css · CL · τ / F`,
      `כמות שמתפנה במרווח: ${v.Css} × ${v.CL} × ${v.tau} = <b>${num(v.Css * v.CL * v.tau)} mg</b>`,
      `תיקון ל-F: / ${v.F} = <b>${num(ans)} mg</b> לכל מתן`,
    ],
  },

  /* ═══════════ עקרונות המדע ב׳ — גנטיקה של אוכלוסיות ═══════════ */
  {
    id: 'hw-carriers', course: 'ekronot-b', topic: 'גנטיקה של אוכלוסיות', icon: '🧬', formula: 'hw-carriers',
    title: 'שכיחות נשאים משכיחות המחלה', unit: '(1 ל-…)', floor: 0.5,
    blurb: 'מחלה רצסיבית: שכיחות המחלה = q², הנשאים ≈ 2q — שורש ואז כפול שתיים',
    gen: () => ({ N: dpick([400, 900, 1600, 2500, 3600, 10000, 40000, 90000, 250000]) }),
    solve: (v) => 1 / (2 * Math.sqrt(1 / v.N)),
    prompt: (v) => `מחלה אוטוזומלית רצסיבית מופיעה בשכיחות של <b>1 ל-${v.N.toLocaleString('en-US')}</b> לידות.<br>מהי שכיחות הנשאים באוכלוסייה? (הזינו את N בביטוי „1 ל-N”)`,
    steps: (v, ans) => [
      `q² = 1/${v.N.toLocaleString('en-US')} → q = √(1/${v.N.toLocaleString('en-US')}) = <b>1/${num(Math.sqrt(v.N), 0)}</b>`,
      `נשאים = 2pq ≈ 2q (כי p ≈ 1) = 2/${num(Math.sqrt(v.N), 0)} = <b>1 ל-${num(ans, 0)}</b>`,
      `מלכודת: הנשאים שכיחים הרבה יותר מהחולים — במחלה של 1:${v.N.toLocaleString('en-US')}, אחד מכל ${num(ans, 0)} הוא נשא.`,
    ],
  },
  {
    id: 'hw-risk', course: 'ekronot-b', topic: 'גנטיקה של אוכלוסיות', icon: '👨‍👩‍👧', formula: 'hw-risk',
    title: 'סיכון לזוג — אח בריא של חולה', unit: '(1 ל-…)', floor: 0.5,
    blurb: 'הסיכון שהילד יחלה = (סיכוי שהראשון נשא) × (סיכוי שהשנייה נשאית) × ¼',
    gen: () => ({ N: dpick([400, 900, 1600, 2500, 3600, 10000, 40000]) }),
    solve: (v) => 1 / ((2 / 3) * 2 * Math.sqrt(1 / v.N) * 0.25),
    prompt: (v) => `גבר בריא שאחיו חולה במחלה אוטוזומלית רצסיבית (שכיחות <b>1 ל-${v.N.toLocaleString('en-US')}</b>) מתחתן עם אישה בריאה ללא היסטוריה משפחתית.<br>מה הסיכון שילדם יחלה? (הזינו N בביטוי „1 ל-N”)`,
    steps: (v, ans) => [
      `הגבר: אח של חולה — הוריו שניהם נשאים. הוא <b>בריא</b>, ולכן מבין 3 האפשרויות שנותרו (AA, Aa, aA) הוא נשא ב-<b>2/3</b> — לא 1/2.`,
      `האישה: מהאוכלוסייה — נשאית ב-2q = 2·√(1/${v.N.toLocaleString('en-US')}) = <b>1/${num(Math.sqrt(v.N) / 2, 0)}</b>`,
      `סיכון לילד חולה: 2/3 × 1/${num(Math.sqrt(v.N) / 2, 0)} × 1/4 = <b>1 ל-${num(ans, 0)}</b>`,
    ],
  },
  {
    id: 'hw-multi', course: 'ekronot-b', topic: 'גנטיקה של אוכלוסיות', icon: '🎲', formula: 'hw-multi',
    title: 'הטרוזיגוטים עם אללים מרובים', unit: '%', floor: 0.5,
    blurb: 'עם שלושה אללים — כל ההטרוזיגוטים = 1 פחות סכום ריבועי השכיחויות',
    gen: () => { const a = drnd(0.2, 0.6, 0.05), b = drnd(0.1, 1 - a - 0.1, 0.05); return { a, b, c: +(1 - a - b).toFixed(2) }; },
    solve: (v) => 100 * (1 - (v.a * v.a + v.b * v.b + v.c * v.c)),
    prompt: (v) => `בלוקוס מסוים שלושה אללים בשכיחויות <b>${v.a}</b>, <b>${v.b}</b> ו-<b>${v.c}</b>.<br>איזה אחוז מהאוכלוסייה הטרוזיגוטי בלוקוס הזה (בהנחת שיווי משקל הרדי-ויינברג)?`,
    steps: (v, ans) => [
      `הומוזיגוטים = p² + q² + r² = ${v.a}² + ${v.b}² + ${v.c}² = <b>${num(v.a * v.a + v.b * v.b + v.c * v.c, 3)}</b>`,
      `הטרוזיגוטים = 1 − הומוזיגוטים = <b>${num(ans)}%</b>`,
      `(אפשר גם לסכום 2pq + 2pr + 2qr — אותו מספר, יותר עבודה.)`,
    ],
  },
  {
    id: 'abo', course: 'ekronot-b', topic: 'גנטיקה של אוכלוסיות', icon: '🩸', formula: 'abo',
    title: 'שכיחות סוג דם A מהאללים', unit: '%', floor: 0.5,
    blurb: 'סוג דם A = הומוזיגוטים AA + הטרוזיגוטים AO — כי O רצסיבי',
    gen: () => { const a = drnd(0.15, 0.4, 0.01), b = drnd(0.05, 0.2, 0.01); return { a, b, o: +(1 - a - b).toFixed(2) }; },
    solve: (v) => 100 * (v.a * v.a + 2 * v.a * v.o),
    prompt: (v) => `שכיחות האללים במערכת ABO: I<sup>A</sup>=<b>${v.a}</b>, I<sup>B</sup>=<b>${v.b}</b>, i (O)=<b>${v.o}</b>.<br>איזה אחוז מהאוכלוסייה בעל סוג דם A?`,
    steps: (v, ans) => [
      `סוג דם A מתקבל משני גנוטיפים: AA ו-AO (O רצסיבי; AB הוא סוג דם AB).`,
      `AA = p² = ${v.a}² = <b>${num(v.a * v.a, 4)}</b> · AO = 2pr = 2·${v.a}·${v.o} = <b>${num(2 * v.a * v.o, 4)}</b>`,
      `סוג A = <b>${num(ans)}%</b>`,
    ],
  },
  {
    id: 'bayes', course: 'ekronot-b', topic: 'תורשה מנדלית ולא-מנדלית', icon: '🔮', formula: 'bayes',
    title: 'בייס — בריא בגיל X במחלה מאוחרת', unit: '%', floor: 0.5,
    blurb: 'ילד של חולה הנטינגטון שעדיין בריא — כמה הסיכון שלו ירד עם הגיל',
    gen: () => ({ pen: dpick([30, 40, 50, 60, 70, 80, 90]), age: dpick([40, 45, 50, 55, 60]) }),
    solve: (v) => 100 * (0.5 * (1 - v.pen / 100)) / (0.5 * (1 - v.pen / 100) + 0.5),
    prompt: (v) => `אדם בן <b>${v.age}</b> הוא ילד של חולה במחלה אוטוזומלית דומיננטית מאוחרת. בגיל ${v.age}, <b>${v.pen}%</b> מנושאי הגן כבר חולים. הוא עצמו בריא.<br>מה הסיכוי שהוא נושא את הגן?`,
    steps: (v, ans) => [
      `לפני המידע: ילד של חולה דומיננטי — נשא ב-<b>1/2</b>.`,
      `הראיה: „בריא בגיל ${v.age}”. אם נשא — הסיכוי להיות בריא בגיל זה הוא 1 − ${v.pen}% = <b>${100 - v.pen}%</b>. אם לא נשא — 100%.`,
      `בייס: (½ × ${(100 - v.pen) / 100}) / (½ × ${(100 - v.pen) / 100} + ½ × 1) = ${num(0.5 * (1 - v.pen / 100), 3)} / ${num(0.5 * (1 - v.pen / 100) + 0.5, 3)} = <b>${num(ans)}%</b>`,
      `ככל שהוא מבוגר יותר ובריא — הסיכון יורד. זה ההיגיון של „הבריא בגיל 70 כנראה לא נשא”.`,
    ],
  },

  /* ═══════════ עקרונות המדע ב׳ — מכניקת הלב ═══════════ */
  {
    id: 'ef', course: 'ekronot-b', topic: 'צימוד חשמלי-מכני ומכניקת הכיווץ', icon: '🫀', formula: 'ef',
    title: 'מקטע פליטה EF', unit: '%', floor: 0.5,
    blurb: 'איזה חלק מהנפח הסוף-דיאסטולי נפלט בכל פעימה — המדד של תפקוד החדר',
    gen: () => { const EDV = dpick([100, 110, 120, 130, 140, 160, 180]); return { EDV, ESV: dpick([40, 50, 55, 60, 70, 80].filter((x) => x < EDV)) }; },
    solve: (v) => (100 * (v.EDV - v.ESV)) / v.EDV,
    prompt: (v) => `נפח סוף-דיאסטולי (EDV) <b>${v.EDV} mL</b>, נפח סוף-סיסטולי (ESV) <b>${v.ESV} mL</b>.<br>מהו מקטע הפליטה?`,
    steps: (v, ans) => [
      `נפח פעימה SV = EDV − ESV = ${v.EDV} − ${v.ESV} = <b>${v.EDV - v.ESV} mL</b>`,
      `EF = SV / EDV = ${v.EDV - v.ESV} / ${v.EDV} = <b>${num(ans)}%</b>`,
      `תקין ≈ 55–70%. מלכודת: מחלקים ב-EDV, לא ב-ESV.`,
    ],
  },
  {
    id: 'co', course: 'ekronot-b', topic: 'צימוד חשמלי-מכני ומכניקת הכיווץ', icon: '💓', formula: 'co',
    title: 'תפוקת לב CO', unit: 'L/min', floor: 0.05,
    blurb: 'קצב הלב כפול נפח הפעימה — ולמה טכיקרדיה קיצונית דווקא מורידה אותה',
    gen: () => ({ HR: dpick([50, 60, 70, 80, 90, 100, 120]), EDV: dpick([100, 120, 130, 140, 160]), ESV: dpick([40, 50, 60, 70]) }),
    solve: (v) => (v.HR * (v.EDV - v.ESV)) / 1000,
    prompt: (v) => `קצב לב <b>${v.HR} לדקה</b>, EDV <b>${v.EDV} mL</b>, ESV <b>${v.ESV} mL</b>.<br>מהי תפוקת הלב (בליטרים לדקה)?`,
    steps: (v, ans) => [
      `SV = EDV − ESV = <b>${v.EDV - v.ESV} mL</b>`,
      `CO = HR × SV = ${v.HR} × ${v.EDV - v.ESV} = ${v.HR * (v.EDV - v.ESV)} mL/min = <b>${num(ans)} L/min</b>`,
      `מלכודת: בקצב מהיר מאוד הדיאסטולה מתקצרת, EDV יורד — ו-CO יכול לרדת למרות ש-HR עלה.`,
    ],
  },
];

const drillOf = (id) => DRILLS.find((d) => d.id === id);
const drillsOf = (courseId, s = null) => DRILLS.filter((d) => d.course === courseId && (!s || (s.topics || []).includes(d.topic)));

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
  if (c) view.dataset.course = courseId;
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
  fa.title = 'כל הנוסחאות של המקצוע עם הסבר מה כל גודל אומר';
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
  if (c) view.dataset.course = d.course;
  view.innerHTML = '';
  const subj = subjectOfTopic(d.course, d.topic);   // בבלוק — חזרה לעמוד המקצוע, לא לעמוד הבלוק
  view.append(crumb(subj ? `${c.name} · ${subj.name}` : c ? c.name : 'חזרה', '#/course/' + d.course + (subj ? '/' + encodeURIComponent(subj.key) : '')));

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
  checkBtn.title = 'בדיקת התשובה שהקלדת';
  answerRow.append(input, unit, checkBtn);
  card.append(answerRow);

  const fb = el('div', 'drill-fb');
  card.append(fb);
  view.append(card);

  const acts = el('div', 'btn-row');
  const again = el('button', 'btn', '🎲 תרגיל נוסף');
  again.type = 'button';
  again.title = 'הגרלת תרגיל חדש עם מספרים אחרים';
  acts.append(again);
  const fa = el('a', 'btn ghost', '📖 הנוסחה');
  fa.title = 'כרטיס הנוסחה — ההסבר המלא ודרך השימוש';
  fa.href = `#/formulas/${d.course}/${d.formula || d.id}`;
  acts.append(fa);
  const sim = SIM_BY_TOPIC[d.topic];
  if (sim) {
    const sa = el('a', 'btn ghost', `${sim.icon} סימולציה`);
    sa.title = 'סימולציה אינטראקטיבית של הנושא — לשחק עם המשוואה';
    sa.href = '#/sim/' + sim.id;
    acts.append(sa);
  }
  const pa = el('a', 'btn ghost', '🎯 שאלות אמת בנושא');
  pa.title = 'שאלות מהמאגר על הנושא הזה';
  pa.href = `#/practice/${d.course}/${encodeURIComponent(d.topic)}`;
  acts.append(pa);
  view.append(acts);

  /* שאר התרגילים של המקצוע — צ'יפים, כדי לעבור ביניהם בלי לחזור לעמוד. */
  const sibs = drillsOf(d.course, subj).filter((x) => x.id !== d.id);
  if (sibs.length) {
    const row = el('div', 'drill-sibs');
    row.append(el('span', 'lbl', 'עוד תרגילים:'));
    sibs.forEach((x) => {
      const a = el('a', 'verb-chip', `${x.icon} ${x.title}`);
      a.title = x.blurb;
      a.href = '#/drill/' + x.id;
      row.append(a);
    });
    view.append(row);
  }

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
    id: 'nernst', course: 'electro', sheet: 'nernst', title: 'פוטנציאל נרנסט', unit: 'mV',
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
    id: 'vm', course: 'electro', sheet: 'vmem', title: 'מתח מנוחה — מוליכות מקבילית', unit: 'mV',
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
    id: 'tau', course: 'electro', sheet: 'tau', title: 'קבוע הזמן τ', unit: 'ms',
    expr: 'τ = Rin · Cmem',
    note: 'כמה מהר הממברנה נטענת. MΩ·pF → מחלקים ב-1000 ל-ms.',
    vars: [
      { k: 'Rin', label: 'התנגדות כניסה Rin', unit: 'MΩ', default: 150, step: 5 },
      { k: 'Cm', label: 'קיבול Cmem', unit: 'pF', default: 300, step: 10 },
    ],
    compute: (v) => (v.Rin * v.Cm) / 1000,
  },
  {
    id: 'lambda', course: 'electro', sheet: 'lambda', title: 'קבוע המרחק λ', unit: 'mm',
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
    id: 'rin', course: 'electro', sheet: 'basics', title: 'התנגדות כניסה Rin', unit: 'MΩ',
    expr: 'Rin = ΔV / ΔI',
    note: 'חוק אוהם על ההיסט במצב היציב. mV/nA = MΩ.',
    vars: [
      { k: 'dV', label: 'היסט המתח ΔV', unit: 'mV', default: 30, step: 1 },
      { k: 'dI', label: 'הזרם המוזרק ΔI', unit: 'nA', default: 0.2, step: 0.05 },
    ],
    compute: (v) => v.dV / v.dI,
  },
  {
    id: 'osmo', course: 'electro', sheet: null, title: 'אוסמולריות', unit: 'mOsm',
    expr: 'אוסמולריות = ריכוז × מספר חלקיקים',
    note: 'המלכודת: כמה חלקיקים החומר מתפרק אליהם. NaCl→2 · CaCl₂→3 · AlCl₃→4 · גלוקוז→1.',
    vars: [
      { k: 'C', label: 'ריכוז', unit: 'mM', default: 100, step: 10 },
      { k: 'factor', label: 'חלקיקים לפירוק', options: OSMO_COMPOUNDS.map((c) => ({ label: `${c.name} (${c.n})`, val: c.n })) },
    ],
    compute: (v) => v.C * v.factor,
  },
  {
    id: 'quantal', course: 'electro', sheet: 'quantal', title: 'תכולה קוונטית', unit: 'mV',
    expr: 'תגובה ממוצעת = m·q = (n·p)·q',
    note: 'משרעת התגובה = מספר הווזיקולות × הסתברות שחרור × גודל קוונטום.',
    vars: [
      { k: 'n', label: 'וזיקולות זמינות n', default: 20, step: 1 },
      { k: 'p', label: 'הסתברות שחרור p', default: 0.3, step: 0.05 },
      { k: 'q', label: 'גודל קוונטום q', unit: 'mV', default: 0.4, step: 0.1 },
    ],
    compute: (v) => v.n * v.p * v.q,
  },
  /* ═══════════ עקרונות המדע ב׳ — פרמקוקינטיקה ═══════════ */
  {
    id: 'f-auc', course: 'ekronot-b', sheet: null, title: 'זמינות ביולוגית F', unit: '%',
    expr: 'F = (AUCpo / AUCiv) · (Div / Dpo)',
    note: 'איזה חלק מהמנה הפומית מגיע למחזור הדם. השטח מתחת לעקומה משקף חשיפה — ומנרמלים למנה.',
    vars: [
      { k: 'AUCpo', label: 'AUC פומי', unit: 'mg·h/L', default: 30, step: 1 }, { k: 'AUCiv', label: 'AUC ורידי', unit: 'mg·h/L', default: 50, step: 1 },
      { k: 'Div', label: 'מנה ורידית', unit: 'mg', default: 100, step: 10 }, { k: 'Dpo', label: 'מנה פומית', unit: 'mg', default: 100, step: 10 },
    ],
    compute: (v) => 100 * (v.AUCpo / v.AUCiv) * (v.Div / v.Dpo),
  },
  {
    id: 'vd', course: 'ekronot-b', sheet: null, title: 'נפח התפזרות V', unit: 'L',
    expr: 'V = D / C₀',
    note: 'נפח מדומה: כמה נפח היה דרוש כדי שהמנה תיתן את הריכוז שנמדד. גדול = התרופה ברקמות, לא בדם.',
    vars: [{ k: 'D', label: 'מנה (בולוס IV)', unit: 'mg', default: 200, step: 10 }, { k: 'C0', label: 'ריכוז בזמן 0', unit: 'mg/L', default: 5, step: 0.5 }],
    compute: (v) => v.D / v.C0,
  },
  {
    id: 'cl', course: 'ekronot-b', sheet: null, title: 'פינוי CL', unit: 'L/h',
    expr: 'CL = k · V = 0.693 · V / t½',
    note: 'נפח הפלזמה שמנוקה מהתרופה ליחידת זמן. הפינוי (לא t½) הוא מה שקובע את מנת האחזקה.',
    vars: [{ k: 'V', label: 'נפח התפזרות', unit: 'L', default: 40, step: 5 }, { k: 't12', label: 'זמן מחצית חיים', unit: 'h', default: 7, step: 0.5 }],
    compute: (v) => (Math.LN2 * v.V) / v.t12,
  },
  {
    id: 'thalf', course: 'ekronot-b', sheet: null, title: 'זמן מחצית חיים t½', unit: 'h',
    expr: 't½ = 0.693 · V / CL',
    note: 'תלוי בשניהם: נפח גדול מאריך, פינוי מהיר מקצר. קובע את הזמן למצב יציב (≈4·t½) — לא את גובהו.',
    vars: [{ k: 'V', label: 'נפח התפזרות', unit: 'L', default: 40, step: 5 }, { k: 'CL', label: 'פינוי', unit: 'L/h', default: 4, step: 0.5 }],
    compute: (v) => (Math.LN2 * v.V) / v.CL,
  },
  {
    id: 'k0', course: 'ekronot-b', sheet: null, title: 'קצב הזלפה למצב יציב', unit: 'mg/h',
    expr: 'k₀ = Css · CL',
    note: 'במצב יציב כניסה = יציאה. V לא בנוסחה — הוא קובע רק כמה זמן ייקח להגיע.',
    vars: [{ k: 'Css', label: 'ריכוז המטרה', unit: 'mg/L', default: 5, step: 0.5 }, { k: 'CL', label: 'פינוי', unit: 'L/h', default: 4, step: 0.5 }],
    compute: (v) => v.Css * v.CL,
  },
  {
    id: 'load', course: 'ekronot-b', sheet: null, title: 'מנת העמסה', unit: 'mg',
    expr: 'D* = Css · V / F',
    note: 'ממלאים את נפח ההתפזרות בבת אחת במקום לחכות ארבעה זמני מחצית חיים. תלוי ב-V, לא ב-CL.',
    vars: [{ k: 'Css', label: 'ריכוז המטרה', unit: 'mg/L', default: 5, step: 0.5 }, { k: 'V', label: 'נפח התפזרות', unit: 'L', default: 40, step: 5 }, { k: 'F', label: 'זמינות ביולוגית', default: 1, step: 0.05 }],
    compute: (v) => (v.Css * v.V) / v.F,
  },
  {
    id: 'maint', course: 'ekronot-b', sheet: null, title: 'מנת אחזקה', unit: 'mg',
    expr: 'D = Css · CL · τ / F',
    note: 'כמה לתת בכל מרווח כדי להחליף את מה שהתפנה. תלוי ב-CL, לא ב-V. במתן פומי מחלקים ב-F.',
    vars: [
      { k: 'Css', label: 'ריכוז ממוצע רצוי', unit: 'mg/L', default: 5, step: 0.5 }, { k: 'CL', label: 'פינוי', unit: 'L/h', default: 4, step: 0.5 },
      { k: 'tau', label: 'מרווח מתן', unit: 'h', default: 12, step: 1 }, { k: 'F', label: 'זמינות ביולוגית', default: 0.6, step: 0.05 },
    ],
    compute: (v) => (v.Css * v.CL * v.tau) / v.F,
  },

  /* ═══════════ עקרונות המדע ב׳ — גנטיקה ═══════════ */
  {
    id: 'hw-carriers', course: 'ekronot-b', sheet: null, title: 'נשאים משכיחות המחלה (רצסיבי)', unit: '(1 ל-…)',
    expr: 'q = √(1/N) ;  נשאים ≈ 2q',
    note: 'שכיחות המחלה q² = 1/N. שורש → q. כפול 2 → נשאים (p≈1). התוצאה: אחד מכל כמה הוא נשא.',
    vars: [{ k: 'N', label: 'שכיחות המחלה 1 ל-', default: 2500, step: 100 }],
    compute: (v) => 1 / (2 * Math.sqrt(1 / v.N)),
  },
  {
    id: 'hw-risk', course: 'ekronot-b', sheet: null, title: 'סיכון לזוג (רצסיבי)', unit: '(1 ל-…)',
    expr: 'סיכון = c₁ · c₂ · ¼',
    note: 'c = הסיכוי של כל בן זוג להיות נשא: אח בריא של חולה 2/3; ילד של חולה 1; מהאוכלוסייה 2q.',
    vars: [
      { k: 'c1', label: 'בן זוג 1 — סיכוי נשאות', default: 0.667, step: 0.01, options: [{ label: 'אח/ות בריאים של חולה — 2/3', val: 2 / 3 }, { label: 'ילד של חולה — 1', val: 1 }, { label: 'הורה של חולה — 1', val: 1 }, { label: 'מהאוכלוסייה — 2q (1:25)', val: 0.04 }, { label: 'מהאוכלוסייה — 2q (1:50)', val: 0.02 }] },
      { k: 'c2', label: 'בן זוג 2 — סיכוי נשאות', default: 0.04, step: 0.01, options: [{ label: 'מהאוכלוסייה — 2q (1:25)', val: 0.04 }, { label: 'מהאוכלוסייה — 2q (1:50)', val: 0.02 }, { label: 'אח/ות בריאים של חולה — 2/3', val: 2 / 3 }, { label: 'ילד של חולה — 1', val: 1 }] },
    ],
    compute: (v) => 1 / (v.c1 * v.c2 * 0.25),
  },
  {
    id: 'hw-multi', course: 'ekronot-b', sheet: null, title: 'הטרוזיגוטים — אללים מרובים', unit: '%',
    expr: 'Het = 1 − Σ(pᵢ²)',
    note: 'הומוזיגוטים הם סכום ריבועי השכיחויות; כל השאר הטרוזיגוטים. השכיחויות חייבות להסתכם ל-1.',
    vars: [{ k: 'a', label: 'אלל 1', default: 0.5, step: 0.05 }, { k: 'b', label: 'אלל 2', default: 0.3, step: 0.05 }, { k: 'c', label: 'אלל 3', default: 0.2, step: 0.05 }],
    compute: (v) => 100 * (1 - (v.a * v.a + v.b * v.b + v.c * v.c)),
  },
  {
    id: 'abo', course: 'ekronot-b', sheet: null, title: 'סוג דם A במערכת ABO', unit: '%',
    expr: 'A = p² + 2pr',
    note: 'p = שכיחות I^A, r = שכיחות i (O). סוג דם A = AA + AO. באותו אופן B = q² + 2qr, AB = 2pq, O = r².',
    vars: [{ k: 'a', label: 'I^A', default: 0.3, step: 0.01 }, { k: 'o', label: 'i (O)', default: 0.6, step: 0.01 }],
    compute: (v) => 100 * (v.a * v.a + 2 * v.a * v.o),
  },
  {
    id: 'bayes', course: 'ekronot-b', sheet: null, title: 'בייס — בריא בגיל X (דומיננטי מאוחר)', unit: '%',
    expr: 'P = ½·(1−pen) / (½·(1−pen) + ½)',
    note: 'pen = חלק הנשאים שכבר חולים בגיל הזה. ככל שהאדם מבוגר יותר ובריא, הסיכוי שהוא נשא יורד מ-50%.',
    vars: [{ k: 'pen', label: 'חדירות עד הגיל הזה', unit: '%', default: 60, step: 5 }],
    compute: (v) => (100 * (0.5 * (1 - v.pen / 100))) / (0.5 * (1 - v.pen / 100) + 0.5),
  },

  /* ═══════════ עקרונות המדע ב׳ — מכניקת הלב ═══════════ */
  {
    id: 'ef', course: 'ekronot-b', sheet: null, title: 'מקטע פליטה EF', unit: '%',
    expr: 'EF = (EDV − ESV) / EDV',
    note: 'איזה חלק מהדם שבחדר בסוף הדיאסטולה נפלט. תקין ≈ 55–70%.',
    vars: [{ k: 'EDV', label: 'נפח סוף-דיאסטולי', unit: 'mL', default: 120, step: 5 }, { k: 'ESV', label: 'נפח סוף-סיסטולי', unit: 'mL', default: 50, step: 5 }],
    compute: (v) => (100 * (v.EDV - v.ESV)) / v.EDV,
  },
  {
    id: 'co', course: 'ekronot-b', sheet: null, title: 'תפוקת לב CO', unit: 'L/min',
    expr: 'CO = HR · SV = HR · (EDV − ESV)',
    note: 'כ-5 ליטר לדקה במנוחה. טכיקרדיה קיצונית מקצרת דיאסטולה, מורידה EDV — ו-CO יכול לרדת.',
    vars: [{ k: 'HR', label: 'קצב לב', unit: '/min', default: 70, step: 5 }, { k: 'EDV', label: 'EDV', unit: 'mL', default: 120, step: 5 }, { k: 'ESV', label: 'ESV', unit: 'mL', default: 50, step: 5 }],
    compute: (v) => (v.HR * (v.EDV - v.ESV)) / 1000,
  },
];

/* לנוסחה אין topic משלה — היא יורשת אותו מתרגיל החישוב שמצביע עליה. */
const formulaTopic = (f) => { const d = DRILLS.find((d) => d.course === f.course && (d.formula || d.id) === f.id); return d ? d.topic : null; };
const formulasOf = (courseId, s = null) => FORMULAS.filter((f) => f.course === courseId && (!s || (s.topics || []).includes(formulaTopic(f))));

function renderFormulas(courseId, focusId = null) {
  setNav('home');
  const c = courseOf(courseId);
  if (c) view.dataset.course = courseId;
  /* '@pharma' — היקף מקצוע (כמו בשאר הכלים); כל דבר אחר — נוסחה להתמקד בה. */
  const sKey = scopeKey(focusId);
  const s = sKey ? subjectOf(courseId, sKey) : null;
  if (sKey) focusId = null;
  const list = formulasOf(courseId, s);
  view.innerHTML = '';
  view.append(crumb(s ? `${c.name} · ${s.name}` : c ? c.name : 'חזרה', '#/course/' + courseId + (s ? '/' + encodeURIComponent(s.key) : '')));
  const head = el('div', 'page-head');
  head.append(el('h1', null, s ? `📖 הנוסחאות — ${s.name}` : '📖 כרטיס הנוסחאות'));
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

    /* "האם זה בדף שנותנים לי?" היא שאלה שמשנה איך לומדים. נוסחה שיושבת בדף
       צריך רק לדעת למצוא; נוסחה שאינה בו — לזכור בעל פה. שתיהן מוצהרות. */
    if (sheetOf(courseId)) {
      const sec = f.sheet ? sheetSection(courseId, f.sheet) : null;
      if (sec) box.append(sheetButton(courseId, sec, `📄 בדף הנוסחאות · ${sec.label}`));
      else box.append(el('p', 'formula-nosheet', '⚠︎ לא בדף הנוסחאות — את זה צריך לדעת בעל פה.'));
    }

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
  if (g) {
    g.units.forEach((u) => (GUIDE_BY_TOPIC[u.topic] = { unit: u, course: courseId }));
  }
  return g;
}

/* נושא → יחידה. מתמלא ב-loadGuide, ולכן כל מסך שמציג שאלות טוען את המפה
   לפני playQuestions — אחרת כניסה ישירה ל-#/exam/... לא תראה את הכפתור. */
const GUIDE_BY_TOPIC = {};
const guideOf = (courseId) => EXAMS.find((e) => e.course === courseId && e.kind === 'guide');
/* חפיסת „מפתח ההגדרה” שנוגעת בנושא — מהמניפסט (sync כותב topics לחפיסות keyer),
   ולכן הקישור מיחידת המפה קיים בלי לטעון את החפיסה. */
const keyerFor = (courseId, topic) => EXAMS.find((e) => e.kind === 'keyer' && e.course === courseId && (e.topics || []).includes(topic)) || null;

/* כמה מהנושא אתה כבר יודע. שאלה שלא נענתה נספרת כלא-נשלטת — זו לא החמרה,
   זה בדיוק המצב: לא ידוע אם אתה יודע אותה. */
/* d ו-now מגיעים מבחוץ כדי ש-priorityList יפרסר פעם אחת ולא לכל יחידה בנפרד
   (~30 קריאות בכל רינדור של המפה). ברירת מחדל נשמרה כדי לא לשבור קורא בודד. */
function masteryOf(courseId, topic, d, now) {
  d = d || seenH.read();
  now = now || Date.now();
  let total = 0, correct = 0, strength = 0, tried = 0, firstOk = 0;
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
      const r = seenH.rec(k, d);
      /* correct נשאר "ענית נכון בפעם האחרונה" — זהה בדיוק לחישוב הישן
         (b>=1 ⟺ התשובה האחרונה נכונה), כדי שכל תצוגת "X מתוך Y" בעמוד המפה
         לא תזוז. החידוש יושב לצידו ולא במקומו. */
      if (r && r.b >= 1) correct++;
      if (r && r.n) { tried++; if (r.f) firstOk++; }
      strength += seenH.strength(r, now);
    });
  });
  return {
    total, correct,
    ratio: total ? correct / total : 0,
    /* כמה אתה יודע *עכשיו* — דועך עם הזמן. זה מה שמזין את דירוג העדיפויות,
       במקום ratio שמתקרב ל-100% למי שגמר סבב אחד ולא אומר עליו דבר. */
    strength: total ? strength / total : 0,
    /* דיוק בניסיון הראשון. הכי קרוב שיש למה שיקרה במבחן, שבו אין ניסיון שני. */
    firstTry: tried ? firstOk / tried : 0,
  };
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
  /* פרסור אחד לכל הרשימה במקום אחד לכל יחידה. */
  const d = seenH.read(), now = Date.now();
  return g.units
    .map((u) => {
      const m = masteryOf(courseId, u.topic, d, now);
      /* strength ולא ratio: נושא שנשלט לפני שבוע חוזר לראש הרשימה, וזה
         הנכון — הדירוג אמור לענות "במה כדאי לגעת עכשיו", לא "במה נגעת פעם". */
      return { u, m, score: u.freq * (1 - m.strength) * (CERTAINTY_W[u.certainty] ?? 1) };
    })
    .sort((a, b) => b.score - a.score);
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
  thumb.title = 'ניגון הסרטון כאן בעמוד';
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
function pointsPanel(courseId, u, idx, summaryMode) {
  if (!(u.points || []).length) return null;

  const seenMap = seenH.read();
  const ranked = u.points
    .map((p) => {
      const hits = (p.qids || []).filter((q) => idx[q]).map((q) => ({ qid: q, ...idx[q] }));
      const solid = hits.filter((h) => h.trust !== 'unverified' && h.trust !== 'partial');
      return {
        p, hits,
        moadim: [...new Set(hits.map((h) => h.title))],
        wrong: hits.filter((h) => seenH.isOpenMistake(seenH.rec(h.qid, seenMap))).length,
        /* כל הראיות מגיעות משחזורים שלא אומתו — כלומר הטענה עצמה נשענת על
           מפתחות שאיש לא בדק. תגית על קישור בודד לא מספיקה כאן: ההבדל בין
           "אחת מארבע ראיות רעועה" ל"כל הראיות רעועות" הוא ההבדל בין הערה
           לבין אזהרה. */
        allShaky: hits.length > 0 && solid.length === 0,
      };
    })
    .sort((a, b) => b.hits.length - a.hits.length);

  /* רמת-חשיפה אחת: הכרטיס עצמו מתקפל, ולכן הנקודות הן div ולא details מקונן.
     כשהכרטיס פתוח — הנקודות גלויות בזרימה אחת, בלי אקורדיון-בתוך-אקורדיון. */
  const det = el('div', 'g-points' + (summaryMode ? ' g-points-sum' : ''));
  const nQ = new Set(u.points.flatMap((p) => p.qids || [])).size;
  /* בקורס בלי שחזורים אין "מה נשאל" — הנקודות הן תמצית לחזרה מהירה. */
  det.append(el('div', 'g-points-head', summaryMode
    ? `🎯 תמצית לחזרה מהירה`
    : `📌 מה באמת נשאל — ${ranked.length} נקודות, מתוך ${nQ} שאלות שנשאלו בפועל`));

  /* המסגור הזה הוא של ינון, אחרי שקרא את הפיילוט: **זו החזרה השנייה, לא
     הראשונה.** זה גם מיישב את החשש המתודולוגי — הנקודות נדחסו מהשאלות שבארכיון,
     ולכן הן לא "מלמדות" נושא מאפס; מי שיקרא רק אותן ילמד לענות ולא יבין.
     אבל אחרי שקראת את הסיכום והבנת, "מה מתוך זה באמת נבחן" הוא בדיוק מה
     שחזרה אמורה לעשות. לומר את זה במפורש עדיף על שהלומד יגלה לבד. */
  const lead = el('p', 'g-points-lead');
  lead.textContent = summaryMode
    ? 'לא מקום להתחיל בו — זו החזרה האחרונה. אחרי שלמדת והבנת, רצים על התמצית מהר לפני המבחן, ומוודאים שלא נופלים במלכודות.'
    : 'זה לא תחליף לסיכום, וזה לא מקום להתחיל בו — זו החזרה השנייה. ' +
      'אחרי שקראת את החומר והבנת אותו, כאן רואים מה מתוכו באמת נבחן, כמה פעמים, ואיפה נופלים.';
  det.append(lead);

  /* במצב תמצית: פסקת/שתי-פסקאות סיכום מרוכז לנושא (u.summary), ואז המלכודות
     שנאספו מהנקודות. זו "החזרה שעוברים עליה אחרי שכבר יודעים". */
  if (summaryMode && u.summary) {
    const sum = el('div', 'g-summary');
    u.summary.split('\n\n').forEach((para) => { const pp = el('p'); pp.innerHTML = para; sum.append(pp); });
    det.append(sum);
    const traps = [...new Set(u.points.map((p) => p.trap).filter(Boolean))];
    if (traps.length) {
      const tb = el('div', 'g-traps');
      tb.append(el('div', 'g-traps-lbl', '⚠️ מלכודות נפוצות'));
      traps.forEach((t) => { const d = el('div', 'g-point-trap'); d.innerHTML = '• ' + t; tb.append(d); });
      det.append(tb);
    }
    return det;
  }

  ranked.forEach(({ p, hits, wrong, allShaky }) => {
    const row = el('div', 'g-point');
    row.append(el('div', 'g-point-txt', p.point));

    /* במצב תמצית אין "נשאל X פעמים" (אין מבחן) — רק אם נפלת בתרגול. */
    const meta = el('div', 'g-point-meta');
    if (!summaryMode) {
      meta.append(el('span', 'g-point-n', hits.length === 1 ? 'נשאל פעם אחת' : `נשאל ${hits.length} פעמים`));
      if (allShaky) meta.append(el('span', 'g-point-shaky', '⚠️ אף מפתח כאן לא אומת'));
    }
    if (wrong) meta.append(el('span', 'g-point-bad', `✗ נפלת ב-${wrong}`));
    if (meta.children.length) row.append(meta);

    if (p.trap) {
      const t = el('div', 'g-point-trap');
      t.innerHTML = '<b>המלכודת:</b> ' + p.trap;
      row.append(t);
    }

    /* קישור דו-כיווני בחינם — ה-qids כבר יודעות איפה השאלה יושבת.
       כל קישור נושא את שם המועד שלו, ולכן הוא **גם** הקבלה: אין צורך בשורת
       "נשאל במ״ח · מ״ז · נ׳" נפרדת מעליהם. שורה כזאת הייתה חוזרת על אותו
       מידע בלי להיות לחיצה. */
    if (hits.length && !summaryMode) {
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

/* ---------- קשור גם ל… — הקפיות והדדיות ----------
   ינון (23/09/2026): „שבתוך כל הטירוף של חודשיים לכל כך הרבה חומר, הכל יהיה
   מסודר, נגיש, מקושר — הקפיות והדדיות.” יחידת מפה יכולה להצביע על נושא במקצוע
   אחר (`related[{course, topic, why}]`). הקישור נכתב פעם אחת, והאינדקס כאן
   הופך אותו לדו-כיווני: היעד מציג אותו גם הוא, בלי שמישהו יכתוב אותו פעמיים.
   נטען מכל המפות, בלי לגעת ב-GUIDE_BY_TOPIC (שנושא בו הוא מפתח גלובלי). */
let relatedIdx = null;
async function loadRelated() {
  if (relatedIdx) return relatedIdx;
  const idx = {};
  const add = (k, v) => { (idx[k] ||= []).some((x) => x.course === v.course && x.topic === v.topic) || idx[k].push(v); };
  const metas = EXAMS.filter((e) => e.kind === 'guide');
  const gs = await Promise.all(metas.map((m) =>
    guideCache[m.course] !== undefined ? guideCache[m.course]
      : fetch(`exams/${m.file}?v=${VERSION}`).then((r) => (r.ok ? r.json() : null)).catch(() => null)));
  gs.forEach((g, i) => {
    if (!g) return;
    const from = metas[i].course;
    (g.units || []).forEach((u) => (u.related || []).forEach((r) => {
      if (!r.course || !r.topic) return;
      add(`${from}|${u.topic}`, { course: r.course, topic: r.topic, why: r.why });
      add(`${r.course}|${r.topic}`, { course: from, topic: u.topic, why: r.why });
    }));
  });
  return (relatedIdx = idx);
}

function relatedPanel(courseId, topic) {
  const list = (relatedIdx || {})[`${courseId}|${topic}`];
  if (!list || !list.length) return null;
  const me = courseOf(courseId);
  const box = el('div', 'g-rel');
  box.append(el('div', 'g-lbl', '🔗 קשור גם ל…'));
  list.forEach((r) => {
    const tc = courseOf(r.course);
    const sj = subjectOfTopic(r.course, r.topic);
    const where = sj ? `${sj.icon || ''} ${sj.name}`.trim() : (tc ? `${tc.icon || ''} ${tc.name}`.trim() : r.course);
    /* מקצוע משנה קודמת: "כבר ראית" — זה חומר שהסטודנט כבר למד, לא עוד משהו ללמוד. */
    const earlier = tc && me && tc.year && me.year && tc.year < me.year;
    const a = el('a', 'g-rel-item');
    /* מפה שעוד לא עלתה (עדיין ב-staging) — הקישור מוביל לתרגול הנושא, לא לדף ריק. */
    a.href = guideOf(r.course)
      ? `#/guide/${r.course}/${encodeURIComponent(r.topic)}`
      : `#/practice/${r.course}/${encodeURIComponent(r.topic)}`;
    a.append(el('span', 'g-rel-where', earlier ? `כבר ראית בשנה א׳ · ${where}` : where));
    a.append(el('b', null, r.topic));
    if (r.why) a.append(el('span', 'g-rel-why', r.why));
    box.append(a);
  });
  return box;
}

function unitCard(courseId, g, r, focus, collapsible) {
  const u = r.u;
  const sec = el('section', 'g-unit' + (focus ? ' q-flash' : '') + (collapsible ? ' g-unit-collapsible' : '') + (collapsible && focus ? ' is-open' : ''));
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
  /* במצב מקובץ (בלוקים) הכרטיס מתקפל: הכותרת היא כפתור שפותח/סוגר את הגוף,
     כדי שהמפה תהיה רשימת כותרות קומפקטית ולא גלילה אחת אינסופית. */
  if (collapsible) {
    head.append(el('span', 'g-unit-chev', '⌄'));
    head.title = 'פתיחה או סגירה של פרטי הנושא';
    head.setAttribute('role', 'button');
    head.setAttribute('tabindex', '0');
    const toggle = () => sec.classList.toggle('is-open');
    head.addEventListener('click', toggle);
    head.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    });
  }
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
  const pts = pointsPanel(courseId, u, qIndex(courseId), g.noDayPlan);
  if (pts) body.append(pts);

  const rel = relatedPanel(courseId, u.topic);
  if (rel) body.append(rel);

  if ((u.videos || []).length) {
    body.append(el('div', 'g-lbl', '▶️ סרטונים'));
    const vs = el('div', 'g-vids');
    u.videos.forEach((v) => vs.append(videoCard(v)));
    body.append(vs);
  }

  if ((u.intel || []).length) {
    /* רמת-חשיפה אחת: inline, לא details מקונן בתוך הכרטיס המתקפל. */
    const det = el('div', 'g-intel');
    det.append(el('div', 'g-intel-head', `🔒 מה נאמר בהקלטות (${u.intel.length})`));
    u.intel.forEach((it) => {
      const q = el('div', 'g-quote');
      q.innerHTML = '<span class="g-q">„' + it.quote + '”</span><span class="g-qsrc">📼 ' + it.src + '</span>';
      det.append(q);
    });
    body.append(det);
  }

  const acts = el('div', 'g-acts');
  /* נושא חדש בלי אף שאלה בארכיון (certainty:new, בלי points) — כפתור תרגול
     היה מוביל לרשימה ריקה. אומרים את זה במקום להעמיד פנים. */
  const nQ = new Set((u.points || []).flatMap((p) => p.qids || [])).size;
  if (!nQ && u.certainty === 'new') {
    const none = el('span', 'btn btn-sm is-disabled g-noq', '📭 אין עדיין שאלות על הנושא');
    none.title = 'הנושא נלמד בנ״א, אבל עדיין אין עליו שאלה בארכיון';
    acts.append(none);
  } else {
    const p = el('a', 'btn btn-sm');
    p.href = `#/practice/${courseId}/${encodeURIComponent(u.topic)}`;
    p.textContent = `🏋️ תרגל ${u.topic}`;
    p.title = 'תרגול שאלות אמת בנושא הזה בלבד';
    acts.append(p);
  }
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
  const lab = LAB_BY_TOPIC[u.topic];
  if (lab && lab.course === courseId) {
    const la = el('a', 'btn btn-sm g-sim');
    la.href = lab.route;
    la.textContent = `${lab.icon} ${lab.title}`;
    la.title = lab.blurb;
    acts.append(la);
  }
  const ky = keyerFor(courseId, u.topic);
  if (ky) {
    const ka = el('a', 'btn btn-sm g-sim');
    ka.href = '#/keyer/' + ky.id;
    ka.textContent = `🔑 ${ky.title}`;
    ka.title = ky.heroSub || 'משחק זיהוי מרמזים על הנושא הזה';
    acts.append(ka);
  }
  /* קישור לפרק הנכון בסיכום המלא — אותו עוגן נושא קנוני (top-<topic>),
     בדיוק כמו שהמסמך עצמו מחזיר קישור "במפה". חינם, מונע-דאטה. */
  const sd = studyDocFor(courseId, u.topic);
  if (sd) {
    const da = el('a', 'btn btn-sm g-study');
    da.href = sd.href + '#top-' + encodeURIComponent(u.topic);
    da.textContent = '📖 קרא בסיכום המלא';
    da.title = 'קפיצה ישירה לפרק של הנושא בסיכום המלא';
    acts.append(da);
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
  /* #/guide/<course>/@<מקצוע> — נפתח על הבלוק של המקצוע */
  const focusSubject = subjectOf(courseId, scopeKey(focusTopic));
  if (focusSubject) focusTopic = null;
  view.innerHTML = '<div class="empty"><span class="ico">⏳</span><b>טוען…</b></div>';
  const c = courseOf(courseId);
  if (!c) {
    view.innerHTML = '';
    view.append(emptyState('⚠️', 'מקצוע לא נמצא', 'הקישור כנראה שגוי.'));
    toTop();
    return;
  }
  view.dataset.course = courseId;
  const g = await loadGuide(courseId);
  if (!g) {
    view.innerHTML = '';
    view.append(emptyState('📭', 'אין מפת חומרים למקצוע הזה', 'היא נבנית לכל מקצוע בנפרד.'));
    toTop();
    return;
  }

  /* צריך את השאלות עצמן כדי לספור שליטה לפי נושא — המניפסט מחזיק רק מטא-דאטה. */
  await Promise.all([
    ...quizzesOf(courseId).map((m) => loadExam(m.id).catch(() => null)),
    loadRelated().catch(() => null),
  ]);

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

  const unitsSec = el('section', 'g-units');
  /* בקורס בלי שחזורים אין "משקל במבחן" — פשוט רשימת הנושאים. */
  const unitsH2 = el('h2', 'g-h2', g.noDayPlan ? '📖 כל הנושאים' : '📖 הנושאים');
  unitsSec.append(unitsH2);

  if (g.blocks && g.blocks.length) {
    /* מפה מקובצת: לשוניות לבלוקים (מציג בלוק אחד בכל פעם) + כרטיסים מתקפלים.
       שני סידורים — לפי סדר הלימוד (הבלוקים, כי הם מסודרים לפי ההוראה) או לפי
       נפח במבחן (רשימה שטוחה מדורגת בתדירות). מתג למעלה מחליף ביניהם. */
    const byTopic = {};
    ranked.forEach((r) => { byTopic[r.u.topic] = r; });

    // --- תצוגה: לפי סדר הלימוד (בלוקים בלשוניות) ---
    const studyView = el('div');
    let activeKey = g.blocks[0].key;
    if (focusSubject) {
      const fb = g.blocks.find((bl) => bl.title === focusSubject.block);
      if (fb) activeKey = fb.key;
    }
    if (focusTopic) {
      const fb = g.blocks.find((bl) => (bl.topics || []).includes(focusTopic));
      if (fb) activeKey = fb.key;
    }
    const tabs = el('div', 'g-blocktabs');
    const wrap = el('div', 'g-blocks');
    const covered = new Set();
    g.blocks.forEach((bl) => {
      const units = (bl.topics || []).map((t) => byTopic[t]).filter(Boolean);
      units.forEach((r) => covered.add(r.u.topic));
      const on = bl.key === activeKey;
      const tab = el('button', 'g-blocktab' + (on ? ' is-active' : ''));
      tab.type = 'button';
      tab.title = 'הצגת הנושאים של הבלוק: ' + bl.title;
      tab.dataset.block = bl.key;
      tab.innerHTML = `<span class="g-blocktab-ic">${bl.icon || ''}</span><span>${bl.title}</span><span class="g-blocktab-n">${units.length}</span>`;
      tabs.append(tab);
      const blk = el('div', 'g-block' + (on ? ' is-active' : ''));
      blk.dataset.block = bl.key;
      units.forEach((r) => blk.append(unitCard(courseId, g, r, focusTopic === r.u.topic, true)));
      wrap.append(blk);
    });
    /* רשת ביטחון: נושא שאינו בשום בלוק לא ייעלם — נוסיף אותו לבלוק הפעיל. */
    const orphans = ranked.filter((r) => !covered.has(r.u.topic));
    if (orphans.length) {
      const firstBlk = wrap.querySelector('.g-block');
      orphans.forEach((r) => firstBlk && firstBlk.append(unitCard(courseId, g, r, focusTopic === r.u.topic, true)));
    }
    tabs.addEventListener('click', (e) => {
      const t = e.target.closest('.g-blocktab');
      if (!t) return;
      const k = t.dataset.block;
      tabs.querySelectorAll('.g-blocktab').forEach((x) => x.classList.toggle('is-active', x.dataset.block === k));
      wrap.querySelectorAll('.g-block').forEach((x) => x.classList.toggle('is-active', x.dataset.block === k));
    });
    studyView.append(tabs, wrap);

    // --- תצוגה: לפי נפח במבחן (רשימה שטוחה מדורגת בתדירות) ---
    const volView = el('div');
    volView.style.display = 'none';
    ranked.slice().sort((a, b) => b.u.freq - a.u.freq)
      .forEach((r) => volView.append(unitCard(courseId, g, r, false, true)));

    // --- מתג הסידור --- (רק במקצוע עם משקל-מבחן אמיתי)
    if (!g.noDayPlan) {
      const sortNav = el('div', 'g-sortnav');
      const mk = (id, label) => { const b = el('button', 'g-sortchip'); b.type = 'button'; b.dataset.sort = id; b.textContent = label; return b; };
      const cStudy = mk('study', '📚 לפי סדר הלימוד');
      cStudy.title = 'סידור הנושאים לפי הסדר שבו נלמד החומר בקורס';
      const cVol = mk('volume', '🏋️ לפי נפח במבחן');
      cVol.title = 'סידור הנושאים לפי כמות השאלות במבחן — הכבד קודם';
      const setSort = (m) => {
        studyView.style.display = m === 'study' ? '' : 'none';
        volView.style.display = m === 'volume' ? '' : 'none';
        cStudy.classList.toggle('on', m === 'study');
        cVol.classList.toggle('on', m === 'volume');
        unitsH2.textContent = m === 'study' ? '📖 הנושאים — לפי סדר הלימוד' : '📖 הנושאים — לפי נפח במבחן';
      };
      cStudy.onclick = () => setSort('study');
      cVol.onclick = () => setSort('volume');
      sortNav.append(cStudy, cVol);
      unitsSec.append(sortNav);
      setSort('study');   // ברירת מחדל: סדר הלימוד — נוח יותר, והחומר בנוי אחד על השני
    }

    unitsSec.append(studyView, volView);
  } else {
    if (!g.noDayPlan) unitsH2.textContent = '📖 הנושאים — לפי נפח במבחן';
    ranked.slice().sort((a, b) => b.u.freq - a.u.freq)
      .forEach((r) => unitsSec.append(unitCard(courseId, g, r, focusTopic === r.u.topic)));
  }
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

/* trapBox — המלכודת שהוצגה כאן אחרי כל טעות — נמחקה (13/08/2026) בעקבות
   הסקר: המלכודת נכתבת לנקודה שנשענת על עד שמונה שאלות ונורתה על כל טעות
   בלי קשר למסיח שנבחר, ולכן הרגישה "לא קשורה" והפריעה אחרי השאלות.
   המלכודות עצמן חיות בלומדה מאחורי שער "נסה קודם" — שם הן שאלה-עצמית
   לפני חשיפה, לא האשמה אחרי טעות — ובעמוד #/traps שנשאר opt-in. */

/* מהשאלה למפה — וכשיש סיכום מלא, גם ישר לפרק הנכון בו. שני הקישורים חיים
   על אותו עוגן (הנושא הקנוני), ולכן הצד השני של הלולאה סיכום→תרגול→סיכום
   מגיע בחינם: מהסיכום מגיעים לתרגול דרך קישורי ה-drill, ומטעות בתרגול
   חוזרים לפרק שמסביר אותה. */
function guideButton(topic) {
  const hit = GUIDE_BY_TOPIC[topic];
  if (!hit) return null;
  const a = el('a', 'fb-guide');
  a.href = `#/guide/${hit.course}/${encodeURIComponent(topic)}`;
  a.textContent = `📚 איפה ללמוד את ${topic}`;
  const sd = studyDocFor(hit.course, topic);
  if (!sd) return a;
  const frag = document.createDocumentFragment();
  frag.append(a);
  const d = el('a', 'fb-guide fb-study');
  d.href = sd.href + '#top-' + encodeURIComponent(topic);
  d.target = '_blank';
  d.rel = 'noopener';
  d.textContent = '📖 קרא על זה בסיכום המלא';
  d.title = 'קפיצה ישירה לפרק של הנושא בסיכום המלא';
  frag.append(d);
  return frag;
}

/* ---------- כותרת תחתונה ---------- */
function updateFooter() {
  const n = EXAMS.reduce((a, e) => a + e.count, 0);
  const f = document.getElementById('footerStats');
  /* שריד מלפני הענן: השורה הזאת אמרה "נשמר בדפדפן הזה בלבד" בכל עמוד, בזמן
     ש-#/account אמר את ההפך. משתמש מחובר שקרא את שניהם לא ידע במי להאמין —
     וזה בדיוק המקום שבו אמון בגיבוי נשבר. */
  const where = window.Cloud?.user
    ? 'ההתקדמות מסונכרנת לחשבון שלך'
    : 'ההתקדמות נשמרת בדפדפן הזה בלבד';
  f.textContent =
    `${plural(COURSES.length, 'מקצוע', 'מקצועות')} · ${plural(EXAMS.length, 'מבחן', 'מבחנים')} · ${n} שאלות · ${where}`;
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
/* חיפוש: "/" כמו בגיטהאב, ו-⌘K/Ctrl+K כמו בכל מקום אחר. */
document.addEventListener('keydown', (e) => {
  const typing = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openSearch(); return; }
  if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey) { e.preventDefault(); openSearch(); }
});

document.addEventListener('keydown', (e) => {
  const t = e.target.tagName;
  if (t === 'INPUT' || t === 'TEXTAREA' || e.target.isContentEditable || e.metaKey || e.ctrlKey) return;
  const n = parseInt(e.key, 10);
  if (!n || n < 1 || n > 9) return;

  const target = [...document.querySelectorAll('.q:not(.done)')].find((c) => {
    const r = c.getBoundingClientRect();
    return r.top < window.innerHeight * 0.6 && r.bottom > 0;
  });
  target?.querySelectorAll('.opt')[n - 1]?.click();
});

document.getElementById('searchBtn')?.addEventListener('click', openSearch);

/* ═══════════ סרגל ניווט תחתון (מובייל) + לשונית הקורס (דסקטופ) ═══════════
   האתר גדל, והדרך היחידה לנוע הייתה דרך הבית. הסרגל נותן מכל מסך, בלחיצה
   אחת: בית · הקורס הפעיל · תרגול · חיפוש · חשבון. "הקורס הפעיל" נגזר
   מהכתובת הנוכחית בלבד (בלי מפתח אחסון חדש) — הקורס האחרון שביקרת בו בסשן.
   תצוגה בלבד: אפס לוגיקה חדשה, רק קיצורי-דרך לראוטים קיימים. */
(() => {
  let lastCourse = null;

  const bar = el('nav', 'bnav');
  bar.setAttribute('aria-label', 'ניווט מהיר');
  const els = {};
  [
    { key: 'home',     ico: '🏠', lbl: 'בית',    href: '#/',         tip: 'חזרה למדף המקצועות' },
    { key: 'course',   ico: '📚', lbl: 'הקורס',                      tip: 'עמוד הקורס האחרון שביקרת בו' },
    { key: 'practice', ico: '🏋️', lbl: 'תרגול',                      tip: 'תרגול לפי נושא וכמות בקורס הפעיל' },
    { key: 'search',   ico: '🔍', lbl: 'חיפוש',                      tip: 'חיפוש בכל הארכיון' },
    { key: 'account',  ico: '👤', lbl: 'חשבון',  href: '#/account',  tip: 'החשבון והסנכרון שלך' },
  ].forEach((it) => {
    const a = el(it.key === 'search' ? 'button' : 'a', 'bnav-it');
    a.title = it.tip;
    a.append(el('span', 'bnav-ico', it.ico));
    a.append(el('span', 'bnav-lbl', it.lbl));
    if (it.href) a.href = it.href;
    if (it.key === 'search') a.onclick = () => openSearch();
    els[it.key] = a;
    bar.append(a);
  });
  document.body.append(bar);

  /* לשונית הקורס הפעיל בטופ-בר — לדסקטופ, אותו עיקרון */
  const topTab = el('a', 'nav-course');
  document.querySelector('.topnav')?.prepend(topTab);

  const COURSE_ROUTES = new Set(['course', 'practice', 'review', 'guide', 'tree', 'traps',
    'shinun', 'semester', 'anki', 'drills', 'tonight', 'flagged', 'formulas', 'sim', 'simexam']);
  const courseFromHash = () => {
    const [route, param] = location.hash.replace(/^#\/?/, '').split('/');
    if (param && COURSE_ROUTES.has(route) && courseOf(param)) return param;
    if (route === 'ecg') return courseOf(LABS[0].course) ? LABS[0].course : null;   // לפני שהמניפסט נטען — אין קורס
    if (param && ['exam', 'q', 'cards', 'case', 'keyer', 'sheet'].includes(route)) {
      const e = EXAMS.find((v) => v.id === param);
      if (e) return e.course;
    }
    return null;
  };

  const update = () => {
    const [route] = location.hash.replace(/^#\/?/, '').split('/');
    const c = courseFromHash();
    if (c) lastCourse = c;

    Object.values(els).forEach((x) => x.classList.remove('on'));
    if (!route) els.home.classList.add('on');
    else if (route === 'account') els.account.classList.add('on');
    else if (route === 'practice') els.practice.classList.add('on');
    else if (c) els.course.classList.add('on');

    if (lastCourse) {
      els.course.href = '#/course/' + lastCourse;
      els.practice.href = '#/practice/' + lastCourse;
      els.course.classList.remove('dim');
      els.practice.classList.remove('dim');
      const cc = courseOf(lastCourse);
      topTab.textContent = `${cc.icon || '📚'} ${cc.name}`;
      topTab.href = '#/course/' + lastCourse;
      topTab.classList.add('show');
      topTab.classList.toggle('active', !!c);
      topTab.title = 'חזרה לעמוד ' + cc.name;
    } else {
      els.course.href = '#/';
      els.practice.href = '#/';
      els.course.classList.add('dim');
      els.practice.classList.add('dim');
      topTab.classList.remove('show');
    }
  };
  window.addEventListener('hashchange', update);
  /* בטעינה ישירה לכתובת פנימית הדאטה עוד לא קיים כשהסקריפט רץ, ואין
     hashchange שיעדכן אחר-כך — לכן מתעדכנים גם אחרי כל רינדור של העמוד. */
  new MutationObserver(update).observe(view, { childList: true });

  /* נעלם בגלילה מטה, חוזר בגלילה מעלה — משאיר את המסך לתוכן */
  let lastY = 0;
  window.addEventListener('scroll', () => {
    const y = window.scrollY;
    if (y > lastY + 4 && y > 140) bar.classList.add('hide');
    else if (y < lastY - 4 || y <= 140) bar.classList.remove('hide');
    lastY = y;
  }, { passive: true });

  update();
})();

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

/* אירועי הענן. appReady מגן מרינדור לפני שהמניפסט נטען, ו-lastCloudUid מוודא
   שרינדור-מחדש קורה רק כשמצב ההתחברות באמת התהפך — לא על כל רענון טוקן שעתי
   (רינדור באמצע מבחן היה זורק את המשתמש לראש העמוד). */
let appReady = false;
let lastCloudUid = null;

document.addEventListener('cloud:user', () => {
  updateAccountBtn();
  const uid = window.Cloud?.user?.id || null;
  if (appReady && uid !== lastCloudUid) router();
  lastCloudUid = uid;
});

/* המיזוג הביא שינויים ממכשיר אחר — המסך צריך להראות אותם. changed=false
   (המצב המקומי כבר עדכני) לא מרנדר, כדי לא להזיז למשתמש את העמוד סתם. */
document.addEventListener('cloud:merged', (e) => {
  /* המיזוג כותב ישירות ל-localStorage (writeLS ב-cloud.js) ולא דרך seenH.write,
     ולכן המטמון בזיכרון לא יודע שהוא התיישן. בלי השורה הזאת מכשיר שסונכרן
     ממשיך להציג את המצב שלפני המיזוג עד רענון. */
  seenH.drop();
  if (appReady && e.detail && e.detail.changed) router();
});

/* טאב אחר של אותו אתר כתב — המטמון שלנו התיישן. */
window.addEventListener('storage', (e) => {
  if (e.key === SEENH_KEY) seenH.drop();
});

(async function init() {
  initTheme();
  /* הענן מתאתחל במקביל לטעינת המניפסט — לא מוסיף זמן המתנה. ל-Cloud.init
     יש קציבת זמן פנימית: Supabase איטי לא מעכב את הציור הראשון. */
  const cloudInit = window.Cloud?.init?.()?.catch?.(() => {});
  try {
    await loadManifest();
  } catch {
    view.innerHTML = '';
    view.append(emptyState('⚠️', 'לא הצלחתי לטעון את רשימת המבחנים',
      'אם פתחת את הקובץ ישירות מהמחשב (file://), הדפדפן חוסם קריאת קבצים. הרץ את start.command בתיקייה, או פתח את האתר מהכתובת המקוונת.'));
    return;
  }
  if (cloudInit) await cloudInit;
  lastCloudUid = window.Cloud?.user?.id || null;
  updateAccountBtn();
  appReady = true;
  router();
})();
