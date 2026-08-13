#!/usr/bin/env python3
"""בונה חפיסות אנקי (.apkg) מכרטיסי הנוטבוק, עם שערי איכות.

    python3 anki-build.py

למה מפייתון ולא מ-node: קובץ .apkg הוא מסד SQLite בתוך zip, ולפייתון יש את
שניהם בספרייה התקנית. ב-node זה היה דורש תלות חיצונית, ולריפו הזה אין אף אחת.

מאיפה מגיעים הכרטיסים (הבנייה מחדש, 08/2026): `sources/anki-<course>-notebook.json`
— כרטיסים שהנוטבוק של הקורס כתב לפי סדר היום של מפת החומרים (`anki-ask.py`).
הגרסה הראשונה העתיקה את טקסט המפה עצמו, וטקסט של סיכום אינו טקסט של כרטיס:
פסקאות, כמה עובדות בכרטיס, צד קדמי שהוא אמירה. המפה נשארת סדר היום —
דרך השדה `pi` כל כרטיס יודע איזו נקודה הוא מכסה — אבל הטקסט הוא של הנוטבוק.

שערי איכות — כרטיס שנכשל באחד מהם לא נכנס לחפיסה, ומודפס בסוף הריצה:
  · צד קדמי בלי סימן שאלה (אמירה במקום שאלה)
  · יותר משני משפטים באחד הצדדים
  · יותר מ-25 מילים בצד הקדמי

תמונות: אין. שתי האפשרויות שנבדקו נפסלו — איורי הנושא מהסיכומים הוצמדו
בגרסה הראשונה לכרטיסים שאין להם קשר אליהם, ו"גרפי המבחן" (exams/media)
התבררו כצילומי מסך של שאלה שלמה, כולל נוסח ומסיחים — רעש שמדליף תשובות
של שאלות אחרות לתוך כרטיס. תמונה תצורף רק כשיהיה מקור לאיור שהוא של
הכרטיס עצמו.

מבנה הפלט: חפיסת-אב לקורס עם תת-חפיסה לכל נושא (`anki/<course>.apkg`),
וגם קובץ נפרד לכל נושא (`anki/<course>/<nn>.apkg`) — לסטודנט שרוצה נושא
אחד בלי להוריד את הכול. שתי הצורות בנויות מאותם כרטיסים עם אותם מזהים,
כך שייבוא כפול לא משכפל.

‼️ מזהה הכרטיס (`guid`) נגזר מ-sha1 של מקצוע+נושא+שאלה, ולכן הוא **יציב**:
בנייה חוזרת מייצרת אותם מזהים, ואנקי מעדכן את הכרטיס הקיים במקום ליצור
כרטיס שני. זה הדבר היחיד כאן שאי אפשר לתקן בדיעבד — מי שכבר למד מהחפיסה
היה מקבל כפילויות בכל עדכון.
"""

import hashlib
import json
import os
import re
import sqlite3
import tempfile
import time
import zipfile

ROOT = os.path.dirname(os.path.abspath(__file__))
EXAMS = os.path.join(ROOT, 'exams')
SRC = os.path.join(ROOT, 'sources')
OUT = os.path.join(ROOT, 'anki')

# זמן קבוע ולא now(): כך בנייה חוזרת מייצרת קובץ זהה, והדיף בגיט קריא.
EPOCH = 1735689600  # 2025-01-01
# מודל חדש לבנייה מחדש — לא ממחזרים את מזהה מודל ה"מלכודת/עיקרון" הישן,
# כי השדות שונים ואנקי לא יודע למזג סכמות.
MODEL_ID = 1735689600002
DECK_BASE = 1735689600100


def stable_id(*parts):
    """מזהה יציב מתוך תוכן. הבסיס של אי-השכפול."""
    h = hashlib.sha1('␟'.join(parts).encode('utf-8')).hexdigest()
    return h[:20]


def field_checksum(text):
    """csum של אנקי — 8 ספרות hex ראשונות של sha1 על השדה הראשון."""
    return int(hashlib.sha1(text.encode('utf-8')).hexdigest()[:8], 16)


CSS = """.card {
  font-family: -apple-system, "Segoe UI", Arial, sans-serif;
  font-size: 21px; text-align: right; direction: rtl;
  color: #16222E; background: #FFFFFF; padding: 18px;
}
.topic { font-size: 13px; font-weight: 700; color: #0F6B58;
         letter-spacing: .04em; margin-bottom: 12px; }
.q { font-size: 22px; font-weight: 600; line-height: 1.5; }
.a { font-size: 20px; line-height: 1.6; }
hr#answer { border: 0; border-top: 1px solid #E3E8E5; margin: 18px 0; }
.nightMode.card { color: #E8EDF2; background: #1B2530; }
.nightMode hr#answer { border-top-color: #33404D; }
"""

