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
// Each glyph-bearing run resolves on its own, in the order layout applies: the run's own
// `w:rFonts`, its `w:rStyle` chain, its paragraph's `w:pStyle` chain, its table's
// `w:tblStyle` chain, then `w:docDefaults`. A family a nearer level overrides is not
// reported, and an East Asian family counts only for a run whose text has East Asian
// characters. The `w:hAnsi` family resolves the same way, on its own, and counts only for a
// run whose text has a non-ASCII character layout can draw in it. Documents often name an
// East Asian theme face and a heading face in styles that Latin body text never draws with,
// and a notice listing those faces warns about nothing.
//
// Deliberate bounds, all on the over-reporting side, never hiding a rendered face:
// - A used table style contributes its `w:tblStylePr` conditional-format families without
//   evaluating `w:tblLook` — a first-row face usually does render.
// - Only paragraphs, runs and tables that contain a GLYPH-BEARING run count — literal
//   `w:t`/`w:delText` text or a mark element the run's face paints (`w:footnoteRef`,
//   `w:tab`, …). An empty paragraph's mark metrics do move layout, but the notice's
//   contract is "text renders in the wrong face". A `w:sym` naming a face of its own is
//   the one mark that does NOT count, because layout paints it in that face instead of the
//   run's — see `GLYPH_MARKS` below.

