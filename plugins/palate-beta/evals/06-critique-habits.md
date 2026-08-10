# Eval 06 - the six critique habits are visibly applied

### Brief (verbatim)

> Build a preview of a website for Tarn Architecture, a Hobart studio that
> does heritage restoration and contemporary additions. Strong, considered,
> not loud.

### Expected behaviour

A standard Explore-first preview build. The eval is whether the six
critique-discipline habits show up in the transcript and the artefacts.

### Checklist

- [ ] Every generated variant (v1..vN) has a stated **Design Read** in the
      build transcript or as a comment in the variant `.astro` file's
      frontmatter, in the exact form: "Reading this as: a {page kind} for
      {audience}, with a {vibe} language, leaning toward {design direction}."
      A generic Design Read ("a modern marketing site for users") fails.
- [ ] At Phase A.3 (Compose), the transcript shows a **6-axis pre-emit
      critique** scoring Philosophy / Hierarchy / Execution / Specificity /
      Restraint / Variety, 1 to 5 each. Any axis below 3 must have triggered
      a revision pass before emit. The Variety score must be anchored to a
      named, located signature move (e.g. "asymmetric hero split, section 1");
      a Variety score given without a named, located move is treated as below
      3 and must trigger a revision pass.
- [ ] At Compose, the transcript shows the **Conceptual Grounding Test**
      applied to every section, with one sentence per section completing
      "This exists because {a specific reason}." A section that cannot pass
      the test is removed.
- [ ] At Compose, the **anti-default detector** (habit 5) names and locates
      at least one reproduced signature move: the source ref it came from and
      the section it lands in (e.g. "{ref}'s offset baseline grid, applied to
      the gallery"). A default-shaped page that ships with no named, located
      signature move fails.
- [ ] At Compose, the **feel gate** (habit 6) is answered for the composed
      page: a stated one-line answer to "what does this page make you feel,
      and which specific choice produces that feeling." An unanswered or
      generic feel gate ("it feels professional") fails.
- [ ] In Claude's own narration of the build (the variant write-ups, the
      Compose summary, the handover note), **none of these words appear** as
      descriptors of the design: `clean`, `nice`, `modern`, `sleek`,
      `beautiful`, `stunning`, `minimal`, `bold`, `elegant`, `polished`,
      `striking`, and none of the house AI-tell terms: `leverage`, `seamless`,
      `game-changer`, `elevate`, `unlock`, `robust`, `effortless`. Where one
      appears in a client brief or brand voice doc it may be quoted; Claude's
      own assessment must use specific observations.
- [ ] `scripts/ux-lint.sh` passes on the final preview.

### Regression signals

A generic Design Read, a missing critique score, a Variety score with no
named, located move, a section that fails the grounding test still shipping,
a default-shaped page with no named signature move, an unanswered feel gate,
or any vague-word or AI-tell descriptor in Claude's own narration. Any of
these indicates the discipline has drifted to ceremony.
