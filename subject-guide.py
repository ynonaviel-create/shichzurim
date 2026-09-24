#!/usr/bin/env python3
"""מפת החומרים של מבחן בלוק — נכתבת מקצוע-מקצוע, במקביל, בלי להתנגש.

קורס עם `subjects` (עקרונות המדע א׳/ב׳) מחזיק מפה אחת לכל הקורס, אבל כל
מקצוע נכתב בסשן נפרד. כדי ששמונה סשנים לא ידרסו קובץ אחד, כל מקצוע כותב
פרגמנט משלו, והמטה ממזג:

    exams/_staging/fragments/<course>-<key>.json    ← רשימת יחידות (units) של המקצוע

פקודות:

    python3 subject-guide.py dump    <course> <key>   # השאלות וההסברים לכל נושא → sources/ekronot/dumps/
    python3 subject-guide.py skeleton <course> <key>  # פרגמנט ריק להתחלה (לא דורס קיים)
    python3 subject-guide.py check   <course> <key>   # בדיקת הפרגמנט — מה שסשן מקצוע מריץ
    python3 subject-guide.py merge   <course>         # המטה: כל הפרגמנטים → exams/_staging/<course>-guide.json
    python3 subject-guide.py publish <course>         # המטה: המפה עולה לאוויר (exams/<course>-guide.json)
    python3 subject-guide.py status                   # לוח השלמות: שש הדלתות לכל נושא, בכל מבחני הבלוק

מה נבדק (ואי אפשר לעקוף): כל נקודה ב-"מה באמת נשאל" מצביעה על qid-ים
אמיתיים, מאותו נושא — כלומר אי אפשר להמציא נקודה בלי שאלה שבדקה אותה.
`freq` לא נכתב ביד: הוא מחושב במיזוג ממכסת המקצוע בסימולציה × חלקו של
הנושא בשאלות המקצוע. `related` (קישור לנושא במקצוע אחר) נבדק שהיעד קיים.
"""
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).parent
EXAMS = ROOT / "exams"
STAGING = EXAMS / "_staging"
FRAG = STAGING / "fragments"
DUMPS = ROOT / "sources" / "ekronot" / "dumps"

CERTAINTY = ("known", "mixed", "unknown", "new")
UNIT_KEYS = {"topic", "lessons", "lecturers", "freq", "certainty", "what", "main", "sup", "gap",
             "points", "related", "intel", "videos"}


def die(msg):
    sys.exit("❌ " + msg)


def courses():
    return json.loads((EXAMS / "courses.json").read_text(encoding="utf-8"))["courses"]


def course_of(cid):
    c = next((c for c in courses() if c["id"] == cid), None)
    if not c:
        die(f"הקורס {cid} לא קיים ב-courses.json")
    if not c.get("subjects"):
        die(f"לקורס {cid} אין subjects — הכלי הזה רק למבחני בלוק")
    return c


def subject_of(c, key):
    s = next((s for s in c["subjects"] if s["key"] == key), None)
    if not s:
        die(f"אין מקצוע '{key}' ב-{c['id']} (יש: {', '.join(x['key'] for x in c['subjects'])})")
    return s


def banks(cid):
    """כל בנקי השאלות של הקורס, בלי ה-High Yield (הוא חולק qid עם המקור ומנפח ספירות)."""
    out = []
    for f in sorted(EXAMS.glob(f"{cid}-*.json")):
        d = json.loads(f.read_text(encoding="utf-8"))
        if d.get("kind") in ("highyield", "guide") or not d.get("questions"):
            continue
        out.append(d)
    return out


def qindex(cid, evidence_only=True):
    """qid → מטא. ברירת המחדל כמו sync.js: בנק עם guideEvidence:false (שאלות שנכתבו
    כאן) אינו ראיה ל"מה באמת נשאל" — ה-qid שלו לא חוקי ב-points ולא נספר בכיסוי."""
    idx = {}
    for d in banks(cid):
        home = d.get("guideEvidence") is False
        if evidence_only and home:
            continue
        for i, q in enumerate(d["questions"]):
            if q.get("qid"):
                idx[q["qid"]] = {"topic": q.get("topic"), "off": bool(q.get("offSyllabus")), "home": home,
                                 "trust": d.get("trust"), "exam": d["id"], "title": d.get("title"), "i": i + 1, "q": q}
    return idx


