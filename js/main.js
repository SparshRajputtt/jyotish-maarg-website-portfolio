/**
 * main.js
 * Jyotish Maarg — Global Entry Point
 *
 * Bootstraps every shared module for all Phase 1 pages. Page-specific modules
 * (home.js, about.js, book.js) are loaded separately via their own
 * <script type="module"> tags at the bottom of their respective pages.
 *
 * Responsibilities:
 *   1. Fetch and inject shared partials (navbar, footer) from sessionStorage cache
 *   2. Inject WhatsApp href into all .whatsapp-link elements
 *   3. Initialise all global JS modules after the DOM (and injected partials) are ready
 *   4. Guard each module init inside try/catch — one failure never blocks others
 *   5. Only initialise modules when their trigger elements exist in the DOM
 *   6. Handle mouse-vs-keyboard detection for focus ring suppression
 *
 * Module initialisation strategy:
 *   Always runs  — navbar, mobile-menu, sticky-cta-bar, back-to-top
 *   Conditional  — scroll-reveal, stats-counter, testimonial-carousel,
 *                  faq-accordion, footer-accordion, form-validation
 *
 * Load order:
 *   <script type="module" src="/js/main.js"></script>          ← every page
 *   <script type="module" src="/js/pages/[page].js"></script>  ← only if needed
 *
 * @module main
 */

// =============================================================================
// Imports — exact exported names from each module file
// =============================================================================

import { init as initNavbar }                     from './modules/navbar.js';
import { init as initMobileMenu }                 from './modules/mobile-menu.js';
import { init as initScrollReveal }               from './modules/scroll-reveal.js';
import { initStatsCounter }                       from './modules/stats-counter.js';
import { initTestimonialCarousel }                from './modules/testimonial-carousel.js';
import { initFaqAccordion }                       from './modules/faq-accordion.js';
import { initFooterAccordion }                    from './modules/footer-accordion.js';
import { initStickyCtaBar }                       from './modules/sticky-cta-bar.js';
import { initBackToTop }                          from './modules/back-to-top.js';
import { initFormValidation }                     from './modules/form-validation.js';


// =============================================================================
// Site-wide constants
// =============================================================================

/**
 * WhatsApp phone number (with country code, no '+' or spaces).
 * Change this once to update every WhatsApp CTA across the site.
 */
const WHATSAPP_NUMBER = '919XXXXXXXXX'; // ← Replace with real number before launch

/**
 * Pre-filled message shown in WhatsApp when a visitor taps any CTA.
 * Keep it short — it will be URL-encoded.
 */
const WHATSAPP_MESSAGE =
  'Namaste! I would like to book a consultation with Jyotish Maarg.';

/** Compiled WhatsApp deep-link base. */
const WHATSAPP_HREF =
  `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(WHATSAPP_MESSAGE)}`;

/** Partials base path. */
const PARTIALS_BASE = '/assets/partials';

/** sessionStorage keys for cached partials. */
const CACHE_KEYS = {
  navbar: 'jm_partial_navbar',
  footer: 'jm_partial_footer',
};

/** Development mode — logs module init details when true. */
const DEV = location.hostname === 'localhost' || location.hostname === '127.0.0.1';


// =============================================================================
// Utility helpers
// =============================================================================

/**
 * Logs a warning or error in development only.
 *
 * @param {string}    label   — module or operation name
 * @param {unknown}   error   — the caught value
 * @param {'warn'|'error'} [level='warn']
 */
function devLog(label, error, level = 'warn') {
  if (!DEV) return;
  const prefix = `[Jyotish Maarg / ${label}]`;
  if (level === 'error') {
    console.error(prefix, error);
  } else {
    console.warn(prefix, error);
  }
}

/**
 * Runs an initialisation function inside a try/catch so a single module
 * failure never prevents subsequent modules from running.
 *
 * @template T
 * @param {string}     label  — human-readable name for error messages
 * @param {() => T}    fn     — the init function to call
 * @returns {T | null}          return value of fn, or null on failure
 */
function safeInit(label, fn) {
  try {
    return fn();
  } catch (err) {
    devLog(label, err, 'error');
    return null;
  }
}

/**
 * Returns true if at least one element matching `selector` exists in the DOM.
 *
 * @param {string} selector
 * @returns {boolean}
 */
function exists(selector) {
  return document.querySelector(selector) !== null;
}


// =============================================================================
// 1. Partial injection (navbar + footer)
// =============================================================================

/**
 * Fetches an HTML partial, using sessionStorage as a cache to avoid
 * redundant network requests on subsequent same-session page visits.
 *
 * @param {string} url        — absolute or root-relative URL to the partial
 * @param {string} cacheKey   — sessionStorage key
 * @returns {Promise<string>} — resolved HTML string, or '' on failure
 */
