/**
 * faq-accordion.js
 * Jyotish Maarg — FAQ Accordion Module
 *
 * Responsibilities:
 *   1. Toggle FAQ items open/closed on trigger click or keyboard activation
 *   2. Animate answer height smoothly via max-height + opacity transition
 *   3. Enforce one-item-open-at-a-time within each accordion group
 *   4. Manage aria-expanded on triggers and aria-hidden on panels
 *   5. Full keyboard navigation: Enter, Space, Escape, Arrow Up/Down, Home, End
 *   6. Support multiple independent accordion groups on the same page
 *   7. Honour prefers-reduced-motion — skip height animation, snap open/closed
 *   8. Expose refresh() for dynamically injected FAQ content
 *
 * Expected HTML structure:
 *
 *   <div class="faq-accordion" data-accordion>
 *     <div class="faq-item" data-accordion-item>
 *       <button
 *         class="faq-item__trigger"
 *         data-accordion-trigger
 *         aria-expanded="false"
 *         aria-controls="faq-answer-1"
 *         id="faq-trigger-1"
 *       >
 *         Question text
 *         <span class="faq-item__icon" aria-hidden="true">...</span>
 *       </button>
 *       <div
 *         class="faq-item__panel"
 *         data-accordion-panel
 *         id="faq-answer-1"
 *         role="region"
 *         aria-labelledby="faq-trigger-1"
 *         hidden
 *       >
 *         <div class="faq-item__body">
 *           Answer content
 *         </div>
 *       </div>
 *     </div>
 *     <!-- more .faq-item elements -->
 *   </div>
 *
 * Data attributes:
 *   data-accordion              — on the root wrapper; marks an accordion group
 *   data-accordion-item         — on each FAQ item wrapper
 *   data-accordion-trigger      — on the <button> that toggles the item
 *   data-accordion-panel        — on the collapsible answer panel
 *   data-accordion-open         — on a [data-accordion-item] to open it on init
 *   data-accordion-independent  — on [data-accordion] to allow multiple items
 *                                  open simultaneously (opt-out of one-at-a-time)
 *
 * CSS classes this module adds/removes:
 *   .faq-item--open             — on [data-accordion-item] when expanded
 *   .faq-accordion--ready       — on [data-accordion] after JS init; enables
 *                                  animated transitions (prevents flash of
 *                                  unstyled content before scrollHeight is known)
 *
 * CSS properties this module sets inline (removed after transition):
 *   max-height                  — set to scrollHeight on panel open; '0' on close
 *
 * Accessibility:
 *   · aria-expanded="true|false" on every trigger at all times
 *   · aria-hidden="true|false"   on every panel
 *   · hidden attribute removed on open, restored on close (after transition)
 *   · role="region" + aria-labelledby link between panel and trigger
 *   · Full ARIA Authoring Practices accordion keyboard pattern (APG 3.1)
 *
 * Performance:
 *   · Zero IntersectionObserver — accordions are interactive from page load
 *   · Single delegated click listener per accordion group (not per item)
 *   · max-height animation via CSS transition; JS only sets the start/end values
 *   · WeakMap stores per-group state; no global arrays that leak on teardown
 *
 * @module faq-accordion
 */

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Root selector — one per accordion group. */
const ACCORDION_SELECTOR = '[data-accordion]';

/** Selector for each FAQ item within a group. */
const ITEM_SELECTOR = '[data-accordion-item]';

/** Selector for the toggle button within an item. */
const TRIGGER_SELECTOR = '[data-accordion-trigger]';

/** Selector for the collapsible answer panel within an item. */
const PANEL_SELECTOR = '[data-accordion-panel]';

/**
 * CSS class added to the item wrapper when open.
 * Drives the icon rotation and any open-state border/background changes.
 */
const ITEM_OPEN_CLASS = 'faq-item--open';

/**
 * CSS class added to the accordion root after JS initialisation.
 * Prevents the CSS transition from firing on the initial hidden→visible paint.
 * Without it, panels that start open would animate from 0 on page load.
 */
const ACCORDION_READY_CLASS = 'faq-accordion--ready';

/**
 * Duration (ms) to wait before restoring the `hidden` attribute after closing.
 * Must be >= the CSS transition duration for max-height on .faq-item__panel.
 * Matches --duration-slow: 400ms in tokens.css.
 */
const CLOSE_HIDDEN_DELAY = 400;

// ─────────────────────────────────────────────────────────────────────────────
// Module state
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tracks per-group state.
 * Key:   the [data-accordion] root element
 * Value: { cleanupFn: Function } — the function that removes event listeners
 *
 * WeakMap allows GC of accordion elements without manual cleanup.
 *
 * @type {WeakMap<HTMLElement, { cleanupFn: Function }>}
 */
const groupRegistry = new WeakMap();

