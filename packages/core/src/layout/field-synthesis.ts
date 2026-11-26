import { characterStyleFieldValue } from './field-character-style.ts';
// The synthesis dispatch for one committed atomic complex field: given the pending state and the
// document-global context, decide the single glyph run the field's reserved model unit paints.
//
// Split out of `field-projection.ts` (against the file-size cap) as a self-contained decision:
// it reads the pending field and returns text/props/style, and owns none of the walk's closure
// machinery. The caller keeps offset ownership, visibility guards, link/attribution carry and
// the actual `push`.
//
// Branch order (mutually exclusive keywords, cached result winning where Word trusts it):
//   1. SYMBOL — synthesized glyph wins over any stale cached text.
//   2. legacy form field — checkbox from ffData state, dropdown from the selected entry.
//   3. allowlisted PAGE-family — live value from the page context, or in the body a placeholder
//      that document finalize substitutes. A stale cached result never wins.
//   4. REF — the value resolved from the bookmark target wins over the stale cache; an
//      unresolvable reference falls through to it instead.
//   5. DATE / TIME — the layout's field date, when it has one, wins over the cache.
//   6. cached result — a non-empty cache is the last saved result; it wins over synthesis.
//   7. empty cache only (and no hidden-but-present result): a document-property value, else a
//      MACROBUTTON / GOTOBUTTON display.

import type { OoxmlNode, OoxmlProperty } from '@docx-editor.dev/core/store';
import type { DocumentProperties } from '@docx-editor.dev/core/store';
import { currentFieldDate, formatDateField } from './field-date.ts';
import { docPropertyValue } from './field-doc-property.ts';
import { formFieldResult } from './field-form.ts';
import {
  formulaOperandIsNumber,
  pageFieldMarker,
  pageFieldMeasuredText,
  PAGE_FIELD_PLACEHOLDER,
  pageFieldText,
  type BodyPageFieldContext,
  type FieldPageContext,
  type PageFieldMarker,
} from './field-page-furniture.ts';
import {
  effectiveFieldInstruction,
  trackedDeletionLeavesNoInstruction,
  type AllowlistedPageFieldMatch,
  type ComplexFieldParseState,
} from './field-instruction.ts';
import { captureInstructionSpecs } from './field-form.ts';
import { revisionsAreDeletion, type RevisionDisplayMode } from './revision-projection.ts';
import { instrTextValue, isDeletedInstrText } from '../store/package/field-nodes.ts';
import type { PendingFieldProjection } from './field-pieces.ts';
import { deferredSegmentsMarker } from './field-nested-page.ts';
import {
  listNumFieldValue,
  type PageRefFieldProjection,
  type RefFieldContext,
} from './field-ref.ts';
import { symbolFieldGlyph } from './field-symbol.ts';
import type { ResolvedRunStyle, ThemeFonts } from './run-style.ts';

/** The one glyph run a synthesized atomic field paints over its reserved model unit. */
export interface AtomicFieldSynthesis {
  readonly text: string;
  readonly props: readonly OoxmlProperty[];
  readonly style: ResolvedRunStyle;
  /**
   * Present when this is a BODY page-field placeholder: {@link text} is the measurement digit and
   * document finalize substitutes the real value for this kind. The caller carries the marker onto
   * the span. Absent for the live header/footer value and every other synthesis.
   */
  readonly pageField?: PageFieldMarker;
  /**
   * Present when this is a BODY `PAGEREF`: {@link text} is the cached result (or the
   * placeholder digit for an empty cache) and document finalize substitutes the number of
   * the page the resolved target lands on. The caller carries this onto the span marker.
   */
  readonly pageRefField?: PageRefFieldProjection;
}

/** Document-global inputs the synthesis reads, none of them per-run. */
export interface AtomicSynthesisContext {
  readonly pageContext?: FieldPageContext;
  readonly themeFonts?: ThemeFonts;
  readonly documentProperties?: DocumentProperties;
  /**
   * True in BODY flow, where a PAGE/NUMPAGES/SECTIONPAGES paints a placeholder for
   * document finalize to substitute. Absent/false in headers, footers, notes and text boxes,
   * which keep their live path or deferral — a placeholder there would never be substituted.
   */
  readonly bodyPageFields?: BodyPageFieldContext | false;
  /**
   * The story's resolved REF inputs (bookmark targets + numbering), or absent for stories
   * that keep REF fields on their cached results (headers/footers, notes, text boxes).
   */
  readonly refFields?: RefFieldContext;
}

/**
 * Resolve what a committed atomic field paints, or null for nothing (an empty result, an
 * unresolvable spec, or a missing property — the model unit stays, painting no glyph).
 *
 * The caller has already answered outer visibility (`w:vanish`, a revision the mode hides), so
 * this never re-checks it; it only chooses the glyph run.
 */
