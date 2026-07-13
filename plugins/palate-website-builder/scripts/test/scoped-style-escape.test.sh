#!/usr/bin/env bash
# Tests scripts/gate-scoped-style-escape.mjs: it flags JS-CREATED DOM styled only by a
# scoped (non-:global) <style>, and - the key false-positive fix - does NOT flag the common
# existingEl.className state-toggle idiom (those elements carry the cid). :global and a
# top-level reset are clean.
set -uo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
CHECK="$DIR/gate-scoped-style-escape.mjs"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
pass=0; fail=0
ck() { local desc="$1" want="$2" dir="$3"; node "$CHECK" "$dir" >/dev/null 2>&1; local rc=$?; if [ "$rc" -eq "$want" ]; then echo "ok   - $desc (rc=$rc)"; pass=$((pass+1)); else echo "FAIL - $desc (rc=$rc want $want)"; fail=$((fail+1)); fi; }

# bad: createElement('li') targeted by scoped `.chips li` = the real shipped escape.
mkdir -p "$T/bad/src/pages"
cat > "$T/bad/src/pages/x.astro" <<'EOF'
<ul class="chips"></ul>
<script>
  const li = document.createElement('li');
  li.textContent = 'x';
  document.querySelector('.chips').replaceChildren(li);
</script>
<style>
  .chips li { background: gold; }
</style>
EOF
ck "injected <li> under a scoped descendant selector is flagged" 1 "$T/bad"

# fp-guard: existing element state toggle via className/classList + a created node fixed via :global.
mkdir -p "$T/good/src/pages"
cat > "$T/good/src/pages/x.astro" <<'EOF'
<div class="panel"></div>
<ul class="chips"></ul>
<script>
  const panel = document.querySelector('.panel');
  panel.className = 'panel open';
  panel.classList.toggle('active');
  const li = document.createElement('li');
  document.querySelector('.chips').replaceChildren(li);
</script>
<style>
  .panel { color: red; }
  .open { display: block; }
  .active { opacity: 1; }
  button { all: unset; }
  .chips :global(li) { background: gold; }
</style>
EOF
ck "existingEl.className idiom + :global fix is clean (no FP)" 0 "$T/good"

echo "----"; echo "scoped-style-escape.test: $pass passed, $fail failed"; [ "$fail" -eq 0 ]
