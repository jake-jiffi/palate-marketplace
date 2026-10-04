import { business } from "../../lib/business";
// Contact form handler. Turnstile-verified, then notifies the team via Resend.
//
// NO CMS IS WIRED IN THIS BUILD, so the email IS the record. With Sanity wired
// the write to formSubmission is the durable copy and a failed email is only a
// missed notification; without it, swallowing a Resend failure loses the
// enquiry outright, so this version fails loudly instead.
// `scripts/add-sanity.sh` replaces this file with the dual-destination version.
import type { APIRoute } from "astro";

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

    // 2. Notify via Resend. This is the only destination, so a failure here is
    //    a lost enquiry: report it rather than returning ok.
    if (!env.RESEND_API_KEY) {
      console.error("[contact] RESEND_API_KEY is not set; the enquiry has nowhere to go");
      return json({ error: "submission failed" }, 500);
    }
    const sent = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "forms@{{DOMAIN}}",
        to: business.email,
        subject: `New enquiry from ${name}`,
        text: `${name} (${email})\n\n${message}`,
      }),
    });
    if (!sent.ok) {
      console.error("[contact] Resend rejected the notification:", sent.status, await sent.text());
      return json({ error: "submission failed" }, 500);
    }
    return json({ ok: true }, 200);
  } catch (e) {
    return json({ error: "submission failed" }, 500);
  }
};

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
