/**
 * mobile-menu.js
 * Jyotish Maarg — Mobile Menu Module
 *
 * Responsibilities (this module only):
 *   1. Hamburger toggle — open / close the full-screen overlay
 *   2. Body scroll lock with scrollbar-width compensation
 *   3. Escape key close
 *   4. Focus trap — Tab and Shift+Tab cycle within the overlay
 *   5. Services accordion — expand / collapse the submenu
 *   6. Resize guard — auto-close when viewport crosses desktop breakpoint
 *   7. Accessibility — aria-expanded, aria-hidden, aria-controls, role, live region
 *
 * Out of scope (handled by navbar.js):
 *   - Scroll-triggered navbar transparency
 *   - Mega-menu hover on desktop
 *   - Active link detection
 *   - Mouse vs keyboard detection
 *
 * CSS classes consumed:
 *   .mobile-menu              — the overlay panel
 *   .mobile-menu--open        — open state (added/removed by this module)
 *   body.mobile-menu-open     — scroll lock + scrollbar compensation
 *   .navbar__hamburger        — the toggle button in the navbar
 *   .mobile-menu__close       — close button inside the overlay
 *   .mobile-menu__nav-link    — top-level nav links (incl. Services trigger)
 *   .mobile-menu__submenu     — the services accordion panel
 *   .mobile-menu__submenu--open — expanded state for the accordion
 *
 * Integrates with navbar.js via the public API:
 *   navbarAPI.lockSolid()   — called on open
 *   navbarAPI.unlockSolid() — called on close
 *
 * @module mobile-menu
 */

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Breakpoint (px) above which the mobile menu should never be open. */
const DESKTOP_BREAKPOINT = 1024;

/**
 * CSS transition duration (ms) on .mobile-menu matching --duration-slow.
 * Used to defer focus management until after the enter animation completes.
 */
const OPEN_TRANSITION_MS = 400;

/**
 * Selectors for all naturally focusable elements.
 * Ordered so Tab cycles in DOM order.
 */
const FOCUSABLE_SELECTORS = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(', ');

// ─────────────────────────────────────────────────────────────────────────────
// Module state
// ─────────────────────────────────────────────────────────────────────────────

/** @type {HTMLElement|null} */
let overlay = null;

/** @type {HTMLElement|null} */
let hamburger = null;

/** @type {HTMLElement|null} */
let closeBtn = null;

/** @type {HTMLElement|null} The element that had focus before the menu opened. */
let previouslyFocused = null;

/** @type {boolean} */
let isOpen = false;

/** @type {number|null} rAF handle for scrollbar-width measurement. */
let measureRaf = null;

/** @type {number|null} setTimeout handle for post-open focus. */
let focusTimer = null;

/** @type {number|null} setTimeout handle for resize debounce. */
let resizeTimer = null;

/**
 * Reference to navbar.js public API.
 * Injected via init(navbarAPI) — null-safe throughout.
 * @type {{ lockSolid: Function, unlockSolid: Function }|null}
 */
let navbarAPI = null;

// ─────────────────────────────────────────────────────────────────────────────
// 1. Scrollbar width measurement
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Measures the browser's scrollbar width and writes it to
 * `--scrollbar-width` on <body> so CSS can compensate when
 * `overflow: hidden` is applied (prevents layout shift).
 *
 * Runs once in a rAF to avoid forced layout on init.
 */
