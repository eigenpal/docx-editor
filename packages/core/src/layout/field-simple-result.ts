// Display-text collection for `w:fldSimple` results.
//
// The outer simple field is one model unit; this module only decides what glyphs that unit
// paints. Allowlisted PAGE / NUMPAGES / SECTIONPAGES evaluate from a page context. Nested
// allowlisted page fields inside a non-page simple field (complex markers or another
// `w:fldSimple`) evaluate live too — concatenating their cached digits would stamp one sheet's
// number onto every page after detection had already requested a per-sheet context. Other
// nested field instructions stay inert.

import {
  fldSimpleInstr,
  isFieldChrome,
  isFldSimple,
  type DocumentProperties,
  type OoxmlNode,
  type OoxmlProperty,
} from '@docx-editor.dev/core/store';
import { parseButtonInstruction } from './field-button.ts';
import { docPropertyValue, parseDocPropertyInstruction } from './field-doc-property.ts';
import { parseHyperlinkInstruction } from './field-link.ts';
import type { FieldLinkProjector } from './field-pieces.ts';
import {
  modelTextOfRunChild,
  runPropertiesOf,
  type RunPropertyCascader,
} from './field-run-text.ts';
import { parseSymbolInstruction, symbolFieldGlyph } from './field-symbol.ts';
import type { SpanLinkRecord } from './semantic-records.ts';
import { isSymbolRunChild, symbolGlyphOf } from './symbol-run.ts';
import {
  consumeScanNode,
  createFieldParseState,
  ingestInstrTextBounded,
  isFldChar,
  isInstrText,
  MAX_STORY_FIELD_SCAN_DEPTH,
  onFldCharBegin,
  onFldCharEnd,
  onFldCharSeparate,
  matchAllowlistedPageField,
  type AllowlistedPageField,
  type FieldScanBudget,
} from './field-instruction.ts';
import { createNestedPageTracker } from './field-nested-page.ts';
import {
  pageFieldPlaceholder,
  projectPageFieldValue,
  type FieldPageContext,
} from './field-page-furniture.ts';
import { resolveRunStyle, type ResolvedRunStyle, type ThemeFonts } from './run-style.ts';
import {
  MAX_REVISION_DEPTH,
  isRevisionWrapper,
  revisionAttributionOf,
  revisionsAreDeletion,
  revisionsVisible,
  withRevision,
  type RevisionAttribution,
  type RevisionDisplayMode,
} from './revision-projection.ts';

/** Optional per-run merge of inherited + direct `rPr` (character styles, defaults). */
export type SimpleFieldRunCascader = RunPropertyCascader;

export interface SimpleFieldDisplay {
  readonly text: string;
  readonly resultProps: readonly OoxmlProperty[] | undefined;
  readonly resultStyle: ResolvedRunStyle | undefined;
  /**
   * True once cached-result content the current display mode KEEPS was seen — visible or
   * vanish-hidden. Only content with model text sets it (result text, tab / break, `w:sym`);
   * drawings, `w:ptab` and note references never do. An empty `text` alone cannot tell "no
   * cached result" from "a cached result the file hides", and synthesis (MACROBUTTON /
   * GOTOBUTTON display) may only fill the first. Revision-suppressed content does not
   * count: the mode resolved it away, and synthesis must be free to fill that view.
   */
  readonly sawResultContent: boolean;
}

/**
 * Collect the painted text/style for one `w:fldSimple`, evaluating nested allowlisted page
 * fields when a page context is supplied.
 *
 * Does not decide outer-field visibility or model offsets — the caller owns those.
 */
