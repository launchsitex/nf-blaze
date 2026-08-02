/* NF-Blaze · לוגיקת דף הנחיתה
   ללא תלויות חיצוניות. כל אפקט מכבד prefers-reduced-motion. */

(function () {
  'use strict'

  var CFG = window.NFB_CONFIG || {}
  var reduced =
    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  /* ---------- חסימת תפריט ההקשר (קליק ימני) ----------
     ⚠️ זו אינה הגנה על התוכן: Ctrl+U, ‏F12, ‏curl וכיבוי JavaScript עוקפים
     אותה לחלוטין. היא נועדה להרתעה מזדמנת בלבד.

     **שדות טופס מוחרגים** — בלעדיהם «הדבק» בבקשת הרישיון מפסיק לעבוד,
     וזה שובר משתמש אמיתי בלי להוסיף שום הגנה. החרגה של טקסט מסומן נשקלה
     ונפסלה: היא הייתה הופכת את החסימה לחסרת ערך, כי סימון מילה אחת מחזיר
     את התפריט. */
  document.addEventListener('contextmenu', function (e) {
    var el = e.target
    if (el && el.closest && el.closest('input, textarea, [contenteditable="true"]')) return
    e.preventDefault()
  })

  /* ---------- שנה בפוטר ---------- */
  var yearEl = document.getElementById('year')
  if (yearEl) yearEl.textContent = String(new Date().getFullYear())

  /* ---------- ניווט: צל בגלילה + תפריט מובייל ---------- */
  var nav = document.getElementById('nav')
  var onScroll = function () {
    if (nav) nav.classList.toggle('scrolled', window.scrollY > 8)
  }
  window.addEventListener('scroll', onScroll, { passive: true })
  onScroll()

  var toggle = document.getElementById('navToggle')
  var menu = document.getElementById('mobileMenu')

  function setMenu(open) {
    if (!menu || !toggle) return
    menu.classList.toggle('open', open)
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false')
    toggle.innerHTML =
      '<svg class="ic" aria-hidden="true"><use href="#' +
      (open ? 'i-close' : 'i-menu') +
      '"></use></svg>'
  }

  if (toggle) {
    toggle.addEventListener('click', function () {
      setMenu(!menu.classList.contains('open'))
    })
  }
  if (menu) {
    // כל בחירה בתפריט סוגרת אותו — אחרת הוא מסתיר את היעד
    menu.addEventListener('click', function (e) {
      if (e.target.closest('a')) setMenu(false)
    })
  }
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') setMenu(false)
  })
  // מעבר לדסקטופ בזמן שהתפריט פתוח משאיר שכבה תלויה
  window.addEventListener('resize', function () {
    if (window.innerWidth >= 1050) setMenu(false)
  })

  /* ---------- חשיפה בגלילה ---------- */
  var revealables = document.querySelectorAll('.reveal:not(.in)')
  if (reduced || !('IntersectionObserver' in window)) {
    revealables.forEach(function (el) {
      el.classList.add('in')
    })
  } else {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('in')
            io.unobserve(entry.target)
          }
        })
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.08 }
    )
    revealables.forEach(function (el) {
      io.observe(el)
    })
  }

  /* ---------- גחלים ---------- */
  var embers = document.getElementById('embers')
  if (embers && !reduced) {
    // כמות מותאמת למסך — במובייל פחות חלקיקים, פחות עומס
    var count = window.innerWidth < 700 ? 9 : 18
    var html = ''
    for (var i = 0; i < count; i++) {
      var left = Math.random() * 100
      var dur = 9 + Math.random() * 11
      var delay = Math.random() * 12
      var size = 2 + Math.random() * 3
      var drift = (Math.random() * 80 - 40).toFixed(0)
      html +=
        '<span class="ember" style="left:' +
        left.toFixed(2) +
        '%;width:' +
        size.toFixed(1) +
        'px;height:' +
        size.toFixed(1) +
        'px;animation-duration:' +
        dur.toFixed(1) +
        's;animation-delay:-' +
        delay.toFixed(1) +
        's;--drift:' +
        drift +
        'px"></span>'
    }
    embers.innerHTML = html
  }

  /* ---------- חלון «הסוכן עובד» ---------- */
  var consoleBody = document.getElementById('consoleBody')

  var SCRIPT = [
    { tag: 'משתמש', cls: 'tag-user', text: 'בנה מערכת לניהול לקוחות עם חיפוש ודוח חודשי' },
    { tag: 'תוכנית', cls: 'tag-tool', text: '4 שלבים · קריטריוני קבלה הוגדרו' },
    { tag: 'כלי', cls: 'tag-tool', code: 'run_sql — create table customers + RLS' },
    { tag: 'כלי', cls: 'tag-tool', code: 'write_file — src/pages/Customers.tsx' },
    { tag: 'בדיקה', cls: 'tag-tool', text: 'tsc עבר · אין ייבוא שבור · טעינה/ריק/שגיאה קיימים' },
    { tag: 'תצוגה', cls: 'tag-ok', text: 'האפליקציה עלתה — לא נמצאו רגרסיות' },
    { tag: 'סיום', cls: 'tag-ok', text: 'מוכן. רוצה שאפרסם ל-GitHub?' }
  ]

  function renderLine(item, index) {
    var line = document.createElement('div')
    line.className = 'line'
    line.style.animationDelay = index * 0.09 + 's'

    var tag = document.createElement('span')
    tag.className = 'tag ' + item.cls
    tag.textContent = item.tag
    line.appendChild(tag)

    var body = document.createElement('div')
    if (item.code) {
      var c = document.createElement('code')
      c.textContent = item.code
      body.appendChild(c)
    } else {
      body.textContent = item.text
    }
    line.appendChild(body)
    return line
  }

  if (consoleBody) {
    if (reduced) {
      SCRIPT.forEach(function (item, i) {
        var el = renderLine(item, 0)
        el.style.opacity = '1'
        el.style.transform = 'none'
        el.style.animation = 'none'
        consoleBody.appendChild(el)
        void i
      })
    } else {
      var idx = 0
      var caretLine = document.createElement('div')
      caretLine.className = 'line'
      caretLine.style.animationDelay = '0s'
      caretLine.innerHTML = '<span class="caret"></span>'

      var tick = function () {
        if (idx >= SCRIPT.length) {
          // מתחילים מחדש אחרי הפוגה — הלולאה ממחישה תהליך מתמשך
          setTimeout(function () {
            consoleBody.innerHTML = ''
            idx = 0
            tick()
          }, 4200)
          return
        }
        if (caretLine.parentNode) caretLine.parentNode.removeChild(caretLine)
        consoleBody.appendChild(renderLine(SCRIPT[idx], 0))
        idx++
        if (idx < SCRIPT.length) consoleBody.appendChild(caretLine)
        setTimeout(tick, 1150 + Math.random() * 500)
      }

      // מתחילים רק כשהחלון נראה — לא מבזבזים סוללה ברקע
      if ('IntersectionObserver' in window) {
        var co = new IntersectionObserver(
          function (entries) {
            if (entries[0].isIntersecting) {
              co.disconnect()
              tick()
            }
          },
          { threshold: 0.25 }
        )
        co.observe(consoleBody)
      } else {
        tick()
      }
    }
  }

  /* ---------- כפתור הורדה ----------
     הקישור נבנה מהמניפסט שמתפרסם בכל גרסה, ולכן הוא לא מתיישן.
     ‏CFG.downloadUrl הוא רק גיבוי אם המניפסט לא נגיש. */
  var dlBtn = document.getElementById('dlBtn')
  var dlVersion = document.getElementById('dlVersion')

  function setDownload(url, version) {
    if (!dlBtn) return
    if (!url) {
      // אין קובץ — עדיף להפנות לבקשת רישיון מאשר לקישור שבור
      dlBtn.setAttribute('href', '#license')
      dlBtn.removeAttribute('download')
      return
    }
    dlBtn.setAttribute('href', url)
    dlBtn.setAttribute('download', '')
    if (dlVersion && version) dlVersion.textContent = 'גרסה ' + version
  }

  setDownload(CFG.downloadUrl)

  if (CFG.versionUrl) {
    fetch(CFG.versionUrl + '?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) {
        return r.ok ? r.json() : null
      })
      .then(function (m) {
        if (!m || !m.version) return
        var url =
          m.downloadUrl ||
          CFG.versionUrl.replace(/version\.json$/, 'NF-Blaze-Setup-' + m.version + '.exe')
        setDownload(url, m.version)
      })
      .catch(function () {
        /* נשארים עם הגיבוי מ-config.js */
      })
  }

  /* ---------- טופס בקשת רישיון ---------- */
  var form = document.getElementById('licenseForm')
  var msg = document.getElementById('formMsg')
  var submitBtn = document.getElementById('submitBtn')
  var submitLabel = document.getElementById('submitLabel')

  function showMsg(kind, text) {
    if (!msg) return
    msg.className = 'form-msg show ' + kind
    msg.textContent = text
  }

  function clearMsg() {
    if (msg) msg.className = 'form-msg'
  }

  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault()
      clearMsg()

      var data = {
        name: form.name.value.trim(),
        email: form.email.value.trim(),
        source: form.source.value,
        message: form.message.value.trim(),
        website: form.website.value
      }

      // כל השדות חובה. הבדיקה כאן היא ל-UX — השרת אוכף אותה שוב.
      if (!data.name) {
        showMsg('err', 'נא למלא שם מלא.')
        form.name.focus()
        return
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(data.email)) {
        showMsg('err', 'כתובת האימייל אינה תקינה.')
        form.email.focus()
        return
      }
      if (!data.source) {
        showMsg('err', 'נא לבחור איך הגעת אלינו.')
        form.source.focus()
        return
      }
      if (!data.message) {
        showMsg('err', 'נא לספר בקצרה מה תרצה לבנות.')
        form.message.focus()
        return
      }
      if (!CFG.requestEndpoint) {
        showMsg('err', 'הטופס אינו מוגדר. אפשר לכתוב ל-' + (CFG.contactEmail || ''))
        return
      }

      submitBtn.disabled = true
      submitLabel.textContent = 'שולח…'

      fetch(CFG.requestEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: CFG.anonKey || ''
        },
        body: JSON.stringify(data)
      })
        .then(function (res) {
          return res
            .json()
            .catch(function () {
              return {}
            })
            .then(function (body) {
              return { ok: res.ok, body: body }
            })
        })
        .then(function (r) {
          if (!r.ok) {
            // שגיאת שרת מוצגת כלשונה — לא מוחלפת בהודעה גנרית
            throw new Error(
              r.body.error || 'השליחה נכשלה. אפשר לכתוב ל-' + (CFG.contactEmail || '')
            )
          }
          form.reset()
          showMsg('ok', 'הבקשה התקבלה. מפתח הרישיון יישלח אליך במייל תוך 48 שעות — תודה!')
        })
        .catch(function (err) {
          showMsg('err', err.message || 'השליחה נכשלה. נסה שוב.')
        })
        .finally(function () {
          submitBtn.disabled = false
          submitLabel.textContent = 'שלח בקשה'
        })
    })
  }
})()
