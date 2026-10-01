# Reference Scripts

Historical scripts from before `loot-dlp` existed. Kept for reference — do not use directly.

| File | What it was |
|---|---|
| `find_m3u8_movie.js` | Playwright script: navigated vsembed.ru directly, intercepted .m3u8 network requests by clicking play inside iframes |
| `download_movies.sh` | Wrapper that called find_m3u8_movie.js then piped URL to ffmpeg |
| `dl.sh` | Standalone watchdog script — accepted a URL, ran ffmpeg, polled mtime every 60s, killed+restarted on stall, ran subliminal+ffsubsync on completion |
| `spider_watchdog2.sh` | **The breakthrough** — first script to bypass Cloudflare Turnstile by calling data.vidsrc.sh API directly, downloading WASM, decrypting ChaCha20 in Node.js inline, then getting JWT from /generate.php. This logic became `src/providers/vidsrc.js`. |
| `eternal_watchdog.sh` | Watchdog used to download Eternal Sunshine of the Spotless Mind |
| `reign_watchdog.sh` | Watchdog used to download Reign Over Me (had framerate mismatch in subtitles — scale=1.043, 23.976fps subs on 25fps video) |

## Key discoveries documented here

- **ptr+12 offset**: WASM `decrypt()` output starts 12 bytes in (nonce prefix). First seen in spider_watchdog2.sh.
- **Stall threshold 120s**: ffmpeg stays alive but stops writing when CDN token expires. mtime check every 60s with 120s threshold = 2 missed polls before kill+restart.
- **moov atom**: killing ffmpeg mid-download = corrupt .mp4 with no moov atom. Must delete .tmp.mp4 and restart from zero.
- **Reign Over Me subtitle drift**: ffsubsync reported scale=1.043 (23.976fps subs playing on 25fps video). 12.8min gap at end of film.
