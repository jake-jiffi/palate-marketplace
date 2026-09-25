# Independent website critique

Improve the visitor's experience while preserving the project's identity. Act as an experienced website juror, using named Palate references and direct browser observations. Scores are internal simulated jury judgements, not Awwwards accreditation or a certified Palate grade.

This protocol does not invoke `/palate-beta:grade`, `grade-local.mjs`, pairwise judge swarms or the legacy `palate-verifier` gate list. A separately requested grading instrument remains a separate task. Do not commission both workflows merely because this critique includes scores.

## Choose the scope

| Entry | Work and stopping point |
| --- | --- |
| Selected-direction pass | After the user chooses a viewable direction, before spreading its design across the site. Start with a focused critic/builder correction and independent recheck when needed; deepen the effort when the craft warrants it. Share initial options before this pass. Future routes and integrations are deferred, not failures of the slice. |
| Final-site pass | Before handing over the completed site. Use a **fresh critic** to review the whole agreed scope. Repair critical defects and regressions, and escalate unresolved design, creativity or motion gaps while useful work and shared rounds remain. Independently recheck each revision. |
| Jury mode | The coordinator activates deeper critique when needed during the selected build or final review; the user can also request it through `jury`. Review the current result, then brief substantive revisions using the **remaining shared rounds**, each followed by independent review. Use a fresh critic for the final review. |

## Scale the effort when the craft needs it

**The coordinator owns escalation. Do not wait for a manual jury request, a ladder result or a rating event.** Once the selected preview is viewable, direct browser inspection or independent critique can establish that its composition, originality or motion falls short. When material, achievable craft gaps remain, activate jury mode and continue the critic/builder loop within the authorised scope. Do not merely list those gaps at handover while useful revisions and shared rounds remain. A lightweight correction is a starting point, not a prerequisite or a hard ceiling. This capability is available during the selected-site build and final review as new gaps emerge.

Design below 9, Creativity or Motion below 8, or a relevant existing comparison such as "somewhat worse" are useful signals, not required triggers. Use the actual evidence, not just the number. Brief a stronger composition, better use of imagery and typography, a product-specific interaction or more coherent motion when that addresses the gap. Do not substitute arbitrary spacing tweaks for a missing creative idea. Preserve successful work, the selected identity and accurate product content; escalating effort does not mean starting the site again. Briefly state the observed gap and stronger next move, then proceed without routine approval pauses.

Missing ratings do not block escalation when browser evidence supports it. Missing browser evidence, credentials or an external service are different: report the unverified behaviour or dependency and resolve only what is within scope, without speculative redesign. A broken interaction needs a targeted repair and cannot pass because its visual score is high. Never invoke the old grading instrument just to decide whether to escalate.

## Share one revision allowance

There are **at most four total builder revision rounds** for the same selected direction and agreed site scope (or the agreed existing-site scope when there is no selection marker). Lightweight corrections, escalated jury revisions and final repairs **all consume the same allowance**. Ordinary route construction is not a critique revision. Three rounds consumed means at most one remains, including any final repair.

Stop early when the target is verified, an external blocker prevents meaningful scoped progress, or **two consecutive rounds show no evidence-backed improvement**. An initial critique can meet the target without a builder round. No mode requires changes merely to use its allowance. Reaching the limit below target means **target not met**, not permission to inflate scores or add rounds. Critical defects prevent a pass; report surviving issues honestly when the allowance or useful progress is exhausted.

Respect review-only requests and explicit limits on testing or changes. Small edits do not automatically invoke these passes. Keep the current stack and integrations; a jury request never initialises, migrates or deploys a project. An unavailable external service is a named blocker, not authority to provision a replacement.

## Coordinate real agents

The main host agent is the **coordinator** and owns completion. It creates the independent critic and a distinct builder using the host's actual agent tools. Keep one worker active at a time for the same site. Do not require subagents to spawn nested agents.

1. **Review and brief.** Spawn `palate-critic` in Claude when available. In Codex, or without a registered agent, spawn a general agent with [the critic definition](../agents/palate-critic.md) and this protocol. Supply the absolute package and project locations, preview URL and access method, run commands, review scope, current brief, selected direction, reference evidence and prior reports. The critic inspects and returns its verdict and implementation brief; it does not edit site source.
2. **Implement.** If a correction is warranted and within the round allowance, actually spawn a separate builder with the self-contained brief below. The coordinator and critic do not concurrently edit the site. Give the builder freedom to solve the observed problem within the constraints. Do not end the task after delegation.
3. **Handover.** Wait for completion or a specific blocker. Require changed files and behaviour, checks performed with results, unresolved issues, source identity and a working preview URL with restart instructions. A successful build command alone is not acceptance.
4. **Recheck.** Return the revision and handover to the critic. It independently uses the website, verifies each acceptance criterion and checks affected workflows for regressions. Mark findings resolved, unresolved or regressed and update the scores. Reuse the critic between ordinary rounds; the final-site pass and final jury review use a fresh critic given the same evidence and requirements. If an initial jury review already meets the target, that independent review can be final.

If agent tools are unavailable, report that independence was unavailable. A transparent self-review can still help, but do not invent agents or claim an independent pass. If browser access is unavailable, return a provisional critique with unverified behaviour rather than building a new browser harness or claiming tests passed. Continue only work that the available evidence and user's scope support.

