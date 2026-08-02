# NF-Blaze · חיבור חשבונות בלחיצה אחת (OAuth broker)

«התחבר עם GitHub / Supabase / Vercel» במקום להדביק טוקנים. הפונקציה
`supabase/functions/oauth` היא השרת היחיד שמחזיק את סודות ה-OAuth.

- **פרויקט Supabase:** `ilsidpixxkfwowsnkntg` (אותו פרויקט של פורטל הרישיונות)
- **כתובת ה-broker:** `https://ilsidpixxkfwowsnkntg.supabase.co/functions/v1/oauth`
- **כתובת החזרה שנרשמת אצל כל הספקים:**
  `https://ilsidpixxkfwowsnkntg.supabase.co/functions/v1/oauth/callback`

## למה צריך שרת בכלל

`client_secret` לא יכול לשבת בתוך אפליקציית דסקטופ — כל מי שמפרק את
החבילה משיג אותו. וספקי OAuth דורשים כתובת חזרה **קבועה ורשומה**, לא פורט
אקראי במחשב של הלקוח. אותו פתרון בדיוק שיש ל-Dyad (`supabase-oauth.dyad.sh`).

## הזרימה

```
אפליקציה                     broker                        ספק
   │  verifier אקראי (נשאר במחשב)
   │  challenge = SHA-256(verifier)
   │  מאזין על 127.0.0.1:<פורט אקראי>
   │
   ├─ דפדפן ──► /start?provider&challenge&port&sid ──302──► דף האישור
   │                                                            │
   │            /callback?code&state ◄──────────────────────────┘
   │                 │ מחליף code בטוקן (client_secret אצלו בלבד)
   │                 │ blob = הצפנת הטוקן במפתח שנגזר מ-challenge
   │  ◄──302── http://127.0.0.1:<פורט>/callback?sid&blob
   │
   └─ HTTPS ─► /exchange { blob, verifier } ──► הטוקן
```

**הטוקן לעולם אינו עובר בכתובת שהדפדפן רואה.** מה שחוזר ללולאה המקומית הוא
צופן שהמפתח שלו נגזר מ-`challenge`; רק מי שמחזיק את ה-`verifier` המקורי
(האפליקציה) יכול לבקש את פענוחו, וזה קורה על HTTPS.

ה-broker **חסר-מצב** — אין טבלה ואין ניקוי רשומות. כל ההקשר נוסע מוצפן
וחתום (AES-GCM) בתוך פרמטר ה-`state` של הספק. `state` תקף 10 דקות,
ה-`blob` 5 דקות.

## מצב הפריסה (01.08.2026)

| שלב | מצב |
|-----|-----|
| פריסת הפונקציה `oauth` (‏`--no-verify-jwt`) | ✅ |
| הסוד `OAUTH_STATE_KEY` | ✅ |
| GitHub OAuth App + סודות | ✅ אומת מקצה לקצה על האפליקציה הרצה |
| Supabase OAuth App + סודות | ✅ אומת מקצה לקצה — ארגון, רשימת פרויקטים, משיכת מפתחות, והרצת SQL |
| Vercel Integration + סודות | ❌ נותר |

## רישום האפליקציות אצל הספקים

בכל השלושה כתובת החזרה זהה (ראה למעלה), ואתר המוצר הוא **`https://nf-blaze.dev`**.

> ה-Homepage/Website הוא **שדה תצוגה בלבד** — הוא מופיע במסך האישור שהמשתמש
> רואה ואין אליו שום קריאה. הוא לא חייב להיות אתר חי בזמן הרישום.

### GitHub — OAuth App

<https://github.com/settings/developers> ← **New OAuth App**

| שדה | ערך |
|-----|-----|
| Application name | `NF-Blaze` |
| Homepage URL | `https://nf-blaze.dev` |
| Application description | `בניית אפליקציות עם AI — יצירת ריפו ודחיפת קוד בשמך` |
| Authorization callback URL | כתובת החזרה |

הרשאות מבוקשות: `repo read:user workflow` — יצירת ריפו פרטי, דחיפת קוד,
ושם המשתמש בממשק. `workflow` נדרש כדי שדחיפה של קובץ ב-`.github/workflows`
לא תיפסל. ל-OAuth App יש **כתובת חזרה אחת בלבד**.

הטוקן של GitHub **אינו פג** ואין לו refresh token.

### Supabase — OAuth App

