// Families that the font configuration serves for at least one face.
//
// A host resolver gets the faces that text uses, so it often serves only some faces of a family.
// The font table class (`w:family`, `CT_FontFamily`, ECMA-376 Part 1, §17.8.3.9) locates a
// substitute only for a font that is not available, and a served family is available. Its
// other faces therefore stand in through the family that serves it, as a synthesized style of
// its nearest face, and never through the class fallback. One family then measures, paints,
// and exports every face of the document family.
//
// A family with bytes under its own name is available in the same way: a host source, or a
// face that the file embeds (`w:embedRegular`, `w:embedBold`, `w:embedItalic`,
// `w:embedBoldItalic`, `CT_FontRel`, ECMA-376 Part 1, §17.8.3.6, §17.8.3.3, §17.8.3.5,
// §17.8.3.4). An omitted embedding stores no face of that style, so a face that the family
// lacks stands in through its own nearest face, which its own paint alias also holds.
//
// The name that a run uses (`w:rFonts`, `CT_Fonts`, ECMA-376 Part 1, §17.3.2.26) and the name
// of the bytes can be two names of one font: a localized East Asian name and its English name.
// Bytes under either name are the family's own faces, in both directions.

import type { FontConfiguration, FontSourceSubstitution } from '../contracts/editor.ts';
import { englishFamily } from '../store/package/default-font-faces.ts';
import { fontRequestKey } from './font-resource.ts';

type Face = FontSourceSubstitution['from'];
type Supplied = Pick<FontSourceSubstitution, 'to' | 'lineMetrics'>;

const fold = (family: string): string => family.trim().toLowerCase();

/**
 * The faces of a family that stand in for a face it lacks, nearest first. This is CSS font
 * matching over the four static faces, which paint applies to the family's alias: the requested
 * style decides first, then the nearest weight, and the other style comes last. The PDF
 * converter's stand-in origin uses this same list, so the editor and the PDF pick one face.
 * @internal
 */
export function nearestFaceOrder(
  weight: number,
  style: 'normal' | 'italic'
): readonly (readonly [number, 'normal' | 'italic'])[] {
  const otherWeight = weight >= 600 ? 400 : 700;
  const otherStyle = style === 'italic' ? 'normal' : 'italic';
  return [
    [weight, style],
    [otherWeight, style],
    [weight, otherStyle],
    [otherWeight, otherStyle],
  ];
}

/**
 * Whether a host substitution from `from` to `to` gives a family with its own faces one more
 * face: the same style from another family. Paint registers such a face in the family's alias
 * (`registerHostFacesOfOwnFamilies` in `embedded-font-faces.ts`), and measurement takes it as a
 * stand-in candidate (`ownNearestFace`); both apply this one rule so CSS font matching and
 * measurement pick the same face. Both also require sources under the family's exact name.
 */
export function isOwnFamilyHostFace(from: Face, to: Face): boolean {
  return from.style === to.style && fold(from.family) !== fold(to.family);
}

/** The faces of a family in the order that decides which family serves it. */
const SERVING_ORDER = [
  [400, 'normal'],
  [700, 'normal'],
  [400, 'italic'],
  [700, 'italic'],
] as const;

export interface ServedFontFamilies {
  /**
   * The name under which the configuration serves `family`: the family itself, its English
   * name (`メイリオ` served as `Meiryo`), or a localized name whose English name is `family`.
   */
  servingName(family: string): string | undefined;
  /**
   * The face that stands in for a face of `family` that nothing serves: the same face of the
   * family that serves `family`, else its nearest face (`nearestFaceOrder`). The renderer
   * synthesizes the missing bold or italic from it.
   */
  nearestFace(family: string, request: Face): Supplied | undefined;
  /**
   * Whether the configuration supplies bytes for at least one face of `family` under its own
   * name, under its English name (`メイリオ` supplied as `Meiryo`), or under a localized name
   * whose English name is `family` (`Meiryo` supplied as `メイリオ`). Such a family paints
   * through the alias of those bytes, so its other faces stand in through its own nearest face
   * (`ownNearestFace`), never through another family.
   */
  suppliesOwnFaces(family: string): boolean;
  /**
   * The nearest face of `family` among its own sources, in `nearestFaceOrder`. With sources
   * under the family's exact name, a face that a host substitution supplies in the same style
   * from another family is a candidate too: the family's paint alias holds that face
   * (`embedded-font-faces.ts`), so CSS font matching picks it as well.
   */
  ownNearestFace(family: string, request: Face): Supplied | undefined;
}

