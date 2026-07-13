# CRO + Ads autopilot for {{CLIENT_NAME}}

This site has the Palate CRO module installed. Four sub-skills live in .claude/skills.
They are DORMANT until Humblytics reports >= {{THRESHOLD}} sessions (see .palate-cro-config.json).

## The sub-skills
- cro-funnel-reporter: weekly funnel + drop-off report from Humblytics
- cro-optimizer: proposes and (on approval) ships conversion improvements
- cro-ab-test-generator: creates heroVariant / campaignPage A/B tests
- cro-ad-expert: reads Google + Meta ad spend, ties spend to Humblytics conversions

## Activation
Once the traffic threshold is met, set activated:true in .palate-cro-config.json.
Until then the reporters return "insufficient traffic" and the optimizers refuse to launch.

## Guardrails
- Never launch an experiment while another is active on the same page.
- Never change spend without surfacing the proposed change first.
- All experiments tie to a heroVariant or campaignPage in Sanity.
