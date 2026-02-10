#!/usr/bin/env bash
# run-loop.sh — 50-iteration phased performance optimization loop
# Usage: bash scripts/overnight/run-loop.sh
# Monitor: tmux attach -t perf  OR  tail -30 ~/trendline/loop.log
set -euo pipefail

REPO_DIR="$HOME/trendline"
cd "$REPO_DIR"

SCRIPT_DIR="$REPO_DIR/scripts/overnight"
BENCHMARK_SCRIPT="$SCRIPT_DIR/benchmark.sh"
STATE_FILE="$SCRIPT_DIR/state.json"
LOG_FILE="$REPO_DIR/loop.log"
MAX_ITERATIONS=50
MAX_TURNS=12

# ── Logging ────────────────────────────────────────────────────────
log()  { local msg="[$(date '+%H:%M:%S')] $*"; echo "$msg"; echo "$msg" >> "$LOG_FILE"; }
ok()   { local msg="[$(date '+%H:%M:%S')] ✓ $*"; echo "$msg"; echo "$msg" >> "$LOG_FILE"; }
fail() { local msg="[$(date '+%H:%M:%S')] ✗ $*"; echo "$msg"; echo "$msg" >> "$LOG_FILE"; }

# ── State helpers (uses jq) ────────────────────────────────────────
read_state()  { jq -r "$1" "$STATE_FILE"; }
write_state() { local tmp=$(mktemp); jq "$1" "$STATE_FILE" > "$tmp" && mv "$tmp" "$STATE_FILE"; }

# ── Phase routing ──────────────────────────────────────────────────
get_phase() {
  local iter=$1
  if   (( iter <= 10 )); then echo 1
  elif (( iter <= 20 )); then echo 2
  elif (( iter <= 30 )); then echo 3
  elif (( iter <= 40 )); then echo 4
  else echo 5
  fi
}

get_prompt_file() {
  echo "$SCRIPT_DIR/phase${1}-prompt.md"
}

phase_name() {
  case $1 in
    1) echo "Bundle Reduction" ;;
    2) echo "API/DB Optimization" ;;
    3) echo "Server Component Migration" ;;
    4) echo "Build & Config" ;;
    5) echo "Runtime UX" ;;
  esac
}

# ── Build blocklist string from state.json ─────────────────────────
build_blocklist() {
  jq -r '(.blocklist + .completed) | map("- " + .) | join("\n")' "$STATE_FILE"
}

# ── Setup ──────────────────────────────────────────────────────────
git checkout experimental 2>/dev/null || git checkout -b experimental
git pull origin experimental 2>/dev/null || true

RESULTS_DIR="$REPO_DIR/perf-results/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$RESULTS_DIR"

# ── Baseline ───────────────────────────────────────────────────────
CURRENT_ITER=$(read_state '.iteration')
if [ "$CURRENT_ITER" -eq 0 ] || [ "$(read_state '.baseline')" = "null" ]; then
  log "Taking baseline benchmark..."
  bash "$BENCHMARK_SCRIPT" "$REPO_DIR" > "$RESULTS_DIR/baseline.json"
  cp "$RESULTS_DIR/baseline.json" "$SCRIPT_DIR/baseline.json"

  BASELINE_MAX=$(jq -r '.max_first_load_kb' "$RESULTS_DIR/baseline.json")
  BASELINE_TOTAL=$(jq -r '.total_first_load_kb' "$RESULTS_DIR/baseline.json")
  BASELINE_SHARED=$(jq -r '.shared_js_kb' "$RESULTS_DIR/baseline.json")
  BASELINE_BUILD=$(jq -r '.build_time_seconds' "$RESULTS_DIR/baseline.json")

  write_state ".baseline = {
    \"max_first_load_kb\": $BASELINE_MAX,
    \"total_first_load_kb\": $BASELINE_TOTAL,
    \"shared_js_kb\": $BASELINE_SHARED,
    \"build_time_seconds\": $BASELINE_BUILD
  }"
  write_state ".best = .baseline"

  log "Baseline: Max ${BASELINE_MAX}kB | Total ${BASELINE_TOTAL}kB | Shared ${BASELINE_SHARED}kB | Build ${BASELINE_BUILD}s"
else
  log "Resuming from iteration $CURRENT_ITER"
  BASELINE_MAX=$(read_state '.baseline.max_first_load_kb')
  BASELINE_TOTAL=$(read_state '.baseline.total_first_load_kb')
  log "Original baseline: Max ${BASELINE_MAX}kB | Total ${BASELINE_TOTAL}kB"
fi

BEST_MAX=$(read_state '.best.max_first_load_kb')
BEST_TOTAL=$(read_state '.best.total_first_load_kb')
BEST_SHARED=$(read_state '.best.shared_js_kb')
IMPROVEMENTS=$(read_state '.improvements')
REVERTS=$(read_state '.reverts')