## Establish and keep the benchmark

Read the conversation and source profile first. Distinguish confirmed requirements, reasonable assumptions, proposed identity and unknowns. A website, supplied brand material, an idea or no prepared assets are all valid inputs. Preserve the user's selected direction, identity, genuine imagery, factual claims, important URLs and core journeys. Use commerce requirements only where the product needs them. Never trade product accuracy or usability for resemblance to a reference.

Reuse the actual Palate MCP results and captures from exploration. Identify which named reference supports each comparison and why it fits the audience or technique. In jury mode, study **at least three relevant outstanding references**, including available mobile views and relevant inner pages. Normal passes reuse sufficient inspected evidence without another donor quota. Keep the reference set stable across rounds; explain any necessary replacement and mark affected comparisons as not comparable.

Follow [live-build.md's reference inspection guidance](live-build.md#use-references-where-they-change-the-design). Inspect screenshots and detailed analyses, and actual clips or interactions for motion claims. A still image cannot prove a reference's movement. Missing MCP authentication or quota permits one useful correction attempt, then suitable cached evidence or an explicit ungrounded limitation. Do not manufacture reference names, observations or benchmark coverage.

## Inspect and score

Judge art direction, originality, typography, composition, imagery, motion, content and the complete visitor experience within the stated scope. Explain a shortfall through the actual page or state and a named reference, not a generic instruction to make it premium. Judge the outcome even when it contradicts your previous recommendation. Supplied brand choices and purposeful labels are not defects simply because they are common. A site without generated media is not missing anything. Judge generated media like any imagery, and as a critical defect when it passes for the client's real premises, people, products or results.

Use the website directly. Capture relevant pages and states at desktop and phone sizes. Exercise core journeys, validation, loading, empty, success, error and recovery states, plus offline, permission and saved-data-after-refresh behaviour **where applicable**. Check navigation, keyboard access, focus, contrast and responsive behaviour. Use test accounts and local/test destinations; never send a real customer enquiry, make a purchase or expose credentials in reports. Respect existing permissions and deployment boundaries.

**Normal motion is the primary experience.** Record input or scroll positions and the visible changes between them, including the resting result. Test touch and keyboard alternatives, then reduced-motion and no-JavaScript behaviour separately. An already-open door, final transform or drawn line does not prove that motion happened. Screenshots do not establish frame rate or smoothness without the corresponding observation. Preserve useful information, readable text and focus throughout.

| Category | Weight in overall |
| --- | --- |
| Design | 40% |
| Usability | 30% |
| Creativity | 20% |
| Content | 10% |

Score each out of 10. Calculate `overall = 0.40 * Design + 0.30 * Usability + 0.20 * Creativity + 0.10 * Content`. Separately score **Functionality, Completeness, Accessibility and Motion** out of 10; do not blend these into the weighted score. The internal target is **at least 8 in every category and overall, with Design at least 9**.

Use `unverified`, not an invented number, for insufficiently observed categories. If a weighted category is unverified, withhold the overall. Mark a separate check not applicable only with a concrete scope reason; it cannot hide a required journey. A **critical defect or broken or unverified core workflow prevents a pass**, regardless of the arithmetic. A design-slice result never certifies the full site. At full-site review, missing required delivery, persistence or checkout remains a blocker. State the target as met, not met or unverified, with evidence and the testing limits.

## Brief, evidence and continuation

The builder brief must stand alone: project location, preview access and commands; affected pages/components; ranked observed problems; desired outcomes; named reference evidence; elements to preserve; objective acceptance criteria and the allowed test scope. Prioritise critical blockers, then important gaps, then optional improvements. Prescribe outcomes rather than every CSS decision. Do not add new functionality to improve a score.

Keep concise review and handover evidence under `.palate/critique/`, separate from public assets. Include mode/stage, round, selected decision ID when present, source/build identity, stable reference set, capture paths and viewport/time, scores and calculation, finding dispositions, acceptance criteria, limits, the evidence justifying escalation and the shared rounds consumed and remaining. These are observations, not a second task tracker; use the project's existing issue tracker for follow-up work.

For live projects, read `node scripts/palate.mjs status`: identity comes from `state.selection.decisionId` and `validity.sourceFingerprint` / `validity.buildFingerprint`. Never hand-edit `palate.project.json`. Refresh the selected direction through the existing `option` workflow after shared changes; keep the user's choice. Critique evidence is not runtime verification or a deployment receipt. For other projects, record the source revision and hashes of relevant dirty files without forcing adoption.

On resume, read the last report and source identity. Reuse completed observations when the scope and source still match; independently inspect affected changes when they differ. **Before delegating each builder**, persist the consumed round count, including interrupted builder attempts. Escalation, a stage change, a command or a session restart does not reset the allowance. Only a genuinely new user-authorised direction or scope can start a recorded new cycle; the coordinator cannot relabel work to evade the limit. Reuse existing reference captures and browser tooling. Do not commission a full rebuild, grading campaign or new test infrastructure for this review.

Finish with the verdict, working preview link, score progression, comparative screenshots, resolved and remaining issues, observed functional evidence and unverified scope. State explicitly whether the internal target was met. Be fair about improvements and exact about failures; effort spent is not a scoring criterion.
