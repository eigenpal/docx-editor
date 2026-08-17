// Safe PAGE / NUMPAGES / SECTIONPAGES field projection for read-only page furniture.
//
// Field instructions are attacker-controlled and MUST NEVER execute. Recognition of
// allowlisted instructions and the shared complex-field scan machine live in
// `field-instruction.ts`. This module projects those fields into measurable pieces and
// finalizes furniture once document page counts are known.
//
// Well-formed computed fields and `w:fldSimple` each contribute one UTF-16 model unit
// (aligned with `paragraphTextOf` / `segmentsOf`). FORMTEXT results instead keep their literal
// character offsets because they are user input. Malformed fields demote so content remains.
//
// Shipped scope is furniture-only for live page-number evaluation. A simple PAGE /
// NUMPAGES / SECTIONPAGES field evaluates like its complex twin when a page context is
// supplied; a non-page `w:fldSimple` still contributes one model unit and paints its
// cached result, except that allowlisted page fields nested inside that result (complex
// or simple) are evaluated per sheet rather than concatenated from the saved cache.
// A complex outer field's atomic cached result gets the same nested evaluation. Other
// nested field instructions stay inert. Body-side evaluation beyond that is deferred.
//
// Projection is a layout concern (span geometry + tab alignment), not paint-time substitution.

import {
  fldSimpleInstr,
  hardBreakKind,
  hasLegacyFormFieldData,
  isFldSimple,
  type OoxmlNode,
  type OoxmlParagraphNode,
  type OoxmlProperty,
  type HardBreakKind,
} from '@docx-editor.dev/core/store';
import {
  allowlistedPageField,
  consumeScanNode,
  createFieldParseState,
  createScanBudget,
  detectStoryPageFields,
  ingestInstrTextBounded,
  isCollectingInstruction,
  isFldChar,
  isInsideFieldResult,
  isInstrText,
  MAX_FIELD_INSTRUCTION_CHARS,
  MAX_FIELD_NESTING,
  MAX_STORY_FIELD_SCAN_DEPTH,
  MAX_STORY_FIELD_SCAN_NODES,
  normalizeFieldInstruction,
  onFldCharBegin,
  onFldCharEnd,
  onFldCharSeparate,
  resetFieldParseState,
  type AllowlistedPageField,
  type StoryPageFieldNeeds,
} from './field-instruction.ts';
import {
  fieldPageContextToken,
  finalizePageFieldProjection,
  formatPageNumber,
  projectPageFieldValue,
  storyNeedsPageFields,
  withPageFieldSources,
  type FieldPageContext,
} from './field-page-furniture.ts';
import { collectSimpleFieldDisplay } from './field-simple-result.ts';
import {
  modelTextOfRunChild,
  runPropertiesOf,
  type RunPropertyCascader,
} from './field-run-text.ts';
import { parseButtonInstruction } from './field-button.ts';
import { captureInstructionSpecs, formFieldResult } from './field-form.ts';
import { parseHyperlinkInstruction } from './field-link.ts';
import { parseSymbolInstruction, symbolFieldGlyph } from './field-symbol.ts';
import { isSymbolRunChild, symbolGlyphOf, symbolRunStyle } from './symbol-run.ts';
import {
  appendModelRange,
  positionalTabOf,
  type FieldAtomMarker,
  type FieldAwarePiece,
  type FieldLinkProjector,
  type HyperlinkProjector,
  type ModelRange,
  type MutableModelRange,
  type PendingFieldProjection,
  type PositionalTab,
} from './field-pieces.ts';
import type { InlineDrawingLayoutContext, InlineDrawingLayoutInput } from './drawing-layout.ts';
import { isRunLevelMcAlternateContent } from '../store/package/drawing-projection.ts';
import { legacyFormFieldDataOf, parsedFieldSpansOf } from '../store/package/field-nodes.ts';
import {
  emptyNamespaceScope,
  namespaceScopeForNode,
} from '../store/package/drawing-projection-walk.ts';
import {
  isProjectableNoteAtom,
  projectedNoteMarkText,
  type NoteMarkContext,
} from './note-projection.ts';
import {
  DEFAULT_REVISION_DISPLAY_MODE,
  MAX_REVISION_DEPTH,
  NO_REVISIONS,
  isRevisionWrapper,
  revisionAttributionOf,
  revisionsAreDeletion,
  revisionsVisible,
  withRevision,
  type RevisionAttribution,
  type RevisionDisplayMode,
} from './revision-projection.ts';
import { resolveRunStyle, type ResolvedRunStyle, type ThemeFonts } from './run-style.ts';
import type { SpanLinkRecord } from './semantic-records.ts';
import {
  contentControlContentChildren,
  isContentControl,
  MAX_CONTENT_CONTROL_NESTING,
} from '../store/package/content-control-walk.ts';

// Re-export instruction recognition + detection so existing layout-local imports stay stable.
export {
  MAX_FIELD_INSTRUCTION_CHARS,
  MAX_STORY_FIELD_SCAN_DEPTH,
  MAX_STORY_FIELD_SCAN_NODES,
  allowlistedPageField,
  detectStoryPageFields,
  normalizeFieldInstruction,
  type StoryPageFieldNeeds,
};