import type { OoxmlElement, OoxmlNode } from './ooxml-tree.ts';
import { WML_NAMESPACE_URI } from './ooxml-shared.ts';
import type { DocumentThemeFonts } from './theme-font-scheme.ts';
import {
  eastAsiaFamilyFromRFonts,
  familyFromRFonts,
  hAnsiFamilyFromRFonts,
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

/**
 * One glyph-bearing run's font inputs, with the paragraph and table context filled in on the
 * way up. `undefined` context is still open; `null` is a reference that is absent, so the
 * default style of the type stands in; `false` (tables only) is a run outside any table.
 */
interface RunProfile {
  /** The run's own Latin family from `w:rFonts`, or null when it names none. */
  readonly latin: string | null;
  /** The run's own East Asian family, or null. Read only when {@link hasEastAsian}. */
  readonly eastAsia: string | null;
  readonly hasEastAsian: boolean;
  /** The run's own `w:hAnsi` family, or null. Read only when {@link hasHAnsi}. */
  readonly hAnsi: string | null;
  /** Whether the run's text has a character layout can draw in the `w:hAnsi` face. */
  readonly hasHAnsi: boolean;
  readonly runStyle: string | null;
  readonly paragraphStyle?: string | null;
  readonly tableStyle?: string | null | false;
}

/** What one subtree's rendered text uses. Composes by union across sibling subtrees. */
interface RenderedFontsSummary {
  /** Distinct run profiles, keyed by {@link profileKey}. */
  readonly profiles: ReadonlyMap<string, RunProfile>;
}

interface MutableSummary {
  profiles: Map<string, RunProfile>;
}

function createSummary(): MutableSummary {
  return { profiles: new Map() };
}

function profileKey(profile: RunProfile): string {
  return JSON.stringify([
    profile.latin,
    profile.eastAsia,
    profile.hasEastAsian,
    profile.hAnsi,
    profile.hasHAnsi,
    profile.runStyle,
    profile.paragraphStyle === undefined ? 0 : profile.paragraphStyle,
    profile.tableStyle === undefined ? 0 : profile.tableStyle,
  ]);
}

function addProfile(into: MutableSummary, profile: RunProfile): void {
  const key = profileKey(profile);
  if (!into.profiles.has(key)) into.profiles.set(key, profile);
}

function mergeSummary(into: MutableSummary, from: RenderedFontsSummary): void {
  for (const [key, profile] of from.profiles) {
    if (!into.profiles.has(key)) into.profiles.set(key, profile);
  }
}

/** Fill the open paragraph or table context of every profile in `summary`. */
function closeContext(summary: MutableSummary, block: OoxmlElement): void {
  const isTable = block.localName === 'tbl';
  const properties = childElement(block, isTable ? 'tblPr' : 'pPr');
  const reference = properties
    ? childElement(properties, isTable ? 'tblStyle' : 'pStyle')
    : undefined;
  const styleId = validStyleId(reference ? attributeValue(reference, 'val') : undefined);
  const closed = new Map<string, RunProfile>();
  for (const profile of summary.profiles.values()) {
    const next =
      isTable && profile.tableStyle === undefined
        ? { ...profile, tableStyle: styleId }
        : !isTable && profile.paragraphStyle === undefined
          ? { ...profile, paragraphStyle: styleId }
          : profile;
    closed.set(profileKey(next), next);
  }
  summary.profiles = closed;
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
 * `layout/symbol-run.ts`'s `MAX_SYMBOL_FONT_LENGTH`, kept by value: the store lane does not
 * import layout, and this question is about what layout will DO, not what a name may be.
 *
 * Exported so a test can pin the two together. A silent drift would make a name in the gap
 * an override to one lane and not the other, and the run's real face would then be wrongly
 * kept in this answer or wrongly dropped from it, with nothing failing.
 */
export const MAX_SYMBOL_FONT_LENGTH = 128;

/**
 * Whether a `w:sym` replaces the run's face with one of its own.
 *
 * Answered by layout's rule, not this module's name validation. `symbolRunStyle` overrides
 * `rFonts` whenever `@w:font` is present and within its length bound — a vertical-writing
 * `@MS Gothic`, a name too long for a CSS sink, any of them. Asking `validFontFamily` here
 * instead would answer "no override" for a name layout does apply, and the run's own face
 * would enter this answer for a glyph that never paints in it.
 *
 * The attribute is read the way `symbol-run.ts` reads it — the WML namespace or none, since
 * unprefixed attributes on WML elements are common in authored packages — so a
 * foreign-namespaced `font`, which layout ignores, does not count as an override either.
 */
function symbolOverridesRunFace(sym: OoxmlElement): boolean {
  for (const attribute of sym.attributes) {
    if (attribute.localName !== 'font') continue;
    if (attribute.namespaceUri !== WML_NAMESPACE_URI && attribute.namespaceUri !== '') continue;
    return attribute.value.length > 0 && attribute.value.length <= MAX_SYMBOL_FONT_LENGTH;
  }
  return false;
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
      if (!symbolOverridesRunFace(child)) return true;
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
function isEastAsianCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x1100 && codePoint <= 0x11ff) || // Hangul Jamo
    (codePoint >= 0x2e80 && codePoint <= 0x9fff) || // CJK radicals through Unified Ideographs
    (codePoint >= 0xa960 && codePoint <= 0xa97f) || // Hangul Jamo Extended-A
    (codePoint >= 0xac00 && codePoint <= 0xd7ff) || // Hangul Syllables + Jamo Extended-B
    (codePoint >= 0xf900 && codePoint <= 0xfaff) || // CJK Compatibility Ideographs
    (codePoint >= 0xfe30 && codePoint <= 0xfe4f) || // CJK Compatibility Forms
    (codePoint >= 0xff00 && codePoint <= 0xffef) || // Full/half-width forms
    (codePoint >= 0x20000 && codePoint <= 0x3ffff) // CJK extension planes
  );
}

/**
 * Whether a code point can draw in the `w:hAnsi` face: a non-ASCII BMP character outside
 * the East Asian blocks above, Hebrew and Arabic, and the no-break space (which keeps the
 * `w:ascii` face). Over-reports the hint-dependent ranges, never hides a drawn face.
 */
function isHAnsiCodePoint(codePoint: number): boolean {
  return (
    codePoint > 0xa0 &&
    codePoint <= 0xffff &&
    !(codePoint >= 0x590 && codePoint <= 0x7bf) &&
    !(codePoint >= 0xfb1d && codePoint <= 0xfdff) &&
    !(codePoint >= 0xfe70 && codePoint <= 0xfefe) &&
    !isEastAsianCodePoint(codePoint)
  );
}

