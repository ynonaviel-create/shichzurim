#!/usr/bin/env python3
"""בונה חפיסות אנקי (.apkg) ממפות החומרים של הארכיון.

    python3 anki-build.py

למה מפייתון ולא מ-node: קובץ .apkg הוא מסד SQLite בתוך zip, ולפייתון יש את
שניהם בספרייה התקנית. ב-node זה היה דורש תלות חיצונית, ולריפו הזה אין אף אחת.

מאיפה מגיעים הכרטיסים: `exams/<course>-guide.json` — מפת החומרים. לכל יחידה
יש נושא, ובתוכה נקודות; לכל נקודה יש `point` (העיקרון) ו-`trap` (איך נופלים
בו במבחן). זה בדיוק כרטיס: הצד הקדמי הוא המלכודת, הצד האחורי הוא העיקרון
שמונע אותה. שני הטקסטים מועתקים כמו שהם — לא ממציאים כאן תוכן.

מבנה החפיסה: חפיסת-אב אחת לקורס, ותת-חפיסה לכל נושא. כך המשתמש מוריד קובץ
אחד ובוחר באנקי איזה נושא ללמוד, בלי שנצטרך לייצר קובץ לכל שילוב נושאים.

‼️ מזהה הכרטיס (`guid`) נגזר מ-sha1 של מקצוע+נושא+נקודה, ולכן הוא **יציב**:
בנייה חוזרת מייצרת אותם מזהים, ואנקי מעדכן את הכרטיס הקיים במקום ליצור
כרטיס שני. זה הדבר היחיד כאן שאי אפשר לתקן בדיעבד — מי שכבר למד מהחפיסה
היה מקבל כפילויות בכל עדכון.
"""

import hashlib
import json
import os
import sqlite3
import tempfile
import time
import zipfile

ROOT = os.path.dirname(os.path.abspath(__file__))
EXAMS = os.path.join(ROOT, 'exams')
OUT = os.path.join(ROOT, 'anki')

