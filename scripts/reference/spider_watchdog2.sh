#!/usr/bin/env bash
# Spider-Man watchdog — uses direct API bypass (no Playwright, no Cloudflare)
TITLE="Spider-Man Brand New Day"
TMDB=969681
OUT="/Volumes/HDDTRANSINT/visuales.uclv.cu/${TITLE}.mp4"
TMP="${OUT}.tmp.mp4"
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36"
LOG="/tmp/spider_watchdog2.log"
MIN_SIZE=104857600
CDN="https://byzantinebricolage.website"
API="https://data.vidsrc.sh/api.php?type=movie&tmdb=${TMDB}&stream_urls"
WASM_W=5969543

log() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG"; }

get_m3u8() {
    # 1. Fetch API response
    local api_json
    api_json=$(curl -s --max-time 15 "$API" \
        -H "Referer: https://cloudorchestranova.com/" \
        -H "Origin: https://cloudorchestranova.com" \
        -H "User-Agent: $UA")

    local enc_urls wasm_url wasm_w
    enc_urls=$(echo "$api_json" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data']['stream_urls'])" 2>/dev/null)
    wasm_w=$(echo "$api_json" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['vs']['w'])" 2>/dev/null)
    wasm_url=$(echo "$api_json" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['vs']['wasm_url'])" 2>/dev/null)

    if [[ -z "$enc_urls" || -z "$wasm_url" ]]; then
        log "API failed or no stream_urls"
        return 1
    fi

    # 2. Download WASM
    curl -s --max-time 15 "$wasm_url" \
        -H "Origin: https://cloudorchestranova.com" \
        -H "Referer: https://cloudorchestranova.com/" \
        -o /tmp/spider_dec.wasm 2>/dev/null

    if [[ ! -f /tmp/spider_dec.wasm ]] || ! file /tmp/spider_dec.wasm | grep -q "WebAssembly"; then
        log "WASM download failed"
        return 1
    fi

    # 3. Decrypt with Node.js
    local m3u8
    m3u8=$(node - "$enc_urls" << 'JSEOF'
const fs = require('fs');
const enc_b64 = process.argv[2];
const wasmBytes = fs.readFileSync('/tmp/spider_dec.wasm');
function b64decode(s) { return new Uint8Array(Buffer.from(s, 'base64')); }
WebAssembly.instantiate(wasmBytes, {}).then(r => {
  const ex = r.instance.exports;
  const enc = b64decode(enc_b64);
  const ptr = ex.alloc(enc.length);
  new Uint8Array(ex.memory.buffer, ptr, enc.length).set(enc);
  const outLen = ex.decrypt(ptr, enc.length);
  const dec = Buffer.from(ex.memory.buffer, ptr + 12, outLen).toString('utf8');
  // Return first URL
  const urls = dec.trim().split('\n').filter(u => u.includes('master.m3u8'));
  console.log(urls[0] || dec.split('\n')[0]);
}).catch(e => process.exit(1));
JSEOF
    )

    if [[ -z "$m3u8" ]]; then
        log "Decryption failed"
        return 1
    fi

    # 4. Get token
    local token
    token=$(curl -s --max-time 10 "${CDN}/generate.php" \
        -H "Referer: https://cloudorchestranova.com/" \
        -H "Origin: https://cloudorchestranova.com" \
        -H "User-Agent: $UA")

    if [[ -z "$token" ]]; then log "Token fetch failed"; return 1; fi

    # Append token
    echo "${m3u8}?token=${token}"
}

start_download() {
    local m3u8_url
    log "Getting stream URL..."
    m3u8_url=$(get_m3u8)
    if [[ -z "$m3u8_url" ]]; then log "FAIL: no m3u8"; return 1; fi
    log "m3u8: ${m3u8_url:0:80}..."
    rm -f "$TMP"
    ffmpeg -y \
        -reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 10 \
        -headers $"Referer: https://cloudorchestranova.com/\r\nUser-Agent: ${UA}\r\n" \
        -i "$m3u8_url" -c copy -bsf:a aac_adtstoasc \
        "$TMP" >> /tmp/ffmpeg_spider2.log 2>&1 &
    echo $!
}

log "=== watchdog2 start ==="

while true; do
    if [[ -f "$OUT" ]]; then
        sz=$(stat -f%z "$OUT" 2>/dev/null || echo 0)
        if [[ "$sz" -gt "$MIN_SIZE" ]]; then
            log "DONE: $(( sz/1024/1024 ))MB"
            break
        fi
    fi

    pid=$(pgrep -f "ffmpeg.*Spider" 2>/dev/null | head -1)

    if [[ -n "$pid" ]]; then
        mtime=$(stat -f%m "$TMP" 2>/dev/null || echo 0)
        now=$(date +%s)
        age=$(( now - mtime ))
        sz=$(stat -f%z "$TMP" 2>/dev/null || echo 0)
        log "pid=$pid size=$(( sz/1024/1024 ))MB stale=${age}s"
        if [[ "$age" -gt 120 ]]; then
            log "STALL (${age}s) — killing $pid"
            kill -9 "$pid" 2>/dev/null
            sleep 3
            new_pid=$(start_download)
            [[ -n "$new_pid" ]] && log "Restarted: pid=$new_pid"
        fi
    else
        if [[ -f "$TMP" ]]; then
            sz=$(stat -f%z "$TMP" 2>/dev/null || echo 0)
            if [[ "$sz" -gt "$MIN_SIZE" ]]; then
                log "ffmpeg exited — probing..."
                dur=$(ffprobe -v error -show_entries format=duration \
                      -of default=noprint_wrappers=1 "$TMP" 2>/dev/null)
                if [[ -n "$dur" ]]; then
                    mv "$TMP" "$OUT"
                    log "COMPLETE: $(( sz/1024/1024 ))MB duration=${dur}s"
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
