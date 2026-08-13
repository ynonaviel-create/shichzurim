#!/usr/bin/env python3
"""כותב הסברים לשאלות בעזרת הנוטבוק של הקורס.

    python3 explain-ask.py <course>              # כל השאלות בלי הסבר
    python3 explain-ask.py <course> <file.json>  # קובץ אחד
    python3 explain-ask.py <course> --limit 10   # לדגום לפני שרצים על הכול
    python3 explain-ask.py <course> --merge      # לכתוב את המאושרים לקבצים

למה זה קיים: `sync.js` חוסם קורס מחמיר שיש בו שאלה בלי `explain`. שער בלי דרך
לעבור אותו הוא רק מכשול — זה הכלי שעובר אותו.

⚠️ מצב הכלי (13/08/2026): עובד, ועדיין דורש כוונון. התוכן מעוגן ואיכותי,
המרקדאון מנוקה, והציטוטים חוזרים — אבל **הנוטבוק עדיין קוטע משפטי פסילה
באמצע** ("…ואינו יכול.", "…שכן אנרגיה זו."). הפרסר מדלג על קטיעות שהוא מזהה
לפי מילת יחס בסוף, אבל לא על כולן. לכן: **לעבור על הפלט לפני --merge**, ולא
לסמוך על "approved" בעיוורון. כוונון הפרומפט הוא המשימה הפתוחה כאן.

מאיפה מגיע ההסבר: מהנוטבוק של הקורס, שאליו מחוברים ההרצאות, הסיכומים
והשחזורים. לא מהידע הכללי שלי — בדיוק כמו בהכרעות תוכן.

מה נשמר: `sources/explain-<course>.json`, עם ההסבר **והציטוטים**. הציטוטים הם
הבדיקה היחידה, כי הנוטבוק יודע לבדות ראיות. `--merge` כותב לקבצי המבחן רק את
מה שסומן `"approved": true`.

הפורמט מחייב — ראו QUESTION-STANDARD.md:
  הסבר של 2-5 משפטים שמלמד את המנגנון, ואחריו משפט קצר לכל מסיח שמתחיל
  ב„המסיח ה<סידורי>”. הסידורי הוא מקום התשובה ברשימה, 1-בסיס, כולל הנכונה.
"""

import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
EXAMS = os.path.join(ROOT, 'exams')
SRC = os.path.join(ROOT, 'sources')

NOTEBOOKS = {
    'molecular': 'fde08647-9ae3-4461-9f10-398b13df5e38',
    'electro':   'c877c802-667e-422c-b0b3-efc3bb6ccbef',
    'physics':   'ebc4446e-4ffc-4cd9-b253-3c3cf5cbbbd9',
    'biochem':   '92767c70-ee23-4e3e-b6dc-7c2cdd64bd80',
}

ORD = ['הראשון', 'השני', 'השלישי', 'הרביעי', 'החמישי', 'השישי']

PROMPT = """להלן שאלה אמריקאית ממבחן בקורס {course}. התשובה הנכונה כבר ידועה
ומסומנת — אל תשנה אותה ואל תערער עליה. המשימה שלך היא רק לכתוב הסבר.

השאלה: {q}

המסיחים:
{opts}

התשובה הנכונה היא מסיח מספר {a} — "{ans}".

כתוב הסבר בדיוק במבנה הזה, ותו לא:

הסבר: <2 עד 4 משפטים שמלמדים *למה* התשובה נכונה — המנגנון או העיקרון, לא רק
המסקנה. מעוגן בחומרי הקורס.>
{rejects}

כללים:
- רק מה שמעוגן בחומרי הקורס. אם אין לך ביסוס לפסילה של מסיח מסוים — כתוב
  במקומה „אין ביסוס בחומר”, ואל תמציא.
- כל פסילה במשפט אחד **שלם**. קצר עדיף, אבל אל תקטע באמצע משפט.
- **בלי מרקדאון.** בלי כוכביות, בלי הדגשות, בלי כותרות. טקסט רגיל בלבד.
- צרף ציטוטים למקורות בסוגריים מרובעים, כמו שאתה עושה בדרך כלל.
- בלי מספור נוסף, בלי טקסט מעבר לשורות שביקשתי."""

CITE = re.compile(r'\s*\[[\d,\s\-]+\]')
MD = re.compile(r'\*\*|__|`')


def clean(t):
    """מרקדאון אסור בסטנדרט: האתר מרנדר טקסט רגיל, וכוכביות פשוט מוצגות."""
    return re.sub(r'\s{2,}', ' ', MD.sub('', t)).strip()


def run(args, timeout=300):
    p = subprocess.run(['notebooklm'] + args, capture_output=True, text=True, timeout=timeout)
    return p.stdout + p.stderr


