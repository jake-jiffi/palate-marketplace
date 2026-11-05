# Photography pipeline

## Two universes (if the brand has a narrative arc)
- **team**: real humans, proof-of-work. Subfolders: headshots, group, at-work, candid, detail.
- **editorial**: surreal or lifestyle stock, metaphor for the problem the brand solves. Subfolders by service where per-service imagery exists, plus generic.

## AVIF + JPG pairs
Every photograph ships as an AVIF master and a JPG fallback. AVIF for modern rendering, JPG for tools that cannot decode AVIF (including some vision tools). When the source is AVIF-only and you need to vision-review it, convert to a JPG preview first: `sips -s format jpeg -Z 1200 input.avif --out preview.jpg`, review the JPG, then keep both formats in the repo.

## Pairing rhythm (document this in brand/photography.md)
- Chaos / metaphor imagery first (open a page with the problem, not the people)
- Humans halfway down (introduce the team once the problem is established)
- Metaphor CTA to close
- Never open a page with a team photo

## Per-service metaphor index
If editorial imagery is organised by service, document what metaphor each image carries, so a downstream builder picks the right image for the right service page. Example index entry: "service: payroll-automation -> image: tangled-wires-resolving -> metaphor: chaos becoming order."

## The photography pass is separate
Photography is a second commit, after the main repo is built and pushed. Vision-review a representative sample, categorise, organise, write brand/photography.md, commit and push separately. This keeps the first commit shippable even before photography is sorted.
