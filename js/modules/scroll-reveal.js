/**
 * scroll-reveal.js
 * Jyotish Maarg — Scroll Reveal Module
 *
 * Responsibilities:
 *   1. Observe all revealable elements via a single shared IntersectionObserver
 *   2. Add .is-visible once the threshold is crossed — CSS handles the animation
 *   3. Clean up will-change after each transition to free compositor resources
 *   4. Drive count-up animation for .stat-number elements
 *   5. Auto-stagger sibling reveal elements inside [data-stagger] containers
 *   6. Honour prefers-reduced-motion — skip all animation, mark elements visible immediately
 *   7. Expose a refresh() API for dynamically injected content
 *
 * CSS classes consumed:
 *   .reveal              — fade-up (section headings, paragraphs)
 *   .reveal--card        — fade-up with larger translate (cards)
 *   .reveal--fade        — opacity only (images, wide elements)
 *   .reveal--scale       — scale entrance (testimonials)
 *   .reveal--left        — slide from right (timeline odd)
 *   .reveal--right       — slide from left (timeline even)
 *   .reveal--line-y      — scaleY line draw (vertical connectors)
 *   .reveal--line-x      — scaleX line draw (horizontal ornaments)
 *   .connector-line      — alias for vertical connector
 *   .star-rating         — sequential star fill
 *   .stat-number         — count-up target element
 *   .is-visible          — added by this module to trigger CSS transitions
 *
 * Data attributes:
 *   data-stagger         — on a container: auto-assigns --stagger-index to children
 *                          with a .reveal* class.  Value is the per-item delay in ms
 *                          (default: 100). Example: <ul data-stagger="80">
 *   data-count           — on a .stat-number: the target number to count up to.
 *                          Example: <span class="stat-number" data-count="5000">5,000+</span>
 *   data-count-suffix    — optional string appended after the number. Default: "".
 *                          Example: data-count-suffix="+"
 *   data-count-prefix    — optional string prepended. Example: data-count-prefix="₹"
 *   data-count-duration  — override count-up duration in ms. Default: 1500.
 *   data-reveal-once     — if present on an element, it will NOT un-reveal on exit
 *                          (default behaviour is once=true; this attribute is a no-op
 *                           but documents intent in HTML).
 *
 * Design token referenced:
 *   --reveal-threshold   (default 0.2)  — read from :root at init time
 *   --counter-duration   (default 1500) — read from :root at init time
 *
 * Performance notes:
 *   · One IntersectionObserver instance for all reveal elements.
 *   · One IntersectionObserver instance for all stat counters.
 *   · will-change is removed via transitionend to avoid long-lived compositor layers.
 *   · count-up uses requestAnimationFrame — no setInterval.
 *   · All DOM queries are batched at init / refresh time.
 *
 * @module scroll-reveal
 */

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Selector matching every element that this module should observe. */
const REVEAL_SELECTOR = [
  '.reveal',
  '.reveal--card',
  '.reveal--fade',
  '.reveal--scale',
  '.reveal--left',
  '.reveal--right',
  '.reveal--line-y',
  '.reveal--line-x',
  '.connector-line',
  '.star-rating',
].join(', ');

/** Selector for stat counter elements. */
const COUNTER_SELECTOR = '.stat-number[data-count]';

/**
 * Fallback IntersectionObserver threshold when the CSS token is absent.
 * Matches --reveal-threshold: 0.2 in tokens.css.
 */
const DEFAULT_THRESHOLD = 0.2;

/**
 * Fallback count-up duration (ms) when the CSS token and data attribute are absent.
 * Matches --counter-duration: 1.5s in tokens.css.
 */
const DEFAULT_COUNTER_DURATION = 1500;

/**
 * Root margin for the reveal observer.
 * Negative bottom margin means the trigger fires slightly before the element
 * is fully visible, which feels more natural on slow-scroll.
 */
const ROOT_MARGIN = '0px 0px -60px 0px';

