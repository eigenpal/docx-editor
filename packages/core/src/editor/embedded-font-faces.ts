// Paint-side twin of embedded-font auto-wiring (embedded-font-paint-registration).
//
// Measurement never touches the browser's font machinery: HarfBuzz shapes the admitted
// bytes directly. But the painted pages are ordinary DOM, so a font that exists only
// inside the DOCX renders in a platform substitute unless the SAME bytes are registered
// as a `FontFace`. This module performs that registration for faces the validator
// admitted — and only those — and hands back a disposable so a replaced document or a
// destroyed editor removes exactly the faces it added.
//
// Registration is presentation fidelity, never correctness: every failure is swallowed
// per-face (measurement does not depend on it), and outside a DOM environment the whole
// thing is a no-op.

import type { FontSource } from '../contracts/editor.ts';

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
  /** Faces actually admitted into the set (failures are dropped silently). */
  readonly installed: number;
  dispose(): void;
}

const NO_REGISTRATION: EmbeddedFontFaceRegistration = Object.freeze({
  installed: 0,
  dispose() {},
});

/**
 * The `FontFace` family argument is parsed as a CSS `<family-name>`, and embedded
 * family names are attacker-controlled — always pass a quoted string with the two
 * characters that can escape it escaped.
 */
function cssQuotedFamily(family: string): string {
  return `"${family.replace(/[\\"]/g, '\\$&')}"`;
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
 * Register admitted embedded faces with the environment's `FontFaceSet` so painted
 * glyphs use the font the layout measured with. Resolves after every face has either
 * loaded into the set or failed; per-face failure only lowers `installed`.
 */
export async function registerEmbeddedFontFaces(
  sources: readonly FontSource[],
  environment: EmbeddedFontFaceEnvironment = defaultEnvironment()
): Promise<EmbeddedFontFaceRegistration> {
  const { fontSet, createFontFace } = environment;
  if (!fontSet || !createFontFace || sources.length === 0) return NO_REGISTRATION;

  const added: FontFaceLike[] = [];
  await Promise.all(
    sources.map(async (source) => {
      try {
        const face = createFontFace(cssQuotedFamily(source.request.family), source.bytes, {
          weight: String(source.request.weight),
          style: source.request.style,
        });
        await face.load();
        fontSet.add(face);
        added.push(face);
      } catch {
        // Paint fidelity is best-effort; the face still measures shaped.
      }
    })
  );
  if (added.length === 0) return NO_REGISTRATION;

  let disposed = false;
  return {
    installed: added.length,
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