/** Which independently resolved slots the run's literal text reaches. */
function runTextSlots(run: OoxmlElement): { eastAsian: boolean; hAnsi: boolean } {
  let eastAsian = false;
  let hAnsi = false;
  for (const child of run.children as readonly OoxmlNode[]) {
    if (!isElement(child) || child.namespaceUri !== WML_NAMESPACE_URI) continue;
    if (child.localName !== 't' && child.localName !== 'delText') continue;
    for (const grand of child.children as readonly OoxmlNode[]) {
      if (isElement(grand)) continue;
      for (const character of grand.value) {
        const codePoint = character.codePointAt(0)!;
        if (codePoint < 0x80) continue;
        eastAsian ||= isEastAsianCodePoint(codePoint);
        hAnsi ||= isHAnsiCodePoint(codePoint);
        if (eastAsian && hAnsi) return { eastAsian, hAnsi };
      }
    }
  }
  return { eastAsian, hAnsi };
}

function applyRun(
  run: OoxmlElement,
  summary: MutableSummary,
  themeFonts: DocumentThemeFonts,
  projectedGlyphIds?: ReadonlySet<string>
): void {
  if (!runRendersGlyphs(run, projectedGlyphIds)) return;
  const rPr = childElement(run, 'rPr');
  const rFonts = rPr ? childElement(rPr, 'rFonts') : undefined;
  const slots = runTextSlots(run);
  const hasEastAsian = slots.eastAsian;
  const rStyle = rPr ? childElement(rPr, 'rStyle') : undefined;
  addProfile(summary, {
    latin: rFonts ? familyFromRFonts(rFonts, themeFonts) : null,
    eastAsia: rFonts && hasEastAsian ? eastAsiaFamilyFromRFonts(rFonts, themeFonts) : null,
    hasEastAsian,
    hAnsi: rFonts && slots.hAnsi ? hAnsiFamilyFromRFonts(rFonts, themeFonts) : null,
    hasHAnsi: slots.hAnsi,
    runStyle: validStyleId(rStyle ? attributeValue(rStyle, 'val') : undefined),
  });
}

function isStyledBlock(node: OoxmlElement): boolean {
  return (
    (node.localName === 'p' || node.localName === 'tbl') && node.namespaceUri === WML_NAMESPACE_URI
  );
}

/** A projected `w:fldSimple` result: one run in the paragraph's face, with no rPr. */
const PROJECTED_FIELD_PROFILE: RunProfile = {
  latin: null,
  eastAsia: null,
  hasEastAsian: false,
  hAnsi: null,
  hasHAnsi: false,
  runStyle: null,
};

/** The node's own contribution, for a node whose descendants were already summarized. */
function applyNode(
  node: OoxmlElement,
  summary: MutableSummary,
  themeFonts: DocumentThemeFonts,
  projectedGlyphIds?: ReadonlySet<string>
): void {
  if (node.namespaceUri !== WML_NAMESPACE_URI) return;
  if (projectedGlyphIds?.has(node.id) && node.localName === 'fldSimple') {
    addProfile(summary, PROJECTED_FIELD_PROFILE);
  }
  if (node.localName === 'r') applyRun(node, summary, themeFonts, projectedGlyphIds);
  else if (isStyledBlock(node)) closeContext(summary, node);
}

/**
 * Summarize `subtree` without the memo: a post-order walk on an explicit stack, so a deep
 * generic subtree cannot overflow the call stack. Each paragraph or table closes the context
 * of exactly the profiles found beneath it.
 */
