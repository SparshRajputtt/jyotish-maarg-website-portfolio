/**
 * back-to-top.js
 * Jyotish Maarg - Back To Top Module
 *
 * Responsibilities:
 *   1. Show the back-to-top button after the user scrolls 600px
 *   2. Smoothly scroll to the top when activated
 *   3. Respect prefers-reduced-motion by using instant scroll behavior
 *   4. Keep the control accessible to keyboard and assistive technology users
 *   5. Exit silently when the button is not present on the page
 *
 * Expected HTML:
 *
 *   <button class="back-to-top" type="button" aria-label="Back to top">
 *     ...
 *   </button>
 *
 * Supported selectors:
 *   [data-back-to-top]
 *   .back-to-top
 *
 * CSS classes/attributes this module manages:
 *   .is-visible
 *   aria-hidden
 *   tabindex
 *
 * @module back-to-top
 */

const BUTTON_SELECTOR = '[data-back-to-top], .back-to-top';
const VISIBLE_CLASS = 'is-visible';
const SCROLL_TRIGGER = 600;
const TOP_POSITION = 0;

/** @type {HTMLElement|null} */
let button = null;

/** @type {MediaQueryList|null} */
let motionQuery = null;

/** @type {number|null} */
let rafHandle = null;

/** @type {boolean|null} */
let lastVisible = null;

/** @type {string|null} */
let originalTabIndex = null;

/**
 * Returns true when the user prefers reduced motion.
 *
 * @returns {boolean}
 */
function prefersReducedMotion() {
  return motionQuery?.matches ?? false;
}

/**
 * Sets the button's visible/hidden state and keeps the accessibility
 * attributes in sync with the visual state.
 *
 * @param {boolean} shouldBeVisible
 */
function setVisible(shouldBeVisible) {
  if (!button || shouldBeVisible === lastVisible) return;

  lastVisible = shouldBeVisible;
  button.classList.toggle(VISIBLE_CLASS, shouldBeVisible);
  button.setAttribute('aria-hidden', shouldBeVisible ? 'false' : 'true');

  if (shouldBeVisible) {
    if (originalTabIndex === null) {
      button.removeAttribute('tabindex');
    } else {
      button.setAttribute('tabindex', originalTabIndex);
    }
  } else {
    button.setAttribute('tabindex', '-1');
  }
}

/**
 * Reads scroll position in a requestAnimationFrame callback so frequent
 * scroll events do not cause unnecessary work.
 */
function onScroll() {
  if (rafHandle !== null) return;

  rafHandle = window.requestAnimationFrame(() => {
    rafHandle = null;
    setVisible(window.scrollY >= SCROLL_TRIGGER);
  });
}

/**
 * Scrolls to the top using smooth behavior unless reduced motion is enabled.
 *
 * @param {Event} event
 */
function onClick(event) {
  event.preventDefault();

  window.scrollTo({
    top: TOP_POSITION,
    left: 0,
    behavior: prefersReducedMotion() ? 'auto' : 'smooth',
  });
}

/**
 * Keeps scrolling behavior aligned if the OS motion preference changes while
 * the page is open.
 */
function onMotionPreferenceChange() {
  if (!button) return;
  setVisible(window.scrollY >= SCROLL_TRIGGER);
}

/**
 * Removes listeners and resets DOM state.
 * Safe to call even if the module was never fully initialised.
 */
function destroy() {
  if (rafHandle !== null) {
    window.cancelAnimationFrame(rafHandle);
    rafHandle = null;
  }

  window.removeEventListener('scroll', onScroll);
  button?.removeEventListener('click', onClick);

  if (motionQuery) {
    motionQuery.removeEventListener?.('change', onMotionPreferenceChange);
    motionQuery = null;
  }

  if (button) {
    button.classList.remove(VISIBLE_CLASS);
    button.setAttribute('aria-hidden', 'true');
    button.setAttribute('tabindex', '-1');
  }

  button = null;
  lastVisible = null;
  originalTabIndex = null;
}

/**
 * Initialises the back-to-top button.
 *
 * @returns {{ destroy: typeof destroy } | null}
 *   Public API object, or null when no button exists on the page.
 */
function initBackToTop() {
  button = document.querySelector(BUTTON_SELECTOR);
  if (!button) return null;

  if (!(button instanceof HTMLElement)) {
    button = null;
    return null;
  }

  destroy();
  button = document.querySelector(BUTTON_SELECTOR);
  if (!button || !(button instanceof HTMLElement)) return null;

  originalTabIndex = button.getAttribute('tabindex');
  motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  motionQuery.addEventListener?.('change', onMotionPreferenceChange);

  if (!button.hasAttribute('aria-label') && !button.hasAttribute('aria-labelledby')) {
    button.setAttribute('aria-label', 'Back to top');
  }

  setVisible(window.scrollY >= SCROLL_TRIGGER);

  window.addEventListener('scroll', onScroll, { passive: true });
  button.addEventListener('click', onClick);

  return { destroy };
}

export { initBackToTop, destroy };
export default initBackToTop;
