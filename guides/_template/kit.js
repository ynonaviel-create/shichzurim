/* doc-kit — יכולות משותפות לכל "סיכום מלא". מוטמע ע"י inject.py, לא נטען כקובץ.
   קונפיגורציה דרך window.DOCKIT שמוזרק לפני הקובץ הזה:
     id        מזהה המסמך למפתחות localStorage (למשל 'physics-doc')
     progress  false = בלי פס התקדמות (לאלקטרו, שיש לו משלו)
     gate      selector של מלכודות לעטיפת "האמת:" בשער נסה-קודם. null = בלי.
     blocks    selector של יחידות הטקסט שמותר לסמן בתוכן. */
(function () {
'use strict';
var CFG = window.DOCKIT || {};
var DOC = CFG.id || location.pathname.split('/').pop().replace(/\.html$/, '');
var KEY = function (k) { return 'shichzurim.' + DOC + '.' + k; };
var read = function (k, fb) {
  try { var v = localStorage.getItem(KEY(k)); return v == null ? fb : JSON.parse(v); }
  catch (e) { return fb; }
};
var write = function (k, v) { try { localStorage.setItem(KEY(k), JSON.stringify(v)); } catch (e) {} };

/* ---------- פס התקדמות ----------
   כמו באלקטרו: שחרור דגל הוויסות לפני הציור + try, כדי שכשל אחד לא ישתיק. */
if (CFG.progress !== false) {
  var bar = document.createElement('div');
  bar.id = 'dk-prog';
  document.body.appendChild(bar);
  var busy = false;
  var paintProg = function () {
    var h = document.documentElement;
    var max = h.scrollHeight - innerHeight;
    bar.style.width = (max > 0 ? Math.min(100, 100 * h.scrollTop / max) : 0) + '%';
  };
  addEventListener('scroll', function () {
    if (busy) return;
    busy = true;
    requestAnimationFrame(function () { busy = false; try { paintProg(); } catch (e) {} });
  }, { passive: true });
  paintProg();
}

/* ---------- שער "נסה קודם" במלכודות ----------
   המלכודת נשארת גלויה; "האמת:" והלאה מוסתרים עד לחיצה. זה מה שהסקר ביקש —
   לעצור ולנסות לפני חשיפת הפתרון. מי שזה מציק לו: "גלה הכל" קבוע ונשמר. */
if (CFG.gate) {
  var opened = read('reveal', false);
  var gated = [];
  [].forEach.call(document.querySelectorAll(CFG.gate), function (tr) {
    var pivot = null;
    [].some.call(tr.querySelectorAll('b'), function (b) {
      if (/^האמת/.test(b.textContent)) { pivot = b; return true; }
      return false;
    });
    if (!pivot || pivot.parentNode !== tr) return;
    var hid = document.createElement('span');
    hid.className = 'dk-gated';
    var n = pivot;
    while (n) { var nx = n.nextSibling; hid.appendChild(n); n = nx; }
    /* התווית ב-CSS (::before) ולא ב-textContent, בכוונה: מנוע ההקראה של
       המסמך מקריא את ה-textContent של המלכודת כולה, וכפתור עם טקסט היה
       נכנס באמצע המשפט. aria-label שומר על קורא המסך. */
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dk-gate';
    btn.setAttribute('aria-label', 'עצרו רגע — מה האמת? לחצו לבדיקה');
    btn.title = 'נסו לענות בראש לפני שמציצים';
    btn.addEventListener('click', function () { tr.classList.add('dk-open'); });
    tr.appendChild(btn);
    tr.appendChild(hid);
    if (opened) tr.classList.add('dk-open');
    gated.push(tr);
  });
  if (gated.length) {
    var rv = document.createElement('button');
    rv.type = 'button';
    rv.id = 'dk-reveal';
    var paintRv = function () {
      rv.textContent = opened ? '🙈 הסתירו את התשובות' : '👁️ גלו את כל התשובות';
      rv.title = opened
        ? 'החזרת שערי "נסה קודם" על המלכודות'
        : 'פתיחת כל "האמת" במלכודות, בלי לעצור על כל אחת';
    };
    rv.addEventListener('click', function () {
      opened = !opened;
      write('reveal', opened);
      gated.forEach(function (tr) { tr.classList.toggle('dk-open', opened); });
      paintRv();
    });
    paintRv();
    document.body.appendChild(rv);
  }
}

/* ---------- שלושת מצבי הקריאה ----------
   📖 קריאה מלאה (read) · ⚡ מרוכז (focus) · 🎮 אינטראקטיבי (play).
   הסיווג הוא runtime: רצפי ילדים שאינם "keep" נעטפים ב-div.dk-deep,
   וה-CSS מסתיר/מקפל לפי body[data-dk-mode]. אפס עריכת תוכן — ולכן כל
   מסמך מהתבנית מקבל את המצבים בחינם. העטיפה מזיזה אלמנטים אבל לא נוגעת
   ב-textContent שלהם, ולכן עוגני הסימון שורדים. */
var MODES = null;
if (CFG.modes) {
  MODES = (function () {
    var unitSel = CFG.modes.unit || 'section.unit';
    var keepSel = CFG.modes.keep || 'h3, .lead, .traps, .drill, .dk-qa, .ex, .dk-more';
    [].forEach.call(document.querySelectorAll(unitSel), function (unit) {
      var kids = [].slice.call(unit.children), run = [], made = false;
      var flush = function (before) {
        if (!run.length) return;
        var d = document.createElement('div');
        d.className = 'dk-deep';
        unit.insertBefore(d, before);
        run.forEach(function (n) { d.appendChild(n); });
        run = [];
        made = true;
      };
      kids.forEach(function (k) {
        if (k.matches(keepSel)) flush(k);
        else run.push(k);
      });
      flush(null);
      if (made) {
        /* התווית ב-CSS, מאותה סיבה כמו כפתור השער: לא להיכנס ל-textContent. */
        var more = document.createElement('button');
        more.type = 'button';
        more.className = 'dk-more';
        more.setAttribute('aria-label', 'הצגת ההעמקה המלאה של הנושא');
        more.title = 'פתיחת ההסבר לעומק, האיורים והסרטונים של הנושא הזה';
        more.addEventListener('click', function () { unit.classList.toggle('dk-open-deep'); });
        var drill = unit.querySelector('.drill');
        unit.insertBefore(more, drill || null);
      }
    });

    var LBL = { read: ['📖', 'קריאה מלאה'], focus: ['⚡', 'מרוכז'], play: ['🎮', 'אינטראקטיבי'] };
    var bar = document.createElement('div');
    bar.id = 'dk-modes';
    var btns = {};
    ['read', 'focus', 'play'].forEach(function (m) {
      var b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = LBL[m][0] + '<span> ' + LBL[m][1] + '</span>';
      b.title = m === 'read' ? 'כל התוכן, כמעבר ראשון על החומר'
        : m === 'focus' ? 'רק התמצית, המלכודות ומה שבאמת נשאל — לחזרה מהירה'
        : 'ההעמקה מקופלת, התרגילים והשערים פתוחים — ללמידה פעילה';
      b.addEventListener('click', function () { apply(m, true); });
      btns[m] = b;
      bar.appendChild(b);
    });
    document.body.appendChild(bar);

    function apply(m, save) {
      if (!LBL[m]) m = 'read';
      document.body.dataset.dkMode = m;
      if (save) write('mode', m);
      Object.keys(btns).forEach(function (k) {
        btns[k].classList.toggle('on', k === m);
        btns[k].setAttribute('aria-pressed', String(k === m));
      });
      /* הקראה שרצה על תוכן שהרגע הוסתר — עוצרים נקי. */
      try { if (window.speechSynthesis) speechSynthesis.cancel(); } catch (e) {}
      [].forEach.call(document.querySelectorAll('details.dk-qa'), function (d) {
        if (m === 'focus') d.open = true;
      });
      /* ה-layout זז: פס ההתקדמות והריל מציירים מחדש, והעוגן נפתר שוב —
         סקריפט העוגן של המסמך רץ לפני הבלוק הזה, ולכן זה לא קורה לבד. */
      dispatchEvent(new Event('scroll'));
      if (/^#top-/.test(location.hash)) {
        try { dispatchEvent(new HashChangeEvent('hashchange')); } catch (e) {}
      }
    }
    var q = null;
    try { q = new URLSearchParams(location.search).get('m'); } catch (e) {}
    apply(q || read('mode', 'read'), !!q);
    return { apply: apply };
  })();
}

/* ---------- 📌 מה באמת נשאל — פאנל פר-נושא ----------
   הפרוזה של הלומדה נכתבה מראש; מה נשאל בפועל נמשך מהמפה בזמן ריצה, באותו
   היגיון של המנוע: מספר שמוטמע בקובץ מתיישן והופך שקר, מספר שנגזר מ-qids
   לא יכול. בלי טעינת קבצי מבחנים — קישורי שאלה בודדת נשארים במפה. */
if (CFG.qa) {
  (function () {
    var unitSel = (CFG.modes && CFG.modes.unit) || 'section.unit';
    var norm = function (s) {
      return (s || '').replace(/[֑-ׇ]/g, '').replace(/['"״׳]/g, '')
        .replace(/\s+/g, ' ').trim();
    };
    var titleOf = function (sec) {
      var h = sec.querySelector('h3, h2');
      if (!h) return '';
      var c = h.cloneNode(true);
      [].forEach.call(c.querySelectorAll('button, .speak-wrap, .ch-f, .pct'), function (x) { x.remove(); });
      return norm(c.textContent);
    };
    fetch('../exams/' + CFG.qa + '-guide.json').then(function (r) {
      return r.ok ? r.json() : null;
    }).then(function (g) {
      if (!g || !g.units) return;
      var byTopic = {};
      g.units.forEach(function (u) { byTopic[norm(u.topic)] = u; });
      [].forEach.call(document.querySelectorAll(unitSel), function (sec) {
        var u = byTopic[titleOf(sec)];
        if (!u || !(u.points || []).length) return;
        var nQ = {};
        (u.points || []).forEach(function (p) { (p.qids || []).forEach(function (q) { nQ[q] = 1; }); });
        var det = document.createElement('details');
        det.className = 'dk-qa';
        var sum = document.createElement('summary');
        sum.textContent = '📌 מה באמת נשאל — ' + u.points.length + ' נקודות מתוך ' +
          Object.keys(nQ).length + ' שאלות אמת';
        sum.title = 'הנקודות שנבחנו בפועל בנושא הזה, ממוינות לפי כמה פעמים נשאלו';
        det.appendChild(sum);
        if (u.summary) {
          var s = document.createElement('div');
          s.className = 'dk-qa-sum';
          s.innerHTML = u.summary.split('\n\n').map(function (p) { return '<p>' + p + '</p>'; }).join('');
          det.appendChild(s);
        }
        u.points.slice().sort(function (a, b) {
          return (b.qids || []).length - (a.qids || []).length;
        }).forEach(function (p) {
          var row = document.createElement('div');
          row.className = 'dk-qa-p';
          var n = (p.qids || []).length;
          row.innerHTML = '<span class="dk-qa-n">' +
            (n === 1 ? 'נשאל פעם אחת' : 'נשאל ' + n + ' פעמים') + '</span> ' + p.point +
            (p.trap ? '<span class="dk-qa-trap"><b>המלכודת:</b> ' + p.trap + '</span>' : '');
          det.appendChild(row);
        });
        var foot = document.createElement('div');
        foot.className = 'dk-qa-foot';
        var enc = encodeURIComponent(u.topic);
        foot.innerHTML =
          '<a href="../index.html#/guide/' + CFG.qa + '/' + enc + '" target="_blank" rel="noopener" ' +
          'title="הנושא במפת החומרים — כולל קישור לכל שאלה ושאלה">🗺️ כל השאלות במפה</a>' +
          '<a href="../index.html#/practice/' + CFG.qa + '/' + enc + '" target="_blank" rel="noopener" ' +
          'title="תרגול שאלות אמת בנושא הזה בלבד">✍️ לתרגל את הנושא</a>';
        det.appendChild(foot);
        var traps = sec.querySelector('.traps');
        if (traps) traps.after(det);
        else {
          var drill = sec.querySelector('.drill');
          if (drill) sec.insertBefore(det, drill);
          else sec.appendChild(det);
        }
        if (document.body.dataset.dkMode === 'focus') det.open = true;
      });
    }).catch(function () {});
  })();
}

/* ---------- 🎮 תרגילים דקלרטיביים ----------
   סוכן-תוכן (או build.py) שותל בלוקים, והערכה מפיחה בהם חיים. שני סוגים:

   ex-match — התאמת מונח↔הגדרה בלחיצה-לחיצה (לא drag — מובייל):
     <div class="ex ex-match" data-shinun="נושא א|נושא ב"></div>   ← מהשינון
     <div class="ex ex-match"><span data-t>מונח</span><span data-d>הגדרה</span>…</div>
   הרשימה ב-data-shinun מפורשת בכוונה: שמות הנושאים בשינון לא חופפים לשמות
   נושאי המפה (בפיזיקה כולם "שאלות הכיתה"), אז הצלבה אוטומטית הייתה שקטה וריקה.

   ex-map — מפת חשיבה שנפתחת בלחיצה:
     <div class="ex ex-map"><b>כותרת</b><ul><li>ענף<ul>…</ul></li></ul></div> */
(function () {
  var shuffle = function (a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1)), t = a[i];
      a[i] = a[j]; a[j] = t;
    }
    return a;
  };
  var clip = function (s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; };

  function buildMatch(box, pairs, pool) {
    box.innerHTML = '';
    var head = document.createElement('div');
    head.className = 'exm-head';
    head.textContent = '🖇️ מתחו קו: לחצו על מונח, ואז על ההגדרה שלו';
    box.appendChild(head);
    var grid = document.createElement('div');
    grid.className = 'exm-grid';
    var terms = document.createElement('div'), defs = document.createElement('div');
    terms.className = 'exm-col'; defs.className = 'exm-col';
    var sel = null, left = pairs.length;
    shuffle(pairs).forEach(function (p, i) {
      var t = document.createElement('button');
      t.type = 'button'; t.className = 'exm-t'; t.textContent = p.t; t.dataset.k = i;
      t.addEventListener('click', function () {
        if (t.classList.contains('done')) return;
        [].forEach.call(terms.children, function (x) { x.classList.remove('sel'); });
        t.classList.add('sel');
        sel = t;
      });
      terms.appendChild(t);
    });
    shuffle(pairs.map(function (p, i) { return { d: p.d, k: i }; })).forEach(function (p) {
      var d = document.createElement('button');
      d.type = 'button'; d.className = 'exm-d'; d.textContent = clip(p.d, 150); d.title = p.d;
      d.addEventListener('click', function () {
        if (!sel || d.classList.contains('done')) return;
        if (String(p.k) === sel.dataset.k) {
          sel.classList.add('done'); sel.classList.remove('sel');
          d.classList.add('done');
          sel = null;
          if (!--left) {
            var fin = document.createElement('div');
            fin.className = 'exm-fin';
            fin.textContent = '🎉 הכול הותאם!';
            if (pool && pool.length) {
              var again = document.createElement('button');
              again.type = 'button'; again.className = 'exm-again';
              again.textContent = '🔄 סיבוב נוסף';
              again.title = 'סט חדש של מונחים מאותם נושאים';
              again.addEventListener('click', function () {
                var next = pool.slice(0, 5);
                buildMatch(box, next, pool.slice(5).concat(pairs));
              });
              fin.appendChild(again);
            }
            box.appendChild(fin);
          }
        } else {
          d.classList.add('bad');
          setTimeout(function () { d.classList.remove('bad'); }, 450);
          sel.classList.remove('sel');
          sel = null;
        }
      });
      defs.appendChild(d);
    });
    grid.appendChild(terms); grid.appendChild(defs);
    box.appendChild(grid);
  }

  var boxes = [].slice.call(document.querySelectorAll('.ex-match'));
  var inlinePairs = function (box) {
    var ts = box.querySelectorAll('[data-t]'), ds = box.querySelectorAll('[data-d]');
    var out = [];
    for (var i = 0; i < Math.min(ts.length, ds.length); i++)
      out.push({ t: ts[i].textContent, d: ds[i].textContent });
    return out;
  };
  var needShinun = boxes.filter(function (b) { return b.dataset.shinun; });
  boxes.forEach(function (b) {
    if (b.dataset.shinun) return;
    var pairs = inlinePairs(b);
    if (pairs.length >= 3) buildMatch(b, pairs.slice(0, 5), pairs.slice(5));
  });
  if (needShinun.length && CFG.shinun) {
    fetch('../exams/' + CFG.shinun + '-shinun.json').then(function (r) {
      return r.ok ? r.json() : null;
    }).then(function (sh) {
      if (!sh) return;
      var items = [];
      (sh.groups || []).forEach(function (g) { (g.items || []).forEach(function (it) { items.push(it); }); });
      needShinun.forEach(function (b) {
        var want = b.dataset.shinun.split('|').map(function (s) { return s.trim(); });
        var pool = items.filter(function (it) { return want.indexOf(it.topic) !== -1; })
          .sort(function (a, x) { return a.back.length - x.back.length; })
          .map(function (it) { return { t: it.front, d: it.back }; });
        if (pool.length >= 3) buildMatch(b, pool.slice(0, 5), pool.slice(5));
        else if (inlinePairs(b).length >= 3) buildMatch(b, inlinePairs(b).slice(0, 5), []);
      });
    }).catch(function () {});
  }

  /* ex-map: כל li שיש לו ul פנימי הופך לצומת מתקפל. הרמה הראשונה פתוחה. */
  [].forEach.call(document.querySelectorAll('.ex-map'), function (map) {
    [].forEach.call(map.querySelectorAll('li'), function (li) {
      var sub = li.querySelector(':scope > ul');
      if (!sub) return;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dk-node';
      while (li.firstChild && li.firstChild !== sub) btn.appendChild(li.firstChild);
      li.insertBefore(btn, sub);
      var open = li.closest('ul').parentNode === map;   /* רמה ראשונה פתוחה */
      li.classList.toggle('open', open);
      btn.setAttribute('aria-expanded', String(open));
      btn.addEventListener('click', function () {
        var on = li.classList.toggle('open');
        btn.setAttribute('aria-expanded', String(on));
      });
    });
  });
})();

/* ---------- סימון על הטקסט ----------
   בוחרים טקסט ← מופיע כפתור 🖍️ ← לחיצה מסמנת ונשמרת. לחיצה על סימון מסירה
   אותו. העיגון הוא 40 התווים הראשונים של הבלוק + מונה מופע — לא אינדקס
   גלובלי, כי מסמך שמזריק תוכן ב-fetch (אלקטרו) היה מזיז את כל האינדקסים
   לפי מזל הרשת. היסטי התווים בתוך textContent יציבים כי עטיפת <mark> לא
   משנה textContent. אם הטקסט עצמו השתנה מאז, בדיקת 12 התווים מפילה את
   הסימון בשקט במקום לסמן טקסט שגוי. */
(function () {
  var SEL = CFG.blocks || 'p, li, figcaption, td, .trap';
  function blocksNow() {
    return [].filter.call(document.querySelectorAll(SEL), function (b) {
      /* החיצוני בלבד: p בתוך li נספר פעם אחת, דרך ה-li. */
      return !(b.parentNode && b.parentNode.closest && b.parentNode.closest(SEL));
    });
  }
  var keyOf = function (b) { return b.textContent.slice(0, 40); };
  var saved = read('hl', []);

  function textNodesOf(block) {
    var w = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, null);
    var out = [];
    while (w.nextNode()) out.push(w.currentNode);
    return out;
  }

  function wrapRange(block, s, e, id) {
    var pos = 0;
    textNodesOf(block).forEach(function (tn) {
      var len = tn.nodeValue.length;
      var a = Math.max(s - pos, 0), b = Math.min(e - pos, len);
      pos += len;
      if (a >= b) return;
      if (tn.parentNode.closest('mark.dk-hl')) return;
      var r = document.createRange();
      r.setStart(tn, a);
      r.setEnd(tn, b);
      var m = document.createElement('mark');
      m.className = 'dk-hl';
      m.dataset.hid = id;
      m.title = 'לחיצה מסירה את הסימון';
      try { r.surroundContents(m); } catch (err) {}
    });
  }

  function offsetIn(block, node, off) {
    if (node.nodeType !== 3) return null;
    var pos = 0, hit = null;
    textNodesOf(block).some(function (tn) {
      if (tn === node) { hit = pos + off; return true; }
      pos += tn.nodeValue.length;
      return false;
    });
    return hit;
  }

  /* שחזור הסימונים השמורים. מה שלא נמצא (תוכן שמוזרק ב-fetch ועוד לא הגיע)
     מקבל ניסיון שני אחרי טעינה מלאה — ואם גם אז לא, פשוט לא מוצג. */
  function findBlock(h, list) {
    var n = 0;
    for (var i = 0; i < list.length; i++) {
      if (keyOf(list[i]) !== h.k) continue;
      if (n === h.n) return list[i];
      n++;
    }
    return null;
  }
  function restore(entries) {
    var list = blocksNow(), missed = [];
    entries.forEach(function (h) {
      var b = findBlock(h, list);
      if (!b) { missed.push(h); return; }
      if (b.textContent.substr(h.s, Math.min(12, h.e - h.s)) !== h.t) return;
      wrapRange(b, h.s, h.e, h.id);
    });
    return missed;
  }
  var missed = restore(saved);
  if (missed.length) setTimeout(function () { restore(missed); }, 2500);

  /* הסרה בלחיצה */
  document.addEventListener('click', function (e) {
    var m = e.target.closest && e.target.closest('mark.dk-hl');
    if (!m) return;
    var id = m.dataset.hid;
    saved = saved.filter(function (h) { return String(h.id) !== String(id); });
    write('hl', saved);
    [].forEach.call(document.querySelectorAll('mark.dk-hl[data-hid="' + id + '"]'), function (mm) {
      var p = mm.parentNode;
      while (mm.firstChild) p.insertBefore(mm.firstChild, mm);
      p.removeChild(mm);
      p.normalize();
    });
  });

  /* הכפתור הצף */
  var btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'dk-hlbtn';
  btn.textContent = '🖍️ סמן';
  btn.title = 'סימון הטקסט שבחרתם — נשמר בדפדפן הזה';
  document.body.appendChild(btn);
  var hideBtn = function () { btn.classList.remove('on'); };

  function place() {
    var sel = getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return hideBtn();
    var r = sel.getRangeAt(0);
    if (!r.toString().trim()) return hideBtn();
    /* רק בתוך בלוק תוכן — לא בכותרות ניווט, לא בכפתורים. */
    var anchorEl = r.commonAncestorContainer;
    if (anchorEl.nodeType === 3) anchorEl = anchorEl.parentNode;
    if (!anchorEl.closest || (!anchorEl.closest(SEL) && !anchorEl.querySelector(SEL))) return hideBtn();
    var rect = r.getBoundingClientRect();
    if (!rect.width && !rect.height) return hideBtn();
    btn.style.top = (scrollY + rect.bottom + 8) + 'px';
    btn.style.left = (scrollX + rect.left + rect.width / 2 - btn.offsetWidth / 2) + 'px';
    btn.classList.add('on');
  }

  var debounce = null;
  document.addEventListener('selectionchange', function () {
    clearTimeout(debounce);
    debounce = setTimeout(place, 250);
  });

  btn.addEventListener('mousedown', function (e) { e.preventDefault(); });
  btn.addEventListener('click', function () {
    var sel = getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return hideBtn();
    var r = sel.getRangeAt(0);
    var id = Date.now();
    var added = [];
    var list = blocksNow();
    var seen = {};
    list.forEach(function (b) {
      var k = keyOf(b);
      var n = seen[k] || 0;
      seen[k] = n + 1;
      if (!r.intersectsNode(b)) return;
      var s = b.contains(r.startContainer) ? offsetIn(b, r.startContainer, r.startOffset) : 0;
      var e = b.contains(r.endContainer) ? offsetIn(b, r.endContainer, r.endOffset) : b.textContent.length;
      if (s == null || e == null || s >= e) return;
      added.push({ id: id, k: k, n: n, s: s, e: e, t: b.textContent.substr(s, Math.min(12, e - s)), el: b });
    });
    if (added.length) {
      added.forEach(function (h) { wrapRange(h.el, h.s, h.e, h.id); delete h.el; });
      saved = saved.concat(added);
      write('hl', saved);
    }
    sel.removeAllRanges();
    hideBtn();
  });
})();
})();
