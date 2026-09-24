# -*- coding: utf-8 -*-
"""שער איכות לתוכן „🎮”: רמז התשובה הארוכה ופיזור התשובה הנכונה במקרים ובתיקי keyer עם options.
הרצה: python3 tools/ekronot/audit_play.py   (יוצא 1 אם יש קובץ שנכשל)"""
import json, glob, collections, sys
bad = 0
print("── מקרים מתגלגלים (שלב = שאלה) ──")
for f in sorted(glob.glob('exams/*-cases.json')):
    d = json.load(open(f, encoding='utf-8'))
    n = longest = 0; pos = collections.Counter(); ratio = []
    for c in d['cases']:
        for s in c['stages']:
            n += 1; L = [len(o) for o in s['opts']]; a = s['a']; pos[a] += 1
            longest += L[a] == max(L); ratio.append(L[a] / (sum(L) / len(L)))
    if not n: continue
    r = sum(ratio) / len(ratio); pl = longest / n; top = max(pos.values()) / n
    ok = pl <= 0.45 and r <= 1.15 and top <= 0.5
    bad += not ok
    print(f"{'✅' if ok else '❌'} {f.split('/')[-1]:34} שלבים {n:2} · הנכונה הארוכה {round(100*pl):3}% · יחס אורך {r:.2f} · מיקום {dict(sorted(pos.items()))}")
print("── מפתח ההגדרה — תיקים עם options ──")
for f in sorted(glob.glob('exams/*-keyer.json')):
    d = json.load(open(f, encoding='utf-8')); n = lg = 0; ratio = []
    for it in d['items']:
        if not it.get('options'): continue
        n += 1; L = [len(o) for o in it['options']]; a = len(it['answer'])
        lg += a >= max(L); ratio.append(a / (sum(L) / len(L)))
    if not n: continue
    r = sum(ratio) / len(ratio); ok = lg / n <= 0.45 and r <= 1.15; bad += not ok
    print(f"{'✅' if ok else '❌'} {f.split('/')[-1]:34} תיקים {n:2} · התשובה הארוכה {round(100*lg/n):3}% · יחס אורך {r:.2f}")
print("\nכלל: הנכונה הארוכה ≤45% מהשאלות, יחס אורך ≤1.15, אף מיקום לא מעל 50%. (QUESTION-STANDARD.md חלק א׳)")
sys.exit(1 if bad else 0)
