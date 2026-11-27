(async function () {
  'use strict';
  const S = window.YTMAISettings;
  const $ = (id) => document.getElementById(id);
  const t = window.t;

  $('version').textContent = 'v' + chrome.runtime.getManifest().version;
  $('openOptions').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  let settings = await S.get();
  let tabId = null;

  async function activeYtmTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab ? tab.id : null;
  }

  async function ask(type) {
    if (tabId == null) return null;
    try {
      return await chrome.tabs.sendMessage(tabId, { type });
    } catch (_) {
      return null; // not a YouTube Music tab, or the page is not ready
    }
  }

  function renderSettings() {
    $('enabled').checked = settings.enabled;
    $('statusText').textContent = t(settings.enabled ? 'filterOn' : 'filterOff');
    document.body.classList.toggle('disabled', !settings.enabled);
    const rules = [];
    if (settings.labels.full) rules.push('Fully Gen AI');
    if (settings.labels.partly) rules.push('Partly Gen AI');
    if (settings.actions.skip) rules.push(t('ruleSkip'));
    if (settings.actions.dislike) rules.push(t('ruleDislike'));
    if (settings.actions.autoBlock) rules.push(t('ruleAutoBlock'));
    if (settings.actions.skipBlocked) rules.push(t('ruleSkipBlocked'));
    if (settings.actions.toast) rules.push(t('ruleToast'));
    const box = $('rules');
    box.textContent = '';
    for (const r of rules) {
      const c = document.createElement('span');
      c.className = 'chip';
      c.textContent = r;
      box.appendChild(c);
    }
    $('statBlocked').textContent = settings.blocklist.length;
  }

  async function renderStats() {
    const st = await S.getStats();
    $('statToday').textContent = st.byDay[S.today()] || 0;
    $('statTotal').textContent = st.total;
  }

  const STATUS_KEYS = {
    idle: 'statusChecking',
    clean: 'statusClean',
    labelIgnored: 'statusLabelIgnored',
    whitelisted: 'statusWhitelisted',
    pending: 'statusPending',
    acted: 'statusActed',
    detected: 'statusDetected',
    cancelled: 'statusCancelled'
  };

  async function renderTrack() {
    const st = await ask('getState');
    const has = st && st.ok && st.track && st.track.title;
    $('trackTitle').textContent = has ? st.track.title : t('noTrack');
    $('trackArtist').textContent = has ? st.track.artist : t('openYtm');
    $('blockBtn').disabled = !has || !st.track.artist;
    $('notAiBtn').disabled = !has || !st.track.artist;
    const badge = $('labelBadge');
    if (has && st.reason) {
      badge.hidden = false;
      badge.textContent = st.reason === 'full' ? 'Fully Gen AI' : st.reason === 'partly' ? 'Partly Gen AI' : t('reasonBlocked');
      badge.classList.toggle('soft', st.status === 'labelIgnored');
    } else {
      badge.hidden = true;
    }
    $('trackStatus').textContent = has ? t(STATUS_KEYS[st.status] || 'statusChecking') : '';
  }

  $('enabled').addEventListener('change', async (e) => {
    settings.enabled = e.target.checked;
    await S.set(settings);
    renderSettings();
  });
  $('blockBtn').addEventListener('click', async () => {
    await ask('blockCurrent');
    settings = await S.get();
    renderSettings();
    renderTrack();
  });
  $('notAiBtn').addEventListener('click', async () => {
    await ask('whitelistCurrent');
    settings = await S.get();
    renderSettings();
    renderTrack();
  });

  tabId = await activeYtmTab();
  renderSettings();
  renderStats();
  renderTrack();
  setInterval(() => {
    renderTrack();
    renderStats();
  }, 1000);
})();