export function synthesizeAtomicField(
  pending: PendingFieldProjection,
  ctx: AtomicSynthesisContext
): AtomicFieldSynthesis | null {
  const characterValue = characterStyleFieldValue(
    pending.hasNestedField ? null : pending.characterStyleSpec,
    ctx.pageContext
  );
  if (characterValue !== undefined) {
    return { text: characterValue, props: pending.props, style: pending.style };
  }
  // SYMBOL renders from its instruction — Word never trusts a cached result for it.
  if (pending.symbolSpec) {
    const glyph = symbolFieldGlyph(pending.symbolSpec, pending.props, ctx.themeFonts);
    if (glyph) return { text: glyph.text, props: glyph.props, style: glyph.style };
  }
  // A legacy form field renders from its ffData state (checkbox always; dropdown when empty).
  const form = formFieldResult(pending, ctx.themeFonts);
  if (form) return { text: form.text, props: form.props, style: form.style };

  // A formula over a PAGE operand that is not a number (a roman section) keeps the cache.
  const sectionFormat = ctx.pageContext
    ? ctx.pageContext.format
    : ctx.bodyPageFields
      ? ctx.bodyPageFields.format
      : undefined;
  const pageKind = formulaOperandIsNumber(pending.pageSwitches, sectionFormat)
    ? pending.kind
    : null;
  // A formula with no value on this page (a division by zero, say) keeps its saved result.
  const liveText =
    pageKind && ctx.pageContext
      ? pageFieldText({ ...pending.pageSwitches, kind: pageKind }, ctx.pageContext)
      : null;
  if (liveText !== null) return { text: liveText, props: pending.props, style: pending.style };
  // A BODY page field (no page context) paints the page it lands on, whatever the file cached:
  // the value is a property of pagination, so a saved result is stale as soon as the layout
  // moves. Paint a placeholder now and record the kind so document finalize substitutes the
  // real value. A result that existed but was hidden stays hidden. Gated on `bodyPageFields`
  // because headers/footers took the live branch above, and notes / text boxes have no
  // substitute pass.
  if (
    pageKind &&
    ctx.bodyPageFields &&
    (pending.cachedText.length > 0 || !pending.sawResultContent)
  ) {
    // The marker records the switches the placeholder was measured through, so finalize
    // renders the value the same way. The switches do not depend on the section format; a
    // PAGE field without switches measures in it.
    const measured = pageFieldMeasuredText(
      pending.pageSwitches,
      pending.cachedText,
      pageKind === 'PAGE' ? ctx.bodyPageFields.format : undefined
    );
    // A formula with no value on its page paints its saved result only where that result is
    // what the field was measured at; otherwise it would paint over the text that follows.
    const savedResult = measured === pending.cachedText ? pending.cachedText : '';
    return {
      text: measured,
      props: pending.props,
      style: pending.style,
      pageField: pageFieldMarker(pageKind, pending.pageSwitches, savedResult),
    };
  }
  // A REF resolves live from its bookmark target and the resolved numbering — the cached
  // result is exactly what goes stale after a renumbering edit, so here the live value wins
  // over a non-empty cache. Gated per field (by begin node id) on the calibration verdict:
  // a field whose computed value never matched its authored cache stays on that cache, and
  // an unresolvable reference falls through to it too — never to the raw instruction. The
  // result-run style captured off the cache keeps the field's formatting.
  if (pending.refSpec && ctx.refFields) {
    const value = ctx.refFields.liveValueOf(pending.beginId, pending.refSpec);
    if (value !== null) return { text: value, props: pending.props, style: pending.style };
  }
  // A BODY PAGEREF defers to document finalize the way a body PAGE does: the value is a
  // property of pagination, so this paints the cached result — the width every value it can
  // be replaced by usually shares, since TOC caches are page numbers — and marks the span
  // with the resolved target. Empty cache paints the placeholder digit (gated on a result
  // the file did not hide, like every synthesis). Gated on `bodyPageFields` because notes
  // and text boxes have no substitute pass, and furniture keeps its cache (its projector
  // knows its own page, not the target's).
  if (pending.refSpec && ctx.refFields?.pageRefProjectionOf && ctx.bodyPageFields) {
    const projection = ctx.refFields.pageRefProjectionOf(pending.beginId, pending.refSpec);
    if (projection) {
      if (pending.cachedText.length > 0) {
        return {
          text: pending.cachedText,
          props: pending.props,
          style: pending.style,
          pageRefField: projection,
        };
      }
      if (!pending.sawResultContent) {
        return {
          text: PAGE_FIELD_PLACEHOLDER,
          props: pending.props,
          style: pending.style,
          pageRefField: projection,
        };
      }
    }
  }
  // An AUTONUM-family field has no separator and no cached result — Word computes the number
  // at display time and never stores it — so the synthesized sequential value is its only
  // display, and it wins over whatever stray cache a producer wrote. An anchor the scan never
  // saw paints nothing, the field's historical rendering.
  if (pending.autonumSpec && ctx.refFields?.autonumValueOf) {
    const value = ctx.refFields.autonumValueOf(pending.beginId);
    if (value !== null) return { text: value, props: pending.props, style: pending.style };
  }
  // A LISTNUM number is computed at display time from the list walk, so it wins over a saved
  // result too. A field the walk gave no number keeps the branches below.
  if (pending.listNumSpec) {
    const value = listNumFieldValue(ctx.refFields, pending.beginId);
    if (value !== null) return { text: value, props: pending.props, style: pending.style };
  }
  // DATE and TIME show the layout's field date, because their value is the current moment. A
  // result that existed but was hidden stays hidden. A name in an unsupported language keeps
  // the cache, and so does a field with any nested field: a nested field in the instruction
  // leaves the picture only partly buffered.
  const fieldDate = pending.dateSpec && !pending.hasNestedField ? currentFieldDate() : undefined;
  const dateText =
    pending.dateSpec && fieldDate && (pending.cachedText.length > 0 || !pending.sawResultContent)
      ? formatDateField(
          pending.dateSpec,
          fieldDate,
          pending.instructionProps ?? pending.deletedInstructionProps ?? pending.props
        )
      : null;
  if (dateText !== null) return { text: dateText, props: pending.props, style: pending.style };
  // A non-empty cached result is what the producer last painted; it wins over synthesis. In
  // the body, page fields nested in it get a marker, so document finalize fills each page's
  // value in place.
  if (pending.cachedText.length > 0) {
    const segments = pending.nestedPageSegments;
    const pageField =
      ctx.bodyPageFields && segments && segments.length > 0 && !pending.formField
        ? deferredSegmentsMarker(pending.cachedText, segments)
        : null;
    return {
      text: pending.cachedText,
      props: pending.props,
      style: pending.style,
      ...(pageField ? { pageField } : {}),
    };
  }
  // Empty cache: synthesize. A result that existed but was hidden stays hidden.
  if (!pending.sawResultContent) {
    if (pending.docPropertySpec) {
      const value = docPropertyValue(pending.docPropertySpec, ctx.documentProperties);
      if (value !== null) return { text: value, props: pending.props, style: pending.style };
    }
    // MACROBUTTON / GOTOBUTTON display their text; the macro / target never runs.
    if (pending.buttonSpec) {
      return { text: pending.buttonSpec.display, props: pending.props, style: pending.style };
    }
  }
  return null;
}

