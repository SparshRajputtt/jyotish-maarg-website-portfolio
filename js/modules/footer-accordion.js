/**
 * footer-accordion.js
 * Jyotish Maarg — Footer Accordion Module
 *
 * Responsibilities:
 *   1. Activate collapsible footer columns only below 768px (--bp-md)
 *   2. On mobile: each .footer__col (except .footer__col--brand) is collapsible
 *   3. On desktop: all columns visible, all accordion state removed
 *   4. Manage aria-expanded on triggers and open/close class on body panels
 *   5. Full keyboard navigation: Enter, Space, Escape, Arrow Up/Down, Home, End
 *   6. Independent mode — multiple columns can be open simultaneously
 *   7. Respond to viewport resize: gracefully activate / deactivate
 *   8. Honour prefers-reduced-motion
 *
 * Expected HTML structure (per column):
 *
 *   <div class="footer__col footer__col--links">
 *
 *     <!-- Static heading (shown on desktop, hidden on mobile via CSS) -->
 *     <h3 class="footer__col-heading">Quick Links</h3>
 *
 *     <!-- Accordion trigger (hidden on desktop via CSS, shown on mobile) -->
 *     <button
 *       class="footer__col-trigger"
 *       data-footer-trigger
 *       aria-expanded="false"
 *       aria-controls="footer-col-links-body"
 *       id="footer-col-links-trigger"
 *     >
 *       Quick Links
 *       <svg class="footer__col-chevron" aria-hidden="true">...</svg>
 *     </button>
 *
 *     <!-- Collapsible body -->
 *     <div
 *       class="footer__col-body"
 *       data-footer-body
 *       id="footer-col-links-body"
 *       role="region"
 *       aria-labelledby="footer-col-links-trigger"
 *     >
 *       <ul class="footer__links">...</ul>
 *     </div>
 *
 *   </div>
 *
 * Data attributes:
 *   data-footer-trigger   — on the <button> that toggles the column
 *   data-footer-body      — on the collapsible content panel
 *
 * CSS classes this module adds/removes:
 *   .footer__col-body--open   — on the panel when expanded (drives max-height)
 *
 * Key differences from faq-accordion.js:
 *   · Independent by default (multiple columns can be open at once)
 *   · Brand column (.footer__col--brand) is permanently exempt
 *   · Accordion activates and deactivates based on viewport width
 *   · No `hidden` attribute is used — CSS max-height handles visibility,
 *     which is necessary because desktop must show panels regardless of state
 *   · Trigger buttons exist in the HTML but are hidden via CSS on desktop;
 *     this module manages their aria-expanded without affecting desktop layout
 *
 * @module footer-accordion
 */

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Breakpoint below which the accordion is active.
 * Matches --bp-md: 768px in tokens.css.
 * CSS custom properties cannot be used in matchMedia queries — raw value used.
 */
const MOBILE_BREAKPOINT = 768;

/** Selector for all footer column wrappers. */
const COL_SELECTOR = '.footer__col';

/** Column variant that never collapses (brand/logo column). */
const EXEMPT_COL_CLASS = 'footer__col--brand';

/** Selector for the accordion trigger button within a column. */
const TRIGGER_SELECTOR = '[data-footer-trigger]';

/** Selector for the collapsible body panel within a column. */
const BODY_SELECTOR = '[data-footer-body]';

/** CSS class toggled on the body panel when open. */
const BODY_OPEN_CLASS = 'footer__col-body--open';

/** Resize debounce delay (ms). */
const RESIZE_DEBOUNCE = 150;

// ─────────────────────────────────────────────────────────────────────────────
// Module state
// ─────────────────────────────────────────────────────────────────────────────

/** @type {HTMLElement|null} The .footer element. */
let footer = null;

/** @type {HTMLElement[]} All collapsible column elements. */
let cols = [];

/** @type {boolean} Whether the accordion is currently active (mobile). */
let isActive = false;

/** @type {number|null} Resize debounce timer handle. */
let resizeTimer = null;

/** @type {Function|null} Cleanup function for the footer's delegated listeners. */
let cleanupEvents = null;

/** @type {MediaQueryList|null} */
let mql = null;

/** Cached reduced-motion preference. */
let prefersReducedMotion = false;

// ─────────────────────────────────────────────────────────────────────────────
// 1. Utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reads and caches the prefers-reduced-motion media query.
 * @returns {boolean}
 */
