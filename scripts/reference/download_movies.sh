#!/usr/bin/env bash
# Download movies via vsembed.ru (Multilenguaje) — extracted from cuevana3e Multilenguaje tabs
# Auto-retries if stream cuts short

set -uo pipefail

SCRIPTS_DIR="/Volumes/HDDTRANSINT/visuales.uclv.cu/scripts"
OUT_DIR="/Volumes/HDDTRANSINT/visuales.uclv.cu"
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36"
MIN_SIZE=104857600  # 100MB (HLS bitrate varies; check duration separately)
MAX_RETRIES=5

log() { echo "[$(date +%H:%M:%S)] $*"; }

download_movie() {
    local title="$1"
    local cuevana_url="$2"
    local out="${OUT_DIR}/${title}.mp4"

    if [[ -f "$out" ]]; then
        sz=$(stat -f%z "$out" 2>/dev/null || echo 0)
        if [[ "$sz" -gt "$MIN_SIZE" ]]; then
            log "[SKIP] $title complete ($(( sz/1024/1024 ))MB)"
            return 0
        else
            log "[PARTIAL] $title only $(( sz/1024/1024 ))MB — redownloading"
            rm -f "$out"
        fi
    fi

    local attempt=0
    while [[ $attempt -lt $MAX_RETRIES ]]; do
        (( attempt++ )) || true
        log "[TRY $attempt/$MAX_RETRIES] $title — detecting m3u8..."

        local m3u8
        m3u8=$(cd "$SCRIPTS_DIR" && PLAYWRIGHT_BROWSERS_PATH=~/.cache/ms-playwright \
               node "$SCRIPTS_DIR/find_m3u8_movie.js" "$cuevana_url" \
               2>"/tmp/playwright_${title// /_}.log")

        if [[ -z "$m3u8" ]]; then
            log "  FAIL: no m3u8 — check /tmp/playwright_${title// /_}.log — retrying 30s"
            sleep 30
            continue
        fi

        log "  m3u8: ${m3u8:0:100}"

        local tmp="${out}.tmp.mp4"
        rm -f "$tmp"

        ffmpeg -y \
            -reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 10 \
            -headers $"Referer: https://cloudorchestranova.com/\r\nUser-Agent: ${UA}\r\n" \
            -i "$m3u8" \
            -c copy -bsf:a aac_adtstoasc \
            "$tmp" 2>&1 | grep -E 'frame=.*time=|error|Error' | tail -3

        local sz
        sz=$(stat -f%z "$tmp" 2>/dev/null || echo 0)
        local mb=$(( sz / 1024 / 1024 ))

        if [[ "$sz" -gt "$MIN_SIZE" ]]; then
            mv "$tmp" "$out"
            log "[OK] $title — ${mb}MB"
            return 0
        else
            log "  INCOMPLETE: ${mb}MB (need >500MB) — retrying..."
            rm -f "$tmp"
            sleep 15
        fi
    done

    log "[FAIL] $title — gave up after $MAX_RETRIES attempts"
    return 1
}

echo "====================================="
echo "Movie downloads — Multilenguaje (vsembed)"
echo "====================================="

# vsembed Multilenguaje URLs (extracted from cuevana3e data-server attrs)
download_movie "Uncut Gems"                          "https://vsembed.ru/embed/movie?tmdb=473033&ds_lang=es"
download_movie "Eternal Sunshine of the Spotless Mind" "https://vsembed.ru/embed/movie?tmdb=38&ds_lang=es"
download_movie "Reign Over Me"                       "https://vsembed.ru/embed/movie?tmdb=2355&ds_lang=es"

echo "====================================="
echo "Done"
ls -lh "${OUT_DIR}"/*.mp4 2>/dev/null
