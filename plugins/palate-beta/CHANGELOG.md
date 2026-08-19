# Changelog

What changed in the Palate website builder, and why it matters to a build you are about to run.

Update with `/plugin marketplace update palate`, then `/reload-plugins`. No reinstall is needed
and no documented command has ever changed.

## 1.14.0

The release that came out of reviewing two real client builds side by side: one the client was
delighted with, one that cost its owner a day. Almost everything here traces to that comparison.

**Your survey was being deleted.** A build surveys the library and diverges *before* it
scaffolds, so its record is kept beside the working directory. The moment the project appeared,
a guard meant to stop two builds mixing compared the two paths for equality, decided they were
different builds, and wiped every recorded reference, inner page and craft layer. That is the
normal build order, so it was happening to almost every build, and every check downstream then
read the work as if the library had never been touched. Fixed, and the record now also lives in
an append-only log beside the manifest, so it survives being moved, deleted or overwritten.

**A survey is now required before any code is written.** The depth bar (five references, two
inner pages, three tools, one deep read with a craft layer) used to run only at the very end,
after every line was already written. It now runs at the first page write, where it can still
change the build. It only applies once the Palate MCP has actually answered, so a build with no
connection is never held to it.

**Explore explains itself.** A preview now ships `/explore`: the page that says what the set of
directions is, draws the ambition ladder from restrained to bold, and gives every direction its
own description, its argument and the feeling it carries. Hand over that URL rather than `/v1`.
Eight links with no framing get read as eight guesses.

**Calm no longer means motionless.** A calm brand governs the *character* of motion, slow and
unhurried and never performing, and not whether motion exists. The restraint clause is written
for the most restrained direction, so the boldest one keeps permission to commit whatever the
brand's temperature. A calm build shipping inert is now a choice that has to be argued.

**Builds stay in the session that has the doctrine.** Handing the creative stages to an
orchestrator produces pages written by agents that never loaded the design rules. Gathering work
still runs in parallel; design work does not.

**Smaller, and worth knowing:**

- Your repository no longer collects Palate's working files. A real build committed 387 of them,
  297 MB of screenshots and telemetry, into a client deliverable. Measured state you cannot
  recompute (baselines, the brand record, the photo review, the briefs) is still committed.
- A build's checks now find the project when the manifest sits above it in the tree. Where they
  did not, the whole suite skipped silently and read like a clean pass.
- Bands that leave a large one-sided gap are caught. A narrow centred column is good typography
  and stays silent; the same column pinned to one edge is an unfinished layout.
- On a machine with no shell, the gates now say they were skipped instead of reporting a
  failure they never ran. See "What it runs on" in `INSTALL.md`.

## 1.13.0 and earlier

Not documented here. This file starts at 1.14.0; before it, the release history lives in the
marketplace repository's commits.
