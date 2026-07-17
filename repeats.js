#!/usr/bin/env node
/* מזהה שאלות שחוזרות בין מחזורים, ובונה מהן מבחן High Yield.
   רץ אוטומטית מתוך sync.js — אין צורך להריץ ידנית.

   הרעיון: שאלה שהמרצה שאל בכמה מחזורים היא ההימור הטוב ביותר למבחן הבא.

   ─────────────────────────────────────────────────────────────────────
   שתי שכבות, כי מחשב לא יודע לשפוט "אותו עיקרון":

   1. הספירה (כאן) — נותנת ציון לכל זוג שאלות ומחלקת לשלוש ערימות:
      בטוח אותה שאלה / בטוח לא / גבולי.
   2. השיפוט (אדם) — את הערימה הגבולית מכריעים בעיניים, וההכרעה נשמרת
      לתמיד ב-repeats-ledger.json. מה שהוכרע פעם אחת לא נשאל שוב.

   לכן זה "חי": אחרי כל שחזור חדש הספירה רצה מחדש על הכול, ורק הזוגות
   החדשים דורשים הצצה.
   ─────────────────────────────────────────────────────────────────────

   כותב:
   • שדה `repeat` לכל שאלה חוזרת בקבצי השחזור — מזין את התג באתר
   • exams/molecular-high-yield.json — המבחן עצמו
   • exams/repeats-ledger.json — פנקס ההכרעות (נערך בידי אדם)
*/

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const EXAMS = path.join(__dirname, 'exams');
const LEDGER = path.join(EXAMS, 'repeats-ledger.json');

/* מקצועות שבהם מחפשים חזרות, וה**ציר** שלפיו נספרת חזרה בכל אחד.

   "חזרה" = אותה שאלה בשני מופעים *נפרדים* של הקורס. מה נחשב מופע נפרד תלוי
   במקצוע, ולכן הציר הוא פרמטר:

   • molecular — הציר הוא `cycle` (מחזור הסטודנטים). מ״ז מועד א׳ ומ״ז מועד ב׳
     הם אותו מחזור, ולכן שאלה שחוזרת ביניהם אינה "חזרה": זה אותו קהל, אותה שנה.
   • electro — אין מחזורים כלל (אלה מאסטרים רשמיים מהמודל, `cycle:null` תמיד),
     והציר הוא `year` = השנה האקדמית. מועד א׳ ומועד ב׳ של אותה שנה משרתים את
     אותו קהל, בדיוק כמו מועד א׳/ב׳ של אותו מחזור במולקולרית — ולכן אותו היגיון.

   מקצוע נכנס לכאן כשיש בו לפחות 3 מבחנים עם ערך ציר — אחרת המדגם קטן מדי.

   `official` משנה את *הניסוח* בלבד: מאסטר רשמי מהפקולטה אינו "שחזור מחזור",
   ולומר עליו שהוא כזה יהיה פשוט שקר. */
const COURSES = {
  molecular: {
    axis: 'cycle',
    part: null,
    unit: 'מחזורים',        // נכתב לתוך תג ה-repeat כדי שהאתר לא יצטרך להכיר מקצועות
    they: 'המחזורים',
    twoPlus: 'בשני מחזורים לפחות',
    corpus: (n) => `${n} השחזורים בארכיון`,
    pick: 'הנוסח נלקח מהשחזור האמין ביותר מבין אלה שבהם הופיעה.',
    clashSummary: 'שאלה שהמשחזרים עצמם נחלקו עליה היא בדיוק זו שקל ליפול בה.',
    source: (label) => `שחזור מחזור ${label}`,
    clashNote: (rep) =>
      `כאן מוצגת תשובת ${rep._exam.label}, שהמפתח שלו ${
        rep._exam.data.trust === 'verified' ? 'אומת בחשיפה' : 'האמין מבין אלה שנחלקו'
      } — אבל טרם הוכרע מי צודק.`,
    /* "שחזור מחזור נ״א — מועד א׳" → "נ״א"  (ואם זה מועד ב׳: "נ״א ב׳") */
    label: (e) => {
      const m = (e.title || '').match(/מחזור\s+([^\s—–]+)/);
      const base = m ? m[1] : String(e.cycle ?? e.id);
      return e.moed === 'ב' ? `${base} ב׳` : base;
    },
  },
  electro: {
    axis: 'year',
    part: 'High Yield',    // סקשן משלו בראש עמוד הקורס (שאר האלקטרו מחולק לבחני אמצע/מבחני גמר)
    unit: 'שנים',
    they: 'המבחנים',
    twoPlus: 'בשתי שנים אקדמיות לפחות',
    corpus: (n) => `${n} המבחנים הרשמיים בארכיון`,
    pick: 'הנוסח נלקח מהמבחן המאוחר ביותר מבין אלה שבהם הופיעה — הקרוב ביותר לניסוח של היום.',
    clashSummary: 'שאלה שהפקולטה עצמה סימנה בה תשובות שונות היא בדיוק זו שקל ליפול בה.',
    source: (label) => `מאסטר רשמי — ${label}`,
    /* שני מאסטרים רשמיים שחלוקים על התשובה = הפקולטה עצמה לא עקבית. זה ממצא
       חזק יותר משני שחזורי סטודנטים שנחלקו, ולכן ניסוח אחר. */
    clashNote: (rep) =>
      `שני המפתחות כאן רשמיים, כלומר הפקולטה עצמה סימנה תשובות שונות לאותה שאלה. ` +
      `מוצגת תשובת ${rep._exam.label} (המאוחר מביניהם), אך טרם הוכרע מי צודק.`,
    /* "מועד א׳" + year 2024 → "מועד א׳ 2024"
       "בוחן 1 — אקסיטביליות" + 2023 → "בוחן 1 2023"  (הכותרת-משנה מיותרת בתג) */
    label: (e) => `${(e.title || '').split('—')[0].trim()} ${e.year}`,
  },
};

