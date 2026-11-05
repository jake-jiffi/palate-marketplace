# Team access

## GitHub
The palate-engineering team gets push access to every site repo (provision-github.sh grants it). Branch protection on main requires 1 review + passing checks, so even with push access changes go through PR.

## Sanity
Editors are invited during Phase B. Default editor is hello@{domain}; override with --editors (comma-separated). Editors get the editor role (content edit, no project admin).

## Cloudflare
The operator's account owns the worker. The client gets no Cloudflare access by default; they interact via the site and Sanity Studio only.

## The principle
The client owns their domain and their content (Sanity). The operator owns the infrastructure and the code. This keeps the client in control of what's theirs while the operator manages delivery.
