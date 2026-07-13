// Contact form handler. Dual destination:
//   1. Email via Resend (notification to the team)
//   2. Write to the Sanity formSubmission collection (durable record)
// Uses the EDITOR token (SANITY_API_WRITE_TOKEN), never the frontend read token.
// Turnstile-verified before either action.
import type { APIRoute } from "astro";
import { createClient } from "@sanity/client";

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  const env = (locals as any).runtime?.env ?? import.meta.env;
  try {
    const data = await request.json();
    const { name, email, message, turnstileToken } = data;

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
          to: "hello@{{DOMAIN}}",
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
