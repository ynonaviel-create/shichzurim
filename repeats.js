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

/* מקצועות שבהם מחפשים חזרות. מקצוע נכנס לכאן כשיש בו לפחות 3 שחזורים
   עם שדה cycle — אחרת המדגם קטן מדי והספירה חסרת משמעות. */
const COURSES = ['molecular'];

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
   שורד עריכות טקסט, שינוי סדר שאלות, והוספת שחזורים. */
const mintQid = (examId, q) =>
  crypto.createHash('md5').update(examId + '|' + norm(q.q)).digest('hex').slice(0, 8);

/* "שחזור מחזור נ״א — מועד א׳" → "נ״א"  (ואם זה מועד ב׳: "נ״א ב׳") */
function label(exam) {
  const m = (exam.title || '').match(/מחזור\s+([^\s—–]+)/);
  const base = m ? m[1] : String(exam.cycle ?? exam.id);
  return exam.moed === 'ב' ? `${base} ב׳` : base;
}

function loadCourse(courseId) {
  const exams = [];
  for (const file of fs.readdirSync(EXAMS).sort()) {
    if (!file.endsWith('.json') || file === 'manifest.json' || file === 'courses.json') continue;
    if (file === path.basename(LEDGER)) continue;
    const p = path.join(EXAMS, file);
    const d = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (d.course !== courseId || d.kind !== 'shichzur' || d.cycle == null) continue;

    let touched = false;
    d.questions.forEach((q) => {
      if (!q.qid) { q.qid = mintQid(d.id, q); touched = true; }   // חד-פעמי, ואז קפוא
    });
    exams.push({ file, path: p, data: d, touched, label: label(d) });
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

for (const courseId of COURSES) {
  const exams = loadCourse(courseId);
  if (exams.length < 2) continue;

  const qs = [];
  exams.forEach((e) =>
    e.data.questions.forEach((q, i) =>
      qs.push({ ...q, _exam: e, _n: i + 1, _cycle: e.data.cycle, _trust: TRUST[e.data.trust] || 1 })
    )
  );

  /* --- ניקוד כל זוג משני מחזורים שונים --- */
  const accepted = [];
  const pending = [];
  for (let i = 0; i < qs.length; i++) {
    for (let j = i + 1; j < qs.length; j++) {
      if (qs[i]._cycle === qs[j]._cycle) continue;      // חזרה = בין מחזורים
      const r = score(qs[i], qs[j]);
      if (r.s < MAYBE) continue;

      const verdict = ledger.pairs[pairKey(qs[i].qid, qs[j].qid)];
      if (verdict === false) continue;                  // אדם פסל — מכובד תמיד
      if (verdict === true || r.s >= AUTO) { accepted.push([i, j, r]); continue; }
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
          else report.unresolved.push({ x: p, y: q, key });
          continue;
        }
        report.clashes.push({ x: p, y: q, key });                // טרם הוכרע — לא מוצג
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

    const stamp = { n: cycles.length, in: labels, span: Math.max(...cycles) - Math.min(...cycles) };
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
      const inv = [...g].filter((q) => negative(q.q) !== negative(rep.q)).map((q) => q._exam.label);
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
        `ℹ️ אותה שאלה, אבל ערכת המסיחים לא הייתה זהה בין המחזורים, ולכן גם התשובה הנכונה שונה: ${each}. ` +
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
          `⚠️ המחזורים היו חלוקים על התשובה: ${disagree}. ` +
          `✅ הוכרע מול חומרי הקורס: הנכונה היא "${ruling.answer}". ${ruling.why || ''}`.trim()
        );
        stamp.resolved = true;
      } else if (ruling) {
        /* הוכרע, אבל התשובה הנכונה לא הופיעה כמסיח באף אחד מהמחזורים —
           כלומר בכל הגרסאות שיש לנו השאלה פגומה. זה עצמו ממצא. */
        notes.push(
          `⚠️ המחזורים חלוקים: ${disagree}. ` +
          `❗ לפי חומרי הקורס התשובה הנכונה היא "${ruling.answer}" — והיא לא הוצעה כמסיח באף אחד ` +
          `מהמחזורים ששוחזרו. ${ruling.why || ''}`.trim()
        );
      } else {
        notes.push(
          `⚠️ המחזורים חלוקים על התשובה: ${disagree}. ` +
          `כאן מוצגת תשובת ${rep._exam.label}, שהמפתח שלו ${
            rep._exam.data.trust === 'verified' ? 'אומת בחשיפה' : 'האמין מבין אלה שנחלקו'
          } — אבל טרם הוכרע מי צודק. אל תשנן את השאלה הזאת; תבין אותה.`
        );
      }
    }
    if (rep.note) notes.push(rep.note);

    hy.push({ ...clean, qid, note: notes.join(' '), repeat: stamp, source: `שחזור מחזור ${rep._exam.label}` });
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
  const hyFile = path.join(EXAMS, `${courseId}-high-yield.json`);

  if (hy.length) {
    fs.writeFileSync(
      hyFile,
      JSON.stringify(
        {
          id: `${courseId}-high-yield`,
          course: courseId,
          part: null,
          title: 'High Yield — השאלות שחוזרות',
          kind: 'highyield',
          moed: null,
          added: new Date().toISOString().slice(0, 10),
          generated: true,
          note:
            `נבנה אוטומטית מ-${exams.length} השחזורים בארכיון (${exams.map((e) => e.label).join(', ')}). ` +
            `כל שאלה כאן הופיעה בשני מחזורים לפחות — זה ההימור הטוב ביותר למבחן הקרוב. ` +
            `הנוסח נלקח מהשחזור האמין ביותר מבין אלה שבהם הופיעה. ` +
            (conflicts
              ? `⚠️ ב-${conflicts} שאלות המחזורים חלוקים על התשובה הנכונה — הן מסומנות, וכדאי ללמוד אותן לעומק. `
              : '') +
            `הקובץ נוצר ע״י repeats.js ונדרס בכל sync — אין טעם לערוך אותו ידנית.`,
          questions: hy.map(({ qid, ...q }) => q),
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
    console.log(`\n   🔁 ${c.courseId}: ${c.clusters.length} שאלות חוזרות מתוך ${c.total} (${c.exams} מחזורים)`);
    const hist = {};
    c.clusters.forEach((g) => { const n = new Set(g.map((q) => q._cycle)).size; hist[n] = (hist[n] || 0) + 1; });
    Object.keys(hist).sort((a, b) => b - a).forEach((n) => console.log(`        חזרו ב-${n} מחזורים: ${hist[n]}`));
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

  const cyc = (q) => `מחזור ${q._exam.label}`;
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
      `**המסיחים שהוצעו (איחוד של שני המחזורים):**`,
      ...opts.map((o, k) => `${k + 1}. ${o}`),
      ``,
      `**מה שסימן כל מפתח:**`,
      ...both.map((q) => `- ${cyc(q)} סימן: "${q.opts[q.a]}"`),
      ``,
      `**השאלה אליך:** המפתחות של שני המחזורים חלוקים. לפי חומרי הקורס — איזו טענה נכונה? ` +
        `ייתכן גם ששתי הטענות נכונות (ואז השאלה פגומה), או ששתיהן שגויות.`,
      ``,
    ].join('\n');
  };

  const prompt = [
    `# הכרעה בסתירות בין שחזורי מבחן — ביולוגיה מולקולרית`,
    ``,
    `אני בונה בנק שאלות משחזורי מבחן של סטודנטים לאורך כמה מחזורים. מצאתי שאלות`,
    `שחזרו על עצמן בין מחזורים, אבל **מפתחות התשובות של המחזורים אינם מסכימים**`,
    `על התשובה הנכונה. השחזורים נכתבו מהזיכרון ולכן אחד מהם עשוי לטעות.`,
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
