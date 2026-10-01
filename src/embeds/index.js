'use strict';
/**
 * Embed resolver registry.
 *
 * Site providers (cuevana, animeboom, etc.) scrape a page and get a list
 * of embed URLs. This registry picks the right resolver for each embed URL.
 *
 * To add a new embed host:
 *   1. Create src/embeds/<name>.js  →  { name, match, resolve, refresh }
 *   2. require() it here and push to EMBEDS
 *
 * TODO: add resolvers:
 *   - streamtape.js
 *   - doodstream.js
 *   - mega.js       (different download path — no ffmpeg, uses megajs)
 *   - streamwish.js
 *   - vidhide.js
 *   - hls.js        (generic fallback: URL already ends in .m3u8)
 *   - mp4.js        (generic fallback: URL already ends in .mp4)
 */

const EMBEDS = [
  // TODO: require('./streamtape'),
  // TODO: require('./doodstream'),
  // TODO: require('./mega'),
  // TODO: require('./hls'),
  // TODO: require('./mp4'),
];

/**
 * Find resolver for a given embed URL.
 * @param {string} embedUrl
 * @returns {{ name, match, resolve, refresh }}
 */
function getResolver(embedUrl) {
  const r = EMBEDS.find(e => e.match(embedUrl));
  if (!r) throw new Error(`No embed resolver matched: ${embedUrl}`);
  return r;
}

function listResolvers() {
  return EMBEDS.map(e => e.name);
}

module.exports = { getResolver, listResolvers, EMBEDS };
