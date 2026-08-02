;Language: Hebrew (1037) — קובץ שפה MUI2 עבור NF-Blaze
;נטען דרך build/ (electron-builder מוסיף אותו ל-include path). RTL מגיע מ-Hebrew.nlf.

!insertmacro LANGFILE "Hebrew" = "עברית" "Hebrew"

!ifdef MUI_WELCOMEPAGE
  ${LangFileString} MUI_TEXT_WELCOME_INFO_TITLE "ברוכים הבאים להתקנת $(^NameDA)"
  ${LangFileString} MUI_TEXT_WELCOME_INFO_TEXT "האשף ידריך אתכם בהתקנת $(^NameDA).$\r$\n$\r$\nמומלץ לסגור את כל היישומים האחרים לפני תחילת ההתקנה.$\r$\n$\r$\n$_CLICK"
!endif

!ifdef MUI_UNWELCOMEPAGE
  ${LangFileString} MUI_UNTEXT_WELCOME_INFO_TITLE "ברוכים הבאים להסרת $(^NameDA)"
  ${LangFileString} MUI_UNTEXT_WELCOME_INFO_TEXT "האשף ידריך אתכם בהסרת $(^NameDA).$\r$\n$\r$\nלפני תחילת ההסרה, ודאו ש-$(^NameDA) אינו פועל.$\r$\n$\r$\n$_CLICK"
!endif

!ifdef MUI_LICENSEPAGE
  ${LangFileString} MUI_TEXT_LICENSE_TITLE "הסכם רישיון"
  ${LangFileString} MUI_TEXT_LICENSE_SUBTITLE "אנא עיינו בתנאי הרישיון לפני התקנת $(^NameDA)."
  ${LangFileString} MUI_INNERTEXT_LICENSE_BOTTOM "אם אתם מסכימים לתנאי ההסכם, לחצו «אני מסכים» כדי להמשיך. עליכם לאשר את ההסכם כדי להתקין את $(^NameDA)."
  ${LangFileString} MUI_INNERTEXT_LICENSE_BOTTOM_CHECKBOX "אם אתם מסכימים לתנאי ההסכם, סמנו את התיבה למטה. עליכם לאשר את ההסכם כדי להתקין את $(^NameDA). $_CLICK"
  ${LangFileString} MUI_INNERTEXT_LICENSE_BOTTOM_RADIOBUTTONS "אם אתם מסכימים לתנאי ההסכם, בחרו באפשרות הראשונה למטה. עליכם לאשר את ההסכם כדי להתקין את $(^NameDA). $_CLICK"
!endif

!ifdef MUI_UNLICENSEPAGE
  ${LangFileString} MUI_UNTEXT_LICENSE_TITLE "הסכם רישיון"
  ${LangFileString} MUI_UNTEXT_LICENSE_SUBTITLE "אנא עיינו בתנאי הרישיון לפני הסרת $(^NameDA)."
  ${LangFileString} MUI_UNINNERTEXT_LICENSE_BOTTOM "אם אתם מסכימים לתנאי ההסכם, לחצו «אני מסכים» כדי להמשיך. עליכם לאשר את ההסכם כדי להסיר את $(^NameDA)."
  ${LangFileString} MUI_UNINNERTEXT_LICENSE_BOTTOM_CHECKBOX "אם אתם מסכימים לתנאי ההסכם, סמנו את התיבה למטה. עליכם לאשר את ההסכם כדי להסיר את $(^NameDA). $_CLICK"
  ${LangFileString} MUI_UNINNERTEXT_LICENSE_BOTTOM_RADIOBUTTONS "אם אתם מסכימים לתנאי ההסכם, בחרו באפשרות הראשונה למטה. עליכם לאשר את ההסכם כדי להסיר את $(^NameDA). $_CLICK"
!endif

!ifdef MUI_LICENSEPAGE | MUI_UNLICENSEPAGE
  ${LangFileString} MUI_INNERTEXT_LICENSE_TOP "לחצו Page Down כדי לראות את שאר ההסכם."
