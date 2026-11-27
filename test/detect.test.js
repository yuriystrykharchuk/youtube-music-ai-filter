const test = require('node:test');
const assert = require('node:assert');
const D = require('../src/shared/detect.js');

test('matchLabel finds full and partly labels', () => {
  assert.strictEqual(D.matchLabel('Fully Gen AI'), 'full');
  assert.strictEqual(D.matchLabel('  partly   gen ai '), 'partly');
  assert.strictEqual(D.matchLabel('Label: Fully Gen AI · How this was made'), 'full');
});

test('matchLabel ignores No Gen AI and unrelated text', () => {
  assert.strictEqual(D.matchLabel('No Gen AI'), null);
  assert.strictEqual(D.matchLabel('Sustain'), null);
  assert.strictEqual(D.matchLabel('Fully Gen AIs'), null); // whole-phrase only
  assert.strictEqual(D.matchLabel(''), null);
});

test('custom patterns work, incl. Cyrillic', () => {
  const p = { full: ['Повністю ШІ'], partly: ['Частково ШІ'] };
  assert.strictEqual(D.matchLabel('Повністю ШІ', p), 'full');
  assert.strictEqual(D.matchLabel('частково ші', p), 'partly');
  assert.strictEqual(D.matchLabel('Fully Gen AI', p), null);
});

test('scanTexts prefers full over partly', () => {
  assert.strictEqual(D.scanTexts(['x', 'Partly Gen AI', 'Fully Gen AI']), 'full');
  assert.strictEqual(D.scanTexts(['x', 'Partly Gen AI']), 'partly');
  assert.strictEqual(D.scanTexts(['x', 'y']), null);
});

test('findLabelsInJson attributes labels to the owning video', () => {
  const data = {
    contents: {
      queue: [
        { playlistPanelVideoRenderer: { videoId: 'aaa', badges: [{ text: 'Fully Gen AI' }] } },
        { playlistPanelVideoRenderer: { videoId: 'bbb', badges: [{ text: 'No Gen AI' }] } },
        { playlistPanelVideoRenderer: { videoId: 'ccc', title: { runs: [{ text: 'Song' }] }, chips: ['Partly Gen AI'] } }
      ]
    },
    playerOverlays: { disclosure: { label: { simpleText: 'Partly Gen AI' } } }
  };
  const map = D.findLabelsInJson(data, undefined, 'current');
  assert.deepStrictEqual(map, { aaa: 'full', ccc: 'partly', current: 'partly' });
});

test('artistNames splits collaborations', () => {
  assert.deepStrictEqual(D.artistNames('A & B'), ['A & B', 'A', 'B']);
  assert.deepStrictEqual(D.artistNames('Solo'), ['Solo']);
  assert.deepStrictEqual(D.artistNames(''), []);
});

test('inList is case/space-insensitive and accepts objects', () => {
  assert.ok(D.inList('the  velvet sundown', [{ name: 'The Velvet Sundown' }]));
  assert.ok(D.inList('X', ['x']));
  assert.ok(!D.inList('', ['x']));
});
