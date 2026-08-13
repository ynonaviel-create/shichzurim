#!/usr/bin/env python3
"""מבקש מ-NotebookLM כרטיסי אנקי נוספים לכל נושא, ושומר אותם לבדיקה.

    python3 anki-ask.py <course> [topic ...]      # נושאים מסוימים
    python3 anki-ask.py <course> --thin           # רק נושאים עם מעט כרטיסים
    python3 anki-ask.py <course> --all            # הכול

למה זה קיים: `anki-build.py` בונה כרטיסים ממפת החומרים בלבד — העתקה מדויקת של
נקודה ומלכודת, בלי להמציא. זה נאמן, אבל זה תקוע בגודל המפה: בפיזיקה יצאו 57
כרטיסים ל-21 נושאים, פחות משלושה לנושא.

לנוטבוק של הקורס מחוברים ההרצאות, הסיכומים והשחזורים, והוא **כן** יודע לפרוס
נושא לעומק. הסקריפט הזה שואל אותו נושא-נושא ושומר את התשובות.

‼️ מה שחוזר מהנוטבוק אינו נכנס לחפיסה מעצמו. הוא נשמר ל-`sources/` עם
הציטוטים, ינון עובר עליו, ורק כרטיס שאושר נכנס. הסיבה: הנוטבוק יודע לבדות
ראיות, והציטוטים הם הדרך היחידה לבדוק. אף כרטיס לא מגיע לסטודנט בלי שאדם
ראה אותו.

דורש: `notebooklm` ב-PATH, וקישור הנוטבוק בטבלה למטה.
"""

import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
EXAMS = os.path.join(ROOT, 'exams')
SRC = os.path.join(ROOT, 'sources')

# הנוטבוקים המשותפים לחשבון shichzurim52. מקצוע חדש — להוסיף שורה.
NOTEBOOKS = {
    'molecular': 'fde08647-9ae3-4461-9f10-398b13df5e38',
    'electro':   'c877c802-667e-422c-b0b3-efc3bb6ccbef',
    'physics':   'ebc4446e-4ffc-4cd9-b253-3c3cf5cbbbd9',
    'biochem':   '92767c70-ee23-4e3e-b6dc-7c2cdd64bd80',
}

PROMPT = """אני בונה כרטיסי אנקי לחזרה בקורס {course}, לנושא "{topic}".

תן לי {n} כרטיסים. לכל כרטיס שתי שורות בדיוק, בפורמט הזה ותו לא:

שאלה: <שאלה קצרה וממוקדת, שורה אחת>
תשובה: <תשובה של 1-2 משפטים שמלמדת את המנגנון>

כללים:
- רק מה שמעוגן בחומרי הקורס. אם משהו לא מופיע בהם — אל תכתוב אותו.
- להעדיף מה שהמרצה הדגיש ומה שחוזר במבחנים, אם זה מופיע במקורות.
- אל תחזור על אלה שכבר יש לי:
{have}
- בלי מספור, בלי כותרות, בלי טקסט נוסף."""

CITE = re.compile(r'\s*\[[\d,\s\-]+\]')


def run(args, timeout=240):
    p = subprocess.run(['notebooklm'] + args, capture_output=True, text=True, timeout=timeout)
    return p.stdout + p.stderr


def parse(answer):
    """שתי שורות לכרטיס. הציטוטים נשמרים בנפרד — הם הראיה, לא חלק מהכרטיס."""
    cards, q = [], None
    for line in answer.splitlines():
        line = line.strip()
        m = re.match(r'^שאלה:\s*(.+)$', line)
        if m:
            q = m.group(1).strip()
            continue
        m = re.match(r'^תשובה:\s*(.+)$', line)
        if m and q:
            a = m.group(1).strip()
            cites = CITE.findall(q) + CITE.findall(a)
            cards.append({'q': CITE.sub('', q).strip(),
                          'a': CITE.sub('', a).strip(),
                          'cites': ' '.join(c.strip() for c in cites)})
            q = None
    # שורות תשובה שנשברו לכמה שורות — מאחדים בגלישה פשוטה
    return [c for c in cards if len(c['q']) > 8 and len(c['a']) > 15]


def topics_of(course):
    g = json.load(open(os.path.join(EXAMS, f'{course}-guide.json'), encoding='utf-8'))
    out = []
    for u in g.get('units', []):
        t = (u.get('topic') or '').strip()
        pts = [p for p in (u.get('points') or []) if p.get('point') and p.get('trap')]
        if t:
            out.append((t, pts))
    return out


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in NOTEBOOKS:
        print('שימוש: python3 anki-ask.py <' + '|'.join(NOTEBOOKS) + '> [--thin|--all|נושא...]')
        return 1
    course = sys.argv[1]
    rest = sys.argv[2:]
    names = {'molecular': 'ביולוגיה מולקולרית תאית', 'electro': 'אלקטרופיזיולוגיה',
             'physics': 'פיזיקה לרפואנים ב׳', 'biochem': 'ביוכימיה'}

    allt = topics_of(course)
    if '--all' in rest:
        pick = allt
    elif '--thin' in rest:
        pick = [(t, p) for t, p in allt if len(p) <= 2]
    elif rest:
        pick = [(t, p) for t, p in allt if t in rest]
    else:
        pick = allt[:1]
    if not pick:
        print('אין נושאים תואמים.')
        return 1

    run(['use', NOTEBOOKS[course]])
    out_path = os.path.join(SRC, f'anki-{course}-notebook.json')
    store = {}
    if os.path.exists(out_path):
        store = json.load(open(out_path, encoding='utf-8'))
    store.setdefault('_note', 'תשובות גולמיות מהנוטבוק. לא נכנס לחפיסה עד שינון מאשר. '
                              'הציטוטים הם הבדיקה — הנוטבוק יודע לבדות ראיות.')
    store.setdefault('topics', {})

    for topic, pts in pick:
        have = '\n'.join('  · ' + p['point'] for p in pts) or '  (אין)'
        n = 6 if len(pts) <= 2 else 4
        print(f'▸ {topic} … ', end='', flush=True)
        try:
            ans = run(['ask', PROMPT.format(course=names[course], topic=topic, n=n, have=have)])
        except subprocess.TimeoutExpired:
            print('פסק זמן')
            continue
        cards = parse(ans)
        store['topics'][topic] = {'cards': cards, 'approved': False}
        print(f'{len(cards)} כרטיסים')

    json.dump(store, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    total = sum(len(v['cards']) for v in store['topics'].values())
    print(f'\nנשמר: sources/anki-{course}-notebook.json · {total} כרטיסים ממתינים לאישור')
    return 0


if __name__ == '__main__':
    sys.exit(main())
