# כלים של עקרונות המדע — „🎮 לשחק עם זה”

מריצים משורש הריפו (`python3 tools/ekronot/<script>.py`).

| סקריפט | מה עושה |
|---|---|
| `merge_shinun.py` | ממזג את `exams/_staging/shinun/<course>-<key>.json` (מערך קבוצות, סשן-מקצוע כותב) לחפיסה אחת לקורס `exams/<course>-shinun.json`; מזהיר על topic לא קנוני |
| `make_ecg.py` → `make_ecg_bank.py` | מצייר `assets/img/ecg-strip.svg` ואת אזורי ה-hotspot (`ecg_regions.json`), ואז כותב את הבנק `ekronot-b-physio-ecg-hotspot.json` |
| `make_pedigrees.py` → `make_ped_bank.py` | מצייר 8 אילנות `assets/img/pedigree-0N.svg` וכותב את הבנק `ekronot-b-genetics-pedigrees.json` |

אחרי כל אחד: `node sync.js` (מטביע qid), ואז לצרף את ה-qids לנקודות בפרגמנט ולפרסם את המפה.