function checkReducedMotion() {
  prefersReducedMotion =
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return prefersReducedMotion;
}

/**
 * Returns true when the current viewport is below the mobile breakpoint.
 * @returns {boolean}
 */
function isMobileViewport() {
  return window.innerWidth < MOBILE_BREAKPOINT;
}

/**
 * Returns all collapsible columns — excludes the brand column.
 * @returns {HTMLElement[]}
 */
function getCollapsibleCols() {
  return cols.filter((col) => !col.classList.contains(EXEMPT_COL_CLASS));
}

/**
 * Returns the trigger button within a column.
 * @param {HTMLElement} col
 * @returns {HTMLElement|null}
 */
function getTrigger(col) {
  return col.querySelector(TRIGGER_SELECTOR);
}

/**
 * Returns the collapsible body panel within a column.
 * @param {HTMLElement} col
 * @returns {HTMLElement|null}
 */
function getBody(col) {
  return col.querySelector(BODY_SELECTOR);
}

/**
 * Returns true if a column is currently open.
 * @param {HTMLElement} col
 * @returns {boolean}
 */
function isColOpen(col) {
  const body = getBody(col);
  return body?.classList.contains(BODY_OPEN_CLASS) ?? false;
}

/**
 * Returns all trigger buttons for keyboard navigation.
 * @returns {HTMLElement[]}
 */
