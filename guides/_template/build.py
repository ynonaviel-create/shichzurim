#!/usr/bin/env python3
"""שלד "סיכום מלא" לקורס חדש — הפורמט של פיזיקה, בלי התוכן.

סיכום הפיזיקה הוא הפורמט שניצח בסקר ("ממש כמו לומדה"), ולכן הוא לא דוגמה
אלא התבנית עצמה: המחולל גוזר ממנו את העיצוב, ההקראה, הניווט, הכלים והסקריפטים
כמות שהם, ובונה מחדש רק את התוכן — שלד יחידות מתוך מפת החומרים של הקורס
(exams/<course>-guide.json), עם TODO בכל מקום שסוכן-כתיבה צריך למלא.

    python3 guides/_template/build.py <course-id>
    python3 guides/_template/build.py <course-id> --out <path>   # לתצוגה מקדימה

מה שנכנס לשלד מהמפה בחינם: שמות הבלוקים והיחידות (חייבים להיות זהים למפה —
זה מה שמחבר לתרגול), תמצית היחידה (what), המלכודות (points[].trap, עם TODO
על "האמת"), והסרטונים המאומתים. השאר — פרוזה, איורים, חיבור רפואי — נכתב
לפי הסקיל write-study-guide.

אחרי מילוי התוכן: python3 guides/_template/inject.py (להוסיף את המסמך
ל-DOCS שם) — זה מטמיע את ערכת ה-doc-kit: סימון על הטקסט, שער "נסה קודם",
פס התקדמות.
"""
import argparse
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).parent
ROOT = HERE.parent.parent
BASE = HERE.parent / "physics-full.html"

SPEAK = ('<span class="speak-wrap"><button class="speak" type="button">🔊 הקראה</button>'
         '<button class="speak-stop" type="button" title="עצירה" aria-label="עצירת ההקראה">⏹</button></span>')


def load_course(cid):
    data = json.loads((ROOT / "exams" / "courses.json").read_text(encoding="utf-8"))
    courses = data["courses"] if isinstance(data, dict) and "courses" in data else data
    for c in courses:
        if c["id"] == cid:
            return c
    sys.exit(f"❌ הקורס '{cid}' לא נמצא ב-exams/courses.json — קודם כרטיס מקצוע (NEW-COURSE.md שלב 0)")


def load_guide(cid):
    for f in (ROOT / "exams").glob("*.json"):
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            continue
        if isinstance(d, dict) and d.get("kind") == "guide" and d.get("course") == cid:
            return d
    return None


def carve_base():
    """גזירת השלד הקבוע מסיכום הפיזיקה: head+עיצוב, ריל+כלים, וכל הסקריפטים."""
    h = BASE.read_text(encoding="utf-8")
    head = h[:h.index('<nav class="navbar"')]
    nav_end = h.index("</nav>") + len("</nav>")
    chrome = h[nav_end:h.index('<div class="cover">')]
    s = h.index("<script", h.index("</footer>"))
    e = h.index("<!-- dockit:start -->") if "<!-- dockit:start -->" in h else h.index("</body>")
    scripts = h[s:e]
    return head, chrome, scripts


def load_shinun_topics(cid):
    """נושאי השינון של הקורס — לשלדי ex-match. אין קובץ = אין תרגיל אוטומטי."""
    f = ROOT / "exams" / f"{cid}-shinun.json"
    if not f.exists():
        return set()
    try:
        d = json.loads(f.read_text(encoding="utf-8"))
        return {it["topic"] for g in d.get("groups", []) for it in g.get("items", []) if it.get("topic")}
    except Exception:
        return set()


