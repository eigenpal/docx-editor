import { recordedLineBoxFamily } from './authored-line-boxes.ts';
import type {
  FontConfiguration,
  FontFaceRequest,
  FontSourceSubstitution,
} from '../contracts/editor.ts';
import { plannedFontFaces } from './planned-font-faces.ts';
import type { HeadlessDocumentView } from '../store/headless-document-view.ts';
import { fontTableAlternates, fontTableClasses } from '../store/package/font-table-alternates.ts';
import {
  CLASS_FALLBACK_FAMILIES,
  fontFamilyClassFromName,
  type FontFamilyClass,
} from '../store/package/font-family-class.ts';
import { fontFamilyName, paintedFontFamilyName } from '../store/package/font-family-name.ts';
import type { OoxmlElement, OoxmlNode } from '../store/package/ooxml-tree.ts';
import { WML_NAMESPACE_URI } from '../store/package/ooxml-shared.ts';
import { SYMBOL_ENCODED_FAMILIES } from '../store/package/symbol-encoding.ts';
import { englishFamily } from '../store/package/default-font-faces.ts';
import { servedFontFamilies } from './served-font-families.ts';
import { applicationRunDefaults } from './application-run-defaults.ts';
import { readDocDefaults } from './style-definition-reader.ts';
import { resolveRunStyle } from './run-style.ts';
import { applyHAnsiFontSlots } from './hansi-font-slots.ts';
import {
  composeFontConfiguration,
  configuredDefaultFontFamily,
  MAX_RESOLVER_FAMILIES,
  type FontCatalogConfiguration,
} from './font-composition.ts';
import {
  fontRequestKey,
  HARD_MAX_FONT_SOURCES,
  FontResolutionError,
  type FontResourceSnapshot,
} from './font-resource.ts';

export interface DocumentFontSubstitutionPlan {
  readonly families: readonly string[];
  readonly alternates: ReadonlyMap<string, string>;
  readonly fallbacks: ReadonlyMap<string, string>;
  readonly ambiguousFamilies: readonly string[];
  /**
   * The families that can stand in for each requested family, case-folded key: its English
   * name, its font-table alternate, and its script or class defaults. A face that text uses
   * in a family needs the same face of these.
   */
  readonly standIns?: ReadonlyMap<string, readonly string[]>;
}

/** Report admitted document substitutions without reporting generic host metric twins. */
export function admittedDocumentSubstitutions(
  configuration: FontConfiguration,
  plan: DocumentFontSubstitutionPlan,
  snapshot: FontResourceSnapshot,
  /**
   * The host's own substitutions, before the document plan joined them. A family the host
   * maps itself (Helvetica to Liberation Sans) is served, not substituted by the document,
   * even when the plan's fallback happens to reach the same face.
   */
  hostSubstitutions: FontConfiguration['substitutions'] = []
): ReadonlySet<string> {
  const families = new Set<string>();
  const hostServed = new Set(
    (hostSubstitutions ?? []).map((substitution) => substitution.from.family.trim().toLowerCase())
  );
  // A document fallback named by its Word family reaches its face through the host's own
  // substitution (Times New Roman to Liberation Serif), so either name is the planned target.
  const hostTargets = new Map<string, string>();
  for (const substitution of configuration.substitutions ?? []) {
    const from = substitution.from.family.trim().toLowerCase();
    if (!hostTargets.has(from)) hostTargets.set(from, substitution.to.family.trim().toLowerCase());
  }
  for (const substitution of configuration.substitutions ?? []) {
    const key = substitution.from.family.trim().toLowerCase();
    const target = substitution.to.family.trim().toLowerCase();
    const documentTarget = [plan.alternates.get(key), plan.fallbacks.get(key)].some((candidate) => {
      const planned = candidate?.trim().toLowerCase();
      // A family planned onto itself (Calibri, the slot default) is the host's own metric
      // twin, not a document substitution.
      return (
        planned !== undefined &&
        planned !== key &&
        (planned === target || hostTargets.get(planned) === target)
      );
    });
    if (
      target !== key &&
      !hostServed.has(key) &&
      documentTarget &&
      !(snapshot.resolve(substitution.from) instanceof FontResolutionError)
    ) {
      families.add(substitution.from.family.toLowerCase());
    }
  }
  return families;
}

function wordAttribute(node: OoxmlElement, name: string): string | undefined {
  return node.attributes.find(
    (attribute) => attribute.localName === name && attribute.namespaceUri === WML_NAMESPACE_URI
  )?.value;
}

