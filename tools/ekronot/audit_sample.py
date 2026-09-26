# -*- coding: utf-8 -*-
"""מדגם לביקורת: python3 tools/ekronot/audit_sample.py <seed> <out.json> — 3 תיקים לכל מקצוע, 2 שלבי מקרה לכל קובץ, 24 עובדות שינון עם מספרים."""
import json, random, glob, sys
random.seed(int(sys.argv[1])); out = []
for f in sorted(glob.glob('exams/ekronot-*-keyer.json')):
    d = json.load(open(f, encoding='utf-8'))
    for it in random.sample(d['items'], min(3, len(d['items']))):
        out.append({'src': f.split('/')[-1], 'kind': 'keyer', 'id': it['id'], 'answer': it['answer'], 'text': it['why']})
for f in sorted(glob.glob('exams/ekronot-*-cases.json')):
    d = json.load(open(f, encoding='utf-8')); st = [(c['id'], s) for c in d['cases'] for s in c['stages']]
    for cid, s in random.sample(st, 2):
        out.append({'src': f.split('/')[-1], 'kind': 'case', 'id': cid, 'answer': s['opts'][s['a']], 'text': s['why']})
for f in ['exams/ekronot-a-shinun.json', 'exams/ekronot-b-shinun.json']:
    d = json.load(open(f, encoding='utf-8')); items = [it for g in d['groups'] for it in g['items']]
    nums = [it for it in items if any(ch.isdigit() for ch in it['back'])]
    for it in random.sample(nums, 12):
        out.append({'src': f.split('/')[-1], 'kind': 'shinun', 'id': it['front'], 'answer': '', 'text': it['front'] + ' — ' + it['back'], 'topic': it.get('topic')})
json.dump(out, open(sys.argv[2], 'w', encoding='utf-8'), ensure_ascii=False, indent=1); print(len(out))
