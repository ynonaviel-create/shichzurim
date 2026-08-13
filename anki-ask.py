#!/usr/bin/env python3
"""מבקש מ-NotebookLM כרטיסי אנקי לכל נושא, ושומר אותם לבדיקה.

    python3 anki-ask.py <course> [topic ...]      # נושאים מסוימים
    python3 anki-ask.py <course> --all            # הכול

התפיסה (הבנייה מחדש, 08/2026): מפת החומרים היא **סדר היום** — היא קובעת על
מה שואלים — אבל טקסט הכרטיס נכתב על ידי הנוטבוק, שמחוברים אליו ההרצאות,
הסיכומים והשחזורים. הגרסה הראשונה העתיקה את טקסט המפה עצמו לכרטיסים,
וטקסט של סיכום אינו טקסט של כרטיס: פסקאות, כמה עובדות בכרטיס, צד קדמי
שהוא אמירה. לכן עכשיו: לכל נקודה במפה הנוטבוק כותב 1–3 כרטיסים אטומיים
בפורמט "שאלה: / תשובה:" — הפורמט הזה כבר נבדק ועובד.

‼️ מה שחוזר מהנוטבוק לא נכנס לחפיסה מעצמו. הוא נשמר ל-`sources/` עם
הציטוטים, עובר את שערי האיכות של `anki-build.py`, ובדיקה אנושית/ויזואלית
של הכרטיסים המרונדרים. הציטוטים הם הראיה — הנוטבוק יודע לבדות.

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

PROMPT = """אני כותב כרטיסי אנקי (שאלה-תשובה) לקורס {course}, לנושא "{topic}".

למטה רשימת נקודות ממפת החומרים של הקורס. לכל נקודה כתוב 1–3 כרטיסים
שמכסים אותה. אם בנקודה כמה עובדות נפרדות — פצל אותן לכרטיסים נפרדים.

פורמט לכל כרטיס, שלוש שורות בדיוק:
נקודה: <מספר הנקודה שהכרטיס מכסה>
שאלה: <שאלה אחת קצרה וממוקדת, עד 25 מילים, מסתיימת בסימן שאלה>
תשובה: <משפט אחד או שניים שעונים בדיוק על השאלה, לא יותר>

כללים:
- כרטיס = עובדה אחת. שאלה שאפשר לענות עליה בלי "וגם".
- רק מה שמעוגן בחומרי הקורס. אל תוסיף ידע חיצוני ואל תנחש.
- שאלה עם תשובה אחת ברורה. בלי "ספר על", בלי "מה חשוב לדעת על".
- בלי מספור נוסף, בלי כותרות, בלי שום טקסט אחר.