// Same for the whole-document page-field finalization, which now lives in its own module: it
// resolves values that only exist once pagination is done, and shares nothing with this walk
// but the context type.
export {
  fieldPageContextToken,
  finalizePageFieldProjection,
  formatPageNumber,
  projectPageFieldValue,
  storyNeedsPageFields,
  withPageFieldSources,
  type FieldPageContext,
};

// The piece vocabulary now lives beside the walk rather than inside it. Same re-export reason:
// every layout module already imports these from here.
export {
  type FieldAwarePiece,
  type FieldLinkProjector,
  type HyperlinkProjector,
  type ModelRange,
  type PositionalTab,
};

// Shared run-child text/property vocabulary — kept re-exported so paragraph-flow and
// numbering-index keep their import site.
export { propertiesOfRunContainer, type RunPropertyCascader } from './field-run-text.ts';

/**
 * Flatten a paragraph into measurable pieces, projecting allowlisted page fields when a
 * page context is supplied (furniture finalize / `withPageContext`).
 *
 * Well-formed computed fields (`begin`→`end`) and typed/generic `w:fldSimple` each contribute
 * one UTF-16 model unit so offsets stay aligned with `paragraphTextOf`. FORMTEXT results remain
 * editable at their natural length. Malformed fields demote the same way: markers contribute
 * nothing and interior result text stays visible.
 *
 * `w:fldSimple` advances the model offset by one and paints its result as a single projected
 * piece (live page value when allowlisted and a page context is supplied; otherwise cached
 * text, with nested allowlisted page fields evaluated live under that same context).
 *
 * Hidden runs (`w:vanish`) emit no piece while still advancing offsets.
 */
