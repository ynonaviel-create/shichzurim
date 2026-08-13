#!/usr/bin/env python3
"""הטמעת doc-kit בסיכומים המלאים.

המסמכים חייבים להישאר קובץ אחד עצמאי, ולכן kit.css/kit.js לא נטענים כקבצים
אלא מוטמעים לתוך ה-HTML בין סמני dockit. הרצה חוזרת מחליפה את הבלוק —
כל שינוי בערכה הוא עריכת kit.* והרצה אחת:

    python3 guides/_template/inject.py            # כל המסמכים הרשומים
    python3 guides/_template/inject.py physics    # אחד
"""
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).parent
GUIDES = HERE.parent

# הקונפיגורציה של כל מסמך. מסמך חדש (מקורס חדש) נרשם כאן בשורה אחת.
# modes: שלושת מצבי הקריאה (read/focus/play) — unit=בורר היחידות, keep=מה
#        נשאר גלוי במצב מרוכז; כל השאר נעטף .dk-deep ומוסתר/מקופל.
# qa:    מזהה קורס למשיכת <course>-guide.json — פאנל "מה באמת נשאל" פר-נושא.
# shinun: מזהה קורס לזוגות התאמה (ex-match עם data-shinun) מקובץ השינון.
DOCS = {
    "physics-full.html": {
        "id": "physics-doc",
        "gate": ".trap",          # שער "נסה קודם" על "האמת:" במלכודות
        "maplinks": "physics",    # קישור "במפה" ליד כל קישור תרגול
        "modes": {"unit": "section.unit",
                  "keep": "h3, .lead, .traps, .drill, .dk-qa, .ex, .dk-more"},
        "qa": "physics",
        "shinun": "physics",
    },
    "electro-full.html": {
        "id": "electro-doc",
        "progress": False,        # יש לו פס התקדמות משלו (#ed-prog)
        "gate": None,             # יש לו שערי reveal משלו (wrapReveal)
        # מבנה הפרקים שונה (section.chap): במצב מרוכז נשארים הפתיח, המלכודות
        # וגבולות הגזרה. אם האימות בדפדפן מראה שבירה — מוחקים את השורה הזאת.
        "modes": {"unit": "section.chap",
                  "keep": "header.ch, .why, .trap, .bn, .dk-qa, .ex, .dk-more"},
        "qa": "electro",
        "shinun": "electro",
    },
}

START = "<!-- dockit:start -->"
END = "<!-- dockit:end -->"


def build_block(cfg):
    css = (HERE / "kit.css").read_text(encoding="utf-8")
    js = (HERE / "kit.js").read_text(encoding="utf-8")
    conf = {k: v for k, v in cfg.items() if k != "maplinks"}
    return (
        f"{START}\n"
        f"<style>\n{css}</style>\n"
        f"<script>window.DOCKIT={json.dumps(conf, ensure_ascii=False)};</script>\n"
        f"<script>\n{js}</script>\n"
        f"{END}"
    )


def add_map_links(html, course):
    """ליד כל קישור תרגול סטטי — קישור למפת החומרים של אותו נושא.
    אידמפוטנטי: מדלג על קישור שכבר יש אחריו dk-map."""
    pat = re.compile(
        r'(<a class="drill" href="\.\./index\.html#/practice/' + course +
        r'/([^"]+)"[^>]*>[^<]*</a>)(?!<a class="drill dk-map")')

    def repl(m):
        whole, topic = m.group(1), m.group(2)
        return (whole +
                f'<a class="drill dk-map" href="../index.html#/guide/{course}/{topic}"'
                f' target="_blank" rel="noopener"'
                f' title="מה באמת נשאל בנושא הזה — הנקודות, המלכודות והשאלות מהמבחנים">'
                f'🗺️ מה באמת נשאל ←</a>')

    return pat.sub(repl, html)


def validate(name, html, cfg):
    """שערי איכות על המסמך הסופי. לומדה שבורה לא יכולה לעלות — הבדיקות
    שהיו ידניות בדפדפן רצות כאן על כל הזרקה, וכשל מפיל את התהליך בקול."""
    errs, warns = [], []
    unit_sel = (cfg.get("modes") or {}).get("unit", "section.unit")
    if unit_sel == "section.unit":
        units = len(re.findall(r'<section class="unit[" ]', html))
        speak = len(re.findall(r'class="speak"', html))
        drills = len(re.findall(r'<a class="drill"(?! dk-map)', html))
        figs = len(re.findall(r"<figure>", html))
        if units and speak != units:
            errs.append(f"הקראה: {speak} כפתורים מול {units} יחידות")
        if units and drills != units:
            errs.append(f"קישורי תרגול: {drills} מול {units} יחידות")
        if units and figs < units:
            warns.append(f"איורים: {figs} מול {units} יחידות")

    # <b> בתוך <text> של SVG — שובר את פריסת הטקסט על הדף
    if re.search(r"<text[^>]*>(?:(?!</text>).)*?<b>", html, re.S):
        errs.append("<b> בתוך <text> של SVG — שובר את הפריסה")

    # כל עוגן פנימי מצביע על id קיים (עוגני #top- נפתרים בזמן ריצה — מוחרגים)
    ids = set(re.findall(r'id="([^"]+)"', html))
    for a in set(re.findall(r'href="#([^"/][^"]*)"', html)):
        if not a.startswith("top-") and a not in ids:
            errs.append(f"עוגן שבור: #{a}")

    # זוגות ex-match: מספר מונחים = מספר הגדרות, ומינימום 3
    for m in re.finditer(r'<div class="ex ex-match"(.*?)>(.*?)</div>', html, re.S):
        if "data-shinun" in m.group(1):
            continue
        t, d = m.group(2).count("data-t"), m.group(2).count("data-d")
        if t != d:
            errs.append(f"ex-match: {t} מונחים מול {d} הגדרות")
        elif 0 < t < 3:
            warns.append(f"ex-match עם {t} זוגות בלבד (מינימום מומלץ: 3)")

    if re.search(r'data-yt="\s*"', html):
        errs.append('data-yt ריק — כרטיס סרטון בלי מזהה')

    todos = html.count("TODO")
    if todos:
        warns.append(f"{todos} סימוני TODO במסמך חי")

    for w in warns:
        print(f"   ⚠️  {name}: {w}")
    if errs:
        for e in errs:
            print(f"   ❌ {name}: {e}")
        sys.exit(1)


def inject(name, cfg, check=True):
    path = GUIDES / name
    html = path.read_text(encoding="utf-8")
    if START in html:
        html = re.sub(re.escape(START) + r".*?" + re.escape(END), "<<<DOCKIT>>>",
                      html, flags=re.S)
    else:
        i = html.rindex("</body>")
        html = html[:i] + "<<<DOCKIT>>>\n" + html[i:]
    if cfg.get("maplinks"):
        html = add_map_links(html, cfg["maplinks"])
    if check:
        # על התוכן בלבד: הערכה עצמה מכילה דוגמאות קוד (ex-match בהערות
        # kit.js) שמפעילות את הבדיקות בטעות.
        validate(name, html.replace("<<<DOCKIT>>>", ""), cfg)
    html = html.replace("<<<DOCKIT>>>", build_block(cfg))
    path.write_text(html, encoding="utf-8")
    print(f"✅ {name}")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if a != "--no-validate"]
    check = "--no-validate" not in sys.argv
    only = args[0] if args else None
    for name, cfg in DOCS.items():
        if only and only not in name:
            continue
        inject(name, cfg, check=check)
