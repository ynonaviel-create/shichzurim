# הקמת הענן — מה שרק אתה יכול לעשות (~20 דקות, פעם אחת)

כל הקוד כבר מוכן ועובד. עד שתשלים את הצעדים כאן האתר מתנהג **בדיוק כמו היום**
(הענן כבוי כי הקונפיג ריק). אחרי שתמלא את שני הערכים בסוף — ההתחברות והסנכרון
יידלקו מעצמם.

## 1. פרויקט Supabase

1. היכנס ל-https://supabase.com → **New project**.
2. שם: `shichzurim` · סיסמת DB: שמור במקום בטוח · **Region: Central EU (Frankfurt)** — הכי קרוב לישראל.
3. כשהפרויקט מוכן: **SQL Editor** → הדבק את כל התוכן של `supabase/migrations/0001_user_kv.sql` → **Run**.
   אמור להסתיים בהצלחה בלי שגיאות (נוצרת טבלת `user_kv` עם RLS).

## 2. התחברות עם Google (בתוך Supabase)

1. בדשבורד: **Authentication → Sign In / Up → Google** → Enable.
2. Supabase יראה לך **Callback URL** (משהו כמו `https://xxxx.supabase.co/auth/v1/callback`) — העתק אותו, צריך אותו בצעד הבא.
3. פתח https://console.cloud.google.com → צור פרויקט (או השתמש בקיים) →
   **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
   - אם זו הפעם הראשונה: יבקש קודם להגדיר **OAuth consent screen** — בחר External,
     שם האפליקציה "ארכיון השחזורים", המייל שלך, ושמור. אין צורך ב-scopes מיוחדים.
   - Application type: **Web application**.
   - **Authorized JavaScript origins** — שלוש שורות:
     - `https://ynonaviel-create.github.io`
     - `http://localhost:8765`
     - `http://localhost:8766`
   - **Authorized redirect URIs**: ה-Callback URL שהעתקת מ-Supabase.
4. העתק את ה-**Client ID** וה-**Client Secret** שנוצרו → הדבק אותם בחלון ה-Google שב-Supabase → Save.
5. עוד ב-Supabase: **Authentication → URL Configuration**:
   - **Site URL**: `https://ynonaviel-create.github.io/shichzurim/` (כתובת האתר האמיתית)
   - **Redirect URLs** — הוסף גם: `http://localhost:8765/**` ו-`http://localhost:8766/**`

## 3. חיבור האתר

1. בדשבורד: **Project Settings → API** → העתק:
   - **Project URL** (`https://xxxx.supabase.co`)
   - **anon public** key (זה מפתח ציבורי — מותר לו להופיע בקוד; ההגנה היא ה-RLS)
2. פתח את `assets/cloud.js` ומלא את שני הערכים בראש הקובץ:
   ```js
   const CONFIG = {
     url: 'https://xxxx.supabase.co',
     anonKey: 'eyJ...',
   };
   ```
3. הרץ `node sync.js` (חותם את הגרסה החדשה של cloud.js).

## 4. keep-alive (מונע השהיית הפרויקט בחופשות)

בגיטהאב: הריפו → **Settings → Secrets and variables → Actions → New repository secret**:
- `SUPABASE_URL` = ה-Project URL
- `SUPABASE_ANON_KEY` = ה-anon key

זהו — ה-workflow (`.github/workflows/supabase-keepalive.yml`) כבר בריפו וירוץ פעמיים בשבוע.
אפשר לבדוק אותו מיד: Actions → Supabase keep-alive → Run workflow.

## 5. בדיקה שהכל עובד (לפני שדוחפים)

מקומית (`start.command` או השרת מ-Claude Code):
1. נפתח האתר → אמור להופיע כפתור **"התחברות"** ב-topbar (אם לא — הקונפיג לא נקלט, בדוק שהרצת sync.js ורעננת עם Cmd+Shift+R).
2. לחץ התחברות → מסך Google → חזרה לאתר → הכפתור הופך לעיגול עם האות שלך.
3. ענה על כמה שאלות → פתח את Supabase → **Table Editor → user_kv** → אמורות להופיע שורות.
4. פתח את האתר בדפדפן אחר (או מצב גלישה בסתר) → התחבר עם אותו חשבון → ההתקדמות שם.

רק אחרי שכל 4 הצעדים עברו — לדחוף לאתר האמיתי.

## 6. צעד ב׳ — סגירת האתר (מתי שתחליט, לא ערב מבחן)

אחרי כמה ימים שהסנכרון רץ יציב על סטודנטים אמיתיים:
- ב-`assets/app.js`, שנה `const REQUIRE_LOGIN = false` ל-`true` → `node sync.js` → קומיט ודחיפה.
- מעכשיו כל האתר (חוץ מ"מה זה?") דורש התחברות.
- חרטה/תקלה? להחזיר ל-`false` ולדחוף — הכל חוזר לפתוח.
