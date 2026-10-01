'use strict';
/**
 * downloader.js — ffmpeg HLS downloader with stall-recovery watchdog
 *
 * Generic: knows nothing about providers. Receives a ready m3u8 URL and
 * a refresh() callback to call when the stream stalls.
 */

const { spawn, execSync } = require('child_process');
const fs = require('fs');

const REFERER = 'https://cloudorchestranova.com/';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const POLL_MS = 30_000;    // watchdog check interval
const STALL_MS = 120_000;  // no file growth for this long → stall
const MIN_BYTES = 100 * 1024 * 1024; // 100 MB minimum for a valid output

/**
 * @param {object} opts
 * @param {string}   opts.m3u8      Initial signed HLS URL
 * @param {Function} opts.refresh   async () => string  — returns fresh signed URL
 * @param {string}   opts.outFile   Final .mp4 path
 * @param {Function} [opts.onProgress]  ({ sizeMB, staleMs, pid }) => void
 * @returns {Promise<{ sizeMB:number, duration:number }>}
 */
function download({ m3u8, refresh, outFile, onProgress }) {
  const tmpFile = outFile + '.tmp.mp4';
  const logFile = outFile.replace(/\.mp4$/, '.ffmpeg.log');

  let currentM3u8 = m3u8;
  let proc = null;
  let resolved = false;
  let watchdog = null;

  return new Promise((resolve, reject) => {
    function start() {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);

      const logFd = fs.openSync(logFile, 'a');
      proc = spawn('ffmpeg', [
        '-y',
        '-reconnect', '1',
        '-reconnect_streamed', '1',
        '-reconnect_delay_max', '10',
        '-headers', `Referer: ${REFERER}\r\nUser-Agent: ${UA}\r\n`,
        '-i', currentM3u8,
        '-c', 'copy',
        '-bsf:a', 'aac_adtstoasc',
        tmpFile,
      ], { stdio: ['ignore', logFd, logFd] });

      proc.on('error', err => {
        fs.closeSync(logFd);
        if (!resolved) { resolved = true; reject(err); }
      });

      proc.on('close', code => {
        fs.closeSync(logFd);
        clearInterval(watchdog);
        if (resolved) return;

        const sz = fileSize(tmpFile);
        if (sz > MIN_BYTES) {
          const dur = probeDuration(tmpFile);
          if (dur > 0) {
            fs.renameSync(tmpFile, outFile);
            resolved = true;
            resolve({ sizeMB: Math.round(sz / 1024 / 1024), duration: dur });
            return;
          }
        }

        if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
        process.stderr.write(`[dl] ffmpeg exited (code=${code}) without valid file — retrying\n`);
        setTimeout(() => tryRefreshAndRestart(), 3000);
      });
    }

    async function tryRefreshAndRestart() {
      try {
        currentM3u8 = await refresh();
        start();
      } catch (e) {
        process.stderr.write(`[dl] Refresh failed: ${e.message} — retrying in 60s\n`);
        setTimeout(() => tryRefreshAndRestart(), 60_000);
      }
    }

    start();

    watchdog = setInterval(async () => {
      if (resolved || !proc) return;

      const sz = fileSize(tmpFile);
      const staleMs = staleness(tmpFile);

      if (onProgress) onProgress({ sizeMB: Math.round(sz / 1024 / 1024), staleMs, pid: proc.pid });

      if (staleMs > STALL_MS) {
        process.stderr.write(`[dl] STALL ${Math.round(staleMs / 1000)}s — killing pid=${proc.pid}\n`);
        proc.kill('SIGKILL');
        proc = null;
        await tryRefreshAndRestart();
      }
    }, POLL_MS);
  });
}

// ── helpers ────────────────────────────────────────────────────────────────

function fileSize(f) {
  try { return fs.statSync(f).size; } catch { return 0; }
}

function staleness(f) {
  try {
    return Date.now() - fs.statSync(f).mtimeMs;
  } catch { return Infinity; }
}

function probeDuration(f) {
  try {
    const out = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1 "${f}"`,
      { timeout: 15000 }
    ).toString();
    const m = out.match(/duration=([0-9.]+)/);
    return m ? parseFloat(m[1]) : 0;
  } catch { return 0; }
}

module.exports = { download };
