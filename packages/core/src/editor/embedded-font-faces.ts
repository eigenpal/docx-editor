// Paint-side twin of embedded-font auto-wiring, done safely (issue #78).
//
// Measurement never touches the browser's font machinery: HarfBuzz shapes the admitted
// bytes directly. But painted pages are ordinary DOM, so a font that exists only inside
// the DOCX renders in a platform substitute unless the SAME bytes are registered as a
// `FontFace`.
//
// The naive version of that — register under the family the DOCUMENT declares — is a
// zero-click UI-redressing hole, and was reverted once already. `FontFaceSet` is
// per-DOCUMENT, not per-subtree: a face added for a family name hides the installed font
// of that name for the WHOLE page. A file fully controls `w:font/@w:name`, so a document
// naming its face `Segoe UI` would repaint the host application's own chrome with
// attacker-chosen glyphs. CSS-quoting the name stops CSS injection, not shadowing —
// quoting is not namespacing.
//
// So faces register under an ENGINE-MINTED alias derived from the admitted face's content
// hash, and the painter emits `font-family: "<alias>", "<declared family>"`. Document text
// gets the embedded glyphs; the declared name keeps whatever it means to the host page.

import type { FontSource, FontSourceSubstitution } from '../contracts/editor.ts';

/** The slice of `FontFace` this module needs; injectable for tests. */
export interface FontFaceLike {
  load(): Promise<unknown>;
}

/** The slice of `FontFaceSet` this module needs; injectable for tests. */
export interface FontFaceSetLike {
  add(face: FontFaceLike): unknown;
  delete(face: FontFaceLike): unknown;
}

export interface EmbeddedFontFaceEnvironment {
  readonly fontSet?: FontFaceSetLike | undefined;
  readonly createFontFace?: (
    family: string,
    bytes: Uint8Array,
    descriptors: { readonly weight: string; readonly style: 'normal' | 'italic' }
  ) => FontFaceLike;
}

/** Faces registered for one document load; disposing removes exactly those faces. */
export interface EmbeddedFontFaceRegistration {
  /** Faces actually admitted into the set (per-face failures are dropped silently). */
  readonly installed: number;
  /**
   * Declared family -> alias, for the painter. Empty when nothing registered, which makes
   * painting fall back to the declared family alone.
   */
  readonly alias: (family: string) => string | undefined;
  dispose(): void;
}

const NO_REGISTRATION: EmbeddedFontFaceRegistration = Object.freeze({
  installed: 0,
  alias: () => undefined,
  dispose() {},
});

/**
 * The alias for one document's face set.
 *
 * Derived from content hashes, so it is engine-minted and a document cannot collide with
 * a host family name — the whole point. The `docx-embedded-` prefix keeps it recognisable
 * in devtools, and the alias is per-FAMILY (not per-face) because CSS selects weight and
 * style through the descriptors, not the name.
 */
function aliasForFamily(hashes: readonly string[]): string {
  let digest = 0;
  for (const hash of hashes) {
    for (let index = 0; index < hash.length; index += 1) {
      digest = (digest * 31 + hash.charCodeAt(index)) >>> 0;
    }
  }
  return `docx-embedded-${digest.toString(36)}`;
}

function defaultEnvironment(): EmbeddedFontFaceEnvironment {
  const doc = typeof document !== 'undefined' ? document : undefined;
  const fontSet = (doc as { fonts?: FontFaceSetLike } | undefined)?.fonts;
  if (!fontSet || typeof FontFace === 'undefined') return {};
  return {
    fontSet,
    createFontFace: (family, bytes, descriptors) =>
      // A copy, not the admitted view: FontFace snapshots its source, but slicing keeps
      // the engine's buffers from ever being aliased by browser internals.
      new FontFace(family, bytes.slice().buffer, descriptors) as unknown as FontFaceLike,
  };
}

/**
 * Register admitted faces under engine-minted aliases and return the lookup the painter
 * uses. Resolves after every face has either loaded into the set or failed; per-face
 * failure only lowers `installed`.
 *
 * Callers MUST pass faces that survived validation — these bytes reach the browser's own
 * font loader.
 *
 * `substitutions` extends the lookup to the names runs actually write: a document says
 * `Calibri` while the registered face is `Carlito`, so without the map the text measures
 * shaped and then paints in a platform substitute. Aliasing the `from` name is what makes
 * app-supplied stand-ins paintable WITHOUT registering a face called "Calibri" globally —
 * the shadowing hole this module exists to avoid applies to Word's family names just as
 * much as to a document's own.
 */
export async function registerEmbeddedFontFaces(
  sources: readonly FontSource[],
  environment: EmbeddedFontFaceEnvironment = defaultEnvironment(),
  substitutions: readonly FontSourceSubstitution[] = []
): Promise<EmbeddedFontFaceRegistration> {
  const { fontSet, createFontFace } = environment;
  if (!fontSet || !createFontFace || sources.length === 0) return NO_REGISTRATION;

  // One alias per declared family, covering all of that family's faces.
  const byFamily = new Map<string, FontSource[]>();
  for (const source of sources) {
    const family = source.request.family;
    const list = byFamily.get(family);
    if (list) list.push(source);
    else byFamily.set(family, [source]);
  }

  const aliases = new Map<string, string>();
  const added: FontFaceLike[] = [];
  await Promise.all(
    [...byFamily].map(async ([family, faces]) => {
      const alias = aliasForFamily(faces.map((face) => face.hash));
      let anyLoaded = false;
      await Promise.all(
        faces.map(async (face) => {
          try {
            const fontFace = createFontFace(alias, face.bytes, {
              weight: String(face.request.weight),
              style: face.request.style,
            });
            await fontFace.load();
            fontSet.add(fontFace);
            added.push(fontFace);
            anyLoaded = true;
          } catch {
            // Paint fidelity is best-effort; the face still measures shaped.
          }
        })
      );
      // Only advertise an alias the browser actually accepted: pointing the painter at a
      // family with no registered face would push text to the generic fallback instead of
      // the declared family behind it.
      if (anyLoaded) aliases.set(family, alias);
    })
  );
  if (added.length === 0) return NO_REGISTRATION;

  // A substituted-from name only borrows an alias that its target actually earned, and
  // never displaces a face registered under that name directly — a real Calibri beats a
  // stand-in for Calibri, the same precedence composition already applies to bytes.
  for (const substitution of substitutions) {
    if (aliases.has(substitution.from.family)) continue;
    const alias = aliases.get(substitution.to.family);
    if (alias !== undefined) aliases.set(substitution.from.family, alias);
  }

  let disposed = false;
  return {
    installed: added.length,
    alias: (family) => (disposed ? undefined : aliases.get(family)),
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const face of added) {
        try {
          fontSet.delete(face);
        } catch {
          /* removing from a torn-down set is not an error */
        }
      }
    },
  };
}