/* ספי הכרעה. כוילו על 6 מחזורי ביומול (294 שאלות) — ראה כיול בתחתית הקובץ. */
const AUTO = 0.55;   // מעל זה: אותה שאלה, בלי לשאול
const MAYBE = 0.32;  // בין לבין: לשיפוט אדם. מתחת: לא אותה שאלה.

/* אמינות המפתח, לפי הצהרת המשחזרים. מכריע כשמחזורים חלוקים על התשובה. */
const TRUST = { verified: 3, partial: 2, unverified: 1 };

/* ═══════════════ נרמול טקסט ═══════════════ */

/* מילים שמופיעות כמעט בכל שאלה ולכן לא מלמדות כלום על הדמיון בין שתיים.
   בלי ניכוי שלהן, כל שתי שאלות ביומול נראות דומות ב-30%. */
const STOP = new Set(
  `את של עם על אל מן מ ב ל ה ו כ ש כי אם אז גם רק לא אין יש הוא היא הם הן זה זו אלה
   אשר כאשר אחרי לפני בין תחת מעל כדי מתוך לפי אינו אינה נכון נכונה נכונות נכונים
   הבאים הבאות הבא הבאה כל אחד אחת מהבאים מהבאות איזה איזו מהי מהו מה למה מדוע כיצד
   איך אילו הטענות הטענה המשפטים המשפט היגד היגדים תשובה תשובות סעיף שאלה נתון נתונים
   בהתייחס ביחס יכול יכולה ניתן צפוי צפויה סביר להיות תהיה יהיה בתא בתאי תא תאים`
    .split(/\s+/).filter(Boolean)
);

