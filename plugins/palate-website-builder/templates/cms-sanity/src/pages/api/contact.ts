import { business } from "../../lib/business";
// Contact form handler. Dual destination:
//   1. Email via Resend (notification to the team)
//   2. Write to the Sanity formSubmission collection (durable record)
// Uses the EDITOR token (SANITY_API_WRITE_TOKEN), never the frontend read token.
// Turnstile-verified before either action.
import type { APIRoute } from "astro";
import { createClient } from "@sanity/client";

export const prerender = false;

/**
 * THE SMOKE REQUEST.
 *
 * A post-deploy check that never posts the form is not a check, and a post-deploy check that
 * DOES post the form drops a fake enquiry in the client's inbox every deploy, and on this copy a fake document
 * in their CMS as well. So one header
 * separates the two: `x-palate-smoke: 1` makes this handler validate the body and answer
 * `{ ok: true, smoke: true }` having written and sent nothing. `verify-rendered.mjs` uses it against the
 * preview, `verify-vercel.sh` and `verify-cloudflare.sh` against the deployed URL.
 *
 * THE HEADER DOES NOTHING WITHOUT `x-palate-smoke-secret` MATCHING `PALATE_SMOKE_SECRET`
 * unless the build says out loud that it is not production. Production and an UNKNOWN
 * environment are both closed, and an unset or blank secret refuses every request rather than
 * matching every request. The failure that guards against is not an attacker: it is a proxy,
 * a scanner or a browser extension adding a header to a real visitor's submission, on a
 * deployment where nobody set the variable, and the enquiry quietly evaporating.
 *
 * A REFUSED SMOKE REQUEST IS AN ORDINARY ENQUIRY, not a 403. Whoever sent it may be a
 * customer who never chose the header, so it goes through the real path.
 */
// ---- SMOKE CONTRACT BEGIN ----
// Byte-identical in templates/astro-project and templates/cms-sanity, because add-sanity.sh
// copies one over the other and a smoke request must mean the same thing after it does.
// scripts/test/contact-smoke.test.mjs runs one suite against both files and compares this block.
const SMOKE_HEADER = "x-palate-smoke";
const SMOKE_SECRET_HEADER = "x-palate-smoke-secret";

function smokeAllowed(request: Request, env: any) {
  if (request.headers.get(SMOKE_HEADER) !== "1") return false;
  // WRITTEN AS THIS EXACT EXPRESSION so the Vite `define` in astro.config.mjs substitutes it
  // at build time. Read through the `env` alias it is never substituted, so it would be
  // undefined on Vercel and the guard would never engage.
  const siteEnv = import.meta.env.PUBLIC_SITE_ENV;
  //
  // AN UNKNOWN ENVIRONMENT REQUIRES THE SECRET. THE TEST IS NOT "is this production".
  //
  // It used to be, and that shipped the guard switched OFF five separate times: the Cloudflare
  // bootstrap deploy, its revalidate workflow (which a CMS publish triggers, so it reopened on
  // every content publish), two more workflows, and finally a bare `wrangler deploy`, which does
  // not build at all and ships whatever dist/ holds after any local gate rebuilt it. Each was a
  // live site honouring `x-palate-smoke: 1` from anyone and discarding the enquiry. Chasing the
  // sixth build command is not a fix, because the DEFAULT was wrong: every new path inherited
  // "I do not know what this build is" meaning "no secret needed".
  //
  // So: only a build that says out loud it is not production is open. Empty, unset, or anything
  // this file cannot read is closed. Every path that matters already bakes an explicit value,
  // Cloudflare preview builds and Vercel from VERCEL_ENV alike, so the cost of a forgotten
  // command is a printed skip that names itself, never a silent hole on a client's live site.
  const known = typeof siteEnv === "string" && siteEnv.trim() !== "";
  if (known && siteEnv.trim().toLowerCase() !== "production") return true;
  // NOT trimmed. What is configured is what must be sent, and a trim here would quietly
  // accept a secret different from the one in the dashboard.
  const secret = typeof env?.PALATE_SMOKE_SECRET === "string" ? env.PALATE_SMOKE_SECRET : "";
  if (!secret) return false; // fail closed: no secret configured means no smoke path
  return constantTimeEqual(request.headers.get(SMOKE_SECRET_HEADER) ?? "", secret);
}

// No node:crypto and no Buffer: this file runs on Workers as well as on Vercel's node runtime
// and timingSafeEqual exists in neither shape on both. Constant in the characters compared;
// the length is not hidden and does not need to be.
function constantTimeEqual(a: string, b: string) {
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/** The same three rules ContactForm.astro applies in the browser, restated where they bind. */
function validate(d: { name?: unknown; email?: unknown; message?: unknown }) {
  const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  if (!s(d.name)) return "please enter your name";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s(d.email))) return "please enter a valid email address";
  if (!s(d.message)) return "please enter a message";
  return "";
}
// ---- SMOKE CONTRACT END ----

export const POST: APIRoute = async ({ request, locals }) => {
  // THREE SOURCES, AND THE ORDER IS THE POINT. Cloudflare puts the runtime env on
  // `locals.runtime.env`. Vercel's adapter never sets that, so the fallback used to be
  // `import.meta.env` alone, which is BAKED AT BUILD: a value set in the dashboard after the
  // deploy did nothing, and a rotation silently did not take, while the docs listed it beside
  // RESEND_API_KEY as an ordinary runtime secret. Measured on a compiled function, not reasoned
  // about: the build-time value answered and the runtime one did not. `process.env` is layered
  // over the baked object on the node runtime so the documented path works and a rotation takes
  // effect on the next invocation. `typeof process` is guarded because Workers has no process.
  const env = (locals as any).runtime?.env
    ?? (typeof process !== "undefined" && process?.env
      ? { ...import.meta.env, ...process.env }
      : import.meta.env);
  try {
    const data = await request.json();
    const { name, email, message, turnstileToken } = (data ?? {}) as Record<string, unknown>;

    // Validation runs BEFORE both paths on purpose. A validator only the smoke request meets
    // is a validator nothing in production ever runs, so the round-trip test would be proving
    // a code path no visitor reaches. It also means a malformed body costs no Turnstile call.
    const invalid = validate({ name, email, message });
    if (invalid) return json({ error: invalid }, 400);

    if (smokeAllowed(request, env)) return json({ ok: true, smoke: true }, 200);

    // 1. Verify Turnstile
    const verify = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: env.TURNSTILE_SECRET, response: turnstileToken }),
    }).then((r) => r.json());
    if (!verify.success) return json({ error: "verification failed" }, 400);

    // 2. Write to Sanity using the EDITOR (write) token
    const sanity = createClient({
      projectId: env.SANITY_PROJECT_ID,
      dataset: env.SANITY_DATASET ?? "production",
      apiVersion: "2025-02-19",
      token: env.SANITY_API_WRITE_TOKEN,   // editor token, Worker secret only
      useCdn: false,
    });
    await sanity.create({
      _type: "formSubmission",
      name, email, message,
      submittedAt: new Date().toISOString(),
      source: "contact-form",
    });

    // 3. Notify via Resend
    if (env.RESEND_API_KEY) {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "forms@{{DOMAIN}}",
          to: business.email,
          subject: `New enquiry from ${name}`,
          text: `${name} (${email})\n\n${message}`,
        }),
      });
    }
    return json({ ok: true }, 200);
  } catch (e) {
    return json({ error: "submission failed" }, 500);
  }
};

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
