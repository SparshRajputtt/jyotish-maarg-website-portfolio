/**
 * book.js
 * Jyotish Maarg — Book Consultation Page Entry Point
 *
 * ─────────────────────────────────────────────────────────────────
 * COVERAGE AUDIT — what main.js already handles on this page
 * ─────────────────────────────────────────────────────────────────
 *
 * Module             Trigger element(s) in book.html           Status
 * ─────────────────────────────────────────────────────────────────
 * navbar.js          .navbar (partial)                         ✅ covered
 * mobile-menu.js     .navbar__hamburger + .mobile-menu         ✅ covered
 * scroll-reveal.js   .reveal, .reveal--card, .reveal--fade     ✅ covered
 * stats-counter.js   .stat-number[data-count]  — absent        ✅ no-op
 * testimonial-carousel.js  .testimonial-carousel — absent      ✅ no-op
 * faq-accordion.js   [data-accordion]                          ✅ covered
 * footer-accordion.js  .footer (partial)                       ✅ covered
 * sticky-cta-bar.js  .sticky-cta-bar                           ✅ covered
 * back-to-top.js     .back-to-top[data-back-to-top]            ✅ covered
 * form-validation.js form[novalidate] with data-validate attrs ✅ covered
 *
 * ─────────────────────────────────────────────────────────────────
 * PAGE-SPECIFIC RESPONSIBILITIES (genuinely belong here)
 * ─────────────────────────────────────────────────────────────────
 *
 * 1. URL parameter → service pre-selection
 *    Links from service pages deep-link to book.html?service=career-astrology
 *    so the correct <option> is pre-selected when the visitor lands.
 *    No shared module reads URL params or touches the service <select>.
 *
 * 2. Navbar-offset scroll compensation for #booking-form anchor links
 *    The sticky navbar obscures the booking form section when in-page
 *    anchor links (href="#booking-form") fire.  CSS scroll-margin-top is
 *    the right long-term fix but is not set in book.css for this element.
 *    We intercept the clicks and manually scroll with the correct offset
 *    so the form heading is visible below the fixed navbar on all viewports.
 *
 *    Handles both:
 *      - `.cta-strip__actions a[href="#booking-form"]`   (final CTA section)
 *      - `.sticky-cta-bar a[href="#booking-form"]`       (mobile sticky bar)
 *
 * 3. Focus management after programmatic scroll
 *    After compensating the scroll, focus is moved to the form's first
 *    interactive field so keyboard and screen-reader users land in the
 *    right place without an extra Tab press.
 *
 * @module pages/book
 */


// =============================================================================
// Constants
// =============================================================================

/** Valid values for the ?service= query parameter (match <option> values). */
const VALID_SERVICES = new Set([
  'career-astrology',
  'business-astrology',
  'marriage-consultation',
  'vastu-shastra',
  'vedic-astrology',
  'not-sure',
]);

/**
 * Extra vertical padding (px) added on top of the navbar height so the form
 * heading is not flush with the navbar bottom edge after compensated scroll.
 */
const SCROLL_PADDING = 24;

/**
 * CSS custom properties that store the navbar height.
 * Checked in this order; first one that resolves to a finite value is used.
 */
const NAVBAR_HEIGHT_TOKENS = [
  '--navbar-height-desktop',
  '--navbar-height-mobile',
];


// =============================================================================
// 1. Read navbar height from CSS tokens
// =============================================================================

/**
 * Reads the current effective navbar height from CSS custom properties.
 * Falls back to a hard-coded value if the tokens are not available.
 *
 * Uses `window.innerWidth` to choose the correct token (mobile vs desktop)
 * so the offset is accurate at the current viewport width.
 *
 * @returns {number} Navbar height in pixels.
 */
function getNavbarHeight() {
  const root = document.documentElement;

  // Pick the appropriate token based on current viewport width.
  // --navbar-height-desktop is used above 1024px (matches navbar.css breakpoint).
  const token = window.innerWidth >= 1024
    ? '--navbar-height-desktop'
    : '--navbar-height-mobile';

  try {
    const raw = getComputedStyle(root).getPropertyValue(token).trim();
    // Tokens are expressed as "Xrem" — convert to px using root font-size.
    if (raw.endsWith('rem')) {
      const rem = parseFloat(raw);
      const rootFontSize = parseFloat(getComputedStyle(root).fontSize) || 16;
      const px = rem * rootFontSize;
      if (Number.isFinite(px) && px > 0) return px;
    }
    // Fallback: parse as plain number if already px.
    const px = parseFloat(raw);
    if (Number.isFinite(px) && px > 0) return px;
  } catch {
    // Silently fall through to hard-coded fallback.
  }

  // Hard-coded fallbacks matching tokens.css:
  // --navbar-height-desktop: 4.5rem (72px at 16px root)
  // --navbar-height-mobile:  3.75rem (60px at 16px root)
  return window.innerWidth >= 1024 ? 72 : 60;
}


// =============================================================================
// 2. URL parameter → service pre-selection
// =============================================================================

/**
 * Reads the `?service=` query parameter and pre-selects the corresponding
 * option in the service <select> element.
 *
 * Silently no-ops if:
 *   - The select element is not found.
 *   - The parameter value is absent or not in VALID_SERVICES.
 *   - The matching <option> does not exist in the select.
 *
 * @returns {boolean} true if a service was successfully pre-selected.
 */