export function servedFontFamilies(configuration: FontConfiguration): ServedFontFamilies {
  const sources = new Map(
    configuration.sources.map((source) => [fontRequestKey(source.request), source.request])
  );
  const own = new Set(configuration.sources.map((source) => fold(source.request.family)));
  // Each English name whose bytes come only under a localized name (`Meiryo` supplied as
  // `メイリオ`), with that name as the sources spell it.
  const ownLocalizedByEnglish = new Map<string, string>();
  for (const { request } of configuration.sources) {
    const english = fold(englishFamily(request.family));
    if (english !== fold(request.family) && !ownLocalizedByEnglish.has(english))
      ownLocalizedByEnglish.set(english, request.family.trim());
  }
  // Each family that a substitution serves, with the face that serves each of its faces. Only a
  // substitution that reaches bytes counts: a resolver names its targets before it fetches
  // them, and a failed fetch must not make a family look served. Bytes under the document's
  // own name are `own` faces instead: see `suppliesOwnFaces`.
  const served = new Map<string, { name: string; faces: Map<string, Supplied> }>();
  const serve = (from: Face, supplied: Supplied): void => {
    const key = fold(from.family);
    let entry = served.get(key);
    if (!entry) served.set(key, (entry = { name: from.family.trim(), faces: new Map() }));
    const face = fontRequestKey({ ...from, family: key });
    if (!entry.faces.has(face)) entry.faces.set(face, supplied);
  };
  for (const substitution of configuration.substitutions ?? []) {
    const to = sources.get(fontRequestKey(substitution.to));
    if (!to) continue;
    serve(
      substitution.from,
      substitution.lineMetrics ? { to, lineMetrics: substitution.lineMetrics } : { to }
    );
  }
  const localizedByEnglish = new Map<string, string>();
  for (const [key, { name }] of served) {
    const english = fold(englishFamily(name));
    if (english !== key && !localizedByEnglish.has(english)) localizedByEnglish.set(english, key);
  }
  const servingKey = (family: string): string | undefined => {
    const key = fold(family);
    if (served.has(key)) return key;
    const english = fold(englishFamily(family));
    if (served.has(english)) return english;
    return localizedByEnglish.get(key);
  };
  // The family that serves the regular face (or the first served face) decides: one paint
  // alias holds every face of a document family, so every face stands in through one family.
  const servingFamily = (key: string): Supplied | undefined => {
    const faces = served.get(key)!.faces;
    for (const [weight, style] of SERVING_ORDER) {
      const supplied = faces.get(fontRequestKey({ family: key, weight, style }));
      if (supplied) return supplied;
    }
    return undefined;
  };
  const nearestSource = (family: string, { weight, style }: Face): Face | undefined => {
    for (const [w, s] of nearestFaceOrder(weight, style)) {
      const to = sources.get(fontRequestKey({ family, weight: w, style: s }));
      if (to) return to;
    }
    return undefined;
  };
  // The name that holds a family's own bytes: the family itself, else its English name, else a
  // localized name whose English name it is.
  const ownName = (family: string): string | undefined => {
    if (own.has(fold(family))) return family;
    const english = englishFamily(family);
    if (own.has(fold(english))) return english;
    return ownLocalizedByEnglish.get(fold(family));
  };
  return {
    servingName(family) {
      const key = servingKey(family);
      return key === undefined ? undefined : served.get(key)!.name;
    },
    nearestFace(family, request) {
      const key = servingKey(family);
      if (key === undefined) return undefined;
      const serving = servingFamily(key);
      if (!serving) return undefined;
      const to = nearestSource(serving.to.family, request);
      if (!to) return undefined;
      return serving.lineMetrics ? { to, lineMetrics: serving.lineMetrics } : { to };
    },
    suppliesOwnFaces: (family) => ownName(family) !== undefined,
    ownNearestFace(family, request) {
      const name = ownName(family);
      if (name === undefined) return undefined;
      const key = fold(family);
      const hosted = fold(name) === key ? served.get(key)?.faces : undefined;
      for (const [weight, style] of nearestFaceOrder(request.weight, request.style)) {
        const to = sources.get(fontRequestKey({ family: name, weight, style }));
        if (to) return { to };
        // Paint holds this face only when the browser loads the whole composite alias; when it
        // does not, paint falls back to the own alias (best effort) while this stays the answer.
        const from = { family, weight, style };
        const host = hosted?.get(fontRequestKey({ ...from, family: key }));
        if (host && isOwnFamilyHostFace(from, host.to)) return host;
      }
      return undefined;
    },
  };
}
