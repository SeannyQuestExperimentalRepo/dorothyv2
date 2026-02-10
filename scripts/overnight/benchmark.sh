#!/usr/bin/env bash
# benchmark.sh — Parse route-level First Load JS from Next.js build output
# Usage: bash benchmark.sh [repo_dir]
# Outputs JSON with per-route First Load JS sizes and totals
set -euo pipefail

REPO_DIR="${1:-$(pwd)}"
cd "$REPO_DIR"

# Run build and capture output (need stdout for route table)
BUILD_LOG=$(mktemp)
BUILD_START=$(date +%s)
if ! npm run build >"$BUILD_LOG" 2>&1; then
  BUILD_END=$(date +%s)
  echo '{"error": "build failed", "build_time_seconds": '"$((BUILD_END - BUILD_START))"', "timestamp": "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"}'
  rm -f "$BUILD_LOG"
  exit 1
fi
BUILD_END=$(date +%s)
BUILD_TIME_S=$((BUILD_END - BUILD_START))

# Parse route lines from build output
# Format: ├ ○ /route                   Size     First Load JS
# We want the LAST size value (First Load JS) for each non-API page route
ROUTES_JSON=$(awk '
  /^[├┌└]/ {
    # Skip API routes
    if ($0 ~ /\/api\//) next

    # Find route path (token starting with /)
    path = ""
    for (i = 1; i <= NF; i++) {
      if (substr($i, 1, 1) == "/") {
        path = $i
        break
      }
    }
    if (path == "") next

    # Determine route type
    type = "unknown"
    if (index($0, "\xe2\x97\x8b")) type = "static"
    if (index($0, "\xc6\x92")) type = "dynamic"

    # Last two tokens are the First Load JS value and unit
    unit = $NF
    val = $(NF-1) + 0
    if (unit == "B") kb = val / 1024
    else if (unit == "kB") kb = val
    else if (unit == "MB") kb = val * 1024
    else next

    # Print with comma prefix (we strip the first comma later)
    printf "ROUTE_ENTRY{\"route\":\"%s\",\"type\":\"%s\",\"first_load_kb\":%.1f}\n", path, type, kb
  }
' "$BUILD_LOG" | awk '
  BEGIN { first = 1 }
  /^ROUTE_ENTRY/ {
    json = substr($0, 12)
    if (!first) printf ",\n"
    printf "    %s", json
    first = 0
  }
  END { if (!first) printf "\n" }
')

# Parse shared JS line: + First Load JS shared by all   87.4 kB
SHARED_KB=$(awk '
  /First Load JS shared by all/ {
    unit = $NF
    val = $(NF-1) + 0
    if (unit == "B") val = val / 1024
    if (unit == "MB") val = val * 1024
    printf "%.1f", val
    exit
  }
' "$BUILD_LOG")
SHARED_KB="${SHARED_KB:-0}"

# Max first load across page routes (key optimization target)
MAX_FIRST_LOAD=$(awk '
  /^[├┌└]/ {
    if ($0 ~ /\/api\//) next
    unit = $NF
    val = $(NF-1) + 0
    if (unit == "B") val = val / 1024
    else if (unit == "kB") val = val
    else if (unit == "MB") val = val * 1024
    else next
    if (val > max) max = val
  }
  END { printf "%.1f", max + 0 }
' "$BUILD_LOG")

# Total first load across page routes
TOTAL_FIRST_LOAD=$(awk '
  /^[├┌└]/ {
    if ($0 ~ /\/api\//) next
    unit = $NF
    val = $(NF-1) + 0
    if (unit == "B") val = val / 1024
    else if (unit == "kB") val = val
    else if (unit == "MB") val = val * 1024
    else next
    total += val
  }
  END { printf "%.1f", total + 0 }
' "$BUILD_LOG")

# JS bundle size from .next/static (backward compat)
JS_BUNDLE_KB=0
if [ -d ".next/static" ]; then
  JS_BUNDLE_KB=$(find .next/static -name '*.js' -exec du -sk {} + 2>/dev/null | awk '{s+=$1} END {print s+0}')
fi

rm -f "$BUILD_LOG"

cat <<EOF
{
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "build_time_seconds": $BUILD_TIME_S,
  "shared_js_kb": $SHARED_KB,
  "max_first_load_kb": $MAX_FIRST_LOAD,
  "total_first_load_kb": $TOTAL_FIRST_LOAD,
  "js_bundle_kb": $JS_BUNDLE_KB,
  "routes": [
$ROUTES_JSON
  ]
}
EOF
