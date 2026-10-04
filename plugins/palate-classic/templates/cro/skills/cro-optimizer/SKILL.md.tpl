---
name: cro-optimizer
description: >
  Proposes and, on approval, ships conversion-rate improvements (copy, layout, CTA) as Sanity heroVariant/page edits. Dormant until the traffic threshold. Trigger after a funnel report flags a drop-off.
allowed-tools: [Read, Write, Edit, Bash, WebFetch]
---
# CRO Optimizer
Refuses to act below the traffic threshold. Above it, proposes a specific change
tied to a funnel drop-off, surfaces it for approval, then ships it as a tracked
A/B test via cro-ab-test-generator. Never runs two experiments on one page at once.
