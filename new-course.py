#!/usr/bin/env python3
"""קורס חדש בפקודה אחת — השלד המכני של NEW-COURSE.md, בשני צעדים.

    python3 new-course.py init pharma --name "פרמקולוגיה" --icon 💊 \
        --blurb "תרופות, קינטיקה ורצפטורים" [--code 0-471-...] [--year 2] [--semester א]

        יוצר את כרטיס המקצוע ב-exams/courses.json עם strict:true — מרגע זה
        הקורס לא עולה לאוויר עד שהוא תקין. נשאר: למלא topics ולקבל את
        אישור ינון עליהם (נקודת האישור היחידה בתהליך).

    python3 new-course.py scaffold pharma

        אחרי שה-topics אושרו: מייצר שלד מפת חומרים (יחידה לכל נושא) ושלד
        לומדה (build.py). כל עוד אין שאלות מתויגות, המפה נכתבת ל-
        exams/_staging/ — תיקייה ש-sync לא סורק — כדי שקורס באמצע בנייה
        לא יפיל את הסנכרון של כל הארכיון. כשיש שאלות: mv פנימה ו-sync.

המסלול המלא, כולל השלבים שדורשים שיפוט (שאלות, תוכן, אנקי): הסקיל
new-course. הכללים: NEW-COURSE.md.
"""

import argparse
import datetime
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
COURSES = os.path.join(ROOT, 'exams', 'courses.json')
STAGING = os.path.join(ROOT, 'exams', '_staging')

# צמדי accent מהקורסים הקיימים — צבע-זהות חדש נבחר מפלטה, לא מומצא.
PALETTE = [
    {"light": ["#0e7490", "#155e75", "#ecfeff"], "dark": ["#22d3ee", "#67e8f9", "#083344"]},
    {"light": ["#b45309", "#92400e", "#fffbeb"], "dark": ["#f59e0b", "#fbbf24", "#451a03"]},
    {"light": ["#6d28d9", "#5b21b6", "#f5f3ff"], "dark": ["#a78bfa", "#c4b5fd", "#2e1065"]},
    {"light": ["#be123c", "#9f1239", "#fff1f2"], "dark": ["#fb7185", "#fda4af", "#4c0519"]},
    {"light": ["#15803d", "#166534", "#f0fdf4"], "dark": ["#4ade80", "#86efac", "#052e16"]},
]


def load():
    d = json.load(open(COURSES, encoding='utf-8'))
    return d, (d['courses'] if isinstance(d, dict) and 'courses' in d else d)