def parse(answer, n_opts):
    """מרכיב מחרוזת explain אחת מהתשובה, בפורמט של QUESTION-STANDARD."""
    body = None
    rejects = {}
    for line in answer.splitlines():
        line = line.strip()
        m = re.match(r'^הסבר:\s*(.+)$', line)
        if m:
            body = m.group(1).strip()
            continue
        m = re.match(r'^פסילה\s+(\d+):\s*(.+)$', line)
        if m:
            rejects[int(m.group(1))] = m.group(2).strip()
    if not body:
        return None, ''
    cites = CITE.findall(body) + [c for v in rejects.values() for c in CITE.findall(v)]
    body = clean(CITE.sub('', body))
    parts = [body if body.endswith('.') else body + '.']
    for i in range(1, n_opts + 1):
        r = clean(CITE.sub('', rejects.get(i, '')))
        if not r or 'אין ביסוס' in r:
            continue
        r = r.rstrip('.')
        # פסילה שנקטעת באמצע („…ולא בקודון של”) גרועה מפסילה שאין. מדלגים.
        if re.search(r'(של|את|עם|כי|ולא|אלא|בין|על|אינו|ואינו)$', r):
            continue
        parts.append(f'המסיח {ORD[i - 1]} שגוי כי {r}.' if not r.startswith('המסיח') else r + '.')
    return ' '.join(parts), ' '.join(c.strip() for c in cites)


def quiz_files(course):
    out = []
    for f in sorted(os.listdir(EXAMS)):
        if not f.endswith('.json'):
            continue
        try:
            j = json.load(open(os.path.join(EXAMS, f), encoding='utf-8'))
        except Exception:
            continue
        if j.get('course') == course and isinstance(j.get('questions'), list):
            out.append((f, j))
    return out


def merge(course, store):
    """כותב לקבצי המבחן רק מה שאושר. `qid` הוא המפתח — לא מיקום."""
    by_qid = {k: v for k, v in store['questions'].items() if v.get('approved')}
    if not by_qid:
        print('אין הסברים מאושרים. סמן "approved": true במה שבדקת.')
        return
    n = 0
    for f, j in quiz_files(course):
        touched = False
        for q in j['questions']:
            e = by_qid.get(q.get('qid'))
            if e and not q.get('explain'):
                q['explain'] = e['explain']
                touched = True
                n += 1
        if touched:
            with open(os.path.join(EXAMS, f), 'w', encoding='utf-8') as fh:
                fh.write(json.dumps(j, ensure_ascii=False, indent=2) + '\n')
    print(f'נכתבו {n} הסברים. הרץ `node sync.js`.')


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in NOTEBOOKS:
        print('שימוש: python3 explain-ask.py <' + '|'.join(NOTEBOOKS) + '> [קובץ|--limit N|--merge]')
        return 1
    course = sys.argv[1]
    rest = sys.argv[2:]
    names = {'molecular': 'ביולוגיה מולקולרית תאית', 'electro': 'אלקטרופיזיולוגיה',
             'physics': 'פיזיקה לרפואנים ב׳', 'biochem': 'ביוכימיה'}
    out_path = os.path.join(SRC, f'explain-{course}.json')
    store = {'questions': {}}
    if os.path.exists(out_path):
        store = json.load(open(out_path, encoding='utf-8'))
    store.setdefault('_note', 'הסברים מהנוטבוק, ממתינים לאישור. הציטוטים הם הבדיקה — '
                              'הנוטבוק יודע לבדות ראיות. סמן "approved": true ואז --merge.')
    store.setdefault('questions', {})

    if '--merge' in rest:
        merge(course, store)
        return 0

    limit = None
    if '--limit' in rest:
        limit = int(rest[rest.index('--limit') + 1])
    only = next((r for r in rest if r.endswith('.json')), None)

    todo = []
    for f, j in quiz_files(course):
        if only and f != only:
            continue
        for q in j['questions']:
            if q.get('explain') or not q.get('qid') or not isinstance(q.get('opts'), list):
                continue
            if q['qid'] in store['questions']:
                continue
            todo.append((f, q))
    if limit:
        todo = todo[:limit]
    if not todo:
        print('אין שאלות בלי הסבר שממתינות.')
        return 0

    print(f'{len(todo)} שאלות. שואל את הנוטבוק אחת-אחת…\n')
    run(['use', NOTEBOOKS[course]])
    ok = 0
    for i, (f, q) in enumerate(todo, 1):
        opts = '\n'.join(f'{k + 1}. {o}' for k, o in enumerate(q['opts']))
        rejects = '\n'.join(f'פסילה {k + 1}: <למה מסיח {k + 1} שגוי — משפט אחד>'
                            for k in range(len(q['opts'])) if k != q['a'])
        prompt = PROMPT.format(course=names[course], q=q['q'], opts=opts,
                               a=q['a'] + 1, ans=q['opts'][q['a']], rejects=rejects)
        print(f'  [{i}/{len(todo)}] {q["q"][:52]}… ', end='', flush=True)
        try:
            ans = run(['ask', prompt])
        except subprocess.TimeoutExpired:
            print('פסק זמן')
            continue
        text, cites = parse(ans, len(q['opts']))
        if not text:
            print('לא נותח')
            continue
        store['questions'][q['qid']] = {'file': f, 'q': q['q'][:80], 'explain': text,
                                        'cites': cites, 'approved': False}
        ok += 1
        print('✓')
        json.dump(store, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

    print(f'\n{ok} הסברים נשמרו ב-sources/explain-{course}.json — ממתינים לאישור.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