const norm = (s) =>
  (s || '')
    .replace(/[֑-ׇ]/g, '')          // ניקוד וטעמים
    .replace(/["'׳״`]/g, '')        // גרש/גרשיים — "מ״ו" ו-"מו" זה אותו דבר
    .replace(/[^֐-׿a-zA-Z0-9]+/g, ' ')
    .toLowerCase()
    .trim();

const words = (s) => norm(s).split(/\s+/).filter(Boolean);
const content = (s) => words(s).filter((w) => !STOP.has(w) && w.length > 1);

/* אסימונים לטיניים/מספריים — MDM2, cas9, p53, DNMT1.
   אלה טביעת אצבע: שתי שאלות שחולקות אותם כמעט תמיד עוסקות באותו דבר. */
const rare = (s) => new Set(words(s).filter((w) => /[a-z0-9]/.test(w) && w.length > 1));

/* ═══════════════ מדדי דמיון ═══════════════ */

const jaccard = (A, B) => {
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const x of A) if (B.has(x)) hit++;
  return hit / (A.size + B.size - hit);
};

/* יוניגרמות + ביגרמות. הביגרמות תופסות סדר מילים, ולכן מבדילות בין
   "מעכב את השעתוק" ל"השעתוק מעכב את" — שתי שאלות שונות לגמרי. */
const grams = (arr) => {
  const s = new Set(arr);
  for (let i = 0; i < arr.length - 1; i++) s.add(arr[i] + '~' + arr[i + 1]);
  return s;
};

const textSim = (a, b) => jaccard(grams(content(a)), grams(content(b)));

/* דמיון ברמת התווים. תופס וריאציות כתיב שדמיון-מילים מפספס:
   "ליניארי"/"לינארי", "הכרומוזום"/"הכרומוזומים", "ריאקציה"/"ריקציה". */
const charSim = (a, b) => {
  const tri = (s) => {
    const t = ' ' + norm(s) + ' ';
    const out = new Set();
    for (let i = 0; i < t.length - 2; i++) out.add(t.slice(i, i + 3));
    return out;
  };
  return jaccard(tri(a), tri(b));
};

/* האם שתי תשובות אומרות את אותו דבר?

   ⚠️ אסור להסתמך על charSim על המשפט כולו. "תא המתחלק בתדירות גבוהה" ו-
   "תא המתחלק בתדירות נמוכה" נבדלות במילה אחת, ולכן דומות מאוד ברמת התווים —
   ומשמעותן הפוכה. בדיקה כזאת הייתה מכריזה עליהן "אותה תשובה" בביטחון מלא.

   לכן משווים מילה-מול-מילה: וריאציית כתיב מתבטאת *בתוך* מילה ("ליניארי"/
   "לינארי" חולקות רוב התווים), ואילו היפוך משמעות מחליף מילה שלמה
   ("גבוהה"/"נמוכה" כמעט לא חולקות תווים). מילה בלי בת-זוג סבירה = לא אותה תשובה. */
const sameStatement = (a, b) => {
  const A = content(a), B = content(b);
  if (!A.length || !B.length) return charSim(a, b) >= 0.85;
  const best = (X, Y) => X.map((w) => Math.max(0, ...Y.map((v) => charSim(w, v))));
  const all = [...best(A, B), ...best(B, A)];
  const mean = all.reduce((s, x) => s + x, 0) / all.length;
  return mean >= 0.80 && Math.min(...all) >= 0.40;
};

/* האם השאלה מנוסחת בשלילה — "מה *אינו* נכון", "כל הבאים *למעט*".
   קריטי: מרצה שמהפך שאלה מ"נכון" ל"לא נכון" שואל את אותה שאלה בדיוק,
   אבל התשובה הנכונה שונה — בכוונה. בלי זיהוי ההיפוך היינו מכריזים
   על "סתירה בין המפתחות" כשאין שום סתירה.

   ⚠️ בלי \b — ב-JavaScript גבול-מילה מוגדר על [A-Za-z0-9_] בלבד, ולכן הוא
   *לעולם* אינו מתקיים סביב מילה עברית. שימוש ב-\b כאן פשוט לא היה עובד. */
const NEG = /(^| )(אינו|אינה|אינם|אינן|איננו|שגוי|שגויה|שגויות|שקרי|למעט|לא נכון|לא נכונה|לא נכונים|לא נכונות|לא מתאר|לא ניתן|לא ישתתף|לא נמצא|לא מתרחש)( |$)/;
const negative = (q) => NEG.test(' ' + norm(q).replace(/\s+/g, ' ') + ' ');

/* מסיחי-על: "כל התשובות נכונות", "אין תשובה נכונה".
   כששני מחזורים נחלקים ואחד מהם ענה מסיח-על, זה כמעט תמיד אומר שערכת
   המסיחים הייתה שונה — לא שהמפתחות סותרים זה את זה. */
const META = /^(כל התשובות|כל הנל|כל האמור|אין תשובה|אף תשובה|אף אחת|כל הבאים|כל התשובות נכונות)/;
const meta = (s) => META.test(norm(s));

/* דמיון בין ערכות המסיחים — האות החזק ביותר.
   שתי שאלות שונות כמעט אף פעם לא חולקות את אותן תשובות שגויות.
   מרצה שממחזר שאלה ממחזר איתה גם את המסיחים. */
const optsSim = (o1, o2) => {
  const A = o1.map((o) => grams(content(o)));
  const B = o2.map((o) => grams(content(o)));
  const used = new Set();
  let sum = 0;
  for (const a of A) {                       // התאמה חמדנית אחד-לאחד
    let best = 0, at = -1;
    B.forEach((b, i) => {
      if (used.has(i)) return;
      const s = jaccard(a, b);
      if (s > best) { best = s; at = i; }
    });
    if (at >= 0) used.add(at);
    sum += best;
  }
  return sum / Math.max(A.length, B.length);
};

/* הציון המשוקלל. הטקסט לבדו לא מספיק — הוא גם מפספס ניסוח ששונה,
   וגם תופס שאלות שונות שרק הפתיח שלהן זהה ("איזה מהמשפטים נכון..."). */
function score(a, b) {
  const text = textSim(a.q, b.q);
  const opts = optsSim(a.opts, b.opts);
  const ans = textSim(a.opts[a.a], b.opts[b.a]);
  const rar = jaccard(rare(a.q + ' ' + a.opts.join(' ')), rare(b.q + ' ' + b.opts.join(' ')));

  let s = 0.35 * text + 0.30 * opts + 0.20 * ans + 0.15 * rar;
  if (a.topic && b.topic) s += a.topic === b.topic ? 0.05 : -0.10;   // הנושא כבלם
  return { s: Math.max(0, s), text, opts, ans, rar };
}

/* ═══════════════ טעינה ═══════════════ */

/* מזהה יציב לשאלה. נכתב לקובץ פעם אחת ואז קפוא לנצח — כך שפנקס ההכרעות
   שורד עריכות טקסט, שינוי סדר שאלות, והוספת שחזורים.

   ⚠️ המסיחים נכנסים לגיבוב, ולא רק הכותרת. מבחן *כן* יכול להכיל שתי שאלות
   שונות עם אותה כותרת בדיוק: במועד א׳ 2023 יש שתי שאלות "איזה מהמשפטים
   הבאים אינו נכון לגבי תאי גליה?" (ש׳41 ו-ש׳42), עם ערכות מסיחים שונות
   לגמרי. בגיבוב על הכותרת בלבד שתיהן קיבלו את אותו qid — וכל הכרעה בפנקס
   על אחת מהן חלה בשקט גם על השנייה. זו לא תקלה תיאורטית; היא קרתה. */
const mintQid = (examId, q) =>
  crypto.createHash('md5')
    .update(examId + '|' + norm(q.q) + '|' + (q.opts || []).map(norm).join('|'))
    .digest('hex').slice(0, 8);

function loadCourse(courseId, cfg) {
  const exams = [];
  for (const file of fs.readdirSync(EXAMS).sort()) {
    if (!file.endsWith('.json') || file === 'manifest.json' || file === 'courses.json') continue;
    if (file === path.basename(LEDGER)) continue;
    const p = path.join(EXAMS, file);
    const d = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (d.course !== courseId || d.kind !== 'shichzur' || d[cfg.axis] == null) continue;

    let touched = false;
    d.questions.forEach((q) => {
      if (!q.qid) { q.qid = mintQid(d.id, q); touched = true; }   // חד-פעמי, ואז קפוא
    });
    exams.push({ file, path: p, data: d, touched, label: cfg.label(d) });
  }
  return exams;
}

/* ═══════════════ הריצה ═══════════════ */

const ledger = fs.existsSync(LEDGER)
  ? JSON.parse(fs.readFileSync(LEDGER, 'utf8'))
  : {
      note: 'הכרעות אדם, נשמרות לתמיד. מה שהוכרע כאן פעם אחת לא נשאל שוב, ושורד עריכות והוספת שחזורים.',
      pairs: { '_': 'זוג שאלות: true = אותה שאלה, false = שאלות שונות' },
      answers: { '_': 'זוג תשובות: true = אותה תשובה בניסוח אחר, false = סתירה אמיתית בין המפתחות' },
    };
ledger.pairs ||= {};
ledger.answers ||= {};
ledger.truth ||= {};      // הכרעת NotebookLM: מה באמת התשובה הנכונה כשהמפתחות חלוקים

const pairKey = (x, y) => [x, y].sort().join('|');
const report = { pending: [], clashes: [], unresolved: [], courses: [] };

/* ---------- הטבעת qid על כל הארכיון ----------
   ה-qid נולד ככלי פנימי של הפנקס, ולכן הוטבע רק במקצועות שנסרקים לחזרות
   (מולקולרית ואלקטרו). אבל הוא בעצם **המזהה היציב היחיד שיש לשאלה**, והדפדפן
   צריך אותו בדיוק כמו הפנקס: ההתקדמות נשמרה עד היום לפי מיקום השאלה בקובץ,
   ומיקום זז בכל עריכה. כשהוסרו שאלות הלב מאלקטרו תשפ״ה והמבחן ירד מ-38 ל-31,
   כל התקדמות ששמורה על שאלה שאחרי המחיקה הצביעה מאז על שאלה אחרת — בשקט.
   לכן ביוכימיה וקליני חייבים qid גם אם לעולם לא ייסרקו לחזרות.

   רץ לפני לולאת המקצועות, ולכן loadCourse מוצא qid קיימים ומדלג עליהם
   (`if (!q.qid)`) — 746 הגיבובים שכבר בארכיון נשארים זהים ביט-לביט,
   והפנקס שורד. אותה סיבה בדיוק שבגללה norm() ו-mintQid לא זזים מכאן לעולם:
   כל שינוי בהם משנה את כל הגיבובים ושורף את repeats-ledger.json.

   `generated` מדולג — קובץ ה-High Yield נדרס בהמשך הריצה הזאת ממילא,
   והשאלות בו יורשות את ה-qid של הנציג שממנו נלקחו. */
const NOT_EXAMS = new Set(['manifest.json', 'courses.json', 'repeats-ledger.json']);

function mintAll() {
  let minted = 0, files = 0;
  for (const file of fs.readdirSync(EXAMS).sort()) {
    if (!file.endsWith('.json') || NOT_EXAMS.has(file)) continue;
    const p = path.join(EXAMS, file);
    let d;
    try { d = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { continue; }
    if (!Array.isArray(d.questions) || d.generated) continue;

    let touched = false;
    d.questions.forEach((q) => {
      if (!q.qid) { q.qid = mintQid(d.id, q); touched = true; minted++; }
    });
    if (touched) { fs.writeFileSync(p, JSON.stringify(d, null, 2) + '\n', 'utf8'); files++; }
  }
  if (minted) console.log(`\n   🔑 הוטבעו ${minted} מזהי שאלה חדשים ב-${files} קבצים`);
}
mintAll();

for (const [courseId, cfg] of Object.entries(COURSES)) {
  const exams = loadCourse(courseId, cfg);
  if (exams.length < 2) continue;

  const qs = [];
  exams.forEach((e) =>
    e.data.questions.forEach((q, i) =>
      qs.push({ ...q, _exam: e, _n: i + 1, _cycle: e.data[cfg.axis], _trust: TRUST[e.data.trust] || 1 })
    )
  );

  /* --- ניקוד כל זוג משני מחזורים שונים --- */
  const accepted = [];
  const pending = [];
  for (let i = 0; i < qs.length; i++) {
    for (let j = i + 1; j < qs.length; j++) {
      if (qs[i]._cycle === qs[j]._cycle) continue;      // חזרה = בין מחזורים
      const r = score(qs[i], qs[j]);

      /* הפנקס נבדק *לפני* הסף, ולשני הכיוונים. קודם הסף רץ ראשון, ולכן "אדם
         אישר" מתחת ל-32% נבלע בשקט — בעוד "אדם פסל" כן כובד. אסימטריה שהסתירה
         את כוונת המנוע: הכרעת אדם גוברת על הספירה, נקודה.

         זה לא תיאורטי: f/I "כשנקטין את הקלט הסינפטי" הוא אותה שאלה בדיוק ב-
         מועד א׳ 2024 ובמועד א׳ 2025, אבל הניסוח שוכתב כמעט לגמרי והציון נפל
         ל-~30% — כלומר מתחת לסף, בלי שום דרך לאדם לתקן. */
      const verdict = ledger.pairs[pairKey(qs[i].qid, qs[j].qid)];
      if (verdict === false) continue;                  // אדם פסל — מכובד תמיד
      if (verdict === true) { accepted.push([i, j, r]); continue; }   // אדם אישר — גם מתחת לסף
      if (r.s < MAYBE) continue;
      if (r.s >= AUTO) { accepted.push([i, j, r]); continue; }
      pending.push({ i, j, r });                        // גבולי, טרם הוכרע
    }
  }

  /* --- אשכולות: אם א׳=ב׳ וגם ב׳=ג׳, שלושתן אותה שאלה --- */
  const parent = qs.map((_, i) => i);
  const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  accepted.forEach(([i, j]) => { const a = find(i), b = find(j); if (a !== b) parent[a] = b; });

  const groups = new Map();
  qs.forEach((_, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(i);
  });

  const clusters = [...groups.values()]
    .map((ix) => ix.map((i) => qs[i]))
    .filter((g) => new Set(g.map((q) => q._cycle)).size > 1)     // חייב לפרוש כמה מחזורים
    .sort((a, b) => b.length - a.length || Math.max(...b.map((q) => q._cycle)) - Math.max(...a.map((q) => q._cycle)));

  /* --- ניקוי שדות ישנים, ואז כתיבת הספירה על כל שאלה --- */
  qs.forEach((q) => delete q.repeat);
  exams.forEach((e) => e.data.questions.forEach((q) => { if (q.repeat) { delete q.repeat; e.touched = true; } }));

  const hy = [];
  clusters.forEach((g) => {
    const byCycle = [...g].sort((a, b) => b._cycle - a._cycle);
    const labels = [...new Set(byCycle.map((q) => q._exam.label))];
    const cycles = [...new Set(byCycle.map((q) => q._cycle))];

    /* --- סתירה בין מפתחות ---
       משווים את *טקסט* התשובה, לא את האינדקס: סדר המסיחים משתנה בין שחזורים.

       שלוש מלכודות שגורמות ל"סתירה" מדומה, וכולן טופלו:
       1. היפוך — "מה נכון" מול "מה אינו נכון". תשובה שונה היא הנכונה, לא סתירה.
       2. כתיב — "ליניארי" מול "לינארי". נתפס ב-charSim.
       3. ניסוח — "יוצא למרחב החוץ תאי" מול "משוחרר אל המרחב החוץ תאי".
          מחשב לא יכריע את זה. הולך לשיפוט אדם, וההכרעה נשמרת בפנקס. */
    const pol = new Map(g.map((q) => [q, negative(q.q)]));
    const flipped = new Set(pol.values()).size > 1;

    /* כשהמפתחות מצביעים על טענות שונות יש שלוש אפשרויות, והמכונה אינה
       מכריעה ביניהן — היא רק מזהה ומעבירה לאדם. עד שהוכרע, לא מוצג כלום:
       תג שקרי גרוע מהיעדר תג.

         true   — אותה תשובה בניסוח אחר
         "opts" — ערכות המסיחים היו שונות; כל תשובה נכונה למסיחים שלה
         false  — סתירה אמיתית: אחד המפתחות טועה */
    let conflict = false, optsDiffer = false, ruling = null;

    for (let x = 0; x < g.length; x++)
      for (let y = x + 1; y < g.length; y++) {
        const [p, q] = [g[x], g[y]];
        if (pol.get(p) !== pol.get(q)) continue;                 // היפוך — התשובות אמורות להיות שונות
        if (sameStatement(p.opts[p.a], q.opts[q.a])) continue;   // אותה טענה, כתיב שונה

        const key = pairKey(p.qid, q.qid);
        const verdict = ledger.answers[key];
        if (verdict === true) continue;
        if (verdict === 'opts') { optsDiffer = true; continue; }
        if (verdict === false) {
          conflict = true;
          /* סתירה אמיתית. מי צודק? זו שאלת תוכן — NotebookLM מכריע, לא אנחנו. */
          if (ledger.truth[key]) ruling = ledger.truth[key];
          else report.unresolved.push({ courseId, x: p, y: q, key });
          continue;
        }
        report.clashes.push({ courseId, x: p, y: q, key });      // טרם הוכרע — לא מוצג
      }

    /* הנציג למבחן ה-High Yield: השחזור האמין ביותר; בשוויון — הקרוב ביותר למבחן.

       אבל אם NotebookLM הכריע מה התשובה הנכונה, חייבים לבחור נציג שבו התשובה
       הזאת בכלל *הוצעה* כמסיח. אחרת נקבל שאלה שההערה שלה מכריזה על תשובה אחת
       והמסיח המסומן בה הוא אחר. (קרה בפועל: ההכרעה הייתה "מתחלק בתדירות גבוהה",
       והנציג הנבחר היה מ״ח — שבו המסיח היחיד הוא "בתדירות נמוכה".) */
    const fits = ruling ? g.filter((q) => q.opts.some((o) => sameStatement(o, ruling.answer))) : [];
    const rep = (fits.length ? fits : [...g]).sort(
      (a, b) => b._trust - a._trust || b._cycle - a._cycle
    )[0];

    const stamp = { n: cycles.length, unit: cfg.unit, in: labels, span: Math.max(...cycles) - Math.min(...cycles) };
    if (flipped) stamp.flipped = true;
    if (optsDiffer) stamp.optsDiffer = true;
    if (conflict) stamp.conflict = true;

    g.forEach((q) => {
      const orig = q._exam.data.questions[q._n - 1];
      orig.repeat = stamp;
      q._exam.touched = true;
    });

    /* --- השאלה כפי שהיא תיכנס למבחן ה-High Yield --- */
    const others = labels.filter((l) => l !== rep._exam.label);
    const notes = [`נוסח מ${rep._exam.label}${others.length ? `. הופיעה גם ב${others.join(', ')}` : ''}.`];

    if (flipped) {
      /* new Set — מבחן אחד יכול לתרום כמה שאלות לאותו אשכול (במועד א׳ 2023 יש
         שתי שאלות גליה נפרדות), ובלעדיו התג יקרא "מועד א׳ 2023, מועד א׳ 2023". */
      const inv = [...new Set(
        [...g].filter((q) => negative(q.q) !== negative(rep.q)).map((q) => q._exam.label)
      )];
      notes.push(
        `🔄 השאלה הזאת הגיעה בשני הכיוונים: ב${inv.join(', ')} היא נשאלה בניסוח ההפוך ` +
        `(${negative(rep.q) ? '"מה נכון" במקום "מה אינו נכון"' : '"מה אינו נכון" במקום "מה נכון"'}). ` +
        `דע לזהות את שני הצדדים — לא רק לשנן איזה מסיח לסמן.`
      );
    }

    if (optsDiffer) {
      const each = [...g]
        .sort((a, b) => b._trust - a._trust)
        .map((q) => `${q._exam.label} → "${q.opts[q.a]}"`)
        .join('  |  ');
      notes.push(
        `ℹ️ אותה שאלה, אבל ערכת המסיחים לא הייתה זהה בין ${cfg.they}, ולכן גם התשובה הנכונה שונה: ${each}. ` +
        `אלה לא מפתחות סותרים — כל אחת נכונה למסיחים שהוצעו לה. תבין את התוכן, אל תשנן אות.`
      );
    }

    const { qid, _exam, _n, _cycle, _trust, repeat, ...clean } = rep;

    if (conflict) {
      const disagree = [...g]
        .sort((a, b) => b._trust - a._trust)
        .map((q) => `${q._exam.label} → "${q.opts[q.a]}"`)
        .join('  |  ');

      const at = ruling ? clean.opts.findIndex((o) => sameStatement(o, ruling.answer)) : -1;

      if (ruling && at >= 0) {
        clean.a = at;                       // מתקנים את המפתח בפועל, לא רק מעירים
        notes.push(
          `⚠️ ${cfg.they} היו חלוקים על התשובה: ${disagree}. ` +
          `✅ הוכרע מול חומרי הקורס: הנכונה היא "${ruling.answer}". ${ruling.why || ''}`.trim()
        );
        stamp.resolved = true;
      } else if (ruling) {
        /* הוכרע, אבל התשובה הנכונה לא הופיעה כמסיח באף אחד מהמופעים —
           כלומר בכל הגרסאות שיש לנו השאלה פגומה. זה עצמו ממצא. */
        notes.push(
          `⚠️ ${cfg.they} חלוקים: ${disagree}. ` +
          `❗ לפי חומרי הקורס התשובה הנכונה היא "${ruling.answer}" — והיא לא הוצעה כמסיח באף אחד ` +
          `מהם. ${ruling.why || ''}`.trim()
        );
      } else {
        notes.push(
          `⚠️ ${cfg.they} חלוקים על התשובה: ${disagree}. ` + cfg.clashNote(rep) +
          ` אל תשנן את השאלה הזאת; תבין אותה.`
        );
      }
    }
    if (rep.note) notes.push(rep.note);

    hy.push({ ...clean, qid, note: notes.join(' '), repeat: stamp, source: cfg.source(rep._exam.label) });
  });

  /* --- כתיבת קבצי השחזור --- */
  exams.forEach((e) => {
    if (!e.touched) return;
    fs.writeFileSync(e.path, JSON.stringify(e.data, null, 2) + '\n', 'utf8');
  });

  /* --- מבחן ה-High Yield --- */
  const course = JSON.parse(fs.readFileSync(path.join(EXAMS, 'courses.json'), 'utf8'))
    .courses.find((c) => c.id === courseId);
  const conflicts = hy.filter((q) => q.repeat.conflict).length;
  const resolved = hy.filter((q) => q.repeat.resolved).length;
  const hyFile = path.join(EXAMS, `${courseId}-high-yield.json`);

  const conflictNote =
    !conflicts ? ''
    : resolved === conflicts
      ? `ב-${conflicts} שאלות ${cfg.they} סימנו תשובות שונות — כולן הוכרעו מול חומרי הקורס, והמפתח כאן מתוקן. ` +
        `הן מסומנות, וכדאי ללמוד אותן לעומק: ${cfg.clashSummary} `
      : `⚠️ ב-${conflicts} שאלות ${cfg.they} חלוקים על התשובה (${resolved} מהן כבר הוכרעו מול חומרי הקורס). ` +
        `הן מסומנות, וכדאי ללמוד אותן לעומק. `;

  if (hy.length) {
    fs.writeFileSync(
      hyFile,
      JSON.stringify(
        {
          id: `${courseId}-high-yield`,
          course: courseId,
          part: cfg.part,
          title: 'High Yield — השאלות שחוזרות',
          kind: 'highyield',
          moed: null,
          added: new Date().toISOString().slice(0, 10),
          generated: true,
          note:
            `נבנה אוטומטית מ-${cfg.corpus(exams.length)} (${exams.map((e) => e.label).join(', ')}). ` +
            `כל שאלה כאן הופיעה ${cfg.twoPlus} — זה ההימור הטוב ביותר למבחן הקרוב. ` +
            cfg.pick + ' ' +
            conflictNote +
            `הקובץ נוצר ע״י repeats.js ונדרס בכל sync — אין טעם לערוך אותו ידנית.`,
          /* ה-qid נשאר — הוא של הנציג, השאלה שממנה הנוסח נלקח, וזו *אותה
             שאלה* בדיוק. כשהוא היה מופשט, שאלת HY נספרה כשאלה נפרדת: מי
             שטעה בה גם בשחזור וגם ב-HY ראה אותה פעמיים ב"הטעויות שלי",
             ו-masteryOf ניפח את המכנה של הנושא. עכשיו הן חולקות מפתח
             התקדמות, וטעות באחת מסמנת את השנייה.

             ⚠️ באשכול conflict+resolved השדה `a` כאן מתוקן לפי הפנקס ואילו
             במקור נשאר המפתח המקורי — כלומר אותו qid מתאר שתי תשובות נכונות
             שונות. חל על מספר חד-ספרתי של אשכולות, ותמיד לטובת המתוקן.

             repeats.js לא יקרא את הקובץ הזה לעולם (loadCourse מסנן
             kind==='shichzur'), ולכן אין חשש להתנגשות בפנקס. */
          questions: hy,
        },
        null,
        2
      ) + '\n',
      'utf8'
    );
  } else if (fs.existsSync(hyFile)) {
    fs.unlinkSync(hyFile);
  }

  report.courses.push({ courseId, exams: exams.length, total: qs.length, clusters, conflicts, hy: hy.length });
  pending.sort((a, b) => b.r.s - a.r.s).forEach((p) => report.pending.push({ courseId, a: qs[p.i], b: qs[p.j], ...p.r }));
}

/* --- פנקס ההכרעות: יוצרים אם אינו קיים --- */
if (!fs.existsSync(LEDGER)) fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 2) + '\n', 'utf8');

