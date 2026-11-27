/*
 * Pure detection helpers, shared by the page script (MAIN world),
 * the content script and the unit tests. No DOM or chrome.* access here.
 */
(function (root) {
  'use strict';

  /** Default label strings YouTube Music shows on the player page. Editable in settings. */
  const DEFAULT_PATTERNS = {
    full: ['Fully Gen AI'],
    partly: ['Partly Gen AI']
  };

  function normalize(s) {
    return String(s || '')
      .normalize('NFKC')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  /**
   * Returns 'full' | 'partly' | null for a single piece of text.
   * 'full' wins when both match. A pattern must match as a whole phrase,
   * so "No Gen AI" never matches "Gen AI"-style patterns by accident.
   */
  function matchLabel(text, patterns) {
    const t = normalize(text);
    if (!t) return null;
    const p = patterns || DEFAULT_PATTERNS;
    for (const kind of ['full', 'partly']) {
      for (const raw of p[kind] || []) {
        const needle = normalize(raw);
        if (!needle) continue;
        const idx = t.indexOf(needle);
        if (idx === -1) continue;
        const before = idx === 0 ? ' ' : t[idx - 1];
        const after = idx + needle.length >= t.length ? ' ' : t[idx + needle.length];
        if (!/[\p{L}\p{N}]/u.test(before) && !/[\p{L}\p{N}]/u.test(after)) return kind;
      }
    }
    return null;
  }

  /** Picks the strongest label from many texts ('full' > 'partly'). */
  function strongest(a, b) {
    if (a === 'full' || b === 'full') return 'full';
    if (a === 'partly' || b === 'partly') return 'partly';
    return null;
  }

  function scanTexts(texts, patterns) {
    let best = null;
    for (const t of texts) {
      best = strongest(best, matchLabel(t, patterns));
      if (best === 'full') break;
    }
    return best;
  }

  /**
   * Walks a youtubei JSON response and returns { videoId: label }.
   * A matched string is attributed to the nearest enclosing object that
   * carries a videoId; strings with no such ancestor go to fallbackVideoId
   * (the video the request was made for).
   */
  function findLabelsInJson(data, patterns, fallbackVideoId) {
    const out = {};
    const stack = [{ node: data, vid: null, depth: 0 }];
    while (stack.length) {
      const { node, vid, depth } = stack.pop();
      if (depth > 80 || node == null) continue;
      if (typeof node === 'string') {
        const kind = matchLabel(node, patterns);
        const target = vid || fallbackVideoId;
        if (kind && target) out[target] = strongest(out[target], kind);
        continue;
      }
      if (typeof node !== 'object') continue;
      let here = vid;
      if (!Array.isArray(node) && typeof node.videoId === 'string' && !node.watchEndpoint) {
        // Objects like playlistPanelVideoRenderer own their videoId.
        here = node.videoId;
      }
      const values = Array.isArray(node) ? node : Object.values(node);
      for (const v of values) {
        if (v && (typeof v === 'object' || typeof v === 'string')) {
          stack.push({ node: v, vid: here, depth: depth + 1 });
        }
      }
    }
    return out;
  }

  function sameArtist(a, b) {
    return normalize(a) !== '' && normalize(a) === normalize(b);
  }

  function inList(name, list) {
    const n = normalize(name);
    if (!n) return false;
    return (list || []).some((item) => normalize(typeof item === 'string' ? item : item.name) === n);
  }

  /**
   * Splits a player-bar artist string like "Artist A & Artist B" or "A, B"
   * into names, keeping the full string too.
   */
  function artistNames(raw) {
    const full = String(raw || '').trim();
    if (!full) return [];
    const parts = full.split(/\s*(?:,|&|\bfeat\.?|\bft\.?|\bx\b)\s*/i).map((s) => s.trim()).filter(Boolean);
    return Array.from(new Set([full, ...parts]));
  }

  const api = { DEFAULT_PATTERNS, normalize, matchLabel, scanTexts, strongest, findLabelsInJson, sameArtist, inList, artistNames };
  root.YTMAIDetect = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
