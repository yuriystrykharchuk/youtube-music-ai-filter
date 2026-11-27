(async function () {
  'use strict';
  const S = window.YTMAISettings;
  const D = window.YTMAIDetect;
  const $ = (id) => document.getElementById(id);
  const t = window.t;

  let settings = await S.get();

  function flash(text) {
    $('msg').textContent = text;
    clearTimeout(flash._t);
    flash._t = setTimeout(() => ($('msg').textContent = ''), 3000);
  }

  async function save() {
    await S.set(settings);
    $('saved').textContent = t('savedNow');
    clearTimeout(save._t);
    save._t = setTimeout(() => ($('saved').textContent = t('autosave')), 1500);
  }

  function sourceText(item) {
    if (item.source === 'auto') {
      const lbl = item.label === 'partly' ? 'Partly Gen AI' : item.label === 'full' ? 'Fully Gen AI' : '';
      return t('addedAuto') + (lbl ? ' · ' + lbl : '');
    }
    return t('addedManual');
  }

  function render() {
    $('enabled').checked = settings.enabled;
    $('label-full').checked = settings.labels.full;
    $('label-partly').checked = settings.labels.partly;
    for (const k of Object.keys(settings.actions)) {
      const el = $('act-' + k);
      if (el) el.checked = !!settings.actions[k];
    }
    $('delay').value = String(settings.delaySec);
    if (!$('delay').value) $('delay').value = '2';
    if (document.activeElement !== $('pat-full')) $('pat-full').value = settings.patterns.full.join('\n');
    if (document.activeElement !== $('pat-partly')) $('pat-partly').value = settings.patterns.partly.join('\n');

    const ul = $('blocklist');
    ul.textContent = '';
    const sorted = settings.blocklist.slice().sort((a, b) => a.name.localeCompare(b.name));
    for (const item of sorted) {
      const li = document.createElement('li');
      const who = document.createElement('div');
      who.className = 'who';
      const name = document.createElement('strong');
      name.textContent = item.name;
      const src = document.createElement('span');
      src.className = 'muted';
      src.textContent = sourceText(item);
      who.append(name, src);
      const rm = document.createElement('button');
      rm.textContent = t('remove');
      rm.setAttribute('aria-label', t('remove') + ': ' + item.name);
      rm.addEventListener('click', async () => {
        await S.removeFromBlocklist(item.name);
      });
      li.append(who, rm);
      ul.appendChild(li);
    }
    $('blockEmpty').hidden = sorted.length > 0;

    const wl = $('whitelist');
    wl.textContent = '';
    for (const name of settings.whitelist.slice().sort((a, b) => a.localeCompare(b))) {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.append(document.createTextNode(name));
      const x = document.createElement('button');
      x.textContent = '×';
      x.setAttribute('aria-label', t('remove') + ': ' + name);
      x.addEventListener('click', () => S.removeFromWhitelist(name));
      chip.appendChild(x);
      wl.appendChild(chip);
    }
  }

  // inputs
  $('enabled').addEventListener('change', (e) => { settings.enabled = e.target.checked; save(); });
  $('label-full').addEventListener('change', (e) => { settings.labels.full = e.target.checked; save(); });
  $('label-partly').addEventListener('change', (e) => { settings.labels.partly = e.target.checked; save(); });
  for (const k of Object.keys(S.DEFAULT_SETTINGS.actions)) {
    const el = $('act-' + k);
    if (el) el.addEventListener('change', (e) => { settings.actions[k] = e.target.checked; save(); });
  }
  $('delay').addEventListener('change', (e) => { settings.delaySec = Number(e.target.value); save(); });

  function readPatterns(id) {
    return $(id).value.split('\n').map((s) => s.trim()).filter(Boolean);
  }
  for (const [id, kind] of [['pat-full', 'full'], ['pat-partly', 'partly']]) {
    $(id).addEventListener('change', () => {
      const list = readPatterns(id);
      settings.patterns[kind] = list.length ? list : D.DEFAULT_PATTERNS[kind].slice();
      save();
      render();
    });
  }

  $('blockForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = $('blockInput').value.trim();
    if (!v) return;
    await S.addToBlocklist(v, 'manual');
    $('blockInput').value = '';
  });
  $('whiteForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = $('whiteInput').value.trim();
    if (!v) return;
    await S.addToWhitelist(v);
    $('whiteInput').value = '';
  });

  // data
  $('exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ app: 'ytm-ai-filter', version: 1, settings }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'ytm-ai-filter-settings.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('importBtn').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      if (!j || j.app !== 'ytm-ai-filter' || !j.settings) throw new Error('bad file');
      const merged = Object.assign({}, S.DEFAULT_SETTINGS, j.settings);
      await S.set(merged);
      flash(t('importOk'));
    } catch (_) {
      flash(t('importFail'));
    }
  });
  $('resetStatsBtn').addEventListener('click', async () => {
    if (!confirm(t('confirmResetStats'))) return;
    await S.resetStats();
    flash(t('statsReset'));
  });
  $('resetAllBtn').addEventListener('click', async () => {
    if (!confirm(t('confirmResetAll'))) return;
    await S.reset();
    flash(t('allReset'));
  });

  S.onChange((s) => {
    if (!s) return;
    settings = s;
    render();
  });
  render();
})();