/** Root elements of the WordprocessingML parts that can carry `w:rFonts`. */
const RUN_FONT_PART_ROOTS = new Set([
  'document',
  'hdr',
  'ftr',
  'footnotes',
  'endnotes',
  'comments',
  'styles',
  'numbering',
  'glossaryDocument',
]);

/** Elements that hold only character data, so the scan never descends into them. */
const TEXT_ONLY_ELEMENTS = new Set(['t', 'delText', 'instrText', 'delInstrText']);

/** Bounds the script-default scan. The scanned prefix still yields its defaults. */
const MAX_SCRIPT_DEFAULT_SCAN_NODES = 2_000_000;

/** Avoid assigning one global substitute when a whole name needs different script defaults. */
function scriptDefaults(
  view: Pick<HeadlessDocumentView, 'currentPackage' | 'stylesRoot' | 'documentThemeFonts'>,
  defaultFamily: string
): {
  fallbacks: ReadonlyMap<string, string>;
  ambiguousFamilies: readonly string[];
  defaults: ReadonlyMap<string, readonly string[]>;
} {
  const styles = view.stylesRoot();
  const theme = view.documentThemeFonts();
  // Use the same format/application profile and authored cascade as layout.
  const props = [...applicationRunDefaults(styles), ...(styles ? readDocDefaults(styles).run : [])];
  const style = resolveRunStyle(props, theme);
  const latin = fontFamilyName(style.fontFamily ?? undefined) ?? defaultFamily;
  const highAnsi =
    fontFamilyName(
      applyHAnsiFontSlots([{ text: 'é', props, style, start: 0, end: 1 }], theme)[0]?.style
        .fontFamily ?? undefined
    ) ?? latin;
  const eastAsia = fontFamilyName(style.fontFamilyEastAsia ?? undefined);
  const complex =
    fontFamilyName(style.complexLane?.fontFamily ?? undefined) ?? theme.minorBidi ?? defaultFamily;
  // A missing Latin family falls back to a face of its own class: the slot default when that
  // is of the same class (or either class is unknown), else the class's standard face. A
  // serif family set in the document's sans-serif default changed the look of every line.
  const classes = fontTableClasses(view.currentPackage());
  const classOf = (family: string): FontFamilyClass | undefined =>
    classes.get(family.trim().toLowerCase()) ?? fontFamilyClassFromName(family);
  const latinTarget = (family: string, slotDefault: string): string => {
    const kind = classOf(family);
    if (!kind) return slotDefault;
    const defaultKind = classOf(slotDefault);
    return defaultKind === undefined || defaultKind === kind
      ? slotDefault
      : CLASS_FALLBACK_FAMILIES[kind];
  };
  const needs = new Map<string, Set<string>>();
  /** Targets from the Latin slots alone, for families of a known class. */
  const latinNeeds = new Map<string, Set<string>>();
  let inspected = 0;
  for (const part of view.currentPackage().parts.values()) {
    // Only story, style, and numbering parts carry run fonts. Charts, themes, and
    // custom XML never spend the scan budget.
    if (part.root.namespaceUri !== WML_NAMESPACE_URI) continue;
    if (!RUN_FONT_PART_ROOTS.has(part.root.localName)) continue;
    const stack: OoxmlNode[] = [part.root];
    // Past the budget, keep what the scanned prefix found instead of dropping every
    // script default. A family seen in one slot keeps that slot's default.
    while (stack.length > 0 && inspected < MAX_SCRIPT_DEFAULT_SCAN_NODES) {
      inspected++;
      const node = stack.pop()!;
      if (node.kind === 'textValue') continue;
      if (node.namespaceUri === WML_NAMESPACE_URI) {
        if (TEXT_ONLY_ELEMENTS.has(node.localName)) continue;
        if (node.localName === 'rFonts') {
          for (const [slot, target] of [
            ['ascii', latin],
            ['hAnsi', highAnsi],
            ['eastAsia', eastAsia],
            ['cs', complex],
          ] as const) {
            // The family the slot paints in: a list's first item, or the unmatched face.
            const family = fontFamilyName(
              paintedFontFamilyName(wordAttribute(node, slot)) ?? undefined
            );
            if (!family || !target) continue;
            const key = family.trim().toLowerCase();
            const targets = needs.get(key) ?? new Set<string>();
            const latinSlot = slot === 'ascii' || slot === 'hAnsi';
            const slotTarget = latinSlot ? latinTarget(family, target) : target;
            targets.add(slotTarget);
            needs.set(key, targets);
            if (latinSlot && classOf(family)) {
              const latinTargets = latinNeeds.get(key) ?? new Set<string>();
              latinTargets.add(slotTarget);
              latinNeeds.set(key, latinTargets);
            }
          }
          continue;
        }
      }
      for (const next of node.children) stack.push(next);
    }
  }
  // A symbol-encoded face draws private-use codes that no text face carries. A text default
  // would paint missing glyphs and size the line by the wrong face, so these stay unresolved.
  for (const family of SYMBOL_ENCODED_FAMILIES) needs.delete(family);
  const fallbacks = new Map<string, string>();
  const ambiguousFamilies: string[] = [];
  for (const [family, targets] of needs) {
    // One substitution serves every slot. Documents name a Latin face in all four slots, and
    // the slot defaults then disagree. When the family's class is known, its Latin slots
    // decide; leaving it ambiguous gave it no substitution at all, so its text was measured
    // in one face and painted in whatever face the platform picked.
    const latinTargets = latinNeeds.get(family);
    if (targets.size === 1) fallbacks.set(family, [...targets][0]!);
    else if (latinTargets?.size === 1) fallbacks.set(family, [...latinTargets][0]!);
    else ambiguousFamilies.push(family);
  }
  return {
    fallbacks,
    ambiguousFamilies,
    defaults: new Map([...needs].map(([family, targets]) => [family, [...targets]])),
  };
}