export function piecesOfParagraph(
  paragraph: OoxmlNode,
  inheritedRunProperties: readonly OoxmlProperty[] = [],
  pageContext?: FieldPageContext,
  cascadeRuns?: RunPropertyCascader,
  projectLink?: HyperlinkProjector,
  noteMarks?: NoteMarkContext,
  displayMode: RevisionDisplayMode = DEFAULT_REVISION_DISPLAY_MODE,
  deletedRanges?: MutableModelRange[],
  inlineDrawingLayout?: InlineDrawingLayoutContext,
  themeFonts?: ThemeFonts,
  projectFieldLink?: FieldLinkProjector
): FieldAwarePiece[] {
  if (paragraph.kind === 'textValue') return [];
  if (paragraph.kind !== 'paragraph') return [];

  const pieces: FieldAwarePiece[] = [];
  let offset = 0;
  /** The link the walk is currently inside, so every piece it emits is tagged with it. */
  let currentLink: SpanLinkRecord | undefined;

  const fields = parsedFieldSpansOf(paragraph as OoxmlParagraphNode, {
    maxNesting: MAX_FIELD_NESTING,
    maxInstructionChars: MAX_FIELD_INSTRUCTION_CHARS,
  });
  const atoms = fields.filter((span) => span.addressing === 'atomic');
  const atomBeginIds = new Set(
    atoms.filter((span) => span.kind === 'complex').map((span) => span.node.id)
  );
  const editableResultBeginIds = new Set(
    fields
      .filter((span) => span.kind === 'complex' && span.addressing === 'editable-result')
      .map((span) => span.node.id)
  );
  const coveredIds = new Set<string>();
  for (const span of atoms) {
    for (const id of span.removeNodeIds) coveredIds.add(id);
  }

  const field = createFieldParseState();
  const budget = createScanBudget();
  let pending: PendingFieldProjection | null = null;
  /** Outermost begin id when the open field is atomic. */
  let openAtomicBeginId: string | null = null;
  // Live-evaluated allowlisted field nested inside the open atomic result: its cached digits
  // are skipped and the matching inner end appends the projected value (fldSimple parity).
  let nestedKind: AllowlistedPageField | null = null;
  let nestedSeen = false;
  let nestedVisible = false;
  /**
   * The revision wrappers enclosing the run being processed, outermost first.
   *
   * Held here rather than threaded through every emitter because the walk is synchronous and
   * depth-first: it is set on the way into a wrapper and restored on the way out, so every
   * piece emitted in between sees exactly its own enclosing stack.
   */
  let revisions: readonly RevisionAttribution[] = NO_REVISIONS;

  const push = (
    text: string,
    props: readonly OoxmlProperty[],
    style: ResolvedRunStyle,
    projected: boolean,
    start: number,
    end: number,
    extras?: {
      readonly positionalTab?: PositionalTab;
      readonly breakKind?: HardBreakKind;
      readonly measureText?: string;
      readonly noteNav?: FieldAwarePiece['noteNav'];
      readonly inlineDrawing?: InlineDrawingLayoutInput;
      /**
       * Attribution to attach INSTEAD of the walk's live stack, for text emitted after the
       * walk has left the wrapper that owns it — a buffered field result is the only such
       * case. Passing it here keeps `push` the single place a piece is attributed.
       */
      readonly revisionsOverride?: readonly RevisionAttribution[];
      readonly linkOverride?: SpanLinkRecord;
      /** Marks this piece as a field's displayed result, for the shading Word draws under one. */
      readonly fieldAtom?: FieldAtomMarker;
    }
  ): void => {
    if (text.length === 0 && !projected && !extras?.inlineDrawing) return;
    const effectiveLink = extras?.linkOverride ?? currentLink;
    const effectiveRevisions = extras?.revisionsOverride ?? revisions;
    const link = effectiveLink ? { link: effectiveLink } : {};
    const attribution = effectiveRevisions.length === 0 ? {} : { revisions: effectiveRevisions };
    if (projected) {
      pieces.push({
        text,
        props,
        style,
        start,
        end,
        projected: true,
        ...(extras?.measureText !== undefined ? { measureText: extras.measureText } : {}),
        ...(extras?.noteNav ? { noteNav: extras.noteNav } : {}),
        ...(extras?.inlineDrawing ? { inlineDrawing: extras.inlineDrawing } : {}),
        ...(extras?.fieldAtom ? { fieldAtom: extras.fieldAtom } : {}),
        ...link,
        ...attribution,
      });
      return;
    }
    if (text.length === 0) return;
    pieces.push({
      text,
      props,
      style,
      start,
      end,
      ...(extras?.positionalTab ? { positionalTab: extras.positionalTab } : {}),
      ...(extras?.breakKind ? { breakKind: extras.breakKind } : {}),
      ...link,
      ...attribution,
    });
  };

  const commitAtomicField = (): void => {
    if (!pending || !pending.atomic) {
      pending = null;
      openAtomicBeginId = null;
      return;
    }
    const start = pending.atomStart;
    const end = start + 1;
    if (pending.style.hidden) {
      // Vanish: no piece, atom still advances (already counted at begin).
      pending = null;
      openAtomicBeginId = null;
      return;
    }
    // The walk has already left any wrapper around this field, so its attribution comes from
    // what was captured on the way in rather than from the live stack.
    //
    // Which is also why VISIBILITY has to be asked of the captured stack here rather than left
    // to the emitters: a field wrapped whole in `w:ins`/`w:del` used never to form an atom at
    // all, so this path could not meet one — until `atomicFieldSpansOf` learned to descend into
    // revision wrappers. Without this, an inserted page number painted its digits in the
    // ORIGINAL view, which is the one view that must show the document before that insertion.
    if (!revisionsVisible(pending.resultRevisions, displayMode)) {
      if (deletedRanges && revisionsAreDeletion(pending.resultRevisions)) {
        appendModelRange(deletedRanges, start, end);
      }
      pending = null;
      openAtomicBeginId = null;
      return;
    }
    // A HYPERLINK field becomes a live link only when nothing already links it: an enclosing
    // `w:hyperlink` captured into `resultLink` wins, exactly as it does for every other field.
    const fieldLink =
      !pending.resultLink && pending.linkSpec
        ? (projectFieldLink?.(pending.linkSpec) ?? null)
        : null;
    const carriedLink = pending.resultLink ?? fieldLink;
    const carried = {
      ...(pending.resultRevisions.length > 0 ? { revisionsOverride: pending.resultRevisions } : {}),
      ...(carriedLink ? { linkOverride: carriedLink } : {}),
      fieldAtom: { formField: pending.formField },
    };
    // SYMBOL renders from its instruction — Word never trusts a cached result for it, so a
    // synthesized glyph wins over stale cached text. An unresolvable spec falls through to
    // the existing branches (cached text or nothing).
    if (pending.symbolSpec) {
      const glyph = symbolFieldGlyph(pending.symbolSpec, pending.props, themeFonts);
      if (glyph) {
        push(glyph.text, glyph.props, glyph.style, true, start, end, carried);
        pending = null;
        openAtomicBeginId = null;
        return;
      }
    }
    // A legacy form field renders from its ffData state: a checkbox always (the state is the
    // authority, a stale cached glyph must not win), a dropdown only when the cache is empty.
    const form = formFieldResult(pending, themeFonts);
    if (form) {
      push(form.text, form.props, form.style, true, start, end, carried);
      pending = null;
      openAtomicBeginId = null;
      return;
    }
    if (pending.kind && pageContext) {
      const text = projectPageFieldValue(pending.kind, pageContext);
      push(text, pending.props, pending.style, true, start, end, carried);
    } else if (pending.cachedText.length > 0) {
      // Inert non-page field: paint cached result as layout-owned substitution for the
      // single model unit (same as live PAGE) so hit-test/span ranges stay one atom.
      push(pending.cachedText, pending.props, pending.style, true, start, end, carried);
    } else if (pending.buttonSpec) {
      // MACROBUTTON / GOTOBUTTON display their text; the macro / target never runs. A cached
      // result (what Word last painted) wins above — this fills in only when it is empty.
      push(pending.buttonSpec.display, pending.props, pending.style, true, start, end, carried);
    }
    pending = null;
    openAtomicBeginId = null;
  };

  const abandonPending = (): void => {
    if (!pending) return;
    // A demoted HYPERLINK keeps its link too, when nothing already linked its pieces — the
    // enclosing `w:hyperlink` a buffered piece carries wins, same precedence as the flush.
    const fieldLink =
      !pending.resultLink && pending.linkSpec
        ? (projectFieldLink?.(pending.linkSpec) ?? null)
        : null;
    const linked = (piece: FieldAwarePiece): FieldAwarePiece =>
      fieldLink && !piece.link ? { ...piece, link: fieldLink } : piece;
    if (pending.atomic) {
      // Missing end after an atomic begin should not happen (atoms require end). If the
      // scan budget aborts mid-field, roll the atom back and flush any buffered cache.
      offset = pending.atomStart;
      for (const piece of pending.buffered) {
        pieces.push({
          ...linked(piece),
          start: offset,
          end: offset + (piece.end - piece.start),
        });
        offset += piece.end - piece.start;
      }
      if (pending.cachedText.length > 0 && pending.buffered.length === 0) {
        push(
          pending.cachedText,
          pending.props,
          pending.style,
          false,
          offset,
          offset + pending.cachedText.length,
          fieldLink ? { linkOverride: fieldLink } : undefined
        );
        offset += pending.cachedText.length;
      }
    } else {
      for (const piece of pending.buffered) pieces.push(linked(piece));
      offset = pending.bufferOffset;
    }
    pending = null;
    openAtomicBeginId = null;
  };

  const pushRunContent = (
    grand: OoxmlNode,
    props: readonly OoxmlProperty[],
    style: ResolvedRunStyle
  ): void => {
    const emitInlineDrawing = (
      drawingNodeId: string,
      projection: NonNullable<ReturnType<InlineDrawingLayoutContext['project']>>,
      start: number,
      end: number
    ): void => {
      const deleted = revisionsAreDeletion(revisions);
      const suppressed = style.hidden || !revisionsVisible(revisions, displayMode) || deleted;
      if (projection.hidden || suppressed) {
        if (deleted && deletedRanges) appendModelRange(deletedRanges, start, end);
        if (!projection.hidden) return;
        push('\uFFFC', props, style, true, start, end);
        return;
      }
      push('\uFFFC', props, style, true, start, end, {
        inlineDrawing: Object.freeze({
          drawingNodeId,
          ownerPartName: inlineDrawingLayout!.ownerPartName,
          projection,
          resource: inlineDrawingLayout!.resourceOf(projection),
        }),
      });
    };

    if (grand.kind === 'drawing') {
      const start = offset;
      offset += 1;
      const end = offset;
      if (!inlineDrawingLayout) return;
      const projection =
        inlineDrawingLayout.projectionForAtom?.(grand.id) ??
        (grand.kind === 'drawing' ? inlineDrawingLayout.project(grand) : null);
      if (!projection || projection.kind !== 'inline') {
        push('\uFFFC', props, style, true, start, end);
        return;
      }
      emitInlineDrawing(grand.id, projection, start, end);
      return;
    }
    if (isRunLevelMcAlternateContent(grand)) {
      const start = offset;
      offset += 1;
      const end = offset;
      if (!inlineDrawingLayout) return;
      const projection = inlineDrawingLayout.projectionForAtom?.(grand.id) ?? null;
      if (!projection || projection.kind !== 'inline') {
        push('\uFFFC', props, style, true, start, end);
        return;
      }
      emitInlineDrawing(grand.id, projection, start, end);
      return;
    }
    if (isProjectableNoteAtom(grand)) {
      const projected = projectedNoteMarkText(grand, noteMarks);
      const start = offset;
      const end = start + 1;
      offset = end;
      if (style.hidden) return;
      if (!projected) return;
      // Empty display (customMarkFollows / separator / dangling) still advances the model
      // unit; only non-empty marks emit a measurable projected piece.
      if (projected.text.length === 0 && !projected.measureText) return;
      const noteNav =
        projected.scopeId && projected.nav
          ? { scopeId: projected.scopeId, direction: projected.nav }
          : undefined;
      push(
        projected.text.length > 0 ? projected.text : (projected.measureText ?? ''),
        props,
        style,
        true,
        start,
        end,
        {
          ...(projected.measureText !== undefined ? { measureText: projected.measureText } : {}),
          ...(noteNav ? { noteNav } : {}),
        }
      );
      return;
    }
    // A `w:ptab` advances the line but occupies NO model offset, so it is pushed with a
    // zero-width range and the offset does not move.
    const positional = positionalTabOf(grand);
    if (positional) {
      if (!style.hidden)
        push('\t', props, style, false, offset, offset, { positionalTab: positional });
      return;
    }
    // A `w:sym` is generic in the canonical tree, so the store gives it NO model width. The
    // glyph is therefore a projected piece at a zero-width range — paint emits it as
    // furniture (no `data-start`) and every surrounding offset stays where the store put it.
    if (isSymbolRunChild(grand)) {
      const glyph = symbolGlyphOf(grand);
      if (!glyph || style.hidden || !revisionsVisible(revisions, displayMode)) return;
      const sym = symbolRunStyle(props, glyph, themeFonts);
      push(glyph.text, sym.props, sym.style, true, offset, offset);
      return;
    }
    const text = modelTextOfRunChild(grand);
    if (text.length === 0) return;
    // A revision the display mode resolves away is suppressed the same way `w:vanish` is, and
    // for the same reason: the offset space belongs to the model, not to the view, so the
    // characters keep their offsets whether or not they are laid out. `w:delText` outside any
    // deletion is malformed and is suppressed unconditionally, because the one thing that must
    // never happen is deleted text flowing as ordinary text.
    const deleted = revisionsAreDeletion(revisions);
    const suppressed =
      style.hidden ||
      !revisionsVisible(revisions, displayMode) ||
      (grand.kind === 'deletedText' && !deleted);
    if (!suppressed) {
      push(text, props, style, false, offset, offset + text.length, {
        ...(grand.kind === 'hardBreak' ? { breakKind: hardBreakKind(grand) } : {}),
      });
    }
    // Deleted characters are recorded whether or not they were laid out. They occupy model
    // offsets in every mode, and the caret must step over them in every mode — including the
    // proposed result, where they produce no span at all and an offset-by-offset walk would
    // otherwise stop at invisible positions.
    if (deleted && deletedRanges) appendModelRange(deletedRanges, offset, offset + text.length);
    offset += text.length;
  };

  const processRun = (run: OoxmlNode, runDepth: number): void => {
    if (run.kind !== 'run') return;
    const props = runPropertiesOf(run, inheritedRunProperties, cascadeRuns);
    const style = resolveRunStyle(props, themeFonts);

    for (const grand of run.children) {
      if (!consumeScanNode(budget)) {
        abandonPending();
        resetFieldParseState(field);
        if (grand.kind === 'runProperties') continue;
        if (isFldChar(grand, 'begin') || isFldChar(grand, 'separate') || isFldChar(grand, 'end')) {
          continue;
        }
        if (isInstrText(grand)) continue;
        if (coveredIds.has(grand.id) && openAtomicBeginId === null) continue;
        pushRunContent(grand, props, style);
        continue;
      }

      if (grand.kind === 'runProperties') continue;

      if (isFldChar(grand, 'begin')) {
        const atomic = atomBeginIds.has(grand.id);
        onFldCharBegin(field);
        if (field.nesting === 1) {
          abandonPending();
          nestedKind = null;
          openAtomicBeginId = atomic ? grand.id : null;
          pending = {
            kind: null,
            symbolSpec: null,
            linkSpec: null,
            formSpec: null,
            buttonSpec: null,
            // Bounded ffData STATE read (checkbox checked/size, dropdown entries/selection —
            // macros never); `formField` below stays presence-based so an unreadable payload
            // still shades.
            formData: legacyFormFieldDataOf(grand),
            atomic,
            editableResult: editableResultBeginIds.has(grand.id),
            atomStart: offset,
            props,
            style,
            capturedResultStyle: false,
            cachedText: '',
            buffered: [],
            bufferOffset: offset,
            // A wrapper around the BEGIN marker wraps the whole field, and since
            // `atomicFieldSpansOf` learned to descend into revision wrappers such a field forms
            // an atom rather than demoting. Capturing here is what makes the flush able to
            // resolve visibility at all: a suppressed result run never reaches the donation
            // below — it is skipped before it gets there — so without this an inserted page
            // number painted its digits into the ORIGINAL view, with nothing recording that the
            // insertion was what put them there.
            resultRevisions: revisions,
            capturedResultRevisions: revisions.length > 0,
            formField: hasLegacyFormFieldData(grand),
            ...(currentLink ? { resultLink: currentLink } : {}),
          };
          if (atomic) {
            // Reserve the single model unit up front so surrounding offsets stay stable.
            offset += 1;
          }
        }
        continue;
      }

      if (isInstrText(grand)) {
        ingestInstrTextBounded(field, grand, budget, runDepth + 1);
        continue;
      }

      if (isFldChar(grand, 'separate')) {
        const outermostSeparate = field.nesting === 1 && field.phase === 'instruction';
        const kind = onFldCharSeparate(field);
        if (outermostSeparate && pending) {
          pending.kind = kind && pageContext ? kind : null;
          // Capture the SYMBOL / HYPERLINK / form-field spec while the machine still holds the
          // raw instruction (`onFldCharEnd` resets the buffer before the flush reads anything).
          if (!pending.kind && !field.instructionOverflow) {
            captureInstructionSpecs(pending, field.instruction);
          }
          // Prefer separate-run style until a measurable result run donates one.
          pending.props = props;
          pending.style = style;
        } else if (pending?.atomic && field.phase === 'result') {
          // Inner separate inside the outer atomic result: live-evaluate an allowlisted
          // nested field instead of concatenating its cached digits (fldSimple parity).
          nestedKind = pageContext ? kind : null;
          nestedSeen = false;
          nestedVisible = false;
        }
        continue;
      }

      if (isFldChar(grand, 'end')) {
        const outermostEnd = field.nesting === 1;
        // A SYMBOL or FORMCHECKBOX with no `separate` at all (begin/instr/end) still renders
        // in Word. The machine's buffer is reset by `onFldCharEnd`, so capture BEFORE advancing.
        if (
          outermostEnd &&
          pending?.atomic &&
          field.phase === 'instruction' &&
          !field.instructionOverflow
        ) {
          captureInstructionSpecs(pending, field.instruction);
        }
        // The end closing a skipped inner field appends its live value; an inner result that
        // existed but was entirely suppressed appends nothing (fldSimple parity).
        if (field.nesting === 2 && pending?.atomic && nestedKind && pageContext) {
          if (!nestedSeen || nestedVisible)
            pending.cachedText += projectPageFieldValue(nestedKind, pageContext);
        }
        nestedKind = null;
        onFldCharEnd(field);
        if (outermostEnd) {
          if (pending?.atomic) commitAtomicField();
          else abandonPending();
        }
        continue;
      }

      if (isCollectingInstruction(field)) {
        // Only well-formed atomic fields suppress instruction-phase run content.
        // Demoted / malformed opens must not make surrounding text disappear.
        if (pending?.atomic) continue;
      }

      if (pending && isInsideFieldResult(field)) {
        // A cached result is one plain string and cannot carry a per-glyph font switch, so
        // only a `w:sym` with a real Unicode equivalent joins it; the rest are skipped.
        if (isSymbolRunChild(grand)) {
          if (
            pending.atomic &&
            !nestedKind &&
            !style.hidden &&
            revisionsVisible(revisions, displayMode)
          ) {
            const glyph = symbolGlyphOf(grand);
            if (glyph?.unicode) pending.cachedText += glyph.text;
          }
          continue;
        }
        const text = modelTextOfRunChild(grand);
        if (text.length === 0) continue;

        // A field can be tracked as a whole — Word writes a deleted hyperlink as `w:del`
        // around the begin/instr/separate/result/end run — and its result text is BUFFERED
        // here and flushed when the field closes, by which time the walk has already left the
        // wrapper and `revisions` is empty again. Apply the suppression at buffer time or a
        // deleted field's result survives the proposed result the deletion was accepted into.
        const fieldDeleted = revisionsAreDeletion(revisions);
        const fieldSuppressed =
          !revisionsVisible(revisions, displayMode) ||
          (grand.kind === 'deletedText' && !fieldDeleted);

        // Deleted characters are recorded whether or not they were laid out, exactly as they
        // are for ordinary runs: they occupy model offsets in every display mode, and the caret
        // has to step over them in every mode. Recording this only on the suppressed branch
        // left an all-markup deletion — the mode where it is VISIBLE — absent from the ranges.
        //
        // The atomic path reserved ONE unit at `begin` and never advanced by the text length,
        // so the range is that reserved unit. Deriving it from the running offset produced
        // `start` values before the paragraph began (a measured `{start: -16, end: 1}`).
        if (fieldDeleted && deletedRanges) {
          if (pending.atomic) {
            appendModelRange(deletedRanges, pending.atomStart, pending.atomStart + 1);
          } else {
            // Unconditional on this branch too. Gating it on suppression left an all-markup
            // deletion inside a DEMOTED field out of the ranges — visible, and so the one case
            // where the caret could walk into deleted content it is meant to step over.
            appendModelRange(deletedRanges, offset, offset + text.length);
          }
        }

        if (fieldSuppressed) {
          if (pending.atomic && nestedKind) nestedSeen = true;
          if (!pending.atomic) {
            offset += text.length;
            pending.bufferOffset = offset;
          }
          continue;
        }

        if (pending.atomic) {
          // Atomic unit: cache donates display text/style only — offset already reserved.
          if (nestedKind) {
            // Skipped inner cached digits: the live value replaces them at the inner end.
            nestedSeen = true;
            if (style.hidden) continue;
            nestedVisible = true;
            if (!pending.capturedResultStyle) {
              pending.props = props;
              pending.style = style;
              pending.capturedResultStyle = true;
            }
            continue;
          }
          if (style.hidden) continue;
          if (!pending.capturedResultStyle) {
            pending.props = props;
            pending.style = style;
            pending.capturedResultStyle = true;
          }
          // The first result run that survives to be displayed donates the attribution the
          // flush will replay, because by then the walk has left the wrapper. See
          // `resultRevisions` for why first wins.
          //
          // Locked by its own flag, not by the stack being non-empty: an UNTRACKED first run
          // leaves the stack empty, and testing emptiness let a later tracked run donate its
          // revision to the whole atom. `Section <w:del>3</w:del>` then painted "Section 3"
          // struck through entire — the engine claiming a deletion over words nobody deleted.
          if (!pending.capturedResultRevisions) {
            pending.resultRevisions = revisions;
            pending.capturedResultRevisions = true;
            if (!pending.resultLink && currentLink) pending.resultLink = currentLink;
          }
          pending.cachedText += text;
          continue;
        }

        // Demoted field: result text is ordinary addressable content.
        if (style.hidden) {
          offset += text.length;
          pending.bufferOffset = offset;
          continue;
        }
        if (!pending.capturedResultStyle) {
          pending.props = props;
          pending.style = style;
          pending.capturedResultStyle = true;
        }
        // Buffered rather than pushed, so it does not pass through `push` and has to carry its
        // own attribution. Here the walk is STILL inside the wrapper, so the live stack is the
        // right one — unlike the atomic flush, which happens after the walk has left it. The
        // link matters for the same reason: a demoted field inside a `w:hyperlink` lost its
        // href here while every ordinary run in the same link kept one.
        pending.buffered.push({
          text,
          props,
          style,
          start: offset,
          end: offset + text.length,
          ...(revisions.length > 0 ? { revisions } : {}),
          ...(currentLink ? { link: currentLink } : {}),
          ...(pending.editableResult ? { fieldAtom: { formField: pending.formField } } : {}),
        });
        offset += text.length;
        pending.bufferOffset = offset;
        continue;
      }

      // Covered by a closed atomic field we already committed — should not reach here
      // because those nodes are skipped via the begin→end control flow. Still guard.
      if (coveredIds.has(grand.id) && openAtomicBeginId === null && atomBeginIds.size > 0) {
        // Node belongs to a later/earlier atom; if we're between fields, skip chrome only.
      }

      pushRunContent(grand, props, style);
    }
  };

  /**
   * Walk content in document order, descending through every RUN CONTAINER.
   *
   * Typed runs contribute measurable / selectable text. Generic siblings stay structurally
   * preserved but layout-inert for page-field evaluation; typed/generic `w:fldSimple` advances
   * one model unit and paints through {@link projectSimpleField}. The exceptions are the
   * containers that are not content themselves but hold runs that are:
   *
   *   - `w:hyperlink`. Skipping it is what made every link's words vanish from the painted
   *     page while still occupying model offsets.
   *   - the revision wrappers. Skipping them dropped tracked content entirely, so the reader
   *     saw a third text belonging to neither the original nor the proposal.
   *   - inline content controls (`w:sdt`). Skipping them made their words vanish while still
   *     occupying model offsets (or, for generic SDTs, occupy none at all).
   *
   * Any can hold the others, and a link inside a tracked insertion is ordinary, so the walk
   * is one recursion rather than separate passes.
   *
   * The complex-field machine spans runs in document order within the paragraph, so descending
   * must not restart it — the walk visits runs in the same order a reader sees them, whatever
   * their nesting. Content-control nesting shares {@link MAX_CONTENT_CONTROL_NESTING} with
   * block flattening; field-scan depth stays separate.
   */
  if (!consumeScanNode(budget)) return pieces;
  const paragraphScope = emptyNamespaceScope();

  /**
   * Paint a `w:fldSimple` (§17.16.19) as one projected model unit.
   *
   * The instruction lives in `@w:instr` and the last-computed result as child runs — there is
   * no `separate` marker on the outer field itself. Allowlisted PAGE / NUMPAGES / SECTIONPAGES
   * evaluate from the page context when one is supplied. Every other instruction paints its
   * cached result, but nested allowlisted page fields inside that cache still evaluate live
   * (see {@link collectSimpleFieldDisplay}) so a `STYLEREF` wrapping `PAGE` does not stamp the
   * saved sheet's number onto every page.
   *
   * Attribution comes from `push` reading the live stack — a `w:fldSimple` inside `w:ins` is
   * still inside it here, unlike a complex field's deferred flush.
   */
  const projectSimpleField = (simple: OoxmlNode, depth: number): void => {
    const start = offset;
    offset += 1;
    if (simple.kind === 'textValue') return;

    // The atom is one model offset whatever it paints, so a revision enclosing the WHOLE field
    // is answered here, once, before any of the branches below — including the live page-field
    // one, which does not go through result collection and so would otherwise paint a deleted
    // footer number straight into the accepted view.
    //
    // The deleted range is recorded whether or not it was laid out, exactly as the complex path
    // and inline drawings do: the offset exists in every display mode and the caret has to step
    // over it in every mode.
    if (revisionsAreDeletion(revisions) && deletedRanges) {
      appendModelRange(deletedRanges, start, start + 1);
    }
    if (!revisionsVisible(revisions, displayMode)) return;

    const display = collectSimpleFieldDisplay({
      simple,
      depth,
      pageContext,
      budget,
      revisions,
      displayMode,
      inheritedRunProperties,
      cascadeRuns,
      themeFonts,
    });

    // A simple PAGE/NUMPAGES/SECTIONPAGES field is evaluated like its complex twin when the
    // caller supplies a page context. The CACHED result is whatever sheet the producer last
    // saved from, so painting it verbatim would put that page's number on every page —
    // `detectStoryPageFields` now reports these so furniture actually gets a per-sheet context
    // to evaluate against.
    const pageKind = allowlistedPageField(fldSimpleInstr(simple) ?? '');
    if (pageKind && pageContext) {
      const live = projectPageFieldValue(pageKind, pageContext);
      const style = display.resultStyle ?? resolveRunStyle(inheritedRunProperties, themeFonts);
      if (!style.hidden) {
        push(live, display.resultProps ?? inheritedRunProperties, style, true, start, start + 1, {
          fieldAtom: { formField: false },
        });
      }
      return;
    }

    // A simple SYMBOL renders from its instruction like the complex shape does — there is no
    // trustworthy cached result to prefer. An unresolvable spec falls through to the cached
    // display (previous behavior).
    const symbolSpec = parseSymbolInstruction(fldSimpleInstr(simple) ?? '');
    if (symbolSpec) {
      const glyph = symbolFieldGlyph(
        symbolSpec,
        display.resultProps ?? inheritedRunProperties,
        themeFonts
      );
      if (glyph) {
        if (!glyph.style.hidden) {
          push(glyph.text, glyph.props, glyph.style, true, start, start + 1, {
            fieldAtom: { formField: false },
          });
        }
        return;
      }
    }

    // A simple MACROBUTTON / GOTOBUTTON displays everything after its first argument; the
    // macro / target never runs. A non-empty cached display wins — synthesis fills an empty one.
    const buttonSpec =
      display.text.length === 0 ? parseButtonInstruction(fldSimpleInstr(simple) ?? '') : null;
    if (buttonSpec) {
      const buttonStyle =
        display.resultStyle ?? resolveRunStyle(inheritedRunProperties, themeFonts);
      if (buttonStyle.hidden) return;
      const buttonProps = display.resultProps ?? inheritedRunProperties;
      push(buttonSpec.display, buttonProps, buttonStyle, true, start, start + 1, {
        fieldAtom: { formField: false },
      });
      return;
    }

    if (display.text.length === 0) return;
    // Nested live PAGE may replace an empty cached result and leave no donor run; fall back
    // to inherited properties the same way a top-level simple PAGE does.
    const style = display.resultStyle ?? resolveRunStyle(inheritedRunProperties, themeFonts);
    if (style.hidden) return;
    // A simple HYPERLINK links its cached result — but only outside a typed `w:hyperlink`,
    // whose record `push` already applies and which outranks the field's own instruction.
    // An empty result never reached here, so an empty result never paints the URL.
    const linkSpec = currentLink ? null : parseHyperlinkInstruction(fldSimpleInstr(simple) ?? '');
    const fieldLink = linkSpec ? (projectFieldLink?.(linkSpec) ?? null) : null;
    // `w:ffData` is a `w:fldChar` payload, so a simple field is never a legacy form field.
    push(
      display.text,
      display.resultProps ?? inheritedRunProperties,
      style,
      true,
      start,
      start + 1,
      {
        fieldAtom: { formField: false },
        ...(fieldLink ? { linkOverride: fieldLink } : {}),
      }
    );
  };

  const processInline = (
    child: OoxmlNode,
    depth: number,
    namespaceScope: ReadonlyMap<string, string>,
    sdtDepth: number
  ): void => {
    if (isFldSimple(child)) {
      projectSimpleField(child, depth);
      return;
    }
    if (child.kind === 'run') {
      processRun(child, depth);
      return;
    }
    if (isContentControl(child)) {
      if (sdtDepth >= MAX_CONTENT_CONTROL_NESTING) return;
      if (depth > MAX_STORY_FIELD_SCAN_DEPTH) return;
      for (const inner of contentControlContentChildren(child)) {
        processInline(inner, depth + 1, namespaceScope, sdtDepth + 1);
      }
      return;
    }
    if (depth > MAX_STORY_FIELD_SCAN_DEPTH || depth >= MAX_REVISION_DEPTH) return;
    const childScope =
      child.kind !== 'textValue' && 'localName' in child
        ? namespaceScopeForNode(namespaceScope, child)
        : namespaceScope;
    if (child.kind === 'hyperlink') {
      // The link is projected ONCE per element, not per run: sanitization is not free, and a
      // link's runs must all carry the same record so paint can group them by identity.
      const previous = currentLink;
      currentLink = projectLink?.(child) ?? undefined;
      for (const inner of child.children) processInline(inner, depth + 1, childScope, sdtDepth);
      currentLink = previous;
      return;
    }
    if (!isRevisionWrapper(child)) return;
    const attribution = revisionAttributionOf(child);
    if (!attribution) return;
    if (!consumeScanNode(budget)) return;
    const enclosing = revisions;
    revisions = withRevision(enclosing, attribution);
    for (const inner of child.children) processInline(inner, depth + 1, childScope, sdtDepth);
    revisions = enclosing;
  };
  // Paragraph root counts as depth 0; run children sit at depth 1.
  for (const child of paragraph.children) processInline(child, 1, paragraphScope, 0);
  // Malformed field missing end: demote — surface cached/buffered text, no live projection.
  abandonPending();

  return pieces;
}
