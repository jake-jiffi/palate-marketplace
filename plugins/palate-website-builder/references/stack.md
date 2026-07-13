# The stack (locked)

| Layer | Choice | Why |
|-------|--------|-----|
| Framework | Astro 6 | Islands, static-first, fast, great DX |
| Hosting | Vercel (default) OR Cloudflare Workers (`--host cloudflare`) | Vercel by default for the GitHub deploy loop + Toolbar Comments on previews; Cloudflare backup for cheapest/most-edge. Always confirmed at the plan checkpoint. See `references/hosting-vercel.md` |
| CMS | Sanity | Structured content, real-time Studio, generous free tier |
| Styling | Tailwind 4 | Consumes the brand preset directly |
| Animation | GSAP + Lenis + View Transitions (opt-in: R3F for 3D) | Industry-standard motion, smooth scroll; the recipe layer is `references/motion-and-3d.md` (Tier 0/1 default, Tier 2 R3F opt-in per build) |
| Forms | Worker + Resend + Turnstile + Sanity formSubmission | Email notify + durable record + spam protection |
| Analytics + A/B | Humblytics (default), Plausible (--analytics=plausible) | One script does analytics, heatmaps, funnels, A/B, revenue attribution |
| Newsletter | Kit | When enabled |
| Search | Pagefind | Static, no server, built at deploy |
| Repo + CI | GitHub + Actions (build) + Wrangler Action (deploy) | Build in CI, deploy artifact |
| Email | Resend | Transactional |
| Brand | GitHub Packages (default) or vendored | Versioned design system |

Do not substitute layers casually. The lock-in is what makes the skill repeatable.
