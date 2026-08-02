/**
 * הודעות שגיאה שמלמדות.
 *
 * שגיאה שאומרת רק «נכשל» עולה סבב שלם: המודל מנחש שוב, לרוב אותו ניחוש.
 * שגיאה שאומרת **מה לעשות במקום** ומראה **פורמט תקין** נפתרת באותו סבב.
 *
 * הכללים כאן ניטרליים לספק — עוזרים ל-GPT (שטועה בעיקר בפרמטרים),
 * ל-Gemini (שמייצר ארגומנטים פגומים) ול-Claude (שנוטה לחקור במקום לפעול).
 */

/** רמז תיקון לפי קוד שגיאה — מה לעשות עכשיו, לא מה קרה */
const GUIDANCE: Record<string, string> = {
  old_string_not_found:
    'קרא את הקובץ שוב עם read_file והעתק את הטקסט **בדיוק** כפי שהוא, כולל רווחים והזחה. אל תנחש.',

  old_string_not_unique:
    'הרחב את old_string כך שיכלול שורה לפני ואחרי — עד שהקטע ייחודי בקובץ. לחלופין השתמש ב-write_file לקובץ המלא.',

  read_before_edit: 'קרא קודם את הקובץ עם read_file, ורק אחר כך ערוך אותו.',

  out_of_scope:
    'הצהר על הקובץ ב-declare_scope לפני שאתה כותב אליו, עם סיבה קצרה. דוגמה: declare_scope({ files: ["src/App.tsx"], reason: "הוספת ניווט" }).',

  scope_reason_required: 'declare_scope דורש reason — משפט קצר שמסביר למה הקובץ נחוץ למשימה.',

  invalid_args:
    'בדוק את שמות הפרמטרים ואת הטיפוסים בהגדרת הכלי. כל הנתיבים הם מחרוזות יחסיות לשורש הפרויקט, למשל "src/App.tsx".',

  invalid_path:
    'השתמש בנתיב יחסי לשורש הפרויקט עם לוכסנים רגילים, למשל "src/components/Hero.tsx". בלי ".." ובלי נתיב מוחלט.',

  path_escape:
    'הנתיב יוצא מתיקיית הפרויקט. מותר לגעת רק בקבצים בתוך הפרויקט — נסה נתיב יחסי כמו "src/…".',

  secret_file:
    'קובץ סודות (.env וכדומה) חסום לכתיבה. אם דרוש ערך סביבה, כתוב אותו ב-.env.example והסבר למשתמש מה למלא.',

  destructive_write:
    'הכתיבה הזו מוחקת תוכן קיים בהיקף חריג. אם זו הכוונה — פרק אותה לעריכות ממוקדות עם edit_file, כך שהשינוי יהיה נראה וניתן לביטול.',

  local_import_missing:
    'ה-import מצביע על קובץ שלא קיים. צור אותו קודם, או תקן את הנתיב. ודא שכל import נפתר לפני סיום.',

  package_not_installed:
    'החבילה לא מותקנת. הרץ run_command עם "npm install <שם-החבילה>" לפני השימוש בה.',

  invalid_component_props:
    'הקומפוננטה מקבלת props שלא קיימים בהגדרה שלה. קרא את קובץ הקומפוננטה כדי לראות אילו props היא מקבלת.',

  command_not_allowed:
    'הפקודה חסומה. מותרות פקודות פרויקט בלבד (npm install / npm run …). אל תנסה לעקוף — בחר דרך אחרת.',

  invalid_regex: 'הביטוי הרגולרי לא תקין. אם התכוונת לחפש טקסט מילולי, העבר literal: true.',

  invalid_json:
    'הארגומנטים לא היו JSON תקין. שלח אובייקט JSON יחיד ותקין, בלי טקסט לפניו או אחריו, בלי פסיק אחרון ובלי הערות.',

  memory_too_long: 'הזיכרון ארוך מדי. שמור רק החלטות ועובדות שיישארו רלוונטיות — לא תיאור של הסבב.',

  timeout: 'הפעולה עברה את מגבלת הזמן. פצל אותה לצעדים קטנים יותר, או צמצם את ההיקף.'
}

/** דוגמה לקריאה תקינה — מוצגת כשהמודל טעה בצורת הארגומנטים */
const EXAMPLES: Record<string, string> = {
  invalid_args:
    'edit_file({ path: "src/App.tsx", old_string: "<h1>שלום</h1>", new_string: "<h1>ברוכים הבאים</h1>" })',
  invalid_json: '{"path": "src/App.tsx", "content": "…"}',
  invalid_path: 'read_file({ path: "src/components/Hero.tsx" })'
}

/**
 * בונה הודעת שגיאה מלאה: מה קרה → מה לעשות → דוגמה.
 * שגיאה בלי הנחיה מוכרת מוחזרת כמו שהיא, בלי רעש.
 */
export function formatToolError(message: string, code?: string): string {
  const head = code ? `[${code}] ${message}` : message
  if (!code) return head

  const fix = GUIDANCE[code]
  const example = EXAMPLES[code]
  if (!fix && !example) return head

  const lines = [head]
  if (fix) lines.push(`תיקון: ${fix}`)
  if (example) lines.push(`פורמט תקין: ${example}`)
  return lines.join('\n')
}

/** נחשף לטסטים ולבדיקות כיסוי */
export function knownErrorCodes(): string[] {
  return Object.keys(GUIDANCE).sort()
}
