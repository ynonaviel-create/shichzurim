/* ================= Cloud — גשר הענן =================

   כל התקשורת עם Supabase עוברת דרך הקובץ הזה, ורק דרכו. app.js פונה אליו
   אך ורק בצורה window.Cloud?.…, ולכן אם הקובץ הזה נכשל, חסום, או שהקונפיג
   ריק — האתר מתנהג בדיוק כמו קודם: localStorage בלבד, בלי שגיאות.

   העיקרון: localStorage נשאר מקור הקריאה של הממשק. הענן הוא גיבוי וסנכרון —
   כל כתיבה מקומית נרשמת לתור (outbox) ונשלחת ברקע; בהתחברות מושכים את מה
   שבענן וממזגים. הממשק לעולם לא מחכה לרשת. */

(function () {
  'use strict';

  /* ---------- קונפיגורציה ----------
     ריק = הענן כבוי והאתר מקומי לגמרי. ממלאים אחרי יצירת הפרויקט ב-Supabase
     (ראו SETUP-SUPABASE.md). המפתח הוא ה-anon הציבורי — הוא מיועד להיחשף
     בדפדפן; ההגנה האמיתית היא ה-RLS על הטבלה. */
  const CONFIG = {
    url: 'https://ucpgpbeodqfuqfjbolcx.supabase.co',
    anonKey: 'sb_publishable_LXyYIHmPautTU8qKvH5EUA_qVz4nSaK',   // מפתח ציבורי (publishable) — מיועד לדפדפן; ההגנה היא ה-RLS
  };

  /* מי רואה את לוח הבקרה. רק רמז ללקוח (להצגת הקישור); האכיפה האמיתית היא
     is_admin() בשרת — משתמש רגיל שיקרא ל-RPC פשוט יקבל שגיאה. */
  const ADMIN_EMAILS = ['avielyin@post.bgu.ac.il', 'ynonaviel@gmail.com'];

  /* מיפוי המרחבים בענן אל מפתחות ה-localStorage שבאתר — אותם מפתחות שהעטיפות
     ב-app.js קוראות. המיזוג כותב ישירות למפתחות האלה, והאתר קורא אותם כרגיל. */
  const KEYMAP = {
    progress:  'shichzurim.v1',
    seen:      'shichzurim.seen',
    cardsRead: 'shichzurim.cardsRead',
    caseProg:  'shichzurim.caseProg',
  };
  const OUTBOX_KEY = 'shichzurim.outbox';

  const disabled =
    !CONFIG.url || !CONFIG.anonKey ||
    location.protocol === 'file:' ||
    typeof window.supabase === 'undefined';

  /* ממשק ריק כשהענן כבוי — כל הקריאות מ-app.js הופכות ללא-כלום. */
  if (disabled) {
    window.Cloud = {
      enabled: false, user: null, isAdmin: false,
      init: async () => {}, login: () => {}, logout: async () => {},
      queue: () => {}, queueDelete: () => {}, queueClear: () => {}, queueClearPrefix: () => {},
      track: () => {}, admin: {},
      status: () => ({ pending: 0, lastSync: 0, syncing: false }),
    };
    return;
  }

  const sb = window.supabase.createClient(CONFIG.url, CONFIG.anonKey, {
    /* PKCE ולא implicit: implicit מחזיר את הטוקנים ב-#, והאתר מנווט לפי ה-#.
       PKCE חוזר עם ?code= — לא נוגע בראוטר. */
    auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true },
  });

  const state = {
    session: null,
    lastSync: 0,
    syncing: false,
  };

  const readLS  = (ns) => { try { return JSON.parse(localStorage.getItem(KEYMAP[ns])) || {}; } catch { return {}; } };
  const writeLS = (ns, d) => localStorage.setItem(KEYMAP[ns], JSON.stringify(d));
  const emit = (name, detail) => document.dispatchEvent(new CustomEvent(name, { detail }));

  /* ---------- תור הכתיבות (outbox) ----------
     כל שינוי מקומי נרשם כפעולה בתור, והתור נשלח ברקע עם debounce. התור עצמו
     נשמר ב-localStorage כדי ששינוי של הרגע האחרון ישרוד סגירת טאב — הוא
     יישלח בפתיחה הבאה. פעולה חדשה על אותו מפתח מחליפה את הקודמת (אין טעם
     לשלוח שתי גרסאות של אותה שורה). */
  let outbox = (() => { try { return JSON.parse(localStorage.getItem(OUTBOX_KEY)) || []; } catch { return []; } })();
  const saveOutbox = () => localStorage.setItem(OUTBOX_KEY, JSON.stringify(outbox));

  let flushTimer = null;
  function push(op) {
    /* בלי session אין למי לשלוח — לא צוברים: המיזוג שבהתחברות ממילא מעלה
       את כל המצב המקומי, אז תור שנצבר לפני התחברות רק היה מסבך. */
    if (!state.session) return;
    if (op.op === 'set' || op.op === 'del') {
      outbox = outbox.filter((o) => !(o.ns === op.ns && o.k === op.k && (o.op === 'set' || o.op === 'del')));
    } else if (op.op === 'clearns') {
      outbox = outbox.filter((o) => o.ns !== op.ns);
    } else if (op.op === 'clearpre') {
      outbox = outbox.filter((o) => !(o.ns === op.ns && (o.op === 'set' || o.op === 'del') && String(o.k).startsWith(op.k)));
    }
    outbox.push(op);
    saveOutbox();
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, 1500);
  }

  let flushing = false;
  async function flush() {
    if (flushing || !state.session || !outbox.length) return;
    if (!navigator.onLine) return;                    // אירוע online יקרא לנו שוב
    flushing = true;
    try {
      while (outbox.length) {
        /* רצף כתיבות (set) נשלח כ-upsert אחד; מחיקות — אחת-אחת. הסדר נשמר. */
        let n = 1;
        if (outbox[0].op === 'set') { while (n < outbox.length && outbox[n].op === 'set') n++; }
        const batch = outbox.slice(0, n);
        await apply(batch);
        outbox.splice(0, n);
        saveOutbox();
      }
      state.lastSync = Date.now();
      emit('cloud:sync');
    } catch {
      /* רשת/שרת נפלו — התור נשאר שמור, ננסה שוב עוד עשר שניות. */
      clearTimeout(flushTimer);
      flushTimer = setTimeout(flush, 10000);
    } finally {
      flushing = false;
    }
  }

  async function apply(batch) {
    const uid = state.session.user.id;
    const first = batch[0];
    if (first.op === 'set') {
      const rows = batch.map((o) => ({ user_id: uid, ns: o.ns, k: String(o.k), v: o.v }));
      const { error } = await sb.from('user_kv').upsert(rows);
      if (error) throw error;
      return;
    }
    let q = sb.from('user_kv').delete().eq('user_id', uid).eq('ns', first.ns);
    if (first.op === 'del') q = q.eq('k', String(first.k));
    if (first.op === 'clearpre') q = q.like('k', String(first.k).replace(/[%_]/g, '\\$&') + '%');
    const { error } = await q;
    if (error) throw error;
  }

  /* סגירת טאב באמצע ה-debounce: ניסיון-בזק לשלוח את הכתיבות שנותרו עם
     keepalive (שורד ניווט). לא מוחקים מהתור — upsert אידמפוטנטי, ואם
     המשלוח לא הספיק, הפתיחה הבאה תשלח שוב. מחיקות מחכות לפתיחה הבאה. */
  window.addEventListener('pagehide', () => {
    if (!state.session) return;
    const sets = outbox.filter((o) => o.op === 'set');
    if (!sets.length) return;
    const uid = state.session.user.id;
    try {
      fetch(CONFIG.url + '/rest/v1/user_kv?on_conflict=user_id,ns,k', {
        method: 'POST', keepalive: true,
        headers: {
          apikey: CONFIG.anonKey,
          Authorization: 'Bearer ' + state.session.access_token,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates',
        },
        body: JSON.stringify(sets.map((o) => ({ user_id: uid, ns: o.ns, k: String(o.k), v: o.v }))),
      });
    } catch { /* best effort */ }
  });
  window.addEventListener('online', () => flush());

  /* ---------- משיכה ומיזוג ----------
     רץ בהתחברות ובכל פתיחת אתר של משתמש מחובר. מביא את כל השורות (המצב של
     משתמש בודד קטן — מאות בודדות של שורות), ממזג מול המקומי מפתח-מפתח,
     ומה שקיים רק מקומית עולה לענן. כך גם ההגירה של התקדמות ותיקה קורית
     מעצמה בהתחברות הראשונה: הענן ריק, הכל מקומי בלבד — הכל עולה. */
  function winner(ns, l, r) {
    if (ns === 'progress') return ((l && l.at) || 0) >= ((r && r.at) || 0) ? l : r;
    if (ns === 'seen') return l === 1 || r === 1 ? 1 : 0;      // "ידעתי" מנצח — נצבר, לא נמחק
    if (ns === 'cardsRead') return 1;                           // הערכים תמיד 1; איחוד
    if (ns === 'caseProg') {                                    // מי שהתקדם יותר במקרה מנצח
      const cnt = (a) => (Array.isArray(a) ? a.filter((x) => x != null).length : 0);
      return cnt(l) >= cnt(r) ? l : r;
    }
    return l;
  }

  async function syncNow() {
    if (state.syncing || !state.session) return;
    state.syncing = true;
    emit('cloud:sync');
    try {
      const { data, error } = await sb.from('user_kv').select('ns,k,v');
      if (error) throw error;

      const remote = { progress: {}, seen: {}, cardsRead: {}, caseProg: {} };
      (data || []).forEach((r) => { if (remote[r.ns]) remote[r.ns][r.k] = r.v; });

      const ups = [];
      let changed = false;   // האם המיזוג שינה משהו *מקומית* — רק אז שווה לרנדר מחדש
      Object.keys(KEYMAP).forEach((ns) => {
        const local = readLS(ns);
        const merged = {};
        const keys = new Set([...Object.keys(local), ...Object.keys(remote[ns])]);
        keys.forEach((k) => {
          const l = local[k], r = remote[ns][k];
          let win;
          if (l === undefined) win = r;
          else if (r === undefined) { win = l; ups.push({ op: 'set', ns, k, v: l }); }
          else {
            win = winner(ns, l, r);
            /* המקומי ניצח והוא שונה ממה שבענן — מעדכנים את הענן. */
            if (JSON.stringify(win) !== JSON.stringify(r)) ups.push({ op: 'set', ns, k, v: win });
          }
          merged[k] = win;
        });
        if (JSON.stringify(merged) !== JSON.stringify(local)) { writeLS(ns, merged); changed = true; }
      });

      ups.forEach(push);
      state.lastSync = Date.now();
      emit('cloud:merged', { changed });   // changed=true → app.js מרנדר מחדש את המסך הממוזג
    } catch { /* אין רשת/שרת — נשארים עם המקומי; הפתיחה הבאה תנסה שוב */ }
    finally {
      state.syncing = false;
      emit('cloud:sync');
      flush();
    }
  }

  /* ---------- מעקב (אגרגטיבי) ----------
     אירוע קליל על פעולה משמעותית. fire-and-forget: לא מחכים, לא זורקים.
     דה-דופ קצר: אותו (type,target) לא נרשם פעמיים באותה חצי-שעה בטאב הזה,
     כדי שרענון או חזרה-קדימה לא ינפחו את הספירה. הקריאה שקטה כשמנותקים. */
  const trackSeen = new Map();
  function track(type, target) {
    if (!state.session) return;
    const key = type + '|' + (target || '');
    const now = Date.now();
    if (now - (trackSeen.get(key) || 0) < 30 * 60 * 1000) return;
    trackSeen.set(key, now);
    try {
      sb.from('events').insert({ user_id: state.session.user.id, type, target: target || null })
        .then(() => {}, () => {});   // בולעים שגיאות — מעקב לעולם לא שובר את האתר
    } catch { /* ignore */ }
  }

  /* ---------- session ---------- */
  function setSession(session) {
    state.session = session || null;
    Cloud.user = session
      ? {
          id: session.user.id,
          email: session.user.email || '',
          name: (session.user.user_metadata && session.user.user_metadata.full_name) || session.user.email || '',
        }
      : null;
    Cloud.isAdmin = !!(Cloud.user && ADMIN_EMAILS.includes(Cloud.user.email));
  }

  const Cloud = {
    enabled: true,
    user: null,
    isAdmin: false,

    /* נקרא פעם אחת מ-init של app.js, לפני הרינדור הראשון. חסום בזמן קצוב:
       Supabase איטי לא יעכב את הציור — ההתחברות תושלם ברקע ותשודר כאירוע. */
    async init() {
      try {
        const timeout = new Promise((r) => setTimeout(r, 1500));
        const got = sb.auth.getSession().then(({ data }) => setSession(data && data.session));
        await Promise.race([timeout, got]);
      } catch { /* נשארים מנותקים */ }

      /* ניקוי שאריות ה-OAuth מהכתובת (?code=&state=) — supabase-js כבר קרא
         אותן; אם נשאיר, רענון ידני ינסה להחליף code משומש ויציג שגיאה. */
      try {
        if (/[?&](code|state|error_description)=/.test(location.search)) {
          const u = new URL(location.href);
          ['code', 'state', 'error', 'error_description'].forEach((p) => u.searchParams.delete(p));
          history.replaceState(null, '', u.pathname + (u.search || '') + u.hash);
        }
      } catch { /* לא קריטי */ }

      if (state.session) syncNow();   // ברקע, בכוונה בלי await
    },

    login() {
      /* חוזרים לכתובת הבסיס בלי ה-#: supabase מוסיף ?code= לכתובת החזרה,
         ושרשור אחרי # היה שובר את הפענוח. ההתקדמות ממילא נשמרת. */
      sb.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: location.origin + location.pathname },
      });
    },

    async logout() {
      try { await sb.auth.signOut(); } catch { /* גם אם השרת לא ענה — מקומית נותקנו */ }
      outbox = []; saveOutbox();
    },

    /* הכניסות מהעטיפות שב-app.js */
    queue: (ns, k, v) => push({ op: 'set', ns, k, v }),
    queueDelete: (ns, k) => push({ op: 'del', ns, k }),
    queueClear: (ns) => push({ op: 'clearns', ns }),
    queueClearPrefix: (ns, prefix) => push({ op: 'clearpre', ns, k: prefix }),

    /* מעקב אגרגטיבי — app.js קורא Cloud.track('view', courseId) וכו׳. */
    track,

    /* קריאות לוח הבקרה — מחזירות אגרגטים בלבד, ורק למנהל (נאכף בשרת). */
    admin: {
      overview:     ()   => sb.rpc('admin_overview'),
      signupsDaily: (d)  => sb.rpc('admin_signups_daily', { days: d ?? 30 }),
      activeDaily:  (d)  => sb.rpc('admin_active_daily',  { days: d ?? 30 }),
      activeHourly: (d)  => sb.rpc('admin_active_hourly', { days: d ?? 30 }),
      topTargets:   (d, l) => sb.rpc('admin_top_targets', { days: d ?? 30, lim: l ?? 20 }),
    },

    status: () => ({ pending: outbox.length, lastSync: state.lastSync, syncing: state.syncing }),
  };
  window.Cloud = Cloud;

  sb.auth.onAuthStateChange((event, session) => {
    const had = !!state.session;
    setSession(session);
    emit('cloud:user');
    if (session && !had) { syncNow(); track('login'); }   // התחברות טרייה (גם השלמת PKCE אחרי redirect)
  });
})();
