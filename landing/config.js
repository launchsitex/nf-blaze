/**
 * הגדרות דף הנחיתה. אין כאן סוד — המפתח הזה מיועד לדפדפן.
 * הסוד היחיד (מפתח Resend) יושב ב-Secrets של Supabase, בצד השרת.
 */
window.NFB_CONFIG = {
  /** Edge Function ששולחת את טופס בקשת הרישיון למייל */
  requestEndpoint:
    'https://ilsidpixxkfwowsnkntg.supabase.co/functions/v1/request-license',

  /** מפתח publishable של הפרויקט — נדרש בכותרת apikey, אינו סוד */
  anonKey: 'sb_publishable_6TuWWlf5vZBoNqaW5naH3w_FHUj8HSr',

  /**
   * מניפסט הגרסה — אותו קובץ שהאפליקציה עצמה קוראת לזיהוי עדכונים.
   * הדף קורא אותו כדי לבנות את קישור ההורדה ולהציג את מספר הגרסה,
   * כך שהקישור **מתעדכן לבד בכל פרסום** ואי אפשר לשכוח אותו.
   *
   * נתיב יחסי בכוונה — כך זה תמיד אותו מקור, בלי תלות ב-www או בדומיין,
   * ובלי צורך בהרשאת CORS.
   */
  versionUrl: '/download/version.json',

  /**
   * גיבוי אם המניפסט לא נגיש. מתעדכן אוטומטית על ידי
   * `scripts/make-release.cjs` בכל `npm run release` — אין לערוך ביד.
   */
  downloadUrl: 'https://nf-blaze.dev/download/NF-Blaze-Setup-1.66.2.exe',

  contactEmail: 'Info@nf-blaze.dev'
}
