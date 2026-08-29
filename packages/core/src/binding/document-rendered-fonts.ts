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

import type { OoxmlElement, OoxmlNode } from '../store/package/ooxml-tree.ts';
import { WML_NAMESPACE_URI } from '../store/package/ooxml-shared.ts';
import type { DocumentThemeFonts } from './document-theme.ts';
import { familyFromRFonts, validStyleId } from './document-run-defaults.ts';

/** `basedOn` walk cap, matching `document-run-defaults`. */
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
 * marks, symbol runs (their `w:font` face is a pre-existing `collectDocumentFonts` gap,
 * but the run's own `w:rFonts`/`w:rStyle` still resolve the surrounding face), tabs
 * (leader dots measure in the run face) and hyphens. `w:br` paints nothing;
 * `w:instrText` is never painted — the field RESULT runs are.
 */
const GLYPH_MARKS: ReadonlySet<string> = new Set([
  'sym',
  'tab',
  'noBreakHyphen',
  'softHyphen',
  'footnoteRef',
  'endnoteRef',
  'footnoteReference',
  'endnoteReference',
]);

/**
 * Whether a `w:r` puts a glyph on the page: a non-empty `w:t`, a `w:delText` (tracked
 * deletions render in markup view — over-reporting in final view, never hiding), or a
 * glyph mark element.
 */
function runRendersGlyphs(run: OoxmlElement): boolean {
  for (const child of run.children as readonly OoxmlNode[]) {
    if (!isElement(child) || child.namespaceUri !== WML_NAMESPACE_URI) continue;
    if (GLYPH_MARKS.has(child.localName)) return true;
    if (child.localName !== 't' && child.localName !== 'delText') continue;
    for (const grand of child.children as readonly OoxmlNode[]) {
      if (!isElement(grand) && grand.value.length > 0) return true;
    }
  }
  return false;
}

/** Whether any descendant `w:r` renders glyphs — the terminal-path block answer. */
function subtreeHasGlyphRun(subtree: OoxmlElement): boolean {
  const stack: OoxmlNode[] = [subtree];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (!isElement(node)) continue;
    if (node.localName === 'r' && node.namespaceUri === WML_NAMESPACE_URI) {
      if (runRendersGlyphs(node)) return true;
      continue;
    }
    for (const child of node.children as readonly OoxmlNode[]) stack.push(child);
  }
  return false;
}

function applyRun(
  run: OoxmlElement,
  summary: MutableSummary,
  themeFonts: DocumentThemeFonts
): void {
  if (!runRendersGlyphs(run)) return;
  summary.anyText = true;
  const rPr = childElement(run, 'rPr');
  const rFonts = rPr ? childElement(rPr, 'rFonts') : undefined;
  if (rFonts) addFamily(summary.families, familyFromRFonts(rFonts, themeFonts));
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
  containsText: boolean
): void {
  if (node.namespaceUri !== WML_NAMESPACE_URI) return;
  if (node.localName === 'r') applyRun(node, summary, themeFonts);
  else if (isStyledBlock(node)) applyBlock(node, summary, containsText);
}

interface SummaryMemo {
  readonly major: string | null;
  readonly minor: string | null;
  readonly summary: RenderedFontsSummary;
}
const summaryMemos = new WeakMap<OoxmlElement, SummaryMemo>();