!endif

!ifdef MUI_COMPONENTSPAGE
  ${LangFileString} MUI_TEXT_COMPONENTS_TITLE "בחירת רכיבים"
  ${LangFileString} MUI_TEXT_COMPONENTS_SUBTITLE "בחרו אילו רכיבים של $(^NameDA) להתקין."
!endif

!ifdef MUI_UNCOMPONENTSPAGE
  ${LangFileString} MUI_UNTEXT_COMPONENTS_TITLE "בחירת רכיבים"
  ${LangFileString} MUI_UNTEXT_COMPONENTS_SUBTITLE "בחרו אילו רכיבים של $(^NameDA) להסיר."
!endif

!ifdef MUI_COMPONENTSPAGE | MUI_UNCOMPONENTSPAGE
  ${LangFileString} MUI_INNERTEXT_COMPONENTS_DESCRIPTION_TITLE "תיאור"
  !ifndef NSIS_CONFIG_COMPONENTPAGE_ALTERNATIVE
    ${LangFileString} MUI_INNERTEXT_COMPONENTS_DESCRIPTION_INFO "העבירו את העכבר מעל רכיב כדי לראות את תיאורו."
  !else
    ${LangFileString} MUI_INNERTEXT_COMPONENTS_DESCRIPTION_INFO "בחרו רכיב כדי לראות את תיאורו."
  !endif
!endif

!ifdef MUI_DIRECTORYPAGE
  ${LangFileString} MUI_TEXT_DIRECTORY_TITLE "בחירת מיקום ההתקנה"
  ${LangFileString} MUI_TEXT_DIRECTORY_SUBTITLE "בחרו את התיקייה שאליה יותקן $(^NameDA)."
!endif

!ifdef MUI_UNDIRECTORYPAGE
  ${LangFileString} MUI_UNTEXT_DIRECTORY_TITLE "בחירת מיקום ההסרה"
  ${LangFileString} MUI_UNTEXT_DIRECTORY_SUBTITLE "בחרו את התיקייה שממנה יוסר $(^NameDA)."
!endif

!ifdef MUI_INSTFILESPAGE
  ${LangFileString} MUI_TEXT_INSTALLING_TITLE "מתקין"
  ${LangFileString} MUI_TEXT_INSTALLING_SUBTITLE "אנא המתינו בזמן ש-$(^NameDA) מותקן."
  ${LangFileString} MUI_TEXT_FINISH_TITLE "ההתקנה הושלמה"
  ${LangFileString} MUI_TEXT_FINISH_SUBTITLE "ההתקנה הושלמה בהצלחה."
  ${LangFileString} MUI_TEXT_ABORT_TITLE "ההתקנה בוטלה"
  ${LangFileString} MUI_TEXT_ABORT_SUBTITLE "ההתקנה לא הושלמה בהצלחה."
!endif

!ifdef MUI_UNINSTFILESPAGE
  ${LangFileString} MUI_UNTEXT_UNINSTALLING_TITLE "מסיר"
  ${LangFileString} MUI_UNTEXT_UNINSTALLING_SUBTITLE "אנא המתינו בזמן ש-$(^NameDA) מוסר."
  ${LangFileString} MUI_UNTEXT_FINISH_TITLE "ההסרה הושלמה"
  ${LangFileString} MUI_UNTEXT_FINISH_SUBTITLE "ההסרה הושלמה בהצלחה."
  ${LangFileString} MUI_UNTEXT_ABORT_TITLE "ההסרה בוטלה"
  ${LangFileString} MUI_UNTEXT_ABORT_SUBTITLE "ההסרה לא הושלמה בהצלחה."
!endif

!ifdef MUI_FINISHPAGE
  ${LangFileString} MUI_TEXT_FINISH_INFO_TITLE "משלים את התקנת $(^NameDA)"
  ${LangFileString} MUI_TEXT_FINISH_INFO_TEXT "$(^NameDA) הותקן במחשב שלכם.$\r$\n$\r$\nלחצו «סיום» לסגירת האשף."
  ${LangFileString} MUI_TEXT_FINISH_INFO_REBOOT "יש להפעיל מחדש את המחשב כדי להשלים את התקנת $(^NameDA). להפעיל מחדש עכשיו?"
