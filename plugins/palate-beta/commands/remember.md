---
description: Record a decision, a voice note or a constraint in .palate/brain so a later agent does not undo it.
argument-hint: "<what was decided, and why>"
---

The real drift risk on a long-running site is not a bad edit. It is an agent six months from now
cheerfully rebuilding something that was deliberately removed, because nothing on disk says it
was deliberate. A deleted testimonials section looks exactly like a missing testimonials section.

This writes the reasoning down where the next agent will actually find it.

**Paths.** `$SITE` is the project directory. Everything lives in `$SITE/.palate/brain/`, which
is committed (the template's `.gitignore` already keeps it).

## 1. Work out which of the three it is

| | goes in | shape |
|---|---|---|
| **decision** | `decisions.md` | something was chosen or rejected, and a later agent could plausibly reverse it |
| **voice** | `voice.md` | how this business writes: words it uses, words it will not, register |
| **constraint** | `constraints.md` | a hard rule the site must keep, from law, contract, brand or the owner |

If it is ambiguous, ask which one in a single question. Do not file it twice.

## 2. Read before you write

```bash
ls "$SITE/.palate/brain/" 2>/dev/null && cat "$SITE/.palate/brain/decisions.md" 2>/dev/null
```

If this contradicts something already recorded, do not silently overwrite it. Append the new
entry, reference the old one by date, and say what changed. A reversed decision is more useful
than a tidy file: it is the only record that the first answer was tried.

## 3. Append

**`decisions.md` is append-only.** Never edit or delete an entry, never reorder, never
"tidy up". Newest at the bottom.

```markdown
## 2026-08-10, No testimonials section

**Decided:** the home page carries no testimonials block, and none is to be added.

**Why:** the owner has four reviews, all from 2023, and two name a staff member who has left.
Four stale quotes read worse than none, and the case studies already carry the proof.

**Reverses:** nothing.

**What would change this:** twelve or more reviews inside the last year, or one named client
willing to be quoted on record.
```

Four fields, all of them load-bearing:

- **Decided** in one sentence, in the imperative, so it can be checked against the site.
- **Why**, with the specific fact behind it. "It looked bad" is not a reason a later agent can
  weigh. "Four reviews, all 2023, two name a departed staff member" is.
- **Reverses**, naming the earlier entry by date when it overturns one.
- **What would change this**, which is what makes the entry a decision rather than a veto. An
  entry with no exit condition will eventually be ignored, because it reads as arbitrary.

`voice.md` and `constraints.md` take the same date heading, plus an example. For voice, record
the words as words:

```markdown
## 2026-08-10, Voice

Says "we": the owner is on every job and the site should not pretend to be a corporation.
Never "solutions", "bespoke", "passionate", "journey".
Prices are always "from $X", never "starting at just $X".
```

## 4. Confirm what you wrote

Print the entry back and name the file. One line, no ceremony:

```
Recorded in .palate/brain/decisions.md, "No testimonials section" (2026-08-10)
```

Then commit it if the person is committing. This file has to be in the repo to do its job; a
decision recorded only in a chat log protects nothing.

## 5. What actually reads this back

Named, because "the next agent will find it" is a promise and a promise needs an address. These
are the commands that open `.palate/brain/`, and if a file is not on this list it is not being
consulted:

| | reads | when |
|---|---|---|
| `:check` | `decisions.md`, `constraints.md` | every contribution, as a `review` lane |
| `:page` | `decisions.md`, `constraints.md` | before composing anything new |
| `:edit`, `:post`, `:campaign` | `voice.md`, `constraints.md` | before writing copy |
| `:ask`, `:why` | all of it | when answering why the site is the way it is |
| `:report` | `decisions.md` | the monthly decisions section |

When a contribution contradicts an entry, `:check` returns a `review` named against the entry's
date, not a silent override. The person's only decision is whether to overrule the earlier one,
and if they do, that is a new dated entry saying so.

The list is short on purpose and it is the honest one. `:publish` does not read the brain; it
consumes `:check`'s verdict, which already carries the finding.
