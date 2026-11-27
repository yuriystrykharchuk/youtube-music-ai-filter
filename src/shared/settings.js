/* Settings and stats storage, shared by content script, popup and options page. */
(function (root) {
  'use strict';

  const D = root.YTMAIDetect;

  const DEFAULT_SETTINGS = {
    enabled: true,
    labels: { full: true, partly: false },
    actions: {
      skip: true,
      dislike: true,
      autoBlock: false,
      skipBlocked: true,
      toast: true
    },
    delaySec: 2,
    patterns: { full: D.DEFAULT_PATTERNS.full.slice(), partly: D.DEFAULT_PATTERNS.partly.slice() },
    blocklist: [], // [{ name, source: 'auto' | 'manual', label?: 'full' | 'partly', addedAt }]
    whitelist: [] // [name]
  };

  const DEFAULT_STATS = { total: 0, dislikes: 0, byDay: {} };

  function clone(o) {
    return JSON.parse(JSON.stringify(o));
  }

  function merge(defaults, saved) {
    const out = clone(defaults);
    if (!saved || typeof saved !== 'object') return out;
    for (const k of Object.keys(defaults)) {
      if (!(k in saved)) continue;
      const dv = defaults[k];
      const sv = saved[k];
      if (dv && typeof dv === 'object' && !Array.isArray(dv) && sv && typeof sv === 'object' && !Array.isArray(sv)) {
        out[k] = Object.assign({}, dv, sv);
      } else {
        out[k] = sv;
      }
    }
    return out;
  }

  function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  const Settings = {
    DEFAULT_SETTINGS,
    async get() {
      const { settings } = await chrome.storage.sync.get('settings');
      return merge(DEFAULT_SETTINGS, settings);
    },
    async set(settings) {
      await chrome.storage.sync.set({ settings });
      return settings;
    },
    async update(fn) {
      const s = await Settings.get();
      const next = (await fn(s)) || s;
      return Settings.set(next);
    },
    async reset() {
      return Settings.set(clone(DEFAULT_SETTINGS));
    },
    onChange(cb) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'sync' && changes.settings) cb(merge(DEFAULT_SETTINGS, changes.settings.newValue));
        if (area === 'local' && changes.stats) cb(null, Object.assign(clone(DEFAULT_STATS), changes.stats.newValue));
      });
    },

    async addToBlocklist(name, source, label) {
      return Settings.update((s) => {
        if (!name || D.inList(name, s.blocklist)) return s;
        s.blocklist.push({ name: name.trim(), source: source || 'manual', label: label || null, addedAt: Date.now() });
        s.whitelist = s.whitelist.filter((w) => D.normalize(w) !== D.normalize(name));
        return s;
      });
    },
    async removeFromBlocklist(name) {
      return Settings.update((s) => {
        s.blocklist = s.blocklist.filter((b) => D.normalize(b.name) !== D.normalize(name));
        return s;
      });
    },
    async addToWhitelist(name) {
      return Settings.update((s) => {
        if (!name || D.inList(name, s.whitelist)) return s;
        s.whitelist.push(name.trim());
        s.blocklist = s.blocklist.filter((b) => D.normalize(b.name) !== D.normalize(name));
        return s;
      });
    },
    async removeFromWhitelist(name) {
      return Settings.update((s) => {
        s.whitelist = s.whitelist.filter((w) => D.normalize(w) !== D.normalize(name));
        return s;
      });
    },

    async getStats() {
      const { stats } = await chrome.storage.local.get('stats');
      return Object.assign(clone(DEFAULT_STATS), stats || {});
    },
    async bumpStats({ skipped = 0, disliked = 0 } = {}) {
      const st = await Settings.getStats();
      st.total += skipped;
      st.dislikes += disliked;
      const day = today();
      st.byDay[day] = (st.byDay[day] || 0) + skipped;
      // keep last 60 days only
      const days = Object.keys(st.byDay).sort();
      while (days.length > 60) delete st.byDay[days.shift()];
      await chrome.storage.local.set({ stats: st });
      return st;
    },
    async resetStats() {
      await chrome.storage.local.set({ stats: clone(DEFAULT_STATS) });
    },
    today
  };

  root.YTMAISettings = Settings;
})(typeof globalThis !== 'undefined' ? globalThis : this);
