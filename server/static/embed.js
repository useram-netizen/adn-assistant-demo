/*
 * ADN assistant embed script. Plain JS, no dependencies; see the README section "Embedding".
 *
 * The server minifies this file and fills in __ADN_EMBED_CONFIG__ when serving /embed.js,
 * so the served file stays under 5 KB. Keep the syntax ES2017 or older: it runs on other
 * people's pages, in whatever browser their visitors use.
 */
(function () {
  'use strict';

  // { base: the PUBLIC_BASE_URL origin, t: { bubble, close, title } wording from copy.ts }
  var C = __ADN_EMBED_CONFIG__;
  var BASE = C.base;
  var Z = 2147483000;
  var FONT = 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
  // Read now: document.currentScript is only set while this file first runs.
  var me = document.currentScript;
  var frames = [];

  // Sets styles through the CSSOM with !important. That is allowed under a strict host
  // Content-Security-Policy, and the host page's own CSS can't override it.
  function css(el, rules) {
    rules.split(';').forEach(function (rule) {
      var i = rule.indexOf(':');
      if (i > 0) el.style.setProperty(rule.slice(0, i), rule.slice(i + 1), 'important');
    });
    return el;
  }

  function make(tag, attrs, rules) {
    var el = document.createElement(tag);
    for (var k in attrs) el.setAttribute(k, attrs[k]);
    return css(el, rules || '');
  }

  // Messages are used only if they come from PUBLIC_BASE_URL's origin and from one of the
  // iframes this script created.
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (e.origin !== BASE || !d || typeof d.type !== 'string') return;
    frames.forEach(function (x) {
      if (x.f.contentWindow === e.source) x.on(d);
    });
  });

  function frame(o, mode, onMessage) {
    var src = BASE + '/widget?site=' + encodeURIComponent(o.site) + '&mode=' + mode;
    var f = make(
      'iframe',
      { src: src, title: C.t.title },
      'display:block;width:100%;max-width:100%;border:0;margin:0;padding:0',
    );
    frames.push({ f: f, on: onMessage });
    return f;
  }

  // Inline mode: an iframe at 100% width inside the target element.
  function inline(o, script) {
    var host = document.getElementById(o.target);
    var parent = script && script.parentNode;
    if (!host) {
      // The page editor dropped the target div: put the widget where the script is.
      host = make('div', { id: o.target });
      if (parent && parent !== document.head) parent.insertBefore(host, script);
      else document.body.appendChild(host);
    }
    if (host.getAttribute('data-adn-embed')) return; // already embedded here
    host.setAttribute('data-adn-embed', 'inline');

    var wanted = 0;
    var f = frame(o, 'inline', function (d) {
      if (
        d.type === 'adn:resize' &&
        typeof d.height === 'number' &&
        d.height > 0 &&
        d.height < 1e5
      ) {
        wanted = d.height;
        fit();
      }
    });
    // Follow the widget's height, but no taller than the window, so the newest message
    // stays in view; past that height the conversation scrolls inside the widget.
    function fit() {
      if (!wanted) return;
      var before = f.offsetHeight;
      var max = Math.max(400, window.innerHeight - 24);
      css(f, 'height:' + Math.round(Math.max(320, Math.min(wanted, max))) + 'px');
      // While the visitor is using the widget, keep its bottom edge (the newest message) on
      // screen, without pushing its top out of view.
      var r = f.getBoundingClientRect();
      if (document.activeElement === f && f.offsetHeight > before && r.top > 0) {
        var below = r.bottom - window.innerHeight + 12;
        if (below > 0) window.scrollBy(0, Math.min(below, r.top));
      }
    }
    host.appendChild(css(f, 'height:480px'));
    window.addEventListener('resize', fit);
  }

  // Bubble mode: a floating button that opens the widget in a panel.
  function bubble(o) {
    if (document.getElementById('adn-bubble')) return; // one bubble per page
    var open = false;
    var f = null;
    var savedOverflow = null;
    var root = document.documentElement.style;
    var mq = window.matchMedia && window.matchMedia('(max-width: 480px), (max-height: 500px)');

    var btn = make(
      'button',
      {
        type: 'button',
        id: 'adn-bubble',
        'aria-haspopup': 'dialog',
        'aria-expanded': 'false',
        'aria-controls': 'adn-panel',
      },
      'position:fixed;right:20px;bottom:20px;z-index:' +
        Z +
        ';margin:0;padding:14px 22px;width:auto;height:auto;min-height:48px;border:0;' +
        'border-radius:999px;background:#296e79;color:#fff;font:600 16px/1.2 ' +
        FONT +
        ';letter-spacing:normal;text-transform:none;box-shadow:0 6px 20px rgba(20,40,50,.25);cursor:pointer',
    );
    btn.textContent = C.t.bubble;

    var panel = make(
      'div',
      { id: 'adn-panel', role: 'dialog', 'aria-label': C.t.title },
      'display:none;position:fixed;z-index:' +
        (Z + 1) +
        ';margin:0;padding:0;border:0;background:#fff;overflow:hidden;box-shadow:0 12px 40px rgba(20,40,50,.28)',
    );

    var close = make(
      'button',
      { type: 'button', 'aria-label': C.t.close },
      'position:absolute;top:12px;right:12px;z-index:1;width:40px;height:40px;margin:0;padding:0;border:0;' +
        'border-radius:50%;background:#fff;color:#1e2b30;font:400 28px/40px ' +
        FONT +
        ';text-align:center;cursor:pointer',
    );
    close.textContent = '×';
    panel.appendChild(close);

    // Full screen on phones and short screens, a 400x640 panel elsewhere. While the panel
    // is full screen, the host page behind it doesn't scroll.
    function layout() {
      var full = !!(mq && mq.matches);
      css(
        panel,
        full
          ? 'top:0;right:0;bottom:0;left:0;width:100%;height:100%;max-width:none;max-height:none;border-radius:0'
          : 'top:auto;left:auto;right:20px;bottom:88px;width:400px;height:640px;' +
              'max-width:calc(100vw - 40px);max-height:calc(100vh - 108px);border-radius:16px',
      );
      if (open && full) {
        if (savedOverflow === null) savedOverflow = root.overflow;
        root.overflow = 'hidden';
      } else if (savedOverflow !== null) {
        root.overflow = savedOverflow;
        savedOverflow = null;
      }
    }

    function show() {
      if (!f) {
        // Created on first open, then kept, so closing and reopening keeps the conversation.
        f = frame(o, 'bubble', function (d) {
          if (d.type === 'adn:close') hide();
        });
        panel.appendChild(css(f, 'height:100%'));
      }
      open = true;
      css(panel, 'display:block');
      btn.setAttribute('aria-expanded', 'true');
      layout();
      close.focus();
    }

    function hide() {
      if (!open) return;
      open = false;
      css(panel, 'display:none');
      btn.setAttribute('aria-expanded', 'false');
      layout();
      btn.focus();
    }

    btn.onclick = function () {
      if (open) hide();
      else show();
    };
    close.onclick = hide;
    // Esc on the host page. Esc inside the widget arrives as an "adn:close" message.
    document.addEventListener('keydown', function (e) {
      if (open && (e.key === 'Escape' || e.key === 'Esc')) hide();
    });
    if (mq && mq.addEventListener) mq.addEventListener('change', layout);
    else if (mq && mq.addListener) mq.addListener(layout);

    document.body.appendChild(panel);
    document.body.appendChild(btn);
  }

  // Settings come from data-* attributes, or from the script's URL
  // (embed.js?mode=bubble&site=...) in case a page editor strips data attributes.
  function init(script) {
    if (!script || script.adnDone) return;
    script.adnDone = true;
    var data = script.dataset || {};
    var query = {};
    try {
      new URL(script.src).searchParams.forEach(function (value, key) {
        query[key] = value;
      });
    } catch (e) {
      // an inline script has no src
    }
    var o = {
      target: data.target || query.target || 'adn-assistant',
      site: data.site || query.site || 'unknown',
    };
    if ((data.mode || query.mode) === 'bubble') bubble(o);
    else inline(o, script);
  }

  // Some page editors re-insert scripts, so that document.currentScript is not the tag
  // that carries the settings. Look for our other script tags too.
  function start() {
    init(me);
    var scripts = document.getElementsByTagName('script');
    for (var i = 0; i < scripts.length; i++) {
      if (scripts[i].src.indexOf(BASE + '/embed.js') === 0) init(scripts[i]);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
