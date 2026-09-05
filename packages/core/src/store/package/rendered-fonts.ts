// Which font families the document's RENDERED text resolves to.
//
// `collectDocumentFonts` answers what the document DECLARES — every `w:rFonts` anywhere,
// including styles no paragraph references. That is what a font picker wants and exactly
// what a substitution notice must not use: Word writes latent styles (`BalloonText` names
// Segoe UI in nearly every file) into documents that never render a character in them, and
// a notice built on declarations warns about faces with no glyph behind them.
//
// This derivation mirrors what layout will actually ask the measurer for. A run renders in
// ONE Latin family (`run-style.ts`: theme slot ?? `w:ascii` ?? `w:hAnsi`), resolved through
// the cascade layout applies: direct run `w:rFonts`, the `w:rStyle` chain, the `w:pStyle`
// chain, the enclosing table's `w:tblStyle` chain, then `w:docDefaults` — with the
// `w:default="1"` style of each type standing in where the reference is absent
// (`style-cascade.ts` resolves absent `pStyle`/`rStyle`/`tblStyle` the same way).
//
// Deliberate bounds, all on the over-reporting side, never hiding a rendered face:
// - The chains of every USED style contribute even when a nearer level overrides them, and
//   `docDefaults` contributes whenever any text renders. Tracking per-run fall-through
//   would re-run the full cascade here; a shadowed family is at worst a spurious notice
//   entry, and in practice `docDefaults` names a covered Word default.
// - A used table style contributes its `w:tblStylePr` conditional-format families without
//   evaluating `w:tblLook` — a first-row face usually does render.
// - Only paragraphs, runs and tables that contain a GLYPH-BEARING run count — literal
//   `w:t`/`w:delText` text or a mark element the run's face paints (`w:footnoteRef`,
//   `w:sym`, `w:tab`, …). An empty paragraph's mark metrics do move layout, but the
//   notice's contract is "text renders in the wrong face".

import type { OoxmlElement, OoxmlNode } from './ooxml-tree.ts';
import { WML_NAMESPACE_URI } from './ooxml-shared.ts';
import type { DocumentThemeFonts } from './theme-font-scheme.ts';
import {
  eastAsiaFamilyFromRFonts,
  familyFromRFonts,
  validFontFamily,
  validStyleId,
} from './run-defaults.ts';

/** `basedOn` walk cap, matching `run-defaults`. */
const CHAIN_CAP = 16;
/**
 * Containers at least this wide compose from their children's memos instead of walking —
 * the same shape as `collectDocumentFonts`, so a keystroke re-derives only the edited path.
 */
const COMPOSE_CHILD_THRESHOLD = 16;
/** Compose recursion stops here; deeper subtrees take the iterative terminal walk. */
const MAX_COMPOSE_DEPTH = 32;
/**
 * Direct `w:style` children cap — the same bound as `MAX_STYLE_DEFINITIONS` in
 * `layout/style-cascade.ts` (kept by value: `binding` does not import the layout lane).
 */
const MAX_STYLE_DEFINITIONS = 4096;

function isElement(node: OoxmlNode): node is OoxmlElement {
  return node.kind !== 'textValue';
}

function childElement(parent: OoxmlElement, localName: string): OoxmlElement | undefined {
  for (const child of parent.children as readonly OoxmlNode[]) {
    if (isElement(child) && child.localName === localName) return child;
  }
  return undefined;
}

function attributeValue(node: OoxmlElement, localName: string): string | undefined {
  return node.attributes.find((attribute) => attribute.localName === localName)?.value;
}

/** `w:style/@w:default` — `ST_OnOff`, so `on` is legal alongside `1` and `true`. */
function isDefaultFlag(value: string | undefined): boolean {
  return value === '1' || value === 'true' || value === 'on';
}

