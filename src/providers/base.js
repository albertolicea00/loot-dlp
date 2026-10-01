'use strict';
/**
 * Provider interface (documentation only — no enforcement).
 *
 * Each provider is a plain object:
 *
 *   {
 *     name: string,
 *
 *     match(rawInput: string): boolean
 *       Return true if this provider knows how to handle rawInput.
 *       Called in registry order — first match wins.
 *
 *     resolve(rawInput: string, opts?: ResolveOpts): Promise<StreamInfo>
 *       Turn rawInput into a ready-to-download stream.
 *
 *     refresh(meta: object): Promise<string>
 *       Return a fresh signed m3u8 URL using provider-specific meta
 *       (whatever resolve() put in StreamInfo.meta). Called by the
 *       downloader watchdog when a stream stalls.
 *   }
 *
 * ResolveOpts = { lang?: string, type?: 'movie'|'tv', season?: number, episode?: number }
 *
 * StreamInfo = {
 *   title:  string,   // human-readable title for the output filename
 *   m3u8:   string,   // signed/ready HLS URL
 *   meta:   object,   // provider-specific data needed for refresh()
 * }
 *
 * To add a new provider:
 *   1. Create src/providers/<name>.js  →  module.exports = { name, match, resolve, refresh }
 *   2. Add it to src/providers/index.js  →  PROVIDERS array (order = match priority)
 *
 * That's it. No changes needed anywhere else.
 */

module.exports = {}; // nothing to export — this file is docs only
