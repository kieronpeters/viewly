#!/usr/bin/env node
/**
 * REA surface capture harness — Flow: home (YouTube public, signed out).
 *
 * One Chrome instance per run, one viewport, one page load. It records:
 *   - DOM structure, accessibility tree, screenshots per state
 *   - network requests (path + param names only, values redacted) and console/log records
 *   - navigation/paint/LCP/CLS/long-task timings
 *   - computed styles for named components (appearance parity input)
 *   - keyboard focus walk, hover/menu/chip/scroll interaction latencies
 *   - loading (request held), error (browse endpoint blocked), offline (warm + cold),
 *     reduced-motion states
 *
 * Guardrails: public pages only, no credentials, no media, no protected surfaces.
 * Cookies and auth headers are never requested from the browser. All output stays
 * under docs/re-evidence/ (git-ignored).
 *
 * Usage:
 *   node capture.mjs --width 1280 --height 800 --out docs/re-evidence/home/1280/r1
 *   node capture.mjs --width 390 --height 844 --out ... --steps baseline,styles,keyboard
 */

import { spawn } from "node:child_process";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  openSync,
  closeSync,
} from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";

const CHROME =
  process.env.REA_CHROME || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const FLOW = "home";
const START_URL = process.env.REA_START_URL || "https://www.youtube.com/";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const k = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[k] = next;
      i++;
    } else out[k] = "true";
  }
  return out;
}

function redact(text) {
  return String(text ?? "")
    .replace(/AIza[0-9A-Za-z_-]{10,}/g, "\u2039redacted-key\u203a")
    .replace(/eyJ[A-Za-z0-9._-]{20,}/g, "\u2039redacted-token\u203a")
    .replace(/\b[A-Za-z0-9_-]{80,}\b/g, "\u2039redacted-opaque\u203a")
    .slice(0, 400);
}

/** Keep path and parameter names; drop every parameter value. */
function safeUrl(raw) {
  try {
    if (String(raw).startsWith("data:")) {
      const mime = String(raw).slice(5).split(/[;,]/)[0] || "unknown";
      return `data:${mime};base64,<redacted>`;
    }
    const u = new URL(raw);
    const names = [...new Set([...u.searchParams.keys()])];
    const suffix = names.length ? "?" + names.map((n) => n + "=\u2026").join("&") : "";
    return u.origin + u.pathname + suffix;
  } catch {
    return redact(raw).slice(0, 200);
  }
}

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

