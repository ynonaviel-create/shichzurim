# python3 make_dumps.py <course> — WT/exams -> guide/<course>/tNN.md, topic order from courses.json
import json,glob,os,sys
WT=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))); SP=os.path.join(WT,'sources','guide-work'); c=sys.argv[1]
cfg=json.load(open(f'{WT}/exams/courses.json')); cl=cfg if isinstance(cfg,list) else cfg['courses']
topics=next(x for x in cl if x['id']==c)['topics']
by={t:[] for t in topics}; HEB='אבגדהוזח'
for f in glob.glob(f'{WT}/exams/{c}-*.json'):
    e=json.load(open(f))
    if e.get('kind')!='shichzur': continue
    for i,q in enumerate(e['questions'],1): by.setdefault(q['topic'],[]).append((e.get('cycle') or 0,e,i,q))
os.makedirs(f'{SP}/{c}',exist_ok=True)
for n,t in enumerate(topics,1):
    L=sorted(by[t],key=lambda x:-x[0]); out=[f'# נושא: {t} — {len(L)} שאלות','']
    for cy,e,i,q in L:
        out.append(f"## qid {q['qid']} · {e['title'].replace('שחזור ','')} · ש׳{i} · trust={e.get('trust')}"); out.append(q['q'])
        for j,o in enumerate(q['opts']): out.append(f"  {'✔' if j==q['a'] else ' '} {HEB[j]}. {o}")
        if q.get('table'): out.append('  [טבלה בשאלה]')
        if q.get('image'): out.append('  [תמונה בשאלה]')
        if q.get('note'): out.append('  note: '+q['note'])
        out.append('  explain: '+q.get('explain','')); out.append('')
    open(f'{SP}/{c}/t{n:02d}.md','w').write('\n'.join(out))
    print(f't{n:02d}',len(L),t)