function measureScrollbarWidth() {
  if (measureRaf !== null) return;

  measureRaf = requestAnimationFrame(() => {
    measureRaf = null;
    const width = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.setProperty('--scrollbar-width', `${Math.max(0, width)}px`);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Scroll lock
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Locks body scroll while the overlay is open.
 * Compensates for scrollbar disappearance using the measured --scrollbar-width.
 * CSS rule: `body.mobile-menu-open { overflow: hidden; padding-right: var(--scrollbar-width, 0); }`
 */
function lockBodyScroll() {
  document.body.classList.add('mobile-menu-open');
}

/**
 * Restores body scroll when the overlay closes.
 */
function unlockBodyScroll() {
  document.body.classList.remove('mobile-menu-open');
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Focus trap
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns a live NodeList of all currently focusable elements inside the overlay.
 * Re-queried each time because the submenu accordion adds/removes tabbable items.
 *
 * @returns {HTMLElement[]}
 */
function getFocusableElements() {
  if (!overlay) return [];
  return Array.from(overlay.querySelectorAll(FOCUSABLE_SELECTORS)).filter(
    (el) => !el.closest('[hidden]') && el.offsetParent !== null
  );
}

/**
 * Traps Tab focus within the overlay.
 * - Tab on the last element wraps to the first.
 * - Shift+Tab on the first element wraps to the last.
 *
 * @param {KeyboardEvent} e
 */
function trapFocus(e) {
  if (!isOpen || e.key !== 'Tab') return;

  const focusable = getFocusableElements();
  if (focusable.length === 0) return;

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;

  if (e.shiftKey) {
    // Shift+Tab: if on first element, wrap to last
    if (active === first || !overlay.contains(active)) {
      e.preventDefault();
      last.focus();
    }
  } else {
    // Tab: if on last element, wrap to first
    if (active === last || !overlay.contains(active)) {
      e.preventDefault();
      first.focus();
    }
  }
}

/**
 * Moves focus to the close button after the open animation completes.
 * Deferred by OPEN_TRANSITION_MS to avoid interrupting the CSS transition.
 */
function focusCloseButton() {
  clearTimeout(focusTimer);
  focusTimer = setTimeout(() => {
    const target = closeBtn || getFocusableElements()[0];
    target?.focus();
  }, OPEN_TRANSITION_MS);
}

/**
 * Restores focus to the element that was focused before the menu opened.
 * Falls back to the hamburger button if the previous element is gone.
 */
function restoreFocus() {
  clearTimeout(focusTimer);
  const target =
    previouslyFocused instanceof HTMLElement && document.contains(previouslyFocused)
      ? previouslyFocused
      : hamburger;
  target?.focus();
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Open / close
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Opens the mobile menu overlay.
 * - Adds CSS open class and ARIA states
 * - Locks body scroll
 * - Notifies navbar.js
 * - Traps focus after animation
 */
function open() {
  if (isOpen) return;
  isOpen = true;

  // Remember what had focus so we can restore it on close
  previouslyFocused = document.activeElement;

  // CSS transition
  overlay.classList.add('mobile-menu--open');

  // ARIA
  overlay.setAttribute('aria-hidden', 'false');
  hamburger?.setAttribute('aria-expanded', 'true');

  // Scroll lock
  lockBodyScroll();

  // Navbar API
  navbarAPI?.lockSolid();

  // Keyboard trap + focus management
  document.addEventListener('keydown', onKeyDown);
  focusCloseButton();

  // Announce to screen readers
  overlay.removeAttribute('inert');
}

/**
 * Closes the mobile menu overlay.
 * - Removes CSS open class and ARIA states
 * - Unlocks body scroll
 * - Notifies navbar.js
 * - Restores focus to trigger element
 * - Collapses any open submenu
 */
function close() {
  if (!isOpen) return;
  isOpen = false;

  // CSS transition
  overlay.classList.remove('mobile-menu--open');

  // ARIA
  overlay.setAttribute('aria-hidden', 'true');
  hamburger?.setAttribute('aria-expanded', 'false');

  // Scroll lock
  unlockBodyScroll();

  // Navbar API
  navbarAPI?.unlockSolid();

  // Remove keyboard trap
  document.removeEventListener('keydown', onKeyDown);

  // Collapse open submenus so they don't reopen unexpectedly
  collapseAllSubmenus();

  // Restore focus
  restoreFocus();

  // Block assistive tech from reading the hidden panel
  overlay.setAttribute('inert', '');
}

/**
 * Toggles the overlay open / closed.
 */
function toggle() {
  isOpen ? close() : open();
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Services accordion
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Expands a submenu panel.
 *
 * @param {HTMLElement} trigger — the nav link with aria-expanded
 * @param {HTMLElement} submenu — the .mobile-menu__submenu panel
 */
function expandSubmenu(trigger, submenu) {
  submenu.classList.add('mobile-menu__submenu--open');
  trigger.setAttribute('aria-expanded', 'true');
  submenu.removeAttribute('hidden');

  // Make submenu items tabbable
  submenu.querySelectorAll('a, button').forEach((el) => {
    el.removeAttribute('tabindex');
  });
}

/**
 * Collapses a submenu panel.
 *
 * @param {HTMLElement} trigger
 * @param {HTMLElement} submenu
 */
function collapseSubmenu(trigger, submenu) {
  submenu.classList.remove('mobile-menu__submenu--open');
  trigger.setAttribute('aria-expanded', 'false');

  // Remove submenu items from tab order while collapsed
  submenu.querySelectorAll('a, button').forEach((el) => {
    el.setAttribute('tabindex', '-1');
  });
}

/**
 * Collapses all open submenus in the overlay.
 * Called when the overlay closes so state is clean on next open.
 */
function collapseAllSubmenus() {
  if (!overlay) return;

  overlay
    .querySelectorAll('.mobile-menu__nav-link[aria-expanded="true"]')
    .forEach((trigger) => {
      const submenu = getSubmenuForTrigger(trigger);
      if (submenu) collapseSubmenu(trigger, submenu);
    });
}

/**
 * Resolves the controlled submenu element for a given accordion trigger.
 * Uses aria-controls first, then falls back to the next sibling element.
 *
 * @param {HTMLElement} trigger
 * @returns {HTMLElement|null}
 */
function getSubmenuForTrigger(trigger) {
  const controlsId = trigger.getAttribute('aria-controls');
  if (controlsId) {
    return document.getElementById(controlsId);
  }
  // Fallback: next sibling within the same nav item
  return trigger.nextElementSibling?.classList.contains('mobile-menu__submenu')
    ? trigger.nextElementSibling
    : null;
}

/**
 * Handles accordion toggle clicks on nav links that control a submenu.
 *
 * @param {HTMLElement} trigger
 */
function handleAccordionToggle(trigger) {
  const submenu = getSubmenuForTrigger(trigger);
  if (!submenu) return;

  const isExpanded = trigger.getAttribute('aria-expanded') === 'true';

  // Collapse any other open submenu first (only one open at a time)
  overlay
    .querySelectorAll('.mobile-menu__nav-link[aria-expanded="true"]')
    .forEach((otherTrigger) => {
      if (otherTrigger === trigger) return;
      const otherSubmenu = getSubmenuForTrigger(otherTrigger);
      if (otherSubmenu) collapseSubmenu(otherTrigger, otherSubmenu);
    });

  if (isExpanded) {
    collapseSubmenu(trigger, submenu);
  } else {
    expandSubmenu(trigger, submenu);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Keyboard handler
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Global keyboard handler — active only while the overlay is open.
 *
 * Handles:
 *   Escape → close the overlay
 *   Tab    → trap focus within the overlay
 *
 * @param {KeyboardEvent} e
 */
function onKeyDown(e) {
  switch (e.key) {
    case 'Escape':
      e.preventDefault();
      close();
      break;

    case 'Tab':
      trapFocus(e);
      break;

    default:
      break;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Event binding
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Binds the hamburger button click — toggles the overlay.
 */
function bindHamburger() {
  if (!hamburger || hamburger.dataset.mobileMenuBound) return;
  hamburger.dataset.mobileMenuBound = 'true';

  hamburger.addEventListener('click', (e) => {
    e.stopPropagation();
    toggle();
  });
}

/**
 * Binds the close button inside the overlay.
 */
function bindCloseButton() {
  if (!closeBtn || closeBtn.dataset.mobileMenuBound) return;
  closeBtn.dataset.mobileMenuBound = 'true';

  closeBtn.addEventListener('click', close);
}

/**
 * Binds click events on nav links inside the overlay.
 *
 * - Links with aria-controls or aria-expanded → accordion toggle (no navigation)
 * - All other links → close the overlay then navigate normally
 *
 * Uses event delegation on the overlay for efficiency and
 * to handle dynamically injected items.
 */
function bindNavLinks() {
  if (!overlay || overlay.dataset.navLinksBound) return;
  overlay.dataset.navLinksBound = 'true';

  overlay.addEventListener('click', (e) => {
    const link = e.target.closest('.mobile-menu__nav-link');
    if (!link) return;

    const isAccordionTrigger =
      link.hasAttribute('aria-controls') ||
      link.getAttribute('aria-expanded') !== null;

    if (isAccordionTrigger) {
      e.preventDefault();
      handleAccordionToggle(link);
      return;
    }

    // Regular navigation link — close overlay, let browser navigate
    close();
  });

  // Submenu item clicks also close the overlay
  overlay.addEventListener('click', (e) => {
    if (e.target.closest('.mobile-menu__submenu-item')) {
      close();
    }
  });

  // Footer CTA and WhatsApp links — close overlay
  overlay.addEventListener('click', (e) => {
    if (
      e.target.closest('.mobile-menu__cta') ||
      e.target.closest('.mobile-menu__whatsapp') ||
      e.target.closest('.mobile-menu__contact-link') ||
      e.target.closest('.mobile-menu__secondary-link')
    ) {
      close();
    }
  });
}

/**
 * Binds keyboard navigation within accordion submenus.
 * Arrow Up / Arrow Down move focus between sibling submenu items.
 * Escape collapses the submenu and returns focus to its trigger.
 */
function bindSubmenuKeyboard() {
  if (!overlay || overlay.dataset.submenuKeysBound) return;
  overlay.dataset.submenuKeysBound = 'true';

  overlay.addEventListener('keydown', (e) => {
    if (!['ArrowUp', 'ArrowDown', 'Escape'].includes(e.key)) return;

    const item = e.target.closest('.mobile-menu__submenu-item');
    const submenu = e.target.closest('.mobile-menu__submenu');

    if (!submenu) return;

    const items = Array.from(submenu.querySelectorAll('.mobile-menu__submenu-item'));
    const idx = items.indexOf(item ?? document.activeElement);

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(idx + 1) % items.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(idx - 1 + items.length) % items.length]?.focus();
    } else if (e.key === 'Escape') {
      // Collapse submenu and return focus to its trigger
      const controlledById = submenu.id;
      const trigger = controlledById
        ? overlay.querySelector(`[aria-controls="${controlledById}"]`)
        : submenu.previousElementSibling?.classList.contains('mobile-menu__nav-link')
          ? submenu.previousElementSibling
          : null;

      if (trigger) {
        const sm = getSubmenuForTrigger(trigger);
        if (sm) collapseSubmenu(trigger, sm);
        trigger.focus();
        // Prevent the global Escape handler from also closing the whole overlay
        e.stopPropagation();
      }
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. Resize guard
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Closes the overlay if the viewport widens past the desktop breakpoint
 * while the menu is open (e.g. device rotation, window resize on tablet).
 */
function onResize() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (isOpen && window.innerWidth >= DESKTOP_BREAKPOINT) {
      close();
    }
  }, 150);
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. ARIA initialisation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sets the initial ARIA state of the overlay and hamburger.
 * Run once on init — JS-enhanced state; the HTML should already have
 * sensible defaults (aria-hidden="true" on overlay, aria-expanded="false"
 * on hamburger), but this ensures correctness even if the markup is minimal.
 */
function initAria() {
  if (!overlay || !hamburger) return;

  // Overlay
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', overlay.getAttribute('aria-label') || 'Site navigation');
  overlay.setAttribute('aria-hidden', 'true');
  overlay.setAttribute('inert', '');

  // Hamburger
  if (!hamburger.getAttribute('aria-controls') && overlay.id) {
    hamburger.setAttribute('aria-controls', overlay.id);
  }
  hamburger.setAttribute('aria-expanded', 'false');
  if (!hamburger.getAttribute('aria-label')) {
    hamburger.setAttribute('aria-label', 'Open navigation menu');
  }

  // Close button
  if (closeBtn && !closeBtn.getAttribute('aria-label')) {
    closeBtn.setAttribute('aria-label', 'Close navigation menu');
  }

  // Initialise submenus: ensure collapsed items are out of tab order
  overlay
    .querySelectorAll('.mobile-menu__nav-link[aria-expanded="false"]')
    .forEach((trigger) => {
      const submenu = getSubmenuForTrigger(trigger);
      if (submenu) {
        submenu.querySelectorAll('a, button').forEach((el) => {
          el.setAttribute('tabindex', '-1');
        });
      }
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// 10. Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Programmatically opens the mobile menu.
 * Exposed for use by other modules (e.g. a page-level shortcut).
 */
function openMenu() {
  open();
}

/**
 * Programmatically closes the mobile menu.
 * Exposed for use by other modules.
 */
function closeMenu() {
  close();
}

/**
 * Returns whether the menu is currently open.
 * @returns {boolean}
 */
function isMenuOpen() {
  return isOpen;
}

// ─────────────────────────────────────────────────────────────────────────────
// 11. Init / Destroy
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Initialises the mobile menu module.
 *
 * Expected DOM:
 *   .navbar__hamburger          — toggle button in the sticky navbar
 *   .mobile-menu                — full-screen overlay panel
 *   .mobile-menu__close         — close button inside the overlay
 *   .mobile-menu__nav-link      — top-level links (Services link has aria-controls)
 *   .mobile-menu__submenu       — services accordion panel
 *
 * @param {{ lockSolid?: Function, unlockSolid?: Function }|null} [api]
 *   Optional navbar.js public API for solid-state coordination.
 *
 * @returns {{
 *   open: Function,
 *   close: Function,
 *   toggle: Function,
 *   isOpen: Function
 * } | null}
 *   Public API, or null if required DOM elements are absent.
 */
function init(api = null) {
  hamburger = document.querySelector('.navbar__hamburger');
  overlay   = document.querySelector('.mobile-menu');
  closeBtn  = overlay?.querySelector('.mobile-menu__close') ?? null;

  if (!hamburger || !overlay) {
    if (typeof process === 'undefined' || process?.env?.NODE_ENV !== 'production') {
      console.warn(
        '[mobile-menu.js] Required elements not found ' +
        '(.navbar__hamburger and/or .mobile-menu) — module not initialised.'
      );
    }
    return null;
  }

  navbarAPI = api ?? null;

  // One-time scrollbar measurement
  measureScrollbarWidth();

  // Set initial ARIA state
  initAria();

  // Bind all interaction handlers
  bindHamburger();
  bindCloseButton();
  bindNavLinks();
  bindSubmenuKeyboard();

  // Resize guard
  window.addEventListener('resize', onResize, { passive: true });

  return {
    open: openMenu,
    close: closeMenu,
    toggle,
    isOpen: isMenuOpen,
  };
}

/**
 * Tears down all event listeners and resets module state.
 * Useful for testing or SPA-style page transitions.
 */
function destroy() {
  // Force-close if open to restore scroll lock and ARIA state
  if (isOpen) close();

  document.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('resize', onResize);

  clearTimeout(focusTimer);
  clearTimeout(resizeTimer);
  focusTimer = null;
  resizeTimer = null;

  if (measureRaf !== null) {
    cancelAnimationFrame(measureRaf);
    measureRaf = null;
  }

  // Clear bound sentinels so init() can re-bind
  if (hamburger) delete hamburger.dataset.mobileMenuBound;
  if (overlay) {
    delete overlay.dataset.navLinksBound;
    delete overlay.dataset.submenuKeysBound;
  }
  if (closeBtn) delete closeBtn.dataset.mobileMenuBound;

  overlay          = null;
  hamburger        = null;
  closeBtn         = null;
  previouslyFocused = null;
  navbarAPI        = null;
  isOpen           = false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export { init, destroy, openMenu as open, closeMenu as close, toggle, isMenuOpen as isOpen };
export default init;