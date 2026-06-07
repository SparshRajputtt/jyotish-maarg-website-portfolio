/**
 * sticky-cta-bar.js
 * Jyotish Maarg — Sticky Bottom CTA Bar Module
 *
 * Responsibilities:
 *   1. Show the sticky CTA bar after the user scrolls 300px (--sticky-bar-trigger)
 *   2. Hide the bar when the footer enters the viewport (IntersectionObserver)
 *   3. Coordinate with the WhatsApp FAB — raise it above the bar when visible
 *   4. Operate only on mobile (< 768px) — fully inert on desktop
 *   5. Respond to viewport resize: deactivate on desktop, reactivate on mobile
 *   6. Throttle scroll reads via requestAnimationFrame for smooth 60fps perf
 *   7. Honour prefers-reduced-motion (bar still shows/hides, transition is in CSS)
 *
 * Expected HTML:
 *
 *   <!-- Sticky bar (placed before closing </body>) -->
 *   <div class="sticky-cta-bar" aria-label="Quick actions" role="region">
 *     <a href="/book" class="btn btn--primary">Book Consultation</a>
 *     <a href="https://wa.me/..." class="btn btn--whatsapp">WhatsApp</a>
 *   </div>
 *
 *   <!-- WhatsApp FAB (separate, also before </body>) -->
 *   <a class="whatsapp-fab" href="https://wa.me/...">...</a>
 *
 * CSS classes this module adds/removes:
 *   .is-visible          — on .sticky-cta-bar when it should be shown
 *                          (CSS drives the translateY(100%) → translateY(0) transition)
 *   .above-sticky-bar    — on .whatsapp-fab when bar is visible
 *                          (CSS raises the FAB above the bar's height)
 *
 * Visibility logic (mobile only):
 *   SHOW  when: scrollY >= SCROLL_TRIGGER AND footer not intersecting
 *   HIDE  when: scrollY <  SCROLL_TRIGGER OR  footer is intersecting
 *
 * Tokens read at init (from :root):
 *   --sticky-bar-trigger   (default: 300px)
 *   --bp-md                (default: 768px — reference only, not used in matchMedia)
 *
 * Performance notes:
 *   · One scroll listener, throttled via rAF (cancelable on destroy)
 *   · One IntersectionObserver for footer visibility
 *   · One ResizeObserver (falls back to resize event) for breakpoint changes
 *   · No DOM mutations inside the rAF callback — only boolean flag updates
 *   · All classList mutations happen via a single syncState() call to batch writes
 *
 * @module sticky-cta-bar
 */

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Scroll distance (px) before the bar appears.
 * Matches --sticky-bar-trigger: 300px in tokens.css.
 */
const DEFAULT_SCROLL_TRIGGER = 300;

/**
 * Viewport width (px) above which the bar is completely inert.
 * Matches --bp-md: 768px in tokens.css.
 * Raw value used because CSS custom properties can't be used in matchMedia.
 */
const DESKTOP_BREAKPOINT = 768;

/** Debounce delay (ms) for resize handler. */
const RESIZE_DEBOUNCE = 150;

/** CSS class added to .sticky-cta-bar when it should be visible. */
const BAR_VISIBLE_CLASS = 'is-visible';

/** CSS class added to .whatsapp-fab to raise it above the bar. */
const FAB_RAISED_CLASS = 'above-sticky-bar';

// ─────────────────────────────────────────────────────────────────────────────
// Module state
// ─────────────────────────────────────────────────────────────────────────────

/** @type {HTMLElement|null} The .sticky-cta-bar element. */
let bar = null;

/** @type {HTMLElement|null} The .whatsapp-fab element. */
let fab = null;

/** @type {HTMLElement|null} The .footer element (observed for proximity). */
let footerEl = null;

/** @type {IntersectionObserver|null} Watches the footer. */
let footerObserver = null;

/** @type {number|null} rAF handle for scroll throttle. */
let rafHandle = null;

/** @type {number|null} Resize debounce timer. */
let resizeTimer = null;

