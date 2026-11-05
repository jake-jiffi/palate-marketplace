/**
 * THE KIT FORM RUNTIME. ONE COPY, SHARED BY ALL FOUR CONVERSION FORMS.
 *
 * This is the code path that costs a real enquiry when it goes wrong, so it is written once and
 * imported rather than pasted into each form. Four copies of a state machine that must agree is
 * how a form ends up validating one way on the contact page and another way on the booking page,
 * and the guard below makes it worse rather than better: only the first copy on a page would ever
 * bind, so a drifted copy would change behaviour depending on which section a page happened to
 * put first. One module, evaluated once, removes that whole class.
 *
 * IT IS ENTIRELY DOM-DRIVEN. What to validate, what to say when it fails, and what to send are
 * all read from data attributes on the markup, so a form can add a field without touching this
 * file, and the copy a visitor reads lives next to the field it describes.
 *
 * IT BINDS ON `document`, ONCE, BY DELEGATION. Astro's ClientRouter replaces the body on every
 * client-side navigation while `document` survives, so a listener attached to a form element
 * would work until the visitor navigated and then silently stop. Delegation also means a form
 * rendered later, or two forms on one page, need no extra wiring.
 *
 * THE CONTRACT WITH /api/contact. The endpoint accepts exactly `{ name, email, message,
 * turnstileToken }` and rejects a blank name, a malformed email or a blank message with a 400.
 * Structured answers (a service, a suburb, a preferred time) therefore travel INSIDE `message`,
 * labelled, rather than as extra JSON keys the endpoint would drop on the floor. That is why a
 * booking form and a contact form can share one endpoint without one of them losing half its
 * answers on the way.
 */

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FORM = "[data-kit-form]";

const trim = (value: string | undefined | null) => (value || "").trim();

function controls(form: HTMLFormElement): Control[] {
  return Array.from(form.querySelectorAll<Control>("[data-kit-validate]"));
}

/**
 * The one message this control is currently wrong about, or "".
 *
 * `allowEmpty` is the difference between validating on blur and validating on submit. A required
 * field the visitor has tabbed through but not filled in yet is not a mistake, it is a field they
 * have not reached the end of; flagging it as they go is the behaviour that makes forms feel
 * hostile. Emptiness only becomes a problem when they try to send.
 */
function problemWith(el: Control, allowEmpty: boolean): string {
  const rules = (el.getAttribute("data-kit-validate") || "").split(/\s+/).filter(Boolean);
  const required = rules.includes("required");
  const requiredMessage =
    el.getAttribute("data-kit-required-message") || "Please fill this in before sending.";

  if (el instanceof HTMLInputElement && el.type === "checkbox") {
    if (required && !el.checked) return allowEmpty ? "" : requiredMessage;
    return "";
  }

  const value = trim((el as HTMLInputElement).value);
  if (!value) return required && !allowEmpty ? requiredMessage : "";

  if (rules.includes("email") && !EMAIL.test(value)) {
    return "That email address is missing something. We reply to it, so it is worth a second look.";
  }

  if (rules.includes("tel") && value.replace(/[^0-9]/g, "").length < 8) {
    return "Please give the full number, area code and all, so we can ring you back.";
  }

  if (rules.includes("date")) {
    const parts = value.split("-").map(Number);
    if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) {
      return "Please choose a date from the calendar.";
    }
    // ISO dates compare correctly as strings, which is the whole reason the input uses that format.
    const min = el.getAttribute("min");
    const max = el.getAttribute("max");
    if (min && value < min) return "We need a bit more notice than that. Please choose a later date.";
    if (max && value > max) return "That is further ahead than we book. Please choose an earlier date.";

    const openDays = el.getAttribute("data-kit-open-days");
    if (openDays) {
      // Built from the parts rather than parsed from the string, because `new Date("2026-01-04")`
      // is read as UTC and lands on the previous day for anyone west of Greenwich, which would
      // reject a perfectly good Monday.
      const day = new Date(parts[0], parts[1] - 1, parts[2]).getDay();
      const open = openDays.split(",").map((d) => Number(d.trim()));
      if (!open.includes(day)) {
        return el.getAttribute("data-kit-invalid-message") || "We are closed that day. Please pick another.";
      }
    }
  }

  return "";
}

/** Shows or clears one field's message. Never colour alone: the text is the error. */
function setProblem(el: Control, message: string) {
  const errorId = el.getAttribute("data-kit-error");
  const error = errorId ? document.getElementById(errorId) : null;
  if (message) {
    if (error) {
      error.textContent = message;
      error.hidden = false;
    }
    el.setAttribute("aria-invalid", "true");
  } else {
    if (error) {
      error.textContent = "";
      error.hidden = true;
    }
    el.removeAttribute("aria-invalid");
  }
}