/** What one subtree's rendered text uses. Composes by union across sibling subtrees. */
interface RenderedFontsSummary {
  /** Case-fold → first-seen spelling, from the direct `w:rFonts` of text-bearing runs. */
  readonly families: ReadonlyMap<string, string>;
  /**
   * Style ids referenced where text renders: `w:rStyle` of text runs, `w:pStyle` of text
   * paragraphs, `w:tblStyle` of tables containing text.
   */
  readonly styleIds: ReadonlySet<string>;
  /** Any glyph-bearing run in the subtree ({@link runRendersGlyphs}). */
  readonly anyText: boolean;
  /** A text paragraph without `w:pStyle` — the default paragraph style stands in. */
  readonly bareParagraph: boolean;
  /** A text run without `w:rStyle` — the default character style stands in. */
  readonly bareRun: boolean;
  /** A text-bearing table without `w:tblStyle` — the default table style stands in. */
  readonly bareTable: boolean;
}

interface MutableSummary {
  families: Map<string, string>;
  styleIds: Set<string>;
  anyText: boolean;
  bareParagraph: boolean;
  bareRun: boolean;
  bareTable: boolean;
}

function createSummary(): MutableSummary {
  return {
    families: new Map(),
    styleIds: new Set(),
    anyText: false,
    bareParagraph: false,
    bareRun: false,
    bareTable: false,
  };
}

function mergeSummary(into: MutableSummary, from: RenderedFontsSummary): void {
  for (const [fold, family] of from.families) {
    if (!into.families.has(fold)) into.families.set(fold, family);
  }
  for (const id of from.styleIds) into.styleIds.add(id);
  into.anyText ||= from.anyText;
  into.bareParagraph ||= from.bareParagraph;
  into.bareRun ||= from.bareRun;
  into.bareTable ||= from.bareTable;
}

function addFamily(families: Map<string, string>, family: string | null): void {
  // `familyFromRFonts` (and the style index built on it) already validated the name.
  if (family === null) return;
  const fold = family.toLowerCase();
  if (!families.has(fold)) families.set(fold, family);
}

/**
 * Run children that paint a glyph in the RUN's face without carrying text: note reference
 * marks, tabs (leader dots measure in the run face) and hyphens. `w:br` paints nothing;
 * `w:instrText` is never painted — the field RESULT runs are.
 *
 * `w:sym` is NOT one of them when it names a face of its own. `layout/symbol-run.ts`
 * overrides the run's `rFonts` with `w:sym/@w:font`, so the run's own face draws nothing
 * there — and Word writes that face on the run as well (a checkbox content control is
 * `w:rFonts ascii="MS Gothic"` beside `w:sym w:font="MS Gothic"`), which would put a
 * symbol face in this answer through the back door. It is ONE glyph whose code point
 * `layout/symbol-encoding.ts` resolves to a real Unicode character wherever it can, so the
 * fallback stack draws the character the author meant, and a notice naming the face would
 * report a fidelity loss the reader cannot see.
 *
 * A code point that table cannot map does paint as a tofu box without the authored face —
 * but the answer to that is supplying the face, not a notice. This module's contract is
 * text rendering in the wrong face, and the notice can only name families a font
 * configuration could cover. So the faces a resolver should TRY for a symbol are collected
 * separately (`collectSymbolFontFamilies`, and the export lane's own walk), and the editor
 * asks for them.
 *
 * A `w:sym` with no usable `@w:font` is the other case: nothing overrides the run, so the
 * glyph really does paint in the run's face, and the run counts like any other.
 */
const GLYPH_MARKS: ReadonlySet<string> = new Set([
  'tab',
  'noBreakHyphen',
  'softHyphen',
  'footnoteRef',
  'endnoteRef',
  'footnoteReference',
  'endnoteReference',
]);

/**
 * The face a `w:sym` overrides the run with, or null when it names none and the glyph
 * paints in the run's own face.
 *
 * Read exactly as `layout/symbol-run.ts` reads it — the WML namespace or none, since
 * unprefixed attributes on WML elements are common in authored packages. A looser match
 * would drop a run this module must report: layout would keep the run's `rFonts` while
 * this answer decided a symbol face had replaced it.
 */
