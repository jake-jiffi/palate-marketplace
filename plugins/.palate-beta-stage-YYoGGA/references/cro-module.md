# The CRO + Ads module

Optional (--with-cro). Adds per-ad landing pages and autonomous conversion optimisation.

## What installs
- Sanity types already present: heroVariant, campaignPage (per-ad landing pages tied to keyword groups)
- DynamicHero: swaps hero copy by ?variant= or utm_campaign
- Four sub-skills in .claude/skills: cro-funnel-reporter, cro-optimizer, cro-ab-test-generator, cro-ad-expert
- AGENTS.md describing them
- .palate-cro-config.json with the traffic threshold

## The warm-up (important)
The sub-skills install but stay DORMANT until Humblytics reports >= the threshold (default 500 sessions). Below threshold:
- funnel-reporter and ad-expert return "insufficient traffic"
- optimizer and ab-test-generator refuse to launch experiments (no statistical power)

handover.md states the warm-up plainly: "CRO autopilot installed but dormant until ~500 sessions, est. 2-3 weeks. Activates automatically."

## Why dormant-first
Running experiments on near-zero traffic produces noise and false positives. The threshold ensures the autopilot only acts when the data can support a decision.

## Activation
Once traffic crosses the threshold, set activated:true in the config. The sub-skills then run on their cadence (weekly reports, experiment proposals on approval).

## Why the sub-skills ship as SKILL.md.tpl
The four CRO sub-skill definitions live in templates/cro/skills/ as `SKILL.md.tpl`, not `SKILL.md`. This is deliberate: the Claude skill uploader requires a skill zip to contain exactly one `SKILL.md`. If the templates used the literal name, the website-builder zip would contain five and be rejected. `install-cro.sh` renames each `SKILL.md.tpl` back to `SKILL.md` when it installs the module into a real project, so the installed sub-skills are recognised normally.