export function collectSimpleFieldDisplay(args: {
  readonly simple: OoxmlNode;
  readonly depth: number;
  readonly pageContext?: FieldPageContext;
  readonly budget: FieldScanBudget;
  readonly revisions: readonly RevisionAttribution[];
  readonly displayMode: RevisionDisplayMode;
  readonly inheritedRunProperties: readonly OoxmlProperty[];
  readonly cascadeRuns?: SimpleFieldRunCascader;
  readonly themeFonts?: ThemeFonts;
}): SimpleFieldDisplay {
  const {
    simple,
    depth,
    pageContext,
    budget,
    revisions,
    displayMode,
    inheritedRunProperties,
    cascadeRuns,
    themeFonts,
  } = args;

  let text = '';
  let resultProps: readonly OoxmlProperty[] | undefined;
  let resultStyle: ResolvedRunStyle | undefined;
  let sawResultContent = false;

  const nested = createFieldParseState();
  // Level-aware live evaluation of an allowlisted page field nested in the cache (shared with
  // the complex-field walk): the machine's level 1 is a complex field directly inside this
  // `w:fldSimple`, deeper levels are fields nested in ITS cached result, and the tracker skips
  // the tracked field's digits and appends the live value at that level's matching end only.
  const tracker = createNestedPageTracker();

  const captureStyle = (props: readonly OoxmlProperty[], style: ResolvedRunStyle): void => {
    if (resultProps) return;
    resultProps = props;
    resultStyle = style;
  };

  const collect = (node: OoxmlNode, nodeDepth: number, local: readonly RevisionAttribution[]) => {
    if (node.kind === 'textValue' || nodeDepth > MAX_STORY_FIELD_SCAN_DEPTH) return;
    for (const child of node.children) {
      if (child.kind === 'textValue') continue;
      if (!consumeScanNode(budget)) return;
      if (child.kind === 'run') {
        const props = runPropertiesOf(child, inheritedRunProperties, cascadeRuns);
        const style = resolveRunStyle(props, themeFonts);
        for (const grand of child.children) {
          if (grand.kind === 'runProperties') continue;

          if (isFldChar(grand, 'begin')) {
            onFldCharBegin(nested);
            if (nested.nesting === 1) tracker.reset();
            continue;
          }
          if (isInstrText(grand)) {
            // Bounded per-level ingestion: the machine itself knows whether the INNERMOST
            // open level still collects. Gating on the level-1 phase here starved every
            // deeper level's capture, so a PAGE two levels down could never be recognized.
            ingestInstrTextBounded(nested, grand, budget, nodeDepth + 1);
            continue;
          }
          if (isFldChar(grand, 'separate')) {
            const separateLevel = nested.nesting;
            const separatePhase = nested.phase;
            const match = onFldCharSeparate(nested);
            // A level-1 machine field sits directly in this cache and always projects. A
            // DEEPER field projects only from a level-1 RESULT (never from an instruction —
            // that content is not painted) and never past the nesting cap, matching what
            // `detectStoryPageFields` notes so detection and projection stay one story.
            if (separateLevel === 1 || (separatePhase === 'result' && !nested.nestingOverflow)) {
              tracker.onSeparate(pageContext ? match : null, separateLevel);
            }
            continue;
          }
          if (isFldChar(grand, 'end')) {
            const appendedLive = tracker.onEnd(nested.nesting, pageContext);
            if (appendedLive !== null) text += appendedLive;
            onFldCharEnd(nested);
            continue;
          }

          if (isFieldChrome(grand)) continue;

          // A collected display string cannot carry a per-glyph font switch, so only a
          // `w:sym` with a real Unicode equivalent joins it; the rest are skipped.
          if (isSymbolRunChild(grand)) {
            // Only content this display mode keeps counts (vanish-hidden still does) —
            // synthesis must fill the view a `w:del`-wrapped result is resolved out of,
            // matching the complex-field walk.
            if (revisionsVisible(local, displayMode)) sawResultContent = true;
            if (tracker.active) {
              tracker.noteResult(!style.hidden && revisionsVisible(local, displayMode));
              continue;
            }
            const glyph = symbolGlyphOf(grand);
            if (!glyph?.unicode) continue;
            if (style.hidden || !revisionsVisible(local, displayMode)) continue;
            captureStyle(props, style);
            text += glyph.text;
            continue;
          }

          const value = modelTextOfRunChild(grand);
          if (value.length === 0) continue;
          const deleted = revisionsAreDeletion(local);
          const revisionSuppressed =
            !revisionsVisible(local, displayMode) || (grand.kind === 'deletedText' && !deleted);
          // Revision-suppressed content does not count as a cached result: the mode resolved
          // it away, and synthesis must be free to fill that view. Vanish-hidden still counts.
          if (!revisionSuppressed) sawResultContent = true;
          const suppressed = style.hidden || revisionSuppressed;
          if (tracker.active) {
            tracker.noteResult(!suppressed);
            if (!suppressed) captureStyle(props, style);
            continue;
          }
          if (suppressed) continue;
          captureStyle(props, style);
          text += value;
        }
        continue;
      }
      if (isFldSimple(child)) {
        // Inside a tracked complex field's skipped cache the simple field is part of the
        // replaced result: descend so its runs are NOTED (visible cached content keeps the
        // live replacement alive), never appended on their own.
        // NOT `nested`: that name is the enclosing complex-field parse state this walk shares.
        const simplePageField = tracker.active
          ? null
          : matchAllowlistedPageField(fldSimpleInstr(child) ?? '');
        if (simplePageField && pageContext) {
          if (!revisionsVisible(local, displayMode)) continue;
          const beforeLen = text.length;
          collect(child, nodeDepth + 1, local);
          text = text.slice(0, beforeLen);
          text += projectPageFieldValue(simplePageField.kind, pageContext, simplePageField.picture);
          continue;
        }
        collect(child, nodeDepth + 1, local);
        continue;
      }
      if (child.kind === 'hyperlink') {
        collect(child, nodeDepth + 1, local);
        continue;
      }
      if (isRevisionWrapper(child) && local.length < MAX_REVISION_DEPTH) {
        const attribution = revisionAttributionOf(child);
        collect(child, nodeDepth + 1, attribution ? withRevision(local, attribution) : local);
        continue;
      }
      collect(child, nodeDepth + 1, local);
    }
  };

  collect(simple, depth, revisions);

  return { text, resultProps, resultStyle, sawResultContent };
}