function symbolFontOf(sym: OoxmlElement): string | null {
  for (const attribute of sym.attributes) {
    if (attribute.localName !== 'font') continue;
    if (attribute.namespaceUri !== WML_NAMESPACE_URI && attribute.namespaceUri !== '') continue;
    return validFontFamily(attribute.value);
  }
  return null;
}

/**
 * Whether a `w:r` puts a glyph on the page IN ITS OWN FACE: a non-empty `w:t`, a
 * `w:delText` (tracked deletions render in markup view — over-reporting in final view,
 * never hiding), a glyph mark element, or a `w:sym` that names no face of its own.
 */
function runRendersGlyphs(run: OoxmlElement, projectedGlyphIds?: ReadonlySet<string>): boolean {
  if (projectedGlyphIds?.has(run.id)) return true;
  for (const child of run.children as readonly OoxmlNode[]) {
    if (!isElement(child) || child.namespaceUri !== WML_NAMESPACE_URI) continue;
    if (GLYPH_MARKS.has(child.localName)) return true;
    if (child.localName === 'sym') {
      if (symbolFontOf(child) === null) return true;
      continue;
    }
    if (child.localName !== 't' && child.localName !== 'delText') continue;
    for (const grand of child.children as readonly OoxmlNode[]) {
      if (!isElement(grand) && grand.value.length > 0) return true;
    }
  }
  return false;
}

/**
 * Whether the run's text contains a codepoint Word resolves through `w:eastAsia`.
 *
 * The block set mirrors the East Asian scripts in `layout/script-itemization.ts` (Han,
 * Kana, Hangul, Bopomofo, their extensions, and full/half-width forms), which the binding
 * lane may not import. CJK-locale Office builds stamp a `w:eastAsia` theme face on nearly
 * every run, so without this gate a Latin-only document reports a CJK family as rendered.
 */
