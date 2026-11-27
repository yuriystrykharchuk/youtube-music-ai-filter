/*
 * Runs the real content script in jsdom with a fake chrome.* API and a
 * minimal YouTube Music player bar, then checks the actions it takes.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const opened = [];
test.afterEach(() => { while (opened.length) opened.pop().close(); });
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

function makeChrome(initialSettings) {
  const store = { sync: { settings: initialSettings }, local: {} };
  const listeners = [];
  const area = (name) => ({
    async get(key) { return { [key]: store[name][key] }; },
    async set(obj) {
      const changes = {};
      for (const [k, v] of Object.entries(obj)) {
        changes[k] = { oldValue: store[name][k], newValue: JSON.parse(JSON.stringify(v)) };
        store[name][k] = JSON.parse(JSON.stringify(v));
      }
      listeners.forEach((l) => l(changes, name));
    }
  });
  return {
    store,
    i18n: { getMessage: (k) => k, getUILanguage: () => 'en' },
    storage: { sync: area('sync'), local: area('local'), onChanged: { addListener: (l) => listeners.push(l) } },
    runtime: { onMessage: { addListener() {} } }
  };
}

function setup({ settings, label, artist = 'Robo Band', signedIn = true } = {}) {
  const dom = new JSDOM(
    `<!doctype html><html><body>
      <ytmusic-nav-bar>${signedIn ? '' : '<a href="https://accounts.google.com/ServiceLogin">Sign in</a>'}</ytmusic-nav-bar>
      <ytmusic-player-page><div class="chip">${label || ''}</div></ytmusic-player-page>
      <ytmusic-player-bar>
        <div class="content-info-wrapper">
          <div class="title">Neon Rain</div>
          <div class="byline"><a href="/channel/x">${artist}</a> • Album • 2026</div>
        </div>
        <ytmusic-like-button-renderer>
          <div id="button-shape-dislike"><button aria-pressed="false">dislike</button></div>
        </ytmusic-like-button-renderer>
        <div class="next-button"><button>next</button></div>
      </ytmusic-player-bar>
    </body></html>`,
    { url: 'https://music.youtube.com/watch?v=vid1', runScripts: 'outside-only', pretendToBeVisual: true }
  );
  const w = dom.window;
  opened.push(w);
  const clicks = { next: 0, dislike: 0 };
  w.document.querySelector('.next-button button').addEventListener('click', () => clicks.next++);
  w.document.querySelector('#button-shape-dislike button').addEventListener('click', () => clicks.dislike++);
  w.chrome = makeChrome(settings);
  w.Element.prototype.animate = function () { return {}; };
  w.eval(read('src/shared/detect.js'));
  w.eval(read('src/shared/settings.js'));
  w.eval(read('src/content/content.js'));
  return { w, clicks, chrome: w.chrome };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const base = (over = {}) => ({
  enabled: true,
  labels: { full: true, partly: false },
  actions: { skip: true, dislike: true, autoBlock: false, skipBlocked: true, toast: true },
  delaySec: 0,
  patterns: { full: ['Fully Gen AI'], partly: ['Partly Gen AI'] },
  blocklist: [],
  whitelist: [],
  ...over
});

test('Fully Gen AI label → dislike + skip + toast + stats', async () => {
  const { w, clicks, chrome } = setup({ settings: base(), label: 'Fully Gen AI' });
  await wait(4000);
  assert.strictEqual(clicks.dislike, 1);
  assert.strictEqual(clicks.next, 1);
  assert.ok(w.document.getElementById('ytm-ai-filter-toast'), 'toast shown');
  assert.strictEqual(chrome.store.local.stats.total, 1);
  w.close();
});

test('Partly label is ignored when not selected', async () => {
  const { w, clicks } = setup({ settings: base(), label: 'Partly Gen AI' });
  await wait(3600);
  assert.strictEqual(clicks.next, 0);
  assert.strictEqual(clicks.dislike, 0);
  w.close();
});

test('Partly label acted on when selected; dislike off respected', async () => {
  const s = base({ labels: { full: true, partly: true } });
  s.actions.dislike = false;
  const { w, clicks } = setup({ settings: s, label: 'Partly Gen AI' });
  await wait(3600);
  assert.strictEqual(clicks.next, 1);
  assert.strictEqual(clicks.dislike, 0);
  w.close();
});

test('No Gen AI never triggers', async () => {
  const { w, clicks } = setup({ settings: base({ labels: { full: true, partly: true } }), label: 'No Gen AI' });
  await wait(3600);
  assert.strictEqual(clicks.next, 0);
  w.close();
});

test('Blocklisted artist skipped without a label', async () => {
  const { w, clicks } = setup({ settings: base({ blocklist: [{ name: 'robo band', source: 'manual' }] }) });
  await wait(3600);
  assert.strictEqual(clicks.next, 1);
  w.close();
});

test('Whitelist beats label', async () => {
  const { w, clicks } = setup({ settings: base({ whitelist: ['Robo Band'] }), label: 'Fully Gen AI' });
  await wait(3600);
  assert.strictEqual(clicks.next, 0);
  w.close();
});

test('Auto-block adds the artist', async () => {
  const s = base();
  s.actions.autoBlock = true;
  const { w, chrome } = setup({ settings: s, label: 'Fully Gen AI' });
  await wait(4000);
  assert.strictEqual(chrome.store.sync.settings.blocklist[0].name, 'Robo Band');
  assert.strictEqual(chrome.store.sync.settings.blocklist[0].source, 'auto');
  w.close();
});

test('Disabled filter does nothing', async () => {
  const { w, clicks } = setup({ settings: base({ enabled: false }), label: 'Fully Gen AI' });
  await wait(3600);
  assert.strictEqual(clicks.next + clicks.dislike, 0);
  w.close();
});

test('Signed out: skips but does not press dislike', async () => {
  const { w, clicks } = setup({ settings: base(), label: 'Fully Gen AI', signedIn: false });
  await wait(3900);
  assert.strictEqual(clicks.dislike, 0);
  assert.strictEqual(clicks.next, 1);
  w.close();
});

test('Delay + Undo cancels the skip', async () => {
  const { w, clicks } = setup({ settings: base({ delaySec: 2 }), label: 'Fully Gen AI' });
  await wait(3200);
  const sr = w.document.getElementById('ytm-ai-filter-toast').shadowRoot;
  sr.querySelector('button').click();
  await wait(2500);
  assert.strictEqual(clicks.next, 0);
  assert.strictEqual(clicks.dislike, 0);
  w.close();
});
