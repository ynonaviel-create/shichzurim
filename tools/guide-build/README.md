# בניית מפת חומרים (kind:"guide") לקורס — הצינור של שנה א׳ (30/09/2026)

1. `python3 tools/guide-build/make_dumps.py <course>` — כותב `sources/guide-work/<course>/tNN.md`: כל שאלות הקורס לפי נושא (סדר `topics` בכרטיס), עם qid, מחזור, trust, מסיחים, note ו-explain.
2. חילוץ סיכום-השדרה עם סימוני עמוד (`===== עמ׳ N =====`, PyMuPDF) לאותה תיקייה, ו-`_COURSE.md` קצר: מרצים, הגדרת certainty לקורס, שדרה ומשני.
3. סוכן לכל 3–8 נושאים לפי `PROMPT_UNITS.md` (+ שני כללים: qid בנקודה אחת בלבד ביחידה; „<” תמיד עם רווח אחריו ב-trap/gap/what) → `sources/guide-work/<course>/out/X.json`.
4. `header.json` באותה תיקייה (method, headline מהנתונים, stack, certaintyTags, nowWhy, sources, caveats) — כותבים ידנית מהתדירויות.
5. `python3 tools/guide-build/assemble_guide.py <course>` → `exams/<course>-guide.json` (freq מחושב, lecturers/sup ברירת מחדל []), ואז `node sync.js` (מאמת qid↔נושא וכיסוי).
6. **לבדוק בדפדפן** — sync לא תופס שדה חסר שהמנוע קורס עליו.
