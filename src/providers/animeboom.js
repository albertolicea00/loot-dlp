'use strict';
/**
 * Provider: animeboom
 *
 * Handles animeboom.net (and mirror domains) episode/series URLs.
 * Phase 1: scrape page with Playwright → collect embed URLs
 * Phase 2: hand embed URLs to src/embeds/index.js for resolution
 *
 * TODO: implement scrapeEmbeds() — open the animeboom episode page,
 *   collect embed iframes or JS-rendered player sources,
 *   return an array of raw embed URLs for the embed resolver.
 *   Note: animeboom often uses HLS directly via jwplayer — check
 *   for window.jwplayer / setup({file:}) in page JS before scraping iframes.
 *
 * TODO: implement resolve() — call scrapeEmbeds(), iterate embed URLs,
 *   call embeds.resolve(url) on each until one succeeds, return StreamInfo.
 *
 * TODO: implement refresh() — delegate to chosen embed resolver's refresh().
 *
 * TODO: extract episode title and number from page (for filename).
 *
 * TODO: handle series listing pages (/anime/) vs episode pages (/ver/) —
 *   listing pages should return an error asking for a specific episode URL.
 */

const name = 'animeboom';

function match(rawInput) {
  return /animeboom/i.test(rawInput);
}

async function resolve(rawInput, opts = {}) {
  throw new Error('animeboom provider not yet implemented — TODO');
}

async function refresh(meta) {
  throw new Error('animeboom provider not yet implemented — TODO');
}

module.exports = { name, match, resolve, refresh };
