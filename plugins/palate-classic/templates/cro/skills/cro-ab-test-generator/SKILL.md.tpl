---
name: cro-ab-test-generator
description: >
  Creates A/B tests as Sanity heroVariant or campaignPage documents wired to Humblytics experiment tracking. Dormant until the traffic threshold. Trigger when the optimizer has an approved change to test.
allowed-tools: [Read, Write, Bash, WebFetch]
---
# CRO A/B Test Generator
Generates the variant document, registers the experiment with Humblytics, and
reports back the experiment id. Enforces single-active-experiment-per-page.
