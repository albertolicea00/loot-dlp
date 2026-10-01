'use strict';
/**
 * subtitles.js — download and sync subtitles
 *
 * Requires in PATH: subliminal, ffsubsync, ffmpeg
 */

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');

/**
 * @param {string} videoFile  path to .mp4
 * @param {string} lang       language code (default 'es')
 * @returns {string|null}     path to synced .srt, or null on failure
 */
function downloadAndSync(videoFile, lang = 'es') {
  const srtFile = videoFile.replace(/\.mp4$/i, `.${lang}.srt`);

  // 1. Download
  process.stderr.write(`[subs] Downloading subtitles (${lang})...\n`);
  const dlResult = spawnSync('subliminal', ['download', '-f', '-l', lang, videoFile], {
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120_000,
  });

  if (dlResult.status !== 0) {
    process.stderr.write(`[subs] subliminal failed: ${dlResult.stderr.toString().slice(0, 200)}\n`);
    return null;
  }

  if (!fs.existsSync(srtFile)) {
    // subliminal may have downloaded .ssa — convert
    const ssaFile = videoFile.replace(/\.mp4$/i, `.${lang}.ssa`);
    if (fs.existsSync(ssaFile)) {
      process.stderr.write(`[subs] Converting .ssa → .srt\n`);
      try {
        execSync(`ffmpeg -i "${ssaFile}" "${srtFile}" -y`, { stdio: 'ignore', timeout: 30000 });
      } catch (e) {
        process.stderr.write(`[subs] Conversion failed: ${e.message}\n`);
        return null;
      }
    } else {
      process.stderr.write(`[subs] No subtitle file found after download\n`);
      return null;
    }
  }

  // 2. Sync to audio
  process.stderr.write(`[subs] Syncing with ffsubsync...\n`);
  const syncResult = spawnSync('ffsubsync', [videoFile, '-i', srtFile, '-o', srtFile], {
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 600_000,
  });

  if (syncResult.status !== 0) {
    process.stderr.write(`[subs] ffsubsync failed (subtitles downloaded but not synced)\n`);
    return srtFile;
  }

  const syncLine =
    (syncResult.stdout.toString() + syncResult.stderr.toString())
      .match(/offset.*|framerate.*|score.*/gm)
      ?.slice(0, 3).join(' | ') || '';
  process.stderr.write(`[subs] Synced: ${syncLine}\n`);

  return srtFile;
}

module.exports = { downloadAndSync };