/* ═══════════════ דו״ח ═══════════════ */

if (process.env.QUIET !== '1') {
  report.courses.forEach((c) => {
    const u = COURSES[c.courseId].axis === 'year' ? 'שנים' : 'מחזורים';
    console.log(`\n   🔁 ${c.courseId}: ${c.clusters.length} שאלות חוזרות מתוך ${c.total} (${c.exams} מבחנים)`);
    const hist = {};
    c.clusters.forEach((g) => { const n = new Set(g.map((q) => q._cycle)).size; hist[n] = (hist[n] || 0) + 1; });
    Object.keys(hist).sort((a, b) => b - a).forEach((n) => console.log(`        חזרו ב-${n} ${u}: ${hist[n]}`));
    if (c.conflicts) console.log(`        ⚠️  ${c.conflicts} עם סתירה בין המפתחות`);
  });

  const undecided = report.clashes.length;
  if (report.pending.length || undecided) {
    console.log(
      `\n   ⏳ ממתין להכרעה טקסטואלית — הרץ:  node repeats.js --review\n` +
      `        ${report.pending.length} זוגות גבוליים (אותה שאלה?)\n` +
      `        ${undecided} תשובות חלוקות (סתירה אמיתית או רק ניסוח שונה?)\n`
    );
  }
  if (report.unresolved.length) {
    console.log(
      `   ❓ ${report.unresolved.length} סתירות אמיתיות בלי הכרעה — מי צודק היא שאלת תוכן.\n` +
      `        הרץ:  node repeats.js --ask   → פרומפט מוכן ל-NotebookLM\n`
    );
  }
}

