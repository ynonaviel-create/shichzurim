# -*- coding: utf-8 -*-
"""ממזג את קבוצות השינון מהסטייג׳ינג (exams/_staging/shinun/<course>-<key>.json — מערך קבוצות)
לחפיסה אחת לקורס: exams/<course>-shinun.json. הסדר לפי סדר המקצועות ב-courses.json."""
import json, sys, pathlib
ROOT = pathlib.Path('/Users/yinonaviel/תוכנה לשחזורים')
courses = json.loads((ROOT/'exams/courses.json').read_text(encoding='utf-8'))['courses']
TITLE = {'ekronot-a': 'i❤️Shinun — עקרונות המדע א׳: מה שצריך בעל-פה',
         'ekronot-b': 'i❤️Shinun — עקרונות המדע ב׳: מה שצריך בעל-פה'}
for c in courses:
    cid = c['id']
    if not cid.startswith('ekronot'): continue
    groups = []
    for s in c['subjects']:
        f = ROOT/f"exams/_staging/shinun/{cid}-{s['key']}.json"
        if not f.exists(): print('  ✗ אין', f.name); continue
        arr = json.loads(f.read_text(encoding='utf-8'))
        for g in arr:
            g = dict(g); g['label'] = f"{s.get('icon','')} {s['name']} · {g['label']}".strip()
            bad = [it for it in g['items'] if it.get('topic') not in s['topics']]
            if bad: print(f"  ⚠️ {s['key']}: {len(bad)} פריטים עם topic לא קנוני:", sorted({b.get('topic') for b in bad}))
            groups.append(g)
    if not groups: continue
    n = sum(len(g['items']) for g in groups)
    out = {'id': f'{cid}-shinun', 'course': cid, 'kind': 'shinun', 'title': TITLE[cid],
           'heroSub': f'{n} עובדות יבשות שאי אפשר להסיק, רק לזכור — לפי מקצוע. היפוך, כסה-וגלה, ומבחן שמסיחיו באים מאותה משפחה.',
           'added': '2026-09-24',
           'note': 'נכתב מהלומדות, מהמפות ומהשאלות בארכיון, מקצוע-מקצוע. זה כלי שינון, לא שחזור.',
           'groups': groups}
    (ROOT/f'exams/{cid}-shinun.json').write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding='utf-8')
    print(f'✅ {cid}-shinun.json: {len(groups)} קבוצות, {n} פריטים')