FRONT = ('<div class="topic">{{נושא}}</div>\n'
         '<div class="q">{{שאלה}}</div>')
BACK = ('<div class="topic">{{נושא}}</div>\n'
        '<div class="q">{{שאלה}}</div>\n'
        '<hr id="answer">\n'
        '<div class="a">{{תשובה}}</div>')

SCHEMA = """
CREATE TABLE col (id integer primary key, crt integer not null, mod integer not null,
  scm integer not null, ver integer not null, dty integer not null, usn integer not null,
  ls integer not null, conf text not null, models text not null, decks text not null,
  dconf text not null, tags text not null);
CREATE TABLE notes (id integer primary key, guid text not null, mid integer not null,
  mod integer not null, usn integer not null, tags text not null, flds text not null,
  sfld integer not null, csum integer not null, flags integer not null, data text not null);
CREATE TABLE cards (id integer primary key, nid integer not null, did integer not null,
  ord integer not null, mod integer not null, usn integer not null, type integer not null,
  queue integer not null, due integer not null, ivl integer not null, factor integer not null,
  reps integer not null, lapses integer not null, left integer not null, odue integer not null,
  odid integer not null, flags integer not null, data text not null);
CREATE TABLE revlog (id integer primary key, cid integer not null, usn integer not null,
  ease integer not null, ivl integer not null, lastIvl integer not null, factor integer not null,
  time integer not null, type integer not null);
CREATE TABLE graves (usn integer not null, oid integer not null, type integer not null);
CREATE INDEX ix_notes_usn on notes (usn);
CREATE INDEX ix_cards_usn on cards (usn);
CREATE INDEX ix_revlog_usn on revlog (usn);
CREATE INDEX ix_cards_nid on cards (nid);
CREATE INDEX ix_cards_sched on cards (did, queue, due);
CREATE INDEX ix_revlog_cid on revlog (cid);
CREATE INDEX ix_notes_csum on notes (csum);
"""

DCONF = {"1": {"id": 1, "name": "Default", "replayq": True, "lapse": {
    "leechFails": 8, "minInt": 1, "delays": [10], "leechAction": 1, "mult": 0},
    "rev": {"perDay": 200, "fuzz": 0.05, "ivlFct": 1, "maxIvl": 36500, "ease4": 1.3,
            "bury": False, "minSpace": 1}, "timer": 0, "maxTaken": 60, "usn": 0,
    "new": {"perDay": 20, "delays": [1, 10], "separate": True, "ints": [1, 4, 7],
            "initialFactor": 2500, "bury": False, "order": 1}, "mod": 0, "autoplay": True}}

CONF = {"nextPos": 1, "estTimes": True, "activeDecks": [1], "sortType": "noteFld",
        "timeLim": 0, "sortBackwards": False, "addToCur": True, "curDeck": 1,
        "newBury": True, "newSpread": 0, "dueCounts": True, "curModel": str(MODEL_ID),
        "collapseTime": 1200}


# ================= שערי איכות =================

def sentence_count(text):
    """ספירת משפטים גסה. נקודה בתוך סוגריים/קיצור לא נספרת כי אין אחריה רווח+אות."""
    clean = re.sub(r'\([^)]*\)', '', text)          # (Schwann) וכד' לא משפט
    clean = re.sub(r'\b\d+\.\d+\b', '', clean)      # מספרים עשרוניים
    ends = re.findall(r'[.!?](?:\s|$)', clean.strip())
    return max(1, len(ends)) if clean.strip() else 0


def gate(card):
    """שם השער שהכרטיס נכשל בו, או None אם עבר. כרטיס שנפסל לא נכנס לחפיסה."""
    q, a = card['q'], card['a']
    if '?' not in q:
        return 'צד קדמי בלי סימן שאלה'
    if len(q.split()) > 25:
        return f'צד קדמי ארוך מדי ({len(q.split())} מילים)'
    if sentence_count(q) > 2:
        return 'יותר משני משפטים בצד הקדמי'
    if sentence_count(a) > 2:
        return f'יותר משני משפטים בצד האחורי ({sentence_count(a)})'
    return None


# ================= מקורות =================

