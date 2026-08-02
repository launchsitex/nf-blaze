/**
 * סט האייקונים של NF-Blaze — משותף לכל עמודי האתר.
 *
 * מוזרק בראש ה-body בריצה סינכרונית (בלי defer), כך שהסמלים קיימים לפני
 * שהדפדפן מצייר את ה-<use> הראשון ואין הבהוב.
 *
 * מוטיב חוזר: ניצוץ בן ארבע קרניים («blaze») משובץ בתוך האייקונים
 * הפונקציונליים, כך שהסט נקרא כמשפחה אחת ולא כאוסף גנרי.
 * סימני המותג (GitHub / Supabase / Vercel / OpenAI / Gemini / Claude)
 * נשארים מזוהים — שם דווקא חשוב שהמשתמש יזהה מיד במה מדובר.
 */
var NFB_SPRITE =
  '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>' +
    '<linearGradient id="nfg" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0%" stop-color="#f0b35c"/><stop offset="100%" stop-color="#c97828"/>' +
    '</linearGradient>' +

    '<symbol id="i-brand" viewBox="0 0 48 48">' +
    '<circle cx="24" cy="24" r="21" fill="url(#nfg)"/>' +
    '<path d="M15 32V16l10 11.5V16M31 32V16h5" stroke="#1a1207" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' +
    '<path d="M31 24.5h4" stroke="#1a1207" stroke-width="3.2" stroke-linecap="round"/>' +
    '</symbol>' +

    '<symbol id="i-spark" viewBox="0 0 24 24">' +
    '<path d="M12 3.5 13.9 9 19.5 11 13.9 13 12 18.5 10.1 13 4.5 11 10.1 9z"/></symbol>' +

    '<symbol id="i-agent" viewBox="0 0 24 24">' +
    '<path d="M8.5 5 3.5 12l5 7M15.5 5l5 7-5 7"/>' +
    '<path d="M12 8.4 13.1 11l2.6 1-2.6 1-1.1 2.6L10.9 13l-2.6-1 2.6-1z"/></symbol>' +

    '<symbol id="i-select" viewBox="0 0 24 24">' +
    '<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9"/>' +
    '<path d="M4 14v3.5A1.5 1.5 0 0 0 5.5 19H8"/>' +
    '<path d="M11.5 11.5 20 15l-3.4 1.3L15 20z"/></symbol>' +

    '<symbol id="i-preview" viewBox="0 0 24 24">' +
    '<rect x="2.5" y="4" width="19" height="15.5" rx="2.4"/><path d="M2.5 8.4h19"/>' +
    '<path d="M6 14.2h2.2l1.5-2.6 1.9 4.4 1.4-2.4h3"/></symbol>' +

    '<symbol id="i-db" viewBox="0 0 24 24">' +
    '<ellipse cx="12" cy="5.8" rx="7.5" ry="2.9"/>' +
    '<path d="M4.5 5.8v6.4c0 1.6 3.4 2.9 7.5 2.9s7.5-1.3 7.5-2.9V5.8"/>' +
    '<path d="M4.5 12.2v5.6c0 1.6 3.4 2.9 7.5 2.9 1.2 0 2.4-.1 3.4-.3"/>' +
    '<path d="M18.6 15.2 19.6 17.6l2.4 1-2.4 1-1 2.4-1-2.4-2.4-1 2.4-1z"/></symbol>' +

    '<symbol id="i-edge" viewBox="0 0 24 24">' +
    '<path d="M12 2.6 20.3 7.3v9.4L12 21.4 3.7 16.7V7.3z"/>' +
    '<path d="M12 8 13.2 11.1 16.3 12.3 13.2 13.5 12 16.6 10.8 13.5 7.7 12.3 10.8 11.1z"/></symbol>' +

    '<symbol id="i-shield" viewBox="0 0 24 24">' +
    '<path d="M12 2.7 20 6v6.1c0 4.6-3.3 7.9-8 9.2-4.7-1.3-8-4.6-8-9.2V6z"/>' +
    '<path d="M10.2 9.4 8.3 12l1.9 2.6M13.8 9.4 15.7 12l-1.9 2.6"/></symbol>' +

    '<symbol id="i-pulse" viewBox="0 0 24 24">' +
    '<path d="M2.6 12.5h3.2l2-5.4 3 10.8 2.2-5.4h2.4"/><path d="m16.6 15.2 2 2 3.2-3.6"/></symbol>' +

    '<symbol id="i-graph" viewBox="0 0 24 24">' +
    '<circle cx="6" cy="6.5" r="2.6"/><circle cx="18.2" cy="10.4" r="2.4"/>' +
    '<circle cx="8.4" cy="18.4" r="2.4"/>' +
    '<path d="M8.3 7.7 15.9 9.6M7.4 9 8.2 15.9M15.9 12.2l-5.6 4.9"/></symbol>' +

    '<symbol id="i-layers" viewBox="0 0 24 24">' +
    '<path d="M12 2.8 21 7.2 12 11.6 3 7.2z"/><path d="M3.6 12.2 12 16.4l8.4-4.2"/>' +
    '<path d="M8.4 20.6H5.2v-3.2"/><path d="M5.4 17.6a6.4 6.4 0 0 0 10.8 1.1"/></symbol>' +

    '<symbol id="i-terminal" viewBox="0 0 24 24">' +
    '<rect x="2.5" y="4" width="19" height="16" rx="2.4"/>' +
    '<path d="m7 10 2.6 2.4L7 14.8M12.6 15.4h4.4"/></symbol>' +

    '<symbol id="i-plug" viewBox="0 0 24 24">' +
    '<path d="M12 3.2v6"/><rect x="8.6" y="9.2" width="6.8" height="5.4" rx="1.6"/>' +
    '<path d="M12 14.6v2.2M12 16.8H5.6M12 16.8h6.4"/>' +
    '<circle cx="4.4" cy="19" r="1.9"/><circle cx="19.6" cy="19" r="1.9"/></symbol>' +

    '<symbol id="i-rtl" viewBox="0 0 24 24">' +
    '<path d="M20.5 6.4H5.5M20.5 11.2h-9M20.5 16h-13"/><path d="M7 19.6 3.8 16.4 7 13.2"/></symbol>' +

    '<symbol id="i-local" viewBox="0 0 24 24">' +
    '<path d="M4.4 16V6.6A1.6 1.6 0 0 1 6 5h12a1.6 1.6 0 0 1 1.6 1.6V16"/>' +
    '<path d="M2.4 16h19.2l-1.4 2.6a1.6 1.6 0 0 1-1.4.8H5.2a1.6 1.6 0 0 1-1.4-.8z"/>' +
    '<rect x="9.8" y="9.6" width="4.4" height="3.6" rx="0.9"/>' +
    '<path d="M10.9 9.6V8.5a1.1 1.1 0 0 1 2.2 0v1.1"/></symbol>' +

    '<symbol id="i-plan" viewBox="0 0 24 24">' +
    '<path d="M5 4.4h11.4L20 8v11.6a1.6 1.6 0 0 1-1.6 1.6H5a1.6 1.6 0 0 1-1.6-1.6V6a1.6 1.6 0 0 1 1.6-1.6z"/>' +
    '<path d="m7.6 11.4 1.6 1.6 3-3M7.6 16.4l1.6 1.6 3-3"/>' +
    '<path d="M14.4 11.6h3M14.4 16.6h3"/></symbol>' +

    '<symbol id="i-memory" viewBox="0 0 24 24">' +
    '<path d="M6 3.6h12a1.4 1.4 0 0 1 1.4 1.4v15.4l-7.4-4-7.4 4V5A1.4 1.4 0 0 1 6 3.6z"/>' +
    '<path d="M12 7.6 13 10.2 15.6 11.2 13 12.2 12 14.8 11 12.2 8.4 11.2 11 10.2z"/></symbol>' +

    '<symbol id="i-chip" viewBox="0 0 24 24">' +
    '<rect x="6.4" y="6.4" width="11.2" height="11.2" rx="2"/>' +
    '<rect x="9.8" y="9.8" width="4.4" height="4.4" rx="1"/>' +
    '<path d="M9.6 3.4v3M14.4 3.4v3M9.6 17.6v3M14.4 17.6v3M3.4 9.6h3M3.4 14.4h3M17.6 9.6h3M17.6 14.4h3"/></symbol>' +

    '<symbol id="i-key" viewBox="0 0 24 24">' +
    '<circle cx="7.6" cy="12" r="3.9"/><path d="M11.5 12h9M18 12v3.4M15.2 12v2.6"/></symbol>' +

    '<symbol id="i-download" viewBox="0 0 24 24">' +
    '<path d="M12 3.4v11.4M7.8 10.8 12 15l4.2-4.2"/>' +
    '<path d="M4 17.6v1.6a1.6 1.6 0 0 0 1.6 1.6h12.8a1.6 1.6 0 0 0 1.6-1.6v-1.6"/></symbol>' +

    '<symbol id="i-check" viewBox="0 0 24 24"><path d="m4.8 12.6 4.6 4.6L19.2 7.4"/></symbol>' +

    '<symbol id="i-mail" viewBox="0 0 24 24">' +
    '<rect x="2.6" y="4.8" width="18.8" height="14.4" rx="2.2"/>' +
    '<path d="m3.4 6.6 8.6 6.2 8.6-6.2"/></symbol>' +

    '<symbol id="i-menu" viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></symbol>' +
    '<symbol id="i-close" viewBox="0 0 24 24"><path d="M6 6 18 18M18 6 6 18"/></symbol>' +

    '<symbol id="i-bolt" viewBox="0 0 24 24">' +
    '<path d="M13.4 2.6 4.8 13.4h5.6l-.8 8 8.6-10.8h-5.6z"/></symbol>' +

    '<symbol id="i-alert" viewBox="0 0 24 24">' +
    '<path d="M12 3.4 22 20.6H2z"/><path d="M12 9.6v4.4M12 17.2v.1"/></symbol>' +

    '<symbol id="i-eye-off" viewBox="0 0 24 24">' +
    '<path d="M9.6 5.2A9.6 9.6 0 0 1 12 4.9c5.2 0 9.1 4.4 9.1 7.1 0 .9-.5 2.1-1.4 3.2"/>' +
    '<path d="M6.2 7.2C4 8.7 2.9 10.8 2.9 12c0 2.7 3.9 7.1 9.1 7.1 1.6 0 3-.4 4.3-1"/>' +
    '<path d="M10.1 10.1a2.7 2.7 0 0 0 3.8 3.8M3.4 3.4l17.2 17.2"/></symbol>' +

    '<symbol id="i-wallet" viewBox="0 0 24 24">' +
    '<path d="M3.4 7.6A2 2 0 0 1 5.4 5.6h11.2a2 2 0 0 1 2 2v1.2"/>' +
    '<rect x="3.4" y="7.6" width="17.2" height="11.4" rx="2.2"/>' +
    '<path d="M20.6 11.6h-4a1.9 1.9 0 0 0 0 3.8h4"/></symbol>' +

    '<symbol id="i-clock" viewBox="0 0 24 24">' +
    '<circle cx="12" cy="12" r="8.8"/><path d="M12 6.8V12l3.4 2"/></symbol>' +

    '<symbol id="i-arrow" viewBox="0 0 24 24">' +
    '<path d="M19.4 12H4.6M10.4 5.4 4 12l6.4 6.6"/></symbol>' +

    /* --- סימני מותג --- */
    '<symbol id="i-github" viewBox="0 0 24 24">' +
    '<path d="M12 1.8a10.2 10.2 0 0 0-3.2 19.9c.5.1.7-.2.7-.5v-1.8c-2.8.6-3.4-1.4-3.4-1.4-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.4 1.1 3 .8.1-.7.4-1.1.6-1.4-2.2-.3-4.6-1.1-4.6-5 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.7 1a9.4 9.4 0 0 1 5 0c1.9-1.3 2.7-1 2.7-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.9-2.4 4.7-4.6 5 .4.3.7.9.7 1.9v2.8c0 .3.2.6.7.5A10.2 10.2 0 0 0 12 1.8z" fill="currentColor" stroke="none"/></symbol>' +

    '<symbol id="i-supabase" viewBox="0 0 24 24">' +
    '<path d="M13.1 22.4c-.6.7-1.7.3-1.7-.6l-.3-8.3h5.6c1 0 1.6 1.2 1 2z" fill="currentColor" stroke="none"/>' +
    '<path d="M10.9 1.6c.6-.7 1.7-.3 1.7.6l.3 8.3H7.3c-1 0-1.6-1.2-1-2z" fill="currentColor" stroke="none" opacity="0.55"/></symbol>' +

    '<symbol id="i-vercel" viewBox="0 0 24 24">' +
    '<path d="M12 3 22.5 21h-21z" fill="currentColor" stroke="none"/></symbol>' +

    '<symbol id="i-openai" viewBox="0 0 24 24">' +
    '<path d="M12 2.6 19.8 7.1v9.8L12 21.4 4.2 16.9V7.1z"/>' +
    '<path d="M12 7.2v9.6M8.1 9.4l7.8 4.5M15.9 9.4l-7.8 4.5"/></symbol>' +

    '<symbol id="i-gemini" viewBox="0 0 24 24">' +
    '<path d="M12 1.8c0 5.6 4.6 10.2 10.2 10.2-5.6 0-10.2 4.6-10.2 10.2 0-5.6-4.6-10.2-10.2-10.2C7.4 12 12 7.4 12 1.8z" fill="currentColor" stroke="none"/></symbol>' +

    '<symbol id="i-claude" viewBox="0 0 24 24"><g stroke-width="1.9">' +
    '<path d="M12 2.6v6.1M12 15.3v6.1M2.6 12h6.1M15.3 12h6.1"/>' +
    '<path d="M5.4 5.4 9.7 9.7M14.3 14.3l4.3 4.3M18.6 5.4l-4.3 4.3M9.7 14.3l-4.3 4.3"/>' +
    '</g></symbol>' +

  '</defs></svg>'

// הזרקה מיד אחרי תגית ה-script עצמה, בזמן פענוח העמוד — בלי document.write
// ובלי המתנה ל-DOMContentLoaded, כך שה-<use> הראשון כבר מוצא את הסמל.
if (document.currentScript) {
  document.currentScript.insertAdjacentHTML('afterend', NFB_SPRITE)
} else {
  document.addEventListener('DOMContentLoaded', function () {
    document.body.insertAdjacentHTML('afterbegin', NFB_SPRITE)
  })
}
