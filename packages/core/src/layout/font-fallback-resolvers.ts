// Font resolvers that apply the shared fallback rules (`font-fallback-rules.ts`) over a
// caller's byte reader. The editor reads the fallback faces from its host's font origins; an
// exporter reads them from disk. Both get the same substitutions.

import type { FontSource, FontSourceSubstitution } from '../contracts/editor.ts';
import {
  CJK_FALLBACK_FAMILY,
  canonicalFontFamily,
  genericStandInFamily,
  isCjkRuledFontFamily,
  isRuledFontFamily,
  namedSubstituteFamily,
  standInLineBox,
} from './font-fallback-rules.ts';
import type { FontResolutionRequest } from './font-composition.ts';
import type { FontRequest } from './font-resource.ts';
import { defineFontResolver, type MarkedFontResolver } from './font-resolver.ts';
import { nearestFaceOrder } from './served-font-families.ts';

/**
 * Reads the fallback faces of `families`, each under its own family name. A family the reader
 * does not carry yields no source. It must not substitute one family for another.
 */
export type FallbackFaceReader = (
  families: ReadonlySet<string>,
  signal: AbortSignal | undefined,
  /**
   * The faces that the text needs of those families, when the request states its faces. A
   * reader that pays for each face (a network fetch) loads only these. Absent: every face.
   */
  faces?: readonly FontRequest[]
) => Promise<readonly FontSource[]>;

/** What a fallback resolver answers: always both lists, either may be empty. */
export interface FallbackFontsAnswer {
  readonly sources: FontSource[];
  readonly substitutions: FontSourceSubstitution[];
}

/** A resolver that applies fallback rules over a {@link FallbackFaceReader}. */
export type FallbackFontResolver = MarkedFontResolver<
  (request: FontResolutionRequest) => Promise<FallbackFontsAnswer>
>;

type FaceStyle = 'normal' | 'italic';

const face = (family: string, weight = 400, style: FaceStyle = 'normal'): FontRequest => ({
  family,
  weight,
  style,
});

const faceKey = (family: string, weight: number, style: string): string =>
  `${family.toLowerCase()}/${weight}/${style}`;

/** Whether a face is painted, by family (ignoring case), weight, and style. */
type Painted = (family: string, weight: number, style: FaceStyle) => boolean;

const paintedFaces = (faces: readonly FontRequest[] | undefined): Painted => {
  const covered = new Set((faces ?? []).map((one) => faceKey(one.family, one.weight, one.style)));
  return (family, weight, style) => covered.has(faceKey(family, weight, style));
};

/** The four static faces of a family. */
const STATIC_FACES = [
  [400, 'normal'],
  [700, 'normal'],
  [400, 'italic'],
  [700, 'italic'],
] as const;

/**
 * Substitutions that point every face of `family` at `target`: at the one regular face when
 * the target is a single-face Noto family, at the matching weight and style otherwise.
 */
export function substitutionsToFallback(family: string, target: string): FontSourceSubstitution[] {
  const { bold, italic } = canonicalFontFamily(family);
  return STATIC_FACES.map(([weight, style]) => ({
    from: face(family, weight, style),
    // The CJK, symbol and mathematics fallback faces come in one weight and one style.
    to: target.startsWith('Noto')
      ? face(target)
      : face(
          target,
          bold || weight === 700 ? 700 : 400,
          italic || style === 'italic' ? 'italic' : 'normal'
        ),
  }));
}

/**
 * The faces of the fallback targets that the request's faces map to. Undefined when the
 * request states no faces: the reader then loads every face.
 */
const targetFaces = (
  requested: readonly FontRequest[] | undefined,
  targets: ReadonlyMap<string, string>
): FontRequest[] | undefined => {
  if (!requested) return undefined;
  const out = new Map<string, FontRequest>();
  for (const one of requested) {
    const target = targets.get(one.family.toLowerCase());
    if (!target) continue;
    const style: FaceStyle = one.style === 'italic' ? 'italic' : 'normal';
    const [{ to }] = substitutionsToFallback(one.family, target).filter(
      ({ from }) => from.weight === (one.weight >= 600 ? 700 : 400) && from.style === style
    );
    out.set(faceKey(to.family, to.weight, to.style), to);
  }
  return [...out.values()];
};

/**
 * Keep the substitutions whose target family has bytes, read now or painted by an earlier
 * origin. By family, not by face: a single-face target draws every weight and style, which
 * the renderer synthesizes.
 */
