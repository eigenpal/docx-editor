// Families that the font configuration serves for at least one face.
//
// A host resolver gets the faces that text uses, so it often serves only some faces of a family.
// The font table class (`w:family`, `CT_FontFamily`, ECMA-376 Part 1, §17.8.3.9) locates a
// substitute only for a font that is not available, and a served family is available. Its
// other faces therefore stand in through the family that serves it, as a synthesized style of
// its nearest face, and never through the class fallback. One family then measures, paints,
// and exports every face of the document family.

import type { FontConfiguration, FontSourceSubstitution } from '../contracts/editor.ts';
import { englishFamily } from '../store/package/default-font-faces.ts';
import { fontRequestKey } from './font-resource.ts';

type Face = FontSourceSubstitution['from'];
type Supplied = Pick<FontSourceSubstitution, 'to' | 'lineMetrics'>;

const fold = (family: string): string => family.trim().toLowerCase();

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
   * family that serves `family`, else its nearest face. Style decides before weight, as CSS
   * font matching does when paint picks a face from the family's alias: the requested style at
   * the regular weight, then the requested weight upright, then the regular face. The renderer
   * synthesizes the missing bold or italic from it.
   */
  nearestFace(family: string, request: Face): Supplied | undefined;
}

export function servedFontFamilies(configuration: FontConfiguration): ServedFontFamilies {
  const sources = new Map(
    configuration.sources.map((source) => [fontRequestKey(source.request), source.request])
  );
  // Each family that a substitution serves, with the face that serves each of its faces. Only a
  // substitution that reaches bytes counts: a resolver names its targets before it fetches
  // them, and a failed fetch must not make a family look served. Bytes under the document's
  // own name (an embedded or explicit face) do not make the family served here: those faces
  // resolve directly, and their missing styles keep the planned fallback.
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
      const { weight, style } = request;
      for (const [w, s] of [
        [weight, style],
        [400, style],
        [weight, 'normal'],
        [400, 'normal'],
      ] as const) {
        const to = sources.get(fontRequestKey({ family: serving.to.family, weight: w, style: s }));
        if (to) return serving.lineMetrics ? { to, lineMetrics: serving.lineMetrics } : { to };
      }
      return undefined;
    },
  };
}
