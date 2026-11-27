/*
 * Content script (isolated world) on music.youtube.com.
 * Decides whether the current track should be acted on and performs the actions:
 * skip, dislike, add artist to blocklist, show a toast with "Undo".
 */
(function () {
  'use strict';
  const D = window.YTMAIDetect;
  const S = window.YTMAISettings;
  const SRC = 'ytm-ai-filter';
  const t = (key, subs) => chrome.i18n.getMessage(key, subs) || key;

  let settings = S.DEFAULT_SETTINGS;
  const labelMap = Object.create(null); // videoId -> 'full' | 'partly'
  let pageVideoId = null;

  const state = {
    key: null, // videoId or title|artist of the current track
    handled: false,
    pendingTimer: null,
    status: 'idle', // idle | clean | whitelisted | pending | acted | cancelled
    reason: null, // 'full' | 'partly' | 'blocked'
    track: { videoId: null, title: '', artist: '' },
    skippedKeys: new Set(), // tracks the user un-did, never touch them again this session
    changedAt: 0
  };
  // After a track change the player page can still show the previous track's label for a moment.
  const DOM_SETTLE_MS = 1500;

  // ---------- page bridge ----------
  function toPage(type, payload) {
    window.postMessage({ source: SRC, dir: 'content', type, payload }, location.origin);
  }
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.source !== SRC || e.data.dir !== 'page') return;
    const { type, payload } = e.data;
    if (type === 'labels' && payload) {
      for (const [vid, kind] of Object.entries(payload)) labelMap[vid] = D.strongest(labelMap[vid], kind);
    } else if (type === 'labels-reset' && payload) {
      for (const k of Object.keys(labelMap)) delete labelMap[k];
      Object.assign(labelMap, payload);
    } else if (type === 'now' && payload) {
      pageVideoId = payload.videoId || pageVideoId;
    }
  });

  // ---------- DOM helpers ----------
  const $ = (sel, rootEl) => (rootEl || document).querySelector(sel);

  function firstMatch(selectors, rootEl) {
    for (const s of selectors) {
      const el = $(s, rootEl);
      if (el) return el;
    }
    return null;
  }

  function currentTrack() {
    const bar = $('ytmusic-player-bar');
    if (!bar) return null;
    const titleEl = firstMatch(['.title.ytmusic-player-bar', '.content-info-wrapper .title', '.title'], bar);
    const bylineEl = firstMatch(['.byline.ytmusic-player-bar', '.content-info-wrapper .byline', '.byline'], bar);
    const title = (titleEl && (titleEl.getAttribute('title') || titleEl.textContent) || '').trim();
    let artist = '';
    if (bylineEl) {
      const link = bylineEl.querySelector('a');
      artist = (link ? link.textContent : (bylineEl.getAttribute('title') || bylineEl.textContent).split('•')[0]).trim();
    }
    let videoId = pageVideoId;
    if (!videoId) {
      try {
        videoId = new URL(location.href).searchParams.get('v');
      } catch (_) {}
    }
    if (!title) return null;
    return { videoId, title, artist };
  }

  /** Text of small elements in the player page / player bar, plus aria-labels and titles. */
  function collectLabelTexts() {
    const roots = [$('ytmusic-player-page'), $('ytmusic-player-bar')].filter(Boolean);
    const texts = [];
    for (const r of roots) {
      const walker = document.createTreeWalker(r, NodeFilter.SHOW_TEXT);
      let n = 0;
      while (walker.nextNode() && n < 4000) {
        n++;
        const v = walker.currentNode.nodeValue;
        if (v && v.length < 80 && /ai|ші|шi/i.test(v)) texts.push(v);
      }
      r.querySelectorAll('[aria-label],[title]').forEach((el) => {
        const a = el.getAttribute('aria-label');
        const ti = el.getAttribute('title');
        if (a && a.length < 120) texts.push(a);
        if (ti && ti.length < 120) texts.push(ti);
      });
    }
    return texts;
  }

  function isSignedIn() {
    // Signed-out pages show a "Sign in" link in the top bar.
    return !$('ytmusic-nav-bar a[href*="ServiceLogin"], ytmusic-nav-bar .sign-in-link');
  }

  function clickNext() {
    const btn = firstMatch([
      'ytmusic-player-bar .next-button button',
      'ytmusic-player-bar .next-button',
      'ytmusic-player-bar [aria-label="Next"]',
      'ytmusic-player-bar [aria-label="Наступна"]',
      'ytmusic-player-bar [aria-label="Далі"]'
    ]);
    if (btn) {
      btn.click();
      return true;
    }
    const video = $('video');
    if (video && isFinite(video.duration)) {
      video.currentTime = Math.max(0, video.duration - 0.25);
      return true;
    }
    return false;
  }

  function clickPrevious() {
    const btn = firstMatch(['ytmusic-player-bar .previous-button button', 'ytmusic-player-bar .previous-button']);
    if (btn) {
      btn.click();
      setTimeout(() => btn.click(), 150); // first click restarts, second goes back
    }
  }

  function clickDislike() {
    if (!isSignedIn()) return false;
    const bar = $('ytmusic-player-bar');
    if (!bar) return false;
    const btn = firstMatch(
      [
        'ytmusic-like-button-renderer #button-shape-dislike button',
        'ytmusic-like-button-renderer .dislike button',
        'ytmusic-like-button-renderer .dislike',
        'ytmusic-like-button-renderer [aria-label="Dislike"]',
        'ytmusic-like-button-renderer [aria-label="Не подобається"]'
      ],
      bar
    );
    if (!btn) return false;
    if (btn.getAttribute('aria-pressed') === 'true') return false; // already disliked
    btn.click();
    return true;
  }

  // ---------- toast (shadow DOM so the page can't style it and we never scan it) ----------
  const SVG_NS = 'http://www.w3.org/2000/svg';
  function el(tag, cls, content) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (Array.isArray(content)) e.append(...content);
    else if (content != null) e.textContent = content;
    return e;
  }
  function skipIcon() {
    const wrap = el('div', 'i');
    const svg = document.createElementNS(SVG_NS, 'svg');
    for (const [k, v] of Object.entries({ width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: '#121214', 'stroke-width': 2.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(k, v);
    const poly = document.createElementNS(SVG_NS, 'polygon');
    poly.setAttribute('points', '5 4 15 12 5 20 5 4');
    const line = document.createElementNS(SVG_NS, 'line');
    for (const [k, v] of Object.entries({ x1: 19, y1: 5, x2: 19, y2: 19 })) line.setAttribute(k, v);
    svg.append(poly, line);
    wrap.appendChild(svg);
    return wrap;
  }
  let toastHost = null;
  function toast({ title, subtitle, delayMs, onUndo }) {
    if (!toastHost) {
      toastHost = document.createElement('div');
      toastHost.id = 'ytm-ai-filter-toast';
      toastHost.style.cssText = 'position:fixed;left:24px;bottom:96px;z-index:2147483647;';
      toastHost.attachShadow({ mode: 'open' });
      document.documentElement.appendChild(toastHost);
    }
    const sr = toastHost.shadowRoot;
    sr.replaceChildren(); // no innerHTML: YouTube enforces Trusted Types
    const style = document.createElement('style');
    style.textContent = `
      .t{font:14px/1.4 Inter,Roboto,system-ui,sans-serif;color:#EDEDEF;background:#1C1C20;border:1px solid #33333A;border-radius:12px;
         padding:14px 16px;display:flex;align-items:center;gap:14px;width:380px;box-sizing:border-box;position:relative;overflow:hidden;
         box-shadow:0 8px 24px rgba(0,0,0,.45);animation:in .18s ease-out}
      .i{width:34px;height:34px;border-radius:10px;background:#F5A524;flex-shrink:0;display:flex;align-items:center;justify-content:center}
      .x{flex:1;min-width:0}.a{font-weight:600}.b{font-size:13px;color:#A1A1AA;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      button{font:600 13px Inter,Roboto,system-ui,sans-serif;height:36px;padding:0 12px;border-radius:8px;border:1px solid #3A3A42;background:transparent;color:#EDEDEF;cursor:pointer}
      button:hover{background:#26262B}
      .p{position:absolute;left:0;bottom:0;height:3px;background:#F5A524;width:100%}
      @keyframes in{from{transform:translateY(8px);opacity:0}to{transform:none;opacity:1}}`;
    sr.appendChild(style);
    const box = document.createElement('div');
    box.className = 't';
    box.setAttribute('role', 'status');
    box.append(skipIcon(), el('div', 'x', [el('div', 'a', title), el('div', 'b', subtitle)]));
    if (onUndo) {
      const undo = document.createElement('button');
      undo.textContent = t('undo');
      undo.addEventListener('click', () => {
        onUndo();
        hide();
      });
      box.appendChild(undo);
    }
    if (delayMs > 0) {
      const bar = document.createElement('div');
      bar.className = 'p';
      box.appendChild(bar);
      bar.animate([{ width: '100%' }, { width: '0%' }], { duration: delayMs, easing: 'linear', fill: 'forwards' });
    }
    sr.appendChild(box);
    clearTimeout(toast._t);
    toast._t = setTimeout(hide, Math.max(delayMs, 0) + 3500);
    function hide() {
      if (box.isConnected) box.remove();
    }
  }

  // ---------- decision loop ----------
  function trackKey(tr) {
    return tr.videoId || `${tr.title}|${tr.artist}`;
  }

  function labelName(reason) {
    if (reason === 'full') return 'Fully Gen AI';
    if (reason === 'partly') return 'Partly Gen AI';
    return t('reasonBlocked');
  }

  function cancelPending() {
    if (state.pendingTimer) clearTimeout(state.pendingTimer);
    state.pendingTimer = null;
  }

  async function act(reason, tr) {
    const a = settings.actions;
    let disliked = 0;
    let skipped = 0;
    if (a.dislike && clickDislike()) disliked = 1;
    if (reason !== 'blocked' && a.autoBlock && tr.artist) {
      await S.addToBlocklist(tr.artist, 'auto', reason);
    }
    if (a.skip) {
      // small gap so the dislike registers before the track changes
      await new Promise((r) => setTimeout(r, disliked ? 400 : 0));
      if (trackKey(currentTrack() || {}) === state.key && clickNext()) skipped = 1;
    }
    state.status = 'acted';
    if (skipped || disliked) S.bumpStats({ skipped, disliked }).catch(() => {});
  }

  function trigger(reason, tr) {
    state.handled = true;
    state.reason = reason;
    const a = settings.actions;
    if (!a.skip && !a.dislike && !(a.autoBlock && reason !== 'blocked')) {
      state.status = 'detected';
      return;
    }
    const delayMs = Math.max(0, Number(settings.delaySec) || 0) * 1000;
    const key = state.key;
    const titleKey = a.skip ? 'toastSkipping' : 'toastDetected';
    if (a.toast) {
      try {
        toast({
        title: t(titleKey),
        subtitle: `${tr.title} · ${tr.artist} · ${labelName(reason)}`,
        delayMs,
        onUndo: () => {
          if (state.pendingTimer && state.key === key) {
            cancelPending();
            state.status = 'cancelled';
            state.skippedKeys.add(key);
          } else if (state.status === 'acted') {
            state.skippedKeys.add(key);
            clickPrevious();
          }
        }
      });
      } catch (err) {
        console.warn('[YTM AI Filter] toast failed', err); // never let the UI block the actions
      }
    }
    state.status = 'pending';
    cancelPending();
    state.pendingTimer = setTimeout(() => {
      state.pendingTimer = null;
      if (state.key !== key) return; // track already changed
      act(reason, tr);
    }, delayMs);
  }

  function tick() {
    const tr = currentTrack();
    if (!tr) return;
    const key = trackKey(tr);
    if (key !== state.key) {
      cancelPending();
      state.key = key;
      state.handled = false;
      state.status = 'idle';
      state.reason = null;
      state.track = tr;
      state.changedAt = Date.now();
    } else {
      state.track = tr; // artist link may load later
    }
    if (!settings.enabled || state.handled || state.skippedKeys.has(key)) return;

    const names = D.artistNames(tr.artist);
    if (names.some((n) => D.inList(n, settings.whitelist))) {
      state.status = 'whitelisted';
      return;
    }
    if (settings.actions.skipBlocked && names.some((n) => D.inList(n, settings.blocklist))) {
      trigger('blocked', tr);
      return;
    }
    let label = tr.videoId ? labelMap[tr.videoId] || null : null;
    if (Date.now() - state.changedAt >= DOM_SETTLE_MS) {
      label = D.strongest(label, D.scanTexts(collectLabelTexts(), settings.patterns));
    }
    state.reason = label;
    if (label && settings.labels[label]) {
      trigger(label, tr);
    } else {
      state.status = label ? 'labelIgnored' : 'clean';
    }
  }

  // ---------- popup messages ----------
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    (async () => {
      if (msg.type === 'getState') {
        sendResponse({ ok: true, track: state.track, status: state.status, reason: state.reason, signedIn: isSignedIn() });
      } else if (msg.type === 'blockCurrent') {
        if (state.track.artist) await S.addToBlocklist(state.track.artist, 'manual', state.reason);
        state.handled = false;
        sendResponse({ ok: true });
      } else if (msg.type === 'whitelistCurrent') {
        if (state.track.artist) await S.addToWhitelist(state.track.artist);
        cancelPending();
        state.skippedKeys.add(state.key);
        state.status = 'whitelisted';
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false });
      }
    })();
    return true;
  });

  // ---------- boot ----------
  S.get().then((s) => {
    settings = s;
    toPage('patterns', settings.patterns);
    toPage('ping');
  });
  S.onChange((s) => {
    if (!s) return;
    const patternsChanged = JSON.stringify(s.patterns) !== JSON.stringify(settings.patterns);
    settings = s;
    if (patternsChanged) toPage('patterns', settings.patterns);
    if (!settings.enabled) cancelPending();
    if (state.status !== 'acted' && state.status !== 'pending') state.handled = false; // re-evaluate with new rules
  });
  setInterval(tick, 700);
})();
