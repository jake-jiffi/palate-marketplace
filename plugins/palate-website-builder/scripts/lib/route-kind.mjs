/**
 * scripts/lib/route-kind.mjs - what KIND of page a route is, and what to call its artefacts.
 *
 * Two one-line functions with a reason to exist: the Compose record and the gate that reads it
 * have to agree about them, and a second copy of either would be a defect nobody could see.
 * `palate-pick.mjs` records a look against `page_type`; `gate-look.mjs` discovers the page types
 * a build actually shipped from `dist/client/**\/index.html` and asks whether each one was ever
 * looked at. If the two classified `/client-reviews` differently, a build with a look on every
 * page would be refused for a type it had covered, or pass with one it had not.
 *
 * THE CLASSIFICATION IS DELIBERATELY COARSE. It is not a router and it is not SEO metadata: it
 * is the answer to "how many DIFFERENT kinds of page does somebody have to open before they can
 * say they looked at this site". A site with nine services has one service page type, because
 * the ninth teaches nothing the first did not; a contact page is its own kind because it is the
 * only page carrying a form. So anything the list does not name is a service page, which errs
 * toward asking for one more look rather than fewer.
 */

/** The path with its slashes normalised: a leading one, no trailing one, `/` left alone. */
export function normaliseRoute(route) {
  let r = String(route ?? "").trim();
  if (!r) return "/";
  // A query or a hash is a view of a page, not another page.
  r = r.split("#")[0].split("?")[0];
  if (!r.startsWith("/")) r = `/${r}`;
  while (r.length > 1 && r.endsWith("/")) r = r.slice(0, -1);
  return r || "/";
}

/**
 * The kind of page a route is. Prefix matching, because `/contact-us`, `/contact/` and
 * `/contact/thanks` are all the contact page as far as "has anybody looked at one" goes.
 */
export function pageTypeOf(route) {
  const r = normaliseRoute(route).toLowerCase();
  if (r === "/") return "home";
  const starts = (p) => r === p || r.startsWith(`${p}-`) || r.startsWith(`${p}/`);
  if (starts("/contact")) return "contact";
  if (starts("/about")) return "about";
  if (starts("/client-reviews") || starts("/reviews") || starts("/testimonials")) return "reviews";
  if (starts("/lp") || starts("/landing")) return "landing";
  return "service";
}

/**
 * The filename-safe name of a route. `/` is `home` rather than an empty string, because a
 * directory named "" is a directory named after nothing.
 *
 * NESTED ROUTES KEEP A FORM OF THEIR OWN. Joining the segments with a single hyphen gave
 * `/a/b` and `/a-b` the same slug, and the slug names the directory the judge writes its
 * stills into (`.palate-shots/compose/<slug>/`), so two judged routes would have shared one
 * directory and the second page's shots would have overwritten the first's between the write
 * and the fingerprint. Joining with a doubled hyphen keeps them apart. Two routes that still
 * collided (`/a/b` and `/a--b`) could only ever be the SAME page type, since the type is decided
 * by the first segment, and the judge takes one route per type, so the collision cannot reach it.
 */
export function routeSlug(route) {
  const r = normaliseRoute(route);
  if (r === "/") return "home";
  return r.replace(/^\/+|\/+$/g, "").split("/").join("--");
}
