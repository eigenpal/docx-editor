// Resolving the directory of the packaged font assets.
//
// Its own module so its test can reach it directly. This runs at MODULE SCOPE in
// `index.ts`, where a throw is uncatchable: it takes down the whole bundle that imported
// this package rather than degrading font loading. That is not hypothetical. A
// single-argument `new URL()` over a bundler-rewritten face entry shipped once and
// answered every page of a production site with
// "URL constructor: /_next/static/media/Caladea-Bold.<hash>.ttf is not a valid URL".

/**
 * Base for a face entry a bundler rewrote to a RELATIVE path, when no page origin can
 * serve as one. The reserved `.invalid` TLD says exactly that, in a value that parses.
 */
const BUNDLED_FACE_BASE = 'https://bundled.invalid/';

/**
 * Directory of the packaged assets, given whatever shape a bundler left one face in.
 *
 * A `URL` entry is Node, Bun, or Vite leaving the expression alone, and its directory is
 * the real asset directory even under Yarn PnP or a nested install, so a `file:` answer
 * there is correct and is what headless exporters need.
 *
 * A `string` entry means webpack or Turbopack replaced the expression with a path for an
 * asset they emitted, and a relative one cannot base a URL on its own. Every answer in
 * that case is REJECTED IF IT IS `file:`, including one derived from a `file:` page
 * origin, because two things then go wrong at once. The directory would not hold the
 * faces, since the bundler moved them. And consumers pass this to
 * `createPackagedFileFetch` as `trustedRoot`, which rejects a broad filesystem root by
 * THROWING: a bundle whose assets sit at the path root would resolve to `file:///` and
 * crash `@docx-editor.dev/docx-to-markdown` at module scope, which is the very failure
 * this module exists to prevent. A non-`file:` answer instead reads correctly as "no
 * trusted local directory", while the loaders keep fetching each face by the emitted
 * path.
 *
 * `origin` is a parameter so the page-origin arm is testable. Production always takes
 * the default.
 */
export const resolvePackagedAssetRoot = (
  face: URL | string,
  origin: string | undefined = globalThis.location?.href
): URL => {
  if (typeof face !== 'string') {
    try {
      return new URL('./', face);
    } catch {
      // A `URL` cannot fail to base one, so this is unreachable in practice. Falling
      // through rather than throwing is what makes this function total.
    }
  } else {
    // Bases, most truthful first. `about:blank` and `about:srcdoc` are real values of
    // `location.href` in a sandboxed or srcdoc iframe and cannot base a URL, so a bad
    // origin falls through instead of failing.
    for (const base of [undefined, origin, BUNDLED_FACE_BASE]) {
      try {
        const root = new URL('./', base === undefined ? face : new URL(face, base));
        if (root.protocol !== 'file:') return root;
      } catch {
        // Unusable base. Try the next.
      }
    }
  }
  return new URL(BUNDLED_FACE_BASE);
};

/**
 * Environment variable that relocates the packaged asset directory.
 *
 * Single-file bundles (Bun `--compile`, Node single executable applications, `pkg`)
 * cannot keep the `new URL(face, import.meta.url)` entries pointing at real files: the
 * bundle lives in a virtual filesystem and the faces stay outside it. A host that ships
 * the `assets/` directory beside such a bundle sets this variable to that directory
 * before the process starts, and every packaged face resolves inside it.
 *
 * Node only. Browsers have no process environment, and the variable is ignored there.
 */
export const FONT_ASSET_ROOT_ENV = 'DOCX_EDITOR_FONT_ASSET_ROOT';

const readAssetRootEnv = (): string | undefined => {
  // `process` is absent in browsers and under some bundlers is an empty shim; both
  // read as "no override" here rather than as an error.
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  return env?.[FONT_ASSET_ROOT_ENV];
};

/**
 * Directory URL for a relocated asset root, or `undefined` when there is none.
 *
 * Accepts a `file:` URL or an absolute filesystem path (POSIX or Windows). A relative
 * path, an unparsable value, or a filesystem root is ignored: `createPackagedFileFetch`
 * refuses a broad `trustedRoot` by throwing, and this runs at module scope where a throw
 * is uncatchable. `value` is a parameter so every arm is testable.
 */
export const packagedAssetRootOverride = (
  value: string | undefined = readAssetRootEnv()
): URL | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  try {
    let root: URL;
    if (/^file:/i.test(trimmed)) {
      root = new URL(trimmed);
    } else if (/^[A-Za-z]:[\\/]/.test(trimmed)) {
      root = new URL(`file:///${trimmed.replace(/\\/g, '/')}`);
    } else if (trimmed.startsWith('/')) {
      root = new URL(`file://${trimmed}`);
    } else {
      return undefined;
    }
    if (root.protocol !== 'file:') return undefined;
    const directory = new URL(root.pathname.endsWith('/') ? root.href : `${root.href}/`);
    // A path root (`/` or `C:/`) is the broad directory the trusted reader refuses.
    if (/^\/(?:[A-Za-z]:\/)?$/.test(directory.pathname)) return undefined;
    return directory;
  } catch {
    return undefined;
  }
};