/** Request complete table aliases without interpreting punctuation as a list. */
export function documentFontSubstitutionPlan(
  view: Pick<HeadlessDocumentView, 'currentPackage' | 'stylesRoot' | 'documentThemeFonts'>,
  families: readonly string[],
  defaults: readonly string[] = [],
  defaultFamily = 'Calibri'
): DocumentFontSubstitutionPlan {
  const alternates = fontTableAlternates(view.currentPackage());
  const scripts = scriptDefaults(view, defaultFamily);
  const targets = families.flatMap((family) => {
    const alternate = alternates.get(family.trim().toLowerCase());
    return alternate ? [alternate] : [];
  });
  const requested = new Map<string, string>();
  // Origins already receive the Latin default through request.defaultFamily.
  const scriptRequests = families
    .flatMap((family) => scripts.defaults.get(family.trim().toLowerCase()) ?? [])
    .filter((family) => family.trim().toLowerCase() !== defaultFamily.trim().toLowerCase());
  const standIns = new Map<string, readonly string[]>();
  for (const family of families) {
    const key = family.trim().toLowerCase();
    const alternate = alternates.get(key);
    standIns.set(key, [
      englishFamily(family),
      ...(alternate ? [alternate] : []),
      ...(scripts.defaults.get(key) ?? []),
    ]);
  }
  for (const raw of [...families, ...targets, ...defaults, ...scriptRequests]) {
    const family = fontFamilyName(raw);
    if (family && !requested.has(family.trim().toLowerCase()))
      requested.set(family.trim().toLowerCase(), family);
    if (requested.size === MAX_RESOLVER_FAMILIES) break;
  }
  return {
    families: [...requested.values()],
    alternates,
    fallbacks: scripts.fallbacks,
    ambiguousFamilies: scripts.ambiguousFamilies,
    standIns,
  };
}

/**
 * Keep the resolver request and document fallback plan on the same configured default. The
 * request names `asked.families` and, with `asked.faces`, the faces of the planned families
 * (`plannedFontFaces`). The plan covers `asked.documentFamilies` too: a follow-up asks about a
 * few families, but the document's substitutions still cover every family it uses.
 */
export function documentFontResolutionRequest(
  view: Pick<HeadlessDocumentView, 'currentPackage' | 'stylesRoot' | 'documentThemeFonts'>,
  asked: {
    readonly families: readonly string[];
    readonly faces?: readonly FontFaceRequest[];
    readonly documentFamilies?: readonly string[];
  },
  configuration?: FontCatalogConfiguration
) {
  const defaultFamily = configuredDefaultFontFamily(configuration);
  const requested = documentFontSubstitutionPlan(view, asked.families, [], defaultFamily);
  const folded = new Set(asked.families.map((family) => family.trim().toLowerCase()));
  const plan = asked.documentFamilies?.some((family) => !folded.has(family.trim().toLowerCase()))
    ? documentFontSubstitutionPlan(
        view,
        [...asked.families, ...asked.documentFamilies],
        [],
        defaultFamily
      )
    : requested;
  const faces = asked.faces && plannedFontFaces(requested, defaultFamily, asked.faces);
  return {
    plan,
    request: { families: requested.families, defaultFamily, ...(faces ? { faces } : {}) },
  };
}