def unit_html(cid, i, topic, u, shinun_topics=frozenset()):
    what = (u or {}).get("what", "")
    traps = [p["trap"] for p in (u or {}).get("points", []) if p.get("trap")]
    vids = [v for v in (u or {}).get("videos", []) if v.get("id")]
    out = [f'<section class="unit" id="u-t{i:02d}">']
    out.append(f"<h3>{topic}{SPEAK}</h3>")
    out.append(f'<p class="lead">{what or "<!-- TODO: משפט-שניים — הרעיון המרכזי בגובה העיניים -->"}</p>')
    out.append("\n<h4>הרעיון לעומק</h4>")
    out.append("<p><!-- TODO: 2–5 פסקאות מהמקורות בלבד. הדגשת <b>מושגי מפתח</b>. --></p>")
    out.append('\n<figure>\n<!-- TODO: SVG מוטבע, viewBox="0 0 520 H", צבעים דרך הקלאסים '
               '(.pos .neg .fld .lbl). בלי <b> בתוך <text>! -->\n'
               "<figcaption><!-- TODO: המסקנה שנבחנת, לא כיתוב --></figcaption></figure>")
    out.append("\n<h4>החיבור הרפואי</h4>")
    out.append("<p><!-- TODO: איפה זה פוגש רפואה. אם אין חיבור אמיתי — למחוק את הסקשן, לא להמציא. --></p>")
    out.append('\n<div class="traps">\n<h4>מלכודות</h4>')
    if traps:
        for t in traps:
            out.append(f'<div class="trap"><b>המלכודת:</b> {t} <b>האמת:</b> <!-- TODO: התיקון --></div>')
    else:
        out.append('<div class="trap"><b>המלכודת:</b> <!-- TODO: התפיסה השגויה --> '
                   "<b>האמת:</b> <!-- TODO: התיקון --></div>")
    out.append("</div>")
    # תרגיל התאמה: אם נושא היחידה קיים גם בשינון — הזוגות יגיעו משם בזמן
    # ריצה (data-shinun). אחרת שלד inline עם TODO — הצלבת topic↔topic בין
    # המפה לשינון חלשה בפועל, ולכן לא ממציאים התאמה אוטומטית רחבה יותר.
    if topic in shinun_topics:
        out.append(f'\n<div class="ex ex-match" data-shinun="{topic}"></div>')
    else:
        out.append('\n<!-- TODO תרגיל התאמה (אופציונלי אך רצוי): 3–5 זוגות מונח↔הגדרה '
                   'מתוך היחידה, או data-shinun="נושא א|נושא ב" אם יש נושאי שינון קרובים -->\n'
                   '<div class="ex ex-match">\n'
                   '<span data-t><!-- מונח --></span><span data-d><!-- ההגדרה שלו --></span>\n'
                   "</div>\n"
                   '<!-- TODO אם ביחידה יש תהליך רב-שלבי — תרגיל סידור: '
                   '<div class="ex ex-order"><b>כותרת</b><ol><li>שלב 1</li>…</ol></div> -->')
    if vids:
        out.append('\n<div class="vids">\n<h4>לצפייה</h4>')
        for v in vids:
            out.append(f'<div class="vid" data-yt="{v["id"]}"><b>{v.get("title", "")}</b>'
                       "<span><!-- TODO: למה לצפות ומה מכוסה --></span>"
                       '<div class="vq"><div class="vq-h">✔︎ אחרי הצפייה — בדקו שהבנתם</div>'
                       "<!-- TODO: 2–3 vq-item מהתמלול --></div></div>")
        out.append("</div>")
    else:
        out.append("\n<!-- TODO סרטונים: רק IDs שאומתו מול תמלול. אין — אז אין בלוק vids. -->")
    out.append(f'\n<a class="drill" href="../index.html#/practice/{cid}/{topic}" target="_blank" '
               'rel="noopener">✍️ לתרגל את הנושא הזה בארכיון ←</a></section>')
    return "\n".join(out)


