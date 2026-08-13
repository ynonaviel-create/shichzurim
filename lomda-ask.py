#!/usr/bin/env python3
"""טיוטות ראשונות ללומדה — מהנוטבוק, ישר לתוך שלד התבנית.

    python3 lomda-ask.py <course> [נושא ...]        # יחידות מסוימות
    python3 lomda-ask.py <course> --all             # כל היחידות עם TODO
    python3 lomda-ask.py <course> --file guides/x.html

התפיסה — אותה תפיסה כמו anki-ask.py: המפה היא סדר היום, הנוטבוק (שמחוברים
אליו ההרצאות והסיכומים של הקורס) כותב את הטקסט. build.py מייצר שלד עם TODO;
הסקריפט הזה ממלא לכל יחידה טיוטה של "הרעיון לעומק", "החיבור הרפואי" ו"האמת"
של כל מלכודת.

‼️ מה שנכנס הוא **טיוטה מסומנת**, לא תוכן: כל קטע עטוף בתג גלוי
"🤖 טיוטת נוטבוק — טרם אומתה" ובסימן `<!-- draft:unverified -->`. סוכני
הכתיבה (או ינון) מחליפים את הטיוטות בתוכן מאומת — הציטוטים הגולמיים נשמרים
ב-sources/lomda-drafts/ כראיה. הנוטבוק יודע לבדות; טיוטה בלי ציטוטים נפסלת.

דורש: `notebooklm` ב-PATH (חשבון shichzurim52), והקורס בטבלת NOTEBOOKS
של anki-ask.py — משתמשים באותה טבלה כדי שלא יהיו שני מקורות אמת.
"""

import importlib.util
import os
import re
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
DRAFTS = os.path.join(ROOT, 'sources', 'lomda-drafts')

# הטבלה, הריצה העמידה ל-rate-limit וניקוי הציטוטים — מ-anki-ask.py, בלי כפילות.
_spec = importlib.util.spec_from_file_location('anki_ask', os.path.join(ROOT, 'anki-ask.py'))
_anki = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_anki)
NOTEBOOKS, run, CITE = _anki.NOTEBOOKS, _anki.run, _anki.CITE

PROMPT = """אני כותב פרק בסיכום לימוד (לומדה) לקורס, לנושא "{topic}".

הפתיח של הפרק (כבר כתוב): {lead}

כתוב לי, אך ורק מחומרי הקורס שמחוברים אליך (הרצאות, מצגות, סיכומים):

הרעיון: 2–4 פסקאות שמסבירות את הנושא לעומק, בעברית זורמת, להבנה — לא
רשימת עובדות. כל פסקה בשורה שמתחילה ב"פסקה:".

רפואי: פסקה אחת על החיבור הרפואי/קליני של הנושא, רק אם הוא מופיע בחומרי
הקורס. אם אין חיבור אמיתי — כתוב "רפואי: אין".

{traps_ask}

כללים:
- אל תוסיף ידע חיצוני ואל תנחש. מה שאין בחומרים — לא קיים.
- בלי כותרות, בלי מספור, בלי שום טקסט מעבר לשורות המבוקשות.

{traps_list}"""


def load_units(html):
    """יחידות השלד: (טווח, נושא, יש-TODO)."""
    units = []
    for m in re.finditer(r'<section class="unit"[^>]*>(.*?)</section>', html, re.S):
        h3 = re.search(r'<h3>(.*?)<', m.group(1))
        topic = h3.group(1).strip() if h3 else '?'
        units.append({'span': m.span(), 'body': m.group(1), 'topic': topic,
                      'todo': 'TODO' in m.group(1)})
    return units


def ask_unit(nb, topic, body):
    lead = re.search(r'<p class="lead">(.*?)</p>', body, re.S)
    lead = re.sub(r'<[^>]+>', '', lead.group(1)) if lead else ''
    traps = re.findall(r'<b>המלכודת:</b>\s*(.*?)\s*<b>האמת:</b>', body, re.S)
    traps = [re.sub(r'<[^>]+>', '', t).strip() for t in traps]
    traps_ask = ('אמת: לכל מלכודת שברשימה למטה — משפט או שניים שמסבירים מה האמת '
                 '(התיקון לתפיסה השגויה). כל אחת בשורה "אמת N:".') if traps else ''
    traps_list = ('המלכודות:\n' + '\n'.join(f'{i+1}. {t}' for i, t in enumerate(traps))) if traps else ''
    q = PROMPT.format(topic=topic, lead=lead or '—', traps_ask=traps_ask, traps_list=traps_list)
    out = run(['ask', '--notebook', nb, q], timeout=420)
    return out, traps