function summaryOf(
  subtree: OoxmlElement,
  themeFonts: DocumentThemeFonts,
  depth: number
): RenderedFontsSummary {
  const cached = summaryMemos.get(subtree);
  if (cached && cached.major === themeFonts.major && cached.minor === themeFonts.minor) {
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
  summaryMemos.set(subtree, { major: themeFonts.major, minor: themeFonts.minor, summary });
  return summary;
}

// ── Styles part index ────────────────────────────────────────────────────────────────────

interface StyleIndexEntry {
  readonly basedOn: string | null;
  readonly family: string | null;
  /** Families named by `w:tblStylePr` conditional-format `w:rPr/w:rFonts`. */
  readonly conditionalFamilies: readonly string[];
}

interface StyleIndex {
  readonly docDefaultFamily: string | null;
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
  docDefaultFamily: null,
  defaultParagraph: null,
  defaultCharacter: null,
  defaultTable: null,
  chainFamilies: () => [],
};

interface StyleIndexMemo {
  readonly major: string | null;
  readonly minor: string | null;
  readonly index: StyleIndex;
}
const styleIndexMemos = new WeakMap<OoxmlElement, StyleIndexMemo>();

function rPrFamily(container: OoxmlElement, themeFonts: DocumentThemeFonts): string | null {
  const rPr = childElement(container, 'rPr');
  const rFonts = rPr ? childElement(rPr, 'rFonts') : undefined;
  return rFonts ? familyFromRFonts(rFonts, themeFonts) : null;
}

function buildStyleIndex(stylesRoot: OoxmlElement, themeFonts: DocumentThemeFonts): StyleIndex {
  const entries = new Map<string, StyleIndexEntry>();
  let docDefaultFamily: string | null = null;
  let defaultParagraph: string | null = null;
  let defaultCharacter: string | null = null;
  let defaultTable: string | null = null;

  const docDefaults = childElement(stylesRoot, 'docDefaults');
  const rPrDefault = docDefaults ? childElement(docDefaults, 'rPrDefault') : undefined;
  if (rPrDefault) docDefaultFamily = rPrFamily(rPrDefault, themeFonts);

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
    }
    // Last duplicate wins, and a later duplicate that is not the default CLEARS a default
    // the earlier one claimed — both matching `buildStyleCascadeTable` in
    // `layout/style-cascade.ts`, so the notice checks the definition layout paints from.
    entries.set(styleId, {
      basedOn: validStyleId(basedOnElement ? attributeValue(basedOnElement, 'val') : undefined),
      family: rPrFamily(child, themeFonts),
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
    const seen = new Set<string>();
    let at: string | null = styleId;
    for (let hop = 0; at !== null && hop < CHAIN_CAP && !seen.has(at); hop += 1) {
      seen.add(at);
      const entry = entries.get(at);
      if (!entry) break;
      nearest ??= entry.family;
      families.push(...entry.conditionalFamilies);
      at = entry.basedOn;
    }
    if (nearest !== null) families.unshift(nearest);
    chainMemo.set(styleId, families);
    return families;
  };

  return { docDefaultFamily, defaultParagraph, defaultCharacter, defaultTable, chainFamilies };
}

function styleIndexOf(stylesRoot: OoxmlElement | null, themeFonts: DocumentThemeFonts): StyleIndex {
  if (!stylesRoot) return EMPTY_STYLE_INDEX;
  const cached = styleIndexMemos.get(stylesRoot);
  if (cached && cached.major === themeFonts.major && cached.minor === themeFonts.minor) {
    return cached.index;
  }
  const index = buildStyleIndex(stylesRoot, themeFonts);
  styleIndexMemos.set(stylesRoot, { major: themeFonts.major, minor: themeFonts.minor, index });
  return index;
}

// ── Entry point ──────────────────────────────────────────────────────────────────────────

/**
 * The font families the document's rendered text resolves to, over the STORY roots (body,
 * headers/footers, notes — never the styles part itself): validated, deduplicated
 * case-insensitively (first-seen casing wins), sorted by code point. A document that
 * renders no character answers `[]`, whatever it declares.
 */
export function collectRenderedFontFamilies(
  storyRoots: readonly OoxmlElement[],
  stylesRoot: OoxmlElement | null,
  themeFonts: DocumentThemeFonts
): readonly string[] {
  const summary = createSummary();
  for (const root of storyRoots) {
    // The root element is never a run or a styled block; its children carry the memo.
    for (const child of root.children as readonly OoxmlNode[]) {
      if (!isElement(child)) continue;
      mergeSummary(summary, summaryOf(child, themeFonts, 0));
    }
  }

  const index = styleIndexOf(stylesRoot, themeFonts);
  const byFold = new Map<string, string>();
  for (const family of summary.families.values()) addFamily(byFold, family);
  for (const styleId of summary.styleIds) {
    for (const family of index.chainFamilies(styleId)) addFamily(byFold, family);
  }
  if (summary.bareParagraph) {
    for (const family of index.chainFamilies(index.defaultParagraph)) addFamily(byFold, family);
  }
  if (summary.bareRun) {
    for (const family of index.chainFamilies(index.defaultCharacter)) addFamily(byFold, family);
  }
  if (summary.bareTable) {
    for (const family of index.chainFamilies(index.defaultTable)) addFamily(byFold, family);
  }
  if (summary.anyText) addFamily(byFold, index.docDefaultFamily);

  const families = [...byFold.values()];
  families.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return families;
}
