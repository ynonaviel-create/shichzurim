#!/usr/bin/env python3
"""תיקוני כיווניות לטקסט עברי — התאום של bidiFix ב-assets/app.js.

כל כלל כאן נמדד בדפדפן (מיקום התווים על המסך, 30/09 ו-04/10/2026):
  1. טווח מספרים עם מקף ארוך — „2–4%” מוצג „4–2%”. מקף רגיל בסדר.
  2. סימן עילי בסוף מילה לטינית — „NAD⁺” מוצג „⁺NAD”. LRM אחריו.
  3. מינוס מוביל — „-70mV” מוצג „70mV-”. LRM לפניו (W7 הופך את הספרות ל-LTR).
     לא אחרי אות-תחילית בודדת עם רווח („כ -53%” — מקף של תחילית, לא מינוס).
  4. מטען ASCII בסוף נוסחה כימית — „H+ לחלל” מוצג „+H”. LRM אחריו.
     רק נוסחה (H, OH, Fe2, NH4); סיומת כמו „(olol-)” כבר מוצגת נכון.
  5. חץ → בהקשר עברי מצביע אחורה (חצים לא משתקפים) — הופך ל-←, אלא אם משני
     צדדיו אותיות לטיניות. חצי ASCII מתורגמים לפי המשמעות.

    python3 tools/bidi_fix.py guides/x.html [...]   # תיקון סטטי במסמכים
"""
import re
import sys

LRM = '‎'
HEB = re.compile('[א-ת]')
LAT = re.compile('[A-Za-z\u00c0-\u024f\u0370-\u03ff]')   # כל אות LTR חזקה: לטינית, מורחבת, יוונית (α(1→6))


def fix_text(s):
    """כללים 1–4 על טקסט פשוט (לא HTML)."""
    s = re.sub(r'(?<=\d)–(?=\d)', '-', s)
    s = re.sub('([⁺⁻])(?![‎⁺⁻⁰-⁹A-Za-z0-9])', '\\1' + LRM, s)

    def minus(m):
        pre = m.group(1)
        if pre.isspace() and re.search(r'(^|\s)[בכלמהוש]$', m.string[:m.start()]):
            return m.group(0)
        return pre + LRM + m.group(2)
    s = re.sub(r'(^|[\s(\[,=:>])([-−])(?=\d)', minus, s)
    s = re.sub(r'(\b(?:[A-Z][a-z]?\d*)+)([+-]{1,2})(?=[\s,.;:)\]]|$)', '\\1\\2' + LRM, s)
    return s


def fix_arrows(s, html=False):
    """כלל 5. ב-html=True מדלגים על תגיות בחיפוש האות הקרובה."""
    if not re.search(r'→|->|<-|-&gt;|&lt;-', s):
        return s
    if html:
        s = s.replace('&lt;--&gt;', '↔').replace('&lt;-&gt;', '↔')
        s = re.sub(r'(?<!<!)--?&gt;', '\ue000', s)
        s = re.sub(r'&lt;--?', '\ue001', s)
    else:
        s = re.sub(r'<-{1,2}>', '↔', s)
        s = re.sub(r'-{1,2}>', '\ue000', s)
        s = re.sub(r'<-{1,2}', '\ue001', s)

    def side(i, step):
        """הכיוון של הפריט הקרוב. ספרה מקבלת את כיוון האות החזקה שלפניה (W7),
        ולכן קדימה — ספרה שווה לכיוון של הצד האחורי."""
        in_tag = False
        j = i + step
        while 0 <= j < len(s):
            c = s[j]
            if html and c == ('>' if step < 0 else '<'):
                in_tag = True
            elif html and in_tag:
                if c == ('<' if step < 0 else '>'):
                    in_tag = False
            elif LAT.match(c):
                return 'L'
            elif HEB.match(c):
                return 'R'
            elif step > 0 and c.isdigit():
                return side(i, -1)
            j += step
        return None

    def leading(i):
        j = i - 1
        while j >= 0 and s[j].isspace():
            j -= 1
        if j < 0:
            return True
        if html and s[j] == '>':
            k = s.rfind('<', 0, j)
            return k >= 0 and s[k + 1:k + 2] != '/'
        return False

    out = []
    for i, c in enumerate(s):
        if c not in ('→', '\ue000', '\ue001'):
            out.append(c)
            continue
        # חץ שפותח טקסט (בתחילת המחרוזת או מיד אחרי תגית פותחת) הוא אייקון —
        # „→ חזרה לעמוד הקורס” בסרגל — ובעמוד RTL הוא נכון. מחברים רק חץ שבין שני פריטים.
        if c == '→' and leading(i):
            out.append(c)
            continue
        ltr = side(i, -1) == 'L' and side(i, 1) == 'L'
        fwd = c != '\ue001'
        out.append('→' if fwd == ltr else '←')
    return ''.join(out)


SKIP = ('script', 'style', 'svg', 'code', 'pre', 'textarea')
TOKEN = re.compile(r'(<!--.*?-->|<[^>]+>)', re.S)


def fix_html(html):
    """כללים 1–4 רק בצמתי טקסט (לא בתגיות, ב-style inline או ב-script/svg/code),
    וכלל 5 על כל קטע תוכן — עם דילוג על תגיות בחיפוש ההקשר."""
    parts = TOKEN.split(html)
    depth = {k: 0 for k in SKIP}
    for i, p in enumerate(parts):
        if i % 2:
            m = re.match(r'<(/?)([a-zA-Z0-9]+)', p)
            if m and m.group(2).lower() in depth and not p.endswith('/>'):
                depth[m.group(2).lower()] += -1 if m.group(1) else 1
            continue
        if any(depth.values()) or not p:
            continue
        parts[i] = fix_text(p)
    html = ''.join(parts)
    # חצים: רק בקטעים שאינם script/style/svg/code — בונים מחדש עם אותו מעקב
    parts = TOKEN.split(html)
    depth = {k: 0 for k in SKIP}
    seg_start = None
    out = []
    buf = []

    def flush():
        if buf:
            out.append(fix_arrows(''.join(buf), html=True))
            buf.clear()
    for i, p in enumerate(parts):
        if i % 2:
            m = re.match(r'<(/?)([a-zA-Z0-9]+)', p)
            tag = m.group(2).lower() if m else ''
            if tag in depth and not p.endswith('/>'):
                if not m.group(1):
                    if not any(depth.values()):
                        flush()
                    depth[tag] += 1
                    out.append(p)
                    continue
                depth[tag] -= 1
                out.append(p)
                continue
        if any(depth.values()):
            out.append(p)
        else:
            buf.append(p)
    flush()
    return ''.join(out)


def fix_doc(html):
    """מסמך שלם: רק בתוך <body>, ומדלג על בלוק ה-dockit."""
    b = html.find('<body')
    if b < 0:
        return html
    head, body = html[:b], html[b:]
    m = re.search(r'<!-- dockit:start -->.*?<!-- dockit:end -->', body, re.S)
    if m:
        return head + fix_html(body[:m.start()]) + m.group(0) + fix_html(body[m.end():])
    return head + fix_html(body)


if __name__ == '__main__':
    for f in sys.argv[1:]:
        h = open(f, encoding='utf-8').read()
        n = fix_doc(h)
        if n != h:
            open(f, 'w', encoding='utf-8').write(n)
        print(f, 'שונה' if n != h else 'ללא שינוי')
