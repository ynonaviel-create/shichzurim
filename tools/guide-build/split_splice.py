# python3 tools/guide-build/split_splice.py split|splice <course>
# לומדה (guides/<course>-full.html) מפוצלת לקובץ לכל יחידה ב-sources/guide-work/lomda/<course>/,
# כותבים מקבילים ממלאים, ו-splice מחבר חזרה ומאמת שהיחידה נפתחת ונסגרת נכון.
import re, sys, os
WT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
mode, c = sys.argv[1], sys.argv[2]
P = f'{WT}/guides/{c}-full.html'; D = f'{WT}/sources/guide-work/lomda/{c}'
os.makedirs(D, exist_ok=True)
html = open(P, encoding='utf-8').read()
pat = re.compile(r'<section class="unit" id="(u-t\d+)">.*?</section>(?=\s*(?:<section|</section>))', re.S)
if mode == 'split':
    n = 0
    for m in pat.finditer(html):
        open(f'{D}/{m.group(1)}.html', 'w', encoding='utf-8').write(m.group(0)); n += 1
    print('split', n, '→', D)
else:
    def rep(m):
        new = open(f'{D}/{m.group(1)}.html', encoding='utf-8').read().strip()
        assert new.startswith(f'<section class="unit" id="{m.group(1)}">') and new.endswith('</section>'), m.group(1)
        return new
    out, n = pat.subn(rep, html)
    # טווח מספרים עם מקף ארוך (2–4%) מוצג הפוך בעברית — מקף רגיל נשאר בסדר הנכון
    out = re.sub(r'(?<=\d)–(?=\d)', '-', out)
    open(P, 'w', encoding='utf-8').write(out); print('spliced', n, 'TODO left', out.count('TODO'))
