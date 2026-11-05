/**
 * Keeps a wide-content scroller focusable only while it actually scrolls.
 *
 * A table too wide for a phone lives inside its own `overflow-x: auto` box. WCAG 2.1.1 means a
 * keyboard user has to be able to move that box, and a scroll container is not focusable on its
 * own in every browser, so the markup ships `tabindex="0"` and a `<section aria-label>` naming
 * what is inside. That is right on a phone and wrong on a desktop: measured on the pricing table
 * at 1440px, scrollWidth and clientWidth are both 1376, nothing moves, and a keyboard user still
 * lands on a region that announces a full sentence and then does nothing. The comparison table
 * does the same. Two dead stops on every desktop visit, and a landmark in the list for a box
 * that is not a landmark.
 *
 * So the attribute is REMOVED when there is nothing to scroll and restored when there is, which
 * also means the region announcement follows the same rule: an element with no accessible role
 * to earn is quieter than one that announces itself for nothing.
 *
 * IT FAILS TOWARD ACCESS. The markup carries `tabindex="0"`, so a visitor with no JavaScript, or
 * one who arrives before this module runs, keeps the keyboard path and loses only the tidiness.
 * The reverse default would have taken the scroll away from the people who need it most.
 *
 * Bound once and delegated through ResizeObserver rather than a resize listener, because the box
 * also changes width when a font loads or a sibling column reflows, and neither of those fires
 * `resize`.
 */
const FLAG = "__kitScrollRegionBound";

type ScrollRegionWindow = Window & { [FLAG]?: boolean };

/** Marks whether the element is currently scrollable, and mirrors that onto tabindex. */
function sync(el: HTMLElement): void {
  // A sub-pixel layout can leave scrollWidth one greater than clientWidth with nothing to
  // scroll, so a single pixel is not treated as overflow.
  const scrolls = el.scrollWidth - el.clientWidth > 1;
  if (scrolls) {
    if (el.getAttribute("tabindex") !== "0") el.setAttribute("tabindex", "0");
  } else if (el !== document.activeElement) {
    // Never pull the attribute out from under a reader who is standing on it: that would drop
    // focus to the document and lose their place mid-page.
    el.removeAttribute("tabindex");
  }
  el.toggleAttribute("data-scrolls", scrolls);
}

export function initKitScrollRegions(): void {
  const scope = window as ScrollRegionWindow;
  if (scope[FLAG]) return;
  scope[FLAG] = true;

  const observer =
    typeof ResizeObserver === "function"
      ? new ResizeObserver((entries) => {
          for (const entry of entries) {
            if (entry.target instanceof HTMLElement) sync(entry.target);
          }
        })
      : null;

  const watched = new WeakSet<HTMLElement>();

  const scan = (): void => {
    document.querySelectorAll<HTMLElement>("[data-kit-scroll-region]").forEach((el) => {
      sync(el);
      if (observer && !watched.has(el)) {
        watched.add(el);
        observer.observe(el);
      }
    });
  };

  scan();
  // ClientRouter swaps the document body, so the incoming page's scrollers are new elements.
  document.addEventListener("astro:page-load", scan);
  if (!observer) window.addEventListener("resize", scan);
  // A late web font changes the table's intrinsic width after first layout.
  if (document.fonts && typeof document.fonts.ready?.then === "function") {
    document.fonts.ready.then(scan).catch(() => {});
  }
}
