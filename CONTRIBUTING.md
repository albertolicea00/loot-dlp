# Contributing to loot-dlp

## Architecture overview

```
src/
  providers/          Site extractors — match a URL, scrape, return embed list
    vidsrc.js         Full provider (has own API, skips embed layer)
    cuevana.js        TODO
    animeboom.js      TODO
    index.js          Registry — add new providers here

  embeds/             Embed resolvers — take an embed URL, return a stream
    index.js          Registry — add new resolvers here
    (all TODO)

  downloader.js       Generic ffmpeg HLS/MP4 downloader + stall watchdog
  subtitles.js        subliminal download + ffsubsync sync

bin/
  loot-dlp.js         CLI entry point
```

## Adding a new site provider

1. Create `src/providers/<sitename>.js`:

```js
'use strict';

const name = 'sitename';

// Return true if this provider can handle rawInput
function match(rawInput) {
  return /sitename\.com/i.test(rawInput);
}

// Return StreamInfo: { title, m3u8, meta }
// meta = anything needed later by refresh()
async function resolve(rawInput, opts = {}) {
  // 1. Scrape the page (Playwright if JS-heavy, plain fetch if not)
  // 2. Collect embed URLs
  // 3. Call embeds.getResolver(embedUrl).resolve(embedUrl) for each until one works
  // 4. Return { title, m3u8, meta }
}

// Return fresh signed m3u8 URL when stream stalls
async function refresh(meta) {
  const { embeds } = require('../embeds/index');
  return embeds.getResolver(meta.embedUrl).refresh(meta.embedMeta);
}

module.exports = { name, match, resolve, refresh };
```

2. Add one line to `src/providers/index.js`:

```js
const sitename = require('./sitename');
// ...
const PROVIDERS = [
  vidsrc,
  sitename,  // <-- add here
  ...
];
```

Done. No other files need changes.

## Adding a new embed resolver

Embed resolvers live in `src/embeds/`. They handle third-party video hosts
(Streamtape, Doodstream, Mega.nz, etc.) that sites embed.

1. Create `src/embeds/<hostname>.js`:

```js
'use strict';

const name = 'streamtape';

function match(embedUrl) {
  return /streamtape\.com/i.test(embedUrl);
}

// Return { stream, type: 'hls'|'mp4', meta }
// stream = ready URL (signed if needed)
async function resolve(embedUrl) {
  // scrape or API-call the embed page to get the actual stream URL
}

// Return fresh stream URL
async function refresh(meta) { ... }

module.exports = { name, match, resolve, refresh };
```

2. Add one line to `src/embeds/index.js`:

```js
const streamtape = require('./streamtape');
const EMBEDS = [
  streamtape,  // <-- add here
  ...
];
```

## Mega.nz note

Mega is a file download, not a stream. The embed resolver for Mega should:
- Use `megajs` npm package (or `mega-cmd` CLI if installed)
- Skip ffmpeg entirely — download the file directly
- Return `{ type: 'mega', localPath }` so the CLI knows to skip the HLS downloader

## Prerequisites

```bash
brew install ffmpeg
pip3 install subliminal ffsubsync
npm install -g loot-dlp   # or: npm link in this repo
npx playwright install chromium
```

## Coding conventions

- Plain Node.js, no TypeScript, no build step
- No external HTTP libraries — use built-in `https`/`http`
- Provider/embed files are self-contained; cross-module deps only to `embeds/index.js`
- All code and comments in English
- No comments explaining *what* — only *why* when non-obvious
