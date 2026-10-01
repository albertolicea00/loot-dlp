'use strict';
/**
 * progress.js — ANSI terminal dashboard for concurrent downloads
 *
 * Works in TTY (live in-place updates) and non-TTY (plain log lines).
 * No external dependencies.
 */

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const RENDER_MS = 2000;

class Dashboard {
  constructor() {
    this.jobs = new Map(); // id → JobState
    this._lines = 0;
    this._frame = 0;
    this._interval = null;
    this._isTTY = Boolean(process.stdout.isTTY);
    this._lastRenderMs = new Map(); // id → sizeMB at last render (for speed)
    this._lastRenderTime = Date.now();
  }

  /**
   * Register a job before it starts.
   * @param {string} id
   * @param {string} title
   */
  add(id, title) {
    this.jobs.set(id, {
      title,
      state: 'queued',   // queued | resolving | downloading | stalled | done | error
      sizeMB: 0,
      startMs: null,
      endMs: null,
      staleMs: 0,
      speedMBps: 0,
      error: null,
      _prevSizeMB: 0,
      _prevTime: Date.now(),
    });
  }

  /**
   * Update job state — any subset of fields.
   * @param {string} id
   * @param {object} patch
   */
  update(id, patch) {
    const job = this.jobs.get(id);
    if (!job) return;

    // Calculate speed from size delta
    if (patch.sizeMB !== undefined && patch.sizeMB !== job.sizeMB) {
      const now = Date.now();
      const dtMs = now - job._prevTime;
      if (dtMs > 0) {
        const deltaMB = patch.sizeMB - job._prevSizeMB;
        job.speedMBps = deltaMB > 0 ? (deltaMB / dtMs) * 1000 : 0;
      }
      job._prevSizeMB = patch.sizeMB;
      job._prevTime = Date.now();
    }

    Object.assign(job, patch);

    if (!this._isTTY) this._renderLine(id, job); // stream mode: print immediately
  }

  start() {
    if (this._isTTY) {
      this._render();
      this._interval = setInterval(() => {
        this._frame = (this._frame + 1) % SPINNER.length;
        this._render();
      }, RENDER_MS);
    } else {
      // Non-TTY: header only, updates printed in update()
      const total = this.jobs.size;
      process.stdout.write(`[loot-dlp] Starting ${total} job(s)\n`);
    }
  }

  stop() {
    clearInterval(this._interval);
    if (this._isTTY) {
      this._render(true);
    }
    process.stdout.write('\n');
  }

  // ── rendering ────────────────────────────────────────────────────────────

  _render(final = false) {
    const cols = (process.stdout.columns || 100) - 2;

    if (this._lines > 0) {
      process.stdout.write(`\x1b[${this._lines}A\x1b[J`);
    }

    const total = this.jobs.size;
    const done  = [...this.jobs.values()].filter(j => j.state === 'done').length;
    const errs  = [...this.jobs.values()].filter(j => j.state === 'error').length;
    const active = [...this.jobs.values()].filter(j => j.state === 'downloading' || j.state === 'stalled').length;

    const header = `\x1b[1mloot-dlp\x1b[0m  ${done}/${total} done` +
      (active  ? `  \x1b[36m${active} active\x1b[0m` : '') +
      (errs    ? `  \x1b[31m${errs} failed\x1b[0m`   : '');

    const lines = [header, ''];

    for (const [id, job] of this.jobs) {
      lines.push(this._formatJob(id, job, cols));
    }

    const out = lines.join('\n') + '\n';
    process.stdout.write(out);
    this._lines = final ? 0 : lines.length;
  }

  _formatJob(id, job, cols) {
    const icon  = stateIcon(job.state, this._frame);
    const color = stateColor(job.state);
    const title = truncate(job.title || `job-${id}`, 32).padEnd(32);

    let detail;
    switch (job.state) {
      case 'queued':
        detail = dim('waiting in queue...');
        break;

      case 'resolving':
        detail = yellow('resolving stream...');
        break;

      case 'done': {
        const elapsed = job.startMs && job.endMs
          ? fmtTime(Math.round((job.endMs - job.startMs) / 1000))
          : '';
        detail = green(`${job.sizeMB} MB  ${elapsed}`);
        break;
      }

      case 'error':
        detail = red(truncate(job.error || 'unknown error', 50));
        break;

      case 'stalled': {
        const elapsed = job.startMs ? fmtTime(Math.round((Date.now() - job.startMs) / 1000)) : '';
        detail = yellow(`${job.sizeMB} MB  ${elapsed}  `) + red(`stalled ${Math.round(job.staleMs / 1000)}s — refreshing token...`);
        break;
      }

      default: { // downloading
        const elapsed = job.startMs ? fmtTime(Math.round((Date.now() - job.startMs) / 1000)) : '';
        const speed   = job.speedMBps > 0.05 ? `  ${job.speedMBps.toFixed(1)} MB/s` : '';
        const stale   = job.staleMs > 10000  ? yellow(`  stale=${Math.round(job.staleMs / 1000)}s`) : '';
        detail = `${job.sizeMB} MB${speed}  ${elapsed}${stale}`;
        break;
      }
    }

    return `  ${color}${icon}\x1b[0m  ${title}  ${detail}`;
  }

  // Non-TTY: print a single status line per update
  _renderLine(id, job) {
    const ts = new Date().toTimeString().slice(0, 8);
    const title = truncate(job.title || `job-${id}`, 30);
    process.stdout.write(`[${ts}] [${job.state.toUpperCase().padEnd(11)}] ${title}  ${job.sizeMB} MB\n`);
  }
}

// ── helpers ────────────────────────────────────────────────────────────────

function stateIcon(state, frame = 0) {
  switch (state) {
    case 'queued':      return '○';
    case 'resolving':   return SPINNER[frame];
    case 'downloading': return SPINNER[frame];
    case 'stalled':     return '⚠';
    case 'done':        return '✓';
    case 'error':       return '✗';
    default:            return '?';
  }
}

function stateColor(state) {
  switch (state) {
    case 'done':      return '\x1b[32m'; // green
    case 'error':     return '\x1b[31m'; // red
    case 'stalled':   return '\x1b[33m'; // yellow
    case 'queued':    return '\x1b[2m';  // dim
    default:          return '\x1b[36m'; // cyan
  }
}

function truncate(s, n) {
  if (!s) return '';
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

function fmtTime(secs) {
  if (secs < 60)   return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m${(secs % 60).toString().padStart(2, '0')}s`;
  return `${Math.floor(secs / 3600)}h${Math.floor((secs % 3600) / 60).toString().padStart(2, '0')}m`;
}

const green  = s => `\x1b[32m${s}\x1b[0m`;
const red    = s => `\x1b[31m${s}\x1b[0m`;
const yellow = s => `\x1b[33m${s}\x1b[0m`;
const dim    = s => `\x1b[2m${s}\x1b[0m`;

module.exports = { Dashboard };