/**
 * Tracks in-flight close timers per panel.
 * Prevents the `hidden` attribute from being restored prematurely if
 * the item is reopened before the close transition finishes.
 *
 * @type {WeakMap<HTMLElement, number>}
 */
const closeTimers = new WeakMap();

/** Cached reduced-motion preference. Re-read on refresh(). */
let prefersReducedMotion = false;

// ─────────────────────────────────────────────────────────────────────────────
// 1. Reduced-motion detection
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

// ─────────────────────────────────────────────────────────────────────────────
// 2. DOM helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns all [data-accordion-item] children of an accordion group.
 *
 * @param {HTMLElement} group
 * @returns {HTMLElement[]}
 */
function getItems(group) {
  // querySelectorAll with :scope ensures we only get direct-descendant items
  // and don't accidentally capture nested accordions (e.g. an FAQ inside an FAQ).
  return Array.from(group.querySelectorAll(`:scope ${ITEM_SELECTOR}`));
}

/**
 * Returns the trigger button within an item.
 *
 * @param {HTMLElement} item
 * @returns {HTMLElement|null}
 */
function getTrigger(item) {
  return item.querySelector(TRIGGER_SELECTOR);
}

/**
 * Returns the answer panel within an item.
 *
 * @param {HTMLElement} item
 * @returns {HTMLElement|null}
 */
function getPanel(item) {
  return item.querySelector(PANEL_SELECTOR);
}

/**
 * Returns true if an item is currently open.
 *
 * @param {HTMLElement} item
 * @returns {boolean}
 */
function isItemOpen(item) {
  return item.classList.contains(ITEM_OPEN_CLASS);
}

/**
 * Returns true if the accordion group allows multiple items open simultaneously.
 *
 * @param {HTMLElement} group
 * @returns {boolean}
 */
