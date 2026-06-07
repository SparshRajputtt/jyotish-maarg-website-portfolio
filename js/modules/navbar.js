/**
 * navbar.js
 * Jyotish Maarg — Navbar Module
 *
 * Responsibilities (this module only):
 *   1. Transparent → solid/blurred transition on scroll
 *   2. Topbar hide on scroll past trigger
 *   3. Active nav link detection via pathname matching
 *   4. Mega-menu open/close on hover (desktop) with intent delay
 *   5. Mouse-vs-keyboard detection (body.using-mouse) for focus rings
 *   6. Exposes a public API for mobile-menu.js to call when overlay opens
 *
 * Out of scope (handled by mobile-menu.js):
 *   - Hamburger toggle
 *   - Full-screen overlay open/close
 *   - Focus trap
 *   - Body scroll lock
 *
 * CSS classes this module adds/removes:
 *   .navbar--scrolled        scroll position > SCROLL_TRIGGER
 *   .navbar--solid           non-hero pages (always-solid variant)
 *   .navbar--menu-open       set by mobile-menu.js via exported API
 *   .navbar__nav-item--active  parent item of active link
 *   body.using-mouse         suppresses focus rings for pointer users
 *
 * @module navbar
 */

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Scroll distance (px) before the scrolled class is applied. */
const SCROLL_TRIGGER = 50;

/** Delay (ms) before a hovered mega-menu opens — prevents accidental triggers. */
const DROPDOWN_OPEN_DELAY = 150;

/** Delay (ms) before a mega-menu closes after pointer leaves. */
const DROPDOWN_CLOSE_DELAY = 300;

/** Breakpoint below which mega-menu hover is disabled (mobile-menu.js takes over). */
const DESKTOP_BREAKPOINT = 1024;

// ─────────────────────────────────────────────────────────────────────────────
// Module-level state
// ─────────────────────────────────────────────────────────────────────────────

/** @type {HTMLElement|null} */
let navbar = null;

/** @type {HTMLElement|null} */
let topbar = null;

/** @type {boolean} Whether the navbar is currently in scrolled state. */
let isScrolled = false;

/** @type {Map<HTMLElement, {openTimer: number|null, closeTimer: number|null}>} */
const dropdownTimers = new Map();

/** Cached scroll Y from last rAF tick — avoids redundant style writes. */
let lastScrollY = -1;

/** rAF handle for scroll handler throttle. */
let rafHandle = null;

// ─────────────────────────────────────────────────────────────────────────────
// 1. Scroll behaviour
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reads window.scrollY and updates navbar state exactly once per rAF.
 * Uses a dirty-check so classList mutations only happen when state changes.
 */
function onScroll() {
  if (rafHandle !== null) return;

  rafHandle = requestAnimationFrame(() => {
    rafHandle = null;

    const scrollY = window.scrollY;
    if (scrollY === lastScrollY) return;
    lastScrollY = scrollY;

    const shouldBeScrolled = scrollY > SCROLL_TRIGGER;

    if (shouldBeScrolled !== isScrolled) {
      isScrolled = shouldBeScrolled;
      navbar.classList.toggle('navbar--scrolled', isScrolled);

      // Collapse topbar when scrolled to reclaim vertical space
      if (topbar) {
        topbar.classList.toggle('topbar--hidden', isScrolled);
        // Shift navbar up to fill the topbar gap when topbar hides
        navbar.style.marginTop = isScrolled ? '0' : '';
      }
    }
  });
}

/**
 * Checks whether the page's hero section exists.
 * Non-hero pages (e.g. /contact, /about) should always have a solid navbar.
 *
 * @returns {boolean}
 */
function pageHasHero() {
  return document.querySelector('[data-hero], .hero, #hero') !== null;
}

/**
 * Applies the always-solid state for non-hero pages.
 * Called once on init; does not respond to scroll.
 */
