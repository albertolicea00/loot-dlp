'use strict';
/**
 * Provider registry.
 *
 * Add a new platform:
 *   1. Create src/providers/<name>.js
 *   2. require() it here and push it to PROVIDERS
 *
 * Match order matters — first provider whose match() returns true wins.
 */

const vidsrc    = require('./vidsrc');
const cuevana   = require('./cuevana');
const animeboom = require('./animeboom');

// ── registry (ordered) ─────────────────────────────────────────────────────
// Match order matters — first provider whose match() returns true wins.
// vidsrc must come before cuevana because cuevana URLs also contain tmdb= params.

const PROVIDERS = [
  vidsrc,
  cuevana,
  animeboom,
  // TODO: require('./animeflv'),
  // TODO: require('./pelisplus'),
  // TODO: require('./direct'),  // generic fallback: raw .m3u8 / .mp4 URL
];

/**
 * Find the provider for a given raw input string.
 * @param {string} rawInput
 * @returns {{ name:string, match:Function, resolve:Function, refresh:Function }}
 */
function getProvider(rawInput) {
  const p = PROVIDERS.find(p => p.match(rawInput));
  if (!p) throw new Error(`No provider matched input: ${rawInput}`);
  return p;
}

/**
 * List all registered provider names (for --help, diagnostics).
 * @returns {string[]}
 */
function listProviders() {
  return PROVIDERS.map(p => p.name);
}

module.exports = { getProvider, listProviders, PROVIDERS };