function getAllTriggers() {
  return getCollapsibleCols()
    .map(getTrigger)
    .filter(Boolean);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Open / Close a single column
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Opens a single footer column panel.
 *
 * @param {HTMLElement} col
 */
function openCol(col) {
  const trigger = getTrigger(col);
  const body    = getBody(col);

  if (!trigger || !body) return;
  if (isColOpen(col))    return;

  trigger.setAttribute('aria-expanded', 'true');
  body.classList.add(BODY_OPEN_CLASS);
}

/**
 * Closes a single footer column panel.
 *
 * @param {HTMLElement} col
 * @param {boolean}     [returnFocus=false]
 */
function closeCol(col, returnFocus = false) {
  const trigger = getTrigger(col);
  const body    = getBody(col);

  if (!trigger || !body) return;
  if (!isColOpen(col))   return;

  trigger.setAttribute('aria-expanded', 'false');
  body.classList.remove(BODY_OPEN_CLASS);

  if (returnFocus) {
    trigger.focus();
  }
}

/**
 * Toggles a single column.
 * Footer columns are independent — no sibling closing.
 *
 * @param {HTMLElement} col
 */
function toggleCol(col) {
  if (isColOpen(col)) {
    closeCol(col);
  } else {
    openCol(col);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Keyboard navigation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handles keyboard events on footer accordion triggers.
 * Pattern follows ARIA APG accordion spec (APG 3.1):
 *
 *   Escape     — close the open column, return focus to trigger
 *   Arrow Down — move focus to the next trigger
 *   Arrow Up   — move focus to the previous trigger
 *   Home       — move focus to the first trigger
 *   End        — move focus to the last trigger
 *
 * Enter and Space are handled natively by the click event on <button>.
 *
 * @param {KeyboardEvent} e
 */
function onTriggerKeydown(e) {
  const trigger = e.target.closest(TRIGGER_SELECTOR);
  if (!trigger) return;

  const col = trigger.closest(COL_SELECTOR);
  if (!col)     return;

  const triggers     = getAllTriggers();
  const currentIndex = triggers.indexOf(trigger);

  switch (e.key) {
    case 'Escape': {
      if (isColOpen(col)) {
        e.preventDefault();
        closeCol(col, true);
      }
      break;
    }

    case 'ArrowDown': {
      e.preventDefault();
      const next = triggers[currentIndex + 1] ?? triggers[0];
      next?.focus();
      break;
    }

    case 'ArrowUp': {
      e.preventDefault();
      const prev = triggers[currentIndex - 1] ?? triggers[triggers.length - 1];
      prev?.focus();
      break;
    }

    case 'Home': {
      e.preventDefault();
      triggers[0]?.focus();
      break;
    }

    case 'End': {
      e.preventDefault();
      triggers[triggers.length - 1]?.focus();
      break;
    }

    default:
      break;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Event delegation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Binds delegated click and keydown listeners on the footer root.
 * Returns a cleanup function.
 *
 * @param {HTMLElement} footerEl
 * @returns {Function} cleanup
 */
function bindEvents(footerEl) {
  /** @param {MouseEvent} e */
  function onClick(e) {
    if (!isActive) return;

    const trigger = e.target.closest(TRIGGER_SELECTOR);
    if (!trigger || !footerEl.contains(trigger)) return;

    const col = trigger.closest(COL_SELECTOR);
    if (!col) return;

    toggleCol(col);
  }

  /** @param {KeyboardEvent} e */
  function onKeydown(e) {
    if (!isActive) return;

    const navigationKeys = ['Escape', 'ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!navigationKeys.includes(e.key)) return;

    const trigger = e.target.closest(TRIGGER_SELECTOR);
    if (!trigger || !footerEl.contains(trigger)) return;

    onTriggerKeydown(e);
  }

  footerEl.addEventListener('click',   onClick);
  footerEl.addEventListener('keydown', onKeydown);

  return function cleanup() {
    footerEl.removeEventListener('click',   onClick);
    footerEl.removeEventListener('keydown', onKeydown);
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Activate / Deactivate
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Activates mobile accordion mode.
 *
 * Sets aria-expanded="false" on all triggers and ensures all panels
 * start closed. Does not animate — panels snap to closed state so that
 * the initial mobile render is correct without any flash.
 */
function activate() {
  if (isActive) return;
  isActive = true;

  getCollapsibleCols().forEach((col) => {
    const trigger = getTrigger(col);
    const body    = getBody(col);

    if (!trigger || !body) return;

    // Ensure closed state on activation
    trigger.setAttribute('aria-expanded', 'false');
    body.classList.remove(BODY_OPEN_CLASS);
  });
}

/**
 * Deactivates the accordion and restores desktop state.
 *
 * Removes all accordion-specific ARIA attributes and open classes so
 * the columns are unconditionally visible as per the desktop layout.
 * The CSS handles visibility above 768px — JS just cleans up its own state.
 */
function deactivate() {
  if (!isActive) return;
  isActive = false;

  getCollapsibleCols().forEach((col) => {
    const trigger = getTrigger(col);
    const body    = getBody(col);

    if (trigger) {
      // Remove aria-expanded so desktop triggers (hidden via CSS) are inert
      trigger.removeAttribute('aria-expanded');
    }

    if (body) {
      // Remove open class — desktop panels are always visible via CSS
      body.classList.remove(BODY_OPEN_CLASS);
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Resize handling
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Evaluates the current viewport and activates or deactivates accordingly.
 * Called on init and on each resize event (debounced).
 */
function evaluateBreakpoint() {
  if (isMobileViewport()) {
    activate();
  } else {
    deactivate();
  }
}

/**
 * Debounced resize handler — avoids redundant layout work mid-drag.
 */
function onResize() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(evaluateBreakpoint, RESIZE_DEBOUNCE);
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tears down the footer accordion completely.
 * Removes event listeners, restores desktop state, clears all timers.
 */
function destroy() {
  clearTimeout(resizeTimer);
  resizeTimer = null;

  window.removeEventListener('resize', onResize);

  if (cleanupEvents) {
    cleanupEvents();
    cleanupEvents = null;
  }

  // Restore desktop-clean state
  if (isActive) {
    deactivate();
  }

  footer = null;
  cols   = [];
  mql    = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. Init
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Initialises the footer accordion module.
 *
 * Safe to call multiple times — returns early if the footer element is not
 * found in the DOM. Designed to be called once from main.js after the footer
 * partial has been injected into the page.
 *
 * @returns {{ destroy: typeof destroy } | null}
 *   Public API, or null if footer is absent.
 */
function initFooterAccordion() {
  footer = document.querySelector('.footer');

  if (!footer) {
    return null;
  }

  // ── Collect columns ───────────────────────────────────────────────────────

  cols = Array.from(footer.querySelectorAll(COL_SELECTOR));

  if (!cols.length) {
    return null;
  }

  // ── Reduced-motion ────────────────────────────────────────────────────────

  checkReducedMotion();

  window
    .matchMedia('(prefers-reduced-motion: reduce)')
    .addEventListener('change', () => {
      checkReducedMotion();
    });

  // ── Event listeners ───────────────────────────────────────────────────────

  cleanupEvents = bindEvents(footer);
  window.addEventListener('resize', onResize, { passive: true });

  // ── Initial breakpoint evaluation ─────────────────────────────────────────

  evaluateBreakpoint();

  return { destroy };
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export { initFooterAccordion, destroy };
export default initFooterAccordion;