function runHasEastAsianText(run: OoxmlElement): boolean {
  for (const child of run.children as readonly OoxmlNode[]) {
    if (!isElement(child) || child.namespaceUri !== WML_NAMESPACE_URI) continue;
    if (child.localName !== 't' && child.localName !== 'delText') continue;
    for (const grand of child.children as readonly OoxmlNode[]) {
      if (isElement(grand)) continue;
      for (const character of grand.value) {
        const codePoint = character.codePointAt(0)!;
        if (
          (codePoint >= 0x1100 && codePoint <= 0x11ff) || // Hangul Jamo
          (codePoint >= 0x2e80 && codePoint <= 0x9fff) || // CJK radicals through Unified Ideographs
          (codePoint >= 0xa960 && codePoint <= 0xa97f) || // Hangul Jamo Extended-A
          (codePoint >= 0xac00 && codePoint <= 0xd7ff) || // Hangul Syllables + Jamo Extended-B
          (codePoint >= 0xf900 && codePoint <= 0xfaff) || // CJK Compatibility Ideographs
          (codePoint >= 0xfe30 && codePoint <= 0xfe4f) || // CJK Compatibility Forms
          (codePoint >= 0xff00 && codePoint <= 0xffef) || // Full/half-width forms
          (codePoint >= 0x20000 && codePoint <= 0x3ffff) // CJK extension planes
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

/** Whether any descendant `w:r` renders glyphs — the terminal-path block answer. */
function subtreeHasGlyphRun(
  subtree: OoxmlElement,
  projectedGlyphIds?: ReadonlySet<string>
): boolean {
  const stack: OoxmlNode[] = [subtree];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (!isElement(node)) continue;
    if (projectedGlyphIds?.has(node.id)) return true;
    if (node.localName === 'r' && node.namespaceUri === WML_NAMESPACE_URI) {
      if (runRendersGlyphs(node, projectedGlyphIds)) return true;
      continue;
    }
    for (const child of node.children as readonly OoxmlNode[]) stack.push(child);
  }
  return false;
}

function applyRun(
  run: OoxmlElement,
  summary: MutableSummary,
  themeFonts: DocumentThemeFonts,
  projectedGlyphIds?: ReadonlySet<string>
): void {
  if (!runRendersGlyphs(run, projectedGlyphIds)) return;
  summary.anyText = true;
  const rPr = childElement(run, 'rPr');
  const rFonts = rPr ? childElement(rPr, 'rFonts') : undefined;
  if (rFonts) {
    addFamily(summary.families, familyFromRFonts(rFonts, themeFonts));
    if (runHasEastAsianText(run)) {
      addFamily(summary.families, eastAsiaFamilyFromRFonts(rFonts, themeFonts));
    }
  }
  const rStyle = rPr ? childElement(rPr, 'rStyle') : undefined;
  const styleId = validStyleId(rStyle ? attributeValue(rStyle, 'val') : undefined);
  if (styleId !== null) summary.styleIds.add(styleId);
  else summary.bareRun = true;
}

/**
 * Record a text-bearing paragraph's or table's style reference. `containsText` is the
 * subtree answer — merged child summaries on the compose path, a bounded early-exit scan
 * on the terminal path.
 */
function applyBlock(block: OoxmlElement, summary: MutableSummary, containsText: boolean): void {
  if (!containsText) return;
  summary.anyText = true;
  const isTable = block.localName === 'tbl';
  const properties = childElement(block, isTable ? 'tblPr' : 'pPr');
  const reference = properties
    ? childElement(properties, isTable ? 'tblStyle' : 'pStyle')
    : undefined;
  const styleId = validStyleId(reference ? attributeValue(reference, 'val') : undefined);
  if (styleId !== null) summary.styleIds.add(styleId);
  else if (isTable) summary.bareTable = true;
  else summary.bareParagraph = true;
}

function isStyledBlock(node: OoxmlElement): boolean {
  return (
    (node.localName === 'p' || node.localName === 'tbl') && node.namespaceUri === WML_NAMESPACE_URI
  );
}

function applyNode(
  node: OoxmlElement,
  summary: MutableSummary,
  themeFonts: DocumentThemeFonts,
  containsText: boolean,
  projectedGlyphIds?: ReadonlySet<string>
): void {
  if (node.namespaceUri !== WML_NAMESPACE_URI) return;
  if (projectedGlyphIds?.has(node.id) && node.localName === 'fldSimple') {
    summary.anyText = true;
    summary.bareRun = true;
  }
  if (node.localName === 'r') applyRun(node, summary, themeFonts, projectedGlyphIds);
  else if (isStyledBlock(node)) applyBlock(node, summary, containsText);
}

interface SummaryMemo {
  readonly major: string | null;
  readonly minor: string | null;
  readonly majorEastAsia: string | null;
  readonly minorEastAsia: string | null;
  readonly summary: RenderedFontsSummary;
}
const summaryMemos = new WeakMap<OoxmlElement, SummaryMemo>();

function summaryOf(
  subtree: OoxmlElement,
  themeFonts: DocumentThemeFonts,
  depth: number
): RenderedFontsSummary {
  const cached = summaryMemos.get(subtree);
  if (
    cached &&
    cached.major === themeFonts.major &&
    cached.minor === themeFonts.minor &&
    cached.majorEastAsia === themeFonts.majorEastAsia &&
    cached.minorEastAsia === themeFonts.minorEastAsia
  ) {
    return cached.summary;
  }
  const summary = createSummary();
  if (subtree.children.length >= COMPOSE_CHILD_THRESHOLD && depth < MAX_COMPOSE_DEPTH) {
    for (const child of subtree.children as readonly OoxmlNode[]) {
      if (!isElement(child)) continue;
      mergeSummary(summary, summaryOf(child, themeFonts, depth + 1));
    }
    applyNode(subtree, summary, themeFonts, summary.anyText);
  } else {
    // Iterative: the parse bounds tree depth, but this derivation must not be the one
    // place a deep generic subtree can overflow the call stack. Children push in reverse
    // so first-seen casing means the first occurrence a reader would see.
    const stack: OoxmlNode[] = [subtree];
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (!isElement(node)) continue;
      // Only the paragraph/table handler needs the subtree answer. The scan exits at the
      // first glyph-bearing run, so the common case reads one run — and it asks the SAME
      // question `applyRun` answers on the compose path, so a block's contribution never
      // depends on which path its child count selects.
      const containsText = isStyledBlock(node) && subtreeHasGlyphRun(node);
      applyNode(node, summary, themeFonts, containsText);
      for (let i = node.children.length - 1; i >= 0; i -= 1) stack.push(node.children[i]!);
    }
  }
  summaryMemos.set(subtree, {
    major: themeFonts.major,
    minor: themeFonts.minor,
    majorEastAsia: themeFonts.majorEastAsia,
    minorEastAsia: themeFonts.minorEastAsia,
    summary,
  });
  return summary;
}

// ── Styles part index ────────────────────────────────────────────────────────────────────

interface StyleIndexEntry {
  readonly basedOn: string | null;
  readonly family: string | null;
  readonly eastAsiaFamily: string | null;
  /** Families named by `w:tblStylePr` conditional-format `w:rPr/w:rFonts`. */
  readonly conditionalFamilies: readonly string[];
}

interface StyleIndex {
  readonly docDefaultFamilies: readonly string[];
  readonly defaultParagraph: string | null;
  readonly defaultCharacter: string | null;
  readonly defaultTable: string | null;
  /**
   * The families a style reference can render: the nearest `basedOn`-chain family (deeper
   * ones are shadowed for the Latin slot) plus every conditional-format family along the
   * chain. Cycle-safe, capped at {@link CHAIN_CAP}.
   */
  chainFamilies(styleId: string | null): readonly string[];
}

const EMPTY_STYLE_INDEX: StyleIndex = {
  docDefaultFamilies: [],
  defaultParagraph: null,
  defaultCharacter: null,
  defaultTable: null,
  chainFamilies: () => [],
};

interface StyleIndexMemo {
  readonly major: string | null;
  readonly minor: string | null;
  readonly majorEastAsia: string | null;
  readonly minorEastAsia: string | null;
  readonly index: StyleIndex;
}
const styleIndexMemos = new WeakMap<OoxmlElement, StyleIndexMemo>();

function rPrFamily(container: OoxmlElement, themeFonts: DocumentThemeFonts): string | null {
  const rPr = childElement(container, 'rPr');
  const rFonts = rPr ? childElement(rPr, 'rFonts') : undefined;
  return rFonts ? familyFromRFonts(rFonts, themeFonts) : null;
}

function rPrEastAsiaFamily(container: OoxmlElement, themeFonts: DocumentThemeFonts): string | null {
  const rPr = childElement(container, 'rPr');
  const rFonts = rPr ? childElement(rPr, 'rFonts') : undefined;
  return rFonts ? eastAsiaFamilyFromRFonts(rFonts, themeFonts) : null;
}

function buildStyleIndex(stylesRoot: OoxmlElement, themeFonts: DocumentThemeFonts): StyleIndex {
  const entries = new Map<string, StyleIndexEntry>();
  let docDefaultFamily: string | null = null;
  let docDefaultEastAsiaFamily: string | null = null;
  let defaultParagraph: string | null = null;
  let defaultCharacter: string | null = null;
  let defaultTable: string | null = null;

  const docDefaults = childElement(stylesRoot, 'docDefaults');
  const rPrDefault = docDefaults ? childElement(docDefaults, 'rPrDefault') : undefined;
  if (rPrDefault) {
    docDefaultFamily = rPrFamily(rPrDefault, themeFonts);
    docDefaultEastAsiaFamily = rPrEastAsiaFamily(rPrDefault, themeFonts);
  }

  let counted = 0;
  for (const child of stylesRoot.children as readonly OoxmlNode[]) {
    if (!isElement(child) || child.localName !== 'style') continue;
    if (counted >= MAX_STYLE_DEFINITIONS) break;
    counted += 1;
    const styleId = validStyleId(attributeValue(child, 'styleId'));
    if (styleId === null) continue;
    const basedOnElement = childElement(child, 'basedOn');
    const conditionalFamilies: string[] = [];
    for (const condition of child.children as readonly OoxmlNode[]) {
      if (!isElement(condition) || condition.localName !== 'tblStylePr') continue;
      const family = rPrFamily(condition, themeFonts);
      if (family !== null) conditionalFamilies.push(family);
      const eastAsiaFamily = rPrEastAsiaFamily(condition, themeFonts);
      if (eastAsiaFamily !== null) conditionalFamilies.push(eastAsiaFamily);
    }
    // Last duplicate wins, and a later duplicate that is not the default CLEARS a default
    // the earlier one claimed — both matching `buildStyleCascadeTable` in
    // `layout/style-cascade.ts`, so the notice checks the definition layout paints from.
    entries.set(styleId, {
      basedOn: validStyleId(basedOnElement ? attributeValue(basedOnElement, 'val') : undefined),
      family: rPrFamily(child, themeFonts),
      eastAsiaFamily: rPrEastAsiaFamily(child, themeFonts),
      conditionalFamilies,
    });
    const isDefault = isDefaultFlag(attributeValue(child, 'default'));
    const type = attributeValue(child, 'type');
    if (type === 'paragraph') {
      if (isDefault) defaultParagraph = styleId;
      else if (defaultParagraph === styleId) defaultParagraph = null;
    } else if (type === 'character') {
      if (isDefault) defaultCharacter = styleId;
      else if (defaultCharacter === styleId) defaultCharacter = null;
    } else if (type === 'table') {
      if (isDefault) defaultTable = styleId;
      else if (defaultTable === styleId) defaultTable = null;
    }
  }

  const chainMemo = new Map<string, readonly string[]>();
  const chainFamilies = (styleId: string | null): readonly string[] => {
    if (styleId === null) return [];
    const cached = chainMemo.get(styleId);
    if (cached) return cached;
    const families: string[] = [];
    let nearest: string | null = null;
    let nearestEastAsia: string | null = null;
    const seen = new Set<string>();
    let at: string | null = styleId;
    for (let hop = 0; at !== null && hop < CHAIN_CAP && !seen.has(at); hop += 1) {
      seen.add(at);
      const entry = entries.get(at);
      if (!entry) break;
      nearest ??= entry.family;
      nearestEastAsia ??= entry.eastAsiaFamily;
      families.push(...entry.conditionalFamilies);
      at = entry.basedOn;
    }
    if (nearest !== null) families.unshift(nearest);
    if (nearestEastAsia !== null) families.unshift(nearestEastAsia);
    chainMemo.set(styleId, families);
    return families;
  };

  const docDefaultFamilies = [docDefaultFamily, docDefaultEastAsiaFamily].filter(
    (family): family is string => family !== null
  );
  return {
    docDefaultFamilies,
    defaultParagraph,
    defaultCharacter,
    defaultTable,
    chainFamilies,
  };
}

function styleIndexOf(stylesRoot: OoxmlElement | null, themeFonts: DocumentThemeFonts): StyleIndex {
  if (!stylesRoot) return EMPTY_STYLE_INDEX;
  const cached = styleIndexMemos.get(stylesRoot);
  if (
    cached &&
    cached.major === themeFonts.major &&
    cached.minor === themeFonts.minor &&
    cached.majorEastAsia === themeFonts.majorEastAsia &&
    cached.minorEastAsia === themeFonts.minorEastAsia
  ) {
    return cached.index;
  }
  const index = buildStyleIndex(stylesRoot, themeFonts);
  styleIndexMemos.set(stylesRoot, {
    major: themeFonts.major,
    minor: themeFonts.minor,
    majorEastAsia: themeFonts.majorEastAsia,
    minorEastAsia: themeFonts.minorEastAsia,
    index,
  });
  return index;
}

// ── Entry point ──────────────────────────────────────────────────────────────────────────

/**
 * The font families the document's rendered text resolves to, over the STORY roots (body,
 * headers/footers, notes — never the styles part itself): validated, deduplicated
 * case-insensitively (first-seen casing wins), sorted by code point. A document that
 * renders no character answers `[]`, whatever it declares.
 */
export interface RenderedFontFamilyCandidates {
  /** Families named directly by glyph-bearing runs, in story/read priority. */
  readonly direct: readonly string[];
  /** Families contributed by active style/default cascades but not already direct. */
  readonly inherited: readonly string[];
}

/** Rendered-family candidates split into cap-safe direct and inherited priority tiers. */
export function collectRenderedFontFamilyCandidates(
  storyRoots: readonly OoxmlElement[],
  stylesRoot: OoxmlElement | null,
  themeFonts: DocumentThemeFonts,
  /** Nodes whose glyphs are synthesized by layout rather than stored as literal text. @internal */
  projectedGlyphIds?: ReadonlySet<string>
): RenderedFontFamilyCandidates {
  const summary = createSummary();
  const directByFold = new Map<string, string>();
  for (const root of storyRoots) {
    const rootSummary = createSummary();
    // The root element is never a run or a styled block; its children carry the memo.
    for (const child of root.children as readonly OoxmlNode[]) {
      if (!isElement(child)) continue;
      if (!projectedGlyphIds || projectedGlyphIds.size === 0) {
        mergeSummary(rootSummary, summaryOf(child, themeFonts, 0));
        continue;
      }
      const projectedSummary = createSummary();
      const stack: OoxmlNode[] = [child];
      while (stack.length > 0) {
        const node = stack.pop()!;
        if (!isElement(node)) continue;
        const containsText = isStyledBlock(node) && subtreeHasGlyphRun(node, projectedGlyphIds);
        applyNode(node, projectedSummary, themeFonts, containsText, projectedGlyphIds);
        for (let index = node.children.length - 1; index >= 0; index -= 1) {
          stack.push(node.children[index]!);
        }
      }
      mergeSummary(rootSummary, projectedSummary);
    }
    mergeSummary(summary, rootSummary);
    for (const family of rootSummary.families.values()) addFamily(directByFold, family);
  }

  const index = styleIndexOf(stylesRoot, themeFonts);
  const inheritedByFold = new Map<string, string>();
  for (const styleId of summary.styleIds) {
    for (const family of index.chainFamilies(styleId)) addFamily(inheritedByFold, family);
  }
  if (summary.bareParagraph) {
    for (const family of index.chainFamilies(index.defaultParagraph)) {
      addFamily(inheritedByFold, family);
    }
  }
  if (summary.bareRun) {
    for (const family of index.chainFamilies(index.defaultCharacter)) {
      addFamily(inheritedByFold, family);
    }
  }
  if (summary.bareTable) {
    for (const family of index.chainFamilies(index.defaultTable))
      addFamily(inheritedByFold, family);
  }
  if (summary.anyText) {
    for (const family of index.docDefaultFamilies) addFamily(inheritedByFold, family);
  }

  for (const fold of directByFold.keys()) inheritedByFold.delete(fold);
  const inherited = [...inheritedByFold.values()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return Object.freeze({
    direct: Object.freeze([...directByFold.values()]),
    inherited: Object.freeze(inherited),
  });
}

export function collectRenderedFontFamilies(
  storyRoots: readonly OoxmlElement[],
  stylesRoot: OoxmlElement | null,
  themeFonts: DocumentThemeFonts
): readonly string[] {
  const candidates = collectRenderedFontFamilyCandidates(storyRoots, stylesRoot, themeFonts);
  const families = [...candidates.direct, ...candidates.inherited];
  families.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return families;
}
