#!/usr/bin/env bash
# dl.sh — descargar película de vidsrc.sh API
#
# Uso:
#   dl.sh <tmdb_id>                              # directo
#   dl.sh <vsembed URL>                          # https://vsembed.ru/embed/movie?tmdb=XXXXX
#   dl.sh <cuevana3e URL>                        # https://cuevana3e.pro/pelicula/...
#   dl.sh <tmdb_id|url> [directorio_salida]      # segundo arg = destino (default: dir actual)
#
# Ejemplos:
#   dl.sh 969681
#   dl.sh "https://cuevana3e.pro/pelicula/spider-man-un-nuevo-dia"
#   dl.sh 969681 /Volumes/HDDTRANSINT/visuales.uclv.cu

set -uo pipefail

# ── config ─────────────────────────────────────────────────────────────────
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
PLAYWRIGHT_BROWSERS_PATH=~/.cache/ms-playwright
MIN_SIZE=104857600   # 100MB mínimo para considerar completo
STALL_SECS=120       # segundos sin escritura = stall
API_BASE="https://data.vidsrc.sh/api.php"
REFERER="https://cloudorchestranova.com/"

# ── argumentos ─────────────────────────────────────────────────────────────
INPUT="${1:-}"
OUT_DIR="${2:-.}"

if [[ -z "$INPUT" ]]; then
  echo "Uso: dl.sh <tmdb_id|vsembed_url|cuevana3e_url> [directorio_salida]"
  exit 1
fi

mkdir -p "$OUT_DIR"
LOG="${OUT_DIR}/dl_$(date +%Y%m%d_%H%M%S).log"

log() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG"; }

# ── extraer TMDB ID ─────────────────────────────────────────────────────────
get_tmdb_id() {
  local input="$1"

  # número directo
  if [[ "$input" =~ ^[0-9]+$ ]]; then
    echo "$input"; return 0
  fi

  # vsembed URL: ?tmdb=XXXXX
  if [[ "$input" =~ tmdb=([0-9]+) ]]; then
    echo "${BASH_REMATCH[1]}"; return 0
  fi

  # cuevana3e URL → scrape DOM para vsembed Goldmember server
  if [[ "$input" =~ cuevana3e ]]; then
    log "Cuevana3e URL detectada — buscando TMDB ID en DOM..."
    local tmdb
    tmdb=$(PLAYWRIGHT_BROWSERS_PATH="$PLAYWRIGHT_BROWSERS_PATH" \
      node - "$input" << 'JSEOF'
const { chromium } = require('playwright');
(async () => {
  const url = process.argv[2];
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  } catch(e) {}
  const tmdb = await page.evaluate(() => {
    for (const el of document.querySelectorAll('[data-server]')) {
      const s = el.getAttribute('data-server') || '';
      if (s.includes('?v=')) {
        try {
          const dec = atob(s.split('?v=')[1]);
          const m = dec.match(/tmdb=(\d+)/);
          if (m) return m[1];
        } catch(e) {}
      }
      const m = s.match(/tmdb=(\d+)/);
      if (m) return m[1];
    }
    return '';
  });
  console.log(tmdb || '');
  await browser.close();
})();
JSEOF
    )
    if [[ -n "$tmdb" ]]; then
      echo "$tmdb"; return 0
    fi
    log "ERROR: no se encontró TMDB ID en la página"
    return 1
  fi

  log "ERROR: no se pudo determinar TMDB ID de: $input"
  return 1
}