# זמן קבוע ולא now(): כך בנייה חוזרת מייצרת קובץ זהה, והדיף בגיט קריא.
EPOCH = 1735689600  # 2025-01-01
MODEL_ID = 1735689600001
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
.trap  { font-size: 22px; font-weight: 600; line-height: 1.5; }
.point { font-size: 20px; line-height: 1.6; }
hr#answer { border: 0; border-top: 1px solid #E3E8E5; margin: 18px 0; }
.hint { font-size: 13px; color: #7D8C88; margin-top: 14px; }
"""

FRONT = ('<div class="topic">{{נושא}}</div>\n'
         '<div class="trap">{{מלכודת}}</div>\n'
         '<div class="hint">מה העיקרון שמונע אותה?</div>')
BACK = ('<div class="topic">{{נושא}}</div>\n'
        '<div class="trap">{{מלכודת}}</div>\n'
        '<hr id="answer">\n'
        '<div class="point">{{עיקרון}}</div>')

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


def image_by_qid():
    """qid → נתיב תמונה, מכל קבצי המבחנים.

    זו הדרך היחידה לצרף תמונה לכרטיס בלי להמציא: אם נקודה במפה מקושרת לשאלה
    שיש לה גרף, הגרף הזה **הוא** האיור של הנקודה. באלקטרו זה מכסה 42 מתוך 147
    הנקודות; בביומול כמעט כלום, ושם נדרשים איורים חדשים.
    """
    out = {}
    for f in sorted(os.listdir(EXAMS)):
        if not f.endswith('.json'):
            continue
        try:
            j = json.load(open(os.path.join(EXAMS, f), encoding='utf-8'))
        except Exception:
            continue
        for q in (j.get('questions') or []):
            if isinstance(q, dict) and q.get('qid') and q.get('image'):
                out.setdefault(q['qid'], q['image'])
    return out


def topic_figures(course):
    """נושא → איור SVG מהסיכום המלא.

    בסיכומים כבר יש 33 איורים שצוירו ידנית — 21 בפיזיקה, 12 באלקטרו — והם
    ישבו שם בלי שימוש. לכל סעיף בסיכום יש כותרת ששווה לשם הנושא, ולכן
    אפשר לחבר אותם בלי לנחש.

    האיור מצורף רק לכרטיס שאין לו כבר גרף מהמבחן: גרף מהשאלה ספציפי יותר
    ולכן עדיף, והאיור הוא הרשת מתחת.
    """
    import re
    src = {'physics': ('guides/physics-full.html', 'unit', 'h3'),
           'electro': ('guides/electro-full.html', 'chap', 'h2')}.get(course)
    if not src:
        return {}
    path = os.path.join(ROOT, src[0])
    if not os.path.exists(path):
        return {}
    html = open(path, encoding='utf-8').read()
    secs = re.findall(r'<section[^>]*class="[^"]*\b' + src[1] + r'\b[^"]*"[^>]*>(.*?)(?=<section|</body>)',
                      html, re.S)
    out = {}
    for sec in secs:
        h = re.search(r'<' + src[2] + r'[^>]*>(.*?)</' + src[2] + r'>', sec, re.S)
        g = re.search(r'<svg[\s>].*?</svg>', sec, re.S)
        if not (h and g):
            continue
        title = re.sub(r'<button.*?</button>', ' ', h.group(1), flags=re.S)
        title = re.sub(r'<[^>]+>', ' ', title)
        title = re.sub(r'[\u0591-\u05C7]', '', title)
        title = re.sub(r'\s+', ' ', title).strip()
        if title:
            svg = g.group(0)
            # ‼️ בתוך HTML הדפדפן מסיק namespace; בקובץ .svg עצמאי הוא לא,
            # והאיור פשוט לא מרונדר. כל 21 איורי הפיזיקה נשברו ככה בשקט.
            if 'xmlns' not in svg[:200]:
                svg = svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"', 1)
            out[title] = svg
    return out


def build(course, title):
    src = os.path.join(EXAMS, f'{course}-guide.json')
    if not os.path.exists(src):
        return None
    guide = json.load(open(src, encoding='utf-8'))

    # נקודות לפי נושא, בסדר שבו הן מופיעות במפה
    by_topic = []
    for unit in guide.get('units', []):
        topic = (unit.get('topic') or '').strip()
        pts = [p for p in (unit.get('points') or [])
               if (p.get('point') or '').strip() and (p.get('trap') or '').strip()]
        if topic and pts:
            by_topic.append((topic, pts))
    if not by_topic:
        return None

    model = {str(MODEL_ID): {
        "id": MODEL_ID, "name": "ארכיון השחזורים — מלכודת ועיקרון", "type": 0,
        "mod": EPOCH, "usn": -1, "sortf": 0, "did": 1, "css": CSS, "latexPre": "",
        "latexPost": "", "latexsvg": False, "req": [[0, "any", [0, 1]]], "tags": [],
        "vers": [],
        "flds": [{"name": n, "ord": i, "sticky": False, "rtl": True, "font": "Arial",
                  "size": 20, "media": []} for i, n in enumerate(['מלכודת', 'עיקרון', 'נושא'])],
        "tmpls": [{"name": "מלכודת → עיקרון", "ord": 0, "qfmt": FRONT, "afmt": BACK,
                   "did": None, "bqfmt": "", "bafmt": "", "bfont": "", "bsize": 0}],
    }}

    parent = f'ארכיון השחזורים::{title}'
    decks = {"1": {"id": 1, "name": "Default", "mod": EPOCH, "usn": -1, "lrnToday": [0, 0],
                   "revToday": [0, 0], "newToday": [0, 0], "timeToday": [0, 0],
                   "collapsed": True, "browserCollapsed": True, "desc": "", "dyn": 0,
                   "conf": 1, "extendNew": 0, "extendRev": 0}}

    def add_deck(did, name, collapsed=False):
        decks[str(did)] = {"id": did, "name": name, "mod": EPOCH, "usn": -1,
                           "lrnToday": [0, 0], "revToday": [0, 0], "newToday": [0, 0],
                           "timeToday": [0, 0], "collapsed": collapsed,
                           "browserCollapsed": collapsed, "desc": "", "dyn": 0, "conf": 1,
                           "extendNew": 0, "extendRev": 0}

    add_deck(DECK_BASE, parent)

    qimg = image_by_qid()
    figs = topic_figures(course)
    media = {}          # שם → נתיב במאגר
    inline = {}         # שם → תוכן (איורי SVG שנחתכו מהסיכום)
    notes, cards = [], []
    nid = EPOCH * 1000
    for ti, (topic, pts) in enumerate(by_topic):
        did = DECK_BASE + 1 + ti
        add_deck(did, f'{parent}::{topic}', collapsed=True)
        for p in pts:
            trap = p['trap'].strip()
            point = p['point'].strip()
            guid = stable_id(course, topic, point)
            # אם לאחת השאלות של הנקודה יש גרף — הוא נכנס לצד האחורי
            img = next((qimg[q] for q in (p.get('qids') or []) if q in qimg), None)
            back_extra = ''
            if img and os.path.exists(os.path.join(ROOT, img)):
                name = os.path.basename(img)
                media[name] = img
                back_extra = f'<br><img src="{name}">'
            elif topic in figs:
                name = f'fig-{course}-{stable_id(topic)[:8]}.svg'
                inline[name] = figs[topic]
                back_extra = f'<br><img src="{name}">'
            flds = '\x1f'.join([trap, point + back_extra, topic])
            notes.append((nid, guid, MODEL_ID, EPOCH, -1, f' {topic} ', flds,
                          trap, field_checksum(trap), 0, ''))
            cards.append((nid + 1, nid, did, 0, EPOCH, -1, 0, 0, len(cards) + 1,
                          0, 0, 0, 0, 0, 0, 0, 0, ''))
            nid += 2

    os.makedirs(OUT, exist_ok=True)
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

    apkg = os.path.join(OUT, f'{course}.apkg')
    with zipfile.ZipFile(apkg, 'w', zipfile.ZIP_DEFLATED) as z:
        z.write(db_path, 'collection.anki2')
        # פורמט המדיה של אנקי: הקבצים נשמרים בשמות 0,1,2… ו-`media` הוא
        # המפה מהמספר לשם האמיתי, והכרטיס מפנה לשם האמיתי.
        names = sorted(media) + sorted(inline)
        z.writestr('media', json.dumps({str(i): n for i, n in enumerate(names)},
                                       ensure_ascii=False))
        for i, n in enumerate(names):
            if n in media:
                z.write(os.path.join(ROOT, media[n]), str(i))
            else:
                z.writestr(str(i), inline[n])

    return {'course': course, 'title': title, 'file': f'anki/{course}.apkg',
            'cards': len(notes), 'images': len(media) + len(inline), 'topics': [{'topic': t, 'cards': len(p)} for t, p in by_topic],
            'bytes': os.path.getsize(apkg)}


COURSES = [('electro', 'אלקטרופיזיולוגיה'),
           ('molecular', 'ביולוגיה מולקולרית'),
           ('physics', 'פיזיקה לרפואנים ב׳')]

if __name__ == '__main__':
    built = [b for b in (build(c, t) for c, t in COURSES) if b]
    index = {'built': time.strftime('%Y-%m-%d', time.gmtime()), 'decks': built}
    json.dump(index, open(os.path.join(EXAMS, 'anki-index.json'), 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)
    for b in built:
        print(f"  {b['title']:22s} {b['cards']:4d} כרטיסים · "
              f"{len(b['topics']):2d} נושאים · {b['images']:3d} תמונות · {b['bytes'] // 1024} KB")
    print(f"\n{len(built)} חפיסות ב-anki/ · אינדקס ב-exams/anki-index.json")
