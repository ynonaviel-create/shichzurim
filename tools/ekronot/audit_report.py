# -*- coding: utf-8 -*-
import json, re, os
S = os.path.dirname(os.path.abspath(__file__))
import sys
recs = [json.loads(l) for l in open(sys.argv[1] if len(sys.argv) > 1 else S + '/audit_results.jsonl', encoding='utf-8')]
tot = {'נתמך': 0, 'סותר': 0, 'לא נמצא': 0, '?': 0}; flagged = []
for r in recs:
    ans = r['answer'] or ''
    for i, it in enumerate(r['items']):
        m = re.search(r'טענה\s*%d\s*[:：]?\s*\**\s*(נתמך|סותר|לא נמצא)' % (i + 1), ans)
        v = m.group(1) if m else '?'
        tot[v] += 1
        if v != 'נתמך':
            # grab the paragraph for this claim
            seg = re.split(r'\*{0,2}טענה\s*\d+', ans)
            para = seg[i + 1][:700] if len(seg) > i + 1 else ''
            flagged.append((r['key'], it['kind'], it['id'], it['answer'], v, para.strip()))
print('סה״כ', tot, '· קבוצות', len(recs), '· שגיאות ריצה', sum(1 for r in recs if not r['answer']))
for f in flagged:
    print('\n──', f[0], f[1], f[2], ('— ' + f[3]) if f[3] else '', '→', f[4]); print('   ', f[5].replace('\n', ' ')[:600])
