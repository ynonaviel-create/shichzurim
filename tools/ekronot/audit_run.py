# -*- coding: utf-8 -*-
"""ביקורת עובדתית מדגמית דרך גשר ה-NotebookLM (חשבון shichzurim52): טענות מהתוכן החדש מול מחברות המקצוע.
   הרצה: python3 audit_run.py [--test]   (כותב תוצאות ל-audit_results.jsonl בהדרגה)"""
import json, subprocess, sys, os, re, time
S = os.path.dirname(os.path.abspath(__file__))
NB = {'viro': '8b5f921d-6e33-44fe-86e8-db0db987b31e', 'micro': '2effa4f8-bf04-41a8-910e-4bfe62b0b594', 'pharma': '9cabe8d5-dcfa-446c-bbbe-94cab89effe6',
      'genetics': '3db0652a-dd0d-442f-aad8-50a7547f4256', 'physio': 'd4a8af85-27e5-4247-b857-dc70285063fe', 'patho': 'c3f5e076-60c6-4f2b-9bda-6b0b6d9ffeaa',
      'immuno': 'cb451376-135b-4209-9257-8fc315149f41', 'para': '49b0b74e-04d3-44ba-af93-a37f7a03057b'}
courses = json.load(open('/Users/yinonaviel/תוכנה לשחזורים/exams/courses.json', encoding='utf-8'))['courses']
topic2key = {}
for c in courses:
    for s in c.get('subjects', []):
        for t in s['topics']: topic2key[t] = s['key']
sample = json.load(open(S + '/audit_sample.json', encoding='utf-8'))
for it in sample:
    m = re.match(r'ekronot-[ab]-([a-z]+)-(keyer|cases)', it['src'])
    it['key'] = m.group(1) if m else topic2key.get(it.get('topic'))
sample = [it for it in sample if it.get('key') in NB]
by = {}
for it in sample: by.setdefault(it['key'], []).append(it)
out_path = S + '/audit_results.jsonl'
done = set()
if os.path.exists(out_path):
    for line in open(out_path, encoding='utf-8'):
        try: done.add(json.loads(line)['batch'])
        except: pass
test = '--test' in sys.argv
NB_BIN = os.path.expanduser('~/.local/bin/notebooklm')
for key, items in by.items():
    for bi in range(0, len(items), 4):
        batch = items[bi:bi + 4]; bid = f'{key}#{bi // 4}'
        if bid in done: continue
        claims = '\n\n'.join(f'טענה {i + 1} ({it["kind"]}{(" — " + it["answer"]) if it["answer"] else ""}):\n{it["text"]}' for i, it in enumerate(batch))
        prompt = ('לפניך טענות שנכתבו לסטודנטים מתוך סיכומי הקורס. בדוק כל טענה מול המקורות במחברת בלבד, בלי ידע חיצוני. '
                  'לכל טענה ענה בפורמט קבוע, שורה לכל טענה: "טענה N: נתמך" או "טענה N: סותר — <מה המקורות אומרים במקום, בקצרה>" או "טענה N: לא נמצא — <איזה חלק לא נמצא>". '
                  'אם רק פרט אחד בטענה שגוי, ציין אותו במפורש. הוסף ציטוטים למקורות.\n\n' + claims)
        t0 = time.time()
        try:
            r = subprocess.run([NB_BIN, 'ask', '-n', NB[key], '--json', '--timeout', '240', '--prompt-file', '-'], input=prompt, capture_output=True, text=True, timeout=300)
            ans = r.stdout.strip(); err = r.stderr.strip()[-400:]
            try: ansj = json.loads(ans); text = ansj.get('answer') or ansj.get('text') or ans
            except Exception: text = ans
        except Exception as e:
            text = ''; err = str(e)
        rec = {'batch': bid, 'key': key, 'items': [{'src': it['src'], 'kind': it['kind'], 'id': it['id'], 'answer': it['answer'], 'text': it['text'][:300]} for it in batch], 'answer': text, 'err': err, 'secs': round(time.time() - t0)}
        with open(out_path, 'a', encoding='utf-8') as f: f.write(json.dumps(rec, ensure_ascii=False) + '\n')
        print(bid, 'ok' if text else 'ERR', rec['secs'], 's', flush=True)
        if test: print(text[:1500]); sys.exit(0)
        time.sleep(3)
print('done')