/** A direct face wins. A whole table alias precedes a host's generic substitute. */
export function applyDocumentFontSubstitutions(
  configuration: FontConfiguration,
  plan: DocumentFontSubstitutionPlan,
  fallbackFamilies: ReadonlyMap<string, string> = plan.fallbacks
): FontConfiguration {
  const sources = new Map(
    configuration.sources.map((source) => [fontRequestKey(source.request), source.request])
  );
  const substitutions: FontSourceSubstitution[] = [];
  const existing = new Set(
    (configuration.substitutions ?? []).map((substitution) => fontRequestKey(substitution.from))
  );
  // A fallback named by its Word family (Times New Roman, Calibri) reaches bytes through the
  // host's own substitution (Liberation Serif, Carlito), with that substitution's line box.
  // Looking for a source of the Word name alone dropped every such fallback, and the text
  // then painted in whatever face the browser picked.
  const hostSubstitutions = new Map(
    (configuration.substitutions ?? []).map((substitution) => [
      fontRequestKey(substitution.from),
      substitution,
    ])
  );
  const supply = (
    request: FontSourceSubstitution['from']
  ): Pick<FontSourceSubstitution, 'to' | 'lineMetrics'> | undefined => {
    const direct = sources.get(fontRequestKey(request));
    if (direct) return { to: direct };
    const hosted = hostSubstitutions.get(fontRequestKey(request));
    const target = hosted && sources.get(fontRequestKey(hosted.to));
    if (!hosted || !target) return undefined;
    return hosted.lineMetrics ? { to: target, lineMetrics: hosted.lineMetrics } : { to: target };
  };
  // A family that the configuration serves for any face is available, so it gets no class
  // fallback; see `served-font-families.ts`.
  const served = servedFontFamilies(configuration);
  const standIns = new Set<string>();
  let remaining = Math.max(0, HARD_MAX_FONT_SOURCES - existing.size);
  for (const family of plan.families) {
    const key = family.trim().toLowerCase();
    const alternate = plan.alternates.get(key);
    const fallback = fallbackFamilies.get(key);
    // A localized East Asian name (`メイリオ`) is its English family (`Meiryo`), so a face the
    // host supplies under that name comes before any other candidate.
    const english = englishFamily(family);
    const servingName = served.servingName(family);
    const servedElsewhere = servingName !== undefined && servingName.trim().toLowerCase() !== key;
    for (const weight of [400, 700]) {
      for (const style of ['normal', 'italic'] as const) {
        const from = { family, weight, style };
        if (sources.has(fontRequestKey(from))) continue;
        const push = (supplied: Pick<FontSourceSubstitution, 'to' | 'lineMetrics'>): boolean => {
          if (!existing.has(fontRequestKey(from))) {
            if (remaining === 0) return false;
            remaining--;
          }
          // A recorded family keeps its authored line box on the face that stands in for it.
          const authored = recordedLineBoxFamily(family)?.em;
          substitutions.push({ from, ...supplied, ...(authored ? { lineMetrics: authored } : {}) });
          return true;
        };
        if (served.suppliesOwnFaces(family)) {
          // A family with bytes under its own name paints through the alias of those bytes, so
          // a face that it lacks stands in through its own nearest face, as a synthesized
          // style. A host substitution for that exact face keeps the host's answer, although
          // paint still draws that face from the family's own alias.
          if (supply(from)) continue;
          const own = served.ownNearestFace(family, from);
          if (own && push(own) && (own.to.weight !== weight || own.to.style !== style))
            standIns.add(fontRequestKey(from));
          continue;
        }
        if (servingName === undefined) {
          // Nothing serves the family: its English name, its font table alternate, then its
          // class fallback, each directly or through the host's substitute for that name.
          for (const candidate of [english, alternate, fallback]) {
            if (!candidate || candidate.trim().toLowerCase() === key) continue;
            const supplied = supply({ family: candidate, weight, style });
            if (supplied) {
              push(supplied);
              break;
            }
          }
          continue;
        }
        // A served family takes a face that the document names directly (its English name or
        // its font table alternate, `w:altName`, `CT_String`, ECMA-376 Part 1, §17.8.3.1) first. An alternate that reaches bytes only
        // through a host's substitute does not count: one paint alias holds every face of the
        // family, so its other faces stand in through the family that serves it.
        const direct = [english, alternate]
          .filter((candidate) => !!candidate && candidate.trim().toLowerCase() !== key)
          .map((candidate) => sources.get(fontRequestKey({ family: candidate!, weight, style })))
          .find((found) => found !== undefined);
        if (direct) {
          push({ to: direct });
          continue;
        }
        // A face that the host serves under the document name keeps the host's answer.
        if (supply(from)) continue;
        const elsewhere = servedElsewhere
          ? supply({ family: servingName, weight, style })
          : undefined;
        const nearest = elsewhere ?? served.nearestFace(family, from);
        if (nearest && push(nearest) && !elsewhere) {
          const { weight: toWeight, style: toStyle } = nearest.to;
          if (toWeight !== weight || toStyle !== style) standIns.add(fontRequestKey(from));
        }
      }
    }
  }
  const result = composeFontConfiguration({
    ...configuration,
    substitutions: [...substitutions, ...(configuration.substitutions ?? [])],
  });
  if (standIns.size > 0) standInFacesOf.set(result, standIns);
  return result;
}

