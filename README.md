# YTM AI Filter

Chrome extension that skips, dislikes or blocks tracks that **YouTube Music** labels as AI-generated.
You choose which labels to react to and what to do.

🇺🇦 [Українською нижче](#українською)

## Features

- **Labels:** react to `Fully Gen AI`, `Partly Gen AI`, or both.
- **Actions:** skip the track, press 👎 (trains your recommendations, also on your phone), auto-add the artist to a blocklist.
- **Blocklist:** artists on it are skipped right away, even with no label. Add them by hand, from the popup, or automatically.
- **Whitelist:** artists the extension never touches.
- **Undo:** an on-page notification with a short delay (0 / 2 / 5 s) and an Undo button.
- **Stats:** skipped today / total, artists blocked.
- **Editable label text:** if YouTube Music shows the labels in your language, add the translated text in *Advanced*.
- Settings sync across your Chrome browsers. English and Ukrainian UI.

## Install (developer mode)

1. Download this repo (**Code → Download ZIP**) and unzip it, or `git clone` it.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the folder that contains `manifest.json`.
4. Pin the extension and open its settings.

Works in Chrome, Edge, Brave and other Chromium browsers on desktop. It does not work in the YouTube Music phone app, but dislikes it makes on desktop do affect recommendations on your phone.

## How detection works

YouTube Music started labelling AI tracks on the player page in October 2026. The extension finds the label in two ways:

1. **From the data YouTube Music loads** (`youtubei/v1/next`, `player`, `browse`): a small page script reads those responses and looks for the label text, mapped to the video it belongs to. This also catches AI tracks in the queue before they play.
2. **From the page:** text and `aria-label`s in the player page and player bar.

It waits 1.5 s after a track changes before reading the page, so a label left over from the previous track can't trigger a skip.

Limits worth knowing:

- Only tracks YouTube itself labels are caught. A missing label doesn't mean a track is human-made — use the blocklist for those.
- Dislike needs you to be signed in; signed out, the extension only skips.
- If YouTube changes its page markup, selectors may need an update.

## Privacy

No analytics, no network requests of its own, no remote code. Everything runs locally on `music.youtube.com`. Permissions: `storage` (your settings) and access to `music.youtube.com`.

## Development

```bash
npm install
npm test
```

```
manifest.json
src/shared/detect.js     label matching, JSON walking (pure, tested)
src/shared/settings.js   settings, blocklist/whitelist, stats
src/content/inject.js    page script: reads youtubei responses, reports current video
src/content/content.js   decisions + actions + toast
src/popup/               toolbar popup
src/options/             settings page
_locales/en, _locales/uk
test/                    node:test + jsdom
```

---

## Українською

Розширення для Chrome, яке пропускає, дизлайкає або блокує треки з AI-міткою в **YouTube Music**. Ти сам обираєш мітки й дії.

**Можливості:** вибір міток (`Fully Gen AI`, `Partly Gen AI`), дії (пропуск, 👎, автоматичне додавання артиста в чорний список), чорний і білий списки, сповіщення з кнопкою «Скасувати» та затримкою, статистика, редагований текст міток. Налаштування синхронізуються між твоїми браузерами Chrome.

**Встановлення:**

1. Завантаж репозиторій (**Code → Download ZIP**) і розпакуй.
2. Відкрий `chrome://extensions`, увімкни **Режим розробника**.
3. Натисни **Завантажити розпаковане** і вибери папку з `manifest.json`.

Розширення працює тільки в браузері на комп'ютері. Але дизлайки, які воно ставить, впливають на рекомендації й на телефоні.

**Обмеження:** розширення ловить лише треки, які позначив сам YouTube; для решти є чорний список. Для дизлайків потрібен вхід в акаунт.

## License

MIT
