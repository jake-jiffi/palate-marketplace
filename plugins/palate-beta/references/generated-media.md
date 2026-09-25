# Generated media (optional, Higgsfield)

Read this only when `media detect` reports `available: true` or Higgsfield MCP tools are present. Otherwise stop here, and never mention Higgsfield, generated media, installing anything or signing in. A site without generated media has the same ambition: composition, type, code-driven motion and the client's own material carry it. A critic never marks a site down for lacking generated media.

## Detect, then ask once

Run `node <package>/scripts/palate.mjs media detect` at the start of new live work (before `init` is fine; afterwards use the project's own `scripts/palate.mjs`). It is read-only and prints nothing to the person. A project created before media support rejects the `media` command; for that project use `node <package>/scripts/palate.mjs media ... --project <project>`. It reports whether the CLI is present and signed in, its credit balance, whether a Higgsfield MCP server is configured, whether ffmpeg is available for films, and any decision already recorded for this project.

If a decision is recorded, honour it and do not ask again. The person can change it at any time; record the new answer the same way.

Otherwise ask one `AskUserQuestion` before composing options, alongside the purpose question when there is one. Recommended option first:

| Option | Description to show |
| --- | --- |
| Yes, up to 300 credits (Recommended) | Generated stills for the design options, then motion or a short film for the chosen direction. State their balance and that you stop at the cap. |
| Yes, up to 800 credits | Room for a full scroll-through film of the chosen direction. |
| Images only, up to 100 credits | Generated stills, no video. |
| No, build without it | Nothing is generated. |

Each cap is also held to half the live balance, and the runtime applies that for you. When half the balance is below a tier, show the lower figure. When the CLI is present but signed out, the "Yes" descriptions say to run `! higgsfield auth login` first. Record the answer with `node scripts/palate.mjs media consent --input <file> --op <id>`, where the file holds `{"decision":"cap-300"}` (`cap-800`, `images-100` or `declined`). The reply's `cap` is the ceiling.

## What generated media may show

Generated media is illustrative, and must read that way: invented worlds, dioramas, scenes, textures, atmosphere, abstract motion, a stylised view of the product category.

- It never stands in for the client's real premises, staff, customers, products, projects, results or before-and-after, and is never captioned or composed as a photograph of them.
- No product imagery for anything the site sells. No invented people presented as customers or team.
- No text, letters, numbers or logos inside a generation. Set type in HTML.
- A client's own photograph may be animated with a camera move only. Inspect the frames and discard the clip if anything was added or changed.
- Use the brand's palette and the direction's art direction in prompts. Never a reference site's identity.
- Section copy over a film comes from the source profile. Do not invent claims to caption a scene.

## Spend only through the runtime

Every generation goes through `node scripts/palate.mjs media generate --input <file> --op <id>`:

```json
{"need":"still","args":["--prompt","...","--aspect_ratio","16:9"],"purpose":"Opening world for option a","direction":"a","dest":"src/directions/a/media/opening.png"}
```

Name the **need**, not the model. `scripts/live/media-models.json` lists, for each need, its candidate models best first and their model-specific flags. The runtime takes the first candidate that is in the live Higgsfield catalogue, whose schema accepts what the need requires, whose free price check accepts this exact job, and whose price fits the remaining cap. It records the choice and every skipped candidate with its reason. When a better model ships, the table changes and the doctrine does not.

| Need | Use |
| --- | --- |
| `still` | An illustrative scene, world, texture or atmosphere image, no text. |
| `still-matched` | A still that must match approved reference images (`--image-references`), so a set reads as one world. |
| `cutout` | An illustrative still with its background removed. |
| `film-leg` | A camera move continuing from a start frame: walkthrough legs and dives. |
| `film-connector` | A camera move locked to a start and an end frame: the seams between dives. |
| `film-draft` | A cheap previz of a leg or connector. |
| `motion-loop` | A short atmospheric move from a still. |
| `object-3d` | An illustrative 3D object (GLB) for a WebGL moment, never a replica of the client's product. |

With a need, `args` carry only the job's own flags: `--prompt`, `--start-image`, `--end-image`, `--image`, `--image-references`, `--duration`, `--aspect_ratio`. Every later leg and connector of a film passes `"chain": "<op of the film's first leg>"`, which pins it to that leg's model: a change of model shows as a pop at the seam. When the person asks for a specific model, pass `"model"`, `"kind"` and `"reason"` (their words) instead of a need; the reason is kept beside the spend.

The runtime chooses the model, checks the agreed cap and the live balance, reserves the estimate, submits the job and records its id, waits for it, saves the file (it never overwrites one) and records the charge in `.palate/media/budget.json`. Quoted prices matched the charges exactly in testing. Keep input files under `.palate/media/work/`; `args` use `higgsfield generate create` flag syntax without `--wait` or `--json`, and local media inputs must be inside the project. Do not call `higgsfield generate create` directly: in Claude Code the guard refuses it, and anywhere else it bypasses the cap.

Images take about a minute and video three to ten. Run video with `run_in_background` and keep composing. `node scripts/palate.mjs media status` shows the cap, spend and every entry.

`MEDIA_PENDING` means the job was submitted and is still being charged, but its result was not confirmed (Higgsfield's status endpoint returns transient 503s under load). Re-run the same command with the same `--op` later: it collects the finished job without paying again. Never resubmit it under a new `--op`.

A refusal is an answer, not an obstacle. On `MEDIA_BUDGET`, `MEDIA_STAGE`, `MEDIA_DECLINED`, `MEDIA_NO_CONSENT` or `MEDIA_UNAVAILABLE`, continue without that media. On a budget refusal that matters to the design, ask once with `AskUserQuestion` whether to raise the cap to the next tier (keeping the cap first). A failed job keeps its estimate counted, because it may have been charged.

With the Higgsfield MCP instead of the CLI: price each job with the server's own cost or pricing tool when it has one, and after each generation record it with `media record --input <file> --op <id>` (`{"model":"...","kind":"image","credits":6.5,"purpose":"...","file":"src/..."}`). The guard refuses spending MCP tools without consent or once the cap is spent. MCP spend is only as accurate as what you record, so record every job.

`node scripts/palate.mjs media quote --input <file>` takes the same input as `generate` and returns the model the need routes to and its price, free and without spending. Quote one representative leg and one connector to price a film plan. Real prices on 2026-09-25 for scale: a 2k still 2 to 6.5 credits, an 8-second 1080p leg 72 to 96, a 5-second connector 45 to 60.

## During design options: stills only

Each option may use up to two generated stills, saved under its own `src/directions/<id>/` (the runtime refuses more, and refuses video, until a direction is chosen). Start them in the background once the direction's idea is clear, and compose so the option already works and looks finished without them. Swap them in when they land and reinspect the option. Never hold the first option back for a generation.

Give each direction one style preamble, reused word for word in every prompt, so its stills read as one world. Inspect every still before using it: reject text artefacts, warped anatomy, off-palette colour and anything that reads as a real business's premises or products.

## After selection: motion and scroll films

How much of the page scrolls through film is a design decision for this site, not a default. Decide it from what visitors come to do and from references that use scroll-driven film well (search the library's motion facets and inspect their clips), then choose one scope:

| Scope | Suits | Shape |
| --- | --- | --- |
| Hero film | Most sites: the world makes a strong opening, but visitors come to scan services, prices or hours, or to enquire | One scene, or two joined by a connector, pinned for one to two viewport heights, then the page scrolls normally. The primary action is visible in the opening and again when the film releases. |
| Chapter film | A site where one part of the story is a journey (how it is made, the process, the place) and the rest is ordinary content | Two to four scenes mounted on that section alone, with ordinary sections before and after. |
| Full-page journey | A site that is the journey: a launch, a campaign, an experiential brand, a product story that fits four to seven beats | The whole narrative, with navigation and the primary action reachable throughout, never only at the end. |
| No film | A direction whose idea is not movement | A short motion loop, or the stills. |

Scope sets the cost, so it goes in the priced plan below. Never trap content or the primary action behind the film: every scope keeps navigation, the key facts and the action reachable without scrolling the whole film.

Before rendering, price the plan with `media quote` and confirm it with one `AskUserQuestion` carrying totals that fit the remaining cap, with your recommended scope first and its reason: for example "Hero film, one dive, about 96 credits (Recommended)", "Chapter film on the process section, 3 scenes, about 400", "Full-page journey, 5 scenes, about 700", "Stills with light motion, about 40". Include whether to render a native phone cut, which roughly doubles the video cost.

The method below is adapted from [scroll-world](https://github.com/oso95/scroll-world) (MIT).

1. **Stills.** One per scene, sharing the style preamble: the brand's palette as hexes, "no text, no letters, no numbers, no logos", the focal subject centred with headroom, and the same 16:9 frame as the clips. Review them together as one world and re-roll any that drift (an approved still can be passed as a reference image).
2. **Camera.** Pick one architecture. Legs and dives use the `film-leg` need and connectors `film-connector`; every job after the first passes `chain` so the whole film renders on one model. The start image is not guaranteed to be frame 0 of the render, so posters and connector endpoints always come from the rendered clips.
   - **Walkthrough** (grounded or photoreal worlds): legs rendered in order. Leg 0 starts from scene 0's still; each later leg starts from the previous leg's actual last frame, with no end image. Every prompt keeps the handoff clauses verbatim: "Continue the same slow, steady forward glide" at the start and "In the final second, settle back into a slow, steady forward glide toward [the next scene]" at the end. Any orbit, crane or push-in happens mid-leg, never across a seam.
   - **Fly-through** (miniature or diorama worlds only): one dive per scene from its still, then a connector per seam whose start image is dive *i*'s last frame and end image is dive *i+1*'s first frame, both extracted from the renders, never the stills. The camera reverses at each seam, which reads as charming in miniature and as a stutter in anything realistic. Describe the space between scenes exactly as the stills show it: floating islands cross open space on the stills' background, and only a world drawn as connected ground crosses ground. A connector asked to cross "the connected world" between floating islands invented a landscape and missed its end frame badly in testing.
   - **Locked isometric**: the walkthrough plus this clause in every leg: "The camera keeps exactly the same high isometric angle throughout, with no rotation, orbit or tilt. It only travels straight and level, the world sliding past beneath the same view."
   - Draft the whole chain with the `film-draft` need first when the journey is uncertain, then render the final legs.
3. **Frames.** Keep work files in `.palate/media/work/` and raw renders in `.palate/media/raw/`, which never ship. Last frame: `ffmpeg -sseof -0.15 -i leg.mp4 -frames:v 1 -q:v 2 last.png`. First frame: `ffmpeg -ss 0 -i next.mp4 -frames:v 1 -q:v 2 first.png`. Look at each last frame before chaining the next leg; a bad handoff frame spoils every leg after it.
4. **Encode** into the selected direction: `ffmpeg -i raw.mp4 -an -vf "unsharp=5:5:0.8:5:5:0.0" -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -g 8 -keyint_min 8 -sc_threshold 0 -movflags +faststart out.mp4`. Phone encodes add `scale=720:-2`, `-g 4` and `-crf 23`. Use each clip's first frame as its poster (WebP, or JPEG `-q:v 3` where ffmpeg has no libwebp). Measured: 8-second 1080p dives encode to 7 to 13 MB, phone encodes to 1.6 to 2.8 MB, so give the first scene the least detailed world or a higher `-crf`. A native 9:16 chain is rendered only when the person chose it; otherwise phones get the 720-wide encode of the landscape film.
5. **Page.** Copy `<package>/references/scroll-film/scroll-film.js` into the selected direction, keeping its header. It is the mechanism only. Mount it on a section whose static markup already shows every scene's still and copy, which is what visitors see without JavaScript and before it mounts. Compose the copy, navigation and actions as the direction's own design, driven by `onFrame`, `data-film-scene` and `--film-progress`. Do not bring in scroll-world's page chrome. Pace with each scene's `scroll` (dwell) and `linger` (0.6 at most). Under reduced motion the engine loads no clips and the stills dissolve.
6. **Check** every seam before encoding, then in the browser. Compare each clip's last frame with the next clip's first:

   ```bash
   ffmpeg -sseof -0.05 -i a.mp4 -frames:v 1 end.png; ffmpeg -ss 0 -i b.mp4 -frames:v 1 start.png
   ffmpeg -i end.png -i start.png -lavfi psnr -f null - 2>&1 | grep -o 'average:[0-9.]*'
   ```

   Good seams measured about 17 dB (detail shimmer); a visibly wrong seam measured about 11. Treat anything well below the film's other seams as suspect, look at the two frames, and re-roll that connector if the composition differs. Then in the browser at desktop and phone sizes: screenshots just before and after every seam; `video.seekable.end(0) > 0`; `currentTime` follows the scroll; a fast scroll on a 4x throttled phone does not freeze; the first scene is never blank on iOS; reduced motion shows stills; the page reads without JavaScript. Keep the desktop film under about 40 MB, with the first clip small.

## When generation fails

- Content-filter false positives are common on interiors, pools, spas and words like "bed" or "wine". Reword with "empty, unoccupied, architectural, no people", retry at most twice, then render that one clip as a named model with the reason "content filter on <model>" and no `chain` (a different provider's filter often passes it), or leave that connector out (`null` crossfades the seam).
- `MEDIA_PENDING` or an interrupted run: re-run the same `--op` to collect the job. Only a job Higgsfield refused outright (`MEDIA_FAILED`, "did not accept") is retried under a new `--op`.
- Out of credits or cap: stop generating and keep the stills version.

The site always ships whole without the film. At handover, say what was generated, what it cost (`media status`), that it is illustrative, and where the raw files are kept.