function isIndependent(group) {
  return group.hasAttribute('data-accordion-independent');
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Open / Close a single item
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Opens a single FAQ item.
 *
 * Steps:
 *   1. Cancel any in-flight close timer for this panel (re-open mid-animation)
 *   2. Remove `hidden` attribute so the panel participates in layout
 *   3. Set max-height to the panel's scrollHeight (enables CSS transition)
 *   4. Update aria-expanded and aria-hidden
 *   5. Add .faq-item--open to the item wrapper
 *
 * In reduced-motion mode: skips the max-height inline style entirely;
 * CSS already handles the snap-open via the .faq-item--open class.
 *
 * @param {HTMLElement} item
 */
function openItem(item) {
  const trigger = getTrigger(item);
  const panel   = getPanel(item);

  if (!trigger || !panel) return;
  if (isItemOpen(item)) return;

  // Cancel any pending close timer so hidden is not restored mid-reopen
  const pendingClose = closeTimers.get(panel);
  if (pendingClose !== undefined) {
    clearTimeout(pendingClose);
    closeTimers.delete(panel);
  }

  // Step 1: make the panel visible in the DOM before measuring
  panel.removeAttribute('hidden');
  panel.setAttribute('aria-hidden', 'false');

  // Step 2: update ARIA state
  trigger.setAttribute('aria-expanded', 'true');

  // Step 3: add open class (drives icon rotation, border etc.)
  item.classList.add(ITEM_OPEN_CLASS);

  // Step 4: animate height
  if (!prefersReducedMotion) {
    // Read scrollHeight after removing hidden so layout is correct
    const targetHeight = panel.scrollHeight;
    panel.style.maxHeight = `${targetHeight}px`;
  }
}

/**
 * Closes a single FAQ item.
 *
 * Steps:
 *   1. Set max-height to '0' to trigger the CSS collapse transition
 *   2. Update aria-expanded and aria-hidden immediately
 *   3. Remove .faq-item--open from the item wrapper
 *   4. After the transition completes, restore `hidden` and clear max-height
 *
 * In reduced-motion mode: skips the transition delay; restores hidden immediately.
 *
 * @param {HTMLElement} item
 * @param {boolean}     [returnFocus=false]  — if true, move focus to the trigger
 *                                             (used when closing via Escape key)
 */
function closeItem(item, returnFocus = false) {
  const trigger = getTrigger(item);
  const panel   = getPanel(item);

  if (!trigger || !panel) return;
  if (!isItemOpen(item)) return;

  // Step 1: update ARIA state immediately
  trigger.setAttribute('aria-expanded', 'false');
  panel.setAttribute('aria-hidden', 'true');

  // Step 2: remove open class
  item.classList.remove(ITEM_OPEN_CLASS);

  if (returnFocus) {
    trigger.focus();
  }

  if (prefersReducedMotion) {
    // Snap closed — no transition delay needed
    panel.style.maxHeight = '';
    panel.setAttribute('hidden', '');
    return;
  }

  // Step 3: animate to zero height
  // We must explicitly set the current height first so the transition
  // has a start value to tween from (avoids instant collapse on first close).
  panel.style.maxHeight = `${panel.scrollHeight}px`;

  // Force a reflow so the browser registers the start value before we set 0
  // eslint-disable-next-line no-unused-expressions
  panel.offsetHeight;

  panel.style.maxHeight = '0';

  // Step 4: restore hidden after transition completes
  // The timeout matches --duration-slow: 400ms (CLOSE_HIDDEN_DELAY constant).
  const timer = setTimeout(() => {
    // Guard: only restore hidden if the item is still closed
    // (user may have re-opened it before the timer fired)
    if (!isItemOpen(item)) {
      panel.setAttribute('hidden', '');
      panel.style.maxHeight = '';
    }
    closeTimers.delete(panel);
  }, CLOSE_HIDDEN_DELAY);

  closeTimers.set(panel, timer);
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Toggle (the primary user action)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Toggles a single item open or closed.
 * If the group is in one-at-a-time mode, closes all other open items first.
 *
 * @param {HTMLElement} group  — the [data-accordion] root
 * @param {HTMLElement} item   — the [data-accordion-item] to toggle
 */
function toggleItem(group, item) {
  const opening = !isItemOpen(item);

  // One-at-a-time: close every other open item in this group
  if (opening && !isIndependent(group)) {
    getItems(group).forEach((sibling) => {
      if (sibling !== item && isItemOpen(sibling)) {
        closeItem(sibling);
      }
    });
  }

  if (opening) {
    openItem(item);
  } else {
    closeItem(item);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Keyboard navigation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handles keyboard events on accordion triggers.
 * Implements the ARIA Authoring Practices Guide accordion pattern (APG 3.1):
 *
 *   Enter / Space  — toggle the focused item (handled natively by <button>)
 *   Escape         — close the open item and return focus to its trigger
 *   Arrow Down     — move focus to the next trigger in the group
 *   Arrow Up       — move focus to the previous trigger in the group
 *   Home           — move focus to the first trigger in the group
 *   End            — move focus to the last trigger in the group
 *
 * Enter and Space are already handled by the click event on <button> elements,
 * so this handler only needs to deal with navigation keys.
 *
 * @param {KeyboardEvent} e
 * @param {HTMLElement}   group
 */
function onTriggerKeydown(e, group) {
  const trigger = e.target.closest(TRIGGER_SELECTOR);
  if (!trigger) return;

  const item = trigger.closest(ITEM_SELECTOR);
  if (!item) return;

  const triggers = getItems(group)
    .map(getTrigger)
    .filter(Boolean);

  const currentIndex = triggers.indexOf(trigger);

  switch (e.key) {
    case 'Escape': {
      if (isItemOpen(item)) {
        e.preventDefault();
        closeItem(item, true); // true = return focus to trigger
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
// 6. Event delegation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates click and keydown handlers for an accordion group and binds them.
 * Returns a cleanup function that removes both listeners.
 *
 * Using event delegation (one listener on the group root, not one per trigger)
 * means dynamically injected items work without re-initialisation, and there
 * are no stale listener references on teardown.
 *
 * @param {HTMLElement} group
 * @returns {Function}  cleanup — call to unbind all listeners from this group
 */
function bindGroupEvents(group) {
  /**
   * Delegated click handler.
   * Walks up from the click target to find the nearest [data-accordion-trigger].
   *
   * @param {MouseEvent} e
   */
  function onClick(e) {
    const trigger = e.target.closest(TRIGGER_SELECTOR);
    if (!trigger) return;

    // Ensure the trigger belongs to THIS group (guard against nested accordions)
    if (!group.contains(trigger)) return;

    const item = trigger.closest(ITEM_SELECTOR);
    if (!item) return;

    toggleItem(group, item);
  }

  /**
   * Delegated keydown handler.
   *
   * @param {KeyboardEvent} e
   */
  function onKeydown(e) {
    // Only intercept navigation keys; Enter/Space are handled by onClick
    const navigationKeys = ['Escape', 'ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!navigationKeys.includes(e.key)) return;

    // Ensure the event originated from a trigger in THIS group
    const trigger = e.target.closest(TRIGGER_SELECTOR);
    if (!trigger || !group.contains(trigger)) return;

    onTriggerKeydown(e, group);
  }

  group.addEventListener('click',   onClick);
  group.addEventListener('keydown', onKeydown);

  // Return a cleanup function for destroy() and re-init guards
  return function cleanup() {
    group.removeEventListener('click',   onClick);
    group.removeEventListener('keydown', onKeydown);
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Initial state setup
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sets the correct initial DOM state for all items in a group.
 *
 * Items marked with [data-accordion-open] are opened without animation
 * (the ACCORDION_READY_CLASS has not been added yet, so no transition fires).
 * All other items are collapsed and their panels get the `hidden` attribute.
 *
 * @param {HTMLElement} group
 */
function setInitialState(group) {
  getItems(group).forEach((item) => {
    const trigger = getTrigger(item);
    const panel   = getPanel(item);

    if (!trigger || !panel) return;

    const shouldOpen = item.hasAttribute('data-accordion-open');

    if (shouldOpen) {
      // Open without animation — ACCORDION_READY_CLASS not yet applied
      panel.removeAttribute('hidden');
      panel.setAttribute('aria-hidden', 'false');
      trigger.setAttribute('aria-expanded', 'true');
      item.classList.add(ITEM_OPEN_CLASS);

      if (!prefersReducedMotion) {
        // Set max-height so CSS transitions work correctly from this point
        panel.style.maxHeight = `${panel.scrollHeight}px`;
      }
    } else {
      // Collapsed state
      panel.setAttribute('hidden', '');
      panel.setAttribute('aria-hidden', 'true');
      trigger.setAttribute('aria-expanded', 'false');
      item.classList.remove(ITEM_OPEN_CLASS);
      panel.style.maxHeight = '0';
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. Single group initialisation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Initialises a single [data-accordion] group.
 * Skips the group if it has already been initialised (guards against double-init).
 *
 * @param {HTMLElement} group
 */
function initGroup(group) {
  // Guard: skip if already registered
  if (groupRegistry.has(group)) return;

  // Set initial ARIA and visibility state (before adding ACCORDION_READY_CLASS)
  setInitialState(group);

  // Bind delegated event listeners; store cleanup function
  const cleanupFn = bindGroupEvents(group);
  groupRegistry.set(group, { cleanupFn });

  // Add ready class AFTER setting initial state — this enables CSS transitions
  // for all future open/close actions without animating the initial paint.
  // rAF ensures the class is added after the browser has painted the initial state.
  requestAnimationFrame(() => {
    group.classList.add(ACCORDION_READY_CLASS);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. Teardown of a single group
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tears down a single accordion group: removes event listeners,
 * clears pending close timers, and unregisters from the WeakMap.
 *
 * @param {HTMLElement} group
 */
function destroyGroup(group) {
  const entry = groupRegistry.get(group);
  if (!entry) return;

  // Remove event listeners
  entry.cleanupFn();

  // Clear any pending close timers for items in this group
  getItems(group).forEach((item) => {
    const panel = getPanel(item);
    if (!panel) return;

    const timer = closeTimers.get(panel);
    if (timer !== undefined) {
      clearTimeout(timer);
      closeTimers.delete(panel);
    }
  });

  // Remove ready class
  group.classList.remove(ACCORDION_READY_CLASS);

  groupRegistry.delete(group);
}

// ─────────────────────────────────────────────────────────────────────────────
// 10. Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Scans `root` for new [data-accordion] groups and initialises them.
 * Already-initialised groups are skipped — safe to call repeatedly.
 *
 * Use this after dynamically injecting FAQ content (e.g. AJAX-loaded sections).
 *
 * @param {Element | Document} [root=document]
 */
function refresh(root = document) {
  checkReducedMotion();
  root.querySelectorAll(ACCORDION_SELECTOR).forEach(
    (group) => initGroup(/** @type {HTMLElement} */ (group))
  );
}

/**
 * Tears down all accordion groups in `root`.
 * Removes event listeners and clears all pending timers.
 * Useful for SPA-style page transitions or testing.
 *
 * @param {Element | Document} [root=document]
 */
function destroy(root = document) {
  root.querySelectorAll(ACCORDION_SELECTOR).forEach(
    (group) => destroyGroup(/** @type {HTMLElement} */ (group))
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 11. Init
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Initialises all FAQ accordion groups on the page.
 *
 * Safe to call multiple times — already-initialised groups are skipped.
 * Call refresh() instead if you only need to pick up newly injected content.
 *
 * Listens for OS-level prefers-reduced-motion changes at runtime so that
 * users who toggle the system preference mid-session get correct behaviour.
 *
 * @returns {{ refresh: typeof refresh, destroy: typeof destroy }}
 */
function initFaqAccordion() {
  checkReducedMotion();

  // Listen for runtime OS preference changes
  window
    .matchMedia('(prefers-reduced-motion: reduce)')
    .addEventListener('change', () => {
      checkReducedMotion();
    });

  // Initialise all groups currently in the DOM
  document.querySelectorAll(ACCORDION_SELECTOR).forEach(
    (group) => initGroup(/** @type {HTMLElement} */ (group))
  );

  return { refresh, destroy };
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export { initFaqAccordion, refresh, destroy };
export default initFaqAccordion;