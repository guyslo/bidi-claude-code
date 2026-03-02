/* BIDI-FIX-START */
// BiDi Fix for Claude Code v1.0.0
// Overrides Claude Code's global * { direction:ltr; unicode-bidi:bidi-override }
// to restore proper bidirectional text rendering for Hebrew, Arabic, Persian & Yiddish.

;(function() {
  'use strict';

  if (window.__BIDI_FIX_LOADED__) return;
  window.__BIDI_FIX_LOADED__ = true;

  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------

  var RTL_THRESHOLD = 0.3;
  var RTL_THRESHOLD_LOW = 0.1;
  var DEBOUNCE_MS = 2000;
  var MAX_ERRORS = 50;
  var PROCESSED_ATTR = 'data-bidi';
  var RTL_RE = /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
  var PUNCT_RE = /[\s\n\r\t.,!?;:\-_(){}\[\]'"\/\\@#$%^&*+=<>~`|0-9]/g;

  // ---------------------------------------------------------------------------
  // Error handling
  // ---------------------------------------------------------------------------

  var errorCount = 0;

  function safe(fn, context) {
    try {
      return fn();
    } catch (err) {
      errorCount++;
      if (errorCount <= 5) {
        console.error('BiDi Fix:', context, err);
      } else if (errorCount === MAX_ERRORS) {
        console.warn('BiDi Fix: Too many errors, suppressing further logs.');
      }
    }
  }

  // ---------------------------------------------------------------------------
  // RTL detection
  // ---------------------------------------------------------------------------

  // Get text content excluding code blocks (pre/code) which are always English
  function getTextExcludingCode(el) {
    if (typeof el === 'string') return el;
    var clone = el.cloneNode(true);
    var codeBlocks = clone.querySelectorAll('pre, code');
    for (var i = 0; i < codeBlocks.length; i++) {
      codeBlocks[i].remove();
    }
    return clone.textContent || '';
  }

  function getRTLRatio(text) {
    if (!text) return 0;
    var clean = text.replace(PUNCT_RE, '');
    if (clean.length === 0) return 0;
    var rtl = 0;
    for (var i = 0; i < clean.length; i++) {
      if (RTL_RE.test(clean[i])) rtl++;
    }
    return rtl / clean.length;
  }

  function isRTLText(text) {
    return getRTLRatio(text) > RTL_THRESHOLD;
  }

  function hasAnyRTL(text) {
    return RTL_RE.test(text || '');
  }

  // Hysteresis: once RTL, only flip back to LTR if ratio drops below a low threshold
  function shouldBeRTL(text, currentlyRTL) {
    var ratio = getRTLRatio(text);
    if (currentlyRTL) {
      return ratio > RTL_THRESHOLD_LOW;
    }
    return ratio > RTL_THRESHOLD;
  }

  // ---------------------------------------------------------------------------
  // Direction setters
  // ---------------------------------------------------------------------------

  function setRTL(el) {
    el.setAttribute('dir', 'rtl');
    el.style.direction = 'rtl';
    el.style.textAlign = 'right';
    el.style.unicodeBidi = 'embed';
  }

  function setLTR(el) {
    if (el.getAttribute('dir') === 'rtl') {
      el.removeAttribute('dir');
      el.style.direction = '';
      el.style.textAlign = '';
      el.style.unicodeBidi = '';
    }
  }

  function setTableRTL(table) {
    table.setAttribute('dir', 'rtl');
    table.style.direction = 'rtl';
    table.style.unicodeBidi = 'embed';
    table.style.marginLeft = 'auto';
    table.style.marginRight = '0';
  }

  function setListRTL(list) {
    list.setAttribute('dir', 'rtl');
    list.style.direction = 'rtl';
    list.style.unicodeBidi = 'embed';
    list.style.paddingRight = '2em';
    list.style.paddingLeft = '0';
  }

  // ---------------------------------------------------------------------------
  // Content version tracking — skip re-processing unchanged elements
  // ---------------------------------------------------------------------------

  function getContentHash(el) {
    return (el.textContent || '').length + ':' + (el.childElementCount || 0);
  }

  function needsProcessing(el) {
    var hash = getContentHash(el);
    if (el.getAttribute(PROCESSED_ATTR) === hash) return false;
    el.setAttribute(PROCESSED_ATTR, hash);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Main processing
  // ---------------------------------------------------------------------------

  function processAll() {
    // 1. Block text elements — set direction based on content ratio (with hysteresis)
    safe(function() {
      var els = document.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, td, th, blockquote');
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        if (el.closest('pre, code')) continue;
        if (!needsProcessing(el)) continue;
        var text = getTextExcludingCode(el);
        if (!text.trim()) continue;
        var currentlyRTL = el.getAttribute('dir') === 'rtl';
        if (shouldBeRTL(text, currentlyRTL)) {
          setRTL(el);
        } else {
          setLTR(el);
        }
      }
    }, 'block elements');

    // 2. Lists — move bullets to right side for RTL content
    safe(function() {
      var lists = document.querySelectorAll('ul, ol');
      for (var i = 0; i < lists.length; i++) {
        var list = lists[i];
        if (list.closest('pre, code')) continue;
        if (!needsProcessing(list)) continue;
        var currentlyRTL = list.getAttribute('dir') === 'rtl';
        if (shouldBeRTL(getTextExcludingCode(list), currentlyRTL)) {
          setListRTL(list);
        }
      }
    }, 'lists');

    // 3. Tables — set direction and right-align for RTL content
    safe(function() {
      var tables = document.querySelectorAll('table');
      for (var i = 0; i < tables.length; i++) {
        var table = tables[i];
        if (table.closest('pre, code')) continue;
        if (!needsProcessing(table)) continue;
        var currentlyRTL = table.getAttribute('dir') === 'rtl';
        if (shouldBeRTL(getTextExcludingCode(table), currentlyRTL)) {
          setTableRTL(table);
        }
      }
    }, 'tables');

    // 4. User message bubbles — right-align for RTL
    safe(function() {
      var containers = document.querySelectorAll('[class*="userMessageContainer_"]');
      for (var i = 0; i < containers.length; i++) {
        var container = containers[i];
        if (!needsProcessing(container)) continue;
        if (!isRTLText(getTextExcludingCode(container))) continue;
        container.style.alignItems = 'flex-end';
        container.style.textAlign = 'right';
        var bubble = container.querySelector('[class*="userMessage_"]');
        if (bubble) {
          bubble.style.direction = 'rtl';
          bubble.style.textAlign = 'right';
          bubble.style.unicodeBidi = 'embed';
        }
      }
    }, 'user bubbles');

    // 5. Heading context (forward): RTL heading → force following elements RTL
    safe(function() {
      var headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
      for (var i = 0; i < headings.length; i++) {
        var heading = headings[i];
        if (heading.getAttribute('dir') !== 'rtl') continue;
        var next = heading.nextElementSibling;
        while (next) {
          if (/^H[1-6]$/.test(next.tagName)) break;
          if (next.tagName === 'TABLE') {
            setTableRTL(next);
          } else if (next.tagName === 'UL' || next.tagName === 'OL') {
            setListRTL(next);
          } else {
            var text = getTextExcludingCode(next);
            if (text.trim() && isRTLText(text) && next.getAttribute('dir') !== 'rtl') {
              setRTL(next);
            }
          }
          next = next.nextElementSibling;
        }
      }
    }, 'heading context forward');

    // 6. Heading context (reverse): LTR heading with any RTL chars →
    //    flip to RTL if next sibling also has RTL content
    safe(function() {
      var headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
      for (var i = 0; i < headings.length; i++) {
        var heading = headings[i];
        if (heading.getAttribute('dir') === 'rtl') continue;
        if (!hasAnyRTL(heading.textContent)) continue;
        var next = heading.nextElementSibling;
        if (!next) continue;
        if (hasAnyRTL(getTextExcludingCode(next))) {
          setRTL(heading);
        }
      }
    }, 'heading context reverse');
  }

  // ---------------------------------------------------------------------------
  // Observer with debounce
  // ---------------------------------------------------------------------------

  var timer = null;

  function debouncedProcess() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(function() {
      timer = null;
      safe(processAll, 'processAll');
    }, DEBOUNCE_MS);
  }

  var observer = new MutationObserver(function(mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var m = mutations[i];
      if (m.addedNodes.length > 0 || m.type === 'characterData' || m.type === 'childList') {
        debouncedProcess();
        return;
      }
    }
  });

  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------

  function init() {
    safe(processAll, 'init');
    if (document.body) {
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
/* BIDI-FIX-END */
