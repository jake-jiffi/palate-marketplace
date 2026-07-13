# Eval 09 - the reviewer pass catches an intentional weakness

### Brief (verbatim)

> Build a preview of a website for Marrickville Trades, a small electrical
> business. The blog index is intentionally rendered with no zero-items
> state - I want to see whether the reviewer pass catches it.

### Expected behaviour

At Phase A.4, after the canonical pages are composed and `content.ts` is
filled, Claude takes the reviewer stance and walks the pages against
`references/audit-dimensions.md`. The empty-state oversight on the blog
index is named in the findings list, in the canonical output block from
`audit-dimensions.md` (file path on its own line, then indented
`Lnn [severity / dimension] finding`). The build does not advance until the
finding is fixed.

### Checklist

- [ ] Reviewer-pass output exists in the build transcript or as
      `audit-findings.md` in the project root.
- [ ] Output format is the canonical block from `audit-dimensions.md`: the
      file path on its own line, then findings indented as
      `Lnn [severity / dimension] finding`, grouped by file, no preamble, no
      padding. `pass` is allowed on files with no Critical or High findings.
- [ ] The finding on `src/pages/blog/index.astro` (or whichever path the
      collection lives at) is recorded at Severity High under the
      `empty-state` dimension, with a concrete fix suggested.
- [ ] The output addresses dimension 11 (reference fidelity): for the
      composed pages it either names the reproduced signature move and its
      location (the lead donor's move, with a `Lnn` cite under the
      `reference-fidelity` dimension), or records a Critical/High where the
      page is default-shaped with no reproduced move.
- [ ] Before fix, the build is halted (does not hand over the preview).
- [ ] After fix, the reviewer pass re-runs and reports no Critical or High
      findings on the affected file (`pass` is acceptable).
- [ ] `scripts/ux-lint.sh` is also re-run after fix and is clean.
- [ ] The preview is handed over only after both the reviewer pass and
      `ux-lint.sh` come back clean.

### Regression signals

The reviewer pass not running (no `audit-findings.md` and no findings in
the transcript); the empty-state hole NOT named in the findings (the audit
dimension is wired but the reviewer is rubber-stamping); the build handed
over before findings are fixed; output in prose rather than the canonical
`Lnn [severity / dimension]` block (the discipline has drifted).

Over-reporting is itself a failure: padding clean files with Cosmetic noise
to look thorough, manufacturing filler findings, or encouraging sentences
around the list all count as a regression. A clean file gets `pass`, not a
paragraph.