// ---------------------------------------------------------------------------
// minimal CDP client
// ---------------------------------------------------------------------------

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    this.handlers = new Set();
    ws.addEventListener("message", (ev) => {
      let msg;
      try {
        msg = JSON.parse(typeof ev.data === "string" ? ev.data : ev.data.toString());
      } catch {
        return;
      }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code})`));
        else resolve(msg.result);
        return;
      }
      for (const h of this.handlers) h(msg);
    });
  }

  send(method, params = {}, sessionId) {
    const id = ++this.seq;
    const promise = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return promise;
  }

  on(fn) {
    this.handlers.add(fn);
    return () => this.handlers.delete(fn);
  }

  waitFor(method, predicate = () => true, timeout = 20000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new Error(`timeout waiting for ${method}`));
      }, timeout);
      const off = this.on((msg) => {
        if (msg.method !== method) return;
        if (!predicate(msg)) return;
        clearTimeout(timer);
        off();
        resolve(msg.params);
      });
    });
  }

  close() {
    try {
      this.ws.close();
    } catch {}
  }
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.addEventListener("open", () => resolve(ws), { once: true });
    ws.addEventListener("error", () => reject(new Error(`cannot connect ${url}`)), { once: true });
  });
}

// ---------------------------------------------------------------------------
// in-page instrumentation (installed before every document)
// ---------------------------------------------------------------------------

const PAGE_SCRIPT = String.raw`(() => {
  if (window.__rea) return;
  const S = { lcp: [], cls: 0, shifts: [], longtasks: [], errors: [] };
  const push = (arr, x) => { arr.push(x); if (arr.length > 200) arr.shift(); };

  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) push(S.lcp, { t: e.startTime, size: e.size, tag: e.element && e.element.tagName ? e.element.tagName.toLowerCase() : null, id: e.element && e.element.id ? e.element.id : null });
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch (e) {}
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) { if (e.hadRecentInput) continue; S.cls += e.value; push(S.shifts, { t: e.startTime, v: e.value }); }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch (e) {}
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) push(S.longtasks, { t: e.startTime, d: e.duration });
    }).observe({ type: 'longtask', buffered: true });
  } catch (e) {}
  window.addEventListener('error', (e) => push(S.errors, { msg: String(e.message).slice(0, 120) }));

  const rectOf = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  const textOf = (el, n) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, n || 70);
  const hashOf = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; };
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };

  S.snap = function (opts) {
    opts = opts || {};
    const max = opts.max || 14000, maxDepth = opts.depth || 60;
    const nodes = [];
    let truncated = false;
    const queue = [[document.documentElement, -1, 0]];
    while (queue.length) {
      if (nodes.length >= max) { truncated = true; break; }
      const item = queue.shift();
      const el = item[0], parent = item[1], depth = item[2];
      if (!el || el.nodeType !== 1) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const idx = nodes.length;
      let own = '';
      for (const c of el.childNodes) if (c.nodeType === 3) own += c.nodeValue;
      const r = el.getBoundingClientRect();
      nodes.push({
        i: idx, p: parent, d: depth,
        t: el.tagName.toLowerCase(),
        id: el.id || undefined,
        c: el.classList.length ? Array.from(el.classList).slice(0, 3).join(' ') : undefined,
        r: el.getAttribute('role') || undefined,
        a: el.getAttribute('aria-label') ? el.getAttribute('aria-label').slice(0, 60) : undefined,
        s: el.getAttribute('aria-selected') || undefined,
        x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
        tx: own.replace(/\s+/g, ' ').trim().slice(0, 80) || undefined
      });
      if (depth < maxDepth) for (const c of el.children) queue.push([c, idx, depth + 1]);
    }
    return { title: document.title, lang: document.documentElement.lang || null, nodes: nodes, truncated: truncated };
  };

  S.styles = function (selectors, limit) {
    limit = limit || 1;
    const out = [];
    for (const sel of selectors) {
      let els = [];
      try { els = Array.from(document.querySelectorAll(sel)).slice(0, limit); } catch (e) { out.push({ sel: sel, found: false }); continue; }
      if (!els.length) { out.push({ sel: sel, found: false }); continue; }
      for (const el of els) {
        const cs = getComputedStyle(el);
        const pick = {};
        for (const k of ['display','position','width','height','fontSize','fontFamily','fontWeight','lineHeight','letterSpacing','color','backgroundColor','backgroundImage','borderRadius','padding','margin','gap','rowGap','columnGap','overflow','textOverflow','webkitLineClamp','boxShadow','aspectRatio','gridTemplateColumns','border','outline','transition','animationName','animationDuration']) pick[k] = cs[k];
        out.push({ sel: sel, found: true, tag: el.tagName.toLowerCase(), id: el.id || null, cls: Array.from(el.classList).slice(0, 4).join(' '), box: rectOf(el), style: pick, text: textOf(el, 50) || null });
      }
    }
    return out;
  };

  S.tokens = function () {
    const cs = getComputedStyle(document.documentElement);
    const names = ['--yt-spec-base-background','--yt-spec-raised-background','--yt-spec-text-primary','--yt-spec-text-secondary','--yt-spec-brand-background-primary','--yt-spec-call-to-action','--yt-spec-badge-chip-background','--yt-spec-10-percent-layer','--yt-spec-general-background-a','--yt-spec-general-background-b'];
    const out = {};
    for (const n of names) { const v = cs.getPropertyValue(n).trim(); if (v) out[n] = v; }
    return { tokens: out, bodyBg: getComputedStyle(document.body).backgroundColor, htmlBg: cs.backgroundColor, font: cs.fontFamily.slice(0, 80), colorScheme: cs.colorScheme };
  };

  S.active = function () {
    const path = [];
    let host = document.activeElement;
    while (host) {
      const cs = getComputedStyle(host);
      path.push({ tag: host.tagName.toLowerCase(), id: host.id || null, cls: Array.from(host.classList).slice(0, 3).join(' '), role: host.getAttribute('role'), label: host.getAttribute('aria-label') ? host.getAttribute('aria-label').slice(0, 60) : null, text: textOf(host, 60) || null, box: rectOf(host), outline: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor, inShadow: !!host.shadowRoot });
      host = host.shadowRoot ? host.shadowRoot.activeElement : null;
    }
    return path;
  };

  S.cards = function () {
    return Array.from(document.querySelectorAll('ytd-rich-item-renderer, ytd-video-renderer, ytm-video-with-context-renderer, ytd-compact-video-renderer')).filter(visible).map((el) => ({ box: rectOf(el), tag: el.tagName.toLowerCase() }));
  };

  S.cardPoint = function (index) {
    const cards = Array.from(document.querySelectorAll('ytd-rich-item-renderer')).filter(visible);
    if (!cards.length) return null;
    const regular = cards.filter(function (c) {
      return !!Array.from(c.querySelectorAll('button')).find(function (b) {
        return /more actions|action menu/i.test(b.getAttribute('aria-label') || '');
      });
    });
    const pool = regular.length ? regular : cards;
    const card = pool[Math.min(index || 0, pool.length - 1)];
    const thumb = card.querySelector('a[href*="/watch"]') || card.querySelector('#thumbnail, ytd-thumbnail') || card;
    const r = thumb.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + Math.min(r.height / 2, 110)), card: rectOf(card), regular: regular.length };
  };

  S.linkPoint = function (sels, index) {
    index = index || 0;
    for (const sel of sels) {
      let els = [];
      try { els = Array.from(document.querySelectorAll(sel)).filter(visible); } catch (e) { continue; }
      if (els.length > index) {
        const r = els[index].getBoundingClientRect();
        return { x: Math.round(r.x + Math.min(r.width / 2, 220)), y: Math.round(r.y + Math.min(r.height / 2, 90)), sel: sel };
      }
    }
    return null;
  };

  S.hoverProbe = function () {
    const cards = Array.from(document.querySelectorAll('ytd-rich-item-renderer')).filter(visible);
    const regular = cards.filter(function (c) {
      return !!Array.from(c.querySelectorAll('button')).find(function (b) {
        return /more actions|action menu/i.test(b.getAttribute('aria-label') || '');
      });
    });
    const card = (regular.length ? regular : cards)[0] || null;
    if (!card) return { videos: 0, overlapping: 0, playing: false };
    const thumb = card.querySelector('a[href*="/watch"]') || card;
    const tr = thumb.getBoundingClientRect();
    const videos = Array.from(document.querySelectorAll('video')).filter(function (v) {
      return v.getBoundingClientRect().width > 0;
    });
    const overlapping = videos.filter(function (v) {
      const r = v.getBoundingClientRect();
      const w = Math.max(0, Math.min(r.right, tr.right) - Math.max(r.x, tr.x));
      const h = Math.max(0, Math.min(r.bottom, tr.bottom) - Math.max(r.y, tr.y));
      return w * h > 0.5 * Math.min(r.width * r.height, tr.width * tr.height);
    });
    const overlays = Array.from(card.querySelectorAll('*')).filter(function (e) {
      const id = e.id || '';
      const cls = typeof e.className === 'string' ? e.className : '';
      return /mouseover|preview/i.test(id + ' ' + cls);
    });
    return {
      videos: videos.length,
      overlapping: overlapping.length,
      playing: overlapping.some(function (v) {
        return !v.paused;
      }),
      muted: overlapping.length ? overlapping[0].muted : null,
      overlays: overlays.slice(0, 4).map(function (e) {
        return (e.id || '') + '/' + (typeof e.className === 'string' ? e.className.slice(0, 30) : '');
      }),
      domCount: document.querySelectorAll('*').length,
    };
  };

  S.menuPoint = function () {
    const cards = Array.from(document.querySelectorAll('ytd-rich-item-renderer')).filter(visible);
    for (const card of cards) {
      const btn = Array.from(card.querySelectorAll('button')).find(function (b) {
        return /more actions|action menu/i.test(b.getAttribute('aria-label') || '') && visible(b);
      });
      if (btn) {
        const r = btn.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), label: btn.getAttribute('aria-label') };
      }
    }
    return null;
  };

  S.popupState = function () {
    const popups = Array.from(document.querySelectorAll('ytd-menu-popup-renderer, tp-yt-paper-listbox, [role="menu"], ytd-popup-container')).filter(visible);
    const items = Array.from(document.querySelectorAll('ytd-menu-service-item-renderer, tp-yt-paper-item, [role="menuitem"]')).filter(visible);
    return { open: popups.length > 0 && items.length > 0, popups: popups.length, items: items.length, firstItem: items[0] ? textOf(items[0], 40) : null };
  };

  S.focusOrder = function () { return S.active(); };

  S.chips = function () {
    const els = Array.from(document.querySelectorAll('yt-chip-cloud-chip-renderer, ytd-feed-filter-chip-bar-renderer #chips *[role="tab"], iron-selector#chips > *')).filter(visible);
    return els.slice(0, 14).map((el, i) => ({ i: i, selected: el.getAttribute('aria-selected') === 'true' || el.hasAttribute('selected'), label: textOf(el, 24), box: rectOf(el) }));
  };

  S.bootChip = function () {
    const rail = document.querySelector('iron-selector#chips, #chips');
    if (rail) rail.scrollLeft = 0;
    const els = Array.from(document.querySelectorAll('yt-chip-cloud-chip-renderer')).filter(visible);
    const el =
      els.find(function (e) {
        const r = e.getBoundingClientRect();
        return !e.classList.contains('iron-selected') && e.getAttribute('aria-selected') !== 'true' && r.x >= 0 && r.right <= window.innerWidth;
      }) || els.find(function (e) { return !e.classList.contains('iron-selected'); });
    if (!el) return null;
    // Focus paging can scroll the rail; bring the target back into view before measuring.
    try { el.scrollIntoView({ block: 'nearest', inline: 'center' }); } catch (e) {}
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), label: textOf(el, 24), visible: r.x >= 0 && r.right <= window.innerWidth };
  };

  S.feedSignature = function () {
    const items = Array.from(document.querySelectorAll('ytd-rich-item-renderer')).filter(visible);
    const titles = items
      .map(function (c) {
        const a = Array.from(c.querySelectorAll('a[href*="/watch"]')).sort(function (x, y) {
          return y.innerText.length - x.innerText.length;
        })[0];
        return a ? a.innerText.trim().slice(0, 40) : '';
      })
      .filter(Boolean);
    return hashOf(titles.join('|')) + ':' + items.length;
  };

  S.scrollState = function () {
    return {
      cards: Array.from(document.querySelectorAll('ytd-rich-item-renderer')).filter(visible).length,
      scrollHeight: document.documentElement.scrollHeight,
      y: window.scrollY,
      spinner: !!document.querySelector('tp-yt-paper-spinner[active], ytd-continuation-item-renderer'),
    };
  };

  S.scrollToEnd = function () { window.scrollTo(0, document.documentElement.scrollHeight); return { y: window.scrollY, h: document.documentElement.scrollHeight }; };
  S.scrollTop = function () { window.scrollTo(0, 0); return window.scrollY; };

  S.guideBox = function () {
    const candidates = ['tp-yt-app-drawer#guide', '#guide', 'ytd-mini-guide-renderer', 'ytd-guide-renderer', 'ytm-pivot-bar-renderer', 'ytd-masthead'];
    const out = {};
    for (const sel of candidates) { const el = documented(sel); if (el) out[sel] = rectOf(el); }
    function documented(s) { try { return document.querySelector(s); } catch (e) { return null; } }
    return out;
  };

  S.chromeProbe = function () {
    const m = document.querySelector('ytd-masthead, #masthead-container, ytm-header-bar');
    const bottom = document.querySelector('ytm-pivot-bar-renderer, ytd-mini-guide-renderer, #bottom-bar, nav');
    const search = document.querySelector('input#search, ytd-searchbox input, #search-input input, input[name="search_query"]');
    const signIn = Array.from(document.querySelectorAll('a, button')).filter((e) => /sign in/i.test((e.getAttribute('aria-label') || '') + ' ' + (e.textContent || ''))).slice(0, 2).map((e) => ({ tag: e.tagName.toLowerCase(), box: rectOf(e) }));
    return { masthead: m ? rectOf(m) : null, bottomNav: bottom ? rectOf(bottom) : null, search: search ? rectOf(search) : null, signIn: signIn, scrollbar: window.innerWidth - document.documentElement.clientWidth };
  };

  S.findButtonByText = function (pattern) {
    const re = new RegExp(pattern, 'i');
    const els = Array.from(document.querySelectorAll('button, a, ytd-button-renderer, tp-yt-paper-button, [role="button"]')).filter(visible);
    const el = els.find((e) => re.test((e.getAttribute('aria-label') || '') + ' ' + (e.textContent || '')));
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), label: textOf(el, 40) };
  };

  S.bodyText = function () { return (document.body && document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 600); };

  S.animations = function () {
    let list = [];
    try { list = document.getAnimations(); } catch (e) { return { count: -1 }; }
    const names = {};
    for (const a of list.slice(0, 80)) { const n = (a.animationName || (a.effect && a.effect.getKeyframes && 'keyframes') || 'unknown'); names[n] = (names[n] || 0) + 1; }
    return { count: list.length, names: names, playStates: list.slice(0, 20).map((a) => a.playState) };
  };

  S.deepStyles = function () {
    const cards = Array.from(document.querySelectorAll('ytd-rich-item-renderer')).filter(visible);
    const csOf = function (el) {
      const c = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        tag: el.tagName.toLowerCase(),
        cls: (typeof el.className === 'string' ? el.className : '').slice(0, 70),
        box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        fontSize: c.fontSize,
        fontWeight: c.fontWeight,
        lineHeight: c.lineHeight,
        color: c.color,
        bg: c.backgroundColor,
        radius: c.borderRadius,
        padding: c.padding,
        margin: c.margin,
        gap: c.gap,
        clamp: c.webkitLineClamp,
        display: c.display,
        position: c.position,
        overflow: c.overflow,
        transitionDuration: c.transitionDuration,
        outline: c.outline,
      };
    };
    const out = { cards: cards.length, chips: [] };
    const card =
      cards.find(function (c) {
        return !!Array.from(c.querySelectorAll('button')).find(function (b) {
          return /more actions|action menu/i.test(b.getAttribute('aria-label') || '');
        });
      }) || cards[0];
    if (!card) return out;
    out.card = csOf(card);

    const img = card.querySelector('img');
    if (img) {
      out.thumb = csOf(img);
      let p = img.parentElement;
      let n = 0;
      while (p && p !== card && n < 5) {
        out['thumbParent' + n] = csOf(p);
        p = p.parentElement;
        n++;
      }
    }

    const textEls = Array.from(card.querySelectorAll('*')).filter(function (e) {
      return e.children.length === 0 && (e.innerText || '').trim().length > 0;
    });
    const badge = textEls.find(function (e) {
      return /^\d{1,2}:\d{2}(:\d{2})?$/.test((e.innerText || '').trim());
    });
    if (badge) out.badge = csOf(badge);

    const title = Array.from(card.querySelectorAll('a'))
      .filter(function (a) {
        return (a.innerText || '').trim().length > 12;
      })
      .sort(function (a, b) {
        return (b.innerText || '').length - (a.innerText || '').length;
      })[0];
    if (title) out.title = csOf(title);

    const meta = textEls.filter(function (e) {
      return /(views?|ago|watching)/i.test(e.innerText || '');
    });
    if (meta.length) out.meta = csOf(meta[meta.length - 1]);

    const avatar = card.querySelector('img[src*="yt3"], img[src*="ggpht"]');
    if (avatar) out.avatar = csOf(avatar);

    out.chips = Array.from(document.querySelectorAll('yt-chip-cloud-chip-renderer'))
      .filter(visible)
      .slice(0, 3)
      .map(function (c) {
        const inner = c.querySelector('button, div') || c;
        return { host: csOf(c), inner: csOf(inner), selected: c.classList.contains('iron-selected') };
      });

    const mh = document.querySelector('ytd-masthead');
    if (mh) out.masthead = csOf(mh);
    const searchBox = document.querySelector('#search-form, ytd-searchbox');
    if (searchBox) out.searchBox = csOf(searchBox);

    const pageEl = document.documentElement;
    out.page = {
      bg: getComputedStyle(pageEl).backgroundColor,
      font: getComputedStyle(pageEl).fontFamily,
      colorScheme: getComputedStyle(pageEl).colorScheme,
    };

    const sameRow = cards.filter(function (c) {
      return Math.abs(c.getBoundingClientRect().y - card.getBoundingClientRect().y) < 2;
    });
    if (sameRow.length > 1) out.rowGap = Math.round(sameRow[1].getBoundingClientRect().x - sameRow[0].getBoundingClientRect().right);
    if (cards.length > 1) out.verticalGap = Math.round(cards[cards.length - 1].getBoundingClientRect().y - cards[0].getBoundingClientRect().y);
    return out;
  };

  S.searchRows = function () {
    const classic = Array.from(document.querySelectorAll('ytd-video-renderer')).filter(function (r) {
      const b = r.getBoundingClientRect();
      return b.width > 250 && b.height > 80;
    });
    if (classic.length) return classic;
    return Array.from(document.querySelectorAll('yt-lockup-view-model')).filter(function (r) {
      const b = r.getBoundingClientRect();
      return b.width > 250 && b.height > 80 && !!r.querySelector('a[href*="/watch"]');
    });
  };

  S.resultSignature = function () {
    const rows = S.searchRows().slice(0, 8);
    const titles = rows.map(function (r) {
      const a = Array.from(r.querySelectorAll('a[href*="/watch"]')).sort(function (x, y) {
        return y.innerText.length - x.innerText.length;
      })[0];
      return a ? a.innerText.trim().slice(0, 40) : '';
    });
    return hashOf(titles.join('|')) + ':' + S.searchRows().length;
  };

  S.rowPoint = function (index) {
    const rows = S.searchRows();
    const row = rows[Math.min(index || 0, rows.length - 1)];
    if (!row) return null;
    const thumb = row.querySelector('#thumbnail, yt-thumbnail-view-model, a[href*="/watch"]');
    const r = (thumb || row).getBoundingClientRect();
    return { x: Math.round(r.x + Math.min(r.width / 2, 200)), y: Math.round(r.y + Math.min(r.height / 2, 90)), row: rectOf(row) };
  };

  S.filtersButton = function () {
    const els = Array.from(document.querySelectorAll('button, ytd-button-renderer, a')).filter(visible);
    const el = els.find(function (e) {
      const label = (e.getAttribute('aria-label') || '') + ' ' + (e.innerText || '');
      return /(^|\s)filters?(\s|$)/i.test(label.trim());
    });
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), label: (el.getAttribute('aria-label') || el.innerText || '').trim().slice(0, 40) };
  };

  S.filterDialog = function () {
    const dialogs = Array.from(document.querySelectorAll('tp-yt-paper-dialog, ytd-search-filter-group-renderer, [role="dialog"]')).filter(visible);
    const groups = Array.from(document.querySelectorAll('ytd-search-filter-group-renderer')).filter(visible);
    const buttons = Array.from(document.querySelectorAll('ytd-search-filter-renderer, tp-yt-paper-radio-button, [role="menuitemradio"], [role="radio"]')).filter(visible);
    return {
      open: dialogs.length > 0 || groups.length > 0,
      dialogs: dialogs.length,
      groups: groups.map(function (g) { return (g.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60); }),
      options: buttons.slice(0, 10).map(function (b) { return (b.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 24); }),
    };
  };

  S.showMore = function () {
    const candidates = Array.from(document.querySelectorAll('button, ytd-button-renderer, tp-yt-paper-button, a, div')).filter(function (e) {
      const b = e.getBoundingClientRect();
      return b.width > 0 && b.height > 0 && /^show more$/i.test((e.innerText || '').trim());
    });
    if (!candidates.length) return null;
    // Pick the innermost visible text element, then click its button ancestor.
    candidates.sort(function (a, b) {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      return ra.width * ra.height - rb.width * rb.height;
    });
    const clickable = candidates[0].closest('button, ytd-button-renderer, tp-yt-paper-button, a') || candidates[0];
    const r = clickable.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), label: (clickable.innerText || '').trim().slice(0, 30) };
  };

  S.searchDeep = function () {
    const rows = S.searchRows();
    const csOf = function (el) {
      const c = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        tag: el.tagName.toLowerCase(),
        cls: (typeof el.className === 'string' ? el.className : '').slice(0, 60),
        box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        fontSize: c.fontSize, fontWeight: c.fontWeight, lineHeight: c.lineHeight, color: c.color,
        bg: c.backgroundColor, radius: c.borderRadius, padding: c.padding, margin: c.margin,
        clamp: c.webkitLineClamp, display: c.display, overflow: c.overflow,
      };
    };
    const out = { rows: rows.length, first: null, chips: [], filters: null };
    const row = rows[0];
    if (row) {
      out.first = { row: csOf(row), thumb: null, title: null, meta: null, avatar: null, description: null };
      const thumb = row.querySelector('#thumbnail img, yt-thumbnail-view-model img, img');
      if (thumb) {
        out.first.thumb = csOf(thumb);
        const parent = thumb.closest('#thumbnail, yt-thumbnail-view-model') || thumb.parentElement;
        if (parent) out.first.thumbBox = csOf(parent);
      }
      const title = row.querySelector('a#video-title, #video-title, h3 a') ||
        Array.from(row.querySelectorAll('a')).sort(function (a, b) { return (b.innerText || '').length - (a.innerText || '').length; })[0];
      if (title) out.first.title = csOf(title);
      const meta = Array.from(row.querySelectorAll('#metadata-line span, span, div')).filter(function (e) {
        return e.children.length === 0 && /(views?|ago)/i.test(e.innerText || '');
      })[0];
      if (meta) out.first.meta = csOf(meta);
      const desc = row.querySelector('#description-text, ytd-expandable-metadata-renderer, .metadata-snippet-text');
      if (desc) out.first.description = csOf(desc);
      const avatar = row.querySelector('#channel-info img, yt-img-shadow img, img[src*="yt3"], img[src*="ggpht"]');
      if (avatar) out.first.avatar = csOf(avatar);
    }
    out.chips = Array.from(document.querySelectorAll('yt-chip-cloud-chip-renderer')).filter(visible).slice(0, 4).map(function (c) {
      return { host: csOf(c), selected: c.classList.contains('iron-selected'), label: (c.innerText || '').trim().slice(0, 24) };
    });
    const f = S.filtersButton();
    if (f) out.filters = f;
    const pageEl = document.documentElement;
    out.page = { bg: getComputedStyle(pageEl).backgroundColor, font: getComputedStyle(pageEl).fontFamily };
    return out;
  };

  S.channelTabs = function () {
    return Array.from(document.querySelectorAll('yt-tab-shape, tp-yt-paper-tab')).filter(visible).map(function (t, i) {
      return {
        i: i,
        label: (t.innerText || t.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 24),
        selected: t.getAttribute('aria-selected') === 'true' || t.hasAttribute('selected'),
        box: rectOf(t),
      };
    });
  };

  S.tabPoint = function (label) {
    const re = new RegExp('^' + label + '$', 'i');
    const tab = Array.from(document.querySelectorAll('yt-tab-shape, tp-yt-paper-tab')).filter(visible).find(function (t) {
      return re.test((t.innerText || t.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim());
    });
    if (!tab) return null;
    try { tab.scrollIntoView({ block: 'nearest', inline: 'center' }); } catch (e) {}
    const r = tab.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), label: (tab.innerText || '').trim().slice(0, 24) };
  };

  S.channelHeader = function () {
    const banner = document.querySelector('#banner img, ytd-banner-promo-renderer img, ytd-tabbed-page-header img');
    const avatar = document.querySelector('ytd-tabbed-page-header img[src*="yt3"], img#img, yt-avatar-shape img');
    const name = document.querySelector('ytd-tabbed-page-header h1, #channel-name, yt-channel-name, h1');
    const subscribe = Array.from(document.querySelectorAll('button, ytd-button-renderer, ytd-subscribe-button-renderer')).filter(visible).find(function (b) {
      return /subscribe|subscribed/i.test((b.innerText || '') + ' ' + (b.getAttribute('aria-label') || ''));
    });
    const desc = document.querySelector('#description, ytd-text-inline-expander, ytd-expandable-metadata-renderer');
    return {
      banner: banner ? rectOf(banner) : null,
      avatar: avatar ? rectOf(avatar) : null,
      name: name ? { text: textOf(name, 40), box: rectOf(name) } : null,
      subscribe: subscribe ? rectOf(subscribe) : null,
      description: desc ? rectOf(desc) : null,
      tabs: S.channelTabs(),
      url: location.pathname,
    };
  };

  S.channelDeep = function () {
    const csOf = function (el) {
      const c = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        tag: el.tagName.toLowerCase(),
        cls: (typeof el.className === 'string' ? el.className : '').slice(0, 60),
        box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        fontSize: c.fontSize, fontWeight: c.fontWeight, lineHeight: c.lineHeight, color: c.color,
        bg: c.backgroundColor, radius: c.borderRadius, padding: c.padding, overflow: c.overflow,
      };
    };
    const out = { header: null, grid: null, shelf: null };
    const headerRoot = document.querySelector(
      'yt-page-header-view-model, yt-page-header-renderer, ytd-tabbed-page-header',
    );
    if (headerRoot) {
      // The channel name is split across inline spans; pick the largest-font element with text.
      const big = Array.from(headerRoot.querySelectorAll('*')).filter(function (e) {
        const r = e.getBoundingClientRect();
        const cs = getComputedStyle(e);
        return (e.textContent || '').trim().length > 0 && r.width > 40 && r.height >= 20 && parseFloat(cs.fontSize) >= 20;
      });
      big.sort(function (a, b) {
        return parseFloat(getComputedStyle(b).fontSize) - parseFloat(getComputedStyle(a).fontSize);
      });
      if (big[0]) out.name = csOf(big[0]);
      const imgs = Array.from(headerRoot.querySelectorAll('img')).filter(function (e) {
        return e.getBoundingClientRect().width > 0;
      });
      const banner = imgs.slice().sort(function (a, b) {
        return b.getBoundingClientRect().width - a.getBoundingClientRect().width;
      })[0];
      if (banner) out.banner = csOf(banner);
      const avatars = imgs.filter(function (i) {
        const r = i.getBoundingClientRect();
        return r.width >= 80 && r.width <= 220 && Math.abs(r.width - r.height) < 4;
      });
      avatars.sort(function (a, b) {
        return b.getBoundingClientRect().width - a.getBoundingClientRect().width;
      });
      if (avatars[0]) out.avatar = csOf(avatars[0]);
    }
    const nameEl = out.name ? null : document.querySelector('#channel-name, h1');
    if (nameEl) out.name = csOf(nameEl);
    const meta = Array.from(document.querySelectorAll('ytd-tabbed-page-header span, #subscriber-count, #videos-count')).filter(function (e) {
      return e.children.length === 0 && /subscribers?|videos?/i.test(e.innerText || '');
    })[0];
    if (meta) out.meta = csOf(meta);
    const subscribe = Array.from(document.querySelectorAll('button, ytd-subscribe-button-renderer')).filter(visible).find(function (b) {
      return /subscribe/i.test((b.innerText || ''));
    });
    if (subscribe) out.subscribe = csOf(subscribe);
    const tabBar = document.querySelector('tp-yt-paper-tabs, yt-tab-group-shape');
    if (tabBar) out.tabs = csOf(tabBar);
    const items = Array.from(document.querySelectorAll('ytd-rich-item-renderer, yt-lockup-view-model')).filter(visible);
    if (items.length) {
      out.grid = { count: items.length, first: csOf(items[0]) };
      const img = items[0].querySelector('img');
      if (img) out.grid.thumb = csOf(img);
    }
    const shelfTitle = document.querySelector('#title, ytd-rich-shelf-renderer #title');
    if (shelfTitle) out.shelf = csOf(shelfTitle);
    out.page = { bg: getComputedStyle(document.documentElement).backgroundColor, font: getComputedStyle(document.documentElement).fontFamily };
    return out;
  };

  S.watchLink = function () {
    const rows = Array.from(document.querySelectorAll('ytd-video-renderer, yt-lockup-view-model')).filter(visible);
    for (const row of rows) {
      if (row.closest('ytd-ad-slot-renderer, ytd-promoted-sparkles-web-renderer, ytd-display-ad-renderer')) continue;
      if (/sponsored/i.test(row.innerText || '')) continue;
      const a = row.querySelector('a#video-title, a[href*="/watch"]');
      if (!a) continue;
      const href = a.getAttribute('href') || '';
      if (!href.includes('/watch?')) continue;
      try { a.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (e) {}
      const r = a.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= window.innerHeight) {
        return {
          x: Math.round(r.x + Math.min(r.width / 2, 160)),
          y: Math.round(r.y + r.height / 2),
          label: (a.innerText || '').trim().slice(0, 40),
          href,
        };
      }
    }
    return null;
  };

  S.watchProbe = function () {
    const player = document.querySelector('#movie_player, ytd-player video, video');
    const h1s = Array.from(document.querySelectorAll('h1')).filter(function (e) {
      return e.getBoundingClientRect().width > 0;
    });
    h1s.sort(function (a, b) {
      return (b.innerText || '').length - (a.innerText || '').length;
    });
    const title = h1s[0] || null;
    const channel = document.querySelector('#owner #channel-name, ytd-channel-name');
    const actions = Array.from(
      document.querySelectorAll('#top-level-buttons-computed button, ytd-watch-metadata #actions button, ytd-menu-renderer button'),
    )
      .filter(visible)
      .map(function (b) {
        return (b.getAttribute('aria-label') || b.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 34);
      })
      .filter(Boolean);
    const desc = Array.from(document.querySelectorAll('#description, ytd-text-inline-expander')).filter(function (e) {
      return e.getBoundingClientRect().width > 0;
    })[0];
    const comments = document.querySelector('#comments, ytd-comments');
    const upnext = Array.from(
      document.querySelectorAll('#secondary yt-lockup-view-model, ytd-watch-next-secondary-results-renderer yt-lockup-view-model'),
    ).filter(visible).length;
    const theater = Array.from(document.querySelectorAll('button')).filter(visible).find(function (b) {
      return /theater|cinema/i.test(b.getAttribute('aria-label') || '');
    });
    return {
      url: location.href.replace(/([?&][^=]+=)[^&]*/g, '$1…'),
      player: player ? rectOf(player) : null,
      title: title ? { text: textOf(title, 70), box: rectOf(title) } : null,
      channel: channel ? textOf(channel, 40) : null,
      actions: actions.slice(0, 10),
      description: desc ? rectOf(desc) : null,
      descriptionChars: desc ? (desc.innerText || '').length : null,
      comments: comments ? rectOf(comments) : null,
      upnext,
      theater: theater ? { label: theater.getAttribute('aria-label'), box: rectOf(theater) } : null,
    };
  };

  S.watchDeep = function () {
    const csOf = function (el) {
      const c = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        tag: el.tagName.toLowerCase(),
        cls: (typeof el.className === 'string' ? el.className : '').slice(0, 60),
        box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        fontSize: c.fontSize, fontWeight: c.fontWeight, lineHeight: c.lineHeight, color: c.color,
        bg: c.backgroundColor, radius: c.borderRadius, padding: c.padding, overflow: c.overflow,
      };
    };
    const out = { player: null, title: null, channel: null };
    const player = document.querySelector('#movie_player, ytd-player video, video');
    if (player) out.player = csOf(player);
    const h1s = Array.from(document.querySelectorAll('h1')).filter(function (e) {
      return e.getBoundingClientRect().width > 0;
    });
    h1s.sort(function (a, b) {
      return (b.innerText || '').length - (a.innerText || '').length;
    });
    if (h1s[0]) out.title = csOf(h1s[0]);
    const channel = document.querySelector('#owner #channel-name, ytd-channel-name');
    if (channel) out.channel = csOf(channel);
    const pickVisible = function (selectors) {
      for (const sel of selectors) {
        const els = Array.from(document.querySelectorAll(sel)).filter(function (e) {
          return e.getBoundingClientRect().width > 0;
        });
        if (els[0]) return els[0];
      }
      return null;
    };
    const primary = pickVisible(['#primary-inner', '#primary']);
    if (primary) out.primary = csOf(primary);
    const secondary = pickVisible(['#secondary-inner', '#secondary']);
    if (secondary) out.secondary = csOf(secondary);
    out.page = { bg: getComputedStyle(document.documentElement).backgroundColor, font: getComputedStyle(document.documentElement).fontFamily };
    return out;
  };

  S.meta = function () {
    return {
      url: location.href.replace(/([?&][^=]+=)[^&]*/g, '$1\u2026'),
      title: document.title,
      lang: document.documentElement.lang || null,
      navigationLanguage: navigator.language,
      viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
      prefersReducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      prefersDark: matchMedia('(prefers-color-scheme: dark)').matches,
      visibility: document.visibilityState,
      domCount: document.querySelectorAll('*').length
    };
  };

  S.timing = function () {
    const nav = performance.getEntriesByType('navigation')[0];
    return {
      navigation: nav ? nav.toJSON() : null,
      paint: performance.getEntriesByType('paint').map((e) => ({ name: e.name, t: Math.round(e.startTime) })),
      lcp: S.lcp.map((e) => ({ t: Math.round(e.t), size: e.size, tag: e.tag, id: e.id })),
      cls: Math.round(S.cls * 10000) / 10000,
      shifts: S.shifts.slice(0, 10).map((e) => ({ t: Math.round(e.t), v: e.v })),
      longtasks: S.longtasks.slice(0, 25).map((e) => ({ t: Math.round(e.t), d: Math.round(e.d) })),
      timeOrigin: performance.timeOrigin,
      errors: S.errors.slice(0, 10)
    };
  };

  window.__rea = S;
})();`;

// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);
  const width = Number(args.width || 1280);
  const height = Number(args.height || 800);
  const outDir = path.resolve(args.out || path.join("docs", "re-evidence", FLOW, String(width)));
  const defaultSteps =
    String(args.scenario) === "interactions" ? "baseline,styles,hover,menu,chip,scroll" : "all";
  const stepsWanted = new Set((args.steps || defaultSteps).split(",").map((s) => s.trim()));
  const all = stepsWanted.has("all");
  const want = (name) => all || stepsWanted.has(name);
  const profileDir = path.resolve(
    args.profile || path.join(os.tmpdir(), `rea-${FLOW}-${width}-${Date.now()}`),
  );

  mkdirSync(outDir, { recursive: true });
  mkdirSync(path.join(outDir, "shots"), { recursive: true });

  const written = [];
  const startedAt = new Date().toISOString();

  const writeJson = (name, value) => {
    const file = path.join(outDir, name);
    const body = JSON.stringify(value, null, 1) + "\n";
    writeFileSync(file, body);
    written.push({ file: name, bytes: Buffer.byteLength(body), sha256: sha256(body) });
    return body.length;
  };
  const writePng = (name, base64) => {
    const buf = Buffer.from(base64, "base64");
    const file = path.join(outDir, "shots", name);
    writeFileSync(file, buf);
    written.push({ file: `shots/${name}`, bytes: buf.length, sha256: sha256(buf) });
  };

  // --- launch -------------------------------------------------------------
  const chromeArgs = [
    `--user-data-dir=${profileDir}`,
    "--remote-debugging-port=0",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-search-engine-choice-screen",
    "--disable-sync",
    "--disable-extensions",
    "--disable-default-apps",
    "--disable-component-update",
    "--disable-background-networking",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-background-timer-throttling",
    "--disable-features=Translate,OptimizationHints,MediaRouter,InterestFeedContentSuggestions,CalculateNativeWinOcclusion",
    "--lang=en-US",
    "--accept-lang=en-US",
    "--force-device-scale-factor=1",
    "--autoplay-policy=no-user-gesture-required",
    `--window-size=${width},${height + 140}`,
    "--window-position=0,0",
    "about:blank",
  ];
  if (String(args.headless) === "true") chromeArgs.unshift("--headless=new");

  const child = spawn(CHROME, chromeArgs, { stdio: "ignore", windowsHide: false });
  const portFile = path.join(profileDir, "DevToolsActivePort");
  let wsUrl = null;
  for (let i = 0; i < 250; i++) {
    if (existsSync(portFile)) {
      const lines = readFileSync(portFile, "utf8").split("\n").filter(Boolean);
      if (lines.length >= 2) {
        wsUrl = `ws://127.0.0.1:${lines[0]}${lines[1]}`;
        break;
      }
    }
    if (child.exitCode !== null) throw new Error(`chrome exited early: ${child.exitCode}`);
    await sleep(100);
  }
  if (!wsUrl) throw new Error("chrome did not expose a debugging port");

  const browser = new Cdp(await connect(wsUrl));
  const version = await browser.send("Browser.getVersion");
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });

  const page = {
    send: (method, params) => browser.send(method, params, sessionId),
  };

  const network = [];
  const consoleRecords = [];
  const logRecords = [];
  const exceptions = [];
  const inflight = new Set();
  let lastNetActivity = Date.now();
  let navTimestamp = null;
  const IGNORE = new Set([
    "Media",
    "Ping",
    "WebSocket",
    "EventSource",
    "Manifest",
    "Other",
    "Preflight",
  ]);

  browser.on((msg) => {
    if (msg.sessionId && msg.sessionId !== sessionId) return;
    const p = msg.params;
    switch (msg.method) {
      case "Network.requestWillBeSent": {
        if (p.type === "Document" && p.request.url.startsWith("https://www.youtube.com"))
          navTimestamp = p.timestamp;
        if (!IGNORE.has(p.type) && !/googlevideo\.com/.test(p.request.url))
          inflight.add(p.requestId);
        lastNetActivity = Date.now();
        if (network.length < 800) {
          network.push({
            seq: network.length,
            id: p.requestId,
            type: p.type,
            method: p.request.method,
            url: safeUrl(p.request.url),
            t: navTimestamp ? Math.round((p.timestamp - navTimestamp) * 1000) : null,
            initiator: p.initiator && p.initiator.type ? p.initiator.type : null,
            resourceType: p.type,
          });
        }
        break;
      }
      case "Network.responseReceived": {
        const rec = network.find((n) => n.id === p.requestId);
        if (rec) {
          rec.status = p.response.status;
          rec.mime = (p.response.mimeType || "").slice(0, 40);
          rec.fromCache = !!p.response.fromDiskCache || !!p.response.fromMemoryCache;
          rec.responseT = navTimestamp ? Math.round((p.timestamp - navTimestamp) * 1000) : null;
        }
        lastNetActivity = Date.now();
        break;
      }
      case "Network.loadingFinished": {
        inflight.delete(p.requestId);
        const rec = network.find((n) => n.id === p.requestId);
        if (rec) {
          rec.endT = navTimestamp ? Math.round((p.timestamp - navTimestamp) * 1000) : null;
          rec.bytes = p.encodedDataLength;
        }
        lastNetActivity = Date.now();
        break;
      }
      case "Network.loadingFailed": {
        inflight.delete(p.requestId);
        const rec = network.find((n) => n.id === p.requestId);
        if (rec) rec.failed = p.errorText || "failed";
        lastNetActivity = Date.now();
        break;
      }
      case "Runtime.consoleAPICalled": {
        if (consoleRecords.length < 300) {
          consoleRecords.push({
            type: p.type,
            t: navTimestamp ? Math.round((p.timestamp - navTimestamp) * 1000) : null,
            text: redact(
              p.args &&
                p.args
                  .map((a) => (a.value !== undefined ? a.value : a.description || a.type))
                  .join(" "),
            ),
          });
        }
        break;
      }
      case "Runtime.exceptionThrown": {
        if (exceptions.length < 80) {
          exceptions.push({
            text: redact(
              p.exceptionDetails &&
                (p.exceptionDetails.exception?.description || p.exceptionDetails.text),
            ),
            url:
              p.exceptionDetails && p.exceptionDetails.url ? safeUrl(p.exceptionDetails.url) : null,
            line: p.exceptionDetails ? p.exceptionDetails.lineNumber : null,
          });
        }
        break;
      }
      case "Log.entryAdded": {
        if (logRecords.length < 300) {
          logRecords.push({
            level: p.entry.level,
            source: p.entry.source,
            text: redact(p.entry.text),
            url: p.entry.url ? safeUrl(p.entry.url) : null,
          });
        }
        break;
      }
      default:
        break;
    }
  });

  // --- session setup ------------------------------------------------------
  await page.send("Page.enable");
  await page.send("Network.enable", {
    maxTotalBufferSize: 50_000_000,
    maxResourceBufferSize: 5_000_000,
  });
  await page.send("Runtime.enable");
  await page.send("Log.enable");
  await page.send("Accessibility.enable");
  await page.send("Performance.enable");
  await page.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
    screenWidth: width,
    screenHeight: height,
  });
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: PAGE_SCRIPT });

  // Chrome marks a background/occluded window as hidden, which throttles the page
  // and changes what it renders. Force an active, focused document.
  await page.send("Page.bringToFront").catch(() => {});
  await page.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
  await page.send("Page.setWebLifecycleState", { state: "active" }).catch(() => {});

  const evaluate = async (expression) => {
    const res = await page.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
      timeout: 20000,
    });
    if (res.exceptionDetails) {
      throw new Error(
        `evaluate failed: ${res.exceptionDetails.exception?.description || res.exceptionDetails.text}`.slice(
          0,
          300,
        ),
      );
    }
    return res.result ? res.result.value : undefined;
  };

  const sleepMs = async (ms) => sleep(ms);

  const waitSettle = async ({ minMs = 2200, quiet = 900, timeout = 25000 } = {}) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      await sleep(100);
      const elapsed = Date.now() - start;
      if (elapsed >= minMs && inflight.size === 0 && Date.now() - lastNetActivity >= quiet)
        return elapsed;
    }
    return Date.now() - start;
  };

  const click = async (point, button = "left") => {
    await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
    await page.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: point.x,
      y: point.y,
      button,
      clickCount: 1,
    });
    await page.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: point.x,
      y: point.y,
      button,
      clickCount: 1,
    });
  };

  const pressKey = async (key, code, vk, modifiers = 0) => {
    await page.send("Input.dispatchKeyEvent", {
      type: "rawKeyDown",
      key,
      code,
      windowsVirtualKeyCode: vk,
      nativeVirtualKeyCode: vk,
      modifiers,
    });
    await page.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key,
      code,
      windowsVirtualKeyCode: vk,
      nativeVirtualKeyCode: vk,
      modifiers,
    });
  };

  const compactAx = (nodes) =>
    nodes.map((n) => ({
      id: n.nodeId,
      parent: n.parentId || null,
      role: n.role && n.role.value != null ? String(n.role.value) : null,
      name: n.name && n.name.value != null ? redact(String(n.name.value).slice(0, 70)) : null,
      ignored: !!n.ignored,
      value: n.value && n.value.value != null ? redact(String(n.value.value).slice(0, 40)) : null,
      props: Object.fromEntries(
        (n.properties || [])
          .filter((p) =>
            [
              "focusable",
              "focused",
              "level",
              "selected",
              "expanded",
              "hidden",
              "disabled",
              "required",
              "readonly",
              "checked",
              "pressed",
              "modal",
              "multiselectable",
              "live",
              "atomic",
              "relevant",
              "orientation",
              "autocomplete",
              "hasPopup",
              "invalid",
              "sort",
              "roledescription",
            ].includes(p.name),
          )
          .map((p) => [p.name, p.value ? p.value.value : null]),
      ),
    }));

  const capture = async (name) => {
    const dom = await evaluate("__rea.snap({max:14000})");
    const axRaw = await page.send("Accessibility.getFullAXTree");
    const ax = compactAx(axRaw.nodes);
    const shot = await page.send("Page.captureScreenshot", { format: "png", fromSurface: true });
    writeJson(`${name}.dom.json`, dom);
    writeJson(`${name}.ax.json`, { nodes: ax });
    writePng(`${name}.png`, shot.data);
    return {
      name,
      domNodes: dom.nodes.length,
      domTruncated: dom.truncated,
      axNodes: ax.length,
      axIgnored: ax.filter((n) => n.ignored).length,
      title: dom.title,
    };
  };

  const cleanup = async () => {
    try {
      await browser.send("Target.closeTarget", { targetId });
    } catch {}
    browser.close();
    try {
      spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } catch {}
    await sleep(600);
    if (String(args["keep-profile"]) !== "true") {
      try {
        rmSync(profileDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      } catch {}
    }
  };

  const go = async (url, opts = {}) => {
    await page.send("Page.navigate", { url }).catch(() => {});
    await sleep(300);
    return waitSettle(opts);
  };

  const resetStorage = async () => {
    await page
      .send("Storage.clearDataForOrigin", {
        origin: "https://www.youtube.com",
        storageTypes: "all",
      })
      .catch(() => {});
    await page.send("Network.clearBrowserCache").catch(() => {});
  };

  // --- cold-profile states: the first navigation *is* the experiment ------
  if (String(args.scenario || "").startsWith("cold-")) {
    const which = String(args.scenario).slice(5);
    const result = { scenario: which, width, height, samples: [] };
    try {
      if (which === "loading") {
        await page.send("Fetch.enable", {
          patterns: [{ urlPattern: "*youtubei/v1/browse*", requestStage: "Request" }],
        });
        const pausedPromise = browser.waitFor(
          "Fetch.requestPaused",
          (m) => m.params.request.url.includes("/youtubei/v1/browse"),
          25000,
        );
        await page.send("Page.navigate", { url: START_URL });
        const paused = await pausedPromise;
        result.paused = true;
        const t0 = Date.now();
        for (const at of [300, 1200]) {
          const wait = at - (Date.now() - t0);
          if (wait > 0) await sleep(wait);
          result.samples.push({
            at: Date.now() - t0,
            ...(await evaluate(
              `({ skeletons: document.querySelectorAll('ytd-skeleton, [class*="skeleton"], [class*="shimmer"], [class*="ghost"]').length, ghostCards: document.querySelectorAll('ytd-rich-item-renderer').length, spinner: !!document.querySelector('tp-yt-paper-spinner[active], ytd-continuation-item-renderer'), chips: document.querySelectorAll('yt-chip-cloud-chip-renderer').length, body: __rea.bodyText().slice(0, 140) })`,
            )),
          });
          await capture("state-loading-" + at);
        }
        await page.send("Fetch.continueRequest", { requestId: paused.requestId }).catch(() => {});
        await page.send("Fetch.disable").catch(() => {});
        const t1 = Date.now();
        for (let i = 0; i < 240; i++) {
          await sleep(50);
          const cards = await evaluate(
            `Array.from(document.querySelectorAll('ytd-rich-item-renderer')).filter(function (e) { return e.getBoundingClientRect().width > 0; }).length`,
          );
          if (cards > 0) {
            result.firstCardMs = Date.now() - t1;
            break;
          }
          if (Date.now() - t1 > 15000) break;
        }
        await waitSettle({ minMs: 1200, quiet: 900, timeout: 18000 });
        result.resolved = await evaluate("__rea.scrollState()");
        await capture("state-loading-resolved");
      }

      if (which === "error") {
        await page.send("Network.setBlockedURLs", {
          urls: ["*youtubei/v1/browse*", "*youtubei/v1/guide*", "*youtubei/v1/next*"],
        });
        await page.send("Page.navigate", { url: START_URL });
        const t0 = Date.now();
        for (const at of [4000, 12000]) {
          const wait = at - (Date.now() - t0);
          if (wait > 0) await sleep(wait);
          result.samples.push({
            at: Date.now() - t0,
            ...(await evaluate(
              `({ body: __rea.bodyText(), cards: Array.from(document.querySelectorAll('ytd-rich-item-renderer')).filter(function (e) { return e.getBoundingClientRect().width > 0; }).length, skeletons: document.querySelectorAll('ytd-skeleton, [class*="skeleton"], [class*="ghost"]').length, alerts: Array.from(document.querySelectorAll('[role="alert"], ytd-alert-with-button-renderer, tp-yt-paper-toast')).filter(function (e) { return e.getBoundingClientRect().width > 0; }).map(function (e) { return (e.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 80); }), retry: __rea.findButtonByText('retry|try again|reload') })`,
            )),
          });
          await capture("state-error-" + at / 1000 + "s");
        }
      }

      if (which === "offline") {
        await page.send("Network.emulateNetworkConditions", {
          offline: true,
          latency: 0,
          downloadThroughput: -1,
          uploadThroughput: -1,
        });
        await page.send("Page.navigate", { url: START_URL }).catch(() => {});
        const t0 = Date.now();
        for (const at of [3000, 8000]) {
          const wait = at - (Date.now() - t0);
          if (wait > 0) await sleep(wait);
          result.samples.push({
            at: Date.now() - t0,
            meta: await evaluate("__rea.meta()").catch(() => null),
            body: await evaluate("__rea.bodyText()").catch(() => null),
          });
          await capture("state-offline-" + at / 1000 + "s").catch(() => null);
        }
      }
    } catch (err) {
      result.error = String(err.message).slice(0, 200);
    } finally {
      await page.send("Network.setBlockedURLs", { urls: [] }).catch(() => {});
      await page
        .send("Network.emulateNetworkConditions", {
          offline: false,
          latency: 0,
          downloadThroughput: -1,
          uploadThroughput: -1,
        })
        .catch(() => {});
      await page.send("Fetch.disable").catch(() => {});
    }
    writeJson("cold-state.json", result);
    console.log(JSON.stringify({ ok: true, cold: which, width, result }, null, 1));
    await cleanup();
    return;
  }

  // --- load ---------------------------------------------------------------
  const summary = {
    flow: FLOW,
    width,
    height,
    url: START_URL,
    startUrl: START_URL,
    chrome: version.product,
    steps: [],
  };

  // Optional, human-paced seed: open public trending pages and a couple of videos
  // (no sign-in) so the signed-out home has local activity to build a feed from.
  const seedCount = Number(args.seed || 0);
  const seed = {
    requested: seedCount,
    visits: 0,
    attempts: [],
    cardsBefore: null,
    cardsAfter: null,
    afterReload: null,
  };
  if (seedCount > 0) {
    seed.cardsBefore = await evaluate(`document.querySelectorAll('ytd-rich-item-renderer').length`);
    const routes = [
      "https://www.youtube.com/results?search_query=music",
      "https://www.youtube.com/results?search_query=documentary",
    ];
    for (let i = 0; i < seedCount; i++) {
      const attempt = {
        route: routes[i % routes.length],
        found: false,
        clicked: false,
        navigated: false,
      };
      await go(attempt.route, { minMs: 2500, quiet: 900, timeout: 20000 });
      attempt.pathname = await evaluate("location.pathname");
      let point = null;
      for (let k = 0; k < 40 && !point; k++) {
        point = await evaluate(
          `__rea.linkPoint(['ytd-video-renderer a#video-title','ytd-video-renderer a#thumbnail','a#video-title-link','a#thumbnail'], 0)`,
        );
        if (!point) await sleep(250);
      }
      attempt.found = !!point;
      if (point) {
        const href = await evaluate(
          `(() => { const els = Array.from(document.querySelectorAll('ytd-video-renderer a#video-title, a#video-title-link')).filter(e => e.getBoundingClientRect().width > 0); return els.length ? els[0].href : null; })()`,
        );
        attempt.href = href ? safeUrl(href) : null;
        await click(point);
        attempt.clicked = true;
        for (let k = 0; k < 60; k++) {
          await sleep(100);
          if ((await evaluate("location.pathname")).startsWith("/watch")) {
            attempt.navigated = true;
            break;
          }
        }
        if (!attempt.navigated && href) {
          await page.send("Page.navigate", { url: href }).catch(() => {});
          await sleep(1500);
          attempt.directNav = (await evaluate("location.pathname")).startsWith("/watch");
          attempt.navigated = attempt.directNav;
        }
        if (attempt.navigated) {
          await waitSettle({ minMs: 2500, quiet: 900, timeout: 18000 });
          await sleep(5000); // let the public player start so local activity registers
          await evaluate(
            `Array.from(document.querySelectorAll('video')).forEach((v) => { try { v.muted = true; v.pause(); } catch (e) {} }); true`,
          );
          await sleep(1200);
          seed.visits++;
        }
      } else {
        attempt.bodyText = await evaluate("__rea.bodyText()");
      }
      seed.attempts.push(attempt);
    }
    await go(START_URL, { minMs: 2500, quiet: 900, timeout: 22000 });
    seed.cardsAfter = await evaluate(`document.querySelectorAll('ytd-rich-item-renderer').length`);
    if (seed.cardsAfter === 0) {
      await page.send("Page.reload", { ignoreCache: false }).catch(() => {});
      await sleep(2500);
      await waitSettle({ minMs: 1500, quiet: 800, timeout: 12000 });
      seed.afterReload = await evaluate(
        `document.querySelectorAll('ytd-rich-item-renderer').length`,
      );
      seed.cardsAfter = seed.afterReload;
    }
  }

  const navStart = Date.now();
  const settleMs = await go(START_URL, { minMs: 2400, quiet: 900, timeout: 25000 });
  summary.loadWallMs = Date.now() - navStart;
  summary.settleMs = settleMs;
  summary.meta = await evaluate("__rea.meta()");
  summary.cards = await evaluate(`document.querySelectorAll('ytd-rich-item-renderer').length`);
  seed.cardsAfter = summary.cards;
  summary.seed = seed;

  // --- search scene -------------------------------------------------------
  if (String(args.scene) === "search") {
    const wantS = (name) => stepsWanted.has("all") || stepsWanted.has(name);
    summary.state = "ready";

    if (wantS("baseline")) {
      summary.steps.push(await capture("state-ready"));
      writeJson("timing.json", await evaluate("__rea.timing()"));
      writeJson("chrome.json", await evaluate("__rea.chromeProbe()"));
      writeJson("network.json", network.slice());
      writeJson("console.json", { console: consoleRecords, log: logRecords, exceptions });
      writeJson("rows.json", { rows: await evaluate("__rea.searchRows().length") });
    }

    if (wantS("styles")) {
      writeJson("search-styles.json", await evaluate("__rea.searchDeep()"));
    }

    if (wantS("keyboard")) {
      const keyboard = { steps: [] };
      await evaluate(
        "document.activeElement && document.activeElement.blur(); document.body.focus();",
      );
      await sleep(120);
      for (let i = 1; i <= 16; i++) {
        await pressKey("Tab", "Tab", 9);
        await sleep(90);
        keyboard.steps.push({ step: i, active: await evaluate("__rea.active()") });
      }
      await capture("kbd-01-first-tab");
      writeJson("keyboard.json", keyboard);
      summary.steps.push({ name: "keyboard", tabs: keyboard.steps.length });
    }

    if (wantS("filters")) {
      const filters = {
        button: null,
        openMs: null,
        opened: false,
        dialog: null,
        escapeCloseMs: null,
        focusReturn: null,
      };
      const btn = await evaluate("__rea.filtersButton()");
      filters.button = btn;
      if (btn) {
        const t0 = Date.now();
        await click(btn);
        for (let i = 0; i < 120; i++) {
          await sleep(25);
          const d = await evaluate("__rea.filterDialog()");
          if (d.open) {
            filters.opened = true;
            filters.openMs = Date.now() - t0;
            filters.dialog = d;
            break;
          }
        }
        if (filters.opened) {
          await capture("filters-open");
          const esc0 = Date.now();
          await pressKey("Escape", "Escape", 27);
          for (let i = 0; i < 60; i++) {
            await sleep(25);
            const d = await evaluate("__rea.filterDialog()");
            if (!d.open) {
              filters.escapeCloseMs = Date.now() - esc0;
              break;
            }
          }
          await capture("filters-closed");
          filters.focusReturn = await evaluate("__rea.active()");
        }
      }
      writeJson("filters.json", filters);
      summary.steps.push({ name: "filters", opened: filters.opened, openMs: filters.openMs });
    }

    if (wantS("chip")) {
      const chip = {
        clicked: null,
        before: null,
        firstChangeMs: null,
        loadingCaptured: false,
        settleMs: null,
        after: null,
        selected: null,
      };
      chip.before = await evaluate("__rea.resultSignature()");
      const point = await evaluate("__rea.bootChip()");
      if (point) {
        chip.clicked = point;
        const t0 = Date.now();
        await click(point);
        let first = null;
        let stableSince = null;
        let last = chip.before;
        for (let i = 0; i < 240; i++) {
          await sleep(25);
          const sig = await evaluate("__rea.resultSignature()");
          if (first == null && sig !== chip.before) first = Date.now() - t0;
          if (!chip.loadingCaptured && sig !== chip.before) {
            const rows = await evaluate("__rea.searchRows().length");
            if (rows < 2) {
              await capture("state-loading-chip");
              chip.loadingCaptured = true;
            }
          }
          if (sig === last && sig !== chip.before) {
            if (stableSince == null) stableSince = Date.now();
          } else {
            stableSince = null;
            last = sig;
          }
          if (first != null && stableSince != null && Date.now() - stableSince > 700) {
            chip.settleMs = Date.now() - t0;
            break;
          }
          if (Date.now() - t0 > 12000) break;
        }
        chip.firstChangeMs = first;
        chip.after = await evaluate("__rea.resultSignature()");
        chip.selected = await evaluate(
          `Array.from(document.querySelectorAll('yt-chip-cloud-chip-renderer.iron-selected')).map(function (e) { return (e.innerText || '').trim().slice(0, 24); })`,
        );
        await capture("state-ready-filtered");
      }
      writeJson("chip.json", chip);
      summary.steps.push({
        name: "chip",
        clicked: !!point,
        firstChangeMs: chip.firstChangeMs,
        settleMs: chip.settleMs,
      });
    }

    if (wantS("more")) {
      const more = { button: null, before: null, after: null, ms: null };
      more.before = await evaluate("__rea.searchRows().length");
      const btn = await evaluate("__rea.showMore()");
      more.button = btn;
      if (btn) {
        await evaluate("window.scrollTo(0, document.documentElement.scrollHeight)");
        await sleep(500);
        // Coordinates are viewport-relative: re-measure after scrolling.
        const visibleBtn = await evaluate("__rea.showMore()");
        more.visibleButton = visibleBtn;
        if (visibleBtn) {
          await page.send("Input.dispatchMouseEvent", {
            type: "mouseMoved",
            x: visibleBtn.x,
            y: visibleBtn.y,
          });
          await sleep(150);
          const t0 = Date.now();
          await click(visibleBtn);
          for (let i = 0; i < 240; i++) {
            await sleep(50);
            const rows = await evaluate("__rea.searchRows().length");
            if (rows > more.before) {
              more.ms = Date.now() - t0;
              more.after = rows;
              break;
            }
            if (Date.now() - t0 > 12000) break;
          }
          more.after = more.after || (await evaluate("__rea.searchRows().length"));
          await capture("state-more-loaded");
        }
      }
      writeJson("more.json", more);
      summary.steps.push({ name: "more", clicked: !!btn, ms: more.ms });
    }

    if (wantS("empty")) {
      const empty = {};
      await go("https://www.youtube.com/results?search_query=xqzvbnm12345asdfghjkl", {
        minMs: 2200,
        quiet: 900,
        timeout: 20000,
      });
      empty.body = await evaluate("__rea.bodyText()");
      empty.rows = await evaluate("__rea.searchRows().length");
      empty.messages = await evaluate(
        `Array.from(document.querySelectorAll('ytd-message-renderer, [role="alert"], ytd-item-section-renderer ytd-message-renderer')).filter(function (e) { return e.getBoundingClientRect().width > 0; }).map(function (e) { return (e.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 160); })`,
      );
      await capture("state-empty");
      writeJson("empty.json", empty);
      summary.steps.push({ name: "empty", rows: empty.rows });
    }

    if (wantS("error")) {
      const err = {};
      try {
        await page.send("Network.setBlockedURLs", { urls: ["*youtubei/v1/search*"] });
        await page.send("Page.reload", { ignoreCache: true });
        await sleep(2500);
        await waitSettle({ minMs: 2500, quiet: 800, timeout: 15000 });
        err.body = await evaluate("__rea.bodyText()");
        err.rows = await evaluate("__rea.searchRows().length");
        err.messages = await evaluate(
          `Array.from(document.querySelectorAll('ytd-message-renderer, [role="alert"], ytd-alert-with-button-renderer')).filter(function (e) { return e.getBoundingClientRect().width > 0; }).map(function (e) { return (e.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 160); })`,
        );
        await capture("state-error");
      } catch (e) {
        err.error = String(e.message).slice(0, 160);
      } finally {
        await page.send("Network.setBlockedURLs", { urls: [] }).catch(() => {});
      }
      writeJson("error.json", err);
      summary.steps.push({ name: "error" });
    }

    if (wantS("offline")) {
      const offline = { warm: null, cold: null };
      try {
        await go(START_URL, { minMs: 2200, quiet: 900, timeout: 20000 });
        await page.send("Network.emulateNetworkConditions", {
          offline: true,
          latency: 0,
          downloadThroughput: -1,
          uploadThroughput: -1,
        });
        const chipPoint = await evaluate("__rea.bootChip()");
        offline.warmTriggered = !!chipPoint;
        if (chipPoint) {
          const t0 = Date.now();
          await click(chipPoint);
          await sleep(2500);
          offline.warm = {
            at: Date.now() - t0,
            body: await evaluate("__rea.bodyText()"),
            rows: await evaluate("__rea.searchRows().length"),
            alerts: await evaluate(
              `Array.from(document.querySelectorAll('[role="alert"], tp-yt-paper-toast, ytd-alert-with-button-renderer')).filter(function (e) { return e.getBoundingClientRect().width > 0; }).map(function (e) { return (e.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 100); })`,
            ),
          };
          await capture("state-offline-warm");
        }
        await page.send("Page.navigate", { url: START_URL }).catch(() => {});
        await sleep(3000);
        offline.cold = {
          meta: await evaluate("__rea.meta()").catch(() => null),
          body: await evaluate("__rea.bodyText()").catch(() => null),
        };
        await capture("state-offline-cold").catch(() => {});
      } catch (e) {
        offline.error = String(e.message).slice(0, 160);
      } finally {
        await page
          .send("Network.emulateNetworkConditions", {
            offline: false,
            latency: 0,
            downloadThroughput: -1,
            uploadThroughput: -1,
          })
          .catch(() => {});
      }
      writeJson("offline.json", offline);
      summary.steps.push({ name: "offline" });
    }

    if (wantS("reduced-motion")) {
      const rm = {};
      try {
        // The offline step may have left a browser error page; reload a real surface first.
        await go(START_URL, { minMs: 2200, quiet: 900, timeout: 20000 });
        rm.baseline = await evaluate("__rea.animations()");
        await page.send("Emulation.setEmulatedMedia", {
          features: [{ name: "prefers-reduced-motion", value: "reduce" }],
        });
        rm.matches = await evaluate(`matchMedia('(prefers-reduced-motion: reduce)').matches`);
        await go(START_URL, { minMs: 2000, quiet: 800, timeout: 15000 });
        rm.reduced = await evaluate("__rea.animations()");
        await capture("state-reduced-motion");
      } catch (e) {
        rm.error = String(e.message).slice(0, 160);
      } finally {
        await page.send("Emulation.setEmulatedMedia", { features: [] }).catch(() => {});
      }
      writeJson("reduced-motion.json", rm);
      summary.steps.push({ name: "reduced-motion" });
    }

    writeJson("summary.json", summary);
    const finished = new Date().toISOString();
    const runBody =
      JSON.stringify(
        {
          flow: "search",
          width,
          height,
          url: safeUrl(START_URL),
          startedAt,
          finishedAt: finished,
          chrome: version,
          summary,
          artifacts: written,
        },
        null,
        1,
      ) + "\n";
    writeFileSync(path.join(outDir, "run.json"), runBody);
    writeFileSync(
      path.resolve(path.dirname(outDir), "manifest.jsonl"),
      JSON.stringify({
        flow: "search",
        width,
        height,
        dir: path.relative(path.resolve("."), outDir).replace(/\\/g, "/"),
        startedAt,
        finishedAt: finished,
        url: safeUrl(START_URL),
        chrome: version.product,
        artifacts: written.length,
        runSha256: sha256(runBody),
        steps: summary.steps.map((s) => s.name),
      }) + "\n",
      { flag: "a" },
    );
    console.log(
      JSON.stringify(
        {
          ok: true,
          scene: "search",
          dir: outDir,
          width,
          rows: await evaluate("__rea.searchRows().length"),
          steps: summary.steps,
        },
        null,
        1,
      ),
    );
    await cleanup();
    return;
  }

  // --- channel scene ------------------------------------------------------
  if (String(args.scene) === "channel") {
    const wantC = (name) => stepsWanted.has("all") || stepsWanted.has(name);
    summary.state = "ready";
    // A styles-only run can start before the page has painted; wait for the header.
    for (let i = 0; i < 60; i++) {
      const ready = await evaluate(
        `!!document.querySelector('yt-page-header-view-model, ytd-tabbed-page-header')`,
      );
      if (ready) break;
      await sleep(500);
    }

    if (wantC("baseline")) {
      summary.steps.push(await capture("state-ready"));
      writeJson("timing.json", await evaluate("__rea.timing()"));
      writeJson("chrome.json", await evaluate("__rea.chromeProbe()"));
      writeJson("network.json", network.slice());
      writeJson("console.json", { console: consoleRecords, log: logRecords, exceptions });
      writeJson("channel-header.json", await evaluate("__rea.channelHeader()"));
    }

    if (wantC("styles")) {
      writeJson("channel-styles.json", await evaluate("__rea.channelDeep()"));
    }

    if (wantC("keyboard")) {
      const keyboard = { steps: [] };
      await evaluate(
        "document.activeElement && document.activeElement.blur(); document.body.focus();",
      );
      await sleep(120);
      for (let i = 1; i <= 16; i++) {
        await pressKey("Tab", "Tab", 9);
        await sleep(90);
        keyboard.steps.push({ step: i, active: await evaluate("__rea.active()") });
      }
      await capture("kbd-01-first-tab");
      writeJson("keyboard.json", keyboard);
      summary.steps.push({ name: "keyboard", tabs: keyboard.steps.length });
    }

    if (wantC("videos")) {
      const videos = {
        tab: null,
        clickMs: null,
        path: null,
        grid: null,
        loadingCaptured: false,
        skeletons: null,
      };
      videos.tab = await evaluate(`__rea.tabPoint('Videos')`);
      if (videos.tab) {
        const t0 = Date.now();
        await click(videos.tab);
        for (let i = 0; i < 240; i++) {
          await sleep(25);
          if (!videos.loadingCaptured) {
            const s = await evaluate(
              `({ skeletons: document.querySelectorAll('ytd-skeleton, [class*="skeleton"], [class*="ghost"]').length, items: document.querySelectorAll('ytd-rich-item-renderer').length })`,
            );
            if (s.skeletons > 0 && s.items === 0) {
              videos.loadingCaptured = true;
              videos.skeletons = s;
              videos.loadingMs = Date.now() - t0;
              await capture("state-loading");
            }
          }
          const path = await evaluate("location.pathname");
          if (path.endsWith("/videos")) {
            videos.path = path;
            videos.clickMs = Date.now() - t0;
            break;
          }
          if (Date.now() - t0 > 12000) break;
        }
        await waitSettle({ minMs: 2000, quiet: 800, timeout: 15000 });
        videos.grid = await evaluate(
          `({ items: Array.from(document.querySelectorAll('ytd-rich-item-renderer, yt-lockup-view-model')).filter(function (e) { return e.getBoundingClientRect().width > 0; }).length, path: location.pathname })`,
        );
        await capture("state-videos");
      }
      writeJson("videos.json", videos);
      summary.steps.push({
        name: "videos",
        clickMs: videos.clickMs,
        items: videos.grid ? videos.grid.items : null,
      });
    }

    if (wantC("about")) {
      const about = { about: null, links: null, dialog: null };
      const more = await evaluate(
        `(() => { const els = Array.from(document.querySelectorAll('button, yt-button-shape, tp-yt-paper-button, a, span')).filter(function (e) { const t = (e.innerText || '').trim(); const r = e.getBoundingClientRect(); return r.width > 0 && /^(\\.\\.\\.|…)?\\s*more$/i.test(t); }); if (!els.length) return null; const el = els[0].closest('button, a, tp-yt-paper-button') || els[0]; const r = el.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), label: (el.innerText || '').trim().slice(0, 20) }; })()`,
      );
      about.about = more;
      if (more) {
        await click(more);
        await sleep(500);
        await capture("state-about-expanded");
      }
      const links = await evaluate(
        `(() => { const els = Array.from(document.querySelectorAll('button, a, tp-yt-paper-button')).filter(function (e) { return e.getBoundingClientRect().width > 0 && /and \\d+ more links/i.test(e.innerText || ''); }); if (!els.length) return null; const el = els[0]; const r = el.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), label: (el.innerText || '').trim().slice(0, 40) }; })()`,
      );
      about.links = links;
      if (links) {
        await click(links);
        await sleep(500);
        about.dialog = await evaluate(
          `({ dialogs: Array.from(document.querySelectorAll('tp-yt-paper-dialog, [role="dialog"]')).filter(function (e) { return e.getBoundingClientRect().width > 0; }).length, text: ((document.querySelector('tp-yt-paper-dialog, [role="dialog"]') || { innerText: '' }).innerText || '').replace(/\\s+/g, ' ').slice(0, 120) })`,
        );
        await capture("state-links-panel");
        await pressKey("Escape", "Escape", 27);
        await sleep(200);
        await capture("state-links-closed");
      }
      writeJson("about.json", about);
      summary.steps.push({
        name: "about",
        expanded: !!more,
        linksPanel: !!(about.dialog && about.dialog.dialogs),
      });
    }

    if (wantC("error")) {
      const err = {};
      try {
        await page.send("Network.setBlockedURLs", {
          urls: ["*youtubei/v1/browse*", "*youtubei/v1/guide*"],
        });
        await page.send("Page.navigate", { url: START_URL });
        await sleep(2500);
        await waitSettle({ minMs: 2500, quiet: 800, timeout: 15000 });
        err.body = await evaluate("__rea.bodyText()");
        err.items = await evaluate(
          `Array.from(document.querySelectorAll('ytd-rich-item-renderer')).filter(function (e) { return e.getBoundingClientRect().width > 0; }).length`,
        );
        err.alerts = await evaluate(
          `Array.from(document.querySelectorAll('[role="alert"], ytd-message-renderer')).filter(function (e) { return e.getBoundingClientRect().width > 0; }).map(function (e) { return (e.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 120); })`,
        );
        await capture("state-error");
      } catch (e) {
        err.error = String(e.message).slice(0, 160);
      } finally {
        await page.send("Network.setBlockedURLs", { urls: [] }).catch(() => {});
      }
      writeJson("error.json", err);
      summary.steps.push({ name: "error" });
    }

    if (wantC("offline")) {
      const offline = {};
      try {
        await page.send("Network.emulateNetworkConditions", {
          offline: true,
          latency: 0,
          downloadThroughput: -1,
          uploadThroughput: -1,
        });
        await page.send("Page.navigate", { url: START_URL }).catch(() => {});
        await sleep(3000);
        offline.meta = await evaluate("__rea.meta()").catch(() => null);
        offline.body = await evaluate("__rea.bodyText()").catch(() => null);
        await capture("state-offline").catch(() => {});
      } catch (e) {
        offline.error = String(e.message).slice(0, 160);
      } finally {
        await page
          .send("Network.emulateNetworkConditions", {
            offline: false,
            latency: 0,
            downloadThroughput: -1,
            uploadThroughput: -1,
          })
          .catch(() => {});
      }
      writeJson("offline.json", offline);
      summary.steps.push({ name: "offline" });
    }

    if (wantC("reduced-motion")) {
      const rm = {};
      try {
        await go(START_URL, { minMs: 2200, quiet: 900, timeout: 20000 });
        rm.baseline = await evaluate("__rea.animations()");
        await page.send("Emulation.setEmulatedMedia", {
          features: [{ name: "prefers-reduced-motion", value: "reduce" }],
        });
        rm.matches = await evaluate(`matchMedia('(prefers-reduced-motion: reduce)').matches`);
        await go(START_URL, { minMs: 2000, quiet: 800, timeout: 15000 });
        rm.reduced = await evaluate("__rea.animations()");
        await capture("state-reduced-motion");
      } catch (e) {
        rm.error = String(e.message).slice(0, 160);
      } finally {
        await page.send("Emulation.setEmulatedMedia", { features: [] }).catch(() => {});
      }
      writeJson("reduced-motion.json", rm);
      summary.steps.push({ name: "reduced-motion" });
    }

    writeJson("summary.json", summary);
    const finished = new Date().toISOString();
    const runBody =
      JSON.stringify(
        {
          flow: "channel",
          width,
          height,
          url: safeUrl(START_URL),
          startedAt,
          finishedAt: finished,
          chrome: version,
          summary,
          artifacts: written,
        },
        null,
        1,
      ) + "\n";
    writeFileSync(path.join(outDir, "run.json"), runBody);
    writeFileSync(
      path.resolve(path.dirname(outDir), "manifest.jsonl"),
      JSON.stringify({
        flow: "channel",
        width,
        height,
        dir: path.relative(path.resolve("."), outDir).replace(/\\/g, "/"),
        startedAt,
        finishedAt: finished,
        url: safeUrl(START_URL),
        chrome: version.product,
        artifacts: written.length,
        runSha256: sha256(runBody),
        steps: summary.steps.map((s) => s.name),
      }) + "\n",
      { flag: "a" },
    );
    console.log(
      JSON.stringify(
        { ok: true, scene: "channel", dir: outDir, width, steps: summary.steps },
        null,
        1,
      ),
    );
    await cleanup();
    return;
  }

  // --- watch scene --------------------------------------------------------
  if (String(args.scene) === "watch") {
    const wantW = (name) => stepsWanted.has("all") || stepsWanted.has(name);
    summary.state = "ready";

    // Discover a public video through search results rather than hardcoding an id.
    if (process.env.REA_WATCH_ID) {
      await page
        .send("Page.navigate", {
          url: `https://www.youtube.com/watch?v=${encodeURIComponent(process.env.REA_WATCH_ID)}`,
        })
        .catch(() => {});
      await sleep(800);
    }
    if (!(await evaluate("location.pathname")).startsWith("/watch")) {
      const link = await evaluate("__rea.watchLink()");
      if (link) {
        await click(link);
        for (let i = 0; i < 80; i++) {
          await sleep(50);
          if ((await evaluate("location.pathname")).startsWith("/watch")) break;
        }
        // A click can be intercepted by an overlay; the href itself is a public page.
        if (!(await evaluate("location.pathname")).startsWith("/watch") && link.href) {
          const target = await evaluate(
            `new URL(${JSON.stringify(link.href)}, location.origin).href`,
          );
          await page.send("Page.navigate", { url: target }).catch(() => {});
          for (let i = 0; i < 120; i++) {
            await sleep(50);
            if ((await evaluate("location.pathname")).startsWith("/watch")) break;
          }
        }
      }
    }
    await waitSettle({ minMs: 2500, quiet: 900, timeout: 25000 });
    // On narrow viewports the metadata streams in later than the player shell.
    for (let i = 0; i < 40; i++) {
      const ready = await evaluate(
        `Array.from(document.querySelectorAll('h1')).some(function (e) { return e.getBoundingClientRect().width > 0 && (e.innerText || '').trim().length > 3; })`,
      );
      if (ready) break;
      await sleep(400);
    }

    // Skip a pre-roll if present, then dismiss the signed-out promo overlay so the
    // metadata and actions underneath are captured rather than covered.
    for (let i = 0; i < 24; i++) {
      const adState = await evaluate(
        `({ ad: !!document.querySelector('#movie_player.ad-showing, .ytp-ad-player-overlay'), skip: (function () { const b = Array.from(document.querySelectorAll('#movie_player button.ytp-ad-skip-button, #movie_player .ytp-ad-skip-button, .ytp-ad-skip-button-modern, button.ytp-skip-ad-button')).find(function (x) { return x.getBoundingClientRect().width > 0; }); if (!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })() })`,
      );
      if (adState.skip) {
        await click(adState.skip);
        await sleep(800);
      } else if (!adState.ad) {
        break;
      } else {
        await sleep(500);
      }
    }
    const dismiss = await evaluate(
      `(() => { const b = Array.from(document.querySelectorAll('button, tp-yt-paper-button')).find(function (x) { const r = x.getBoundingClientRect(); return r.width > 0 && /^(no thanks|not now|dismiss)$/i.test((x.innerText || '').trim()); }); if (!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), label: (b.innerText || '').trim() }; })()`,
    );
    if (dismiss) {
      await click(dismiss);
      await sleep(500);
    }
    await sleep(600);
    await waitSettle({ minMs: 800, quiet: 700, timeout: 12000 });
    summary.overlays = { adSkipped: true, dismissedPromo: dismiss ? dismiss.label : null };
    summary.videoId = await evaluate(
      `(function () { try { return new URL(location.href).searchParams.get('v'); } catch (e) { return null; } })()`,
    );
    summary.watchUrl = await evaluate("__rea.watchProbe()");

    if (wantW("baseline")) {
      summary.steps.push(await capture("state-ready"));
      writeJson("timing.json", await evaluate("__rea.timing()"));
      writeJson("chrome.json", await evaluate("__rea.chromeProbe()"));
      writeJson("network.json", network.slice());
      writeJson("console.json", { console: consoleRecords, log: logRecords, exceptions });
      writeJson("watch.json", await evaluate("__rea.watchProbe()"));
      // Stop the public player so the rest of the capture does not stream media.
      await evaluate(
        `Array.from(document.querySelectorAll('video')).forEach(function (v) { try { v.pause(); } catch (e) {} }); true`,
      );
    }

    if (wantW("styles")) {
      writeJson("watch-styles.json", await evaluate("__rea.watchDeep()"));
    }

    if (wantW("keyboard")) {
      const keyboard = { steps: [] };
      await evaluate(
        "document.activeElement && document.activeElement.blur(); document.body.focus();",
      );
      await sleep(120);
      for (let i = 1; i <= 16; i++) {
        await pressKey("Tab", "Tab", 9);
        await sleep(90);
        keyboard.steps.push({ step: i, active: await evaluate("__rea.active()") });
      }
      await capture("kbd-01-first-tab");
      writeJson("keyboard.json", keyboard);
      summary.steps.push({ name: "keyboard", tabs: keyboard.steps.length });
    }

    if (wantW("description")) {
      const desc = {};
      const expand = await evaluate(
        `(() => { const el = Array.from(document.querySelectorAll('#expand, ytd-text-inline-expander #expand, tp-yt-paper-button#expand')).find(function (e) { return e.getBoundingClientRect().width > 0 && e.closest('ytd-text-inline-expander'); }); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), label: (el.innerText || '').trim().slice(0, 20) }; })()`,
      );
      desc.expander = expand;
      if (expand) {
        await click(expand);
        await sleep(400);
        await capture("state-description-expanded");
        desc.expanded = true;
      }
      writeJson("description.json", desc);
      summary.steps.push({ name: "description", expanded: !!expand });
    }

    if (wantW("theater")) {
      const theater = {};
      const btn = await evaluate(
        `(() => { const el = Array.from(document.querySelectorAll('button')).filter(function (b) { return b.getBoundingClientRect().width > 0; }).find(function (b) { return /theater|cinema/i.test(b.getAttribute('aria-label') || ''); }); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), label: el.getAttribute('aria-label') }; })()`,
      );
      theater.button = btn;
      theater.before = await evaluate("__rea.watchProbe()");
      if (btn) {
        const t0 = Date.now();
        await click(btn);
        for (let i = 0; i < 80; i++) {
          await sleep(50);
          const probe = await evaluate("__rea.watchProbe()");
          if (
            probe.player &&
            theater.before.player &&
            probe.player.w > theater.before.player.w + 40
          ) {
            theater.ms = Date.now() - t0;
            theater.after = probe;
            break;
          }
        }
        theater.after = theater.after || (await evaluate("__rea.watchProbe()"));
        await capture("state-theater");
        await click(btn);
        await sleep(500);
      }
      writeJson("theater.json", theater);
      summary.steps.push({ name: "theater", toggled: !!btn, ms: theater.ms });
    }

    if (wantW("comments")) {
      const comments = {};
      await evaluate(
        'window.scrollTo(0, document.querySelector("#comments, ytd-comments") ? document.querySelector("#comments, ytd-comments").getBoundingClientRect().top + window.scrollY - 80 : document.documentElement.scrollHeight)',
      );
      await sleep(2000);
      comments.probe = await evaluate(
        `({ threads: document.querySelectorAll('ytd-comment-thread-renderer').length, section: !!document.querySelector('#comments, ytd-comments'), label: (document.querySelector('#comments #header, ytd-comments #title') || { innerText: '' }).innerText.replace(/\\s+/g, ' ').slice(0, 60) })`,
      );
      await capture("state-comments");
      writeJson("comments.json", comments);
      summary.steps.push({ name: "comments", threads: comments.probe.threads });
    }

    if (wantW("error")) {
      const err = {};
      try {
        await page.send("Network.setBlockedURLs", {
          urls: ["*youtubei/v1/player*", "*youtubei/v1/next*"],
        });
        await page.send("Page.reload", { ignoreCache: true });
        await sleep(3000);
        await waitSettle({ minMs: 3000, quiet: 800, timeout: 18000 });
        err.body = await evaluate("__rea.bodyText()");
        err.probe = await evaluate("__rea.watchProbe()");
        err.alerts = await evaluate(
          `Array.from(document.querySelectorAll('[role="alert"], ytd-alert-with-button-renderer, tp-yt-paper-toast')).filter(function (e) { return e.getBoundingClientRect().width > 0; }).map(function (e) { return (e.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 100); })`,
        );
        await capture("state-error");
      } catch (e) {
        err.error = String(e.message).slice(0, 160);
      } finally {
        await page.send("Network.setBlockedURLs", { urls: [] }).catch(() => {});
      }
      writeJson("error.json", err);
      summary.steps.push({ name: "error" });
    }

    if (wantW("offline")) {
      const offline = {};
      try {
        await page.send("Network.emulateNetworkConditions", {
          offline: true,
          latency: 0,
          downloadThroughput: -1,
          uploadThroughput: -1,
        });
        await page.send("Page.navigate", { url: START_URL }).catch(() => {});
        await sleep(3000);
        offline.meta = await evaluate("__rea.meta()").catch(() => null);
        offline.body = await evaluate("__rea.bodyText()").catch(() => null);
        await capture("state-offline").catch(() => {});
      } catch (e) {
        offline.error = String(e.message).slice(0, 160);
      } finally {
        await page
          .send("Network.emulateNetworkConditions", {
            offline: false,
            latency: 0,
            downloadThroughput: -1,
            uploadThroughput: -1,
          })
          .catch(() => {});
      }
      writeJson("offline.json", offline);
      summary.steps.push({ name: "offline" });
    }

    if (wantW("reduced-motion")) {
      const rm = {};
      try {
        await go(START_URL, { minMs: 2200, quiet: 900, timeout: 20000 });
        rm.baseline = await evaluate("__rea.animations()");
        await page.send("Emulation.setEmulatedMedia", {
          features: [{ name: "prefers-reduced-motion", value: "reduce" }],
        });
        rm.matches = await evaluate(`matchMedia('(prefers-reduced-motion: reduce)').matches`);
        rm.reduced = await evaluate("__rea.animations()");
      } catch (e) {
        rm.error = String(e.message).slice(0, 160);
      } finally {
        await page.send("Emulation.setEmulatedMedia", { features: [] }).catch(() => {});
      }
      writeJson("reduced-motion.json", rm);
      summary.steps.push({ name: "reduced-motion" });
    }

    writeJson("summary.json", summary);
    const finished = new Date().toISOString();
    const runBody =
      JSON.stringify(
        {
          flow: "watch",
          width,
          height,
          url: safeUrl(START_URL),
          watchUrl: summary.watchUrl ? summary.watchUrl.url : null,
          startedAt,
          finishedAt: finished,
          chrome: version,
          summary,
          artifacts: written,
        },
        null,
        1,
      ) + "\n";
    writeFileSync(path.join(outDir, "run.json"), runBody);
    writeFileSync(
      path.resolve(path.dirname(outDir), "manifest.jsonl"),
      JSON.stringify({
        flow: "watch",
        width,
        height,
        dir: path.relative(path.resolve("."), outDir).replace(/\\/g, "/"),
        startedAt,
        finishedAt: finished,
        url: safeUrl(START_URL),
        chrome: version.product,
        artifacts: written.length,
        runSha256: sha256(runBody),
        steps: summary.steps.map((s) => s.name),
      }) + "\n",
      { flag: "a" },
    );
    console.log(
      JSON.stringify(
        {
          ok: true,
          scene: "watch",
          dir: outDir,
          width,
          steps: summary.steps,
          watch: summary.watchUrl
            ? {
                player: summary.watchUrl.player,
                title: summary.watchUrl.title,
                upnext: summary.watchUrl.upnext,
              }
            : null,
        },
        null,
        1,
      ),
    );
    await cleanup();
    return;
  }

  if (String(args["probe-only"]) === "true") {
    const probe = {
      ok: true,
      probe: true,
      width,
      cards: summary.cards,
      seed,
      meta: summary.meta,
      bodyText: await evaluate("__rea.bodyText()"),
      chrome: await evaluate("__rea.chromeProbe()"),
      feedSignature: await evaluate("__rea.feedSignature()"),
    };
    writeJson("probe.json", probe);
    console.log(JSON.stringify(probe, null, 1));
    await cleanup();
    return;
  }

  // --- debug: discover live selectors and behaviours (not part of the spec) ---
  if (String(args.scenario) === "debug") {
    const FEED = `(() => { const items = Array.from(document.querySelectorAll('ytd-rich-item-renderer')).filter(function (e) { return e.getBoundingClientRect().width > 0; }); const titles = items.map(function (c) { const a = Array.from(c.querySelectorAll('a[href*="/watch"]')).sort(function (x, y) { return y.innerText.length - x.innerText.length; })[0]; return a ? a.innerText.trim().slice(0, 40) : ''; }).filter(Boolean); let h = 0; const s = titles.join('|'); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return { count: items.length, hash: h, scrollHeight: document.documentElement.scrollHeight, y: window.scrollY, url: location.href.replace(/([?&][^=]+=)[^&]*/g, '$1…') }; })()`;

    const dbg = { meta: await evaluate("__rea.meta()"), feed: await evaluate(FEED) };

    dbg.cards = await evaluate(
      `Array.from(document.querySelectorAll('ytd-rich-item-renderer')).filter(function (e) { return e.getBoundingClientRect().width > 0; }).slice(0, 4).map(function (c, i) { const r = c.getBoundingClientRect(); return { i: i, box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, buttons: Array.from(c.querySelectorAll('button')).filter(function (b) { return b.getBoundingClientRect().width > 0; }).map(function (b) { const br = b.getBoundingClientRect(); return { label: b.getAttribute('aria-label'), box: { x: Math.round(br.x), y: Math.round(br.y), w: Math.round(br.width), h: Math.round(br.height) } }; }) }; })`,
    );

    dbg.chips = await evaluate(
      `Array.from(document.querySelectorAll('yt-chip-cloud-chip-renderer')).filter(function (e) { return e.getBoundingClientRect().width > 0; }).map(function (e, i) { const r = e.getBoundingClientRect(); return { i: i, selected: e.classList.contains('iron-selected'), label: (e.innerText || '').trim().slice(0, 30), box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } }; })`,
    );

    // menu: first card that has a "More actions" button (skips the sponsored tile)
    const menuBtn = await evaluate(
      `(() => { const items = Array.from(document.querySelectorAll('ytd-rich-item-renderer')).filter(function (e) { return e.getBoundingClientRect().width > 0; }); for (const c of items) { const b = Array.from(c.querySelectorAll('button')).find(function (b2) { return /more actions|action menu/i.test(b2.getAttribute('aria-label') || '') && b2.getBoundingClientRect().width > 0; }); if (b) { const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), label: b.getAttribute('aria-label') }; } } return null; })()`,
    );
    dbg.menuButton = menuBtn;
    if (menuBtn) {
      await click(menuBtn);
      await sleep(800);
      dbg.menu = await evaluate(
        `(() => { const roles = Array.from(document.querySelectorAll('[role="menu"], [role="menuitem"], [role="dialog"]')).filter(function (e) { return e.getBoundingClientRect().width > 0; }); const popups = Array.from(document.querySelectorAll('*')).filter(function (e) { const r = e.getBoundingClientRect(); if (r.width < 100 || r.height < 60) return false; const role = e.getAttribute('role'); const cls = typeof e.className === 'string' ? e.className : ''; return role === 'menu' || role === 'dialog' || /popup|dropdown|listbox/i.test(e.tagName.toLowerCase()) || /popup|dropdown/i.test(cls); }).slice(0, 10).map(function (e) { const r = e.getBoundingClientRect(); return { tag: e.tagName.toLowerCase(), role: e.getAttribute('role'), box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, text: (e.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 80) }; }); return { roles: roles.length, roleNames: roles.slice(0, 8).map(function (e) { return (e.getAttribute('role') || '') + ':' + (e.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 30); }), popups: popups }; })()`,
      );
      dbg.menuAx = await page.send("Accessibility.getFullAXTree").then(function (r) {
        return r.nodes
          .filter(function (n) {
            return ["menu", "menuitem", "dialog"].indexOf(n.role && n.role.value) >= 0;
          })
          .slice(0, 12)
          .map(function (n) {
            return { role: n.role.value, name: n.name && n.name.value };
          });
      });
      await capture("debug-menu-open");
      await pressKey("Escape", "Escape", 27);
      await sleep(500);
      dbg.menuClosed = await evaluate(`document.querySelectorAll('[role="menu"]').length`);
      dbg.focusAfterEscape = await evaluate("__rea.active()");
      await capture("debug-menu-closed");
    }

    // chip: click the first unselected chip, measure until the feed changes
    const chipPoint = await evaluate(
      `(() => { const els = Array.from(document.querySelectorAll('yt-chip-cloud-chip-renderer')).filter(function (e) { return e.getBoundingClientRect().width > 0 && !e.classList.contains('iron-selected'); }); const el = els[0]; if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), label: (el.innerText || '').trim().slice(0, 30) }; })()`,
    );
    if (chipPoint) {
      const before = dbg.feed;
      const t0 = Date.now();
      await click(chipPoint);
      let changed = null;
      for (let i = 0; i < 160; i++) {
        await sleep(50);
        const f = await evaluate(FEED);
        if (f.hash !== before.hash || f.count !== before.count) {
          changed = { ms: Date.now() - t0, count: f.count, hash: f.hash, url: f.url };
          break;
        }
      }
      await sleep(1500);
      dbg.chip = {
        clicked: chipPoint,
        changed,
        after: await evaluate(FEED),
        selected: await evaluate(
          `Array.from(document.querySelectorAll('yt-chip-cloud-chip-renderer.iron-selected')).map(function (e) { return (e.innerText || '').trim().slice(0, 30); })`,
        ),
      };
      await capture("debug-chip-applied");
    }

    // scroll: does the virtualised grid grow?
    dbg.scroll = { before: await evaluate(FEED) };
    await evaluate("__rea.scrollToEnd()");
    await sleep(3000);
    dbg.scroll.after = await evaluate(FEED);
    dbg.scroll.spinner = await evaluate(
      `!!document.querySelector('tp-yt-paper-spinner[active], ytd-continuation-item-renderer')`,
    );

    // guide rail: hover the mini guide and watch the drawer geometry
    await evaluate("window.scrollTo(0, 0)");
    await sleep(300);
    dbg.guide = { samples: [] };
    const guideT0 = Date.now();
    await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 30, y: 420 });
    for (const at of [120, 400, 900]) {
      const wait = at - (Date.now() - guideT0);
      if (wait > 0) await sleep(wait);
      dbg.guide.samples.push({
        at: Date.now() - guideT0,
        boxes: await evaluate("__rea.guideBox()"),
      });
    }
    await capture("debug-guide-hover");
    await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 700, y: 700 });
    await sleep(600);
    dbg.guide.after = await evaluate("__rea.guideBox()");

    // card hover: does an inline preview appear, and how fast?
    const cardPoint = await evaluate(
      `(() => { const items = Array.from(document.querySelectorAll('ytd-rich-item-renderer')).filter(function (e) { return e.getBoundingClientRect().width > 0; }); const c = items[1] || items[0]; if (!c) return null; const thumb = c.querySelector('a[href*="/watch"]') || c; const r = thumb.getBoundingClientRect(); const cr = c.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + Math.min(r.height / 2, 110)), card: { x: Math.round(cr.x), y: Math.round(cr.y), w: Math.round(cr.width), h: Math.round(cr.height) } }; })()`,
    );
    dbg.hover = { target: cardPoint, samples: [] };
    if (cardPoint) {
      await page.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: cardPoint.x,
        y: cardPoint.y,
      });
      const hoverT0 = Date.now();
      for (const at of [200, 700, 1500, 2600]) {
        const wait = at - (Date.now() - hoverT0);
        if (wait > 0) await sleep(wait);
        dbg.hover.samples.push({
          at: Date.now() - hoverT0,
          probe: await evaluate(
            `(() => { const videos = Array.from(document.querySelectorAll('video')).filter(function (v) { return v.getBoundingClientRect().width > 0; }); const card = Array.from(document.querySelectorAll('ytd-rich-item-renderer')).filter(function (e) { return e.getBoundingClientRect().width > 0; })[1] || null; const cr = card ? card.getBoundingClientRect() : null; const inCard = videos.filter(function (v) { const r = v.getBoundingClientRect(); return cr && r.x >= cr.x - 2 && r.x <= cr.right && r.y >= cr.y - 2 && r.y <= cr.bottom; }); return { videos: videos.length, inCard: inCard.length, playing: inCard.some(function (v) { return !v.paused; }), hovered: card ? card.matches(':hover') : null, domCount: document.querySelectorAll('*').length }; })()`,
          ),
        });
      }
      await capture("debug-card-hover");
    }

    writeJson("debug.json", dbg);
    console.log(
      JSON.stringify(
        {
          ok: true,
          debug: true,
          width: width,
          feed: dbg.feed,
          menuButton: dbg.menuButton,
          menu: dbg.menu ? { roles: dbg.menu.roles, popups: dbg.menu.popups.length } : null,
          menuAx: dbg.menuAx,
          chip: dbg.chip ? { clicked: dbg.chip.clicked, changed: dbg.chip.changed } : null,
          scroll: dbg.scroll,
          guide: dbg.guide.samples.map(function (s) {
            return {
              at: s.at,
              guide: s.boxes["ytd-guide-renderer"],
              mini: s.boxes["ytd-mini-guide-renderer"],
            };
          }),
          hover: dbg.hover.samples,
        },
        null,
        1,
      ),
    );
    await cleanup();
    return;
  }

  // --- deep appearance probe (components, not guessed selectors) -----------
  if (String(args.scenario) === "styles-deep") {
    const deep = await evaluate("__rea.deepStyles()");
    writeJson("styles-deep.json", deep);
    console.log(JSON.stringify({ ok: true, stylesDeep: true, width: width, deep: deep }, null, 1));
    await cleanup();
    return;
  }

  if (want("baseline")) {
    summary.state = summary.cards > 0 ? "ready" : "state-empty";
    summary.steps.push(await capture(summary.state));
    writeJson("timing.json", await evaluate("__rea.timing()"));
    writeJson("chrome.json", await evaluate("__rea.chromeProbe()"));
    writeJson("network.json", network.slice());
    writeJson("console.json", { console: consoleRecords, log: logRecords, exceptions });
    summary.steps[summary.steps.length - 1].network = network.length;
    summary.steps[summary.steps.length - 1].console = consoleRecords.length;
  }

  if (want("styles")) {
    const selectors = [
      "ytd-masthead",
      "#masthead-container",
      "ytd-searchbox",
      "input#search",
      "ytd-mini-guide-renderer",
      "ytd-guide-renderer",
      "#guide",
      "ytm-pivot-bar-renderer",
      "#chips, ytd-feed-filter-chip-bar-renderer",
      "yt-chip-cloud-chip-renderer",
      "ytd-rich-grid-renderer",
      "ytd-rich-item-renderer",
      "ytd-rich-item-renderer #thumbnail",
      "ytd-rich-item-renderer ytd-thumbnail",
      "ytd-thumbnail-overlay-time-status-renderer",
      "ytd-thumbnail-overlay-time-status-renderer #text",
      "ytd-rich-item-renderer #video-title",
      "ytd-rich-item-renderer a#video-title-link",
      "ytd-rich-item-renderer #channel-name",
      "ytd-rich-item-renderer ytd-channel-name #text",
      "ytd-rich-item-renderer #metadata-line",
      "ytd-rich-item-renderer #metadata-line span",
      "ytd-shelf-renderer",
      "ytd-rich-shelf-renderer",
      "#title-container",
      "#footer, ytd-guide-footer-renderer",
    ];
    writeJson("styles.json", {
      viewport: { width, height },
      tokens: await evaluate("__rea.tokens()"),
      elements: await evaluate(`__rea.styles(${JSON.stringify(selectors)}, 2)`),
    });
  }

  // --- keyboard -----------------------------------------------------------
  if (want("keyboard")) {
    const keyboard = { steps: [], firstTab: null, slash: null, escapeReturn: null };
    await evaluate(
      "document.activeElement && document.activeElement.blur(); document.body.focus();",
    );
    await sleep(120);
    const kbStart = Date.now();
    for (let i = 1; i <= 16; i++) {
      await pressKey("Tab", "Tab", 9);
      await sleep(90);
      const active = await evaluate("__rea.active()");
      keyboard.steps.push({ step: i, ms: Date.now() - kbStart, active });
      if (i === 1) {
        await capture("kbd-01-first-tab");
        keyboard.firstTab = active;
      }
    }
    // reverse: shift+tab should retrace
    await pressKey("Tab", "Tab", 9, 8);
    await sleep(90);
    keyboard.shiftTab = await evaluate("__rea.active()");

    // "/" shortcut focus behaviour
    await evaluate(
      "document.activeElement && document.activeElement.blur(); document.body.focus();",
    );
    await sleep(120);
    await pressKey("/", "Slash", 191);
    await sleep(250);
    keyboard.slash = await evaluate("__rea.active()");
    await capture("kbd-slash-search");

    writeJson("keyboard.json", keyboard);
    summary.steps.push({ name: "keyboard", tabs: keyboard.steps.length });
  }

  // --- hover --------------------------------------------------------------
  if (want("hover")) {
    const point = await evaluate("__rea.cardPoint(1)");
    const hover = { target: point, samples: [], previewStartMs: null };
    if (point) {
      await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
      const t0 = Date.now();
      for (const at of [150, 300, 450, 600, 900, 1400, 2200]) {
        const wait = at - (Date.now() - t0);
        if (wait > 0) await sleep(wait);
        const probe = await evaluate("__rea.hoverProbe()");
        hover.samples.push({ at: Date.now() - t0, probe });
        if (hover.previewStartMs == null && probe.overlapping > 0)
          hover.previewStartMs = Date.now() - t0;
      }
      await capture("hover-card-2200");
      await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1270, y: 790 });
      await sleep(400);
      hover.afterLeave = await evaluate("__rea.hoverProbe()");
      await capture("hover-card-left");
    }
    writeJson("hover.json", hover);
    summary.steps.push({
      name: "hover",
      samples: hover.samples.length,
      previewStartMs: hover.previewStartMs,
    });
  }

  // --- card menu ----------------------------------------------------------
  if (want("menu")) {
    const menu = {
      openMs: null,
      opened: false,
      roles: null,
      items: [],
      escapeCloseMs: null,
      focusReturn: null,
    };
    const point = await evaluate("__rea.menuPoint()");
    if (point) {
      await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
      await sleep(150);
      await click(point);
      const t0 = Date.now();
      for (let i = 0; i < 120; i++) {
        await sleep(20);
        const state = await evaluate("__rea.popupState()");
        if (state.open) {
          menu.openMs = Date.now() - t0;
          menu.opened = true;
          menu.roles = state;
          break;
        }
      }
      if (menu.opened) {
        await capture("menu-open");
        menu.items = await evaluate(
          `Array.from(document.querySelectorAll('[role="menuitem"]')).filter(function (e) { return e.getBoundingClientRect().width > 0; }).map(function (e) { const r = e.getBoundingClientRect(); return { label: (e.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 40), box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } }; })`,
        );
        writeJson("menu-items.json", menu.items);
        const esc0 = Date.now();
        await pressKey("Escape", "Escape", 27);
        for (let i = 0; i < 60; i++) {
          await sleep(20);
          const state = await evaluate("__rea.popupState()");
          if (!state.open) {
            menu.escapeCloseMs = Date.now() - esc0;
            break;
          }
        }
        menu.focusReturn = await evaluate("__rea.active()");
        await capture("menu-closed");
      }
    }
    writeJson("menu.json", menu);
    summary.steps.push({ name: "menu", opened: menu.opened, openMs: menu.openMs });
  }

  // --- chip ---------------------------------------------------------------
  if (want("chip")) {
    const chip = {
      clicked: null,
      before: null,
      firstChangeMs: null,
      settleMs: null,
      after: null,
      selected: null,
    };
    chip.before = await evaluate("__rea.feedSignature()");
    const point = await evaluate("__rea.bootChip()");
    if (point) {
      chip.clicked = point;
      const t0 = Date.now();
      await click(point);
      let first = null;
      let last = chip.before;
      let stableSince = null;
      for (let i = 0; i < 200; i++) {
        await sleep(50);
        const sig = await evaluate("__rea.feedSignature()");
        if (first == null && sig !== chip.before) first = Date.now() - t0;
        if (sig === last && sig !== chip.before) {
          if (stableSince == null) stableSince = Date.now();
        } else {
          stableSince = null;
          last = sig;
        }
        if (first != null && stableSince != null && Date.now() - stableSince > 700) {
          chip.settleMs = Date.now() - t0;
          break;
        }
        if (Date.now() - t0 > 12000) break;
      }
      chip.firstChangeMs = first;
      chip.after = await evaluate("__rea.feedSignature()");
      chip.selected = await evaluate(
        `Array.from(document.querySelectorAll('yt-chip-cloud-chip-renderer.iron-selected')).map(function (e) { return (e.innerText || '').trim().slice(0, 24); })`,
      );
      await capture("chip-applied");
    }
    writeJson("chip.json", chip);
    summary.steps.push({
      name: "chip",
      clicked: !!point,
      firstChangeMs: chip.firstChangeMs,
      settleMs: chip.settleMs,
    });
  }

  // --- infinite scroll ----------------------------------------------------
  if (want("scroll")) {
    const scroll = {
      before: null,
      after: null,
      firstGrowthMs: null,
      settledMs: null,
      spinnerSeen: false,
    };
    scroll.before = await evaluate("__rea.scrollState()");
    const t0 = Date.now();
    await evaluate("__rea.scrollToEnd()");
    for (let i = 0; i < 200; i++) {
      await sleep(50);
      const state = await evaluate("__rea.scrollState()");
      if (state.spinner) scroll.spinnerSeen = true;
      if (scroll.firstGrowthMs == null && state.scrollHeight > scroll.before.scrollHeight + 100) {
        scroll.firstGrowthMs = Date.now() - t0;
      }
      if (scroll.firstGrowthMs != null && !state.spinner && state.cards !== scroll.before.cards) {
        scroll.settledMs = Date.now() - t0;
        scroll.after = state;
        break;
      }
      if (Date.now() - t0 > 10000) break;
    }
    if (!scroll.after) {
      await evaluate("__rea.scrollToEnd()");
      await sleep(1500);
      scroll.after = await evaluate("__rea.scrollState()");
    }
    await capture("scroll-more");
    writeJson("scroll.json", scroll);
    summary.steps.push({
      name: "scroll",
      firstGrowthMs: scroll.firstGrowthMs,
      spinnerSeen: scroll.spinnerSeen,
    });
  }

  // --- guide (desktop only): the rail toggles from the masthead button -----
  if (want("guide") && width >= 1000) {
    const guide = { before: null, after: null, openMs: null, samples: [] };
    guide.before = await evaluate("__rea.guideBox()");
    const btn = await evaluate(
      `(() => { const b = document.querySelector('#guide-button, yt-icon-button#guide-button'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`,
    );
    if (btn) {
      const t0 = Date.now();
      await click(btn);
      for (let i = 0; i < 80; i++) {
        await sleep(30);
        const box = await evaluate("__rea.guideBox()");
        const g = box["ytd-guide-renderer"];
        if (g && g.w > 200 && g.x === 0 && g.y >= 50) {
          guide.openMs = Date.now() - t0;
          guide.after = box;
          break;
        }
      }
      for (const at of [400, 800, 1400]) {
        await sleep(400);
        guide.samples.push({ at, boxes: await evaluate("__rea.guideBox()") });
      }
      await capture("guide-expanded");
      await click(btn);
      await sleep(600);
      guide.closed = await evaluate("__rea.guideBox()");
      await capture("guide-closed");
    }
    writeJson("guide.json", guide);
    summary.steps.push({ name: "guide", openMs: guide.openMs });
  }

  // --- loading state (hold the first feed request on a cold profile) ------
  if (want("loading")) {
    const loading = { paused: false, samples: [], firstCardMs: null };
    try {
      await resetStorage();
      await page.send("Fetch.enable", {
        patterns: [{ urlPattern: "*youtubei/v1/browse*", requestStage: "Request" }],
      });
      const pausedPromise = browser.waitFor(
        "Fetch.requestPaused",
        (m) => m.params.request.url.includes("/youtubei/v1/browse"),
        20000,
      );
      await page.send("Page.navigate", { url: START_URL });
      const paused = await pausedPromise;
      loading.paused = true;
      const t0 = Date.now();
      for (const at of [300, 1200]) {
        const wait = at - (Date.now() - t0);
        if (wait > 0) await sleep(wait);
        loading.samples.push({
          at: Date.now() - t0,
          skeleton: await evaluate(
            `({ skeletons: document.querySelectorAll('ytd-skeleton, [class*="skeleton"], [class*="shimmer"], [class*="ghost"]').length, ghostCards: document.querySelectorAll('ytd-rich-item-renderer').length, spinner: !!document.querySelector('tp-yt-paper-spinner[active], ytd-continuation-item-renderer'), chips: document.querySelectorAll('yt-chip-cloud-chip-renderer').length, bodyText: __rea.bodyText().slice(0, 120) })`,
          ),
        });
        if (at === 300) await capture("state-loading-300");
        else await capture("state-loading-1200");
      }
      await page.send("Fetch.continueRequest", { requestId: paused.requestId }).catch(() => {});
      await page.send("Fetch.disable").catch(() => {});
      const t1 = Date.now();
      for (let i = 0; i < 200; i++) {
        await sleep(50);
        const cards = await evaluate(
          `Array.from(document.querySelectorAll('ytd-rich-item-renderer')).filter(function (e) { return e.getBoundingClientRect().width > 0; }).length`,
        );
        if (cards > 0) {
          loading.firstCardMs = Date.now() - t1;
          break;
        }
        if (Date.now() - t1 > 12000) break;
      }
      await waitSettle({ minMs: 1000, quiet: 800, timeout: 15000 });
      loading.resolved = await evaluate("__rea.scrollState()");
      await capture("state-loading-resolved");
    } catch (err) {
      loading.error = String(err.message).slice(0, 200);
      await page.send("Fetch.disable").catch(() => {});
    }
    writeJson("loading.json", loading);
    summary.steps.push({
      name: "loading",
      paused: loading.paused,
      firstCardMs: loading.firstCardMs,
    });
  }

  // --- error state (feed requests blocked on a cold profile) --------------
  if (want("error")) {
    const errorState = { retry: null, recovered: false, samples: [] };
    try {
      await resetStorage();
      await page.send("Network.setBlockedURLs", {
        urls: ["*youtubei/v1/browse*", "*youtubei/v1/guide*", "*youtubei/v1/next*"],
      });
      await page.send("Page.navigate", { url: START_URL });
      const t0 = Date.now();
      for (const at of [4000, 12000]) {
        const wait = at - (Date.now() - t0);
        if (wait > 0) await sleep(wait);
        const snap = await evaluate(
          `({ bodyText: __rea.bodyText(), skeletons: document.querySelectorAll('ytd-skeleton, [class*="skeleton"], [class*="ghost"]').length, cards: Array.from(document.querySelectorAll('ytd-rich-item-renderer')).filter(function (e) { return e.getBoundingClientRect().width > 0; }).length, alerts: Array.from(document.querySelectorAll('[role="alert"], ytd-alert-with-button-renderer, tp-yt-paper-toast')).filter(function (e) { return e.getBoundingClientRect().width > 0; }).map(function (e) { return (e.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 80); }) })`,
        );
        errorState.samples.push({
          at: Date.now() - t0,
          bodyText: snap.bodyText,
          skeletons: snap.skeletons,
          cards: snap.cards,
          alerts: snap.alerts,
        });
        if (at === 4000) await capture("state-error-4s");
        else await capture("state-error-12s");
      }
      errorState.retry = await evaluate('__rea.findButtonByText("retry|try again|reload")');
      if (errorState.retry) {
        await page.send("Network.setBlockedURLs", { urls: [] });
        const t1 = Date.now();
        await click(errorState.retry);
        for (let i = 0; i < 200; i++) {
          await sleep(50);
          const cards = await evaluate(
            `Array.from(document.querySelectorAll('ytd-rich-item-renderer')).filter(function (e) { return e.getBoundingClientRect().width > 0; }).length`,
          );
          if (cards > 0) {
            errorState.recovered = true;
            errorState.recoverMs = Date.now() - t1;
            break;
          }
          if (Date.now() - t1 > 12000) break;
        }
        await capture("state-recovered");
      }
    } catch (err) {
      errorState.error = String(err.message).slice(0, 200);
    } finally {
      await page.send("Network.setBlockedURLs", { urls: [] }).catch(() => {});
    }
    writeJson("error-state.json", errorState);
    summary.steps.push({
      name: "error",
      retry: !!errorState.retry,
      recovered: errorState.recovered,
    });
  }

  // --- offline ------------------------------------------------------------
  if (want("offline")) {
    const offline = { coldSamples: [], warmSamples: [] };
    try {
      await page.send("Emulation.setEmulatedMedia", { features: [] });
      await resetStorage();
      await page.send("Network.emulateNetworkConditions", {
        offline: true,
        latency: 0,
        downloadThroughput: -1,
        uploadThroughput: -1,
      });
      await page.send("Page.navigate", { url: START_URL }).catch(() => {});
      const t0 = Date.now();
      for (const at of [3000, 8000]) {
        const wait = at - (Date.now() - t0);
        if (wait > 0) await sleep(wait);
        offline.coldSamples.push({
          at: Date.now() - t0,
          meta: await evaluate("__rea.meta()").catch(() => null),
          bodyText: await evaluate("__rea.bodyText()").catch(() => null),
        });
        if (at === 3000) await capture("state-offline-cold-3s").catch(() => null);
        else await capture("state-offline-cold-8s").catch(() => null);
      }
      // warm: restore, load a feed, drop the network, then trigger a feed request
      await page.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: 0,
        downloadThroughput: -1,
        uploadThroughput: -1,
      });
      await go(START_URL, { minMs: 2200, quiet: 800, timeout: 18000 });
      await page.send("Network.emulateNetworkConditions", {
        offline: true,
        latency: 0,
        downloadThroughput: -1,
        uploadThroughput: -1,
      });
      const chipPoint = await evaluate("__rea.bootChip()");
      offline.warmTriggered = !!chipPoint;
      if (chipPoint) {
        const t1 = Date.now();
        await click(chipPoint);
        for (const at of [1500, 4500]) {
          const wait = at - (Date.now() - t1);
          if (wait > 0) await sleep(wait);
          offline.warmSamples.push({
            at: Date.now() - t1,
            bodyText: await evaluate("__rea.bodyText()").catch(() => null),
            alerts: await evaluate(
              `Array.from(document.querySelectorAll('[role="alert"], tp-yt-paper-toast, ytd-alert-with-button-renderer')).filter(function (e) { return e.getBoundingClientRect().width > 0; }).map(function (e) { return (e.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 80); })`,
            ).catch(() => []),
            cards: await evaluate(
              `document.querySelectorAll('ytd-rich-item-renderer').length`,
            ).catch(() => null),
          });
          if (at === 1500) await capture("state-offline-warm-1500").catch(() => null);
          else await capture("state-offline-warm-4500").catch(() => null);
        }
      }
    } catch (err) {
      offline.error = String(err.message).slice(0, 200);
    } finally {
      await page
        .send("Network.emulateNetworkConditions", {
          offline: false,
          latency: 0,
          downloadThroughput: -1,
          uploadThroughput: -1,
        })
        .catch(() => {});
    }
    writeJson("offline.json", offline);
    summary.steps.push({
      name: "offline",
      warm: offline.warmTriggered,
      cold: offline.coldSamples.length,
    });
  }

  // --- reduced motion -----------------------------------------------------
  if (want("reduced-motion")) {
    const rm = {};
    try {
      rm.baselineAnimations = await evaluate("__rea.animations()");
      rm.baselineChipTransition = await evaluate(
        `(() => { const c = document.querySelector('yt-chip-cloud-chip-renderer'); return c ? getComputedStyle(c).transitionDuration : null; })()`,
      );
      await page.send("Emulation.setEmulatedMedia", {
        features: [{ name: "prefers-reduced-motion", value: "reduce" }],
      });
      rm.matches = await evaluate(`matchMedia('(prefers-reduced-motion: reduce)').matches`);
      await go(START_URL, { minMs: 2000, quiet: 800, timeout: 15000 });
      rm.animations = await evaluate("__rea.animations()");
      rm.chipTransition = await evaluate(
        `(() => { const c = document.querySelector('yt-chip-cloud-chip-renderer'); return c ? getComputedStyle(c).transitionDuration : null; })()`,
      );
      rm.timing = await evaluate("__rea.timing()");
      await capture("state-reduced-motion");
    } catch (err) {
      rm.error = String(err.message).slice(0, 200);
    } finally {
      await page.send("Emulation.setEmulatedMedia", { features: [] }).catch(() => {});
    }
    writeJson("reduced-motion.json", rm);
    summary.steps.push({
      name: "reduced-motion",
      count: rm.animations ? rm.animations.count : null,
    });
  }

  // --- finalise -----------------------------------------------------------
  const finishedAt = new Date().toISOString();
  summary.finishedAt = finishedAt;
  summary.startedAt = startedAt;
  summary.network = network.length;
  summary.console = consoleRecords.length;
  summary.exceptions = exceptions.length;
  summary.log = logRecords.length;
  summary.requestedSteps = [...stepsWanted];

  const runRecord = {
    flow: FLOW,
    width,
    height,
    url: START_URL,
    startedAt,
    finishedAt,
    chrome: version,
    userAgent: version.userAgent,
    artifacts: written,
    summary,
  };
  const runBody = JSON.stringify(runRecord, null, 1) + "\n";
  writeFileSync(path.join(outDir, "run.json"), runBody);

  // append to the flow manifest (one line per run, digest-anchored)
  const manifestPath = path.resolve(path.dirname(outDir), "manifest.jsonl");
  const entry = {
    flow: FLOW,
    width,
    height,
    dir: path.relative(path.resolve("."), outDir).replace(/\\/g, "/"),
    startedAt,
    finishedAt,
    chrome: version.product,
    url: START_URL,
    artifactCount: written.length,
    runSha256: sha256(runBody),
    steps: summary.steps.map((s) => s.name),
  };
  writeFileSync(manifestPath, JSON.stringify(entry) + "\n", { flag: "a" });

  console.log(
    JSON.stringify(
      {
        ok: true,
        dir: outDir,
        width,
        height,
        steps: summary.steps,
        artifacts: written.length,
        chrome: version.product,
      },
      null,
      1,
    ),
  );

  // --- cleanup -----------------------------------------------------------
  await cleanup();
}

main().catch((err) => {
  console.error("CAPTURE FAILED:", err && err.stack ? err.stack : String(err));
  process.exitCode = 1;
});