def blocked_questions(course):
    """שאלות שנפסלו בבדיקת התוכן — sources/anki-blocked.json.

    שער האיכות תופס צורה (סימן שאלה, אורך); את התוכן בודקים סוכנים מול
    נקודות המפה, והפסילות נרשמות שם. קובץ נפרד ולא עריכת המקור, כי
    anki-ask.py דורס נושא בכל שאילה מחדש והחסימה צריכה לשרוד."""
    path = os.path.join(SRC, 'anki-blocked.json')
    if not os.path.exists(path):
        return set()
    data = json.load(open(path, encoding='utf-8'))
    return {b['q'] for b in data.get('blocked', []) if b.get('course') == course}


def guide_points(course):
    """נושא → רשימת הנקודות מהמפה, לפי הסדר במפה. סדר היום של החפיסה."""
    src = os.path.join(EXAMS, f'{course}-guide.json')
    if not os.path.exists(src):
        return {}
    guide = json.load(open(src, encoding='utf-8'))
    out = {}
    for unit in guide.get('units', []):
        topic = (unit.get('topic') or '').strip()
        if topic:
            out[topic] = unit.get('points') or []
    return out


# ================= בנייה =================

def make_collection(course, title, decks_cards, model_extra_did=None):
    """בונה קובץ collection.anki2 זמני ומחזיר את הנתיב.

    decks_cards: רשימת (שם-חפיסה-מלא, כרטיסים) — כרטיס הוא dict עם
    q/a/topic/guid."""
    model = {str(MODEL_ID): {
        "id": MODEL_ID, "name": "ארכיון השחזורים — שאלה ותשובה", "type": 0,
        "mod": EPOCH, "usn": -1, "sortf": 0, "did": 1, "css": CSS, "latexPre": "",
        "latexPost": "", "latexsvg": False, "req": [[0, "any", [0, 1]]], "tags": [],
        "vers": [],
        "flds": [{"name": n, "ord": i, "sticky": False, "rtl": True, "font": "Arial",
                  "size": 20, "media": []} for i, n in enumerate(['שאלה', 'תשובה', 'נושא'])],
        "tmpls": [{"name": "שאלה → תשובה", "ord": 0, "qfmt": FRONT, "afmt": BACK,
                   "did": None, "bqfmt": "", "bafmt": "", "bfont": "", "bsize": 0}],
    }}

    decks = {"1": {"id": 1, "name": "Default", "mod": EPOCH, "usn": -1, "lrnToday": [0, 0],
                   "revToday": [0, 0], "newToday": [0, 0], "timeToday": [0, 0],
                   "collapsed": True, "browserCollapsed": True, "desc": "", "dyn": 0,
                   "conf": 1, "extendNew": 0, "extendRev": 0}}
    notes, cards = [], []
    nid = EPOCH * 1000
    for di, (deck_name, deck_cards) in enumerate(decks_cards):
        did = DECK_BASE + di
        decks[str(did)] = {"id": did, "name": deck_name, "mod": EPOCH, "usn": -1,
                           "lrnToday": [0, 0], "revToday": [0, 0], "newToday": [0, 0],
                           "timeToday": [0, 0], "collapsed": di > 0,
                           "browserCollapsed": di > 0, "desc": "", "dyn": 0, "conf": 1,
                           "extendNew": 0, "extendRev": 0}
        for c in deck_cards:
            flds = '\x1f'.join([c['q'], c['a'], c['topic']])
            notes.append((nid, c['guid'], MODEL_ID, EPOCH, -1, f' {c["topic"]} ', flds,
                          c['q'], field_checksum(c['q']), 0, ''))
            cards.append((nid + 1, nid, did, 0, EPOCH, -1, 0, 0, len(cards) + 1,
                          0, 0, 0, 0, 0, 0, 0, 0, ''))
            nid += 2

    tmp = tempfile.mkdtemp()
    db_path = os.path.join(tmp, 'collection.anki2')
    db = sqlite3.connect(db_path)
    db.executescript(SCHEMA)
    db.execute(
        'INSERT INTO col VALUES (1,?,?,?,11,0,0,0,?,?,?,?,?)',
        (EPOCH, EPOCH, EPOCH * 1000, json.dumps(CONF), json.dumps(model),
         json.dumps(decks), json.dumps(DCONF), '{}'))
    db.executemany('INSERT INTO notes VALUES (?,?,?,?,?,?,?,?,?,?,?)', notes)
    db.executemany('INSERT INTO cards VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', cards)
    db.commit()
    db.close()
    return db_path


