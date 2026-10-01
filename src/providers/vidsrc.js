'use strict';
/**
 * Provider: vidsrc
 *
 * Sources:  data.vidsrc.sh API + ChaCha20 WASM decrypt + cloudorchestranova.com CDN
 * Handles:  TMDB IDs, vsembed URLs, IMDB IDs (tt…), cuevana3e URLs
 *
 * To support a new stream host from the same ecosystem, update CDN_HOSTS
 * or adjust callAPI() if the endpoint changes.
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ── constants ──────────────────────────────────────────────────────────────

const API_BASE = 'https://data.vidsrc.sh/api.php';
const REFERER = 'https://cloudorchestranova.com/';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

// ── provider interface ─────────────────────────────────────────────────────

const name = 'vidsrc';

/**
 * Returns true for:
 *   - pure numeric string           (TMDB movie ID)
 *   - ?tmdb= or &tmdb= in URL       (vsembed, cuevana3e embed link)
 *   - tt\d+ IMDB ID
 *   - cuevana hostname              (scraped via Playwright)
 */
function match(rawInput) {
  if (/^\d+$/.test(rawInput)) return true;
  if (/[?&]tmdb=\d+/.test(rawInput)) return true;
  if (/^tt\d+$/i.test(rawInput)) return true;
  if (/cuevana/i.test(rawInput)) return true;
  return false;
}

/**
 * @param {string} rawInput
 * @param {{ lang?:string, type?:string }} opts
 * @returns {Promise<{title:string, m3u8:string, meta:object}>}
 */
async function resolve(rawInput, opts = {}) {
  const { type = 'movie' } = opts;
  const tmdb = await extractTmdb(rawInput, opts.lang || 'es');

  const data = await callAPI(tmdb, type);
  if (!data.data) throw new Error(`API error: ${JSON.stringify(data).slice(0, 200)}`);

  const title = data.data.title || `tmdb_${tmdb}`;
  const streams = await decryptStreams(data);
  if (!streams.length) throw new Error('No streams available');

  const m3u8Base = streams.find(s => s.includes('master.m3u8')) || streams[0];
  const cdn = cdnOf(m3u8Base);
  if (!cdn) throw new Error(`Cannot extract CDN from: ${m3u8Base}`);

  const token = await getToken(cdn);
  const m3u8 = applyToken(m3u8Base, token);

  return {
    title,
    m3u8,
    meta: { m3u8Base, cdn }, // passed back to refresh()
  };
}

/**
 * Get a fresh signed m3u8 URL when a stream stalls.
 * @param {{ m3u8Base:string, cdn:string }} meta
 * @returns {Promise<string>}
 */
async function refresh(meta) {
  const token = await getToken(meta.cdn);
  return applyToken(meta.m3u8Base, token);
}

// ── input parsing ──────────────────────────────────────────────────────────

async function extractTmdb(rawInput, lang) {
  // Numeric → TMDB ID direct
  if (/^\d+$/.test(rawInput)) return rawInput;

  // URL with ?tmdb= or &tmdb=
  const tmdbMatch = rawInput.match(/[?&]tmdb=(\d+)/);
  if (tmdbMatch) return tmdbMatch[1];

  // IMDB ID — API accepts it
  if (/^tt\d+$/i.test(rawInput)) return rawInput;

  // cuevana3e → scrape via Playwright
  if (/cuevana/i.test(rawInput)) return scrapeCuevana(rawInput);

  throw new Error(`vidsrc: cannot extract TMDB from: ${rawInput}`);
}

async function scrapeCuevana(url) {
  process.stderr.write(`[vidsrc] Scraping cuevana3e: ${url}\n`);
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true, executablePath: findChromium() });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
    const result = await page.evaluate(() => {
      for (const el of document.querySelectorAll('[data-server]')) {
        const s = el.getAttribute('data-server') || '';
        if (s.includes('?v=')) {
          try {
            const dec = atob(s.split('?v=')[1]);
            const m = dec.match(/tmdb=(\d+)/);
            if (m) return { tmdb: m[1] };
          } catch (_) {}
        }
        const m = s.match(/tmdb=(\d+)/);
        if (m) return { tmdb: m[1] };
      }
      const m = document.body.innerHTML.match(/tmdb[=\/](\d{4,})/);
      return m ? { tmdb: m[1] } : null;
    });
    if (!result?.tmdb) throw new Error('TMDB ID not found on cuevana3e page');
    process.stderr.write(`[vidsrc] TMDB ID: ${result.tmdb}\n`);
    return result.tmdb;
  } finally {
    await browser.close();
  }
}

