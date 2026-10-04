#!/usr/bin/env python3
"""ביקורת כיווניות וקריאות לכל התוכן — שאלות, מפות ולומדות.

    python3 tools/audit-bidi.py            # ספירה לכל קורס ולכל קטגוריה
    python3 tools/audit-bidi.py -v CAT     # כל המופעים של קטגוריה אחת
    python3 tools/audit-bidi.py --strict   # יציאה 1 אם יש מופע בקטגוריה „חוסמת”

רוב מה שהיה הפוך מתוקן בזמן התצוגה (bidiFix ב-assets/app.js, והתאום
tools/bidi_fix.py ללומדות). מה שנשאר כאן הוא מה שאי אפשר לתקן בקוד:
טקסט ששמור בסדר ויזואלי (הדבקה מ-PDF), סוגריים לא מאוזנים, HTML גולמי
בשדה טקסט — ושאריות מלכודות, שבוטלו (04/10/2026).
"""
import glob
import json
import os
import re
import sys
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HEB = 'א-ת'

# קטגוריה: (ביטוי, חוסמת?, הסבר)
CHECKS = {
    'visual-order': (re.compile(
        r'\)[' + HEB + r'][^()]{0,40}\(|'          # „)כיב(” — סוגריים הפוכים סביב עברית
        r'\b\d+(?:\.\d+)?=[A-Za-z]{1,4}\b|'        # „9.5=PK” — צריך PK=9.5
        r'[A-Za-z]\)[A-Za-z]{3,}\)|'               # „LPS)lipopolysaccharide)”
        r'[⁺⁻][A-Za-z]{2,}'                         # „⁺Gram”
    ), True, 'טקסט ששמור בסדר ויזואלי (הדבקה מ-PDF) — תיקון ידני בנתונים'),
    'unbalanced-parens': (None, False, 'מספר ( שונה ממספר ) — לבדוק אחד-אחד'),
    'raw-html': (re.compile(r'</?(?:b|i|br|sup|sub)\s*/?>'), True,
                 'תגית HTML בשדה שמוצג כטקסט (q/opts/explain/note/what)'),
    'prefix-space-minus': (re.compile(r'(?:^|\s)[בכלמהוש] -\d'), False,
                           '„כ -53%” — מקף של תחילית עם רווח מיותר; bidiFix לא נוגע בזה בכוונה'),
    'trap-leftover': (re.compile(r'"trap"\s*:|class="traps?[" ]|renderTraps|g-point-trap'), True,
                      'שארית מהמלכודות שבוטלו'),
}

TEXT_FIELDS = ('q', 'explain', 'note', 'noteAfter', 'what', 'point', 'opts')
HTML_OK_FIELDS = ('summary', 'gap', 'body', 'why', 'use', 'asked', 'lack', 'mnem', 'quote', 'info', 'sub')


def parens_ok(s):
    """סוגריים מאוזנים. „)” בלי פותח שבא אחרי „1”/„A”/„א” בתחילת מילה הוא מספור רשימה („1) … 2)”), לא יתום."""
    depth = 0
    for m in re.finditer(r'[()]', s):
        if m.group() == '(':
            depth += 1
        elif depth:
            depth -= 1
        elif not re.search(r'(?:^|[\s=:,>])(?:\d{1,2}|[A-Za-z]|[\u05d0-\u05ea])$', s[:m.start()]):
            return False
    return depth == 0


def walk(o, path=''):
    if isinstance(o, dict):
        for k, v in o.items():
            yield from walk(v, f'{path}.{k}' if path else k)
    elif isinstance(o, list):
        for i, v in enumerate(o):
            yield from walk(v, f'{path}[{i}]')
    elif isinstance(o, str):
        yield path, o


def field_of(path):
    m = re.findall(r'([A-Za-z]+)(?:\[\d+\])?$', path)
    return m[-1] if m else ''


def course_of(fname):
    base = os.path.basename(fname)
    for pre in ('ekronot-a', 'ekronot-b'):
        if base.startswith(pre):
            return pre
    return base.split('-')[0].split('.')[0]


def audit():
    hits = defaultdict(list)
    for f in sorted(glob.glob(os.path.join(ROOT, 'exams', '*.json')) +
                    glob.glob(os.path.join(ROOT, 'exams', '_staging', '**', '*.json'), recursive=True)):
        if os.path.basename(f) in ('manifest.json',):
            continue
        try:
            d = json.load(open(f, encoding='utf-8'))
        except Exception:
            continue
        raw = open(f, encoding='utf-8').read()
        if CHECKS['trap-leftover'][0].search(raw):
            hits['trap-leftover'].append((f, '', 'השדה trap קיים'))
        for path, s in walk(d):
            fld = field_of(path)
            if fld in TEXT_FIELDS:
                if CHECKS['raw-html'][0].search(s):
                    hits['raw-html'].append((f, path, s))
            if fld in TEXT_FIELDS or fld in HTML_OK_FIELDS:
                if CHECKS['visual-order'][0].search(s):
                    hits['visual-order'].append((f, path, s))
                # הערה שמצטטת בכוונה את הצורה השבורה („2)R,3R)-” … בגלל כיווניות) — לא שגיאה
                if not parens_ok(s) and not re.search('כיווני', s):
                    hits['unbalanced-parens'].append((f, path, s))
                if CHECKS['prefix-space-minus'][0].search(s):
                    hits['prefix-space-minus'].append((f, path, s))
    for f in sorted(glob.glob(os.path.join(ROOT, 'guides', '*.html'))):
        h = open(f, encoding='utf-8').read()
        if CHECKS['trap-leftover'][0].search(re.sub(r'<!-- dockit:start -->.*?<!-- dockit:end -->', '', h, flags=re.S)):
            hits['trap-leftover'].append((f, '', 'class="trap" או .traps'))
    return hits


def main():
    hits = audit()
    if '-v' in sys.argv:
        cat = sys.argv[sys.argv.index('-v') + 1]
        for f, path, s in hits.get(cat, []):
            print(f'{os.path.relpath(f, ROOT)}  {path}\n    {s[:220]}')
        return
    print('ביקורת כיווניות וקריאות\n')
    for cat, (_, blocking, why) in CHECKS.items():
        n = len(hits.get(cat, []))
        by = Counter(course_of(f) for f, _, _ in hits.get(cat, []))
        mark = '❌' if (n and blocking) else ('⚠️ ' if n else '✅')
        print(f'{mark} {cat:20} {n:4}   {why}')
        if n:
            print('      ' + ' · '.join(f'{c} {k}' for c, k in by.most_common()))
    if '--strict' in sys.argv and any(hits.get(c) for c, v in CHECKS.items() if v[1]):
        sys.exit(1)


if __name__ == '__main__':
    main()
