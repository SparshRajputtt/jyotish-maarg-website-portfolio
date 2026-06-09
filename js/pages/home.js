/**
 * home.js
 * Jyotish Maarg — Homepage Entry Point
 *
 * Audit result: all homepage functionality is already handled by the shared
 * modules initialised in main.js:
 *
 *   • navbar.js              — scroll transparency, active link
 *   • mobile-menu.js         — hamburger overlay, focus trap
 *   • scroll-reveal.js       — all .reveal* elements across every section
 *   • stats-counter.js       — .stat-number[data-count] in the stats strip
 *   • testimonial-carousel.js — carousel in Section 7
 *   • faq-accordion.js       — [data-accordion] in Section 9
 *   • footer-accordion.js    — footer column toggles (mobile)
 *   • sticky-cta-bar.js      — mobile sticky bar
 *   • back-to-top.js         — back-to-top button
 *   • form-validation.js     — not present on this page; no-ops safely
 *
 * Hero entrance animations (.hero-animate--*) are pure CSS — they run
 * automatically via animation-fill-mode: both; no JS trigger is needed.
 *
 * Hero background drift (.hero-animate--bg, @keyframes hero-drift) is also
 * pure CSS (infinite, 20s). However, home.css sets will-change: transform on
 * .hero__bg-img for the entrance frame and notes it should be cleaned up.
 * scroll-reveal.js only manages .reveal* elements and does not touch hero
 * elements, so that cleanup belongs here.
 *
 * This file therefore has one focused responsibility:
 *   Release the will-change: transform compositor hint on .hero__bg-img once
 *   the drift animation is fully running and the browser no longer needs the
 *   promotion hint. This frees the compositor layer without disrupting the
 *   CSS animation, which continues unaffected.
 *
 * Why here and not in a shared module?
 *   The hero background image is a homepage-only element. Putting this logic
 *   in a module would create a dependency on homepage-specific markup that
 *   no other page shares. It is intentionally kept in home.js.
 *
 * @module pages/home
 */


// =============================================================================
// Constants
// =============================================================================

/** Selector for the hero background image that carries will-change. */
const HERO_BG_SELECTOR = '.hero__bg-img';

/**
 * Delay (ms) before releasing will-change after page load.
 * The hero-drift animation has a 20s duration. We wait one full cycle
 * plus a small buffer so the compositor layer is no longer needed for
 * the entrance scale before we release the hint.
 *
 * In practice the browser ignores will-change once a CSS animation is
 * running steadily, but releasing it explicitly avoids keeping a promoted
 * layer alive indefinitely on low-memory devices.
 */
const WILL_CHANGE_RELEASE_DELAY_MS = 20_500;


// =============================================================================
// Hero background will-change cleanup
// =============================================================================

/**
 * Releases will-change: transform on the hero background image element
 * after one full animation cycle.
 *
 * Skipped entirely when:
 *   - The element is not found (page variation, A/B test, etc.)
 *   - prefers-reduced-motion: reduce is active (animations.css already sets
 *     will-change: auto in that media query; redundant to run a timer)
 *
 * @returns {() => void} Cleanup function that cancels the pending timer.
 *                       Safe to call even if the timer already fired.
 */
function initHeroBgWillChangeCleanup() {
  const heroImg = document.querySelector(HERO_BG_SELECTOR);
  if (!heroImg || !(heroImg instanceof HTMLElement)) {
    return () => {};
  }

  // If the user prefers reduced motion, animations.css already resets
  // will-change to auto — nothing to do.
  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (motionQuery.matches) {
    return () => {};
  }

  const timerId = window.setTimeout(() => {
    // Double-check the element is still in the DOM (e.g. SPA navigation).
    if (heroImg.isConnected) {
      heroImg.style.willChange = 'auto';
    }
  }, WILL_CHANGE_RELEASE_DELAY_MS);

  return () => window.clearTimeout(timerId);
}


// =============================================================================
// Public API
// =============================================================================

/**
 * Initialises homepage-specific behaviour.
 *
 * Intentionally minimal — see module-level JSDoc for the audit rationale.
 * All shared functionality (scroll reveal, stats counter, testimonial
 * carousel, FAQ accordion, navbar, sticky bar, back-to-top) is handled
 * by main.js and the modules it bootstraps.
 *
 * @returns {{ destroy: () => void } | null}
 *   Public API with a destroy function, or null if this is not the homepage.
 */
function initHomePage() {
  // Guard: only run on pages that have the hero section.
  if (!document.querySelector('[data-hero]')) {
    return null;
  }

  const cleanupWillChange = initHeroBgWillChangeCleanup();

  return {
    destroy() {
      cleanupWillChange();
    },
  };
}

export { initHomePage };
export default initHomePage;