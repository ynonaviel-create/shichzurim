# python3 tools/guide-build/extract_spines.py [course ...]
# מחלץ את סיכומי-השדרה של קורסי שנה א׳ לטקסט עם סימוני עמוד („===== עמ׳ N =====”)
# אל sources/guide-work/<course>/. המקורות עצמם ב-sources/shana-a/<course>/ (לא בגיט).
# קובץ docx שכבר חולץ ב-_txt/ מועתק כמו שהוא (אין לו עמודים).
import fitz, glob, os, sys, shutil
WT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(os.path.dirname(WT) if not os.path.isdir(f'{WT}/sources/shana-a') else WT, 'sources', 'shana-a')
if not os.path.isdir(SRC):  # worktree בלי sources — נופלים לצ׳קאאוט הראשי
    SRC = '/Users/yinonaviel/תוכנה לשחזורים/sources/shana-a'
SPINES = {
    'cellbio': [('spine-peleg', '*סיכום ביולוגיה של התא - מחזור נא - ליאור פלג*.pdf'),
                ('spine-kahalot', '*ביולוגיה של התא - סיכום קורס - אדם כחלות*.pdf')],
    'chem':    [('spine-kahalot', '*כימיה - סיכום קורס - אדם כחלות*.pdf'),
                ('sup-harmati', 'txt:*כימיה - סיכום קורס - נעה הרמתי.docx.txt'),
                ('sup-piterman', 'txt:*תחקורים כימיה - נטע פיטרמן.pdf.txt')],
    'organic': [('spine-rotenberg', '*עדו רוטנברג*.pdf'),
                ('sup-harmati', '*סיכום מומלץ בכימיה אורגנית - נעה הרמתי*.pdf')],
    'epi':     [('spine-elishama', '*אלישמע*.pdf'),
                ('sup-kahalot', 'dir:*כחלות*')],
    'histo':   [('spine-morlevi', '*סיכומי הרצאות היסטולוגיה סופי - מור לוי*.pdf'),
                ('sup-kahalot', '*היסטולוגיה - סיכום קורס - אדם כחלות*.pdf'),
                ('sup-lymph-harmati', '*מערכת הלימפה - נעה הרמתי*.pdf')],
    'anatomy': [('spine-peleg', '*סיכום אנטומיה - ליאור פלג*.pdf'),
                ('sup-inbi', '*נועה ענבי*.pdf')],
    'biochem': [('spine-kahalot-a', 'dir:*סיכום קורס ביוכימיה - אדם כחלות*'),
                ('spine-korano-b', '*סיכום מאוחד סופי - טארה קוראנו*.pdf')],
    'molecular': [('spine-din', '*סיכום ביומול - דין - נ״א*.pdf'),
                  ('sup-karman', '*סיכום ביולוגיה מולקולארית מלא תומר קרמן*.pdf'),
                  ('sup-cox-review', '*סיכום שיעור חזרה עם קוקס מ_ז*.pdf')],
    'clinical': [('spine-mazorsky', '*סיכום על - עימות קליני - ניצן מזורסקי*.pdf'),
                 ('sup-shefer-stock', '*סיכום מאוחד 2022*.pdf'),
                 ('sup-thm-fried', '*THM*')],
    'biostat': [('spine-cohen', '*סופר סיכום ביוסטטיסטיקה - רוני כהן*.pdf'),
                ('sup-formula-51', '*ביוס - דף נוסחאות מחזור נ״א*.pdf')],
    'physics-a': [('spine-swissa', 'dir:*מעיין סוויסה*'),
                  ('sup-sabo', 'dir:*אביה סבו*'),
                  ('sup-formula-2023', '*דף נוסחאות מעודכן למבחן סמסטר א* 2023*.pdf')],
    'embryo':  [('spine-morlevi', '*אמבריולוגיה - מחזור נ - מור לוי*.pdf'),
                ('sup-kahalot', '*אמבריולוגיה - סיכום קורס - אדם כחלות*.pdf')],
}
def pdf_text(paths):
    out = []
    for p in paths:
        d = fitz.open(p); tag = (os.path.basename(p) + ' · ') if len(paths) > 1 else ''
        out += [f'\n===== {tag}עמ׳ {i + 1} =====\n' + pg.get_text() for i, pg in enumerate(d)]
    return ''.join(out)
for c in (sys.argv[1:] or SPINES):
    base = f'{SRC}/{c}'; dst = f'{WT}/sources/guide-work/{c}'; os.makedirs(dst, exist_ok=True)
    for name, pat in SPINES[c]:
        if pat.startswith('txt:'):
            fs = glob.glob(f'{base}/_txt/{pat[4:]}')
            if fs: shutil.copy(fs[0], f'{dst}/{name}.txt'); print(c, name, 'txt'); continue
        elif pat.startswith('dir:'):
            ds = [d for d in glob.glob(f'{base}/**/{pat[4:]}', recursive=True) if os.path.isdir(d)]
            fs = sorted(glob.glob(f'{ds[0]}/*.pdf')) if ds else []
        else:
            fs = [f for f in glob.glob(f'{base}/**/{pat}', recursive=True) if '/_txt/' not in f and '/_import/' not in f][:1]
        if not fs: print(c, name, 'MISSING'); continue
        open(f'{dst}/{name}.txt', 'w', encoding='utf-8').write(pdf_text(fs)); print(c, name, len(fs), 'file(s)')