/** The one projected piece a `w:fldSimple` paints over its reserved model unit. */
export interface SimpleFieldProjection {
  readonly text: string;
  readonly props: readonly OoxmlProperty[];
  readonly style: ResolvedRunStyle;
  /** The HYPERLINK-instruction link the piece should carry, when one projects. */
  readonly link?: SpanLinkRecord;
  /**
   * Present when this is a BODY page-field placeholder (no page context): {@link text} is the
   * measurement digit and document finalize substitutes the real value for this kind.
   */
  readonly pageField?: {
    readonly kind: AllowlistedPageField;
    /** The field's `\#` numeric picture, carried to the substitute pass. */
    readonly picture?: string;
  };
}

/**
 * Decide what a `w:fldSimple` (§17.16.19) paints, or null for nothing.
 *
 * The caller owns the model offset (the field is one unit whatever it paints) and OUTER
 * visibility — a revision enclosing the whole field is answered before this runs. This owns
 * the branch order:
 *
 * - Allowlisted PAGE / NUMPAGES / SECTIONPAGES evaluate from the page context when one is
 *   supplied — the cached result is whatever sheet the producer last saved from.
 * - A simple SYMBOL renders from its instruction like the complex shape does; there is no
 *   trustworthy cached result to prefer. An unresolvable spec falls through.
 * - A simple MACROBUTTON / GOTOBUTTON displays everything after its first argument; the
 *   macro / target never runs. A non-empty cached display wins — synthesis fills an empty one.
 * - Otherwise the cached display paints, linked by a HYPERLINK instruction only outside a
 *   typed `w:hyperlink` (`currentLink`), which outranks the field's own instruction. An empty
 *   result never paints, URL included.
 *
 * A hidden result returns null in every branch: no piece, the unit stays.
 */
