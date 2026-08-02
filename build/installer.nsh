; NF-Blaze — התאמות למתקין NSIS
; מוזרק לפני עמודי ה-MUI, כך שה-!define-ים משפיעים על עמוד הרישיון.

; תיבת סימון «קראתי ומאשר» שחייבים לסמן כדי להמשיך את ההתקנה.
; (define ייעודי לעמוד הרישיון — לא משפיע על עמודים אחרים)
!define MUI_LICENSEPAGE_CHECKBOX
!define MUI_LICENSEPAGE_CHECKBOX_TEXT "קראתי ואני מאשר/ת את התקנון ותנאי השימוש"
