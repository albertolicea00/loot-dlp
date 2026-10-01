#!/usr/bin/env bash
TITLE="Eternal Sunshine of the Spotless Mind"
TMDB=38
OUT="/Volumes/HDDTRANSINT/visuales.uclv.cu/${TITLE}.mp4"
TMP="${OUT}.tmp.mp4"
SCRIPTS="/Volumes/HDDTRANSINT/visuales.uclv.cu/scripts"
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36"
LOG="/tmp/eternal_watchdog.log"
MIN_SIZE=104857600

log() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG"; }

start_download() {
    local m3u8
    log "Getting fresh m3u8..."
    m3u8=$(cd "$SCRIPTS" && PLAYWRIGHT_BROWSERS_PATH=~/.cache/ms-playwright \
           node "$SCRIPTS/find_m3u8_movie.js" "https://vsembed.ru/embed/movie?tmdb=${TMDB}&ds_lang=es" \
           2>>/tmp/pw_eternal_wd.log)
    if [[ -z "$m3u8" ]]; then
        log "FAIL: no m3u8 — retry in 5min"
        return 1
    fi
    rm -f "$TMP"
    ffmpeg -y \
        -reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 10 \
        -headers $"Referer: https://cloudorchestranova.com/\r\nUser-Agent: ${UA}\r\n" \
        -i "$m3u8" -c copy -bsf:a aac_adtstoasc \
        "$TMP" >> /tmp/ffmpeg_eternal_wd.log 2>&1 &
    echo $!
}

log "=== watchdog start ==="

while true; do
    # Already complete?
    if [[ -f "$OUT" ]]; then
        sz=$(stat -f%z "$OUT" 2>/dev/null || echo 0)
        if [[ "$sz" -gt "$MIN_SIZE" ]]; then
            log "DONE: ${TITLE} ($(( sz/1024/1024 ))MB)"
            break
        fi
    fi

    pid=$(pgrep -f "ffmpeg.*Eternal" 2>/dev/null | head -1)

    if [[ -n "$pid" ]]; then
        mtime=$(stat -f%m "$TMP" 2>/dev/null || echo 0)
        now=$(date +%s)
        age=$(( now - mtime ))
        sz=$(stat -f%z "$TMP" 2>/dev/null || echo 0)
        log "pid=$pid size=$(( sz/1024/1024 ))MB stale=${age}s"

        if [[ "$age" -gt 120 ]]; then
            log "STALL detected (${age}s) — killing pid=$pid"
            kill -9 "$pid" 2>/dev/null
            sleep 3
            new_pid=$(start_download)
            [[ -n "$new_pid" ]] && log "Restarted: pid=$new_pid"
        fi
    else
        # Not running — check if tmp exists and is big enough
        if [[ -f "$TMP" ]]; then
            sz=$(stat -f%z "$TMP" 2>/dev/null || echo 0)
            if [[ "$sz" -gt "$MIN_SIZE" ]]; then
                log "ffmpeg exited — probing file..."
                dur=$(ffprobe -v error -show_entries format=duration \
                      -of default=noprint_wrappers=1 "$TMP" 2>/dev/null)
                if [[ -n "$dur" ]]; then
                    mv "$TMP" "$OUT"
                    log "COMPLETE: moved to ${OUT} (${dur}s)"
                    break
                else
                    log "moov missing — restarting"
                    rm -f "$TMP"
                fi
            fi
        fi
        new_pid=$(start_download)
        [[ -n "$new_pid" ]] && log "Started: pid=$new_pid"
    fi

    sleep 60
done