function findChromium() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH ||
    path.join(process.env.HOME, '.cache/ms-playwright');
  const candidates = [
    path.join(base, 'chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
    path.join(base, 'chromium-1243/chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
  ];
  return candidates.find(c => fs.existsSync(c));
}

// ── API + WASM decrypt ─────────────────────────────────────────────────────

async function callAPI(tmdb, type) {
  const url = `${API_BASE}?type=${type}&tmdb=${tmdb}&stream_urls`;
  process.stderr.write(`[vidsrc] API: ${url}\n`);
  const res = await get(url);
  if (res.status !== 200) throw new Error(`API HTTP ${res.status}`);
  return JSON.parse(res.body.toString());
}

async function decryptStreams(data) {
  if (Array.isArray(data.data.stream_urls)) {
    return data.data.stream_urls.filter(Boolean);
  }
  if (typeof data.data.stream_urls === 'string') {
    if (!data.vs?.wasm_url) throw new Error('stream_urls encrypted but no wasm_url');
    const wasmPath = await downloadWasm(data.vs.wasm_url);
    return decryptWasm(data.data.stream_urls, wasmPath);
  }
  throw new Error('Unexpected stream_urls type: ' + typeof data.data.stream_urls);
}

async function downloadWasm(wasmUrl) {
  const tmp = path.join(os.tmpdir(), `loot_vidsrc_${Date.now()}.wasm`);
  process.stderr.write(`[vidsrc] WASM: ${wasmUrl}\n`);
  const res = await get(wasmUrl, { timeout: 15000 });
  if (res.status !== 200) throw new Error(`WASM HTTP ${res.status}`);
  fs.writeFileSync(tmp, res.body);
  return tmp;
}

async function decryptWasm(encB64, wasmPath) {
  const wasmBytes = fs.readFileSync(wasmPath);
  const { instance } = await WebAssembly.instantiate(wasmBytes, {});
  const ex = instance.exports;
  const enc = new Uint8Array(Buffer.from(encB64, 'base64'));
  const ptr = ex.alloc(enc.length);
  new Uint8Array(ex.memory.buffer, ptr, enc.length).set(enc);
  const outLen = ex.decrypt(ptr, enc.length);
  const dec = Buffer.from(ex.memory.buffer, ptr + 12, outLen).toString('utf8');
  fs.unlinkSync(wasmPath);
  return dec.trim().split('\n').map(s => s.trim()).filter(Boolean);
}

// ── token ──────────────────────────────────────────────────────────────────

async function getToken(cdnHost) {
  const url = `${cdnHost}/generate.php`;
  process.stderr.write(`[vidsrc] Token: ${url}\n`);
  const res = await get(url, { timeout: 10000 });
  if (res.status !== 200) throw new Error(`generate.php HTTP ${res.status}`);
  return res.body.toString().trim();
}

function cdnOf(m3u8Url) {
  const m = m3u8Url.match(/^(https?:\/\/[^/]+)/);
  return m ? m[1] : null;
}

function applyToken(url, token) {
  if (!token) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}token=${token}`;
}

// ── http helper ────────────────────────────────────────────────────────────

function get(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      headers: {
        'User-Agent': UA,
        'Referer': REFERER,
        'Origin': 'https://cloudorchestranova.com',
        ...(opts.headers || {}),
      },
      timeout: opts.timeout || 20000,
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error(`Timeout: ${url}`)); });
  });
}

// ── export ─────────────────────────────────────────────────────────────────

module.exports = { name, match, resolve, refresh };