# ── obtener m3u8 via API bypass (sin Cloudflare) ────────────────────────────
get_m3u8() {
  local tmdb="$1"

  log "Llamando API: $API_BASE?type=movie&tmdb=${tmdb}&stream_urls"
  local api_json
  api_json=$(curl -s --max-time 20 \
    "${API_BASE}?type=movie&tmdb=${tmdb}&stream_urls" \
    -H "Referer: $REFERER" -H "Origin: https://cloudorchestranova.com" \
    -H "User-Agent: $UA")

  # Extraer campos
  local enc_urls wasm_url cdn_host title
  enc_urls=$(echo "$api_json" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data']['stream_urls'])" 2>/dev/null)
  wasm_url=$(echo "$api_json"  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['vs']['wasm_url'])" 2>/dev/null)
  title=$(echo "$api_json"     | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data']['title'])" 2>/dev/null)

  if [[ -z "$enc_urls" ]]; then
    # stream_urls ya es array (sin cifrado) o error
    local plain_url
    plain_url=$(echo "$api_json" | python3 -c "import sys,json; d=json.load(sys.stdin); urls=d['data']['stream_urls']; print(urls[0] if isinstance(urls,list) else '')" 2>/dev/null)
    if [[ -n "$plain_url" ]]; then
      MOVIE_TITLE="$title"
      CDN_HOST="$(echo "$plain_url" | grep -oE 'https?://[^/]+')"
      echo "$plain_url"
      return 0
    fi
    log "ERROR: API no devolvió stream_urls (respuesta: ${api_json:0:200})"
    return 1
  fi

  if [[ -z "$wasm_url" ]]; then
    log "ERROR: no hay wasm_url en respuesta"
    return 1
  fi

  # CDN host (para generate.php)
  CDN_HOST=$(echo "$wasm_url" | grep -oE 'https?://[^/]+')

  # Descargar WASM
  log "Descargando WASM decryptor..."
  curl -s --max-time 15 "$wasm_url" \
    -H "Origin: https://cloudorchestranova.com" \
    -H "Referer: $REFERER" \
    -o /tmp/dl_dec_${tmdb}.wasm 2>/dev/null

  if ! file /tmp/dl_dec_${tmdb}.wasm 2>/dev/null | grep -q "WebAssembly"; then
    log "ERROR: WASM inválido"
    return 1
  fi

  # Descifrar con Node.js
  log "Descifrando stream URLs..."
  local decrypted
  decrypted=$(node - "$enc_urls" "/tmp/dl_dec_${tmdb}.wasm" << 'JSEOF'
const fs = require('fs');
const enc_b64 = process.argv[2];
const wasm_path = process.argv[3];
const wasmBytes = fs.readFileSync(wasm_path);
function b64decode(s) { return new Uint8Array(Buffer.from(s, 'base64')); }
WebAssembly.instantiate(wasmBytes, {}).then(r => {
  const ex = r.instance.exports;
  const enc = b64decode(enc_b64);
  const ptr = ex.alloc(enc.length);
  new Uint8Array(ex.memory.buffer, ptr, enc.length).set(enc);
  const outLen = ex.decrypt(ptr, enc.length);
  const dec = Buffer.from(ex.memory.buffer, ptr + 12, outLen).toString('utf8');
  console.log(dec.trim());
}).catch(e => { process.stderr.write(e.message + '\n'); process.exit(1); });
JSEOF
  )

  if [[ -z "$decrypted" ]]; then
    log "ERROR: decryption falló"
    return 1
  fi

  # Primera URL válida
  local m3u8
  m3u8=$(echo "$decrypted" | grep -m1 "master\.m3u8\|index\.m3u8" || echo "$decrypted" | head -1)

  MOVIE_TITLE="$title"
  echo "$m3u8"
}

# ── obtener token JWT ────────────────────────────────────────────────────────
get_token() {
  local cdn="$1"
  curl -s --max-time 10 "${cdn}/generate.php" \
    -H "Referer: $REFERER" -H "Origin: https://cloudorchestranova.com" \
    -H "User-Agent: $UA"
}

# ── iniciar descarga ─────────────────────────────────────────────────────────
start_ffmpeg() {
  local m3u8_base="$1"
  local token="$2"
  local out_tmp="$3"
  local m3u8_url

  if [[ "$m3u8_base" == *"token="* ]]; then
    m3u8_url="$m3u8_base"
  else
    m3u8_url="${m3u8_base}?token=${token}"
  fi

  rm -f "$out_tmp"
  ffmpeg -y \
    -reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 10 \
    -headers $"Referer: ${REFERER}\r\nUser-Agent: ${UA}\r\n" \
    -i "$m3u8_url" -c copy -bsf:a aac_adtstoasc \
    "$out_tmp" >> "${LOG%.log}_ffmpeg.log" 2>&1 &
  echo $!
}

# ── loop principal ──────────────────────────────────────────────────────────
main() {
  log "=== dl.sh start | input: $INPUT ==="

  # 1. TMDB ID
  local tmdb
  tmdb=$(get_tmdb_id "$INPUT") || exit 1
  log "TMDB ID: $tmdb"

  # 2. Stream URL
  local CDN_HOST MOVIE_TITLE m3u8_base
  CDN_HOST=""
  MOVIE_TITLE=""
  m3u8_base=$(get_m3u8 "$tmdb") || exit 1
  log "Título: $MOVIE_TITLE"
  log "CDN: $CDN_HOST"
  log "m3u8 base: ${m3u8_base:0:80}..."

  # 3. Nombre de archivo
  local safe_title
  safe_title=$(echo "$MOVIE_TITLE" | tr '/:*?"<>|\\' '_' | sed 's/  */ /g' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
  local out_file="${OUT_DIR}/${safe_title}.mp4"
  local out_tmp="${out_file}.tmp.mp4"

  # 4. Ya existe?
  if [[ -f "$out_file" ]]; then
    sz=$(stat -f%z "$out_file" 2>/dev/null || echo 0)
    if [[ "$sz" -gt "$MIN_SIZE" ]]; then
      log "Ya existe: $out_file ($(( sz/1024/1024 ))MB)"
      exit 0
    fi
  fi

  # 5. Watchdog loop
  local pid="" token m3u8_url

  while true; do
    # ¿Terminó?
    if [[ -f "$out_file" ]]; then
      sz=$(stat -f%z "$out_file" 2>/dev/null || echo 0)
      if [[ "$sz" -gt "$MIN_SIZE" ]]; then
        log "LISTO: $out_file ($(( sz/1024/1024 ))MB)"
        break
      fi
    fi

    # ¿ffmpeg corriendo?
    pid=$(pgrep -f "ffmpeg.*$(basename "$out_tmp" | cut -c1-20)" 2>/dev/null | head -1 || true)

    if [[ -n "$pid" ]]; then
      mtime=$(stat -f%m "$out_tmp" 2>/dev/null || echo 0)
      now=$(date +%s)
      age=$(( now - mtime ))
      sz=$(stat -f%z "$out_tmp" 2>/dev/null || echo 0)
      log "pid=$pid  size=$(( sz/1024/1024 ))MB  stale=${age}s"

      if [[ "$age" -gt "$STALL_SECS" ]]; then
        log "STALL detectado (${age}s) — reiniciando"
        kill -9 "$pid" 2>/dev/null || true
        sleep 3

        # Token fresco + nueva URL
        token=$(get_token "$CDN_HOST")
        pid=$(start_ffmpeg "$m3u8_base" "$token" "$out_tmp")
        log "Reiniciado: pid=$pid"
      fi
    else
      # No corre — verificar si tmp existe y es válido
      if [[ -f "$out_tmp" ]]; then
        sz=$(stat -f%z "$out_tmp" 2>/dev/null || echo 0)
        if [[ "$sz" -gt "$MIN_SIZE" ]]; then
          log "ffmpeg terminó — verificando..."
          dur=$(ffprobe -v error -show_entries format=duration \
                -of default=noprint_wrappers=1 "$out_tmp" 2>/dev/null)
          if [[ -n "$dur" ]]; then
            mv "$out_tmp" "$out_file"
            log "COMPLETO: $out_file | duración=${dur}s"

            # Subtítulos
            if command -v subliminal &>/dev/null; then
              log "Descargando subtítulos en español..."
              subliminal download -f -l es "$out_file" >> "$LOG" 2>&1 || true
              # Sincronizar
              if command -v ffsubsync &>/dev/null && [[ -f "${out_file%.mp4}.es.srt" ]]; then
                ffsubsync "$out_file" -i "${out_file%.mp4}.es.srt" \
                  -o "${out_file%.mp4}.es.srt" >> "$LOG" 2>&1 || true
                log "Subtítulos sincronizados"
              fi
            fi
            break
          else
            log "moov atom faltante — borrando y reiniciando"
            rm -f "$out_tmp"
          fi
        fi
      fi

      # Iniciar descarga fresca
      log "Iniciando descarga..."
      # Obtener URL fresca si el WASM expiró (ventana de 5 min)
      m3u8_base=$(get_m3u8 "$tmdb") || { log "ERROR: no m3u8 — reintentando en 5min"; sleep 300; continue; }
      token=$(get_token "$CDN_HOST")
      pid=$(start_ffmpeg "$m3u8_base" "$token" "$out_tmp")
      log "Iniciado: pid=$pid"
    fi

    sleep 60
  done
}

main
