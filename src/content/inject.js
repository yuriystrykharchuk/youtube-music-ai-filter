/*
 * Runs in the page's MAIN world at document_start.
 * 1) Wraps fetch/XHR to read youtubei "next"/"player"/"browse" responses and
 *    find AI label strings, mapped to the video they belong to.
 * 2) Reports the id of the currently playing video.
 * Talks to the content script with window.postMessage. Never sends data anywhere else.
 */
(function () {
  'use strict';
  if (window.__ytmAiFilterInjected) return;
  window.__ytmAiFilterInjected = true;

  const D = window.YTMAIDetect;
  const SRC = 'ytm-ai-filter';
  let patterns = D.DEFAULT_PATTERNS;
  const pending = []; // responses seen before patterns arrived

  const WATCHED = /\/youtubei\/v1\/(next|player|browse|music\/get_queue)\b/;

  function post(type, payload) {
    window.postMessage({ source: SRC, dir: 'page', type, payload }, location.origin);
  }

  function videoIdFromBody(body) {
    if (!body || typeof body !== 'string') return null;
    try {
      const j = JSON.parse(body);
      return j.videoId || (Array.isArray(j.videoIds) ? j.videoIds[0] : null) || null;
    } catch (_) {
      return null;
    }
  }

  function inspect(text, reqVideoId) {
    if (!text || text.length > 8e6) return;
    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      return;
    }
    const map = D.findLabelsInJson(data, patterns, reqVideoId);
    if (Object.keys(map).length) post('labels', map);
    pending.push({ data, reqVideoId });
    if (pending.length > 10) pending.shift();
  }

  // fetch
  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : input && input.url;
    const p = origFetch.apply(this, arguments);
    if (url && WATCHED.test(url)) {
      const body = init && typeof init.body === 'string' ? init.body : null;
      p.then((res) => {
        try {
          res.clone().text().then((t) => inspect(t, videoIdFromBody(body)), () => {});
        } catch (_) {}
      }, () => {});
    }
    return p;
  };

  // XHR (fallback, YTM mostly uses fetch)
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__ytmAiUrl = url;
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    if (this.__ytmAiUrl && WATCHED.test(String(this.__ytmAiUrl))) {
      this.addEventListener('load', () => {
        try {
          if (this.responseType === '' || this.responseType === 'text') inspect(this.responseText, videoIdFromBody(body));
        } catch (_) {}
      });
    }
    return origSend.apply(this, arguments);
  };

  // Current video id from the player API.
  let lastVid = null;
  setInterval(() => {
    let vid = null;
    try {
      const mp = document.getElementById('movie_player');
      const vd = mp && typeof mp.getVideoData === 'function' ? mp.getVideoData() : null;
      vid = (vd && vd.video_id) || null;
    } catch (_) {}
    if (!vid) {
      try {
        vid = new URL(location.href).searchParams.get('v');
      } catch (_) {}
    }
    if (vid && vid !== lastVid) {
      lastVid = vid;
      post('now', { videoId: vid });
    }
  }, 500);

  // Patterns from the content script (user-editable).
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.source !== SRC || e.data.dir !== 'content') return;
    if (e.data.type === 'patterns' && e.data.payload) {
      patterns = e.data.payload;
      // Re-scan what we have already seen with the new patterns.
      const merged = {};
      for (const { data, reqVideoId } of pending) {
        Object.assign(merged, D.findLabelsInJson(data, patterns, reqVideoId));
      }
      post('labels-reset', merged);
    } else if (e.data.type === 'ping') {
      post('now', { videoId: lastVid });
    }
  });
})();