const standInFacesOf = new WeakMap<FontConfiguration, ReadonlySet<string>>();
const NO_STAND_INS: ReadonlySet<string> = new Set();

/**
 * The faces (`fontRequestKey`) that `applyDocumentFontSubstitutions` gave a synthesized stand-in
 * when it built `configuration`: another weight or style of the family that serves them, or of
 * the family's own faces. They measure and paint, so layout measures them with real metrics
 * (`TextMeasurer.hasMeasurableFont`). But no face of their own is installed: the probe for an
 * installed face (`TextMeasurer.hasResolvedFont`) must not count them, or a face that loads
 * later looks loaded already.
 */
export function documentStandInFaces(configuration: FontConfiguration): ReadonlySet<string> {
  return standInFacesOf.get(configuration) ?? NO_STAND_INS;
}

/**
 * Families whose fallback reached its face only through a host's substitute (a missing family,
 * to Times New Roman, to the host's Liberation Serif). Their text is drawn in a stand-in, so an
 * export reports them as uncovered, as it did before such fallbacks were followed.
 */
export function hostChainedDocumentFallbacks(
  before: FontConfiguration,
  after: FontConfiguration,
  plan: DocumentFontSubstitutionPlan
): ReadonlySet<string> {
  const existing = new Set(
    (before.substitutions ?? []).map((substitution) => fontRequestKey(substitution.from))
  );
  const served = servedFontFamilies(before);
  const families = new Set<string>();
  for (const substitution of after.substitutions ?? []) {
    if (existing.has(fontRequestKey(substitution.from))) continue;
    // A served family's other faces stand in through the family that serves it, not a fallback,
    // and a family with faces of its own stands in through those.
    if (
      served.servingName(substitution.from.family) !== undefined ||
      served.suppliesOwnFaces(substitution.from.family)
    )
      continue;
    const key = substitution.from.family.trim().toLowerCase();
    const target = substitution.to.family.trim().toLowerCase();
    const planned = [plan.alternates.get(key), plan.fallbacks.get(key)].some(
      (candidate) => candidate?.trim().toLowerCase() === target
    );
    if (!planned) families.add(key);
  }
  return families;
}

/**
 * Faces of served families that stand in through another weight or style of the serving family
 * (`fontRequestKey` of the document face). They draw as a synthesized style, so an export
 * reports them as evidence but not as coverage: strict export still refuses a family that lacks
 * a face.
 */
export function synthesizedServedFaces(
  before: FontConfiguration,
  after: FontConfiguration
): ReadonlySet<string> {
  const existing = new Set(
    (before.substitutions ?? []).map((substitution) => fontRequestKey(substitution.from))
  );
  const served = servedFontFamilies(before);
  const faces = new Set<string>();
  for (const { from, to } of after.substitutions ?? []) {
    if (existing.has(fontRequestKey(from))) continue;
    if (served.servingName(from.family) === undefined && !served.suppliesOwnFaces(from.family))
      continue;
    if (from.weight !== to.weight || from.style !== to.style) faces.add(fontRequestKey(from));
  }
  return faces;
}

/**
 * The plan's fallbacks without the families the platform has installed. A family the host
 * supplies no bytes for, but the platform draws itself, keeps its own face: measurement then
 * reads it through the browser, as paint does. Only a family that is missing falls back.
 */
export function fallbacksForMissingFamilies(
  fallbacks: ReadonlyMap<string, string>,
  installed: (family: string) => boolean
): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  for (const [family, target] of fallbacks) if (!installed(family)) out.set(family, target);
  return out;
}
