/**
 * testimonial-carousel.js
 * Jyotish Maarg — Testimonial Carousel Module
 *
 * Manages one or more testimonial carousels on the page.
 * Each carousel is a fully independent instance with its own state.
 *
 * Expected HTML structure:
 * ─────────────────────────────────────────────────────────────────
 *  <div class="testimonial-carousel" aria-label="Client testimonials">
 *
 *    <div class="testimonial-carousel__track"
 *         aria-live="polite"
 *         aria-atomic="true">
 *
 *      <div class="testimonial-carousel__inner">
 *
 *        <div class="testimonial-carousel__slide" role="group"
 *             aria-label="Testimonial 1 of 5">
 *          <div class="testimonial-card">…</div>
 *        </div>
 *
 *        <!-- repeat for each testimonial -->
 *      </div>
 *    </div>
 *
 *    <div class="testimonial-carousel__controls">
 *      <button class="testimonial-carousel__btn testimonial-carousel__btn--prev"
 *              aria-label="Previous testimonial" aria-controls="[track-id]">
 *        <!-- chevron-left SVG -->
 *      </button>
 *
 *      <div class="testimonial-carousel__dots" role="tablist"
 *           aria-label="Select testimonial">
 *        <!-- dots injected by JS -->
 *      </div>
 *
 *      <button class="testimonial-carousel__btn testimonial-carousel__btn--next"
 *              aria-label="Next testimonial" aria-controls="[track-id]">
 *        <!-- chevron-right SVG -->
 *      </button>
 *    </div>
 *
 *  </div>
 * ─────────────────────────────────────────────────────────────────
 *
 * CSS classes consumed:
 *   .testimonial-carousel                — root wrapper
 *   .testimonial-carousel__track         — overflow:hidden viewport
 *   .testimonial-carousel__inner         — flex strip; transform drives sliding
 *   .testimonial-carousel__slide         — individual slide (min-width: 100%)
 *   .testimonial-carousel__controls      — prev/dots/next row
 *   .testimonial-carousel__btn--prev     — previous button
 *   .testimonial-carousel__btn--next     — next button
 *   .testimonial-carousel__dots          — dot container
 *   .testimonial-carousel__dot           — individual dot (injected by JS)
 *   .is-active                           — active dot modifier
 *
 * Features:
 *   · Prev / Next buttons
 *   · Dot indicators (injected & synced)
 *   · Touch / pointer swipe (horizontal delta threshold)
 *   · Keyboard: ArrowLeft / ArrowRight when carousel is focused
 *   · aria-live region announces slide changes to screen readers
 *   · aria-label on each slide updated: "Testimonial N of M"
 *   · Prev disabled on first slide, Next disabled on last (non-looping)
 *   · prefers-reduced-motion: transition disabled, slides jump instantly
 *   · Multiple independent carousel instances supported
 *   · No autoplay
 *
 * @module testimonial-carousel
 */

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Root selector — one element per carousel instance. */
const ROOT_SELECTOR = '.testimonial-carousel';

/** Minimum horizontal swipe distance (px) to register as intentional. */
const SWIPE_THRESHOLD = 50;

/**
 * Maximum vertical drift (px) allowed during a swipe before we decide
 * the user is scrolling vertically and abandon the gesture.
 */
const SWIPE_VERTICAL_LIMIT = 75;

/** CSS transition duration (ms) matching --duration-slow (400ms) in tokens.css. */
const TRANSITION_DURATION = 400;

// ─────────────────────────────────────────────────────────────────────────────
// Reduced-motion
// ─────────────────────────────────────────────────────────────────────────────

/** @type {MediaQueryList} */
const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

/** @returns {boolean} */
function prefersReducedMotion() {
  return motionQuery.matches;
}

// ─────────────────────────────────────────────────────────────────────────────
// Unique ID generator (for aria-controls linkage)
// ─────────────────────────────────────────────────────────────────────────────

let _idCounter = 0;

