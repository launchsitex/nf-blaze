/**
 * Dev-only client: hover outline + click to select elements tagged with data-nf-*.
 * Parent (NF-Blaze preview) toggles via postMessage and receives selections.
 * Multi-select with Dyad-style overlays: label chip (tag + file) and a floating ✕.
 */
export const SELECT_CLIENT_SCRIPT = String.raw`
(function () {
  if (window.__NF_BLAZE_SELECT__) return;
  window.__NF_BLAZE_SELECT__ = true;

  var ATTR_FILE = 'data-nf-file';
  var ATTR_LINE = 'data-nf-line';
  var ATTR_COMP = 'data-nf-component';
  var COLOR = '#2a9d8f';
  var enabled = false;
  var hoverEl = null;
  var selectedEls = []; // בחירה מרובה — לחיצה מוסיפה, לחיצה חוזרת מסירה
  var overlays = [];
  var styleEl = null;
  var repositionTimer = null;

  function ensureStyle() {
    if (styleEl) return;
    styleEl = document.createElement('style');
    styleEl.setAttribute('data-nf-blaze-select', '1');
    styleEl.textContent = [
      'html.nf-blaze-selecting, html.nf-blaze-selecting * { cursor: crosshair !important; }',
      '.nf-blaze-hover { outline: 2px dashed #e86b3a !important; outline-offset: 2px !important; }',
      '.nf-blaze-selected { outline: 2px solid ' + COLOR + ' !important; outline-offset: 2px !important; box-shadow: inset 0 0 0 9999px rgba(42,157,143,0.08) !important; }',
      '.nf-blaze-ov { position: absolute; z-index: 2147483646; pointer-events: none; }',
      '.nf-blaze-ov-x { position: absolute; top: -13px; inset-inline-start: -13px; width: 26px; height: 26px; border: none; border-radius: 8px; background: #fff; color: #d33; font: bold 13px/26px sans-serif; text-align: center; cursor: pointer; pointer-events: auto; box-shadow: 0 2px 8px rgba(0,0,0,0.3); padding: 0; }',
      '.nf-blaze-ov-x:hover { background: #ffecec; }',
      '.nf-blaze-ov-label { position: absolute; top: 100%; inset-inline-start: 0; margin-top: 4px; max-width: 320px; background: ' + COLOR + '; color: #fff; border-radius: 7px; padding: 3px 9px; font: 11px/1.5 sans-serif; box-shadow: 0 2px 8px rgba(0,0,0,0.3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; direction: ltr; text-align: left; }',
      '.nf-blaze-ov-label b { font-size: 12px; }'
    ].join('\\n');
    document.documentElement.appendChild(styleEl);
  }

  function clearHover() {
    if (hoverEl) {
      hoverEl.classList.remove('nf-blaze-hover');
      hoverEl = null;
    }
  }

  function labelFor(el, idx) {
    var comp = el.getAttribute(ATTR_COMP) || (el.tagName || '').toLowerCase();
    var file = el.getAttribute(ATTR_FILE) || '';
    var line = el.getAttribute(ATTR_LINE) || '';
    var second = file ? file + (line ? ':' + line : '') : cssPath(el);
    var prefix = selectedEls.length > 1 ? String(idx + 1) + ' · ' : '';
    return '<b>' + prefix + comp + '</b><br>' + second;
  }

  function destroyOverlays() {
    for (var i = 0; i < overlays.length; i++) {
      if (overlays[i] && overlays[i].parentNode) overlays[i].parentNode.removeChild(overlays[i]);
    }
    overlays = [];
    if (repositionTimer) {
      clearInterval(repositionTimer);
      repositionTimer = null;
    }
  }

  function rebuildOverlays() {
    destroyOverlays();
    ensureStyle();
    for (var i = 0; i < selectedEls.length; i++) {
      (function (index) {
        var ov = document.createElement('div');
        ov.className = 'nf-blaze-ov';
        var x = document.createElement('button');
        x.className = 'nf-blaze-ov-x';
        x.type = 'button';
        x.textContent = '✕';
        x.title = 'הסר מהבחירה';
        x.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          deselectAt(index);
          postSelection();
        });
        var label = document.createElement('div');
        label.className = 'nf-blaze-ov-label';
        label.innerHTML = labelFor(selectedEls[index], index);
        ov.appendChild(x);
        ov.appendChild(label);
        document.documentElement.appendChild(ov);
        overlays.push(ov);
      })(i);
    }
    repositionAll();
    if (selectedEls.length && !repositionTimer) {
      repositionTimer = setInterval(repositionAll, 400);
    }
  }

  function repositionAll() {
    for (var i = 0; i < selectedEls.length; i++) {
      var el = selectedEls[i];
      var ov = overlays[i];
      if (!ov) continue;
      if (!el.isConnected) {
        ov.style.display = 'none';
        continue;
      }
      var r = el.getBoundingClientRect();
      if (!r.width && !r.height) {
        ov.style.display = 'none';
        continue;
      }
      ov.style.display = '';
      ov.style.top = r.top + window.scrollY + 'px';
      ov.style.left = r.left + window.scrollX + 'px';
      ov.style.width = r.width + 'px';
      ov.style.height = r.height + 'px';
    }
  }

  window.addEventListener('scroll', repositionAll, true);
  window.addEventListener('resize', repositionAll);

  function renumber() {
    rebuildOverlays();
  }

  function clearSelected() {
    for (var i = 0; i < selectedEls.length; i++) {
      selectedEls[i].classList.remove('nf-blaze-selected');
    }
    selectedEls = [];
    destroyOverlays();
  }

  function deselectAt(index) {
    var el = selectedEls[index];
    if (!el) return;
    el.classList.remove('nf-blaze-selected');
    selectedEls.splice(index, 1);
    rebuildOverlays();
  }

  function postSelection() {
    try {
      window.parent.postMessage(
        { type: 'nf-blaze:selection-changed', elements: selectedEls.map(payloadFrom) },
        '*'
      );
    } catch (_) {}
  }

  function findTagged(el) {
    var cur = el;
    while (cur && cur !== document.documentElement) {
      if (cur.getAttribute && cur.getAttribute(ATTR_FILE)) return cur;
      cur = cur.parentElement;
    }
    // Fallback: אלמנט לא מתויג (פרויקט מיובא / HTML סטטי) — עדיין ניתן לבחירה
    if (el && el.nodeType === 1 && el !== document.documentElement && el !== document.body) {
      return el;
    }
    return null;
  }

  function cssPath(el) {
    var parts = [];
    var cur = el;
    while (cur && cur.nodeType === 1 && cur !== document.body && parts.length < 6) {
      var part = cur.tagName.toLowerCase();
      if (cur.id) {
        parts.unshift(part + '#' + cur.id);
        break;
      }
      var cls = (cur.className && typeof cur.className === 'string')
        ? cur.className.trim().split(/\s+/).filter(function (c) {
            return c && c.indexOf('nf-blaze-') !== 0;
          }).slice(0, 2)
        : [];
      if (cls.length) part += '.' + cls.join('.');
      var parent = cur.parentElement;
      if (parent) {
        var same = Array.prototype.filter.call(parent.children, function (ch) {
          return ch.tagName === cur.tagName;
        });
        if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(cur) + 1) + ')';
      }
      parts.unshift(part);
      cur = parent;
    }
    return parts.join(' > ');
  }

  function payloadFrom(el) {
    var text = '';
    try {
      text = (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    } catch (_) {}
    return {
      file: el.getAttribute(ATTR_FILE) || '',
      line: Number(el.getAttribute(ATTR_LINE) || 0) || 0,
      component: el.getAttribute(ATTR_COMP) || '',
      tag: (el.tagName || '').toLowerCase(),
      selector: cssPath(el),
      text: text
    };
  }

  function setEnabled(next) {
    enabled = !!next;
    ensureStyle();
    document.documentElement.classList.toggle('nf-blaze-selecting', enabled);
    if (!enabled) {
      clearHover();
    }
  }

  window.addEventListener('message', function (ev) {
    var data = ev.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'nf-blaze:set-select-mode') {
      setEnabled(!!data.enabled);
    }
    if (data.type === 'nf-blaze:clear-selection') {
      clearSelected();
      postSelection();
    }
    if (data.type === 'nf-blaze:deselect-index' && typeof data.index === 'number') {
      deselectAt(data.index);
      postSelection();
    }
    // שחזור הדגשות אחרי טעינה מחדש (HMR / שינוי של הסוכן) — לפי selector
    if (data.type === 'nf-blaze:apply-selection' && Array.isArray(data.selectors)) {
      ensureStyle();
      clearSelected();
      for (var s = 0; s < data.selectors.length; s++) {
        var sel = data.selectors[s];
        if (typeof sel !== 'string' || !sel) continue;
        var found = null;
        try {
          found = document.querySelector(sel);
        } catch (_) {}
        if (found && selectedEls.indexOf(found) === -1) {
          found.classList.add('nf-blaze-selected');
          selectedEls.push(found);
        }
      }
      rebuildOverlays();
      postSelection();
    }
  });

  // --- Runtime error reporting to the NF-Blaze parent ---
  var reportedErrors = [];
  function reportRuntimeError(message, source) {
    var msg = String(message || 'Unknown error').slice(0, 2000);
    if (reportedErrors.indexOf(msg) !== -1) return; // dedup
    if (reportedErrors.length >= 5) return; // throttle per page load
    reportedErrors.push(msg);
    try {
      window.parent.postMessage(
        { type: 'nf-blaze:runtime-error', message: msg, source: String(source || '') },
        '*'
      );
    } catch (_) {}
  }
  window.addEventListener('error', function (e) {
    var detail = (e.error && e.error.stack) || e.message || 'Unknown error';
    var src = e.filename ? e.filename + ':' + (e.lineno || 0) : '';
    reportRuntimeError(detail, src);
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason;
    reportRuntimeError('Unhandled promise rejection: ' + ((r && r.stack) || String(r)), '');
  });

  document.addEventListener(
    'mousemove',
    function (e) {
      if (!enabled) return;
      var tagged = findTagged(e.target);
      if (tagged === hoverEl) return;
      clearHover();
      if (tagged && selectedEls.indexOf(tagged) === -1) {
        tagged.classList.add('nf-blaze-hover');
        hoverEl = tagged;
      }
    },
    true
  );

  document.addEventListener(
    'click',
    function (e) {
      if (!enabled) return;
      // לחיצה על ה-✕ של הסימון — לא בחירה חדשה
      if (e.target && e.target.className === 'nf-blaze-ov-x') return;
      var tagged = findTagged(e.target);
      if (!tagged) return;
      e.preventDefault();
      e.stopPropagation();
      clearHover();
      var existing = selectedEls.indexOf(tagged);
      if (existing !== -1) {
        // לחיצה על אלמנט שכבר נבחר — הסרה מהבחירה
        deselectAt(existing);
      } else {
        tagged.classList.add('nf-blaze-selected');
        selectedEls.push(tagged);
        rebuildOverlays();
      }
      postSelection();
    },
    true
  );

  try {
    window.parent.postMessage({ type: 'nf-blaze:select-ready' }, '*');
  } catch (_) {}
})();
`