export function projectSimpleFieldResult(args: {
  readonly simple: OoxmlNode;
  readonly depth: number;
  readonly pageContext?: FieldPageContext;
  readonly budget: FieldScanBudget;
  readonly revisions: readonly RevisionAttribution[];
  readonly displayMode: RevisionDisplayMode;
  readonly inheritedRunProperties: readonly OoxmlProperty[];
  readonly cascadeRuns?: SimpleFieldRunCascader;
  readonly themeFonts?: ThemeFonts;
  /** The enclosing typed `w:hyperlink` record, which outranks the field's instruction. */
  readonly currentLink?: SpanLinkRecord;
  readonly projectFieldLink?: FieldLinkProjector;
  /** Parsed document properties, for a TITLE / AUTHOR / … / DOCPROPERTY simple field. */
  readonly documentProperties?: DocumentProperties;
  /** True in BODY flow: an empty-cache page field paints a placeholder for finalize to fill. */
  readonly bodyPageFields?: boolean;
}): SimpleFieldProjection | null {
  const { simple, pageContext, inheritedRunProperties, themeFonts } = args;
  const display = collectSimpleFieldDisplay(args);
  const instr = fldSimpleInstr(simple) ?? '';
  const props = display.resultProps ?? inheritedRunProperties;

  const pageField = matchAllowlistedPageField(instr);
  if (pageField && pageContext) {
    const style = display.resultStyle ?? resolveRunStyle(inheritedRunProperties, themeFonts);
    if (style.hidden) return null;
    return {
      text: projectPageFieldValue(pageField.kind, pageContext, pageField.picture),
      props,
      style,
    };
  }
  // A BODY page field (no page context) with no cached result: paint a placeholder and mark the
  // kind so document finalize substitutes the page's value. A cached result wins — it falls
  // through to paint normally, exactly as it would in Word until the field is next updated.
  if (
    pageField &&
    args.bodyPageFields &&
    !pageContext &&
    display.text.length === 0 &&
    !display.sawResultContent
  ) {
    const style = display.resultStyle ?? resolveRunStyle(inheritedRunProperties, themeFonts);
    if (style.hidden) return null;
    return {
      text: pageFieldPlaceholder(pageField.picture),
      props,
      style,
      pageField:
        pageField.picture === undefined
          ? { kind: pageField.kind }
          : { kind: pageField.kind, picture: pageField.picture },
    };
  }

  const symbolSpec = parseSymbolInstruction(instr);
  if (symbolSpec) {
    const glyph = symbolFieldGlyph(symbolSpec, props, themeFonts);
    if (glyph) {
      if (glyph.style.hidden) return null;
      return { text: glyph.text, props: glyph.props, style: glyph.style };
    }
  }

  // Synthesis fills only a result the file never cached: a cached result that exists but is
  // hidden stays hidden (`sawResultContent`), matching the complex-field flush. A
  // document-property field (TITLE / AUTHOR / … / DOCPROPERTY) paints its property value here.
  const emptyCache = display.text.length === 0 && !display.sawResultContent;
  if (emptyCache) {
    const docField = parseDocPropertyInstruction(instr);
    if (docField) {
      const value = docPropertyValue(docField, args.documentProperties);
      if (value !== null) {
        const style = display.resultStyle ?? resolveRunStyle(inheritedRunProperties, themeFonts);
        if (style.hidden) return null;
        return { text: value, props, style };
      }
    }
  }
  const buttonSpec = emptyCache ? parseButtonInstruction(instr) : null;
  if (buttonSpec) {
    const style = display.resultStyle ?? resolveRunStyle(inheritedRunProperties, themeFonts);
    if (style.hidden) return null;
    return { text: buttonSpec.display, props, style };
  }

  if (display.text.length === 0) return null;
  // Nested live PAGE may replace an empty cached result and leave no donor run; fall back
  // to inherited properties the same way a top-level simple PAGE does.
  const style = display.resultStyle ?? resolveRunStyle(inheritedRunProperties, themeFonts);
  if (style.hidden) return null;
  const linkSpec = args.currentLink ? null : parseHyperlinkInstruction(instr);
  const fieldLink = linkSpec ? (args.projectFieldLink?.(linkSpec) ?? null) : null;
  return { text: display.text, props, style, ...(fieldLink ? { link: fieldLink } : {}) };
}