async function fetchPartial(url, cacheKey) {
  const cached = sessionStorage.getItem(cacheKey);
  if (cached) return cached;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} — ${url}`);
    }

    const html = await response.text();
    try {
      sessionStorage.setItem(cacheKey, html);
    } catch {
      // sessionStorage full or unavailable — silently continue without caching
    }
    return html;
  } catch (err) {
    devLog('partial fetch', `Failed to load "${url}": ${err.message}`, 'warn');
    return '';
  }
}

/**
 * Injects HTML into a placeholder element.
 * If the placeholder does not exist the injection is silently skipped.
 *
 * @param {string} placeholderId  — id of the target element (without '#')
 * @param {string} html           — markup to inject
 */
function injectPartial(placeholderId, html) {
  if (!html) return;

  const placeholder = document.getElementById(placeholderId);
  if (!placeholder) return;

  // Use a DocumentFragment to parse and insert in one operation,
  // avoiding multiple reflows.
  const template = document.createElement('template');
  template.innerHTML = html;
  placeholder.replaceWith(template.content);
}

/**
 * Fetches and injects both navbar and footer partials in parallel.
 * Resolves when both injections are complete (or have safely failed).
 *
 * @returns {Promise<void>}
 */
async function loadPartials() {
  const [navbarHtml, footerHtml] = await Promise.all([
    fetchPartial(`${PARTIALS_BASE}/navbar.html`, CACHE_KEYS.navbar),
    fetchPartial(`${PARTIALS_BASE}/footer.html`, CACHE_KEYS.footer),
  ]);

  injectPartial('navbar-placeholder', navbarHtml);
  injectPartial('footer-placeholder', footerHtml);
}


// =============================================================================
// 2. WhatsApp link injection
// =============================================================================

/**
 * Sets the correct WhatsApp href on every .whatsapp-link and .whatsapp-fab
 * anchor in the document.
 *
 * This is called after partials are injected so navbar/footer links are
 * included. Safe to call multiple times — idempotent.
 */
function applyWhatsAppLinks() {
  const selectors = '.whatsapp-link, .whatsapp-fab, [data-whatsapp]';
  document.querySelectorAll(selectors).forEach((el) => {
    if (el instanceof HTMLAnchorElement) {
      el.href = WHATSAPP_HREF;
      // Ensure link opens in a new tab and is clearly marked for assistive tech
      el.setAttribute('target', '_blank');
      el.setAttribute('rel', 'noopener noreferrer');
    }
  });
}


// =============================================================================
// 3. Mouse-vs-keyboard detection
// =============================================================================

/**
 * Adds `.using-mouse` to <body> when a pointer device is in use so that
 * reset.css can suppress the focus ring for mouse users without hiding it
 * from keyboard users.
 *
 * Implemented once at the global level — no per-module duplication.
 */
function initInputModeDetection() {
  let usingMouse = false;

  function onPointerDown() {
    if (usingMouse) return;
    usingMouse = true;
    document.body.classList.add('using-mouse');
  }

  function onKeyDown() {
    if (!usingMouse) return;
    usingMouse = false;
    document.body.classList.remove('using-mouse');
  }

  document.addEventListener('pointerdown', onPointerDown);
  document.addEventListener('keydown', onKeyDown);
}


// =============================================================================
// 4. Module initialisation
// =============================================================================

/**
 * Initialises all global modules.
 * Called after DOMContentLoaded AND after partials have been injected,
 * so every module can query for navbar/footer elements reliably.
 */
function initModules() {

  // ── 4a. Navbar (always) ────────────────────────────────────────────────────
  // Returns { lockSolid, unlockSolid } — passed to mobile-menu below.

  const navbarAPI = safeInit('navbar', () => initNavbar());


  // ── 4b. Mobile Menu (always) ───────────────────────────────────────────────
  // Accepts the navbar API to coordinate the solid-state lock on open.

  safeInit('mobile-menu', () => initMobileMenu(navbarAPI));


  // ── 4c. Sticky CTA Bar (always — hides itself on desktop via CSS/JS) ───────

  safeInit('sticky-cta-bar', () => initStickyCtaBar());


  // ── 4d. Back-to-Top (always — exits silently if button absent) ─────────────

  safeInit('back-to-top', () => initBackToTop());


  // ── 4e. Scroll Reveal (conditional — requires at least one .reveal* element) ─

  if (exists('.reveal, .reveal--card, .reveal--fade, .reveal--scale, .reveal--left, .reveal--right, .reveal--line-y, .reveal--line-x, .connector-line, .star-rating')) {
    safeInit('scroll-reveal', () => initScrollReveal());
  }


  // ── 4f. Stats Counter (conditional — requires .stat-number elements) ────────

  if (exists('.stat-number')) {
    safeInit('stats-counter', () => initStatsCounter());
  }


  // ── 4g. Testimonial Carousel (conditional) ──────────────────────────────────

  if (exists('.testimonial-carousel')) {
    safeInit('testimonial-carousel', () => initTestimonialCarousel());
  }


  // ── 4h. FAQ Accordion (conditional) ────────────────────────────────────────

  if (exists('[data-accordion]')) {
    safeInit('faq-accordion', () => initFaqAccordion());
  }


  // ── 4i. Footer Accordion (conditional — requires footer columns) ─────────────
  // The module itself gates on viewport width; we only need to confirm the
  // footer markup is present.

  if (exists('.footer__col[data-footer-trigger], [data-footer-trigger]')) {
    safeInit('footer-accordion', () => initFooterAccordion());
  }


  // ── 4j. Form Validation (conditional — requires at least one <form>) ─────────

  if (exists('form')) {
    safeInit('form-validation', () => initFormValidation());
  }

}


// =============================================================================
// 5. Bootstrap sequence
// =============================================================================

/**
 * Main bootstrap function.
 *
 * Order matters:
 *   1. Inject partials (navbar HTML + footer HTML must exist before modules run)
 *   2. Apply WhatsApp links (includes links injected with partials)
 *   3. Initialise input-mode detection (no DOM dependencies)
 *   4. Initialise all modules
 */
async function bootstrap() {
  // Inject shared partials first — modules depend on the navbar/footer DOM.
  await loadPartials();

  // Populate WhatsApp links across the fully-assembled DOM.
  safeInit('whatsapp-links', () => applyWhatsAppLinks());

  // Mouse vs keyboard — global, no element dependencies.
  safeInit('input-mode-detection', () => initInputModeDetection());

  // Boot all modules now that the DOM is complete.
  initModules();
}

// Kick off on DOMContentLoaded. If the parser has already fired (e.g. the
// script was deferred and the event already dispatched), call immediately.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
  bootstrap();
}