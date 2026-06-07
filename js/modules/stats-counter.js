/**
 * stats-counter.js
 * Jyotish Maarg — Stats Counter Module
 *
 * Animates numeric stat elements with a count-up effect when they scroll
 * into view. Works standalone — does not depend on scroll-reveal.js.
 *
 * Observed elements:   .stat-number  (inside .stat-item, .stats-strip)
 *
 * Value format support:
 *   "14+"          → counts 0 → 14, re-appends "+"
 *   "5,000+"       → counts 0 → 5000, re-appends "+"
 *   "5000+"        → same
 *   "25+"          → counts 0 → 25, re-appends "+"
 *   "Since 2012"   → non-numeric prefix kept, counts 0 → 2012
 *   "₹2,499"       → prefix "₹" kept, counts 0 → 2499
 *   "100%"         → counts 0 → 100, re-appends "%"
 *   "4.9"          → counts 0.0 → 4.9 with one decimal place
 *
 * The module reads the element's rendered text content at init time and
 * parses it into { prefix, value, suffix, decimals }.  No data attributes
 * are required — the HTML copy is the single source of truth.
 *
 * Optional data attributes (override auto-parsed values):
 *   data-count          — explicit numeric target  (e.g. data-count="5000")
 *   data-count-prefix   — override prefix string   (e.g. data-count-prefix="₹")
 *   data-count-suffix   — override suffix string   (e.g. data-count-suffix="+")
 *   data-count-duration — override duration in ms  (e.g. data-count-duration="2000")
 *   data-count-decimals — decimal places to show   (e.g. data-count-decimals="1")
 *
 * CSS classes consumed:
 *   .stat-number        — base hidden state (opacity: 0, scale: 0.85)
 *   .is-visible         — triggers CSS entrance transition
 *
 * Accessibility:
 *   · aria-label is set to the final formatted value before counting starts
 *     so screen readers announce the destination, not intermediate counts.
 *   · aria-live="off" is set during animation; restored to "" on completion.
 *   · prefers-reduced-motion: skips animation, sets final value instantly.
 *
 * Performance:
 *   · One shared IntersectionObserver for all .stat-number elements.
 *   · rAF loop — no setInterval, no setTimeout per element.
 *   · Each element is unobserved immediately on intersection (fires once).
 *   · WeakSet guards against double-animation on refresh() calls.
 *
 * @module stats-counter
 */

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Selector for all animatable stat elements. */
const SELECTOR = '.stat-number';

/**
 * Default count-up duration (ms).
 * Matches --counter-duration: 1.5s in tokens.css.
 */
const DEFAULT_DURATION = 1500;

/**
 * IntersectionObserver threshold — element must be 50% visible.
 * Higher than the reveal threshold (0.2) so the number is comfortably
 * in view before counting starts.
 */
const THRESHOLD = 0.5;

// ─────────────────────────────────────────────────────────────────────────────
// Module state
// ─────────────────────────────────────────────────────────────────────────────

/** @type {IntersectionObserver | null} */
let observer = null;

/**
 * Tracks elements that have already been animated.
 * Prevents re-animation on refresh() calls and dynamic re-insertion.
 * @type {WeakSet<HTMLElement>}
 */
const animated = new WeakSet();

/** Cached reduced-motion preference. */
let prefersReducedMotion = false;

// ─────────────────────────────────────────────────────────────────────────────
// 1. Reduced-motion detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reads and caches prefers-reduced-motion.
 * @returns {boolean}
 */