def topics_anywhere():
    """כל הנושאים שקיימים בשאלות, לכל קורס — היעדים החוקיים של related."""
    out = defaultdict(set)
    for f in EXAMS.glob("*.json"):
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            continue
        if isinstance(d, dict) and d.get("course") and isinstance(d.get("questions"), list):
            for q in d["questions"]:
                if q.get("topic"):
                    out[d["course"]].add(q["topic"])
    return out


def frag_path(cid, key):
    return FRAG / f"{cid}-{key}.json"


# ───────────────────────── dump ─────────────────────────
def cmd_dump(cid, key):
    c = course_of(cid)
    s = subject_of(c, key)
    idx = qindex(cid, evidence_only=False)
    by = defaultdict(list)
    for qid, m in idx.items():
        if m["topic"] in s["topics"]:
            by[m["topic"]].append((qid, m))
    DUMPS.mkdir(parents=True, exist_ok=True)
    out = [f"# {s['name']} — כל השאלות לפי נושא ({cid})\n",
           "ה-qid הוא מה שנכנס ל-points[].qids. ⚠️ = מפתח שלא אומת (partial/unverified). 🚫 = offSyllabus. "
           "🏠 = שאלה שנכתבה כאן (guideEvidence:false) — טובה ללומדה, אבל **אינה ראיה** ואסור לה ב-points.\n"]
    for t in s["topics"]:
        rows = sorted(by[t], key=lambda r: (r[1]["exam"], r[1]["i"]))
        n_in = sum(1 for _, m in rows if not m["off"] and not m["home"])
        n_home = sum(1 for _, m in rows if m["home"])
        out.append(f"\n\n## {t} — {n_in} ראיות בסילבוס, {n_home} שנכתבו כאן, {sum(1 for _, m in rows if m['off'])} מחוץ\n")
        for qid, m in rows:
            q = m["q"]
            flag = ("" if m["trust"] == "verified" else " ⚠️") + (" 🚫" if m["off"] else "") + (" 🏠" if m["home"] else "")
            out.append(f"\n### `{qid}`{flag} — {m['title']} · שאלה {m['i']}\n")
            out.append(q["q"] + "\n")
            for j, o in enumerate(q.get("opts", [])):
                out.append(f"{j + 1}. {'✅ ' if j == q.get('a') else ''}{o}")
            out.append(f"\n**הסבר:** {q.get('explain', '')}")
            if q.get("note"):
                out.append(f"\n**הערה:** {q['note']}")
    p = DUMPS / f"{cid}-{key}.md"
    p.write_text("\n".join(out), encoding="utf-8")
    print(f"✅ {p} — {sum(len(v) for v in by.values())} שאלות ב-{len(s['topics'])} נושאים")


