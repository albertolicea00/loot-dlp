#!/usr/bin/env node
'use strict';
/**
 * loot-dlp — stream downloader CLI
 *
 * Usage:  loot-dlp [options] <url|tmdb_id> [<url|tmdb_id> ...]
 */

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const { getProvider, listProviders } = require('../src/providers/index');
const { download } = require('../src/downloader');
const { downloadAndSync } = require('../src/subtitles');
const { Dashboard } = require('../src/progress');

const PKG = require('../package.json');

// ── help ───────────────────────────────────────────────────────────────────

const USAGE = `
loot-dlp v${PKG.version} — stream downloader

USAGE
  loot-dlp [options] <input> [<input> ...]

  <input> can be:
    TMDB ID                 969681
    IMDB ID                 tt22084616
    vsembed URL             https://vsembed.ru/embed/movie?tmdb=969681
    cuevana3e URL           https://cuevana3e.pro/pelicula/...
    animeboom URL           https://animeboom.net/ver/...

OPTIONS
  -o, --output <dir>        Output directory  (default: current directory)
  -l, --lang <code>         Subtitle language (default: es)
  -t, --type movie|tv       Content type      (default: movie)
  -w, --workers <n>         Concurrent downloads (default: 1)
  -f, --input-file <file>   Read inputs from file (one per line)
      --no-subs             Skip subtitle download
      --dry-run             Resolve stream URL only, print JSON, exit
      --update              Check for updates and install latest version
  -v, --version             Print version
  -h, --help                Show this help

EXAMPLES
  # Single movie
  loot-dlp 969681 --output ~/Movies

  # Multiple movies with 2 workers
  loot-dlp 969681 557 15121 --workers 2 --output ~/Movies

  # From a file
  loot-dlp --input-file watchlist.txt --workers 3 --output ~/Movies

  # No subtitles, Spanish language
  loot-dlp tt22084616 --no-subs --lang en --output ~/Movies

  # Dry run — just resolve the stream URL
  loot-dlp 969681 --dry-run

PROVIDERS
  ${listProviders().join(', ')}

REQUIREMENTS
  ffmpeg, ffprobe, subliminal, ffsubsync  (must be in PATH)
`.trim();

// ── arg parsing ────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const raw = argv.slice(2);

  if (!raw.length || raw.includes('--help') || raw.includes('-h')) {
    console.log(USAGE);
    process.exit(0);
  }

  if (raw.includes('--version') || raw.includes('-v')) {
    console.log(`loot-dlp v${PKG.version}`);
    process.exit(0);
  }

  const opts = {
    inputs: [],
    outputDir: process.cwd(),
    lang: 'es',
    type: 'movie',
    workers: 1,
    subs: true,
    dryRun: false,
    update: false,
    inputFile: null,
  };

  for (let i = 0; i < raw.length; i++) {
    const a = raw[i];
    switch (a) {
      case '-o': case '--output':     opts.outputDir = raw[++i]; break;
      case '-l': case '--lang':       opts.lang = raw[++i]; break;
      case '-t': case '--type':       opts.type = raw[++i]; break;
      case '-w': case '--workers':    opts.workers = parseInt(raw[++i], 10) || 1; break;
      case '-f': case '--input-file': opts.inputFile = raw[++i]; break;
      case '--no-subs':               opts.subs = false; break;
      case '--dry-run':               opts.dryRun = true; break;
      case '--update':                opts.update = true; break;
      default:
        if (a.startsWith('-')) die(`Unknown option: ${a}\nRun loot-dlp --help for usage.`);
        else opts.inputs.push(a);
    }
  }

  // Load inputs from file
  if (opts.inputFile) {
    if (!fs.existsSync(opts.inputFile)) die(`Input file not found: ${opts.inputFile}`);
    const lines = fs.readFileSync(opts.inputFile, 'utf8')
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'));
    opts.inputs.push(...lines);
  }

  if (!opts.update && !opts.inputs.length) die('No inputs provided.\nRun loot-dlp --help for usage.');

  return opts;
}

// ── self-update ────────────────────────────────────────────────────────────