# ── Main loop ──────────────────────────────────────────────────────
START_ITER=$((CURRENT_ITER + 1))

for i in $(seq "$START_ITER" "$MAX_ITERATIONS"); do
  PHASE=$(get_phase "$i")
  PHASE_ITER=$(( (i - 1) % 10 + 1 ))
  PROMPT_FILE=$(get_prompt_file "$PHASE")
  PNAME=$(phase_name "$PHASE")

  echo ""
  log "═══════════════════════════════════════════════════════════"
  log "Iteration $i / $MAX_ITERATIONS  |  Phase $PHASE: $PNAME  |  Phase iter $PHASE_ITER/10"
  log "Best: Max ${BEST_MAX}kB | Total ${BEST_TOTAL}kB | Shared ${BEST_SHARED}kB"
  log "═══════════════════════════════════════════════════════════"

  mkdir -p "$RESULTS_DIR/iter-$i"
  PRE_SHA=$(git rev-parse HEAD)

  # Build context string and blocklist
  BLOCKLIST=$(build_blocklist)
  CUMULATIVE_MAX=$(awk "BEGIN { printf \"%.1f\", ($BASELINE_MAX - $BEST_MAX) }")
  CUMULATIVE_TOTAL=$(awk "BEGIN { printf \"%.1f\", ($BASELINE_TOTAL - $BEST_TOTAL) }")
  CONTEXT="Iteration $i/$MAX_ITERATIONS | Phase $PHASE: $PNAME (iter $PHASE_ITER/10)