# ───────────────────────── skeleton ─────────────────────────
def cmd_skeleton(cid, key):
    c = course_of(cid)
    s = subject_of(c, key)
    p = frag_path(cid, key)
    if p.exists():
        die(f"{p} כבר קיים — לא דורס")
    FRAG.mkdir(parents=True, exist_ok=True)
    units = [{"topic": t, "lessons": "", "lecturers": [], "certainty": "unknown",
              "what": "TODO", "main": {"src": "TODO", "pages": "", "section": ""},
              "sup": [], "gap": "", "points": [], "related": []} for t in s["topics"]]
    p.write_text(json.dumps(units, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"✅ {p} — {len(units)} יחידות ריקות")


# ───────────────────────── check ─────────────────────────
def check_units(c, s, units, idx, anywhere):
    errs, warns = [], []
    if not isinstance(units, list):
        return [f"הפרגמנט חייב להיות רשימה של יחידות"], []
    seen = set()
    for u in units:
        t = u.get("topic")
        at = f"[{t}]"
        if t not in s["topics"]:
            errs.append(f"{at} הנושא אינו ברשימת הנושאים של {s['name']}")
            continue
        if t in seen:
            errs.append(f"{at} יחידה כפולה")
        seen.add(t)
        extra = set(u) - UNIT_KEYS
        if extra:
            errs.append(f"{at} שדות לא מוכרים: {', '.join(sorted(extra))}")
        if "freq" in u:
            warns.append(f"{at} freq נכתב ביד — הוא מחושב במיזוג, והערך שכתבת יידרס")
        if u.get("certainty") not in CERTAINTY:
            errs.append(f"{at} certainty חייב להיות אחד מ: {', '.join(CERTAINTY)}")
        for f in ("what",):
            if not u.get(f) or "TODO" in str(u.get(f)):
                errs.append(f"{at} {f} ריק או TODO")
        main = u.get("main") or {}
        if not main.get("src") or "TODO" in main.get("src", ""):
            errs.append(f"{at} main.src ריק או TODO — מאיזה סיכום לומדים את הנושא")
        pts = u.get("points") or []
        mapped = set()
        for k, p in enumerate(pts):
            pa = f"{at} נקודה {k + 1}"
            if not p.get("point") or not p.get("trap"):
                errs.append(f"{pa}: חייבים point וגם trap")
            if "<" in (p.get("point") or ""):
                errs.append(f"{pa}: point מוצג כטקסט פשוט — בלי HTML (ב-trap וב-gap מותר)")
            qids = p.get("qids") or []
            if not qids:
                errs.append(f"{pa}: אין qids — נקודה בלי שאלה שבדקה אותה היא טענה בלי ראיה")
            for q in qids:
                m = idx.get(q)
                if not m:
                    errs.append(f"{pa}: qid {q} לא קיים בשאלות של {c['id']}")
                elif m["topic"] != t:
                    errs.append(f"{pa}: qid {q} שייך לנושא \"{m['topic']}\", לא ל-\"{t}\"")
                mapped.add(q)
        in_topic = {q for q, m in idx.items() if m["topic"] == t and not m["off"]}
        missing = in_topic - mapped
        if in_topic and missing:
            warns.append(f"{at} {len(missing)} מתוך {len(in_topic)} השאלות (בסילבוס) לא ממופות לאף נקודה")
        if in_topic and not pts:
            errs.append(f"{at} אין אף נקודה ב-\"מה באמת נשאל\", ויש {len(in_topic)} שאלות בנושא")
        for r in u.get("related") or []:
            rc, rt = r.get("course"), r.get("topic")
            if not r.get("why"):
                errs.append(f"{at} related → {rt}: חסר why (משפט אחד: מה הקשר)")
            if rt not in anywhere.get(rc, set()):
                errs.append(f"{at} related → {rc}/{rt}: אין נושא כזה בשאלות של הקורס")
            if rc == c["id"] and rt in s["topics"]:
                warns.append(f"{at} related → {rt}: באותו מקצוע — related נועד לגשר בין מקצועות")
    for t in s["topics"]:
        if t not in seen:
            errs.append(f"[{t}] אין יחידה לנושא")
    return errs, warns


def cmd_check(cid, key, quiet=False):
    c = course_of(cid)
    s = subject_of(c, key)
    p = frag_path(cid, key)
    if not p.exists():
        die(f"אין פרגמנט: {p} — התחל ב: python3 subject-guide.py skeleton {cid} {key}")
    try:
        units = json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        die(f"{p}: JSON לא תקין — {e}")
    errs, warns = check_units(c, s, units, qindex(cid), topics_anywhere())
    if not quiet:
        print(f"── {s['name']} ({p.name})")
        for w in warns:
            print("   ⚠️ ", w)
        for e in errs:
            print("   ❌", e)
        print("   ✅ תקין" if not errs else f"   {len(errs)} שגיאות")
    return units, errs


# ───────────────────────── merge / publish ─────────────────────────
def compute_freq(c, idx):
    """freq = אחוז משוער מהמבחן: מכסת המקצוע בסימולציה × חלק הנושא בשאלות המקצוע (בסילבוס)."""
    se = c.get("simExam") or {}
    total_q = se.get("questions") or 0
    cnt = Counter(m["topic"] for m in idx.values() if not m["off"])
    out = {}
    for s in c["subjects"]:
        quota = (se.get("blocks") or {}).get(s["block"], 0)
        n_sub = sum(cnt[t] for t in s["topics"]) or 1
        for t in s["topics"]:
            out[t] = round(100.0 * quota / total_q * cnt[t] / n_sub, 1) if total_q else 0.0
    return out


def cmd_merge(cid, need_all=False):
    c = course_of(cid)
    gp = STAGING / f"{cid}-guide.json"
    published = EXAMS / f"{cid}-guide.json"
    if not gp.exists() and published.exists():
        # מפה שכבר עלתה לאוויר: המיזוג נזרע ממנה, כדי שאפשר יהיה לפרסם מחדש אחרי עדכון פרגמנטים
        gp.write_text(published.read_text(encoding="utf-8"), encoding="utf-8")
        print(f"· {gp.name} נזרע מהמפה שפורסמה ({published.name})")
    if not gp.exists():
        die(f"אין {gp}")
    g = json.loads(gp.read_text(encoding="utf-8"))
    idx = qindex(cid)
    freq = compute_freq(c, idx)
    by_topic = {u["topic"]: u for u in g.get("units", [])}
    done, bad, absent = [], [], []
    for s in c["subjects"]:
        if not frag_path(cid, s["key"]).exists():
            absent.append(s["name"])
            continue
        units, errs = cmd_check(cid, s["key"], quiet=True)
        if errs:
            bad.append(f"{s['name']} ({len(errs)} שגיאות — python3 subject-guide.py check {cid} {s['key']})")
            continue
        for u in units:
            by_topic[u["topic"]] = u
        done.append(s["name"])
    order = [t for s in c["subjects"] for t in s["topics"]]
    g["units"] = []
    for t in order:
        u = dict(by_topic.get(t) or {"topic": t, "what": "TODO", "main": {"src": "TODO"}, "points": []})
        u["freq"] = freq.get(t, 0.0)
        u.setdefault("certainty", "unknown")
        g["units"].append(u)
    # בלוקים = המקצועות, תמיד בסדר ובשמות של הכרטיס
    old = {b.get("title"): b for b in g.get("blocks", [])}
    g["blocks"] = [{"key": s["key"], "title": s["block"], "icon": s.get("icon") or old.get(s["block"], {}).get("icon", ""),
                    "topics": list(s["topics"])} for s in c["subjects"]]
    gp.write_text(json.dumps(g, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{'✅' if done else '·'} {gp.name}: מוזגו {len(done)} מקצועות ({', '.join(done) or '—'})")
    if bad:
        print(f"   ❌ לא מוזגו בגלל שגיאות: {', '.join(bad)}")
    if absent:
        print(f"   ⏳ עוד אין פרגמנט: {', '.join(absent)}")
    return not bad and not absent


def cmd_publish(cid):
    if not cmd_merge(cid):
        die("לא מפרסמים מפה חלקית — כל המקצועות צריכים פרגמנט תקין")
    gp = STAGING / f"{cid}-guide.json"
    g = json.loads(gp.read_text(encoding="utf-8"))
    for f in ("method",):
        if not g.get(f) or "TODO" in g[f]:
            die(f"שדה הקורס {f} עדיין TODO ב-{gp.name}")
    dest = EXAMS / f"{cid}-guide.json"
    dest.write_text(json.dumps(g, ensure_ascii=False, indent=1), encoding="utf-8")
    gp.unlink()
    print(f"🚀 {dest} — עכשיו להריץ node sync.js")


# ───────────────────────── status — לוח השלמות ─────────────────────────
def lomda_todos(cid, key):
    """מספר ה-TODO בכל יחידה בלומדה של המקצוע, לפי כותרת ה-h3 (= שם הנושא)."""
    import re
    f = ROOT / "guides" / f"{cid}-{key}.html"
    if not f.exists():
        return None
    html = f.read_text(encoding="utf-8")
    out = {}
    for m in re.finditer(r'<section class="unit"[^>]*>\s*<h3>(.*?)<', html):
        start = m.start()
        end = html.find('</section>', start)
        out[m.group(1).strip()] = html[start:end].count("TODO")
    return out


def play_topics(cid):
    """הדלת השביעית — נושאים שיש להם כלי שבו *עושים* משהו: סימולציה או תרגיל חישוב
    (קשיחים ב-assets/app.js — נקראים משם ברגקס), או חפיסת מפתח-הגדרה (exams/*-keyer.json)."""
    app = (ROOT / "assets" / "app.js").read_text(encoding="utf-8")
    out = set()
    for name in ("SIMS", "DRILLS"):
        m = re.search(r"const %s = \[(.*?)\n\];" % name, app, re.S)
        if not m:
            continue
        for obj in re.split(r"\n  \{\n", m.group(1)):
            if "course: '%s'" % cid not in obj:
                continue
            out.update(re.findall(r"topic: '([^']+)'", obj))
            for lst in re.findall(r"topics: \[([^\]]*)\]", obj):
                out.update(re.findall(r"'([^']+)'", lst))
    for f in EXAMS.glob(f"{cid}-*-keyer.json"):
        out.update(it.get("topic") for it in json.loads(f.read_text(encoding="utf-8")).get("items", []))
    return out


def cmd_status():
    """שבע הדלתות לכל נושא — ינון: „הקפיות והדדיות”. ✅ קיים · ◐ חלקי · ✗ חסר."""
    anywhere = topics_anywhere()
    rel_count = Counter()
    for c in courses():
        if not c.get("subjects"):
            continue
        for s in c["subjects"]:
            fp = frag_path(c["id"], s["key"])
            units = json.loads(fp.read_text(encoding="utf-8")) if fp.exists() else []
            for u in units:
                for r in u.get("related") or []:
                    rel_count[(c["id"], u["topic"])] += 1
                    rel_count[(r.get("course"), r.get("topic"))] += 1
    tot = Counter()
    for c in courses():
        if not c.get("subjects"):
            continue
        idx = qindex(c["id"])
        n_in = Counter(m["topic"] for m in qindex(c["id"], evidence_only=False).values() if not m["off"])
        weeks = {t for w in (c.get("teaching") or {}).get("weeks", []) for t in w.get("topics", [])}
        quotas = (c.get("simExam") or {}).get("blocks") or {}
        print(f"\n══ {c['name']} ══")
        play = play_topics(c["id"])
        print("   שאלות  מפה   נקודות   לומדה  שבוע  סימ׳  קשור  🎮    נושא")
        for s in c["subjects"]:
            fp = frag_path(c["id"], s["key"])
            units = {u["topic"]: u for u in (json.loads(fp.read_text(encoding="utf-8")) if fp.exists() else [])}
            todos = lomda_todos(c["id"], s["key"]) or {}
            print(f"  {s.get('icon', '')} {s['name']}")
            for t in s["topics"]:
                n = n_in[t]
                u = units.get(t) or {}
                filled = bool(u) and "TODO" not in str(u.get("what", "TODO")) and "TODO" not in str((u.get("main") or {}).get("src", "TODO"))
                mapped = {q for p in u.get("points") or [] for q in p.get("qids") or []}
                in_topic = {q for q, m in idx.items() if m["topic"] == t and not m["off"]}
                cov = (len(mapped & in_topic) / len(in_topic)) if in_topic else 1.0
                ld = todos.get(t)
                cells = [
                    f"{n:>4}{'✅' if n >= 8 else ('◐' if n else '✗')}",
                    " ✅ " if filled else " ✗ ",
                    f"{round(cov * 100):>4}%{'✅' if cov >= 0.999 else ('◐' if cov > 0 else '✗')}",
                    " ✗ " if ld is None else (" ✅ " if ld == 0 else f"{ld:>3}◐"),
                    " ✅ " if t in weeks else " ✗ ",
                    " ✅ " if quotas.get(s["block"]) and n else " ✗ ",
                    f"{rel_count[(c['id'], t)]:>3}",
                    " ✅ " if t in play else " ✗ ",
                ]
                done = sum([n >= 8, filled, cov >= 0.999, ld == 0, t in weeks, bool(quotas.get(s["block"]) and n), t in play])
                tot["doors"] += done
                tot["all"] += 7
                print("  " + "  ".join(cells) + f"   {t}")
    print(f"\n  סה״כ: {tot['doors']}/{tot['all']} דלתות פתוחות ({round(100 * tot['doors'] / max(tot['all'], 1))}%)")
    print("  ✅ קיים · ◐ חלקי · ✗ חסר. „קשור” = מספר הקישורים הרוחביים (בשני הכיוונים). 🎮 = סימולציה / תרגיל חישוב / מפתח הגדרה.")


def main():
    a = sys.argv[1:]
    cmds = {"dump": (cmd_dump, 2), "skeleton": (cmd_skeleton, 2), "check": (cmd_check, 2),
            "merge": (cmd_merge, 1), "publish": (cmd_publish, 1), "status": (cmd_status, 0)}
    if not a or a[0] not in cmds or len(a) - 1 != cmds[a[0]][1]:
        print(__doc__)
        sys.exit(1)
    fn, _ = cmds[a[0]]
    r = fn(*a[1:])
    if a[0] == "check" and r[1]:
        sys.exit(1)


if __name__ == "__main__":
    main()
