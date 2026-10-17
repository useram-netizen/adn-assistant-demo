/*
 * ADN assistant embed script. Plain JS, no dependencies; see the README section "Embedding".
 *
 * The server minifies this file and fills in __ADN_EMBED_CONFIG__ when serving /embed.js,
 * and the served file must stay under 5 KB (a test checks it). Keep the syntax ES2017 or
 * older: it runs on other people's pages, in whatever browser their visitors use.
 */
(function () {
  'use strict';

  // { base: the PUBLIC_BASE_URL origin, t: { bubble, close, title } wording from copy.ts }
  var C = __ADN_EMBED_CONFIG__;
  var BASE = C.base;
  var Z = 2147483000;
  var ACCENT = '#296e79';
  var FONT = 'system-ui,sans-serif';
  // Every element starts from this, whatever the host page's CSS says.
  var RESET = 'box-sizing:border-box;margin:0;padding:0;border:0;';
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
    return css(el, RESET + (rules || ''));
  }

  // A visible focus ring for keyboard users, even when the host page's CSS removes outlines.
  function ring(el) {
    el.onfocus = function () {
      if (el.matches(':focus-visible'))
        css(el, 'outline:3px solid ' + ACCENT + ';outline-offset:2px');
    };
    el.onblur = function () {
      css(el, 'outline:none');
    };
    return el;
  }

  // Messages are used only if they come from PUBLIC_BASE_URL's origin and from one of the
  // iframes this script created.
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (e.origin !== BASE || !d || !d.type) return;
    frames.forEach(function (x) {
      if (x.f.contentWindow === e.source) x.on(d);
    });
  });

  function frame(o, mode, onMessage) {
    var f = make(
      'iframe',
      {
        src: BASE + '/widget?site=' + encodeURIComponent(o.site) + '&mode=' + mode,
        title: C.t.title,
      },
      'display:block;width:100%',
    );
    frames.push({ f: f, on: onMessage });
    return f;
  }

  // Inline mode: an iframe at 100% width inside the target element.
  function inline(o, script) {
    var host = document.getElementById(o.target);
    var parent = script.parentNode;
    if (!host) {
      // The page editor dropped the target div: put the widget where the script is.
      host = make('div', { id: o.target });
      if (parent && parent !== document.head) parent.insertBefore(host, script);
      else document.body.appendChild(host);
    }
    if (host.getAttribute('data-adn-embed')) return; // already embedded here
    host.setAttribute('data-adn-embed', 'inline');

    var wanted = 0;
    var lastHeight = innerHeight;
    var f = frame(o, 'inline', function (d) {
      if (
        d.type === 'adn:resize' &&
        typeof d.height == 'number' &&
        d.height > 0 &&
        d.height < 1e5
      ) {
        wanted = d.height;
        fit(1);
      }
    });
    // Follow the widget's height, up to the window's height (with a 320 px minimum), so the
    // newest message stays in view; past that the conversation scrolls inside the widget.
    function fit(fromWidget) {
      if (!wanted) return;
      var before = f.offsetHeight;
      css(f, 'height:' + Math.round(Math.max(320, Math.min(wanted, innerHeight - 24))) + 'px');
      // While the visitor is using the widget, keep its bottom edge (the newest message) on
      // screen, without pushing its top out of view. Never for window resizes.
      var r = f.getBoundingClientRect();
      if (fromWidget && document.activeElement === f && f.offsetHeight > before && r.top > 0) {
        var below = r.bottom - innerHeight + 12;
        if (below > 0) scrollBy(0, Math.min(below, r.top));
      }
    }
    // Close to the welcome step's height, so the page below barely moves when it arrives.
    host.appendChild(css(f, 'height:' + (host.clientWidth < 480 ? 530 : 430) + 'px'));
    // Mobile toolbars change the window height while scrolling: ignore small changes.
    addEventListener('resize', function () {
      if (Math.abs(innerHeight - lastHeight) > 100) {
        lastHeight = innerHeight;
        fit();
      }
    });
  }

  // Bubble mode: a floating button that opens the widget in a panel.
  function bubble(o) {
    if (document.getElementById('adn-bubble')) return; // one bubble per page
    var open = false;
    var full = false;
    var f = null;
    var saved = null;
    var root = document.documentElement.style;
    var mq = window.matchMedia && matchMedia('(max-width:480px),(max-height:500px)');

    var btn = ring(
      make(
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
          ';padding:14px 22px;width:auto;min-height:48px;border-radius:99px;background:' +
          ACCENT +
          ';color:#fff;font:600 16px/1.2 ' +
          FONT +
          ';text-transform:none;box-shadow:0 6px 20px #1428323f;cursor:pointer',
      ),
    );
    btn.textContent = C.t.bubble;

    var panel = make('div', { id: 'adn-panel', role: 'dialog', 'aria-label': C.t.title });

    var close = ring(
      make(
        'button',
        { type: 'button', 'aria-label': C.t.close },
        'position:absolute;top:12px;right:12px;z-index:2;width:40px;height:40px;' +
          'border-radius:50%;background:#fff;color:#1e2b30;font:28px/40px ' +
          FONT +
          ';cursor:pointer',
      ),
    );
    close.textContent = '×';

    // When the panel is full screen it is modal: these two keep Tab inside it.
    function guard(target) {
      var el = make('span', {}, 'position:absolute');
      el.onfocus = function () {
        (target() || close).focus();
      };
      return el;
    }
    var first = guard(function () {
      return f;
    });
    var last = guard(function () {
      return close;
    });
    panel.appendChild(first);
    panel.appendChild(close);

    // Full screen on phones and short screens, a 400x640 panel elsewhere. Full screen, the
    // panel is modal and the host page behind it doesn't scroll. The panel has the widget's
    // background colour, so it isn't blank white while the widget loads.
    function layout() {
      full = !!(mq && mq.matches);
      var modal = open && full;
      panel.style.cssText = '';
      css(
        panel,
        RESET +
          'position:fixed;z-index:' +
          (Z + 1) +
          ';background:#fdfaf4;overflow:hidden;box-shadow:0 12px 40px #14283247;display:' +
          (open ? 'block;' : 'none;') +
          (full
            ? 'top:0;left:0;width:100%;height:100%'
            : 'right:20px;bottom:88px;width:400px;height:640px;max-width:calc(100vw - 40px);max-height:calc(100vh - 108px);border-radius:16px'),
      );
      css(btn, 'visibility:' + (modal ? 'hidden' : 'visible'));
      panel.setAttribute('aria-modal', modal);
      first.tabIndex = last.tabIndex = modal ? 0 : -1;
      if (modal) {
        if (!saved) {
          saved = ['overflow-x', 'overflow-y'].map(function (p) {
            return [p, root.getPropertyValue(p), root.getPropertyPriority(p)];
          });
        }
        saved.forEach(function (s) {
          root.setProperty(s[0], 'hidden');
        });
      } else if (saved) {
        // Put back exactly what the host page had.
        saved.forEach(function (s) {
          if (s[1]) root.setProperty(s[0], s[1], s[2]);
          else root.removeProperty(s[0]);
        });
        saved = null;
      }
    }

    function toggle(show) {
      if (show && !f) {
        // Created on first open, then kept, so closing and reopening keeps the conversation.
        f = frame(o, 'bubble', function (d) {
          if (d.type === 'adn:close' && open) toggle(false);
        });
        panel.appendChild(css(f, 'height:100%'));
        panel.appendChild(last);
      }
      open = show;
      btn.setAttribute('aria-expanded', open);
      layout();
      (open ? close : btn).focus();
    }

    btn.onclick = function () {
      toggle(!open);
    };
    close.onclick = function () {
      toggle(false);
    };
    // Esc on the host page, when the visitor is in the panel or on the button (or the panel
    // covers the page). Esc inside the widget arrives as an "adn:close" message.
    document.addEventListener('keydown', function (e) {
      var a = document.activeElement;
      if (
        open &&
        e.key === 'Escape' &&
        !e.defaultPrevented &&
        (full || a === btn || panel.contains(a))
      ) {
        toggle(false);
      }
    });
    if (mq && mq.addEventListener) mq.addEventListener('change', layout);

    layout();
    document.body.appendChild(panel);
    document.body.appendChild(btn);
  }

  // Settings come from data-* attributes, or from the script's URL
  // (embed.js?mode=bubble&site=...) in case a page editor strips data attributes.
  function settings(script) {
    var data = script.dataset || {};
    var query = new URLSearchParams(script.src.split('?')[1]);
    return {
      target: data.target || query.get('target'),
      site: data.site || query.get('site'),
      mode: data.mode || query.get('mode'),
    };
  }

  function init(script) {
    var s = settings(script);
    var o = { target: s.target || 'adn-assistant', site: s.site || 'unknown' };
    if (s.mode === 'bubble') bubble(o);
    else inline(o, script);
  }

  // Page editors (or jQuery) sometimes re-insert the script, so this copy may not be the tag
  // with the settings. Use every one of our new tags that has settings; only when none has
  // any, use this one.
  function start() {
    var list = me ? [me] : [];
    var all = document.getElementsByTagName('script');
    for (var i = 0; i < all.length; i++) {
      if (all[i] !== me && all[i].src.indexOf(BASE + '/embed.js') === 0) list.push(all[i]);
    }
    list = list.filter(function (script) {
      return !script.adnDone;
    });
    var withSettings = list.filter(function (script) {
      var s = settings(script);
      return s.target || s.site || s.mode;
    });
    (withSettings.length ? withSettings : list.slice(0, 1)).forEach(init);
    list.forEach(function (script) {
      script.adnDone = true;
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