Current best: Max ${BEST_MAX}kB | Total ${BEST_TOTAL}kB | Shared ${BEST_SHARED}kB
Cumulative savings: Max -${CUMULATIVE_MAX}kB | Total -${CUMULATIVE_TOTAL}kB
Kept: $IMPROVEMENTS | Reverted: $REVERTS"

  # Inject blocklist and context into prompt
  PROMPT_CONTENT=$(cat "$PROMPT_FILE")
  PROMPT_CONTENT="${PROMPT_CONTENT//\{\{BLOCKLIST\}\}/$BLOCKLIST}"
  PROMPT_CONTENT="${PROMPT_CONTENT//\{\{CONTEXT\}\}/$CONTEXT}"

  # Run Claude
  claude -p "$PROMPT_CONTENT" \
    --output-format text \
    --max-turns "$MAX_TURNS" \
    > "$RESULTS_DIR/iter-$i/claude.txt" 2>&1 || true
  ok "Claude finished (iter $i)"

  # ── Validate changes ───────────────────────────────────────────
  # Check for src/ changes (or config changes in phase 4)
  if [ "$PHASE" -eq 4 ]; then
    CHANGED=$(git diff --name-only | wc -l | tr -d ' ')
  else
    CHANGED=$(git diff --name-only -- src/ | wc -l | tr -d ' ')
  fi

  if [ "$CHANGED" -eq "0" ]; then
    fail "No files changed. Skipping."
    git checkout -- . && git clean -fd -- src/ 2>/dev/null || true
    REVERTS=$((REVERTS + 1))
    write_state ".iteration = $i | .reverts = $REVERTS"
    continue
  fi

  # Clean up any files created outside allowed scope
  UNWANTED=$(git ls-files --others --exclude-standard -- . \
    | grep -v '^src/' \
    | grep -v '^perf-results/' \
    | grep -v '^scripts/overnight/' \
    || true)
  if [ -n "$UNWANTED" ]; then
    echo "$UNWANTED" | xargs rm -f 2>/dev/null || true
  fi

  # ── Build test ─────────────────────────────────────────────────
  if ! npm run build > "$RESULTS_DIR/iter-$i/build.txt" 2>&1; then
    fail "Build failed. Reverting."
    git checkout -- . && git clean -fd -- src/ 2>/dev/null || true
    git reset --hard "$PRE_SHA" 2>/dev/null || true
    REVERTS=$((REVERTS + 1))
    write_state ".iteration = $i | .reverts = $REVERTS"
    continue
  fi

  # ── Benchmark ──────────────────────────────────────────────────
  bash "$BENCHMARK_SCRIPT" "$REPO_DIR" > "$RESULTS_DIR/iter-$i/bench.json"

  NEW_MAX=$(jq -r '.max_first_load_kb' "$RESULTS_DIR/iter-$i/bench.json")
  NEW_TOTAL=$(jq -r '.total_first_load_kb' "$RESULTS_DIR/iter-$i/bench.json")
  NEW_SHARED=$(jq -r '.shared_js_kb' "$RESULTS_DIR/iter-$i/bench.json")

  # Calculate deltas (positive = regression, negative = improvement)
  MAX_DELTA=$(awk "BEGIN { printf \"%.2f\", ($NEW_MAX - $BEST_MAX) / $BEST_MAX * 100 }")
  TOTAL_DELTA=$(awk "BEGIN { printf \"%.2f\", ($NEW_TOTAL - $BEST_TOTAL) / $BEST_TOTAL * 100 }")
  SHARED_DELTA=$(awk "BEGIN { printf \"%.2f\", ($NEW_SHARED - $BEST_SHARED) / $BEST_SHARED * 100 }")

  log "Delta: Max ${MAX_DELTA}% | Total ${TOTAL_DELTA}% | Shared ${SHARED_DELTA}%"

  # ── Accept/reject logic ────────────────────────────────────────
  # Accept if ANY metric improved AND no metric regressed > 2%
  ANY_IMPROVED=false
  ANY_REGRESSED=false

  # Check for improvements (negative delta = smaller = better)
  if awk "BEGIN { exit !($MAX_DELTA < -0.01) }"; then ANY_IMPROVED=true; fi
  if awk "BEGIN { exit !($TOTAL_DELTA < -0.01) }"; then ANY_IMPROVED=true; fi
  if awk "BEGIN { exit !($SHARED_DELTA < -0.01) }"; then ANY_IMPROVED=true; fi

  # Check for regressions > 2%
  if awk "BEGIN { exit !($MAX_DELTA > 2.0) }"; then ANY_REGRESSED=true; fi
  if awk "BEGIN { exit !($TOTAL_DELTA > 2.0) }"; then ANY_REGRESSED=true; fi
  if awk "BEGIN { exit !($SHARED_DELTA > 2.0) }"; then ANY_REGRESSED=true; fi

  if [ "$ANY_IMPROVED" = true ] && [ "$ANY_REGRESSED" = false ]; then
    ok "KEPT! Max ${MAX_DELTA}% | Total ${TOTAL_DELTA}% | Shared ${SHARED_DELTA}%"

    # Extract summary from Claude's output (last non-empty line)
    SUMMARY=$(tail -20 "$RESULTS_DIR/iter-$i/claude.txt" | grep -v '^$' | tail -1 | head -c 200)

    # Stage and commit
    git add -A
    git commit -m "perf(p${PHASE}-i${i}): ${SUMMARY}" || true

    # Update state
    BEST_MAX="$NEW_MAX"
    BEST_TOTAL="$NEW_TOTAL"
    BEST_SHARED="$NEW_SHARED"
    IMPROVEMENTS=$((IMPROVEMENTS + 1))

    write_state ".iteration = $i | .improvements = $IMPROVEMENTS"
    write_state ".best = {
      \"max_first_load_kb\": $NEW_MAX,
      \"total_first_load_kb\": $NEW_TOTAL,
      \"shared_js_kb\": $NEW_SHARED
    }"
    write_state ".completed += [\"p${PHASE}-i${i}: ${SUMMARY}\"]"
    write_state ".history += [{
      \"iteration\": $i,
      \"phase\": $PHASE,
      \"action\": \"kept\",
      \"max_delta\": \"${MAX_DELTA}%\",
      \"total_delta\": \"${TOTAL_DELTA}%\",
      \"shared_delta\": \"${SHARED_DELTA}%\",
      \"summary\": \"${SUMMARY}\"
    }]"
  else
    if [ "$ANY_REGRESSED" = true ]; then
      fail "Regression > 2% detected. Reverting."
    else
      fail "No measurable improvement. Reverting."
    fi

    git checkout -- . && git clean -fd -- src/ 2>/dev/null || true
    git reset --hard "$PRE_SHA" 2>/dev/null || true
    REVERTS=$((REVERTS + 1))

    write_state ".iteration = $i | .reverts = $REVERTS"
    write_state ".history += [{
      \"iteration\": $i,
      \"phase\": $PHASE,
      \"action\": \"reverted\",
      \"max_delta\": \"${MAX_DELTA}%\",
      \"total_delta\": \"${TOTAL_DELTA}%\",
      \"shared_delta\": \"${SHARED_DELTA}%\"
    }]"
  fi

  log "Score: $IMPROVEMENTS kept, $REVERTS reverted (iter $i/$MAX_ITERATIONS)"
done

# ── Final summary ────────────────────────────────────────────────
echo ""
log "═══════════════════════════════════════════════════════════"
log "COMPLETE: $MAX_ITERATIONS iterations finished"
log "Results: $IMPROVEMENTS kept, $REVERTS reverted"
FINAL_MAX_SAVINGS=$(awk "BEGIN { printf \"%.1f\", ($BASELINE_MAX - $BEST_MAX) }")
FINAL_TOTAL_SAVINGS=$(awk "BEGIN { printf \"%.1f\", ($BASELINE_TOTAL - $BEST_TOTAL) }")
log "Total savings: Max -${FINAL_MAX_SAVINGS}kB | Total -${FINAL_TOTAL_SAVINGS}kB"
log "Baseline: Max ${BASELINE_MAX}kB → Final: Max ${BEST_MAX}kB"
log "═══════════════════════════════════════════════════════════"