/**
 * Capture what the outermost `separate` of `pending` decides, while the machine still holds the
 * instruction (`onFldCharEnd` resets the buffer before the flush reads anything).
 *
 * The allowlisted page-field match is captured whether or not a page context is present. With
 * one (header/footer) the flush projects the live value; without one (body) it paints a
 * placeholder the kind marks, and document finalize substitutes the page's value. The `\#`
 * picture and `\*` number format ride along: they decide how it renders. Any other field
 * captures its SYMBOL / HYPERLINK / form-field spec. Nesting overflow refuses exactly as PAGE
 * projection does: a >4-deep hostile field must not synthesize output from whatever outer
 * fragments the buffer kept.
 *
 * A tracked deletion that leaves a page field with no code shows nothing
 * ({@link trackedDeletionLeavesNoInstruction}), unless the whole field is a tracked deletion or
 * the view shows the original document, where the field keeps its earlier behavior.
 */
export function captureSeparatedInstruction(
  pending: PendingFieldProjection,
  field: ComplexFieldParseState,
  match: AllowlistedPageFieldMatch | null,
  displayMode: RevisionDisplayMode
): void {
  // The original view rejects the deletion. A field with no live code element then evaluates
  // its deleted code; one with an empty live element, or a deleted `=` beside live operands,
  // keeps its saved result there.
  const codeDeleted =
    displayMode !== 'original' &&
    !revisionsAreDeletion(pending.resultRevisions) &&
    trackedDeletionLeavesNoInstruction(field);
  pending.kind = codeDeleted ? null : (match?.kind ?? null);
  pending.pageSwitches = match ?? {};
  const effective = effectiveFieldInstruction(field);
  if (!pending.kind && !effective.overflow && !field.nestingOverflow) {
    captureInstructionSpecs(pending, effective.instruction);
  }
  if (codeDeleted) pending.hidesResult = true;
}

/**
 * Record the run properties of an instruction run of `pending`, before the walk ingests it.
 * DATE and TIME names follow the language of the run that holds the instruction (ECMA-376
 * Part 1, 17.16.4.1): the first run with text of the buffer the field evaluates, live, else
 * deleted. Runs of nested fields and runs after the separator do not count.
 */
export function noteInstructionLanguage(
  pending: PendingFieldProjection,
  field: ComplexFieldParseState,
  instrText: OoxmlNode,
  props: readonly OoxmlProperty[]
): void {
  if (field.nesting !== 1 || field.phase !== 'instruction') return;
  if (!/\S/.test(instrTextValue(instrText))) return;
  if (!isDeletedInstrText(instrText)) pending.instructionProps ??= props;
  else pending.deletedInstructionProps ??= props;
}