/** @returns {string} */
function uid() {
  return `jm-carousel-${++_idCounter}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Carousel instance factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates and binds a single carousel instance.
 *
 * @param {HTMLElement} root — .testimonial-carousel element
 * @returns {{ destroy: () => void } | null}
 */
function createCarousel(root) {
  // ── Query required children ───────────────────────────────────────────────

  const track   = root.querySelector('.testimonial-carousel__track');
  const inner   = root.querySelector('.testimonial-carousel__inner');
  const dotsEl  = root.querySelector('.testimonial-carousel__dots');
  const prevBtn = root.querySelector('.testimonial-carousel__btn--prev');
  const nextBtn = root.querySelector('.testimonial-carousel__btn--next');

  if (!track || !inner) return null;

  const slides = Array.from(
    inner.querySelectorAll('.testimonial-carousel__slide')
  );

  const total = slides.length;
  if (total === 0) return null;

  // ── State ─────────────────────────────────────────────────────────────────

  let current      = 0;
  let isAnimating  = false;

  /** Touch / pointer gesture tracking. */
  const touch = {
    startX:    0,
    startY:    0,
    currentX:  0,
    active:    false,
    cancelled: false, // true when vertical scroll detected
  };

  // ── ARIA setup ────────────────────────────────────────────────────────────

  // Give the track a stable ID so buttons can reference it via aria-controls
  if (!track.id) track.id = uid();

  root.setAttribute('role', 'region');
  if (!root.hasAttribute('aria-label')) {
    root.setAttribute('aria-label', 'Client testimonials');
  }

  track.setAttribute('aria-live', 'polite');
  track.setAttribute('aria-atomic', 'true');

  // Label each slide "Testimonial N of M"
  slides.forEach((slide, i) => {
    slide.setAttribute('role', 'group');
    slide.setAttribute('aria-label', `Testimonial ${i + 1} of ${total}`);
    slide.setAttribute('aria-hidden', String(i !== 0));
  });

  // Wire buttons to the track
  [prevBtn, nextBtn].forEach((btn) => {
    if (btn) btn.setAttribute('aria-controls', track.id);
  });

  // ── Dots ──────────────────────────────────────────────────────────────────

  /** @type {HTMLButtonElement[]} */
  let dots = [];

  if (dotsEl && total > 1) {
    dotsEl.setAttribute('role', 'tablist');
    if (!dotsEl.hasAttribute('aria-label')) {
      dotsEl.setAttribute('aria-label', 'Select testimonial');
    }

    dots = slides.map((_, i) => {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'testimonial-carousel__dot';
      dot.setAttribute('role', 'tab');
      dot.setAttribute('aria-label', `Go to testimonial ${i + 1}`);
      dot.setAttribute('aria-selected', String(i === 0));
      dot.setAttribute('tabindex', i === 0 ? '0' : '-1');
      dot.dataset.index = String(i);
      if (i === 0) dot.classList.add('is-active');
      dotsEl.appendChild(dot);
      return dot;
    });
  }

  // ── Slide rendering ───────────────────────────────────────────────────────

  /**
   * Moves the carousel to `index` with an optional instant flag.
   * Guards against animation overlap and out-of-bounds indices.
   *
   * @param {number}  index
   * @param {boolean} [instant=false] — skip transition (reduced motion / init)
   */
  function goTo(index, instant = false) {
    if (index === current && !instant) return;
    if (index < 0 || index >= total) return;
    if (isAnimating && !instant) return;

    const previous = current;
    current = index;

    // ── Translate the strip ────────────────────────────────────────────────

    const reduced = prefersReducedMotion();

    if (reduced || instant) {
      inner.style.transition = 'none';
    } else {
      // Use the CSS transition declared in components.css (overridable here)
      inner.style.transition = '';
      isAnimating = true;
    }

    inner.style.transform = `translateX(-${current * 100}%)`;

    // ── ARIA: show/hide slides ─────────────────────────────────────────────

    slides.forEach((slide, i) => {
      slide.setAttribute('aria-hidden', String(i !== current));
    });

    // ── Dots ──────────────────────────────────────────────────────────────

    dots.forEach((dot, i) => {
      const active = i === current;
      dot.classList.toggle('is-active', active);
      dot.setAttribute('aria-selected', String(active));
      dot.setAttribute('tabindex', active ? '0' : '-1');
    });

    // ── Button disabled state ─────────────────────────────────────────────

    updateButtonStates();

    // ── Announce to screen readers ────────────────────────────────────────
    // aria-live="polite" on the track handles this; we just ensure the
    // visible card is not aria-hidden.

    // ── Unlock after transition ───────────────────────────────────────────

    if (!reduced && !instant) {
      const unlock = () => {
        isAnimating = false;
        inner.removeEventListener('transitionend', unlock);
      };
      inner.addEventListener('transitionend', unlock, { once: true });

      // Safety fallback in case transitionend never fires
      setTimeout(() => {
        isAnimating = false;
      }, TRANSITION_DURATION + 50);
    }

    // Suppress the live region announcement for the initial render
    if (instant) {
      track.setAttribute('aria-live', 'off');
      requestAnimationFrame(() => track.setAttribute('aria-live', 'polite'));
    }
  }

  /**
   * Enables / disables prev and next buttons based on current index.
   * Uses aria-disabled rather than the disabled attribute so buttons
   * remain focusable for keyboard users who may be confused by disappearing
   * focus targets.
   */
  function updateButtonStates() {
    if (!prevBtn || !nextBtn) return;

    const atStart = current === 0;
    const atEnd   = current === total - 1;

    prevBtn.setAttribute('aria-disabled', String(atStart));
    nextBtn.setAttribute('aria-disabled', String(atEnd));

    // Visual opacity is handled via CSS [aria-disabled="true"] selector
    // (matches the .btn:disabled rule in components.css)
  }

  // ── Navigation helpers ────────────────────────────────────────────────────

  function prev() {
    if (current > 0) goTo(current - 1);
  }

  function next() {
    if (current < total - 1) goTo(current + 1);
  }

  // ── Event handlers ────────────────────────────────────────────────────────

  /** Prev button click. */
  function onPrevClick() {
    if (prevBtn?.getAttribute('aria-disabled') === 'true') return;
    prev();
  }

  /** Next button click. */
  function onNextClick() {
    if (nextBtn?.getAttribute('aria-disabled') === 'true') return;
    next();
  }

  /** Dot click — go to the corresponding slide. */
  function onDotClick(e) {
    const dot = e.target.closest('.testimonial-carousel__dot');
    if (!dot) return;
    const idx = parseInt(dot.dataset.index, 10);
    if (Number.isFinite(idx)) goTo(idx);
  }

  /**
   * Keyboard navigation on the root element.
   * ArrowLeft / ArrowRight when focus is inside the carousel.
   *
   * @param {KeyboardEvent} e
   */
  function onKeyDown(e) {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      prev();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      next();
    }
  }

  /**
   * Dot keyboard: Arrow keys within tablist move between dots.
   * @param {KeyboardEvent} e
   */
  function onDotKeyDown(e) {
    const dot = e.target.closest('.testimonial-carousel__dot');
    if (!dot) return;

    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const idx    = parseInt(dot.dataset.index, 10);
      const newIdx = e.key === 'ArrowLeft' ? idx - 1 : idx + 1;
      if (newIdx >= 0 && newIdx < total) {
        goTo(newIdx);
        dots[newIdx]?.focus();
      }
    }
  }

  // ── Touch / Pointer swipe ─────────────────────────────────────────────────

  /**
   * Records swipe start position.
   * Uses pointer events (covers touch + mouse) with a passive touch listener
   * on touchstart for scroll performance.
   *
   * @param {PointerEvent | TouchEvent} e
   */
  function onTouchStart(e) {
    const point = e.touches ? e.touches[0] : e;
    touch.startX   = point.clientX;
    touch.startY   = point.clientY;
    touch.currentX = point.clientX;
    touch.active   = true;
    touch.cancelled = false;
  }

  /**
   * Tracks swipe progress and cancels if vertical scroll detected.
   * @param {PointerEvent | TouchEvent} e
   */
  function onTouchMove(e) {
    if (!touch.active || touch.cancelled) return;

    const point  = e.touches ? e.touches[0] : e;
    const deltaX = point.clientX - touch.startX;
    const deltaY = Math.abs(point.clientY - touch.startY);

    touch.currentX = point.clientX;

    // If the user is scrolling vertically, abandon the gesture
    if (deltaY > SWIPE_VERTICAL_LIMIT && Math.abs(deltaX) < SWIPE_VERTICAL_LIMIT) {
      touch.active    = false;
      touch.cancelled = true;
    }
  }

  /**
   * Evaluates swipe on release.
   * @param {PointerEvent | TouchEvent} e
   */
  function onTouchEnd(e) {
    if (!touch.active || touch.cancelled) {
      touch.active = false;
      return;
    }

    touch.active = false;

    const point  = e.changedTouches ? e.changedTouches[0] : e;
    const deltaX = point.clientX - touch.startX;

    if (Math.abs(deltaX) < SWIPE_THRESHOLD) return;

    if (deltaX < 0) {
      next(); // Swipe left → next
    } else {
      prev(); // Swipe right → prev
    }
  }

  // ── Bind events ───────────────────────────────────────────────────────────

  prevBtn?.addEventListener('click', onPrevClick);
  nextBtn?.addEventListener('click', onNextClick);

  dotsEl?.addEventListener('click', onDotClick);
  dotsEl?.addEventListener('keydown', onDotKeyDown);

  root.addEventListener('keydown', onKeyDown);

  // Touch events (passive for scroll performance)
  track.addEventListener('touchstart', onTouchStart, { passive: true });
  track.addEventListener('touchmove',  onTouchMove,  { passive: true });
  track.addEventListener('touchend',   onTouchEnd,   { passive: true });

  // Pointer events for mouse-drag support on desktop
  track.addEventListener('pointerdown', onTouchStart);
  track.addEventListener('pointermove', onTouchMove);
  track.addEventListener('pointerup',   onTouchEnd);
  track.addEventListener('pointercancel', () => { touch.active = false; });

  // Keep touch and pointer from duplicating on touch devices
  // (touchstart fires before pointerdown — we use touch events on touch devices,
  //  pointer events on non-touch; both are guarded by touch.active)

  // ── Reduced-motion listener ───────────────────────────────────────────────

  motionQuery.addEventListener('change', () => {
    // Re-apply current position instantly if motion pref changes at runtime
    goTo(current, true);
  });

  // ── Initialise ────────────────────────────────────────────────────────────

  // Render first slide without animation or live-region announcement
  goTo(0, true);

  // Hide previous button on first slide
  updateButtonStates();

  // Make the carousel keyboard-focusable if nothing inside is naturally focusable
  if (!root.hasAttribute('tabindex')) {
    root.setAttribute('tabindex', '0');
  }

  // ── Destroy ───────────────────────────────────────────────────────────────

  /**
   * Removes all event listeners added by this instance.
   * Call when removing the carousel from the DOM (SPA teardown).
   */
  function destroy() {
    prevBtn?.removeEventListener('click', onPrevClick);
    nextBtn?.removeEventListener('click', onNextClick);

    dotsEl?.removeEventListener('click', onDotClick);
    dotsEl?.removeEventListener('keydown', onDotKeyDown);

    root.removeEventListener('keydown', onKeyDown);

    track.removeEventListener('touchstart', onTouchStart);
    track.removeEventListener('touchmove',  onTouchMove);
    track.removeEventListener('touchend',   onTouchEnd);

    track.removeEventListener('pointerdown',   onTouchStart);
    track.removeEventListener('pointermove',   onTouchMove);
    track.removeEventListener('pointerup',     onTouchEnd);
    track.removeEventListener('pointercancel', () => { touch.active = false; });
  }

  return { destroy };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} CarouselHandle
 * @property {() => void} destroy — removes all listeners for this instance
 */

/**
 * @typedef {Object} CarouselAPI
 * @property {(root?: Element | Document) => void} refresh
 *   Scans for new .testimonial-carousel elements and initialises them.
 *   Call after dynamically injecting carousel markup.
 * @property {() => void} destroy
 *   Destroys all carousel instances and clears state.
 */

/** @type {Map<HTMLElement, CarouselHandle>} */
const instances = new Map();

/**
 * Scans `root` for .testimonial-carousel elements and initialises any
 * that haven't been set up yet.
 *
 * @param {Element | Document} [root=document]
 */
function refresh(root = document) {
  root.querySelectorAll(ROOT_SELECTOR).forEach((el) => {
    if (instances.has(/** @type {HTMLElement} */ (el))) return;

    const handle = createCarousel(/** @type {HTMLElement} */ (el));
    if (handle) {
      instances.set(/** @type {HTMLElement} */ (el), handle);
    }
  });
}

/**
 * Destroys all managed carousel instances and clears the instance map.
 */
function destroyAll() {
  instances.forEach((handle) => handle.destroy());
  instances.clear();
}

/**
 * Initialises all .testimonial-carousel elements currently in the DOM.
 *
 * Safe to call multiple times — existing instances are skipped.
 *
 * @returns {CarouselAPI}
 */
function initTestimonialCarousel() {
  refresh(document);
  return { refresh, destroy: destroyAll };
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export { initTestimonialCarousel, refresh, destroyAll as destroy };
export default initTestimonialCarousel;