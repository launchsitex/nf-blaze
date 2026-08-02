/**
 * ═══════════════════════════════════════════════════════════════════════
 *  תפריט נגישות — NF-Blaze
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ⚠️ **תפריט נגישות אינו תחליף לאתר נגיש.** ת"י 5568 חל על האתר עצמו,
 * והוא זה שנבדק — ניגודיות, ניווט מקלדת, תוויות, מבנה כותרות. התפריט
 * הזה הוא שכבת התאמה אישית **נוספת**, לא במקום.
 *
 * הכל מקומי: ההעדפות נשמרות ב-localStorage בדפדפן של המשתמש בלבד,
 * ולא נשלחות לשום מקום.
 *
 * נגישות התפריט עצמו: פתיחה וסגירה במקלדת, לכידת מיקוד בזמן שהוא פתוח,
 * ‏Esc סוגר, החזרת המיקוד לכפתור בסגירה, ו-aria-pressed על כל מתג.
 */
(function () {
  'use strict'

  var STORAGE_KEY = 'nfb-a11y'
  var root = document.documentElement

  /** ההגדרות. כל אחת מתורגמת למחלקה על <html> או למשתנה CSS. */
  var OPTIONS = [
    { id: 'contrast', label: 'ניגודיות גבוהה', icon: 'contrast' },
    { id: 'grayscale', label: 'גווני אפור', icon: 'gray' },
    { id: 'links', label: 'הדגשת קישורים', icon: 'link' },
    { id: 'readable', label: 'גופן קריא', icon: 'font' },
    { id: 'spacing', label: 'ריווח מוגדל', icon: 'spacing' },
    { id: 'nomotion', label: 'עצירת אנימציות', icon: 'motion' },
    { id: 'cursor', label: 'סמן גדול', icon: 'cursor' }
  ]

  var state = { scale: 100, toggles: {} }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        var parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object') {
          state.scale = Number(parsed.scale) || 100
          state.toggles = parsed.toggles || {}
        }
      }
    } catch (e) {
      /* localStorage חסום (גלישה פרטית) — ממשיכים עם ברירת מחדל */
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch (e) {
      /* לא קריטי — ההגדרה תעבוד לסשן הנוכחי */
    }
  }

  function apply() {
    // גודל טקסט: מוגבל ל-90%–160%. מעבר לזה הפריסה נשברת ולא עוזרת לאיש.
    state.scale = Math.min(160, Math.max(90, state.scale))
    root.style.setProperty('--a11y-scale', state.scale / 100)
    root.classList.toggle('a11y-scaled', state.scale !== 100)

    OPTIONS.forEach(function (o) {
      root.classList.toggle('a11y-' + o.id, !!state.toggles[o.id])
    })

    var pct = document.getElementById('a11y-pct')
    if (pct) pct.textContent = state.scale + '%'

    OPTIONS.forEach(function (o) {
      var btn = document.getElementById('a11y-opt-' + o.id)
      if (btn) btn.setAttribute('aria-pressed', state.toggles[o.id] ? 'true' : 'false')
    })
  }

  /* ---------- אייקונים ---------- */

  var ICONS = {
    a11y:
      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '<circle cx="12" cy="4.2" r="2.1" fill="currentColor"/>' +
      '<path d="M3.8 7.6c2.6.9 5.3 1.4 8.2 1.4s5.6-.5 8.2-1.4" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" fill="none"/>' +
      '<path d="M12 9v4.6m0 0-3 7.4m3-7.4 3 7.4" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" fill="none"/></svg>',
    contrast:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.4" fill="none" ' +
      'stroke="currentColor" stroke-width="1.8"/><path d="M12 3.6a8.4 8.4 0 0 1 0 16.8z" fill="currentColor"/></svg>',
    gray:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="12" r="5.4" fill="currentColor" ' +
      'opacity=".85"/><circle cx="15" cy="12" r="5.4" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
    link:
      '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" ' +
      'stroke-linecap="round"><path d="M10 13.6a3.6 3.6 0 0 0 5.1 0l2.6-2.6a3.6 3.6 0 1 0-5.1-5.1l-1.5 1.5"/>' +
      '<path d="M14 10.4a3.6 3.6 0 0 0-5.1 0l-2.6 2.6a3.6 3.6 0 1 0 5.1 5.1l1.5-1.5"/></svg>',
    font:
      '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" ' +
      'stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 19 10 5.4h1.4L17 19"/><path d="M7 14.4h7.6"/>' +
      '<path d="M19.5 19V9.6"/></svg>',
    spacing:
      '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" ' +
      'stroke-linecap="round"><path d="M4 6.4h16M4 12h16M4 17.6h16"/></svg>',
    motion:
      '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" ' +
      'stroke-linecap="round"><circle cx="12" cy="12" r="8.4"/><path d="M9.4 9.4h5.2v5.2H9.4z" fill="currentColor" ' +
      'stroke="none"/></svg>',
    cursor:
      '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M5.4 3.4 19 10.6l-5.6 1.8L11 19z"/></svg>',
    plus:
      '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" ' +
      'stroke-linecap="round"><path d="M12 5.5v13M5.5 12h13"/></svg>',
    minus:
      '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" ' +
      'stroke-linecap="round"><path d="M5.5 12h13"/></svg>',
    reset:
      '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" ' +
      'stroke-linecap="round" stroke-linejoin="round"><path d="M4.2 10.5a8 8 0 1 1 .6 5"/><path d="M4 5v5.5h5.5"/></svg>',
    close:
      '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>'
  }

  /* ---------- בנייה ---------- */

  var panel, openBtn, lastFocus

  function build() {
    openBtn = document.createElement('button')
    openBtn.className = 'a11y-fab'
    openBtn.id = 'a11y-open'
    openBtn.type = 'button'
    openBtn.setAttribute('aria-label', 'פתיחת תפריט נגישות')
    openBtn.setAttribute('aria-expanded', 'false')
    openBtn.innerHTML = ICONS.a11y

    panel = document.createElement('div')
    panel.className = 'a11y-panel'
    panel.id = 'a11y-panel'
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-modal', 'false')
    panel.setAttribute('aria-labelledby', 'a11y-title')
    panel.hidden = true

    panel.innerHTML =
      '<div class="a11y-head">' +
      '<h2 id="a11y-title">תפריט נגישות</h2>' +
      '<button type="button" class="a11y-close" id="a11y-close" aria-label="סגירת תפריט הנגישות">' +
      ICONS.close +
      '</button>' +
      '</div>' +
      '<div class="a11y-size">' +
      '<span class="a11y-size-label">גודל טקסט</span>' +
      '<div class="a11y-size-ctl">' +
      // ב-RTL האיבר הראשון מופיע מימין — «+» קודם, כמצופה בעברית
      '<button type="button" id="a11y-inc" aria-label="הגדלת גודל הטקסט">' + ICONS.plus + '</button>' +
      '<output id="a11y-pct" aria-live="polite">100%</output>' +
      '<button type="button" id="a11y-dec" aria-label="הקטנת גודל הטקסט">' + ICONS.minus + '</button>' +
      '</div>' +
      '</div>' +
      '<div class="a11y-grid">' +
      OPTIONS.map(function (o) {
        return (
          '<button type="button" class="a11y-opt" id="a11y-opt-' + o.id + '" ' +
          'data-opt="' + o.id + '" aria-pressed="false">' +
          '<span class="a11y-opt-ic">' + ICONS[o.icon] + '</span>' +
          '<span>' + o.label + '</span></button>'
        )
      }).join('') +
      '</div>' +
      '<button type="button" class="a11y-reset" id="a11y-reset">' +
      ICONS.reset + ' איפוס כל ההגדרות</button>' +
      '<a class="a11y-statement" href="/accessibility.html">הצהרת נגישות</a>'

    document.body.appendChild(openBtn)
    document.body.appendChild(panel)

    openBtn.addEventListener('click', function () {
      panel.hidden ? open() : close()
    })
    document.getElementById('a11y-close').addEventListener('click', close)

    document.getElementById('a11y-inc').addEventListener('click', function () {
      state.scale += 10
      apply()
      save()
    })
    document.getElementById('a11y-dec').addEventListener('click', function () {
      state.scale -= 10
      apply()
      save()
    })
    document.getElementById('a11y-reset').addEventListener('click', function () {
      state = { scale: 100, toggles: {} }
      apply()
      save()
    })

    panel.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-opt]')
      if (!btn) return
      var id = btn.dataset.opt
      state.toggles[id] = !state.toggles[id]
      apply()
      save()
    })

    // סגירה בלחיצה מחוץ לתפריט
    document.addEventListener('click', function (e) {
      if (panel.hidden) return
      if (!panel.contains(e.target) && e.target !== openBtn && !openBtn.contains(e.target)) close()
    })

    document.addEventListener('keydown', function (e) {
      if (panel.hidden) return
      if (e.key === 'Escape') {
        close()
        return
      }
      // לכידת מיקוד — Tab לא בורח מהתפריט כשהוא פתוח
      if (e.key === 'Tab') {
        var items = panel.querySelectorAll('button, a, [tabindex]:not([tabindex="-1"])')
        if (!items.length) return
        var first = items[0]
        var last = items[items.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    })
  }

  function open() {
    lastFocus = document.activeElement
    panel.hidden = false
    openBtn.setAttribute('aria-expanded', 'true')
    var first = panel.querySelector('button')
    if (first) first.focus()
  }

  function close() {
    panel.hidden = true
    openBtn.setAttribute('aria-expanded', 'false')
    // המיקוד חוזר לכפתור — אחרת משתמש מקלדת «מאבד את המקום»
    if (lastFocus && lastFocus.focus) lastFocus.focus()
    else openBtn.focus()
  }

  function init() {
    load()
    build()
    apply()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