def save(d):
    json.dump(d, open(COURSES, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)


def init(a):
    d, courses = load()
    if any(c['id'] == a.id for c in courses):
        sys.exit(f'❌ הקורס {a.id} כבר קיים')
    used = [json.dumps(c.get('accent', {}).get('light')) for c in courses]
    accent = next((p for p in PALETTE if json.dumps(p['light']) not in used), PALETTE[0])
    card = {
        "id": a.id, "name": a.name, "code": a.code or "TODO",
        "icon": a.icon, "blurb": a.blurb or "",
        "order": max((c.get('order', 0) for c in courses), default=0) + 1,
        "year": a.year, "semester": a.semester,
        # soon ולא active: מקצוע פעיל בלי dates מפיל את sync, וקורס באמצע
        # בנייה עוד לא אמור להפיל כלום. מחליפים ל-active כשממלאים את dates.
        "status": "soon",
        "strict": True,
        "accent": accent,
        "dates": [],
        "about": "TODO: מה הקורס, מי המרצה, ואיך נראה המבחן — פסקה או שתיים.",
        "topics": [],
    }
    courses.append(card)
    save(d)
    print(f'✅ כרטיס {a.id} נוצר ב-courses.json עם strict:true')
    print('   הצעדים הבאים, לפי הסדר:')
    print('   1. למלא topics (10–25 נושאים קנוניים) — ולקבל את אישור ינון עליהם.')
    print('      זו נקודת האישור היחידה בתהליך (NEW-COURSE.md שלב 1).')
    print('   2. dates (מועדי הבחינה) + about + code — כשידועים.')
    print(f'   3. python3 new-course.py scaffold {a.id}')


def scaffold(a):
    _, courses = load()
    c = next((x for x in courses if x['id'] == a.id), None)
    if not c:
        sys.exit(f'❌ אין כרטיס לקורס {a.id} — קודם init')
    topics = c.get('topics') or []
    if not topics:
        sys.exit('❌ אין topics בכרטיס — הרשימה הסגורה נקבעת (ומאושרת) לפני הכול')

    # יש כבר שאלות מתויגות בנושאים? אם לא — המפה נכתבת ל-staging, מחוץ לעין
    # של sync, כדי שקורס באמצע בנייה לא יפיל את הסנכרון של כל הארכיון.
    has_questions = False
    exams_dir = os.path.join(ROOT, 'exams')
    for f in os.listdir(exams_dir):
        if not f.endswith('.json') or f in ('courses.json', 'manifest.json', 'anki-index.json'):
            continue
        try:
            data = json.load(open(os.path.join(exams_dir, f), encoding='utf-8'))
        except Exception:
            continue
        if isinstance(data, dict) and data.get('course') == a.id and data.get('questions'):
            has_questions = True
            break

    guide = {
        "id": f"{a.id}-guide", "course": a.id, "part": None,
        "title": "מפת החומרים", "kind": "guide",
        "added": datetime.date.today().isoformat(),
        "method": "TODO: איך המפה הזאת נבנתה — מאילו מקורות ומה נספר.",
        "noDayPlan": True,
        "units": [{
            "topic": t, "lecturers": [], "freq": 0, "certainty": "unknown",
            "what": "TODO: תמצית פסקה-שתיים — מה הנושא ולמה הוא במבחן.",
            "main": {"src": "TODO: המקור הראשי ללמידה"},
            "points": [],
        } for t in topics],
    }
    dest_dir = exams_dir if has_questions else STAGING
    os.makedirs(dest_dir, exist_ok=True)
    gpath = os.path.join(dest_dir, f'{a.id}-guide.json')
    if os.path.exists(gpath) or os.path.exists(os.path.join(exams_dir, f'{a.id}-guide.json')):
        print(f'↷ מפה כבר קיימת — מדלג')
    else:
        json.dump(guide, open(gpath, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
        print(f'✅ שלד מפה: {os.path.relpath(gpath, ROOT)}' +
              ('' if has_questions else '  (ב-staging — להעביר ל-exams/ כשיש שאלות מתויגות)'))

    # שלד הלומדה — build.py קורא topics מהכרטיס גם בלי מפה ב-exams/.
    out = subprocess.run([sys.executable, os.path.join(ROOT, 'guides', '_template', 'build.py'), a.id],
                         capture_output=True, text=True)
    print(out.stdout.strip() or out.stderr.strip())

    print('\nהמשך המסלול (הסקיל new-course מלווה את כולו):')
    print(f'   שאלות (import-shichzur / QUESTION-STANDARD) → מילוי המפה → ')
    print(f'   טיוטות: python3 lomda-ask.py {a.id} --all → תוכן (write-study-guide) → ')
    print(f'   רישום ב-guides/_template/inject.py (DOCS) + הרצה → node sync.js')


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='cmd', required=True)
    p1 = sub.add_parser('init')
    p1.add_argument('id')
    p1.add_argument('--name', required=True)
    p1.add_argument('--icon', required=True)
    p1.add_argument('--blurb')
    p1.add_argument('--code')
    p1.add_argument('--year', type=int, default=2)
    p1.add_argument('--semester', default='א')
    p2 = sub.add_parser('scaffold')
    p2.add_argument('id')
    a = ap.parse_args()
    (init if a.cmd == 'init' else scaffold)(a)


if __name__ == '__main__':
    main()
