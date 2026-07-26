// Style resolution (document-engine section 6 / "Resolve authored formatting"). A
// DERIVED projection: given the canonical authored model, it computes the EFFECTIVE run
// formatting for a run by composing the OOXML formatting stack — never writing resolved
// values back into authored state (a run/paragraph that OMITS a property keeps omitting
// it; resolution only happens here, for layout/render).
//
// Run-property precedence, lowest to highest (later overrides):
//   docDefaults.rPr  ->  paragraph style rPr (basedOn chain, root->leaf)
//                    ->  character style rPr (basedOn chain)  ->  direct run rPr
// Within one layer/CT_Fonts slot, an authored theme attribute overrides the
// corresponding concrete font attribute; a higher layer still overrides both.
//
// styleId values come from an untrusted DOCX, so basedOn chains are cycle- and
// depth-guarded. This slice resolves authored run fonts, theme references, size,
// color, and toggles; paragraph-property resolution remains a separate concern.

import type {
  PackageModel,
  StyleRecord,
  RunProps,
  RunRecord,
  ParagraphRecord,
  RunFonts,
  ThemeFonts,
} from '../model/index.ts';

/** Cap on how far a basedOn chain is followed. Bounds work on a hostile styles.xml
 *  (deep or cyclic basedOn) — a real inheritance chain is only a few levels deep. */
const MAX_STYLE_DEPTH = 32;

/** Merge run formatting: every DEFINED field of `over` overrides `base` (including an
 *  explicit `false`); omitted fields fall through. Font slots additionally clear the
 *  inherited concrete/theme pair whenever either member is authored at the higher layer;
 *  same-layer concrete+theme values are retained until theme resolution applies theme precedence. */
const FONT_SLOTS = [
  ['ascii', 'asciiTheme'],
  ['hAnsi', 'hAnsiTheme'],
  ['eastAsia', 'eastAsiaTheme'],
  ['cs', 'csTheme'],
] as const;

function mergeFonts(base: RunFonts | undefined, over: RunFonts): RunFonts {
  const merged: Record<string, string> = { ...(base ?? {}) };
  for (const [familyKey, themeKey] of FONT_SLOTS) {
    if (over[familyKey] === undefined && over[themeKey] === undefined) continue;
    delete merged[familyKey];
    delete merged[themeKey];
    if (over[familyKey] !== undefined) merged[familyKey] = over[familyKey];
    if (over[themeKey] !== undefined) merged[themeKey] = over[themeKey];
  }
  return merged;
}

function merge(base: RunProps, over: RunProps | undefined): RunProps {
  if (!over) return base;
  return {
    ...base,
    ...over,
    ...(over.fonts ? { fonts: mergeFonts(base.fonts, over.fonts) } : {}),
  };
}

/** The formatting a run authors DIRECTLY (its rPr), excluding the non-formatting
 *  styleId link so a character-style reference never leaks in as a property. */
function directFormatting(props: RunProps): RunProps {
  const { styleId: _styleId, ...fmt } = props;
  return fmt;
}

function themeFamily(theme: ThemeFonts | undefined, reference: string): string | undefined {
  if (!theme) return undefined;
  switch (reference) {
    case 'majorAscii':
    case 'majorHAnsi':
      return theme.majorLatin;
    case 'minorAscii':
    case 'minorHAnsi':
      return theme.minorLatin;
    case 'majorEastAsia':
      return theme.majorEastAsia;
    case 'minorEastAsia':
      return theme.minorEastAsia;
    case 'majorBidi':
      return theme.majorComplexScript;
    case 'minorBidi':
      return theme.minorComplexScript;
    default:
      return undefined;
  }
}

/** Add concrete families derived from theme references without removing their
 * authored reference provenance. An explicit family always wins for its slot. */
function resolveThemeReferences(props: RunProps, theme: ThemeFonts | undefined): RunProps {
  if (!props.fonts) return props;
  const fonts: Record<string, string> = { ...props.fonts };
  for (const [familyKey, themeKey] of FONT_SLOTS) {
    const reference = props.fonts[themeKey];
    if (reference === undefined) continue;
    // In CT_Fonts, a theme attribute supersedes the corresponding concrete
    // attribute when both occur on the same effective property set.
    delete fonts[familyKey];
    const family = themeFamily(theme, reference);
    if (family) fonts[familyKey] = family;
  }
  return { ...props, fonts };
}

export interface StyleResolver {
  /** Effective run formatting for `run` inside `para`, per the precedence above. */
  runProps(para: ParagraphRecord, run: RunRecord): RunProps;
}

/** Build a resolver bound to a model. The per-style effective rPr (its full basedOn
 *  chain) is memoized, so resolving thousands of runs stays linear. */
export function createStyleResolver(model: PackageModel): StyleResolver {
  const styles = new Map<string, StyleRecord>();
  for (const s of model.styles) if (!styles.has(s.id)) styles.set(s.id, s);
  const docDefaults = model.docDefaults?.runProps ?? {};
  const memo = new Map<string, RunProps>();

  /** Effective rPr a style contributes, resolving basedOn root->leaf. Cycle/over-deep
   *  chains stop and contribute what was accumulated so far (fail-open to a subset, never
   *  loop). */
  function styleRunProps(styleId: string): RunProps {
    const cached = memo.get(styleId);
    if (cached) return cached;
    const chain: StyleRecord[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined = styleId;
    while (cursor && !seen.has(cursor) && chain.length < MAX_STYLE_DEPTH) {
      const style = styles.get(cursor);
      if (!style) break;
      seen.add(cursor);
      chain.push(style);
      cursor = style.basedOn;
    }
    // Apply from the root (last pushed) down to the requested style (first pushed) so a
    // derived style overrides its ancestors.
    let acc: RunProps = {};
    for (let i = chain.length - 1; i >= 0; i -= 1) acc = merge(acc, chain[i].runProps);
    memo.set(styleId, acc);
    return acc;
  }

  return {
    runProps(para, run) {
      let eff: RunProps = { ...docDefaults };
      const pStyle = para.props?.styleId;
      if (pStyle) eff = merge(eff, styleRunProps(pStyle));
      const cStyle = run.props?.styleId;
      if (cStyle) eff = merge(eff, styleRunProps(cStyle));
      if (run.props) eff = merge(eff, directFormatting(run.props));
      return resolveThemeReferences(eff, model.themeFonts);
    },
  };
}

/** Convenience one-shot resolve (builds a resolver per call — prefer
 *  {@link createStyleResolver} when resolving many runs). */
export function resolveRunProps(
  model: PackageModel,
  para: ParagraphRecord,
  run: RunRecord
): RunProps {
  return createStyleResolver(model).runProps(para, run);
}