function walkSummary(
  subtree: OoxmlElement,
  themeFonts: DocumentThemeFonts,
  projectedGlyphIds?: ReadonlySet<string>
): MutableSummary {
  const frames: { node: OoxmlElement; summary: MutableSummary; next: number }[] = [
    { node: subtree, summary: createSummary(), next: 0 },
  ];
  for (;;) {
    const frame = frames[frames.length - 1]!;
    const children = frame.node.children as readonly OoxmlNode[];
    if (frame.next < children.length) {
      const child = children[frame.next]!;
      frame.next += 1;
      if (isElement(child)) frames.push({ node: child, summary: createSummary(), next: 0 });
      continue;
    }
    applyNode(frame.node, frame.summary, themeFonts, projectedGlyphIds);
    frames.pop();
    const parent = frames[frames.length - 1];
    if (!parent) return frame.summary;
    mergeSummary(parent.summary, frame.summary);
  }
}

interface SummaryMemo {
  readonly major: string | null;
  readonly minor: string | null;
  readonly majorEastAsia: string | null;
  readonly minorEastAsia: string | null;
  readonly majorBidi: string | null | undefined;
  readonly minorBidi: string | null | undefined;
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
    cached.minorEastAsia === themeFonts.minorEastAsia &&
    cached.majorBidi === themeFonts.majorBidi &&
    cached.minorBidi === themeFonts.minorBidi
  ) {
    return cached.summary;
  }
  let summary: MutableSummary;
  if (subtree.children.length >= COMPOSE_CHILD_THRESHOLD && depth < MAX_COMPOSE_DEPTH) {
    summary = createSummary();
    for (const child of subtree.children as readonly OoxmlNode[]) {
      if (!isElement(child)) continue;
      mergeSummary(summary, summaryOf(child, themeFonts, depth + 1));
    }
    applyNode(subtree, summary, themeFonts);
  } else {
    summary = walkSummary(subtree, themeFonts);
  }
  summaryMemos.set(subtree, {
    major: themeFonts.major,
    minor: themeFonts.minor,
    majorEastAsia: themeFonts.majorEastAsia,
    minorEastAsia: themeFonts.minorEastAsia,
    majorBidi: themeFonts.majorBidi,
    minorBidi: themeFonts.minorBidi,
    summary,
  });
  return summary;
}

// ── Styles part index ────────────────────────────────────────────────────────────────────

interface StyleIndexEntry {
  readonly basedOn: string | null;
  readonly family: string | null;
  readonly eastAsiaFamily: string | null;
  readonly hAnsiFamily: string | null;
  /** Latin families named by `w:tblStylePr` conditional-format `w:rPr/w:rFonts`. */
  readonly conditionalFamilies: readonly string[];
  /** East Asian families named the same way. */
  readonly conditionalEastAsiaFamilies: readonly string[];
}

/** What one style reference resolves to along its `basedOn` chain. */
interface StyleChain {
  /** The nearest Latin family on the chain; deeper ones are overridden. */
  readonly latin: string | null;
  /** The nearest East Asian family on the chain. */
  readonly eastAsia: string | null;
  /** The nearest `w:hAnsi` family on the chain. */
  readonly hAnsi: string | null;
  /** Every conditional-format family on the chain (table styles only). */
  readonly conditional: readonly string[];
  readonly conditionalEastAsia: readonly string[];
}

const EMPTY_CHAIN: StyleChain = {
  latin: null,
  eastAsia: null,
  hAnsi: null,
  conditional: [],
  conditionalEastAsia: [],
};

interface StyleIndex {
  readonly docDefaultLatin: string | null;
  readonly docDefaultEastAsia: string | null;
  readonly docDefaultHAnsi: string | null;
  readonly defaultParagraph: string | null;
  readonly defaultCharacter: string | null;
  readonly defaultTable: string | null;
  /** The chain a style reference resolves through. Cycle-safe, capped at {@link CHAIN_CAP}. */
  chain(styleId: string | null): StyleChain;
}

const EMPTY_STYLE_INDEX: StyleIndex = {
  docDefaultLatin: null,
  docDefaultEastAsia: null,
  docDefaultHAnsi: null,
  defaultParagraph: null,
  defaultCharacter: null,
  defaultTable: null,
  chain: () => EMPTY_CHAIN,
};

