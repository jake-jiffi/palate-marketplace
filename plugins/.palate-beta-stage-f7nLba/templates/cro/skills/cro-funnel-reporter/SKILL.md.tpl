---
name: cro-funnel-reporter
description: >
  Weekly conversion funnel and drop-off report for this site, from the Humblytics API. Dormant until the site logs the configured session threshold. Trigger on a schedule or when Jake asks how the site is converting.
allowed-tools: [Read, Bash, WebFetch]
---
# CRO Funnel Reporter
Reads .palate-cro-config.json. If activated is false or sessions < threshold, returns
"insufficient traffic, still warming up". Otherwise pulls the Humblytics funnel
endpoints, reports top drop-off points, and suggests where the optimizer should look.
