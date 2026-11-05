/**
 * hooks/build-log-entry.mjs - the cross-build log entry shape (pure, testable).
 *
 * Extracted from palate-stop.mjs recordBuild so the W1 Explore-label capture has a
 * unit-testable seam. Given a parsed build-manifest object `m` and the display `faces`
 * already read from the rendered variants, it returns the single entry appended to
 * ~/.config/palate/builds.log.json. recordBuild owns the side effects (reading the
 * manifest, computing faces, the gated append); this owns ONLY the entry shape, so the
 * done-gate ("every Explore variant shown is logged, not just the pick") is assertable
 * without faking a whole passing build.
 *
 * The lean fields (business / signature_move / donors / faces) are UNCHANGED from the
 * original recordBuild, because scripts/gate-novelty.mjs reads them for cross-build
 * diversification - do not rename or drop them.
 */

export function buildLogEntry(m, faces) {
  const entry = {
    ts: new Date().toISOString(),
    business: m.business ?? null,
    signature_move: m.signature_move ?? null,
    donors: m.references_surveyed ?? [],
    faces: Array.isArray(faces) ? faces : [],
  };
  // W1 (gap6 item 3): persist the Explore choice sets - every variant SHOWN (not just
  // the pick) plus the accept (picks) and edit signal, with the surface context (each
  // variant's position) that later propensity correction needs (the surfaced set is
  // Missing-Not-At-Random, so the choice set must be captured now to debias later).
  // Agent-set descriptive block, passed through verbatim like manifest.variants; omitted
  // when Explore did not run (calm / edit builds) so the entry stays lean for the
  // diversification reader. The per-surface REJECT signal is the shown-minus-pick
  // complement, derived later, not stored redundantly.
  if (m.explore && typeof m.explore === "object") entry.explore = m.explore;
  return entry;
}
