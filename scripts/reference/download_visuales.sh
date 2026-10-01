#!/bin/bash
set -u
BASE="https://visuales.uclv.cu"
SEASON="${2:-6}"
EXT="${1:-srt}"
RELDIR="${3:-Series/Ingles/Suits/Suits x $SEASON}"
SHOW=$(basename "$RELDIR" | sed -E 's/ ?x [0-9]+$//')
DIR="$RELDIR"
UENC=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$RELDIR")
URL="$BASE/$UENC/"
TAG=$(printf '%s' "$RELDIR" | tr -c 'A-Za-z0-9' '_')
FILES="/tmp/files_${TAG}.txt"
SIZES="/tmp/sizes_${TAG}.tsv"
mkdir -p "$DIR"
if [ -s "$FILES" ] && [ "${FORCE_LIST:-0}" != "1" ]; then
    echo "(reusing cached file list $FILES)"
else
    for attempt in 1 2 3 4 5; do
        python3 - "$URL" "$EXT" <<'PYEOF' > "$FILES" 2>/tmp/files.err
import re, sys, urllib.request, urllib.parse
url, ext = sys.argv[1], sys.argv[2]
exts = [e.strip().lower().lstrip(".") for e in ext.split(",") if e.strip()]
req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
html = urllib.request.urlopen(req, timeout=60).read().decode("utf-8", "replace")
for m in re.findall(r'<a href="([^"]+)"', html):
    href = urllib.parse.unquote(m)
    if m.startswith(("?", "../")):
        continue
    if any(href.lower().endswith("." + e) for e in exts):
        print(href)
PYEOF
        if [ -s "$FILES" ]; then break; fi
        echo "   (list retry $attempt failed: $(tail -1 /tmp/files.err))"
        sleep 5
    done
fi
if [ ! -s "$SIZES" ]; then
    echo "WARN: $SIZES missing; complete-file skipping disabled"
fi
n=0; skipped=0
while IFS= read -r fname; do
    n=$((n+1))
    enc=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$fname")
    src="$DIR/$fname"
    base=$(basename "$src")
    # derive episode from server filename (SxxExx / sxxexx / NxNN) and build clean target
    ep=""
    ubase=$(printf '%s' "$base" | tr '[:lower:]' '[:upper:]')
    if [[ "$ubase" =~ (S[0-9]{2}E[0-9]{2}) ]]; then
        ep="${BASH_REMATCH[1]}"
    elif [[ "$ubase" =~ (^|[^0-9])([0-9]{1,2})X([0-9]{2})([^0-9]|$) ]]; then
        ep=$(printf 'S%02dE%s' "$((10#${BASH_REMATCH[2]}))" "${BASH_REMATCH[3]}")
    fi
    if [ -n "$ep" ]; then
        ext="${base##*.}"
        tgt="$DIR/$SHOW $ep.$ext"
    else
        tgt="$src"
    fi
    local=$([ -f "$tgt" ] && stat -f%z "$tgt" || echo 0)
    expect=$(awk -F'\t' -v n="$ep" '$1==n{print $2; exit}' "$SIZES")
    if [ -n "$expect" ] && [ "$local" -ge $((expect - 2*1024*1024)) ]; then
        echo "[$n] SKIP (complete): $tgt ($(du -h "$tgt" 2>/dev/null | cut -f1))"
        skipped=$((skipped+1)); continue
    fi
    printf '[%s] %s  (%s local)\n' "$n" "$base" "$(du -h "$tgt" 2>/dev/null | cut -f1)"
    if curl -sS --fail -C - --retry 15 --retry-all-errors --retry-delay 3 \
         --speed-limit 1024 --speed-time 30 -o "$src" \
         "$URL$enc"; then
        echo "   ok ($(du -h "$src" | cut -f1))"
        if [ "$tgt" != "$src" ] && [ ! -e "$tgt" ]; then
            mv "$src" "$tgt" && echo "   -> renamed to $(basename "$tgt")"
        fi
    else
        echo "   FAIL"
    fi
done < "$FILES"
echo "=== done: $n files (skipped $skipped), ext=$EXT, season=$SEASON ==="