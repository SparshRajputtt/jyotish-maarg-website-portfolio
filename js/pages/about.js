/**
 * about.js
 * Jyotish Maarg — About Page Entry Point
 *
 * Audit result: All About page functionality is already handled by the shared
 * modules initialised in main.js, or by pure CSS.
 *
 * This file exists solely to maintain architectural consistency with other
 * page scripts and prevent 404 errors from the markup's script tag. It
 * intentionally exports a minimal, no-op initialisation function to avoid
 * duplicating any global functionality.
 *
 * @module pages/about
 */

/**
 * Initialises About-page-specific behaviour.
 *
 * Intentionally minimal. All required functionality is handled by global modules
 * or CSS.
 *
 * @returns {{ destroy: () => void }}
 *   Public API with an empty destroy function.
 */
function initAboutPage() {
  return {
    destroy() {
      // No-op
    },
  };
}

export { initAboutPage };
export default initAboutPage;
