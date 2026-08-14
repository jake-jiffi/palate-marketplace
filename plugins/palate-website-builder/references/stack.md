# The stack (locked)

| Layer | Choice | Why |
|-------|--------|-----|
| Framework | Astro 7 | Islands, static-first, fast, great DX |
| Hosting | Vercel (default) OR Cloudflare Workers (`--host cloudflare`) | Vercel by default for the GitHub deploy loop + Toolbar Comments on previews; Cloudflare backup for cheapest/most-edge. Always confirmed at the plan checkpoint. See `references/hosting-vercel.md` |
| CMS | **None by default**; Sanity when one is needed (`scripts/add-sanity.sh`) | Most sites do not need a CMS, and the Sanity tree is ~850 packages. Content is authored in `src/lib/content.ts` and read through `loadPage()`, which is the seam a CMS plugs into later with no page edited and no rebuild. Add one when the client will edit their own copy, or content is collection-shaped (blog, case studies, menu, listings). Sanity remains the ONLY supported choice: structured content, real-time Studio, $0 at this scale |
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