/** Everything the visitor typed, folded into the three keys the endpoint accepts. */
function buildPayload(form: HTMLFormElement) {
  const payload: Record<string, string> = { name: "", email: "", message: "" };

  form.querySelectorAll<Control>("[data-kit-key]").forEach((el) => {
    const key = el.getAttribute("data-kit-key");
    if (key) payload[key] = trim((el as HTMLInputElement).value);
  });

  const extras: string[] = [];
  form.querySelectorAll<Control>("[data-kit-summary]").forEach((el) => {
    const label = el.getAttribute("data-kit-summary") || "";
    let value = "";
    if (el instanceof HTMLInputElement && el.type === "checkbox") value = el.checked ? "yes" : "no";
    else if (el instanceof HTMLInputElement && el.type === "file") {
      value = Array.from(el.files || []).map((file) => file.name).join(", ");
    } else value = trim((el as HTMLInputElement).value);
    if (value) extras.push(`${label}: ${value}`);
  });

  if (extras.length) {
    payload.message = extras.join("\n") + (payload.message ? `\n\n${payload.message}` : "");
  }
  // A signup form asks for an address and nothing else, and the endpoint rejects a blank name and
  // a blank message. Their own address is the honest stand-in for a name nobody was asked for.
  if (!payload.name) payload.name = payload.email;
  if (!payload.message) {
    payload.message = form.getAttribute("data-kit-fallback-message") || "Sent from the website.";
  }
  return payload;
}

/**
 * Turnstile renders the widgets that exist when its script parses, and never looks again. After a
 * client-side navigation the script is already loaded and the new widget is not, so the token
 * stays blank and the endpoint answers "verification failed", which reads to everyone involved
 * like a server fault rather than a missing render. This puts that right.
 */
function renderTurnstileWidgets() {
  const api = (window as unknown as { turnstile?: { render: (el: Element, o: unknown) => void } }).turnstile;
  if (!api) return; // First load: the script auto-renders, and it may not have arrived yet.
  document.querySelectorAll<HTMLElement>(".cf-turnstile[data-sitekey]").forEach((el) => {
    if (el.dataset.kitRendered === "true" || el.querySelector("iframe")) return;
    el.dataset.kitRendered = "true";
    api.render(el, { sitekey: el.dataset.sitekey });
  });
}

export function initKitForms() {
  const w = window as unknown as { __kitFormRuntime?: boolean };
  if (w.__kitFormRuntime) return;
  w.__kitFormRuntime = true;

  const revalidate = (event: Event) => {
    const el = event.target;
    if (!(el instanceof Element) || !el.matches("[data-kit-validate]")) return;
    if (!el.closest(FORM)) return;
    // Only speak up about a field already flagged: clearing an error the instant it is fixed is
    // the half of this that people notice.
    if (el.getAttribute("aria-invalid") === "true") setProblem(el as Control, problemWith(el as Control, true));
  };

  // `focusout` rather than `blur`, because blur does not bubble and there is nothing to delegate on.
  document.addEventListener("focusout", (event) => {
    const el = event.target;
    if (!(el instanceof Element) || !el.matches("[data-kit-validate]")) return;
    if (!el.closest(FORM)) return;
    setProblem(el as Control, problemWith(el as Control, true));
  });
  document.addEventListener("input", revalidate);
  document.addEventListener("change", revalidate);

  /**
   * CAPTURE PHASE, AND THAT IS THE WHOLE FIX.
   *
   * Astro's <ClientRouter /> also listens for `submit` on `document`, and BaseLayout renders it
   * on every page. With both handlers in the bubble phase the router registered first and won,
   * so in the configuration this kit actually ships in, every form in it was dead:
   *
   *   - no validation on an empty submit, no errors, no focus move
   *   - no loading, success or error state ever reached the visitor: they pressed Send and got
   *     a blank form back with no confirmation that anything had happened
   *   - and worst, the router serialised the form into the URL, so a real person's NAME, EMAIL
   *     and MESSAGE were written into browser history, the Referer header and every server
   *     access log along the way
   *
   * A capture-phase listener on `document` runs before any bubble-phase listener anywhere, so
   * the kit takes the submission first, calls preventDefault, and the router never sees it. It
   * also stops propagation, because a router that has already decided to transition on a
   * prevented event is a bug waiting to be reintroduced by a future Astro version.
   *
   * This is not theoretical tidying: it was found by an independent critic driving a real
   * submission, and no static check in this repository could have caught it. The component was
   * excellent and unreachable.
   */
  document.addEventListener(
    "submit",
    (event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement) || !form.matches(FORM)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void submitKitForm(form);
    },
    { capture: true },
  );

  document.addEventListener("astro:page-load", renderTurnstileWidgets);
  renderTurnstileWidgets();
}