Organization Settings ← **OAuth Apps** ← Add application
(<https://supabase.com/dashboard/org/_/apps>)

| שדה | ערך |
|-----|-----|
| Application name | `NF-Blaze` |
| Website | `https://nf-blaze.dev` |
| Redirect URI | כתובת החזרה |

ההרשאות נקבעות **על האפליקציה עצמה**, לא בכתובת האישור. נדרשות:

| יכולת | הרשאה |
|-------|-------|
| רשימת הפרויקטים של המשתמש | **Projects: Read** |
| קריאת מפתחות ה-API של הפרויקט | **Secrets: Read** |
| הרצת SQL בשביל הסוכן | **Database: Write** |

טוקן Supabase **פג** (כיממה) ומחודש אוטומטית דרך `/refresh`. ה-refresh
token הוא **חד-פעמי ומתחלף בכל חידוש** — הקוד שומר תמיד את החדש.

### Vercel — Integration (לא «Sign in with Vercel»)

<https://vercel.com/dashboard/integrations/console> ← **Create**

⚠️ **«Sign in with Vercel» לא מתאים כאן** — הוא נותן זהות בלבד
(`openid email profile`), וההרשאות ליצירת פרויקטים ודיפלויים נמצאות
אצלם בביתא סגורה. לכן משתמשים במסלול ה-Integration.

| שדה | ערך |
|-----|-----|
| Name | `NF-Blaze` |
| URL Slug | `nf-blaze` (או מה שתבחר — חייב להתאים לסוד `VERCEL_INTEGRATION_SLUG`) |
| URL / Website | `https://nf-blaze.dev` |
| Redirect URL | כתובת החזרה |

הרשאות (Scopes): `project` = Read/Write · `deployment` = Read/Write ·
`user` = Read · `project-env-vars` = Read/Write.

אין צורך באישור מרקטפלייס — אינטגרציה חדשה מקבלת תג **Community** וניתנת
להתקנה מהאתר שלך מיד.

הטוקן של Vercel **אינו פג**. אם החשבון הוא צוותי, ה-callback מחזיר `teamId`
והוא נשמר בהגדרות — בלעדיו כל קריאה ל-API מחזירה 403.

## הסודות בפרויקט Supabase

```bash
supabase secrets set OAUTH_STATE_KEY=<32 בתים base64url>   # כבר הוגדר
supabase secrets set GITHUB_CLIENT_ID=... GITHUB_CLIENT_SECRET=...
supabase secrets set SB_OAUTH_CLIENT_ID=... SB_OAUTH_CLIENT_SECRET=...
supabase secrets set VERCEL_CLIENT_ID=... VERCEL_CLIENT_SECRET=... VERCEL_INTEGRATION_SLUG=nf-blaze
```

⚠️ שמות סודות ב-Supabase **אינם יכולים להתחיל ב-`SUPABASE_`** — לכן
`SB_OAUTH_*` ולא `SUPABASE_OAUTH_*`.

ספק שסודותיו חסרים מחזיר 503 עם הודעה בעברית; שאר הספקים ממשיכים לעבוד.

## פריסה

```bash
supabase functions deploy oauth --no-verify-jwt --project-ref ilsidpixxkfwowsnkntg
```

`--no-verify-jwt` הכרחי: `/start` ו-`/callback` נפתחים בדפדפן של המשתמש
ואי אפשר לצרף להם כותרות.

## בדיקה מהירה

```bash
curl https://ilsidpixxkfwowsnkntg.supabase.co/functions/v1/oauth/health
# {"ok":true}
```

## עקיפה לפיתוח

`NF_BLAZE_OAUTH_BROKER` באפליקציה מפנה ל-broker אחר (למשל מקומי).

## אם בעתיד תרצה כתובת חזרה ממותגת

היום כתובת החזרה היא `ilsidpixxkfwowsnkntg.supabase.co`, והיא מהבהבת לרגע
בשורת הכתובת באמצע התהליך. אפשר להעביר אותה ל-`api.nf-blaze.dev` דרך
**Custom Domains** של Supabase (תוסף בתשלום). זה דורש לעדכן את כתובת החזרה
**בשלושת הדשבורדים** — ול-GitHub OAuth App יש כתובת חזרה **אחת בלבד**, כלומר
המעבר הוא חד-פעמי ולא הדרגתי. עדיף לעשות את זה יחד עם הוספת הלוגו לאפליקציות,
כשדף הנחיתה יעלה.

## מה קורה אם ה-broker לא זמין

החיבור נכשל עם הודעה מפורשת, והמשתמש עדיין יכול להתחבר ידנית — הזנת
טוקן נשארה זמינה תחת «חיבור ידני (מתקדם)» בכל שלושת הכרטיסים.