def build(cid, out_path=None):
    c = load_course(cid)
    g = load_guide(cid)
    head, chrome, scripts = carve_base()

    # בלוקים: מהמפה אם יש, אחרת בלוק יחיד עם כל הנושאים מכרטיס המקצוע
    units = {u["topic"]: u for u in (g or {}).get("units", [])}
    blocks = (g or {}).get("blocks") or [{"key": "all", "title": "כל הנושאים", "icon": "📚",
                                          "topics": list(units) or c.get("topics", [])}]
    if not units and not c.get("topics"):
        sys.exit("❌ אין לא מפת חומרים ולא topics בכרטיס — אין ממה לבנות שלד (NEW-COURSE.md שלב 1)")

    name = c.get("name", cid)
    doc_title = f"{name} — הסיכום המלא"
    head = head.replace("פיזיקה ב׳ — הסיכום המלא", doc_title)
    scripts = scripts.replace("physRate", f"{cid}Rate").replace("physFont", f"{cid}Font")

    nav = ['<nav class="navbar" aria-label="ניווט לפי בלוק">']
    for b in blocks:
        nav.append(f'  <a href="#b-{b["key"]}">{b.get("icon", "")} {b["title"]}</a>')
    nav.append('  <a href="#last">⏱️ הרגע האחרון</a>\n</nav>')

    n_units = sum(len(b.get("topics", [])) for b in blocks)
    body = [f'''<div class="cover">
  <div class="eyebrow">ארכיון השחזורים · {name}</div>
  <h1>הסיכום המלא</h1>
  <div class="sub"><!-- TODO: משפט אחד — מה יש בפנים --></div>
  <div class="st">
    <div><b>{n_units}</b><span>נושאים</span></div>
    <!-- TODO: שאלות במבחן / שעות / מלכודות / סרטונים — כשהמספרים ידועים -->
  </div>
</div>

<div class="note"><b>קודם כול — אופי המבחן.</b> <!-- TODO: מה המבחן בודק ואיך זה מכתיב את הקריאה --></div>

<div class="howto">
<h2>איך משתמשים במסמך הזה</h2>
<div class="howto-g">
  <div><b>📖⚡🎮 שלושה מצבים</b><span>במתג למטה: קריאה מלאה כמעבר ראשון · מרוכז — רק התמצית, המלכודות ומה שבאמת נשאל · אינטראקטיבי — תרגילים ושערים.</span></div>
  <div><b>🖍️ סימון</b><span>בוחרים טקסט ולוחצים "סמן" — הסימון נשמר בדפדפן לפעם הבאה.</span></div>
  <div><b>🔊 האזנה</b><span>הקראה לכל נושא — הכפתור ליד הכותרת. אפשר להשהות, להמשיך ולשנות מהירות.</span></div>
  <div><b>✍️ תרגול</b><span>בסוף כל נושא — קישור ישיר לשאלות אמת מהארכיון. לקרוא ואז מיד לתרגל.</span></div>
</div>
</div>
''']

    body.append('<div class="toc">\n<h2>מה יש כאן</h2>\n<ol>')
    for b in blocks:
        n = len(b.get("topics", []))
        body.append(f'<li><a href="#b-{b["key"]}">{b["title"]}</a> — {n} נושאים</li>')
    body.append('<li><a href="#last">הרגע האחרון — השורה התחתונה של כל נושא</a></li>')
    body.append("</ol></div>")
    body.append("\n<!-- TODO מסלול צפייה (section#route): טבלת ★/+/◐ — רק אחרי שהסרטונים אומתו -->\n")

    i = 0
    shinun_topics = load_shinun_topics(cid)
    for b in blocks:
        body.append(f'\n<section class="block" id="b-{b["key"]}">')
        body.append(f'<h2>{b.get("icon", "")} {b["title"]}</h2>')
        for t in b.get("topics", []):
            i += 1
            body.append(unit_html(cid, i, t, units.get(t), shinun_topics))
        body.append("</section>")

    body.append('''
<section class="block" id="last">
<h2>⏱️ הרגע האחרון</h2>
<table><!-- TODO: ~20 שורות "נושא ← השורה התחתונה" --></table>
<div class="note"><!-- TODO: שלוש דקות לפני שנכנסים — פורמט, טקטיקה --></div>
</section>

<footer>
  <!-- TODO: מהמקורות של מי נכתב + הבהרה. אם אין שחזורים לקורס — לומר במפורש. -->
  <a href="../index.html#/course/''' + cid + '''">→ חזרה לעמוד הקורס בארכיון</a>
</footer>
''')

    out = (head + "\n".join(nav) + chrome + "\n".join(body) + "\n" + scripts + "\n</body>\n</html>\n")
    dest = Path(out_path) if out_path else ROOT / "guides" / f"{cid}-full.html"
    dest.write_text(out, encoding="utf-8")
    n_traps = len(re.findall(r'class="trap"', out))
    print(f"✅ {dest} — {n_units} יחידות, {n_traps} שלדי מלכודות, {out.count('TODO')} TODO")
    print("   המשך: מילוי תוכן לפי הסקיל write-study-guide (סוכן לכל בלוק),")
    print(f"   ואז: לרשום את המסמך ב-DOCS של inject.py — עם modes/qa" +
          (f"/shinun ('{cid}')" if shinun_topics else f" ('{cid}')") +
          " — ולהריץ inject.")
    print("   זה מוסיף: שלושת מצבי הקריאה, סימון, נסה-קודם, פאנל מה-באמת-נשאל והתרגילים.")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("course")
    ap.add_argument("--out")
    a = ap.parse_args()
    build(a.course, a.out)