function applyStaticSolidState() {
  navbar.classList.add('navbar--solid');
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Active link detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalises a URL pathname for comparison:
 *   - Strips trailing slash (except root "/")
 *   - Lowercases
 *
 * @param {string} path
 * @returns {string}
 */
function normalisePath(path) {
  const lower = path.toLowerCase();
  return lower.length > 1 ? lower.replace(/\/$/, '') : lower;
}

/**
 * Returns true if `linkPath` matches or is a prefix of `currentPath`.
 * Exact match for root "/"; prefix match for all other paths.
 *
 * Examples:
 *   isPathMatch('/services/career-astrology', '/services/career-astrology') → true
 *   isPathMatch('/services', '/services/career-astrology')                  → true (parent)
 *   isPathMatch('/', '/about')                                              → false
 *
 * @param {string} linkPath    Normalised href from nav link
 * @param {string} currentPath Normalised window.location.pathname
 * @returns {boolean}
 */
function isPathMatch(linkPath, currentPath) {
  if (linkPath === '/') return currentPath === '/';
  return currentPath === linkPath || currentPath.startsWith(linkPath + '/');
}

/**
 * Walks all nav links in both the desktop navbar and the mobile menu overlay,
 * sets aria-current="page" on exact matches, and adds .navbar__nav-item--active
 * to parent <li> elements that contain a matching link (for parent highlighting
 * when a child page is active — e.g. "Services" is active on any /services/* page).
 */
function markActiveLinks() {
  const current = normalisePath(window.location.pathname);

  // Query both desktop nav and mobile overlay nav
  const allNavLinks = document.querySelectorAll(
    '.navbar__nav-link, .mobile-menu__nav-link, .mobile-menu__submenu-item'
  );

  allNavLinks.forEach((link) => {
    const href = link.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) {
      return;
    }

    let linkPath;
    try {
      // Handle both absolute URLs and root-relative paths
      linkPath = normalisePath(new URL(href, window.location.origin).pathname);
    } catch {
      return;
    }

    const isActive = isPathMatch(linkPath, current);

    if (isActive) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }

    // Mark parent <li> for CSS styling (underline on "Services" when on a service page)
    const parentItem = link.closest('.navbar__nav-item');
    if (parentItem) {
      parentItem.classList.toggle('navbar__nav-item--active', isActive);
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Mega-menu hover management (desktop only)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true when the viewport is wide enough for the desktop mega-menu.
 * @returns {boolean}
 */
function isDesktop() {
  return window.innerWidth >= DESKTOP_BREAKPOINT;
}

/**
 * Opens the mega-menu attached to `navItem` after the intent delay.
 * Cancels any pending close timer for this item.
 *
 * @param {HTMLElement} navItem  — the .navbar__nav-item--has-dropdown element
 */
function openDropdown(navItem) {
  const timers = getTimers(navItem);

  // Cancel any in-flight close
  clearTimeout(timers.closeTimer);
  timers.closeTimer = null;

  if (navItem.getAttribute('aria-expanded') === 'true') return;

  timers.openTimer = setTimeout(() => {
    timers.openTimer = null;
    navItem.setAttribute('aria-expanded', 'true');

    const dropdown = navItem.querySelector('.navbar__dropdown');
    if (dropdown) {
      // Move focus to first focusable item when opened via keyboard (Enter/Space)
      // Hover-opened menus do not steal focus
    }
  }, DROPDOWN_OPEN_DELAY);
}

/**
 * Closes the mega-menu on `navItem` after the close delay.
 * Cancels any pending open timer.
 *
 * @param {HTMLElement} navItem
 */
function closeDropdown(navItem) {
  const timers = getTimers(navItem);

  clearTimeout(timers.openTimer);
  timers.openTimer = null;

  if (navItem.getAttribute('aria-expanded') !== 'true') return;

  timers.closeTimer = setTimeout(() => {
    timers.closeTimer = null;
    navItem.setAttribute('aria-expanded', 'false');
  }, DROPDOWN_CLOSE_DELAY);
}

/**
 * Closes a dropdown immediately with no delay (used on Escape keypress).
 *
 * @param {HTMLElement} navItem
 */
function closeDropdownImmediate(navItem) {
  const timers = getTimers(navItem);
  clearTimeout(timers.openTimer);
  clearTimeout(timers.closeTimer);
  timers.openTimer = null;
  timers.closeTimer = null;
  navItem.setAttribute('aria-expanded', 'false');
}

/**
 * Retrieves (or initialises) the timer state for a nav item.
 *
 * @param {HTMLElement} navItem
 * @returns {{ openTimer: number|null, closeTimer: number|null }}
 */
function getTimers(navItem) {
  if (!dropdownTimers.has(navItem)) {
    dropdownTimers.set(navItem, { openTimer: null, closeTimer: null });
  }
  return dropdownTimers.get(navItem);
}

/**
 * Binds hover and keyboard events to all dropdown-capable nav items.
 * Safe to call multiple times — event listeners are attached once via
 * a data attribute sentinel.
 */
function bindDropdownEvents() {
  const dropdownItems = navbar.querySelectorAll('.navbar__nav-item--has-dropdown');

  dropdownItems.forEach((item) => {
    if (item.dataset.dropdownBound) return;
    item.dataset.dropdownBound = 'true';

    const trigger = item.querySelector('.navbar__nav-link');
    const dropdown = item.querySelector('.navbar__dropdown');

    // ── Hover ─────────────────────────────────────────────────────────────

    item.addEventListener('mouseenter', () => {
      if (!isDesktop()) return;
      openDropdown(item);
    });

    item.addEventListener('mouseleave', () => {
      if (!isDesktop()) return;
      closeDropdown(item);
    });

    // Keep menu open when pointer moves into the panel itself
    if (dropdown) {
      dropdown.addEventListener('mouseenter', () => {
        if (!isDesktop()) return;
        openDropdown(item);
      });

      dropdown.addEventListener('mouseleave', () => {
        if (!isDesktop()) return;
        closeDropdown(item);
      });
    }

    // ── Keyboard ──────────────────────────────────────────────────────────

    if (trigger) {
      // Enter or Space on the trigger toggles the dropdown
      trigger.addEventListener('keydown', (e) => {
        if (!isDesktop()) return;

        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          const isOpen = item.getAttribute('aria-expanded') === 'true';
          if (isOpen) {
            closeDropdownImmediate(item);
            trigger.focus();
          } else {
            // Open immediately on keyboard (no intent delay)
            clearTimeout(getTimers(item).openTimer);
            item.setAttribute('aria-expanded', 'true');

            // Focus first item in dropdown
            const firstFocusable = dropdown?.querySelector('a, button');
            firstFocusable?.focus();
          }
        }

        if (e.key === 'Escape') {
          closeDropdownImmediate(item);
          trigger.focus();
        }
      });

      // Arrow Down on trigger focuses first dropdown item
      trigger.addEventListener('keydown', (e) => {
        if (!isDesktop() || e.key !== 'ArrowDown') return;
        e.preventDefault();
        if (item.getAttribute('aria-expanded') !== 'true') {
          item.setAttribute('aria-expanded', 'true');
        }
        const firstFocusable = dropdown?.querySelector('a, button');
        firstFocusable?.focus();
      });
    }

    // Escape anywhere within the item closes it
    item.addEventListener('keydown', (e) => {
      if (!isDesktop() || e.key !== 'Escape') return;
      closeDropdownImmediate(item);
      trigger?.focus();
    });

    // Tab out of the last item in the dropdown closes it
    if (dropdown) {
      const allFocusable = () =>
        Array.from(dropdown.querySelectorAll('a, button, [tabindex="0"]'));

      dropdown.addEventListener('keydown', (e) => {
        if (!isDesktop() || e.key !== 'Tab') return;
        const focusable = allFocusable();
        if (!focusable.length) return;

        const last = focusable[focusable.length - 1];
        const first = focusable[0];

        if (!e.shiftKey && document.activeElement === last) {
          closeDropdownImmediate(item);
        }
        if (e.shiftKey && document.activeElement === first) {
          closeDropdownImmediate(item);
          trigger?.focus();
          e.preventDefault();
        }
      });
    }
  });
}

/**
 * Closes all open dropdowns when user clicks outside the navbar.
 *
 * @param {MouseEvent} e
 */
function onDocumentClick(e) {
  if (!navbar.contains(e.target)) {
    navbar
      .querySelectorAll('.navbar__nav-item--has-dropdown[aria-expanded="true"]')
      .forEach(closeDropdownImmediate);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Mouse vs keyboard detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Adds body.using-mouse when a mouse button is pressed,
 * removes it when Tab is pressed. This gates focus-ring visibility
 * in reset.css: `body.using-mouse :focus { outline: none }`.
 *
 * Bound once at module init; harmless on re-init.
 */
function bindPointerDetection() {
  if (document.body.dataset.pointerDetectionBound) return;
  document.body.dataset.pointerDetectionBound = 'true';

  document.addEventListener('mousedown', () => {
    document.body.classList.add('using-mouse');
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      document.body.classList.remove('using-mouse');
    }
  });

  // Touch devices are mouse-like for focus-ring purposes
  document.addEventListener('touchstart', () => {
    document.body.classList.add('using-mouse');
  }, { passive: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Resize handling
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Closes all open dropdowns when resizing below the desktop breakpoint.
 * Uses a simple debounce — no need for ResizeObserver here.
 */
let resizeTimer = null;

function onResize() {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!isDesktop()) {
      navbar
        .querySelectorAll('.navbar__nav-item--has-dropdown[aria-expanded="true"]')
        .forEach(closeDropdownImmediate);
    }
  }, 150);
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Public API (consumed by mobile-menu.js)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Locks the navbar into its solid/opaque state while the mobile overlay is open.
 * Called by mobile-menu.js when the overlay opens.
 */
function lockSolid() {
  navbar?.classList.add('navbar--menu-open');
}

/**
 * Restores normal transparent/scrolled state when the mobile overlay closes.
 * Called by mobile-menu.js when the overlay closes.
 */
function unlockSolid() {
  navbar?.classList.remove('navbar--menu-open');
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Init
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Initialises the navbar module.
 *
 * Safe to call multiple times — early-returns if the navbar element
 * is not present in the DOM (e.g. page loaded without the partial).
 *
 * @returns {{ lockSolid: Function, unlockSolid: Function } | null}
 *   Public API for mobile-menu.js, or null if navbar is absent.
 */
function init() {
  navbar = document.querySelector('.navbar');
  topbar = document.querySelector('.topbar');

  if (!navbar) {
    if (process?.env?.NODE_ENV !== 'production') {
      console.warn('[navbar.js] .navbar element not found — module not initialised.');
    }
    return null;
  }

  // ── Scroll state ─────────────────────────────────────────────────────────

  if (pageHasHero()) {
    // Hero pages: start transparent, transition to solid on scroll
    // Seed the initial state in case the page loads mid-scroll (back/forward nav)
    lastScrollY = window.scrollY;
    isScrolled = lastScrollY > SCROLL_TRIGGER;
    navbar.classList.toggle('navbar--scrolled', isScrolled);

    window.addEventListener('scroll', onScroll, { passive: true });
  } else {
    // Non-hero pages: always solid
    applyStaticSolidState();
  }

  // ── Active links ──────────────────────────────────────────────────────────

  markActiveLinks();

  // ── Mega-menu ─────────────────────────────────────────────────────────────

  bindDropdownEvents();
  document.addEventListener('click', onDocumentClick);

  // ── Pointer detection ─────────────────────────────────────────────────────

  bindPointerDetection();

  // ── Resize ────────────────────────────────────────────────────────────────

  window.addEventListener('resize', onResize, { passive: true });

  // ── Expose public API ─────────────────────────────────────────────────────

  return { lockSolid, unlockSolid };
}

/**
 * Tears down all event listeners and resets module state.
 * Useful for testing or SPA-style page transitions.
 */
function destroy() {
  window.removeEventListener('scroll', onScroll);
  window.removeEventListener('resize', onResize);
  document.removeEventListener('click', onDocumentClick);

  dropdownTimers.forEach((timers) => {
    clearTimeout(timers.openTimer);
    clearTimeout(timers.closeTimer);
  });
  dropdownTimers.clear();

  if (rafHandle !== null) {
    cancelAnimationFrame(rafHandle);
    rafHandle = null;
  }

  clearTimeout(resizeTimer);
  resizeTimer = null;

  navbar = null;
  topbar = null;
  isScrolled = false;
  lastScrollY = -1;
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export { init, destroy, lockSolid, unlockSolid, markActiveLinks };
export default init;