const backed = (
  substitutions: readonly FontSourceSubstitution[],
  sources: readonly FontSource[],
  earlier: readonly FontRequest[] | undefined
): FontSourceSubstitution[] => {
  const families = new Set(
    [...sources.map((source) => source.request), ...(earlier ?? [])].map((one) =>
      one.family.toLowerCase()
    )
  );
  return substitutions.filter(({ to }) => families.has(to.family.toLowerCase()));
};

/**
 * The fallback faces by name, read on demand.
 *
 * Serves a fallback face that the request names (a glyph fallback, or a document that names
 * the face itself), and points each family that a named rule answers for at its fallback face
 * ({@link namedSubstituteFamily}). The CJK families are not substituted here: their face has
 * its own origin.
 */
export function namedFallbackFontResolver(read: FallbackFaceReader): FallbackFontResolver {
  return defineFontResolver(async (request: FontResolutionRequest) => {
    const { families, signal, resolvedFaces } = request;
    const wanted = new Set<string>();
    const targets = new Map<string, string>();
    for (const family of families) {
      wanted.add(family);
      const target = namedSubstituteFamily(family);
      if (!target) continue;
      wanted.add(target);
      targets.set(family.toLowerCase(), target);
    }
    const named = targetFaces(request.faces, targets);
    const sources = await read(
      wanted,
      signal,
      named && request.faces ? [...request.faces, ...named] : undefined
    );
    return {
      sources: [...sources],
      substitutions: backed(
        families.flatMap((family) => {
          const target = namedSubstituteFamily(family);
          return target && target !== CJK_FALLBACK_FAMILY
            ? substitutionsToFallback(family, target)
            : [];
        }),
        sources,
        resolvedFaces
      ),
    };
  });
}

/**
 * The last word on a face nothing else covers. Compose it after the document's own embedded
 * fonts, so it can never shadow one of them.
 *
 * Two answers. A family with no face at all renders in a fallback face of its class
 * ({@link genericStandInFamily}), with the line box that the rules keep for it. A family with
 * some faces covered points each other face at its nearest covered face
 * (`nearestFaceOrder`), which the renderer emboldens or slants: every symbol face, most CJK
 * faces, and a family that ships in bold only.
 * Legacy symbol families never get a text stand-in; their private-use bullets belong to the
 * glyph fallback path.
 */
export function standInFontResolver(read: FallbackFaceReader): FallbackFontResolver {
  return defineFontResolver(async (request: FontResolutionRequest) => {
    const { families, signal, resolvedFaces } = request;
    const has = paintedFaces(resolvedFaces);
    const targets = new Map<string, string>();
    const nearest: FontSourceSubstitution[] = [];
    const generic: FontSourceSubstitution[] = [];
    const wanted = new Set<string>();
    for (const family of families) {
      if (STATIC_FACES.some(([weight, style]) => has(family, weight, style))) {
        for (const [weight, style] of STATIC_FACES) {
          if (has(family, weight, style)) continue;
          const [toWeight, toStyle] = nearestFaceOrder(weight, style).find(([w, s]) =>
            has(family, w, s)
          )!;
          nearest.push({
            from: face(family, weight, style),
            to: face(family, toWeight, toStyle),
          });
        }
        continue;
      }
      // A CJK family reaching here is uncovered: its plan needed a face that did not resolve.
      const canonical = canonicalFontFamily(family).family;
      if (isRuledFontFamily(canonical) && !isCjkRuledFontFamily(canonical)) continue;
      const target = genericStandInFamily(family);
      wanted.add(target);
      targets.set(family.toLowerCase(), target);
      const { bold, italic } = canonicalFontFamily(family);
      const lineMetrics = standInLineBox(canonical, target);
      for (const [weight, style] of STATIC_FACES)
        generic.push({
          from: face(family, weight, style),
          to: face(
            target,
            bold || weight === 700 ? 700 : 400,
            italic || style === 'italic' ? 'italic' : 'normal'
          ),
          ...(lineMetrics ? { lineMetrics } : {}),
        });
    }
    const sources =
      wanted.size > 0 ? await read(wanted, signal, targetFaces(request.faces, targets)) : [];
    return {
      sources: [...sources],
      substitutions: [...nearest, ...backed(generic, sources, resolvedFaces)],
    };
  });
}
