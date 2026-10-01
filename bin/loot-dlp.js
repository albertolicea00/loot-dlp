#!/usr/bin/env node
'use strict';
/**
 * loot-dlp — CLI movie downloader
 *
 * Usage: loot-dlp <url|tmdb_id> [options]
 */

const path = require('path');
const fs = require('fs');
const { getProvider, listProviders } = require('../src/providers/index');
const { download } = require('../src/downloader');
const { downloadAndSync } = require('../src/subtitles');

// ── help ───────────────────────────────────────────────────────────────────

const USAGE = `
loot-dlp — stream downloader

USAGE
  loot-dlp <url|tmdb_id> [options]

OPTIONS
  --output <dir>      Output directory (default: current directory)
  --lang <code>       Subtitle language (default: es)
  --type movie|tv     Content type (default: movie)
  --no-subs           Skip subtitle download
  --dry-run           Resolve stream URL only, no download
  --help, -h          Show this help

EXAMPLES
  loot-dlp 969681
  loot-dlp "https://vsembed.ru/embed/movie?tmdb=969681&ds_lang=es"
  loot-dlp "https://cuevana3e.pro/pelicula/..." --output ~/Movies
  loot-dlp tt22084616 --no-subs

PROVIDERS
  ${listProviders().join(', ')}
`.trim();

// ── arg parsing ────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = argv.slice(2);
  if (!args.length || args.includes('--help') || args.includes('-h')) {
    console.log(USAGE);
    process.exit(0);
  }

  const opts = {
    input: null,
    outputDir: process.cwd(),
    lang: 'es',
    type: 'movie',
    subs: true,
    dryRun: false,
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    switch (a) {
      case '--output': opts.outputDir = args[++i]; break;
      case '--lang':   opts.lang = args[++i]; break;
      case '--type':   opts.type = args[++i]; break;
      case '--no-subs': opts.subs = false; break;
      case '--dry-run': opts.dryRun = true; break;
      default:
        if (a.startsWith('--')) die(`Unknown option: ${a}`);
        else opts.input = a;
    }
  }

  if (!opts.input) die('Missing URL or TMDB ID');
  return opts;
}

// ── main ───────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv);

  // 1. Pick provider
  let provider;
  try {
    provider = getProvider(opts.input);
  } catch (e) {
    die(e.message);
  }
  process.stderr.write(`[loot-dlp] Provider: ${provider.name}\n`);

  // 2. Resolve stream
  process.stderr.write(`[loot-dlp] Resolving: ${opts.input}\n`);
  let streamInfo;
  try {
    streamInfo = await provider.resolve(opts.input, {
      lang: opts.lang,
      type: opts.type,
    });
  } catch (e) {
    die(`Resolve failed: ${e.message}`);
  }

  const { title, m3u8, meta } = streamInfo;
  const outFile = path.join(opts.outputDir, `${sanitizeFilename(title)}.mp4`);

  process.stderr.write(`[loot-dlp] Title:  ${title}\n`);
  process.stderr.write(`[loot-dlp] Output: ${outFile}\n`);

  if (opts.dryRun) {
    console.log(JSON.stringify({ title, m3u8, meta, outFile }, null, 2));
    process.exit(0);
  }

  // 3. Download
  if (fs.existsSync(outFile)) {
    process.stderr.write(`[loot-dlp] Already exists: ${outFile} — skipping download\n`);
  } else {
    if (!fs.existsSync(opts.outputDir)) fs.mkdirSync(opts.outputDir, { recursive: true });

    const startTime = Date.now();
    let lastPrint = 0;

    process.stderr.write(`[loot-dlp] Starting download...\n`);
    let result;
    try {
      result = await download({
        m3u8,
        refresh: () => provider.refresh(meta),
        outFile,
        onProgress({ sizeMB, staleMs }) {
          const now = Date.now();
          if (now - lastPrint < 30000) return;
          lastPrint = now;
          const elapsed = Math.round((now - startTime) / 1000);
          const stale = staleMs < Infinity ? `stale=${Math.round(staleMs / 1000)}s` : 'stale=?';
          process.stderr.write(`[loot-dlp] ${sizeMB} MB  elapsed=${elapsed}s  ${stale}\n`);
        },
      });
    } catch (e) {
      die(`Download failed: ${e.message}`);
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    process.stderr.write(
      `[loot-dlp] Done: ${result.sizeMB} MB in ${elapsed}s (${Math.round(result.duration)}s video)\n`
    );
  }

  // 4. Subtitles
  if (opts.subs) {
    const srtFile = downloadAndSync(outFile, opts.lang);
    if (srtFile) process.stderr.write(`[loot-dlp] Subtitles: ${srtFile}\n`);
    else process.stderr.write(`[loot-dlp] Subtitles not available\n`);
  }

  console.log(`\nDone: ${outFile}`);
}

// ── utils ──────────────────────────────────────────────────────────────────

function sanitizeFilename(s) {
  return s.replace(/[/\\:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();
}

function die(msg) {
  console.error(`[loot-dlp] ERROR: ${msg}`);
  process.exit(1);
}

main().catch(e => {
  console.error(`[loot-dlp] FATAL: ${e.stack || e.message}`);
  process.exit(1);
});