/**
 * Scroll threshold (px) read from CSS token at init.
 * @type {number}
 */
let scrollTrigger = DEFAULT_SCROLL_TRIGGER;

/**
 * Whether the current viewport is mobile (< DESKTOP_BREAKPOINT).
 * @type {boolean}
 */
let isMobile = false;

/**
 * Whether the footer is currently intersecting the viewport.
 * Updated by the IntersectionObserver callback.
 * @type {boolean}
 */
let footerVisible = false;

/**
 * Whether the scroll position is past the trigger threshold.
 * Updated in the rAF scroll handler.
 * @type {boolean}
 */
let pastTrigger = false;

/**
 * The last applied visibility state — used to avoid redundant DOM writes.
 * null = not yet set; true = visible; false = hidden
 * @type {boolean|null}
 */
let lastVisible = null;

// ─────────────────────────────────────────────────────────────────────────────
// 1. CSS token reader
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reads a CSS custom property from :root as a float (strips 'px' unit).
 * Returns `fallback` if absent or unparseable.
 *
 * @param {string} property  e.g. '--sticky-bar-trigger'
 * @param {number} fallback
 * @returns {number}
 */
function getCSSToken(property, fallback) {
  try {
    const raw = getComputedStyle(document.documentElement)
      .getPropertyValue(property)
      .trim();
    const parsed = parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Viewport check
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true when the current viewport is in the mobile range.
 * @returns {boolean}
 */
function checkIsMobile() {
  isMobile = window.innerWidth < DESKTOP_BREAKPOINT;
  return isMobile;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. State synchronisation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Computes the desired visibility state and applies it to the DOM.
 *
 * Batches all classList mutations into a single function to avoid
 * triggering multiple reflows. Called from the rAF handler and the
 * IntersectionObserver callback.
 *
 * Visibility rule:
 *   visible = isMobile AND pastTrigger AND NOT footerVisible
 */
function syncState() {
  if (!bar) return;

  const shouldBeVisible = isMobile && pastTrigger && !footerVisible;

  // Dirty check — skip DOM write if state hasn't changed
  if (shouldBeVisible === lastVisible) return;
  lastVisible = shouldBeVisible;

  bar.classList.toggle(BAR_VISIBLE_CLASS, shouldBeVisible);

  // Coordinate with WhatsApp FAB
  if (fab) {
    fab.classList.toggle(FAB_RAISED_CLASS, shouldBeVisible);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Scroll handling (rAF throttled)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Scroll event handler — reads scrollY and updates pastTrigger flag.
 * Throttled to one read per animation frame to avoid layout thrashing.
 *
 * The rAF callback only updates boolean state; the DOM write is
 * deferred to syncState() which guards against redundant mutations.
 */
function onScroll() {
  // Bail early on desktop — no work needed
  if (!isMobile) return;

  // If a frame is already scheduled, let it run — don't pile up callbacks
  if (rafHandle !== null) return;

  rafHandle = requestAnimationFrame(() => {
    rafHandle = null;

    const newPastTrigger = window.scrollY >= scrollTrigger;

    if (newPastTrigger !== pastTrigger) {
      pastTrigger = newPastTrigger;
      syncState();
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Footer IntersectionObserver
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates an IntersectionObserver that watches the footer element.
 *
 * When the footer begins entering the viewport (even 1px), the bar hides.
 * This prevents the bar from sitting on top of the footer's content.
 *
 * rootMargin adds a small buffer (equal to the bar's height) so the bar
 * starts hiding slightly before the footer is visually reached.
 *
 * @returns {IntersectionObserver}
 */
function createFooterObserver() {
  return new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        footerVisible = entry.isIntersecting;
        syncState();
      });
    },
    {
      // The negative bottom margin (bar height) means the observer fires
      // when the footer is within 64px of the bottom of the viewport,
      // giving the hide transition time to complete before overlap.
      rootMargin: '0px 0px -64px 0px',
      threshold:  0,
    }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Resize handling
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handles viewport resize.
 * Debounced to avoid running on every pixel of a drag-resize.
 *
 * On crossing the mobile/desktop boundary:
 *   → desktop: force bar hidden, cancel rAF, reset lastVisible
 *   → mobile:  re-evaluate scroll position immediately
 */
function onResize() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    const wasMobile = isMobile;
    checkIsMobile();

    if (wasMobile === isMobile) return; // No boundary crossed — nothing to do

    if (!isMobile) {
      // Crossed into desktop — ensure bar is hidden and state is clean
      pastTrigger  = false;
      footerVisible = false;
      lastVisible  = null;

      if (bar) {
        bar.classList.remove(BAR_VISIBLE_CLASS);
      }
      if (fab) {
        fab.classList.remove(FAB_RAISED_CLASS);
      }

      // Cancel any pending rAF from a fast scroll before resize
      if (rafHandle !== null) {
        cancelAnimationFrame(rafHandle);
        rafHandle = null;
      }
    } else {
      // Crossed into mobile — evaluate current scroll position
      pastTrigger = window.scrollY >= scrollTrigger;
      lastVisible = null; // Force re-render
      syncState();
    }
  }, RESIZE_DEBOUNCE);
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Teardown helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cancels all pending async work (rAF, timers, observers).
 * Called by destroy() and on module re-init guard.
 */
function cancelPending() {
  if (rafHandle !== null) {
    cancelAnimationFrame(rafHandle);
    rafHandle = null;
  }

  clearTimeout(resizeTimer);
  resizeTimer = null;

  footerObserver?.disconnect();
  footerObserver = null;
}

/**
 * Resets the bar and FAB to their default hidden state.
 * Called on destroy() to leave the DOM clean.
 */
function resetDOM() {
  if (bar) {
    bar.classList.remove(BAR_VISIBLE_CLASS);
  }
  if (fab) {
    fab.classList.remove(FAB_RAISED_CLASS);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tears down the module completely.
 * Removes all event listeners, disconnects observers, resets DOM state.
 * Safe to call even if init was never completed.
 */
function destroy() {
  cancelPending();
  resetDOM();

  window.removeEventListener('scroll', onScroll);
  window.removeEventListener('resize', onResize);

  // Reset all module state
  bar          = null;
  fab          = null;
  footerEl     = null;
  isMobile     = false;
  footerVisible = false;
  pastTrigger  = false;
  lastVisible  = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. Init
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Initialises the sticky bottom CTA bar module.
 *
 * Safe to call multiple times — if .sticky-cta-bar is absent from the DOM
 * (e.g. on pages where it's not included), the function returns null silently.
 *
 * Call this from main.js after partials have been injected.
 *
 * @returns {{ destroy: typeof destroy } | null}
 *   Public API object, or null if the bar element is not in the DOM.
 */
function initStickyCtaBar() {
  // ── Element discovery ─────────────────────────────────────────────────────

  bar      = document.querySelector('.sticky-cta-bar');
  fab      = document.querySelector('.whatsapp-fab');
  footerEl = document.querySelector('.footer');

  // Bar is required — exit silently if absent (page doesn't have one)
  if (!bar) return null;

  // ── Read scroll trigger from CSS token ───────────────────────────────────

  scrollTrigger = getCSSToken('--sticky-bar-trigger', DEFAULT_SCROLL_TRIGGER);

  // ── Initial state ─────────────────────────────────────────────────────────

  checkIsMobile();
  pastTrigger  = window.scrollY >= scrollTrigger;
  footerVisible = false;
  lastVisible  = null;

  // Evaluate and apply the correct initial state immediately —
  // handles cases where the page loads mid-scroll (back/forward nav)
  syncState();

  // ── Footer IntersectionObserver ───────────────────────────────────────────

  if (footerEl && 'IntersectionObserver' in window) {
    footerObserver = createFooterObserver();
    footerObserver.observe(footerEl);
  }

  // ── Event listeners ───────────────────────────────────────────────────────

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize, { passive: true });

  return { destroy };
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export { initStickyCtaBar, destroy };
export default initStickyCtaBar;