function applyServiceFromUrl() {
  const select = document.getElementById('booking-service');
  if (!(select instanceof HTMLSelectElement)) return false;

  const params = new URLSearchParams(window.location.search);
  const service = params.get('service')?.toLowerCase().trim() ?? '';

  if (!service || !VALID_SERVICES.has(service)) return false;

  // Verify the option exists before setting (guards against stale links).
  const optionExists = Array.from(select.options).some(
    (opt) => opt.value === service
  );
  if (!optionExists) return false;

  select.value = service;

  // Trigger the form-validation.js change handler if the field was previously
  // in an error state (e.g. user navigated back after a failed submit).
  select.dispatchEvent(new Event('change', { bubbles: true }));

  return true;
}


// =============================================================================
// 3. Navbar-offset scroll compensation
// =============================================================================

/**
 * Scrolls to `targetEl` compensating for the sticky navbar height and an
 * additional padding constant.
 *
 * Uses `behavior: 'smooth'` unless the user prefers reduced motion, in which
 * case it falls back to instant scroll.
 *
 * @param {HTMLElement} targetEl   — Element to scroll into view.
 * @param {boolean}     [instant]  — Force instant scroll regardless of motion pref.
 */
function scrollToWithOffset(targetEl, instant = false) {
  const navbarHeight = getNavbarHeight();
  const targetTop    = targetEl.getBoundingClientRect().top + window.scrollY;
  const scrollTo     = targetTop - navbarHeight - SCROLL_PADDING;

  const reducedMotion =
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  window.scrollTo({
    top:      Math.max(0, scrollTo),
    behavior: (instant || reducedMotion) ? 'instant' : 'smooth',
  });
}

/**
 * Moves keyboard focus to the first focusable element inside the booking form
 * after the scroll animation settles.
 *
 * Deferred with a short timeout so focus doesn't interrupt the smooth-scroll
 * animation (browsers cancel smooth scroll on programmatic focus).
 * For instant/reduced-motion scroll the delay is near-zero.
 *
 * @param {boolean} reducedMotion
 */
function focusFirstFormField(reducedMotion) {
  const form = document.getElementById('booking-form-el');
  if (!form) return;

  const firstField = form.querySelector(
    'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])'
  );
  if (!(firstField instanceof HTMLElement)) return;

  const delay = reducedMotion ? 0 : 600;
  setTimeout(() => firstField.focus({ preventScroll: true }), delay);
}

/**
 * Intercepts clicks on any `<a href="#booking-form">` within the page and
 * replaces the default browser anchor jump with an offset-compensated scroll.
 *
 * Uses event delegation on `document` so it catches links inside partials
 * (navbar, sticky bar, footer) that are injected after DOMContentLoaded.
 *
 * @returns {() => void} Cleanup function that removes the listener.
 */
function initBookingFormScroll() {
  const target = document.getElementById('booking-form');
  if (!target) return () => {};

  /**
   * @param {MouseEvent} e
   */
  function onDocumentClick(e) {
    const anchor = e.target instanceof Element
      ? e.target.closest('a[href="#booking-form"]')
      : null;

    if (!anchor) return;

    e.preventDefault();

    const reducedMotion =
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    scrollToWithOffset(target, reducedMotion);
    focusFirstFormField(reducedMotion);
  }

  document.addEventListener('click', onDocumentClick);

  return () => document.removeEventListener('click', onDocumentClick);
}


// =============================================================================
// 4. Scroll-to-form on page load when URL has ?service= param
// =============================================================================

/**
 * If the URL contains a `?service=` parameter the visitor arrived via a
 * deep-link from a service page CTA.  After pre-selecting the service, we
 * scroll the form into view so it's immediately visible without requiring
 * the visitor to scroll manually.
 *
 * Delayed by one rAF to ensure the partial-injected navbar height is
 * resolved before we read it via getNavbarHeight().
 *
 * @param {boolean} serviceWasPreSelected — only scroll if a service was set.
 */
function scrollToFormIfDeepLinked(serviceWasPreSelected) {
  if (!serviceWasPreSelected) return;

  const target = document.getElementById('booking-form');
  if (!target) return;

  // Wait for the navbar partial to inject and the browser to paint once.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const reducedMotion =
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      scrollToWithOffset(target, reducedMotion);
    });
  });
}


// =============================================================================
// 5. Public API
// =============================================================================

/**
 * Initialises all book-page-specific behaviour.
 *
 * Called from book.html via:
 *   <script type="module" src="/js/pages/book.js"></script>
 *
 * Runs after DOMContentLoaded (type="module" defers automatically).
 * main.js has already been parsed and is bootstrapping in parallel;
 * partial injection may not yet be complete at this point, which is why
 * the scroll compensation uses event delegation (catches post-injection clicks).
 *
 * @returns {{ destroy: () => void } | null}
 *   Public API object, or null when not running on the booking page
 *   (defensive guard for SPA-style environments).
 */
function initBookPage() {
  // Guard: only run when the booking form section is present.
  const bookingSection = document.getElementById('booking-form');
  if (!bookingSection) return null;

  // ── 1. Service pre-selection from URL ──────────────────────────────────────
  const servicePreSelected = applyServiceFromUrl();

  // ── 2. Navbar-offset scroll compensation (event delegation) ────────────────
  const removeScrollListener = initBookingFormScroll();

  // ── 3. Scroll to form if visitor arrived via a service deep-link ───────────
  scrollToFormIfDeepLinked(servicePreSelected);

  // ── Public API ─────────────────────────────────────────────────────────────
  return {
    destroy() {
      removeScrollListener();
    },
  };
}


// =============================================================================
// Bootstrap
// =============================================================================

// type="module" scripts are deferred — DOM is fully parsed here.
// Guard with readyState for the edge case where this script is injected
// dynamically after DOMContentLoaded has already fired.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initBookPage, { once: true });
} else {
  initBookPage();
}


// =============================================================================
// Exports
// =============================================================================

export { initBookPage };
export default initBookPage;