function checkReducedMotion() {
  prefersReducedMotion =
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return prefersReducedMotion;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. CSS token reader
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reads a CSS custom property from :root as a float (strips units).
 * Returns `fallback` if the property is absent or unparseable.
 *
 * @param {string} prop     — e.g. '--counter-duration'
 * @param {number} fallback
 * @returns {number}
 */
function getCSSToken(prop, fallback) {
  try {
    const raw = getComputedStyle(document.documentElement)
      .getPropertyValue(prop)
      .trim();
    // Strip unit suffixes: "1.5s" → 1.5, "1500ms" → 1500
    const numeric = parseFloat(raw);
    if (!Number.isFinite(numeric)) return fallback;
    // Convert seconds to milliseconds if unit is "s"
    return raw.endsWith('ms') ? numeric : numeric * 1000;
  } catch {
    return fallback;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Value parsing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} ParsedValue
 * @property {string} prefix    — non-numeric leading text  e.g. "Since ", "₹"
 * @property {number} value     — the numeric target        e.g. 5000
 * @property {string} suffix    — trailing non-numeric text e.g. "+", "%"
 * @property {number} decimals  — decimal places to show    e.g. 0 or 1
 */

/**
 * Parses a stat element's text content (or data attributes) into a
 * structured { prefix, value, suffix, decimals } descriptor.
 *
 * Parse strategy:
 *   1. data-count attribute takes precedence for the numeric value.
 *   2. data-count-prefix / data-count-suffix / data-count-decimals override
 *      the auto-detected parts.
 *   3. Auto-detection splits the raw text into a leading non-numeric segment
 *      (prefix), a numeric core (with optional decimal point), and a trailing
 *      non-numeric segment (suffix).
 *
 * Examples:
 *   "14+"        → { prefix: "",       value: 14,   suffix: "+", decimals: 0 }
 *   "5,000+"     → { prefix: "",       value: 5000, suffix: "+", decimals: 0 }
 *   "Since 2012" → { prefix: "Since ", value: 2012, suffix: "",  decimals: 0 }
 *   "4.9 ★"      → { prefix: "",       value: 4.9,  suffix: " ★",decimals: 1 }
 *   "₹2,499"     → { prefix: "₹",     value: 2499, suffix: "",  decimals: 0 }
 *
 * @param {HTMLElement} el
 * @returns {ParsedValue | null}  null if no numeric value found
 */
function parseElement(el) {
  const raw = (el.dataset.count !== undefined)
    ? String(el.dataset.count)
    : el.textContent.trim();

  // Strip thousands separators before parsing
  const cleaned = raw.replace(/,/g, '');

  // Regex: optional leading non-numeric, a decimal number, optional trailing non-numeric
  // Matches: "14+", "5000+", "Since 2012", "4.9 ★", "₹2499", "100%"
  const match = cleaned.match(/^([^\d]*)(\d+(?:\.\d+)?)([^\d]*)$/);
  if (!match) return null;

  const [, autPrefix, numStr, autSuffix] = match;
  const value = parseFloat(numStr);

  if (!Number.isFinite(value)) return null;

  // Determine decimal places from the numeric string (or data attribute)
  const autDecimals = numStr.includes('.')
    ? numStr.split('.')[1].length
    : 0;

  return {
    prefix:   el.dataset.countPrefix   ?? autPrefix,
    value,
    suffix:   el.dataset.countSuffix   ?? autSuffix,
    decimals: el.dataset.countDecimals !== undefined
                ? parseInt(el.dataset.countDecimals, 10)
                : autDecimals,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Number formatting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Formats a number with thousands separators (Indian locale: en-IN).
 * Falls back to plain string if Intl is unavailable.
 *
 * @param {number} value
 * @param {number} decimals
 * @returns {string}
 */
function formatNumber(value, decimals) {
  try {
    return value.toLocaleString('en-IN', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    return decimals > 0 ? value.toFixed(decimals) : String(Math.round(value));
  }
}

/**
 * Composes the full display string from its parts.
 *
 * @param {ParsedValue} parsed
 * @param {number}      current   — current animated value
 * @returns {string}
 */
function compose(parsed, current) {
  return `${parsed.prefix}${formatNumber(current, parsed.decimals)}${parsed.suffix}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Easing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ease-out cubic — matches --ease-out: cubic-bezier(0, 0, 0.2, 1) in tokens.css.
 * Fast start, gentle deceleration into the final value.
 *
 * @param {number} t — linear progress 0 → 1
 * @returns {number}   eased progress 0 → 1
 */
function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Animation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Runs the count-up rAF loop for a single element.
 * Sets aria-label to the final value before starting so screen readers
 * announce the destination, not intermediate counts.
 *
 * @param {HTMLElement}  el
 * @param {ParsedValue}  parsed
 * @param {number}       duration  — ms
 */
function animateCounter(el, parsed, duration) {
  const finalText = compose(parsed, parsed.value);

  // ── Accessibility: announce destination, suppress intermediate values ────
  el.setAttribute('aria-label', finalText);
  el.setAttribute('aria-live', 'off');

  // ── Trigger CSS entrance (opacity + scale via .is-visible) ───────────────
  el.classList.add('is-visible');

  // ── Reduced motion: skip to final value immediately ──────────────────────
  if (prefersReducedMotion) {
    el.textContent = finalText;
    el.removeAttribute('aria-live');
    return;
  }

  let startTime = null;

  /**
   * rAF step — advances the counter one frame.
   * @param {DOMHighResTimeStamp} ts
   */
  function step(ts) {
    if (startTime === null) startTime = ts;

    const elapsed  = ts - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased    = easeOutCubic(progress);
    const current  = eased * parsed.value;

    el.textContent = compose(parsed, current);

    if (progress < 1) {
      requestAnimationFrame(step);
    } else {
      // Lock to exact final value — avoids floating-point drift on last frame
      el.textContent = finalText;
      el.removeAttribute('aria-live');
    }
  }

  requestAnimationFrame(step);
}

/**
 * Triggers the counter animation on a single element.
 * Parses its text content, guards against double-fire, then animates.
 *
 * @param {HTMLElement} el
 */
function triggerCounter(el) {
  if (animated.has(el)) return;
  animated.add(el);

  const parsed = parseElement(el);

  // If no numeric value found, just make the element visible
  if (!parsed) {
    el.classList.add('is-visible');
    return;
  }

  const duration =
    el.dataset.countDuration !== undefined
      ? parseFloat(el.dataset.countDuration)
      : getCSSToken('--counter-duration', DEFAULT_DURATION);

  animateCounter(el, parsed, Number.isFinite(duration) ? duration : DEFAULT_DURATION);
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. IntersectionObserver
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates the shared IntersectionObserver.
 * Each element is unobserved immediately on first intersection — fires once.
 *
 * @returns {IntersectionObserver}
 */
function createObserver() {
  return new IntersectionObserver(
    (entries, obs) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;

        // Unobserve before animating to prevent any re-trigger edge cases
        obs.unobserve(entry.target);

        triggerCounter(/** @type {HTMLElement} */ (entry.target));
      });
    },
    {
      threshold: THRESHOLD,
      rootMargin: '0px',
    }
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. Element registration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true if an element is fully within the initial viewport.
 * Above-the-fold stats are triggered immediately without waiting for scroll.
 *
 * @param {HTMLElement} el
 * @returns {boolean}
 */
function isAboveTheFold(el) {
  const rect = el.getBoundingClientRect();
  return rect.top >= 0 && rect.bottom <= window.innerHeight;
}

/**
 * Registers a single element — either triggers immediately (above the fold
 * or reduced motion) or hands it to the IntersectionObserver.
 *
 * @param {HTMLElement} el
 */
function registerElement(el) {
  if (animated.has(el)) return;

  if (prefersReducedMotion || isAboveTheFold(el)) {
    triggerCounter(el);
    return;
  }

  observer?.observe(el);
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Scans `root` for new .stat-number elements and registers them.
 * Call after dynamically injecting stat content (AJAX, lazy sections).
 *
 * @param {Element | Document} [root=document]
 */
function refresh(root = document) {
  checkReducedMotion();
  root.querySelectorAll(SELECTOR).forEach(
    (el) => registerElement(/** @type {HTMLElement} */ (el))
  );
}

/**
 * Disconnects the observer and resets module state.
 * Useful for testing or SPA teardown.
 */
function destroy() {
  observer?.disconnect();
  observer = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 10. Init
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Initialises the stats counter module.
 *
 * Safe to call multiple times — calling again only registers any new
 * .stat-number elements added since the last call (WeakSet guards duplicates).
 *
 * @returns {{ refresh: typeof refresh, destroy: typeof destroy }}
 */
function initStatsCounter() {
  checkReducedMotion();

  // Listen for OS-level preference changes at runtime
  window
    .matchMedia('(prefers-reduced-motion: reduce)')
    .addEventListener('change', () => {
      checkReducedMotion();
    });

  // Fallback for browsers without IntersectionObserver (IE 11 etc.)
  if (!('IntersectionObserver' in window)) {
    document.querySelectorAll(SELECTOR).forEach(
      (el) => triggerCounter(/** @type {HTMLElement} */ (el))
    );
    return { refresh, destroy };
  }

  // Create the shared observer (only once — guard against re-init)
  if (!observer) {
    observer = createObserver();
  }

  // Register all elements currently in the DOM
  document.querySelectorAll(SELECTOR).forEach(
    (el) => registerElement(/** @type {HTMLElement} */ (el))
  );

  return { refresh, destroy };
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export { initStatsCounter, refresh, destroy };
export default initStatsCounter;