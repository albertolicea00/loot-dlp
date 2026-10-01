# AGENTS.md — loot-dlp

Instructions for AI agents working in this repository.

## What this project is

`loot-dlp` is a Node.js CLI tool that downloads movies and series from streaming sites that use HLS (`.m3u8`) delivery behind embedded players. It is **not** a general web scraper — it targets specific platforms and resolves their stream URLs through a modular provider/embed system.

## Architecture (must understand before touching anything)

```
bin/loot-dlp.js          CLI entry: arg parsing, worker pool, progress dashboard
src/
  providers/
    index.js             Registry — first-match wins
    vidsrc.js            WORKING provider: vidsrc.sh API + WASM decrypt + CDN JWT
    cuevana.js           STUB — not implemented
    animeboom.js         STUB — not implemented
    base.js              Interface documentation (not code)
  embeds/
    index.js             Registry stub — no resolvers yet
  downloader.js          Generic ffmpeg HLS downloader with stall watchdog
  subtitles.js           subliminal + ffsubsync
scripts/reference/       Historical scripts — READ ONLY, do not modify
```

## Provider interface (critical)

Every provider exports exactly: `{ name, match, resolve, refresh }`

```js
name: string                              // identifier
match(rawInput) → bool                    // can this provider handle this URL/ID?
resolve(rawInput, opts) → StreamInfo      // resolve to stream
refresh(meta) → Promise<string>           // get fresh signed m3u8 URL when stalled
```

`StreamInfo = { title: string, m3u8: string, meta: object }`

`meta` is opaque — whatever `resolve()` puts in it, `refresh()` gets back.

## Downloader contract

`download({ m3u8, refresh, outFile, onProgress })` — generic, knows nothing about providers.

- Polls file mtime every `POLL_MS` (30s)
- If no write in `STALL_MS` (120s) → kills ffmpeg, calls `refresh()`, restarts
- Verifies moov atom with ffprobe before accepting output
- **Never kill ffmpeg externally while a download is running** — the moov atom is written at the very end; killing mid-stream = corrupt file with no moov

## The vidsrc provider (how it actually works)

1. `GET data.vidsrc.sh/api.php?type=movie&tmdb=XXXX&stream_urls`
2. Response has `data.stream_urls` (ChaCha20 encrypted, base64) and `vs.wasm_url`
3. Download WASM → `WebAssembly.instantiate` → `ex.alloc(len)` + `ex.decrypt(ptr, len)`
4. Output starts at `ptr + 12` (skip 12-byte nonce prefix) — **this is easy to get wrong**
5. Decoded output: newline-separated `.m3u8` base URLs
6. `GET {cdn}/generate.php` with Referer/Origin cloudorchestranova.com → IP-bound JWT (4h)
7. Append `?token=<jwt>` to m3u8 URL → ready to download

Token expires every 4h. The stall watchdog handles re-tokenization automatically.

## What to do when adding a new provider

Read `CONTRIBUTING.md`. The two-level flow is:
- **Site provider** (`src/providers/`) → scrapes catalog page → returns embed URL list
- **Embed resolver** (`src/embeds/`) → resolves embed URL → returns stream

vidsrc skips the embed layer (has its own API). Cuevana/animeboom will need both layers.

## What NOT to do

- Do not modify `scripts/reference/` — historical record only
- Do not add dependencies without a clear reason — `playwright` is already heavy
- Do not bypass the stall watchdog or add `process.exit()` in the middle of a download
- Do not hardcode CDN hostnames — they rotate. The provider always discovers the CDN from the API response
- Do not use `ffmpeg -kill_at_end` or similar — the watchdog handles lifecycle

## External dependencies in PATH (must be installed by user)

```
ffmpeg       HLS demux and remux
ffprobe      Validate moov atom before accepting output
subliminal   Subtitle download
ffsubsync    Subtitle sync to audio
```

## Testing

```bash
# Verify the whole pipeline without downloading
loot-dlp 969681 --dry-run

# Download a single movie
loot-dlp 969681 --output ~/Movies

# Multiple at once
loot-dlp 969681 557 --workers 2 --output ~/Movies
```
