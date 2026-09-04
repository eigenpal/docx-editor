// Resolving the directory of the packaged font assets.
//
// Split out of `index.ts` so its own test can reach it directly. Everything here runs at
// MODULE SCOPE in `index.ts`, where a throw is uncatchable: it takes down the whole
// bundle that imported this package rather than degrading font loading. That is not
// hypothetical. A single-argument `new URL()` over a bundler-rewritten face entry
// shipped once and answered every page of a production site with
// "URL constructor: /_next/static/media/Caladea-Bold.<hash>.ttf is not a valid URL".

/**
 * Base for a face entry a bundler rewrote to a RELATIVE path. A page resolves such a
 * path against its own origin, so `location` is the truthful base. Off the main thread
 * and outside a browser there is no origin to speak of, and the reserved `.invalid` TLD
 * says so in a value that is still a well-formed URL.
 */
const BUNDLED_FACE_BASE = 'https://bundled.invalid/';

/**
 * Directory of the packaged assets, given whatever shape a bundler left one face in.
 *
 * Its own module so the test can reach it without widening the package's public API:
 * `index.ts` imports it and does not re-export it.
 */
export const resolvePackagedAssetRoot = (face: URL | string): URL => {
  // Ordered most-truthful first. Each entry can fail, so each is tried in turn; the
  // trailing `return` is what makes the function total, and total is the property that
  // matters here. This runs at module scope, where a throw is uncatchable and takes down
  // the whole bundle that imported this package rather than degrading font loading.
  const bases: readonly (string | undefined)[] = [
    // Node, Bun, and Vite leave a real URL, whose directory is the real asset directory
    // even under Yarn PnP or a nested install. A bundler that emits an ABSOLUTE string
    // lands here too, and resolves the same way.
    undefined,
    // webpack and Turbopack emit a RELATIVE path string, which a page resolves against
    // its own origin. `location` is therefore the truthful base, when there is one.
    // There is not always one: `about:blank` and `about:srcdoc` are real values of
    // `location.href` in a sandboxed or srcdoc iframe, and neither can base a URL.
    globalThis.location?.href,
    // No usable origin. The reserved `.invalid` TLD says exactly that, in a value that
    // still parses.
    //
    // Deliberately not `new URL('../assets/', import.meta.url)`. That resolves, but it
    // answers with a `file:` directory, and reaching this point means a bundler moved
    // the faces somewhere of its own choosing, so the guess would be wrong by
    // construction. It would also be wrong in the dangerous direction: consumers pass
    // this to `createPackagedFileFetch` as `trustedRoot`, so a made-up local directory
    // widens a confinement boundary instead of closing it. Every consumer gates on
    // `protocol === 'file:'`, so a non-`file:` answer correctly reads as "no trusted
    // local directory", while the loaders keep fetching each face by the path the
    // bundler emitted.
    BUNDLED_FACE_BASE,
  ];
  for (const base of bases) {
    try {
      return new URL('./', base === undefined ? face : new URL(face, base));
    } catch {
      // Unusable base or unusable entry. Fall through to the next.
    }
  }
  return new URL(BUNDLED_FACE_BASE);
};