/* ═══════════════ --ask: פרומפט מוכן ל-NotebookLM ═══════════════

   "מי צודק כשהמפתחות חלוקים" היא שאלת *תוכן*, לא שאלת טקסט — ואת זה לא אני
   ולא ינון מכריעים מהזיכרון. ל-NotebookLM שלו מחוברים חומרי הקורס עצמם.
   כאן נבנה פרומפט עצמאי לגמרי (נוטבוק לא רואה את הקוד ולא את ה-JSON),
   ומבוקש ממנו פורמט תשובה שאפשר להזין ישירות לפנקס. */

if (process.argv.includes('--ask')) {
  const open = report.unresolved;
  if (!open.length) {
    console.log('\n✅ אין סתירות פתוחות — אין מה לשאול.\n');
    process.exit(0);
  }

  /* הפרומפט חייב לתאר נכון את המקור: שחזורי סטודנטים מול מאסטרים רשמיים —
     שני מצבים שונים לגמרי, ותיאור שגוי שולח את נוטבוק להכריע על סמך הנחה כוזבת. */
  const askCourse = open[0].courseId;
  const askCfg = COURSES[askCourse];
  const official = askCfg.axis === 'year';
  const cyc = (q) => (official ? q._exam.label : `מחזור ${q._exam.label}`);
  const block = (c, i) => {
    const both = [c.x, c.y];
    const opts = [...new Set(both.flatMap((q) => q.opts))];   // ערכת המסיחים המאוחדת
    return [
      `### שאלה ${i + 1}   (מזהה: ${c.key})`,
      ``,
      `**נושא:** ${c.x.topic || '—'}`,
      ``,
      `**השאלה כפי שנשאלה:**`,
      ...both.map((q) => `- ב${cyc(q)}: "${q.q}"`),
      ``,
      `**המסיחים שהוצעו (איחוד של שני המקורות):**`,
      ...opts.map((o, k) => `${k + 1}. ${o}`),
      ``,
      `**מה שסימן כל מפתח:**`,
      ...both.map((q) => `- ${cyc(q)} סימן: "${q.opts[q.a]}"`),
      ``,
      `**השאלה אליך:** שני המפתחות חלוקים. לפי חומרי הקורס — איזו טענה נכונה? ` +
        `ייתכן גם ששתי הטענות נכונות (ואז השאלה פגומה), או ששתיהן שגויות.`,
      ``,
    ].join('\n');
  };

  const COURSE_NAME = { molecular: 'ביולוגיה מולקולרית', electro: 'אלקטרופיזיולוגיה' };
  const prompt = [
    `# הכרעה בסתירות בין מפתחות תשובות — ${COURSE_NAME[askCourse] || askCourse}`,
    ``,
    ...(official
      ? [`אני בונה בנק שאלות ממאגר המבחנים הרשמי של הקורס (מאסטרים מהמודל, עם מפתח`,
         `תשובות רשמי). מצאתי שאלות שחזרו על עצמן בין שנים אקדמיות שונות, אבל **המפתח`,
         `הרשמי סימן בהן תשובות שונות**. כלומר הפקולטה עצמה לא הייתה עקבית, ולכן אחד`,
         `המפתחות כנראה שגוי.`]
      : [`אני בונה בנק שאלות משחזורי מבחן של סטודנטים לאורך כמה מחזורים. מצאתי שאלות`,
         `שחזרו על עצמן בין מחזורים, אבל **מפתחות התשובות של המחזורים אינם מסכימים**`,
         `על התשובה הנכונה. השחזורים נכתבו מהזיכרון ולכן אחד מהם עשוי לטעות.`]),
    ``,
    `**הכרע לפי חומרי הקורס בלבד.** אם החומר אינו מכריע — אמור זאת במפורש`,
    `ואל תנחש.`,
    ``,
    `---`,
    ``,
    ...open.map(block),
    `---`,
    ``,
    `## פורמט התשובה — חשוב`,
    ``,
    `לכל שאלה, החזר בדיוק את השורות הבאות ותו לא:`,
    ``,
    '```',
    `מזהה: <המזהה שמופיע בכותרת השאלה>`,
    `התשובה הנכונה: <העתק את נוסח המסיח הנכון במדויק, מתוך הרשימה למעלה>`,
    `נימוק: <משפט אחד או שניים, בהתבסס על חומרי הקורס>`,
    '```',
    ``,
    `אם שתי הטענות נכונות, כתוב בשדה "התשובה הנכונה" את המסיח שהוא **הנכון ביותר**,`,
    `וציין בנימוק שגם האחר נכון ולכן השאלה פגומה.`,
    `אם החומר אינו מכריע, כתוב בשדה "התשובה הנכונה" את המילה: לא הוכרע`,
    ``,
  ].join('\n');

  const out = path.join(__dirname, 'sources', 'ask-notebooklm.md');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, prompt, 'utf8');

  console.log(prompt);
  console.log(`\n📋 נשמר גם ב-${path.relative(__dirname, out)} — העתק לנוטבוק.`);
  console.log(`   כשתחזור התשובה, רשום אותה ב-exams/repeats-ledger.json תחת "truth":`);
  console.log(`     "<מזהה>": { "answer": "<נוסח המסיח>", "why": "<הנימוק>" }\n`);
  process.exit(0);
}