async function selfUpdate() {
  process.stderr.write(`[loot-dlp] Checking for updates...\n`);
  try {
    // If installed globally via npm
    const result = execSync('npm install -g loot-dlp 2>&1', { timeout: 60000 }).toString();
    process.stdout.write(result);
    process.stdout.write(`\n[loot-dlp] Updated.\n`);
  } catch (e) {
    // Might be a local npm link — try git pull instead
    const dir = path.resolve(__dirname, '..');
    if (fs.existsSync(path.join(dir, '.git'))) {
      process.stderr.write(`[loot-dlp] Local install detected — running git pull + npm install\n`);
      execSync(`git -C "${dir}" pull && npm install --prefix "${dir}"`, { stdio: 'inherit', timeout: 60000 });
    } else {
      die(`Update failed: ${e.message}`);
    }
  }
}

// ── download one job ───────────────────────────────────────────────────────

async function downloadJob(input, opts, dash, id) {
  const { outputDir, lang, type, subs } = opts;

  dash.update(id, { state: 'resolving' });

  // Pick provider
  let provider;
  try {
    provider = getProvider(input);
  } catch (e) {
    dash.update(id, { state: 'error', error: e.message });
    return { id, success: false, error: e.message };
  }

  // Resolve stream
  let streamInfo;
  try {
    streamInfo = await provider.resolve(input, { lang, type });
  } catch (e) {
    dash.update(id, { state: 'error', error: e.message });
    return { id, success: false, error: e.message };
  }

  const { title, m3u8, meta } = streamInfo;
  const outFile = path.join(outputDir, `${sanitizeFilename(title)}.mp4`);

  dash.update(id, { title, state: 'downloading', startMs: Date.now() });

  // Skip if already exists
  if (fs.existsSync(outFile)) {
    dash.update(id, { state: 'done', sizeMB: Math.round(fs.statSync(outFile).size / 1024 / 1024), endMs: Date.now() });
    return { id, success: true, outFile, skipped: true };
  }

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  if (opts.dryRun) {
    dash.update(id, { state: 'done', endMs: Date.now() });
    process.stdout.write(JSON.stringify({ title, m3u8, meta, outFile }, null, 2) + '\n');
    return { id, success: true, dryRun: true };
  }

  // Download
  let result;
  try {
    result = await download({
      m3u8,
      refresh: () => provider.refresh(meta),
      outFile,
      onProgress({ sizeMB, staleMs }) {
        const state = staleMs > 90_000 ? 'stalled' : 'downloading';
        dash.update(id, { sizeMB, staleMs, state });
      },
    });
  } catch (e) {
    dash.update(id, { state: 'error', error: e.message });
    return { id, success: false, error: e.message };
  }

  dash.update(id, {
    state: 'done',
    sizeMB: result.sizeMB,
    endMs: Date.now(),
    staleMs: 0,
  });

  // Subtitles
  if (subs) {
    try {
      downloadAndSync(outFile, lang);
    } catch (_) {
      // subtitle failure is non-fatal
    }
  }

  return { id, success: true, outFile };
}

// ── worker pool ────────────────────────────────────────────────────────────

async function runPool(inputs, opts, dash) {
  const results = new Array(inputs.length);
  let next = 0;

  async function worker() {
    while (next < inputs.length) {
      const i = next++;
      results[i] = await downloadJob(inputs[i], opts, dash, String(i));
    }
  }

  const workers = Math.min(opts.workers, inputs.length);
  await Promise.all(Array.from({ length: workers }, worker));
  return results;
}

// ── main ───────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv);

  if (opts.update) {
    await selfUpdate();
    process.exit(0);
  }

  const dash = new Dashboard();
  for (let i = 0; i < opts.inputs.length; i++) {
    dash.add(String(i), opts.inputs[i]); // title updated once resolved
  }

  dash.start();

  let results;
  try {
    results = await runPool(opts.inputs, opts, dash);
  } finally {
    dash.stop();
  }

  // Summary
  const ok   = results.filter(r => r.success);
  const fail = results.filter(r => !r.success);

  if (ok.length)   console.log(`\n✓  ${ok.length} completed`);
  if (fail.length) {
    console.error(`✗  ${fail.length} failed:`);
    for (const r of fail) console.error(`     [${r.id}] ${r.error}`);
    process.exit(1);
  }
}

// ── utils ──────────────────────────────────────────────────────────────────

function sanitizeFilename(s) {
  return (s || 'download').replace(/[/\\:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();
}

function die(msg) {
  console.error(`[loot-dlp] ${msg}`);
  process.exit(1);
}

main().catch(e => {
  console.error(`[loot-dlp] FATAL: ${e.stack || e.message}`);
  process.exit(1);
});