def write_apkg(path, db_path, media):
    """media: שם-קובץ → נתיב מלא במאגר."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
        z.write(db_path, 'collection.anki2')
        # פורמט המדיה של אנקי: הקבצים נשמרים בשמות 0,1,2… ו-`media` הוא
        # המפה מהמספר לשם האמיתי, והכרטיס מפנה לשם האמיתי.
        names = sorted(media)
        z.writestr('media', json.dumps({str(i): n for i, n in enumerate(names)},
                                       ensure_ascii=False))
        for i, n in enumerate(names):
            z.write(media[n], str(i))
    return os.path.getsize(path)


def build(course, title):
    src = os.path.join(SRC, f'anki-{course}-notebook.json')
    if not os.path.exists(src):
        return None, []
    store = json.load(open(src, encoding='utf-8'))
    points = guide_points(course)
    if not points or not store.get('topics'):
        return None, []

    blocked = blocked_questions(course)
    rejected = []
    by_topic = []           # (topic, cards) לפי סדר המפה
    for topic, pts in points.items():
        entry = store['topics'].get(topic)
        if not entry or not entry.get('cards'):
            continue
        ok = []
        for c in entry['cards']:
            # כרטיס בלי pi הוא מהפורמט הישן (הפיילוט של ביומול) — לא חלק
            # מהבנייה מחדש, ואין דרך לקשר אותו לנקודה במפה.
            if 'pi' not in c:
                continue
            if c['q'] in blocked:
                rejected.append((topic, c['q'][:60], 'נחסם בבדיקת התוכן'))
                continue
            why = gate(c)
            if why:
                rejected.append((topic, c['q'][:60], why))
                continue
            ok.append({'q': c['q'], 'a': c['a'], 'topic': topic,
                       'guid': stable_id(course, topic, c['q'])})
        if ok:
            by_topic.append((topic, ok))
    if not by_topic:
        return None, rejected

    parent = f'ארכיון השחזורים::{title}'

    # החפיסה המלאה: אב + תת-חפיסה לכל נושא
    decks_cards = [(parent, [])] + [(f'{parent}::{t}', cs) for t, cs in by_topic]
    all_cards = [c for _, cs in by_topic for c in cs]
    db = make_collection(course, title, decks_cards)
    size = write_apkg(os.path.join(OUT, f'{course}.apkg'), db, {})

    # קובץ לנושא: אותה היררכיה בדיוק (אב::נושא), אותם guids — ייבוא של
    # קובץ נושא אחרי החפיסה המלאה (או להפך) מתמזג ולא משכפל.
    topics_out = []
    for ti, (topic, cs) in enumerate(by_topic):
        tdb = make_collection(course, title, [(f'{parent}::{topic}', cs)])
        tfile = f'anki/{course}/{ti:02d}.apkg'
        tsize = write_apkg(os.path.join(ROOT, tfile), tdb, {})
        topics_out.append({'topic': topic, 'cards': len(cs),
                           'file': tfile, 'bytes': tsize,
                           'preview': [{'q': c['q'], 'a': c['a']} for c in cs[:3]]})

    info = {'course': course, 'title': title, 'file': f'anki/{course}.apkg',
            'cards': len(all_cards), 'bytes': size, 'topics': topics_out}
    return info, rejected


COURSES = [('electro', 'אלקטרופיזיולוגיה'),
           ('molecular', 'ביולוגיה מולקולרית'),
           ('physics', 'פיזיקה לרפואנים ב׳')]

if __name__ == '__main__':
    built, all_rejected = [], []
    for c, t in COURSES:
        info, rej = build(c, t)
        all_rejected += [(t, *r) for r in rej]
        if info:
            built.append(info)
    index = {'built': time.strftime('%Y-%m-%d', time.gmtime()), 'decks': built}
    json.dump(index, open(os.path.join(EXAMS, 'anki-index.json'), 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)
    for b in built:
        print(f"  {b['title']:22s} {b['cards']:4d} כרטיסים · "
              f"{len(b['topics']):2d} נושאים · {b['bytes'] // 1024} KB")
    if all_rejected:
        print(f'\n⛔ {len(all_rejected)} כרטיסים נפסלו בשערי האיכות:')
        for course_t, topic, q, why in all_rejected:
            print(f'  · [{course_t} / {topic}] {q}… — {why}')
    print(f"\n{len(built)} חפיסות ב-anki/ · אינדקס ב-exams/anki-index.json")