הנקודות:
{agenda}"""

CITE = re.compile(r'\s*\[[\d,\s\-]+\]')


def run(args, timeout=300, retries=3):
    """‼️ ה-API של הנוטבוק זורק rate-limit אחרי רצף שאילתות (קרה אחרי ~30
    נושאים ברצף). ההודעה עצמה אומרת לחכות ולנסות שוב — אז זה מה שעושים,
    עם המתנה שהולכת וגדלה."""
    import time
    for attempt in range(retries + 1):
        p = subprocess.run(['notebooklm'] + args, capture_output=True, text=True, timeout=timeout)
        out = p.stdout + p.stderr
        if 'rate limited' not in out or attempt == retries:
            return out
        time.sleep(30 * (attempt + 1))
    return out


def parse(answer, n_points):
    """שלוש שורות לכרטיס. הציטוטים נשמרים בנפרד — הם הראיה, לא חלק מהכרטיס.

    ‼️ ה-CLI שובר שורות ארוכות, ולכן שאלה או תשובה יכולות להתפרס על כמה
    שורות — שורה בלי תחילית שייכת לשדה האחרון שנפתח. בלי זה תשובות נחתכות
    באמצע משפט, לפעמים באמצע ציטוט ("לנוירונים [5,")."""
    cards, pi, q, a = [], None, None, None

    def flush():
        nonlocal q, a
        if q and a and pi and 1 <= pi <= n_points:
            cites = CITE.findall(q) + CITE.findall(a)
            cards.append({'pi': pi - 1,           # אינדקס הנקודה במפה, מבוסס-0
                          'q': CITE.sub('', q).strip(),
                          'a': CITE.sub('', a).strip(),
                          'cites': ' '.join(c.strip() for c in cites)})
        q = a = None

    for line in answer.splitlines():
        line = line.strip()
        m = re.match(r'^נקודה:\s*(\d+)', line)
        if m:
            flush()
            pi = int(m.group(1))
            continue
        m = re.match(r'^שאלה:\s*(.+)$', line)
        if m:
            flush()
            q = m.group(1).strip()
            continue
        m = re.match(r'^תשובה:\s*(.+)$', line)
        if m:
            a = m.group(1).strip()
            continue
        if line and a is not None:
            a += ' ' + line
        elif line and q is not None:
            q += ' ' + line
    flush()
    return [c for c in cards if len(c['q']) > 8 and len(c['a']) > 10]


def topics_of(course):
    g = json.load(open(os.path.join(EXAMS, f'{course}-guide.json'), encoding='utf-8'))
    out = []
    for u in g.get('units', []):
        t = (u.get('topic') or '').strip()
        pts = [p for p in (u.get('points') or []) if (p.get('point') or '').strip()]
        if t and pts:
            out.append((t, pts))
    return out


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in NOTEBOOKS:
        print('שימוש: python3 anki-ask.py <' + '|'.join(NOTEBOOKS) + '> [--all|נושא...]')
        return 1
    course = sys.argv[1]
    rest = sys.argv[2:]
    names = {'molecular': 'ביולוגיה מולקולרית תאית', 'electro': 'אלקטרופיזיולוגיה',
             'physics': 'פיזיקה לרפואנים ב׳', 'biochem': 'ביוכימיה'}

    allt = topics_of(course)
    if '--all' in rest:
        pick = allt
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
    store['_note'] = ('תשובות גולמיות מהנוטבוק, לפי סדר היום של מפת החומרים. '
                     'pi = אינדקס הנקודה במפה. נכנס לחפיסה רק דרך שערי האיכות '
                     'של anki-build.py ואחרי בדיקה של הכרטיסים המרונדרים. '
                     'הציטוטים הם הראיה — הנוטבוק יודע לבדות.')
    store.setdefault('topics', {})

    for topic, pts in pick:
        print(f'▸ {topic} ({len(pts)} נקודות) … ', end='', flush=True)

        # ‼️ סדר יום ארוך מפיל את הגשר: מעל ~4000 תווים התשובה חוזרת ריקה
        # ("No parseable chunks"). לכן נושא גדול נשלח בכמה אצוות, וה-pi
        # מתורגם חזרה לאינדקס הגלובלי של הנקודה במפה.
        batches, cur, cur_len = [], [], 0
        for i, p in enumerate(pts):
            t = p['point'].strip()
            if cur and cur_len + len(t) > 3500:
                batches.append(cur)
                cur, cur_len = [], 0
            cur.append((i, t))
            cur_len += len(t)
        if cur:
            batches.append(cur)

        cards, raws = [], []
        for batch in batches:
            agenda = '\n'.join(f'{j + 1}. {t}' for j, (_, t) in enumerate(batch))
            try:
                ans = run(['ask', PROMPT.format(course=names[course], topic=topic, agenda=agenda)])
            except subprocess.TimeoutExpired:
                raws.append('(פסק זמן)')
                continue
            raws.append(ans.strip())
            for c in parse(ans, len(batch)):
                c['pi'] = batch[c['pi']][0]
                cards.append(c)
        store['topics'][topic] = {'cards': cards, 'raw': '\n\n───\n\n'.join(raws)}
        covered = len({c['pi'] for c in cards})
        print(f'{len(cards)} כרטיסים · כיסוי {covered}/{len(pts)} נקודות'
              + (f' · {len(batches)} אצוות' if len(batches) > 1 else ''))

    json.dump(store, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    total = sum(len(v['cards']) for v in store['topics'].values())
    print(f'\nנשמר: sources/anki-{course}-notebook.json · {total} כרטיסים ממתינים לשערי האיכות')
    return 0


if __name__ == '__main__':
    sys.exit(main())