def parse_answer(out, n_traps):
    """שורות ממשיכות (ה-CLI שובר שורות ארוכות) מצטרפות לשדה האחרון שנפתח."""
    paras, medical, truths = [], None, {}
    cur = None
    for line in out.splitlines():
        s = line.strip()
        if not s:
            continue
        if s.startswith('פסקה:'):
            paras.append(s[len('פסקה:'):].strip()); cur = ('p', len(paras) - 1)
        elif s.startswith('רפואי:'):
            medical = s[len('רפואי:'):].strip(); cur = ('m', None)
        elif (mm := re.match(r'אמת\s*(\d+)\s*:', s)):
            i = int(mm.group(1)) - 1
            truths[i] = s[mm.end():].strip(); cur = ('t', i)
        elif cur:
            if cur[0] == 'p': paras[cur[1]] += ' ' + s
            elif cur[0] == 'm': medical += ' ' + s
            else: truths[cur[1]] += ' ' + s
    # שערי איכות: בלי ציטוטים = הנוטבוק לא נשען על החומרים = נפסל.
    raw = '\n'.join(paras) + (medical or '') + '\n'.join(truths.values())
    if not CITE.search(raw):
        return None, 'אין ציטוטים — הטיוטה נפסלה'
    clean = lambda s: CITE.sub('', s).strip()
    paras = [clean(p) for p in paras if len(clean(p)) > 80]
    if len(paras) < 2:
        return None, f'רק {len(paras)} פסקאות ראויות — הטיוטה נפסלה'
    medical = clean(medical) if medical else ''
    if medical in ('אין', '') or len(medical) < 40:
        medical = None
    truths = {i: clean(t) for i, t in truths.items() if len(clean(t)) > 20 and i < n_traps}
    return {'paras': paras, 'medical': medical, 'truths': truths}, None


TAG = '<span class="dk-draft-tag">🤖 טיוטת נוטבוק — טרם אומתה</span>'


def inject_draft(body, d):
    """הטיוטות נכנסות במקום ה-TODO, עטופות וסמונות. מה שלא חזר — נשאר TODO."""
    if d['paras']:
        block = ('<div class="dk-draft"><!-- draft:unverified -->' + TAG +
                 ''.join(f'<p>{p}</p>' for p in d['paras']) + '</div>')
        body = re.sub(r'<p><!-- TODO: 2–5 פסקאות.*?--></p>', block, body, count=1, flags=re.S)
    if d['medical']:
        block = ('<div class="dk-draft"><!-- draft:unverified -->' + TAG +
                 f'<p>{d["medical"]}</p></div>')
        body = re.sub(r'<p><!-- TODO: איפה זה פוגש רפואה.*?--></p>', block, body, count=1, flags=re.S)
    if d['truths']:
        i = -1
        def truth(m):
            nonlocal i
            i += 1
            t = d['truths'].get(i)
            return (m.group(1) + f'<span class="dk-draft-inline" title="טיוטת נוטבוק — טרם אומתה">'
                    f'🤖 {t}</span><!-- draft:unverified -->' + m.group(3)) if t else m.group(0)
        body = re.sub(r'(<b>האמת:</b>)\s*(<!-- TODO: התיקון -->)(</div>)', truth, body)
    return body


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    flags = [a for a in sys.argv[1:] if a.startswith('--')]
    if not args:
        sys.exit(__doc__)
    course, topics = args[0], args[1:]
    nb = NOTEBOOKS.get(course)
    if not nb:
        sys.exit(f'❌ אין נוטבוק לקורס {course} — להוסיף לטבלה ב-anki-ask.py')
    fpath = next((f.split('=', 1)[1] for f in flags if f.startswith('--file=')),
                 os.path.join(ROOT, 'guides', f'{course}-full.html'))
    html = open(fpath, encoding='utf-8').read()
    units = load_units(html)
    todo = [u for u in units if u['todo'] and (not topics or u['topic'] in topics)]
    if not todo and not topics:
        sys.exit('אין יחידות עם TODO — אין מה למלא')
    os.makedirs(DRAFTS, exist_ok=True)

    print(f'📝 {len(todo)} יחידות למילוי ב-{os.path.relpath(fpath, ROOT)}')
    offset = 0
    for u in todo:
        print(f'   ⏳ {u["topic"]} …', flush=True)
        out, traps = ask_unit(nb, u['topic'], u['body'])
        slug = re.sub(r'\W+', '-', u['topic'])[:40]
        open(os.path.join(DRAFTS, f'{course}-{slug}.txt'), 'w', encoding='utf-8').write(out)
        d, err = parse_answer(out, len(traps))
        if err:
            print(f'   ❌ {u["topic"]}: {err}')
            continue
        new_body = inject_draft(u['body'], d)
        s, e = u['span'][0] + offset, u['span'][1] + offset
        seg = html[s:e].replace(u['body'], new_body)
        html = html[:s] + seg + html[e:]
        offset += len(seg) - (e - s)
        print(f'   ✅ {u["topic"]}: {len(d["paras"])} פסקאות · רפואי: {"יש" if d["medical"] else "אין"} · '
              f'{len(d["truths"])}/{len(traps)} אמיתות')

    open(fpath, 'w', encoding='utf-8').write(html)
    print('\nהטיוטות בפנים, מסומנות. הגולמי עם הציטוטים: sources/lomda-drafts/')
    print('המשך: סוכני write-study-guide מאמתים ומחליפים כל dk-draft בתוכן סופי.')


if __name__ == '__main__':
    main()