async function submitKitForm(form: HTMLFormElement) {
  // The button is disabled while a request is in flight; this covers the ways a form can be
  // submitted without pressing it, so a double send is impossible rather than merely unlikely.
  if (form.dataset.kitBusy === "true") return;

  const alertBox = form.querySelector<HTMLElement>("[data-kit-alert]");
  const alertText = form.querySelector<HTMLElement>("[data-kit-alert-text]");
  const status = form.querySelector<HTMLElement>("[data-kit-status]");
  const button = form.querySelector<HTMLButtonElement>("[data-kit-submit]");
  const spinner = form.querySelector<HTMLElement>("[data-kit-spinner]");

  // Unhide first, then write the text: a role="alert" that is populated while hidden is announced
  // by some screen readers and not by others. `moveFocus` is false when the banner is only
  // summarising field errors, because focus is about to land on the first bad field and taking it
  // to the banner first cuts the announcement in half.
  const showAlert = (message: string, moveFocus = true) => {
    if (alertBox) alertBox.hidden = false;
    if (alertText) alertText.textContent = message;
    if (moveFocus && alertBox) alertBox.focus();
  };

  let firstBad: Control | null = null;
  for (const el of controls(form)) {
    const message = problemWith(el, false);
    setProblem(el, message);
    if (message && !firstBad) firstBad = el;
  }
  if (firstBad) {
    showAlert("Some details still need fixing. They are marked below.", false);
    firstBad.focus();
    return;
  }
  if (alertBox) alertBox.hidden = true;

  const payload = buildPayload(form);
  const token = form.querySelector<HTMLInputElement>('[name="cf-turnstile-response"]');

  // A spam check that has not finished yet sends a blank token, and the endpoint answers 400
  // "verification failed", which reads like the visitor did something wrong. Say what is actually
  // happening instead, and spend no request on it. The way out, if the challenge is blocked
  // outright rather than merely slow, is the second line of this banner: it names another way to
  // reach the business, which is the only honest answer when the widget will never load.
  if (form.querySelector(".cf-turnstile[data-sitekey]") && !(token && token.value)) {
    showAlert("The spam check has not finished. Give it a moment, then press send again.");
    return;
  }

  let done = false;
  form.dataset.kitBusy = "true";
  if (button) {
    button.disabled = true;
    button.setAttribute("data-loading", "true");
  }
  if (spinner) spinner.hidden = false;
  if (status) status.textContent = form.getAttribute("data-kit-sending") || "Sending, one moment.";

  try {
    const response = await fetch(form.getAttribute("data-kit-endpoint") || "/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, turnstileToken: token ? token.value : "" }),
    });

    let data: { ok?: boolean; error?: string } | null = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (response.ok && data && data.ok) {
      done = true;
      const panel = form.parentElement?.querySelector<HTMLElement>("[data-kit-success]") || null;
      if (panel) {
        // The form is REPLACED, not decorated with a green line. Somebody who has just sent an
        // enquiry should not be looking at the form they already sent, wondering whether to send
        // it again, and moving focus into the confirmation is what makes that true for a screen
        // reader as well as for everyone else.
        form.hidden = true;
        panel.hidden = false;
        panel.querySelector<HTMLElement>("[data-kit-success-heading]")?.focus();
      } else {
        form.reset();
        if (status) status.textContent = "Thanks, that is on its way to us.";
      }
      return;
    }

    const reason = data && typeof data.error === "string" ? data.error : "";
    if (reason.includes("verification")) {
      showAlert("The spam check did not go through. Reload the page and send it again, and it should pass.");
    } else if (response.status === 400 && reason) {
      showAlert(`${reason.charAt(0).toUpperCase()}${reason.slice(1)}. Fix that and send it again.`);
    } else {
      showAlert("We could not send that just now. Nothing you typed has been lost, so try again in a moment.");
    }
  } catch {
    showAlert("We could not reach the server. Check your connection: your answers are all still here.");
  } finally {
    form.dataset.kitBusy = "false";
    if (button) {
      button.disabled = false;
      button.removeAttribute("data-loading");
    }
    if (spinner) spinner.hidden = true;
    if (status && !done) status.textContent = "";
  }
}
