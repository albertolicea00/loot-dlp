'use strict';
/**
 * Provider: cuevana
 *
 * Handles cuevana3e.pro (and cuevana variants) catalog URLs.
 * Phase 1: scrape page with Playwright → collect embed URLs
 * Phase 2: hand embed URLs to src/embeds/index.js for resolution
 *
 * TODO: implement scrapeEmbeds() — open the cuevana page, click through
 *   server selector tabs, collect all embed iframes/data-server attrs,
 *   return an array of raw embed URLs for the embed resolver.
 *
 * TODO: implement resolve() — call scrapeEmbeds(), iterate embed URLs,
 *   call embeds.resolve(url) on each until one succeeds, return StreamInfo.
 *
 * TODO: implement refresh() — delegate to the embed resolver that was
 *   chosen during resolve(), stored in meta.embedProvider + meta.embedMeta.
 *
 * TODO: handle both movies (/pelicula/) and series (/serie/) URL patterns.
 *   Series need season/episode extraction from opts.
 *
 * TODO: extract title from <h1> or <title> tag on the page.
 */

const name = 'cuevana';

function match(rawInput) {
  return /cuevana/i.test(rawInput);
}

async function resolve(rawInput, opts = {}) {
  throw new Error('cuevana provider not yet implemented — TODO');
}

async function refresh(meta) {
  throw new Error('cuevana provider not yet implemented — TODO');
}

module.exports = { name, match, resolve, refresh };
