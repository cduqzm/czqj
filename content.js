(() => {
  if (window.__czqjLoaded) return;
  window.__czqjLoaded = true;

  const root = document.documentElement;
  if (!root) return;

  const host = location.hostname || 'local';
  const SITE_KEY = 'site:' + host;
  const DEFAULTS = { defaultMode: 'dynamic', bg: '#141311', text: '#d6d1c4', dimImages: true };

  const ATTR = {
    'background-color': 'data-czqj-bg',
    'color': 'data-czqj-fg',
    'border-color': 'data-czqj-bd',
    'background-image': 'data-czqj-gr',
  };
  const ATTRS = Object.values(ATTR);
  const SKIP = new Set([
    'HEAD', 'SCRIPT', 'STYLE', 'LINK', 'META', 'TITLE', 'NOSCRIPT', 'TEMPLATE', 'BR',
    'IMG', 'PICTURE', 'SOURCE', 'VIDEO', 'AUDIO', 'CANVAS', 'IFRAME', 'EMBED', 'OBJECT',
  ]);

  function addStyle(css) {
    const s = document.createElement('style');
    s.className = 'czqj-style';
    s.textContent = css;
    root.appendChild(s);
    return s;
  }

  const flash = addStyle(`html,body{background:${DEFAULTS.bg} !important}`);

  chrome.storage.local.get(['settings', SITE_KEY], (data) => {
    const settings = { ...DEFAULTS, ...(data.settings || {}) };
    const site = data[SITE_KEY] || {};
    const mode = site.mode && site.mode !== 'default' ? site.mode : settings.defaultMode;
    const custom = site.css ? addStyle(site.css) : null;

    if (mode === 'off') {
      flash.remove();
      return;
    }
    flash.textContent = `html,body{background:${settings.bg} !important}`;

    whenReady(() => {
      flash.remove();
      if (pageIsAlreadyDark()) return;
      if (mode === 'filter') startFilter(settings);
      else startDynamic(settings);
      if (custom) root.appendChild(custom);
    });
  });

  function whenReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  }

  function pageIsAlreadyDark() {
    for (const el of [document.body, root]) {
      if (!el) continue;
      const c = parseColor(getComputedStyle(el).backgroundColor);
      if (c && c.a > 0.5) return lum(c) < 0.4;
    }
    return false;
  }

  function startFilter(settings) {
    const media = 'img:not(picture *),picture,video,canvas,iframe,embed,object,svg image,[style*="background-image"]';
    addStyle(
      `html{filter:invert(1) hue-rotate(180deg) contrast(.9) !important;background:#fff !important}` +
      `${media}{filter:invert(1) hue-rotate(180deg)${settings.dimImages ? ' brightness(.9)' : ''} !important}`
    );
  }

  function startDynamic(settings) {
    const { mapBg, mapFg, mapBorder } = makeMappers(settings);

    const base = addStyle(
      `:root{color-scheme:dark !important}` +
      `html{background-color:${settings.bg} !important;color:${settings.text} !important}` +
      (settings.dimImages ? `img,video{filter:brightness(.88)}` : '')
    );
    const sheet = base.sheet;

    const ids = new Map();
    function idFor(prop, value) {
      const key = prop + '|' + value;
      if (ids.has(key)) return ids.get(key);
      const id = String(ids.size);
      try {
        sheet.insertRule(`[${ATTR[prop]}="${id}"]{${prop}:${value} !important}`, sheet.cssRules.length);
      } catch (e) {
        ids.set(key, null);
        return null;
      }
      ids.set(key, id);
      return id;
    }

    function compute(el) {
      if (SKIP.has(el.tagName)) return null;
      if (el instanceof SVGElement && el.tagName.toLowerCase() !== 'svg') return null;
      const cs = getComputedStyle(el);
      const out = [];

      const bg = parseColor(cs.backgroundColor);
      if (bg && bg.a > 0) {
        const m = mapBg(bg);
        if (m) out.push(['background-color', m]);
      }

      const fg = parseColor(cs.color);
      if (fg) {
        const m = mapFg(fg);
        if (m) out.push(['color', m]);
      }

      for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
        if (parseFloat(cs[`border${side}Width`]) > 0) {
          const c = parseColor(cs[`border${side}Color`]);
          const m = c && mapBorder(c);
          if (m) out.push(['border-color', m]);
          break;
        }
      }

      const bi = cs.backgroundImage;
      if (bi && bi.includes('gradient')) {
        const m = bi.replace(/rgba?\([^)]+\)/g, (s) => {
          const c = parseColor(s);
          return (c && mapBg(c)) || s;
        });
        if (m !== bi) out.push(['background-image', m]);
      }

      return out.length ? out : null;
    }

    function run(items) {
      const els = [];
      for (const [el, deep] of items) {
        els.push(el);
        if (deep) for (const d of el.getElementsByTagName('*')) els.push(d);
      }
      for (const el of els) for (const a of ATTRS) if (el.hasAttribute(a)) el.removeAttribute(a);
      const results = els.map(compute);
      els.forEach((el, i) => {
        const r = results[i];
        if (!r) return;
        for (const [prop, value] of r) {
          const id = idFor(prop, value);
          if (id !== null) el.setAttribute(ATTR[prop], id);
        }
      });
    }

    run([[document.body || root, true]]);

    let queue = new Map();
    let scheduled = false;
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === 'childList') {
          for (const n of m.addedNodes) if (n.nodeType === 1) queue.set(n, true);
        } else {
          if (m.attributeName === 'style') {
            const now = m.target.getAttribute('style') || '';
            if (!/color|background|border/i.test(now + (m.oldValue || ''))) continue;
          }
          if (!queue.has(m.target)) queue.set(m.target, m.target.getElementsByTagName('*').length < 1500);
        }
      }
      if (queue.size && !scheduled) {
        scheduled = true;
        requestAnimationFrame(flush);
      }
    });

    function flush() {
      scheduled = false;
      const items = [...queue].filter(([el]) => el.isConnected && !SKIP.has(el.tagName));
      queue = new Map();
      const deepRoots = new Set(items.filter(([, d]) => d).map(([el]) => el));
      const top = items.filter(([el]) => {
        for (let p = el.parentElement; p; p = p.parentElement) if (deepRoots.has(p)) return false;
        return true;
      });
      if (top.length) run(top);
    }

    mo.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeOldValue: true,
      attributeFilter: ['class', 'style'],
    });

    window.addEventListener('load', () => run([[document.body || root, true]]), { once: true });
  }

  function makeMappers(settings) {
    const bg = rgbToHsl(hexToRgb(settings.bg));
    const fg = rgbToHsl(hexToRgb(settings.text));

    const mapBg = (c) => {
      if (lum(c) < 0.45) return null;
      const h = rgbToHsl(c);
      const grey = h.s < 0.2;
      const l = Math.min(bg.l + (1 - h.l) * 0.45, 0.4);
      return toCss({ ...hslToRgb(grey ? bg.h : h.h, grey ? bg.s : Math.min(h.s, 0.55), l), a: c.a });
    };

    const mapFg = (c) => {
      if (lum(c) >= 0.5) return null;
      const h = rgbToHsl(c);
      if (h.s < 0.25) {
        return toCss({ ...hslToRgb(fg.h, fg.s, Math.max(fg.l - h.l * 0.35, 0.55)), a: c.a });
      }
      return toCss({ ...hslToRgb(h.h, Math.min(h.s, 0.85), 0.72 + (0.5 - Math.min(h.l, 0.5)) * 0.25), a: c.a });
    };

    const mapBorder = (c) => {
      if (lum(c) < 0.45) return null;
      const h = rgbToHsl(c);
      const grey = h.s < 0.2;
      const l = Math.min(bg.l + 0.1 + (1 - h.l) * 0.35, 0.5);
      return toCss({ ...hslToRgb(grey ? bg.h : h.h, grey ? bg.s : Math.min(h.s, 0.5), l), a: c.a });
    };

    return { mapBg, mapFg, mapBorder };
  }

  function parseColor(str) {
    const m = /^rgba?\(([^)]+)\)$/.exec(str);
    if (!m) return null;
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (p.length < 3 || p.some(Number.isNaN)) return null;
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }

  function lum({ r, g, b }) {
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }

  function hexToRgb(hex) {
    const n = parseInt(hex.replace('#', ''), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  function rgbToHsl({ r, g, b }) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return { h: 0, s: 0, l };
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return { h: h / 6, s, l };
  }

  function hslToRgb(h, s, l) {
    if (s === 0) return { r: l * 255, g: l * 255, b: l * 255 };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const f = (t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    return { r: f(h + 1 / 3) * 255, g: f(h) * 255, b: f(h - 1 / 3) * 255 };
  }

  function toCss({ r, g, b, a }) {
    r = Math.round(r); g = Math.round(g); b = Math.round(b);
    return a < 1 ? `rgba(${r}, ${g}, ${b}, ${+a.toFixed(3)})` : `rgb(${r}, ${g}, ${b})`;
  }
})();
