#!/usr/bin/env bash
# Tests evals/copy-verifier-calibration.mjs (W8): the concordance math is correct, and the
# illustrative seed (all todo) correctly reports "not enough labels" (exit 2).
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"; MOD="$DIR/../../evals/copy-verifier-calibration.mjs"
pass=0; fail=0; ck(){ if [ "$2" -eq 0 ]; then echo "ok   - $1"; pass=$((pass+1)); else echo "FAIL - $1"; fail=$((fail+1)); fi; }
# concordance math: 4 agree + 1 disagree over 5 decisive -> 0.8
node --input-type=module -e '
import { concordance } from "file://'"$MOD"'";
const mk=(sa,sb,h)=>({a:{axes:{specificity:sa,voiceFit:0,momentum:0,restraint:0}},b:{axes:{specificity:sb,voiceFit:0,momentum:0,restraint:0}},human_prefers:h});
const rows=[mk(5,1,"a"),mk(5,1,"a"),mk(5,1,"a"),mk(5,1,"a"),mk(1,5,"a")]; // last: verifier says b, human says a -> disagree
const c=concordance(rows);
process.exit((c.decisive===5 && c.agree===4 && c.concordance===0.8) ? 0 : 1);'
ck "concordance math: 4/5 decisive agree -> 0.8" $?
# seed exits 2 (illustrative todo rows only)
node "$MOD" "$DIR/../../evals/copy-verifier-calibration-labels.json" >/dev/null 2>&1; ck "illustrative seed -> exit 2 (awaits labels)" $([ $? -eq 2 ] && echo 0 || echo 1)
echo ""; echo "copy-verifier-calibration: $pass passed, $fail failed"; [ "$fail" -eq 0 ]
