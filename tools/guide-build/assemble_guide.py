# python3 assemble_guide.py <course>  — header.json + out/*.json -> WT/exams/<course>-guide.json, freq מחושב מתגיות הנושא
import json, sys, os, glob, re
WT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))); SP = os.path.join(WT, 'sources', 'guide-work')
c = sys.argv[1]; D = os.path.join(SP, c)
h = json.load(open(os.path.join(D, 'header.json')))
units = []
for f in sorted(glob.glob(os.path.join(D, 'out', '*.json'))): units += json.load(open(f))
cfg = json.load(open(os.path.join(WT, 'exams', 'courses.json')))
cl = cfg if isinstance(cfg, list) else cfg['courses']
topics = next(x for x in cl if x['id'] == c)['topics']
cnt = {}; n = 0
any_shichzur = any(json.load(open(f)).get('kind') == 'shichzur' for f in glob.glob(os.path.join(WT, 'exams', c + '-*.json')))
for f in glob.glob(os.path.join(WT, 'exams', c + '-*.json')):
    e = json.load(open(f))
    # שחזורים, ובקורס בלי שחזורים (עימות קליני) — גם practice שנחשב ראיה
    if e.get('kind') not in ('shichzur', 'practice') or e.get('guideEvidence') is False: continue
    if e.get('kind') == 'practice' and any_shichzur: continue
    for q in e['questions']: cnt[q['topic']] = cnt.get(q['topic'], 0) + 1; n += 1
by = {u['topic']: u for u in units}
miss = [t for t in topics if t not in by]; extra = [t for t in by if t not in topics]
if miss or extra: print('MISSING', miss, 'EXTRA', extra)
out = []
for t in topics:
    if t not in by: continue
    u = dict(by[t]); u.pop('freq', None)
    u.setdefault('lecturers', [])   # המנוע עושה u.lecturers.forEach — חובה מערך, גם ריק
    u.setdefault('sup', [])
    o = {k: u[k] for k in ('topic', 'lessons', 'lecturers') if k in u}
    o['freq'] = round(100 * cnt.get(t, 0) / n, 1)
    o.update({k: v for k, v in u.items() if k not in o})
    for p in o.get('points', []):
        if re.search(r'<[^>]+>', p['point']): print('HTML in point:', t, p['point'][:60])
    out.append(o)
h['units'] = out
keys = list(h.keys()); keys.remove('units')
g = {k: h[k] for k in keys[:keys.index('stack') + 1]}; g['units'] = out
g.update({k: h[k] for k in keys[keys.index('stack') + 1:]})
json.dump(g, open(os.path.join(WT, 'exams', c + '-guide.json'), 'w'), ensure_ascii=False, indent=1)
print(len(out), 'units ·', sum(len(u.get('points', [])) for u in out), 'points ·', n, 'questions')
