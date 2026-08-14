---
description: Change existing copy in plain language. Finds the right file, edits it, checks only what moved.
argument-hint: "[what to change, e.g. \"the homepage hero should lead with the 20-year guarantee\"]"
---

Change words that are already on the site. Say what you want in plain language and this finds
where that copy actually lives, edits it there, and checks only the routes that moved.

The reason this is a command and not "open the file" is that copy is rarely where people think
it is. A phrase on the homepage might live in `src/lib/content.ts`, in a component, in a post,
or in `src/lib/business.ts`, and editing the wrong one leaves two versions of the same sentence.

`$ARGUMENTS` is the request. If it is empty, ask what to change and stop.

## 1. Find where the copy lives

1. Resolve the project dir. Build the index:
   `node "${CLAUDE_PLUGIN_ROOT}/scripts/palate-index.mjs" <dir>`.
2. Grep for a distinctive phrase from the current copy across `src/`. Then decide which store it
   belongs to, because this determines everything downstream:

   | Where it is | What it means | What you do |
   |---|---|---|
   | `src/lib/content.ts` | page copy, hand-shaped, singleton | edit the typed export; pages read it through `loadPage()` |
   | `src/content/**` | a stream entry | edit the markdown, mind the frontmatter schema |
   | `src/lib/business.ts` | a business FACT | **stop, use `/palate-website-builder:fact`**, it propagates to every surface |
   | inside a `.astro` component | copy hardcoded into markup | edit in place, and say so: hardcoded copy is a smell, not a crime |

3. If the phrase appears in more than one place, that is the finding. Report both locations
   before editing, because changing one of them is how a site ends up contradicting itself.
4. If you cannot find it, say what you searched for rather than editing the nearest thing that
   looks similar.

## 2. Make the edit

Match the surrounding voice. Read `.palate/brain/voice.md` and `.palate/brain/constraints.md` if
they exist; otherwise take the register from the copy immediately around the edit.

Keep the change surgical. Do not rewrite the paragraph you were asked to fix a word in, do not
reflow markup, do not tidy adjacent code. A copy edit that shows up as a structural diff is a
copy edit nobody can review.

Length constraints are real and enforced: a `description` in post frontmatter caps at 160
characters, a `title` at 70. If the new copy busts a bound, say so and offer a shorter version
rather than silently truncating.

## 3. Plan the check

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/palate-contract.mjs" <dir> --changed <files> --json
```

If it says `content`, run the content lanes. If your edit landed inside a `.astro` file it will
say `structural` and the full set runs, including tokens and geometry. That is correct and not
a bug: you changed a file that renders on every page that imports it, and the lane set follows
the risk, not the intent.

Watch the route count. A word changed in a shared component is a site-wide change. The contract
says so up front so nobody waits five minutes wondering.

## 4. Run the lanes

- `npx astro check` then `npm run build`.
- `"${CLAUDE_PLUGIN_ROOT}/scripts/ux-lint.sh" <dir>` for the AI tells and the house rules.
- Serve and verify the planned routes:
  ```
  "${CLAUDE_PLUGIN_ROOT}/scripts/serve-preview.sh" <dir>
  bash "${CLAUDE_PLUGIN_ROOT}/scripts/verify-rendered.sh" \
    <SERVE_URL> --routes <planned routes> --out .palate-shots
  ```
  Longer copy is the commonest way an edit breaks a layout: a heading that wrapped to two lines
  now wraps to three, a button label overflows at 390. The verifier catches overflow and
  contrast; a still catches the ugly. Take both if the copy grew by much.
- Drift is advisory and only runs where the route already has a baseline embedding.

No MCP call is needed for this command. If the taste layer is unreachable it changes nothing
here, so do not mention it.

## 5. Heal, then show

Fix what is fixable and re-run before showing anything. Two flat iterations is a stall; report
it rather than waving it through.

Show a real before and after: the old text, the new text, the file, the routes affected, and the
lane results. If the copy appeared in two places, show both and which one you changed.

Apply on agree. If they want it different, take the note and re-run from step 3.