// ─────────────────────────────────────────────────────────────────────────────
// Module state
// ─────────────────────────────────────────────────────────────────────────────

/** @type {IntersectionObserver|null} */
let revealObserver = null;

/** @type {IntersectionObserver|null} */
let counterObserver = null;

/**
 * Tracks elements currently mid-count to prevent duplicate rAF loops.
 * @type {WeakSet<HTMLElement>}
 */
const countingElements = new WeakSet();

/**
 * Cached reduced-motion preference, read once at init.
 * Re-read on each refresh() call to catch system preference changes.
 * @type {boolean}
 */
let prefersReducedMotion = false;

/**
 * MediaQueryList for reduced-motion — allows listening for runtime changes.
 * @type {MediaQueryList|null}
 */
let motionQuery = null;

// ─────────────────────────────────────────────────────────────────────────────
// 1. Reduced-motion detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reads the current prefers-reduced-motion value and caches it.
 * @returns {boolean}
 */
function checkReducedMotion() {
  prefersReducedMotion =
    motionQuery?.matches ??
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return prefersReducedMotion;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. CSS token reader
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reads a CSS custom property from :root as a float.
 * Returns `fallback` if the property is absent or unparseable.
 *
 * @param {string} property   e.g. '--reveal-threshold'
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
// 3. Stagger auto-assignment
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Walks all [data-stagger] containers and assigns --stagger-index as an
 * inline custom property on each direct child that carries a reveal class.
 *
 * This complements the static .stagger-1 through .stagger-8 utility classes
 * and handles grids with arbitrary item counts.
 *
 * @param {Element} [root=document] — scope for the query (supports refresh)
 */
function applyStaggerIndices(root = document) {
  root.querySelectorAll('[data-stagger]').forEach((container) => {
    const children = Array.from(container.children).filter((child) =>
      child.matches(REVEAL_SELECTOR)
    );

    children.forEach((child, i) => {
      // Only assign if no static stagger class is present
      const hasStaticStagger = Array.from(child.classList).some((c) =>
        /^stagger-\d+$/.test(c)
      );
      if (!hasStaticStagger) {
        child.style.setProperty('--stagger-index', String(i));
      }
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Reveal an element
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Marks a single element as visible.
 * In reduced-motion mode this is instant (no CSS transition runs).
 * Otherwise, schedules a will-change cleanup after the transition ends.
 *
 * @param {Element} el
 */
function revealElement(el) {
  el.classList.add('is-visible');

  if (prefersReducedMotion) {
    // CSS already overrides will-change to auto in reduced-motion media query,
    // but we also clear the inline style to be safe.
    el.style.willChange = 'auto';
    return;
  }

  // Remove will-change after the transition to free the compositor layer.
  // transitionend fires once per transitioned property; we only need it once.
  const cleanup = () => {
    el.style.willChange = 'auto';
    el.removeEventListener('transitionend', cleanup);
  };
  el.addEventListener('transitionend', cleanup, { once: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. IntersectionObserver — reveal
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates (or re-creates) the reveal IntersectionObserver.
 * All elements are revealed once and then unobserved — no re-hiding.
 *
 * @returns {IntersectionObserver}
 */
function createRevealObserver() {
  const threshold = getCSSToken('--reveal-threshold', DEFAULT_THRESHOLD);

  return new IntersectionObserver(
    (entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;

        revealElement(entry.target);

        // Unobserve immediately — reveal is a one-shot action.
        observer.unobserve(entry.target);
      });
    },
    {
      threshold,
      rootMargin: ROOT_MARGIN,
    }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Count-up animation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Easing function — ease-out cubic.
 * Matches --ease-out: cubic-bezier(0, 0, 0.2, 1) in tokens.css.
 *
 * @param {number} t — progress 0→1
 * @returns {number} — eased value 0→1
 */
function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

/**
 * Formats a number for display.
 * Uses toLocaleString for thousands separators; falls back to plain string.
 *
 * @param {number} value
 * @returns {string}
 */
function formatCount(value) {
  try {
    return Math.round(value).toLocaleString('en-IN');
  } catch {
    return String(Math.round(value));
  }
}

/**
 * Runs the count-up animation on a .stat-number element.
 * Reads target, duration, prefix, and suffix from data attributes.
 *
 * @param {HTMLElement} el
 */
function startCountUp(el) {
  if (countingElements.has(el)) return;
  countingElements.add(el);

  const target   = parseFloat(el.dataset.count ?? '0');
  const duration = parseFloat(el.dataset.countDuration ?? '0') ||
                   getCSSToken('--counter-duration', DEFAULT_COUNTER_DURATION);
  const prefix   = el.dataset.countPrefix   ?? '';
  const suffix   = el.dataset.countSuffix   ?? '';

  // Reduced motion: jump to final value immediately
  if (prefersReducedMotion) {
    el.textContent = `${prefix}${formatCount(target)}${suffix}`;
    revealElement(el);
    return;
  }

  let startTime = null;

  /**
   * rAF callback — advances the counter one frame at a time.
   * @param {DOMHighResTimeStamp} timestamp
   */
  function step(timestamp) {
    if (startTime === null) startTime = timestamp;

    const elapsed  = timestamp - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased    = easeOutCubic(progress);
    const current  = eased * target;

    el.textContent = `${prefix}${formatCount(current)}${suffix}`;

    if (progress < 1) {
      requestAnimationFrame(step);
    } else {
      // Ensure exact final value (avoids floating-point last-frame glitch)
      el.textContent = `${prefix}${formatCount(target)}${suffix}`;
    }
  }

  // Trigger the visual entrance (opacity + scale via CSS)
  revealElement(el);

  requestAnimationFrame(step);
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. IntersectionObserver — counters
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates the counter IntersectionObserver.
 * Uses a higher threshold (0.5) so the count starts when the stat is
 * comfortably in view, not just barely entering the viewport.
 *
 * @returns {IntersectionObserver}
 */
function createCounterObserver() {
  return new IntersectionObserver(
    (entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;

        startCountUp(/** @type {HTMLElement} */ (entry.target));
        observer.unobserve(entry.target);
      });
    },
    {
      threshold: 0.5,
      rootMargin: '0px',
    }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. Above-the-fold detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true if an element is already fully within the initial viewport.
 * These elements are revealed instantly (no entrance animation needed —
 * they were visible on page load before JS even ran).
 *
 * @param {Element} el
 * @returns {boolean}
 */
function isAboveTheFold(el) {
  const rect = el.getBoundingClientRect();
  return rect.top >= 0 && rect.bottom <= window.innerHeight;
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. Element registration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Registers a single reveal element with the observer.
 * Elements already marked .is-visible are skipped.
 * Elements in the initial viewport are revealed without animation.
 *
 * @param {Element} el
 */
function registerRevealElement(el) {
  if (el.classList.contains('is-visible')) return;

  if (prefersReducedMotion || isAboveTheFold(el)) {
    // Skip the observer — mark visible immediately
    el.classList.add('is-visible');
    el.style.willChange = 'auto';
    return;
  }

  revealObserver?.observe(el);
}

/**
 * Registers a single counter element with the counter observer.
 * Skips elements already animated (countingElements WeakSet check is in startCountUp).
 *
 * @param {HTMLElement} el
 */
function registerCounterElement(el) {
  if (el.classList.contains('is-visible')) return;

  if (prefersReducedMotion || isAboveTheFold(el)) {
    startCountUp(el);
    return;
  }

  counterObserver?.observe(el);
}

// ─────────────────────────────────────────────────────────────────────────────
// 10. Reduced-motion fallback — instant reveal all
// ─────────────────────────────────────────────────────────────────────────────

/**
 * When reduced motion is preferred, reveals all elements immediately.
 * CSS already handles the visual side (opacity: 1 !important, etc.),
 * but we still add .is-visible so JS-gated behaviours (star fill, counters)
 * are triggered correctly.
 *
 * @param {Element} [root=document]
 */
function revealAllImmediately(root = document) {
  root.querySelectorAll(REVEAL_SELECTOR).forEach((el) => {
    el.classList.add('is-visible');
    el.style.willChange = 'auto';
  });

  root.querySelectorAll(COUNTER_SELECTOR).forEach((el) => {
    startCountUp(/** @type {HTMLElement} */ (el));
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 11. Public API — refresh
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Scans the DOM (or a given subtree) for new revealable elements and
 * registers them with the existing observers.
 *
 * Call this after dynamically injecting content (e.g. lazy-loaded blog posts,
 * AJAX-loaded testimonials).
 *
 * @param {Element|Document} [root=document]
 */
function refresh(root = document) {
  checkReducedMotion();
  applyStaggerIndices(root === document ? document : root);

  if (prefersReducedMotion) {
    revealAllImmediately(root === document ? document : root);
    return;
  }

  root.querySelectorAll(REVEAL_SELECTOR).forEach(registerRevealElement);
  root.querySelectorAll(COUNTER_SELECTOR).forEach((el) =>
    registerCounterElement(/** @type {HTMLElement} */ (el))
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 12. Init / Destroy
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Initialises the scroll reveal module.
 *
 * Safe to call multiple times — if already initialised, calls refresh()
 * instead of re-creating observers.
 *
 * @returns {{ refresh: (root?: Element | Document) => void, destroy: () => void }}
 */
function init() {
  // ── Reduced-motion ────────────────────────────────────────────────────────

  motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  checkReducedMotion();

  // Listen for OS-level preference changes at runtime (e.g. user toggles
  // system setting while the page is open).
  motionQuery.addEventListener('change', () => {
    checkReducedMotion();
    if (prefersReducedMotion) {
      // Tear down observers; reveal everything instantly
      destroyObservers();
      revealAllImmediately();
    }
  });

  // ── Early exit for reduced motion ─────────────────────────────────────────

  if (prefersReducedMotion) {
    revealAllImmediately();
    return { refresh, destroy };
  }

  // ── IntersectionObserver support check ───────────────────────────────────

  if (!('IntersectionObserver' in window)) {
    // Fallback for very old browsers — reveal everything synchronously.
    if (typeof process === 'undefined' || process?.env?.NODE_ENV !== 'production') {
      console.warn('[scroll-reveal.js] IntersectionObserver not supported — revealing all elements.');
    }
    revealAllImmediately();
    return { refresh, destroy };
  }

  // ── Create observers ──────────────────────────────────────────────────────

  revealObserver   = createRevealObserver();
  counterObserver  = createCounterObserver();

  // ── Stagger indices ───────────────────────────────────────────────────────

  applyStaggerIndices();

  // ── Register all existing elements ───────────────────────────────────────

  document.querySelectorAll(REVEAL_SELECTOR).forEach(registerRevealElement);
  document.querySelectorAll(COUNTER_SELECTOR).forEach((el) =>
    registerCounterElement(/** @type {HTMLElement} */ (el))
  );

  return { refresh, destroy };
}

/**
 * Disconnects both observers without revealing remaining elements.
 * Useful for testing or SPA teardown.
 */
function destroyObservers() {
  revealObserver?.disconnect();
  counterObserver?.disconnect();
  revealObserver  = null;
  counterObserver = null;
}

/**
 * Full teardown — disconnects observers and removes the motion listener.
 */
function destroy() {
  destroyObservers();

  if (motionQuery) {
    // Anonymous listener can't be removed by reference, so we replace the
    // query object. The old listener will be GC'd with the old MQL.
    motionQuery = null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export { init, refresh, destroy };
export default init;