!endif

!ifdef MUI_UNFINISHPAGE
  ${LangFileString} MUI_UNTEXT_FINISH_INFO_TITLE "משלים את הסרת $(^NameDA)"
  ${LangFileString} MUI_UNTEXT_FINISH_INFO_TEXT "$(^NameDA) הוסר מהמחשב שלכם.$\r$\n$\r$\nלחצו «סיום» לסגירת האשף."
  ${LangFileString} MUI_UNTEXT_FINISH_INFO_REBOOT "יש להפעיל מחדש את המחשב כדי להשלים את הסרת $(^NameDA). להפעיל מחדש עכשיו?"
!endif

!ifdef MUI_FINISHPAGE | MUI_UNFINISHPAGE
  ${LangFileString} MUI_TEXT_FINISH_REBOOTNOW "הפעל מחדש עכשיו"
  ${LangFileString} MUI_TEXT_FINISH_REBOOTLATER "אפעיל מחדש ידנית מאוחר יותר"
  ${LangFileString} MUI_TEXT_FINISH_RUN "&הפעל את $(^NameDA)"
  ${LangFileString} MUI_TEXT_FINISH_SHOWREADME "&הצג קובץ README"
  ${LangFileString} MUI_BUTTONTEXT_FINISH "&סיום"
!endif

!ifdef MUI_STARTMENUPAGE
  ${LangFileString} MUI_TEXT_STARTMENU_TITLE "בחירת תיקייה בתפריט התחל"
  ${LangFileString} MUI_TEXT_STARTMENU_SUBTITLE "בחרו תיקייה בתפריט התחל לקיצורי הדרך של $(^NameDA)."
  ${LangFileString} MUI_INNERTEXT_STARTMENU_TOP "בחרו את התיקייה בתפריט התחל שבה ייווצרו קיצורי הדרך של התוכנה. אפשר גם להזין שם ליצירת תיקייה חדשה."
  ${LangFileString} MUI_INNERTEXT_STARTMENU_CHECKBOX "אל תיצור קיצורי דרך"
!endif

!ifdef MUI_UNCONFIRMPAGE
  ${LangFileString} MUI_UNTEXT_CONFIRM_TITLE "הסרת $(^NameDA)"
  ${LangFileString} MUI_UNTEXT_CONFIRM_SUBTITLE "הסרת $(^NameDA) מהמחשב."
!endif

!ifdef MUI_ABORTWARNING
  ${LangFileString} MUI_TEXT_ABORTWARNING "האם אתם בטוחים שברצונכם לצאת מהתקנת $(^Name)?"
!endif

!ifdef MUI_UNABORTWARNING
  ${LangFileString} MUI_UNTEXT_ABORTWARNING "האם אתם בטוחים שברצונכם לצאת מהסרת $(^Name)?"
!endif

!ifdef MULTIUSER_INSTALLMODEPAGE
  ${LangFileString} MULTIUSER_TEXT_INSTALLMODE_TITLE "בחירת משתמשים"
  ${LangFileString} MULTIUSER_TEXT_INSTALLMODE_SUBTITLE "בחרו עבור אילו משתמשים להתקין את $(^NameDA)."
  ${LangFileString} MULTIUSER_INNERTEXT_INSTALLMODE_TOP "בחרו אם להתקין את $(^NameDA) עבורכם בלבד או עבור כל המשתמשים במחשב. $(^ClickNext)"
  ${LangFileString} MULTIUSER_INNERTEXT_INSTALLMODE_ALLUSERS "התקנה עבור כל המשתמשים במחשב"
  ${LangFileString} MULTIUSER_INNERTEXT_INSTALLMODE_CURRENTUSER "התקנה עבורי בלבד"
!endif