interface StyleIndexMemo {
  readonly major: string | null;
  readonly minor: string | null;
  readonly majorEastAsia: string | null;
  readonly minorEastAsia: string | null;
  readonly majorBidi: string | null | undefined;
  readonly minorBidi: string | null | undefined;
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

function rPrHAnsiFamily(container: OoxmlElement, themeFonts: DocumentThemeFonts): string | null {
  const rPr = childElement(container, 'rPr');
  const rFonts = rPr ? childElement(rPr, 'rFonts') : undefined;
  return rFonts ? hAnsiFamilyFromRFonts(rFonts, themeFonts) : null;
}

function buildStyleIndex(stylesRoot: OoxmlElement, themeFonts: DocumentThemeFonts): StyleIndex {
  const entries = new Map<string, StyleIndexEntry>();
  let docDefaultFamily: string | null = null;
  let docDefaultEastAsiaFamily: string | null = null;
  let docDefaultHAnsiFamily: string | null = null;
  let defaultParagraph: string | null = null;
  let defaultCharacter: string | null = null;
  let defaultTable: string | null = null;

  const docDefaults = childElement(stylesRoot, 'docDefaults');
  const rPrDefault = docDefaults ? childElement(docDefaults, 'rPrDefault') : undefined;
  if (rPrDefault) {
    docDefaultFamily = rPrFamily(rPrDefault, themeFonts);
    docDefaultEastAsiaFamily = rPrEastAsiaFamily(rPrDefault, themeFonts);
    docDefaultHAnsiFamily = rPrHAnsiFamily(rPrDefault, themeFonts);
  }

  const defaultRPr = rPrDefault ? childElement(rPrDefault, 'rPr') : undefined;
  const defaultRFonts = defaultRPr ? childElement(defaultRPr, 'rFonts') : undefined;
  const hasLatinReference =
    defaultRFonts &&
    ['ascii', 'hAnsi', 'asciiTheme', 'hAnsiTheme'].some((name) =>
      Boolean(attributeValue(defaultRFonts, name))
    );
  if (!hasLatinReference) docDefaultFamily ??= themeFonts.minor;

  let counted = 0;
  for (const child of stylesRoot.children as readonly OoxmlNode[]) {
    if (!isElement(child) || child.localName !== 'style') continue;
    if (counted >= MAX_STYLE_DEFINITIONS) break;
    counted += 1;
    const styleId = validStyleId(attributeValue(child, 'styleId'));
    if (styleId === null) continue;
    const basedOnElement = childElement(child, 'basedOn');
    const conditionalFamilies: string[] = [];
    const conditionalEastAsiaFamilies: string[] = [];
    for (const condition of child.children as readonly OoxmlNode[]) {
      if (!isElement(condition) || condition.localName !== 'tblStylePr') continue;
      const family = rPrFamily(condition, themeFonts);
      if (family !== null) conditionalFamilies.push(family);
      const eastAsiaFamily = rPrEastAsiaFamily(condition, themeFonts);
      if (eastAsiaFamily !== null) conditionalEastAsiaFamilies.push(eastAsiaFamily);
    }
    // Last duplicate wins, and a later duplicate that is not the default CLEARS a default
    // the earlier one claimed — both matching `buildStyleCascadeTable` in
    // `layout/style-cascade.ts`, so the notice checks the definition layout paints from.
    entries.set(styleId, {
      basedOn: validStyleId(basedOnElement ? attributeValue(basedOnElement, 'val') : undefined),
      family: rPrFamily(child, themeFonts),
      eastAsiaFamily: rPrEastAsiaFamily(child, themeFonts),
      hAnsiFamily: rPrHAnsiFamily(child, themeFonts),
      conditionalFamilies,
      conditionalEastAsiaFamilies,
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

  const chainMemo = new Map<string, StyleChain>();
  const chain = (styleId: string | null): StyleChain => {
    if (styleId === null) return EMPTY_CHAIN;
    const cached = chainMemo.get(styleId);
    if (cached) return cached;
    let latin: string | null = null;
    let eastAsia: string | null = null;
    let hAnsi: string | null = null;
    const conditional: string[] = [];
    const conditionalEastAsia: string[] = [];
    const seen = new Set<string>();
    let at: string | null = styleId;
    for (let hop = 0; at !== null && hop < CHAIN_CAP && !seen.has(at); hop += 1) {
      seen.add(at);
      const entry = entries.get(at);
      if (!entry) break;
      latin ??= entry.family;
      eastAsia ??= entry.eastAsiaFamily;
      hAnsi ??= entry.hAnsiFamily;
      for (const family of entry.conditionalFamilies) conditional.push(family);
      for (const family of entry.conditionalEastAsiaFamilies) conditionalEastAsia.push(family);
      at = entry.basedOn;
    }
    const resolved = { latin, eastAsia, hAnsi, conditional, conditionalEastAsia };
    chainMemo.set(styleId, resolved);
    return resolved;
  };

  return {
    docDefaultLatin: docDefaultFamily,
    docDefaultEastAsia: docDefaultEastAsiaFamily,
    docDefaultHAnsi: docDefaultHAnsiFamily,
    defaultParagraph,
    defaultCharacter,
    defaultTable,
    chain,
  };
}

function styleIndexOf(stylesRoot: OoxmlElement | null, themeFonts: DocumentThemeFonts): StyleIndex {
  if (!stylesRoot) return { ...EMPTY_STYLE_INDEX, docDefaultLatin: themeFonts.minor };
  const cached = styleIndexMemos.get(stylesRoot);
  if (
    cached &&
    cached.major === themeFonts.major &&
    cached.minor === themeFonts.minor &&
    cached.majorEastAsia === themeFonts.majorEastAsia &&
    cached.minorEastAsia === themeFonts.minorEastAsia &&
    cached.majorBidi === themeFonts.majorBidi &&
    cached.minorBidi === themeFonts.minorBidi
  ) {
    return cached.index;
  }
  const index = buildStyleIndex(stylesRoot, themeFonts);
  styleIndexMemos.set(stylesRoot, {
    major: themeFonts.major,
    minor: themeFonts.minor,
    majorEastAsia: themeFonts.majorEastAsia,
    minorEastAsia: themeFonts.minorEastAsia,
    majorBidi: themeFonts.majorBidi,
    minorBidi: themeFonts.minorBidi,
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
  /** Families the style cascade resolves runs to, not already direct. */
  readonly inherited: readonly string[];
}

/**
 * The families the STYLES a profile references can name: every used chain's nearest Latin
 * and East Asian family, its conditional formats, and the document defaults, whether or not
 * a nearer level overrides them. The export lane loads fonts from this broader answer:
 * layout also measures paragraph marks, which take these faces even where no text does.
 */
function addBroadFamilies(
  profile: RunProfile,
  index: StyleIndex,
  inherited: Map<string, string>
): void {
  const chains = [
    index.chain(profile.runStyle ?? index.defaultCharacter),
    index.chain(profile.paragraphStyle ?? index.defaultParagraph),
    profile.tableStyle === false || profile.tableStyle === undefined
      ? EMPTY_CHAIN
      : index.chain(profile.tableStyle ?? index.defaultTable),
  ];
  for (const chain of chains) {
    addFamily(inherited, chain.eastAsia);
    addFamily(inherited, chain.latin);
    if (profile.hasHAnsi) addFamily(inherited, chain.hAnsi);
    for (const family of chain.conditional) addFamily(inherited, family);
    for (const family of chain.conditionalEastAsia) addFamily(inherited, family);
  }
  addFamily(inherited, index.docDefaultLatin);
  addFamily(inherited, index.docDefaultEastAsia);
  if (profile.hasHAnsi) addFamily(inherited, index.docDefaultHAnsi);
}

/** The families one run profile renders in, nearest level first. */
function resolveProfile(
  profile: RunProfile,
  index: StyleIndex,
  direct: Map<string, string>,
  inherited: Map<string, string>
): void {
  const runChain = index.chain(profile.runStyle ?? index.defaultCharacter);
  const paragraphChain = index.chain(profile.paragraphStyle ?? index.defaultParagraph);
  const tableChain =
    profile.tableStyle === false || profile.tableStyle === undefined
      ? EMPTY_CHAIN
      : index.chain(profile.tableStyle ?? index.defaultTable);
  if (profile.latin !== null) addFamily(direct, profile.latin);
  else {
    addFamily(
      inherited,
      runChain.latin ?? paragraphChain.latin ?? tableChain.latin ?? index.docDefaultLatin
    );
  }
  // A table style's conditional formats (header row, banded rows) can override the run
  // face without `w:tblLook` being evaluated here: over-reported, never hidden.
  for (const family of tableChain.conditional) addFamily(inherited, family);
  // The `w:hAnsi` slot inherits on its own, so a nearer `w:ascii` does not hide it.
  if (profile.hasHAnsi) {
    if (profile.hAnsi !== null) addFamily(direct, profile.hAnsi);
    else {
      addFamily(
        inherited,
        runChain.hAnsi ?? paragraphChain.hAnsi ?? tableChain.hAnsi ?? index.docDefaultHAnsi
      );
    }
  }
  if (!profile.hasEastAsian) return;
  if (profile.eastAsia !== null) addFamily(direct, profile.eastAsia);
  else {
    addFamily(
      inherited,
      runChain.eastAsia ??
        paragraphChain.eastAsia ??
        tableChain.eastAsia ??
        index.docDefaultEastAsia
    );
  }
  for (const family of tableChain.conditionalEastAsia) addFamily(inherited, family);
}

/**
 * Rendered-family candidates split into cap-safe direct and inherited priority tiers.
 *
 * The inherited tier is the BROAD answer ({@link addBroadFamilies}): font loading for export
 * must also cover the faces paragraph marks measure in.
 */
export function collectRenderedFontFamilyCandidates(
  storyRoots: readonly OoxmlElement[],
  stylesRoot: OoxmlElement | null,
  themeFonts: DocumentThemeFonts,
  /** Nodes whose glyphs are synthesized by layout rather than stored as literal text. @internal */
  projectedGlyphIds?: ReadonlySet<string>
): RenderedFontFamilyCandidates {
  return collectCandidates(storyRoots, stylesRoot, themeFonts, true, projectedGlyphIds);
}

function collectCandidates(
  storyRoots: readonly OoxmlElement[],
  stylesRoot: OoxmlElement | null,
  themeFonts: DocumentThemeFonts,
  broad: boolean,
  projectedGlyphIds?: ReadonlySet<string>
): RenderedFontFamilyCandidates {
  const index = styleIndexOf(stylesRoot, themeFonts);
  const directByFold = new Map<string, string>();
  const inheritedByFold = new Map<string, string>();
  for (const root of storyRoots) {
    const rootSummary = createSummary();
    // The root element is never a run or a styled block; its children carry the memo.
    for (const child of root.children as readonly OoxmlNode[]) {
      if (!isElement(child)) continue;
      mergeSummary(
        rootSummary,
        projectedGlyphIds && projectedGlyphIds.size > 0
          ? walkSummary(child, themeFonts, projectedGlyphIds)
          : summaryOf(child, themeFonts, 0)
      );
    }
    for (const profile of rootSummary.profiles.values()) {
      // A run that reached the story root with no table around it is outside any table.
      const placed =
        profile.tableStyle === undefined ? { ...profile, tableStyle: false as const } : profile;
      resolveProfile(placed, index, directByFold, inheritedByFold);
      if (broad) addBroadFamilies(placed, index, inheritedByFold);
    }
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
  // The PRECISE answer: only faces some rendered text actually resolves to.
  const candidates = collectCandidates(storyRoots, stylesRoot, themeFonts, false);
  const families = [...candidates.direct, ...candidates.inherited];
  families.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return families;
}