/* --- מצב סקירה: מציג את הגבוליים כדי להכריע ולרשום בפנקס --- */
if (process.argv.includes('--review')) {
  const clashes = report.clashes.filter((c) => ledger.answers[c.key] == null);

  if (clashes.length) {
    console.log(`\n═══ ${clashes.length} תשובות חלוקות — סתירה אמיתית, או אותה תשובה בניסוח אחר? ═══\n`);
    clashes.forEach((c, k) => {
      const hint = meta(c.x.opts[c.x.a]) || meta(c.y.opts[c.y.a]) ? '   (מסיח-על — כנראה "opts")' : '';
      console.log(`── ${k + 1}/${clashes.length}   "${c.key}"   → ledger.answers${hint}`);
      [c.x, c.y].forEach((q) => {
        console.log(`   [${q._exam.label} · שאלה ${q._n} · ${q._exam.data.trust}] ${q.q.slice(0, 70)}`);
        console.log(`        ✔ ${q.opts[q.a]}`);
        q.opts.forEach((o, i) => { if (i !== q.a) console.log(`          · ${o.slice(0, 68)}`); });
      });
      console.log();
    });
    console.log('   true   = אותה תשובה, ניסוח שונה');
    console.log('   "opts" = ערכות המסיחים היו שונות — כל תשובה נכונה למסיחים שלה');
    console.log('   false  = סתירה אמיתית — אחד המפתחות טועה\n' + '═'.repeat(78) + '\n');
  }

  if (report.pending.length) {
    console.log(`\n═══ ${report.pending.length} זוגות גבוליים — אותה שאלה או לא? ═══\n`);
    report.pending.forEach((p, k) => {
      const key = pairKey(p.a.qid, p.b.qid);
      console.log(`── ${k + 1}/${report.pending.length}  ציון ${(p.s * 100).toFixed(0)}%  ` +
        `(טקסט ${(p.text * 100).toFixed(0)} · מסיחים ${(p.opts * 100).toFixed(0)} · תשובה ${(p.ans * 100).toFixed(0)} · נדיר ${(p.rar * 100).toFixed(0)})`);
      console.log(`   "${key}"   → ledger.pairs`);
      [p.a, p.b].forEach((q) => {
        console.log(`\n   [${q._exam.label} · שאלה ${q._n}]  ${q.topic || '—'}`);
        console.log(`   ${q.q}`);
        q.opts.forEach((o, i) => console.log(`      ${i === q.a ? '✔' : ' '} ${o}`));
      });
      console.log('\n' + '─'.repeat(78) + '\n');
    });
    console.log('   true  = אותה שאלה');
    console.log('   false = שאלות שונות\n');
  }

  if (!clashes.length && !report.pending.length) console.log('\n✅ אין מה להכריע. הכול סגור.\n');
}

module.exports = { report };
