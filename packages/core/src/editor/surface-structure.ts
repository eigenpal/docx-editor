// Structural edits at the selection (paginated-surface seam).
//
// Breaks, lists, indent and section properties: the edits that change what the document
// IS rather than how a run looks. They share one shape — resolve the paragraphs the
// selection touches, plan tree ops, commit once — and they are the only surface methods
// that read `numbering.xml` or `w:sectPr`, so they sit together rather than in the
// composition root.

import type { TreeApplyResult, TreeDocxSessionView } from '@docx-editor.dev/core/binding';
import type { TreeDocOp, StoryScope } from '@docx-editor.dev/core/store';
import {
  enumerateDocumentSections,
  paragraphsInCells,
  readSectionProperties,
  storyBlocks,
  type SemanticLayout,
  type SemanticPosition,
  type SemanticSelection,
} from '@docx-editor.dev/core/layout';
import type { ListMarkerRecord } from '@docx-editor.dev/core/layout';
import { fragmentHolding } from '../layout/line-segments.ts';
import { paragraphTabStopsOf } from './surface-formatting.ts';
import {
  lineSpacingAttributes,
  paragraphFlagAttributes,
  spacingSideAttributes,
} from './paragraph-format-write.ts';
import {
  directParagraphProperties,
  mergedProperties,
  paragraphPropertiesOf,
} from './surface-formatting.ts';
import type {
  PaginatedSurface,
  SurfaceParagraphFormat,
  ParagraphPropertyEdit,
} from './paginated-surface-contract.ts';

/**
 * The dialog's checkbox fields, and the `w:pPr` element each writes.
 *
 * One table so the update shape and the write cannot drift apart.
 */
const PARAGRAPH_FLAG_PROPERTIES = [
  ['contextualSpacing', 'contextualSpacing'],
  ['keepNext', 'keepNext'],
  ['keepLines', 'keepLines'],
  ['widowControl', 'widowControl'],
  ['pageBreakBefore', 'pageBreakBefore'],
] as const satisfies readonly (readonly [keyof SurfaceParagraphFormat, string])[];
import type { RangeDeletionPlan } from './surface-selection-ops.ts';

/** What the composition root lends this lane: its session, its layout, and its commit. */
export interface SurfaceStructureDeps {
  readonly session: TreeDocxSessionView;
  /** Active story for content mutations — body or open furniture. */
  storyScope(): StoryScope;
  /** The CURRENT layout — read per call, never captured. */
  layout(): SemanticLayout;
  commit(
    run: () => TreeApplyResult | boolean,
    nextSelection?: () => SemanticSelection | null,
    options?: { readonly keepCellSelection?: boolean }
  ): void;
  orderedStart(): SemanticPosition;
  orderedRange(): { from: SemanticPosition; to: SemanticPosition };
  selectionMark(): { paragraphId: string; start: number; end: number } | null;
  collapsedAt(position: SemanticPosition): SemanticSelection;
  /**
   * The ops that remove the current selection, and the position that survives them.
   *
   * Every insertion below REPLACES the selection and then addresses a paragraph, and the
   * plan's `collapseTo` is the only position guaranteed to still exist afterwards: a plan
   * that removes a table takes its cell paragraphs with it, and an op naming one the same
   * transaction deleted vetoes the whole transaction.
   */
  deleteSelectionPlan(): RangeDeletionPlan;
  /** The model text of one paragraph, for telling an empty list item from a filled one. */
  paragraphTextOf(paragraphId: string): string;
  /** Whether `numId` declares `level`, for refusing a demote that would erase the marker. */
  numberingLevelExists(numId: string, level: number): boolean;
  /** Paragraph ids in reading order for the active scope. */
  paragraphOrder(): readonly string[];
  /**
   * The cells a RECTANGLE selection covers, when there is one.
   *
   * A rectangle is not the range it stands in for: read as a range, a selected column runs
   * through every cell between its corners in document order, so bulleting the left column
   * of a 2x2 table also bulleted the cell beside it. `setParagraphProperty` already asks
   * this question (see `surface-format.ts`); every write here has to ask it too.
   */
  selectedCells?(): readonly string[] | undefined;
}

type StructureMethods = Pick<
  PaginatedSurface,
  | 'insertTab'
  | 'insertLineBreak'
  | 'insertPageBreak'
  | 'isListParagraph'
  | 'isListActive'
  | 'toggleList'
  | 'adjustIndent'
  | 'setIndent'
  | 'setParagraphFormat'
  | 'canAdjustIndent'
  | 'exitListOnEmptyItem'
  | 'sectionProperties'
  | 'sectionPropertiesAt'
  | 'setSectionProperties'
  | 'insertSectionBreak'
>;

/**
 * The `w:ind` attributes that state a new LEFT indent, written in the spellings the
 * paragraph already uses.
 *
 * `CT_Ind` spells the left indent twice: `w:left` and, in the direction-relative vocabulary
 * ISO 29500 kept, `w:start` (17.3.1.12) — and the type carries BOTH, so a paragraph authored
 * with one and rewritten with the other ends up stating two different indents in one element.
 * That is not a tidiness problem: nothing makes the two readers agree about which of the pair
 * governs, and this engine's own is `left ?? start`, so `<w:ind w:start="720" w:left="1440"/>`
 * is a paragraph that moved here and did not move in Word. Rewriting what is there keeps the
 * element saying one thing.
 */
function leftIndentAttributes(
  authored: Readonly<Record<string, string>> | undefined,
  value: string
): Record<string, string> {
  const attributes: Record<string, string> = { ...(authored ?? {}) };
  // The character-unit twin supersedes the twips (§17.3.1.12), so the step has to clear it
  // or the paragraph does not move. BOTH spellings: `CT_Ind` declares `w:startChars` too,
  // and ISO Strict declares only that one.
  delete attributes.leftChars;
  delete attributes.startChars;
  if (authored?.start !== undefined) attributes.start = value;
  if (authored?.start === undefined || authored.left !== undefined) attributes.left = value;
  return attributes;
}

/**
 * The same rule as {@link leftIndentAttributes}, for either side, plus removal.
 *
 * `null` drops BOTH spellings, which is how "clear this back to the style" differs from
 * "set it to zero" — a zero blocks the cascade, a missing attribute lets the style through.
 */
function writeIndentSide(
  authored: Readonly<Record<string, string>>,
  physical: 'left' | 'right',
  relative: 'start' | 'end',
  value: number | null
): Record<string, string> {
  const attributes: Record<string, string> = { ...authored };
  // The CHARACTER-unit twin goes with the measurement either way, because it SUPERSEDES it
  // (§17.3.1.12): `w:leftChars` measures the same indent in hundredths of a character, so a
  // merging write that left it in place wrote twips the file then ignored. Both spellings —
  // `w:startChars`/`w:endChars` are the direction-relative names, and the only ones ISO
  // Strict declares.
  delete attributes[`${physical}Chars`];
  delete attributes[`${relative}Chars`];
  if (value === null) {
    delete attributes[physical];
    delete attributes[relative];
    return attributes;
  }
  const text = String(value);
  // Tested against the AUTHORED set, not the copy being built, so the second branch cannot
  // observe the write the first one just made.
  const hadRelative = authored[relative] !== undefined;
  if (hadRelative) attributes[relative] = text;
  if (!hadRelative || authored[physical] !== undefined) attributes[physical] = text;
  return attributes;
}

/**
 * One SIGNED first-line offset written as the two attributes OOXML spells it with.
 *
 * BOTH are always written, the unused one as an explicit `"0"` — never dropped. `w:ind`
 * cascades attribute by attribute, so dropping the direct `w:hanging` on a paragraph whose
 * STYLE sets one leaves the style's value in the cascade; hanging then WINS (§17.3.1.12)
 * and the edit silently does nothing. `adjustIndent` writes its zero for the same reason.
 */
function writeFirstLine(
  authored: Readonly<Record<string, string>>,
  value: number | null
): Record<string, string> {
  const attributes: Record<string, string> = { ...authored };
  // Both character-unit twins go too: either supersedes the twips beside it.
  delete attributes.firstLineChars;
  delete attributes.hangingChars;
  if (value === null) {
    delete attributes.firstLine;
    delete attributes.hanging;
    return attributes;
  }
  if (value >= 0) {
    attributes.firstLine = String(value);
    attributes.hanging = '0';
  } else {
    attributes.hanging = String(-value);
    attributes.firstLine = '0';
  }
  return attributes;
}

export function createSurfaceStructure(deps: SurfaceStructureDeps): StructureMethods {
  const { session, commit, orderedStart, orderedRange, selectionMark, collapsedAt } = deps;
  const deleteSelectionPlan = deps.deleteSelectionPlan;
  const storyPart = () => session.partFor(deps.storyScope()) ?? session.part();
  const applyOps = (
    ops: Parameters<TreeDocxSessionView['applyTreeOps']>[0],
    before?: Parameters<TreeDocxSessionView['applyTreeOps']>[1],
    after?: Parameters<TreeDocxSessionView['applyTreeOps']>[2]
  ): TreeApplyResult => session.applyTreeOps(ops, before, after, deps.storyScope());
  const orderOf = () => deps.paragraphOrder();
  const currentLayout = {
    get value(): SemanticLayout {
      return deps.layout();
    },
  };

  /** The live cell rectangle, or null when the selection is an ordinary range. */
  function rectangleCells(): readonly string[] | null {
    const cells = deps.selectedCells?.();
    return cells && cells.length > 0 ? cells : null;
  }

  /**
   * Commit a structural write, keeping a cell RECTANGLE selected across it.
   *
   * `setParagraphProperty` already does this, so Centre left a selected column selected while
   * Bullets and Increase Indent cleared it — the same gesture behaving two ways depending on
   * which button was pressed.
   */
  function commitOverTarget(run: () => TreeApplyResult): boolean {
    let committed = false;
    commit(
      () => {
        const result = run();
        committed = result.committed;
        return result;
      },
      undefined,
      { keepCellSelection: rectangleCells() !== null }
    );
    return committed;
  }

  /**
   * The paragraphs a structural write acts on, in document order, or null when the
   * selection does not resolve against the active scope's order.
   *
   * A RECTANGLE takes precedence over the range, exactly as it does for
   * `setParagraphProperty`: with a column selected, these are the column's paragraphs and
   * nothing between them. Without one, the selection sweeps from its first paragraph to its
   * last, which is what Word does and what every one of these verbs did before.
   */
  function targetParagraphs(): readonly string[] | null {
    if (rectangleCells() !== null) {
      return [...paragraphsInCells(currentLayout.value, rectangleCells()!)];
    }
    const { from, to } = orderedRange();
    const order = orderOf();
    const firstIndex = order.indexOf(from.paragraphId);
    const lastIndex = order.indexOf(to.paragraphId);
    if (firstIndex === -1 || lastIndex === -1) return null;
    return order.slice(firstIndex, lastIndex + 1);
  }

  /** Word's Increase/Decrease Indent step: one default tab stop. */
  const INDENT_STEP_TWIPS = 720;
  /** `w:ilvl` is 0..8 (ECMA-376 17.9.24). */
  const MAX_LIST_LEVEL = 8;

  /** The list level of a paragraph, or null when it carries no numbering. */
  function listLevelOf(paragraphId: string): number | null {
    return markerOf(paragraphId)?.level ?? null;
  }

  /** The marker layout resolved for a paragraph, or null when it is not a list item. */
  function markerOf(paragraphId: string): ListMarkerRecord | null {
    // Paragraphs inside table cells are nested under table/row/cell records rather than
    // published as top-level page fragments, and a resolved display mode publishes a merged
    // run under the survivor's name alone. `fragmentHolding` covers both: it walks the same
    // canonical recursive walk, and falls back to the paragraphs a fragment DRAWS when no
    // fragment carries the name. Without that, the caret in the absorbed half of a merged
    // list item read as "not a list item", so Tab inserted a tab instead of demoting it.
    return fragmentHolding(currentLayout.value, paragraphId)?.marker ?? null;
  }

  /**
   * Which kind of list a paragraph is in.
   *
   * Read from the resolved level's `w:numFmt`, never from the marker GLYPH: a bullet
   * level may legitimately use a letter-shaped character (Wingdings `§`, Courier `o` —
   * both of which Word's own default list uses at levels 2 and 3), so sniffing the text
   * reported half of every multi-level bullet list as numbered.
   */
  function listKindOf(paragraphId: string): 'bullet' | 'ordered' | null {
    const marker = markerOf(paragraphId);
    if (!marker) return null;
    return marker.numFmt === 'bullet' ? 'bullet' : 'ordered';
  }

  /**
   * The `w:numId` an adjacent paragraph of the same kind already uses, if any.
   *
   * Turning a list back on rejoins the list around it rather than minting a second
   * definition — otherwise re-bulleting one item in the middle of a list gave it a
   * different glyph from its neighbours.
   */
  function adjacentListNumId(
    touched: readonly string[],
    kind: 'bullet' | 'ordered'
  ): string | null {
    const order = orderOf();
    const first = order.indexOf(touched[0] ?? '');
    const last = order.indexOf(touched[touched.length - 1] ?? '');
    if (first === -1 || last === -1) return null;
    // The paragraph BEFORE the selection, then the one after.
    for (const index of [first - 1, last + 1]) {
      const neighbour = order[index];
      if (!neighbour) continue;
      const marker = markerOf(neighbour);
      if (!marker) continue;
      if ((marker.numFmt === 'bullet' ? 'bullet' : 'ordered') === kind) return marker.numId;
    }
    return null;
  }

  /**
   * Whether a list paragraph could move to `level` WITHOUT touching `numbering.xml`.
   *
   * A `w:abstractNum` need not declare all nine levels — plenty of real documents declare
   * only `ilvl 0` — and a paragraph moved to a level its definition does not declare
   * resolves to no marker at all: it silently stops being a list item and springs back to
   * the margin. `adjustIndent` answers that by DECLARING the level first (Word's own move:
   * its stock bullets and number formats cycle by depth); this check is for the paths that
   * must not write, like Enter on an empty item deciding between outdent and exit.
   */
  function listLevelExists(marker: ListMarkerRecord, level: number): boolean {
    if (level < 0 || level > MAX_LIST_LEVEL) return false;
    return deps.numberingLevelExists(marker.numId, level);
  }

  /**
   * Make `level` resolvable for `marker`'s definition, declaring it when missing.
   *
   * The declared format is Word's default for that depth. Refusal (a delegating
   * `w:numStyleLink` definition, a vanished part) leaves the document untouched and the
   * move skipped.
   */
  function ensureListLevel(marker: ListMarkerRecord, level: number): boolean {
    if (level < 0 || level > MAX_LIST_LEVEL) return false;
    if (deps.numberingLevelExists(marker.numId, level)) return true;
    const declared = session.ensureNumberingLevel(
      marker.numId,
      level,
      marker.numFmt === 'bullet' ? 'bullet' : 'ordered'
    );
    // The write path and the layout index are DIFFERENT readers of numbering.xml, and a
    // hostile file can make them disagree — a foreign-namespace `lvl` satisfies a lax
    // "already declared" while resolving to nothing. Only the index's answer decides
    // whether `setListLevel` is safe: an ensure the index cannot see is a skip, not a
    // commit that silently erases the marker.
    return declared && deps.numberingLevelExists(marker.numId, level);
  }

  /**
   * `w:ind/@left` in twips, zero when nothing states it.
   *
   * Resolved across the whole list rather than picked out of it: this reads a CASCADE, whose
   * entries run lowest precedence first, so taking the first `w:ind` answered the style's
   * indent for a paragraph that had already been indented past it — and Increase Indent then
   * rewrote the same one step forever.
   *
   * Resolved PER LEVEL, not per attribute, which is where `cascadedParagraphAttributes` is
   * the wrong tool: `w:left` and `w:start` are two SPELLINGS OF ONE SETTING (transitional and
   * ISO Strict), so flattening both into one bag and preferring `left` answers whichever
   * level happened to use that word. A paragraph spelling it `w:start` over a style spelling
   * it `w:left` then stepped BACKWARDS on Increase Indent. This is the rule `paragraphIndent`
   * already applies, and the two must agree or the ruler and the button disagree.
   */
  function leftIndentTwipsOf(
    properties: readonly { localName: string; attributes?: Readonly<Record<string, string>> }[]
  ): number {
    let raw: string | undefined;
    for (const property of properties) {
      if (property.localName !== 'ind') continue;
      const stated = property.attributes?.left ?? property.attributes?.start;
      if (stated !== undefined) raw = stated;
    }
    if (!raw || !/^-?\d{1,7}$/.test(raw)) return 0;
    return Number(raw);
  }

  return {
    insertTab() {
      const plan = deleteSelectionPlan();
      const start = plan.collapseTo;
      commit(
        () =>
          applyOps(
            [
              ...plan.ops,
              { op: 'insertTab', paragraphId: start.paragraphId, offset: start.offset },
            ],
            selectionMark()
          ),
        () => collapsedAt({ ...start, offset: start.offset + 1 })
      );
    },

    insertLineBreak() {
      const plan = deleteSelectionPlan();
      const start = plan.collapseTo;
      commit(
        () =>
          applyOps(
            [
              ...plan.ops,
              { op: 'insertHardBreak', paragraphId: start.paragraphId, offset: start.offset },
            ],
            selectionMark()
          ),
        () => collapsedAt({ ...start, offset: start.offset + 1 })
      );
    },

    insertPageBreak() {
      const plan = deleteSelectionPlan();
      const start = plan.collapseTo;
      commit(
        () =>
          applyOps(
            [
              ...plan.ops,
              { op: 'insertPageBreak', paragraphId: start.paragraphId, offset: start.offset },
            ],
            selectionMark()
          ),
        () => collapsedAt({ ...start, offset: start.offset + 1 })
      );
    },

    /**
     * Enter on an EMPTY list item leaves the list, the way Word does.
     *
     * Pressing Enter at the end of a list makes another item; pressing it again on that
     * still-empty item is how a user says "I am done with this list". Word outdents one
     * level per press and drops the numbering at level 0. Answers whether it handled the
     * key, so the caller falls through to an ordinary split when it did not.
     */
    exitListOnEmptyItem() {
      const { from, to } = orderedRange();
      if (from.paragraphId !== to.paragraphId || from.offset !== to.offset) return false;
      const marker = markerOf(from.paragraphId);
      if (!marker) return false;
      // Only an EMPTY item: Enter inside text still splits the paragraph.
      const text = deps.paragraphTextOf(from.paragraphId);
      if (text.length > 0) return false;

      const outdented = marker.level > 0 && listLevelExists(marker, marker.level - 1);
      const op: TreeDocOp = outdented
        ? { op: 'setListLevel', paragraphId: from.paragraphId, level: marker.level - 1 }
        : { op: 'setListNumbering', paragraphId: from.paragraphId, numId: null };
      let committed = false;
      commit(() => {
        const result = applyOps([op], selectionMark());
        committed = result.committed;
        return result;
      });
      return committed;
    },

    isListParagraph() {
      const { paragraphId } = orderedStart();
      return listLevelOf(paragraphId) !== null;
    },

    isListActive(kind) {
      const touched = targetParagraphs();
      if (touched === null) return false;
      const wanted = kind === 'bullet' ? 'bullet' : 'ordered';
      return (
        touched.length > 0 && touched.every((paragraphId) => listKindOf(paragraphId) === wanted)
      );
    },

    toggleList(kind) {
      const touched = targetParagraphs();
      if (touched === null || touched.length === 0) return false;
      // Word toggles OFF only when the whole selection is already that list; a mixed
      // selection becomes one list rather than clearing half of it.
      const turningOff = touched.every((paragraphId) => listKindOf(paragraphId) === kind);
      const numId = turningOff
        ? null
        : (adjacentListNumId(touched, kind) ?? session.ensureListDefinition(kind));
      if (!turningOff && numId === null) return false;
      const ops: TreeDocOp[] = touched.map((paragraphId) => {
        // `w:numPr` carries the level AND the definition, and the op mints a fresh one, so
        // a call that names no level silently resets `w:ilvl` to 0. Word converts a bullet
        // to a number IN PLACE: pressing Numbered on a level-2 item left it at level 2,
        // where this flattened it to the left margin two levels out.
        const level = listLevelOf(paragraphId);
        return {
          op: 'setListNumbering' as const,
          paragraphId,
          numId,
          ...(level !== null ? { level } : {}),
        };
      });
      return commitOverTarget(() => applyOps(ops, selectionMark()));
    },

    canAdjustIndent(direction) {
      const touched = targetParagraphs();
      if (touched === null) return false;
      const step = direction === 'increase' ? 1 : -1;
      // Enabled when ANY paragraph the selection touches could move. Word greys the
      // control out only when nothing would happen at all — and for a list item that is
      // the ENDS of the level range, never a missing definition: a level `numbering.xml`
      // does not declare gets declared on the way (see `ensureListLevel`).
      return touched.some((paragraphId) => {
        const marker = markerOf(paragraphId);
        if (marker) {
          const next = marker.level + step;
          return next >= 0 && next <= MAX_LIST_LEVEL;
        }
        const current = leftIndentTwipsOf(paragraphPropertiesOf(currentLayout.value, paragraphId));
        return Math.max(0, current + step * INDENT_STEP_TWIPS) !== current;
      });
    },

    adjustIndent(direction) {
      const touched = targetParagraphs();
      if (touched === null) return false;
      const step = direction === 'increase' ? 1 : -1;
      const ops: TreeDocOp[] = [];
      for (const paragraphId of touched) {
        const properties = paragraphPropertiesOf(currentLayout.value, paragraphId);
        const marker = markerOf(paragraphId);
        const level = marker?.level ?? null;
        if (marker && level !== null) {
          // A list item DEMOTES rather than shifting: `w:ilvl` is what picks the level's
          // format out of numbering.xml, so the marker changes with the indent the way
          // Word's Tab does. Nine levels exist (17.9.24); the ends are no-ops, not errors.
          // A level the definition does not declare is DECLARED first — Word's own move,
          // cycling its stock bullets and number formats by depth. The declaration lands
          // outside the transaction, like `toggleList`'s `ensureListDefinition`: if the
          // commit then fails, the extra level is unreferenced and harmless.
          const next = level + step;
          if (next < 0 || next > MAX_LIST_LEVEL) continue;
          if (!ensureListLevel(marker, next)) continue;
          ops.push({
            op: 'setListLevel',
            paragraphId,
            level: next,
          });
          continue;
        }
        // The step moves from the EFFECTIVE indent (what the user sees, cascade included),
        // but it is written as the paragraph's own formatting, merged over the paragraph's
        // own `w:pPr` — an op whose base is the cascade is refused (`directParagraphProperties`).
        const current = leftIndentTwipsOf(properties);
        const next = Math.max(0, current + step * INDENT_STEP_TWIPS);
        if (next === current) continue;
        const direct = directParagraphProperties(storyPart(), paragraphId);
        // Only the paragraph's OWN `w:ind` attributes are carried over: `w:ind` cascades
        // attribute by attribute (17.3.1.12), so an inherited hanging survives untouched
        // rather than being restated here.
        const existing = direct.find((property) => property.localName === 'ind');
        ops.push({
          op: 'setParagraphProperties',
          paragraphId,
          properties: mergedProperties(direct, {
            localName: 'ind',
            // Zero is written rather than dropped: an authored `w:ind` may inherit a
            // non-zero left from its style, and removing the attribute would let that
            // come back instead of taking the outdent.
            attributes: leftIndentAttributes(existing?.attributes, String(next)),
          }),
        });
      }
      if (ops.length === 0) return false;
      return commitOverTarget(() => applyOps(ops, selectionMark()));
    },

    setIndent(update) {
      if (update.left === undefined && update.right === undefined && update.firstLine === undefined)
        return false;
      // The SCOPED order and the SCOPED part, like every other write in this lane. Reading
      // the body order meant a header paragraph was never in it, so a ruler drag inside an
      // open header or footer resolved to -1 and returned false — silently doing nothing.
      const touched = targetParagraphs();
      if (touched === null) return false;
      const ops: TreeDocOp[] = [];
      for (const paragraphId of touched) {
        // Merged over the paragraph's OWN `w:ind`, never the cascade the layout publishes:
        // an op whose base is the cascade is refused, and `w:ind` carries four independent
        // settings in one element, so naming one field must leave the others as authored.
        const direct = directParagraphProperties(storyPart(), paragraphId);
        const authored = direct.find((property) => property.localName === 'ind')?.attributes ?? {};
        let attributes: Record<string, string> = { ...authored };
        if (update.left !== undefined) {
          attributes = writeIndentSide(attributes, 'left', 'start', update.left);
        }
        if (update.right !== undefined) {
          attributes = writeIndentSide(attributes, 'right', 'end', update.right);
        }
        if (update.firstLine !== undefined) {
          attributes = writeFirstLine(attributes, update.firstLine);
        }
        ops.push({
          op: 'setParagraphProperties',
          paragraphId,
          properties: mergedProperties(direct, {
            localName: 'ind',
            ...(Object.keys(attributes).length > 0 ? { attributes } : {}),
          }),
        });
      }
      if (ops.length === 0) return false;
      return commitOverTarget(() => applyOps(ops, selectionMark()));
    },

    setParagraphFormat(update) {
      const touched = targetParagraphs();
      if (touched === null || touched.length === 0) return false;
      // ONE op per paragraph carrying EVERY field the dialog changed, so OK is one undo
      // step and the page repaints once. Firing a command per field would leave the user
      // pressing Ctrl+Z five times and would paint four intermediate layouts on the way.
      const entries: ParagraphPropertyEdit[] = [];
      if (update.alignment !== undefined) {
        entries.push({ localName: 'jc', attributes: { val: update.alignment } });
      }
      const spacing: Record<string, string | null> = {
        ...spacingSideAttributes('before', update.spaceBeforePt),
        ...spacingSideAttributes('after', update.spaceAfterPt),
        ...lineSpacingAttributes(update.lineSpacing),
      };
      if (Object.keys(spacing).length > 0) {
        entries.push({ localName: 'spacing', attributes: spacing, mergeAttributes: true });
      }
      for (const [field, localName] of PARAGRAPH_FLAG_PROPERTIES) {
        const on = update[field];
        if (on !== undefined) {
          entries.push({ localName, attributes: paragraphFlagAttributes(on) });
        }
      }
      // Tab stops ride the SAME transaction as the properties above, so the dialog is still
      // one undo step. They are a separate op because `w:tabs` carries `w:tab` children and
      // a property is flat — see `applySetParagraphTabStops`.
      const wantsTabStops = update.tabStops !== undefined;
      const wantsIndent =
        update.indentLeftTwips !== undefined ||
        update.indentRightTwips !== undefined ||
        update.indentFirstLineTwips !== undefined;
      if (entries.length === 0 && !wantsIndent && !wantsTabStops) return false;

      const ops: TreeDocOp[] = [];
      for (const paragraphId of touched) {
        const direct = directParagraphProperties(storyPart(), paragraphId);
        // `w:ind` is built here rather than as another entry: its four settings are two
        // pairs of mutually exclusive SPELLINGS, so the attributes depend on what the
        // paragraph already authored — the same reason `setIndent` does it this way.
        let properties = direct;
        if (wantsIndent) {
          const authored =
            direct.find((property) => property.localName === 'ind')?.attributes ?? {};
          let attributes: Record<string, string> = { ...authored };
          if (update.indentLeftTwips !== undefined) {
            attributes = writeIndentSide(attributes, 'left', 'start', update.indentLeftTwips);
          }
          if (update.indentRightTwips !== undefined) {
            attributes = writeIndentSide(attributes, 'right', 'end', update.indentRightTwips);
          }
          if (update.indentFirstLineTwips !== undefined) {
            attributes = writeFirstLine(attributes, update.indentFirstLineTwips);
          }
          properties = mergedProperties(properties, {
            localName: 'ind',
            ...(Object.keys(attributes).length > 0 ? { attributes } : {}),
          });
        }
        for (const entry of entries) {
          const merged = entry.mergeAttributes
            ? {
                ...(properties.find((property) => property.localName === entry.localName)
                  ?.attributes ?? {}),
                ...entry.attributes,
              }
            : (entry.attributes ?? {});
          const kept = Object.fromEntries(
            Object.entries(merged).filter(([, value]) => value !== null && value !== undefined)
          ) as Record<string, string>;
          properties = mergedProperties(properties, {
            localName: entry.localName,
            ...(Object.keys(kept).length > 0 ? { attributes: kept } : {}),
          });
        }
        // Only when there is something to write. `setParagraphProperties` REPLACES the
        // paragraph's authorable `w:pPr` children with what it is handed, so pushing it for
        // a tab-stops-only edit put the whole of `w:pPr` at the mercy of the `direct` read
        // — a wrong base there deletes `w:pStyle`, `w:jc` and everything else rather than
        // doing nothing.
        // Only when there is something to write. `setParagraphProperties` REPLACES the
        // paragraph's authorable `w:pPr` children with what it is handed, so pushing it for
        // a tab-stops-only edit put the whole of `w:pPr` at the mercy of the `direct` read
        // — a wrong base there deletes `w:pStyle`, `w:jc` and everything else rather than
        // doing nothing. Defence in depth: the header test pins the part identity, and this
        // makes a repeat of that mistake harmless for edits that name no property.
        if (entries.length > 0 || wantsIndent) {
          ops.push({ op: 'setParagraphProperties', paragraphId, properties });
        }
        if (wantsTabStops) {
          // What the editor SAW, so the op can tell an inherited stop from an authored
          // one. The read resolves the cascade and the write lands on the paragraph, so
          // without this a style's stop survives a "Clear All" and the command still
          // reports success — see `applySetParagraphTabStops`.
          //
          // Through `paragraphTabStopsOf`, which is the SAME walk the read uses. A
          // page-fragment walk sees the body only: header, footer and note fragments hang
          // off `page.header`/`page.footer`/`page.footnotes` and were never visited, so
          // every paragraph in those stories cleared nothing and the style put its stop
          // straight back — with the command still reporting success.
          const inForce = paragraphTabStopsOf(deps.layout(), paragraphId);
          ops.push({
            op: 'setParagraphTabStops',
            paragraphId,
            stops: update.tabStops!.map((stop) => ({
              positionTwips: Math.round(stop.positionTwips),
              alignment: stop.alignment,
              ...(stop.leader && stop.leader !== 'none' ? { leader: stop.leader } : {}),
            })),
            ...(inForce
              ? {
                  inForcePositionsTwips: inForce.stops.map((stop) =>
                    Math.round(stop.positionPt * 20)
                  ),
                }
              : {}),
          });
        }
      }
      if (ops.length === 0) return false;
      return commitOverTarget(() => applyOps(ops, selectionMark()));
    },

    sectionProperties: () => readSectionProperties(session.part()),

    sectionPropertiesAt(paragraphId) {
      const sections = enumerateDocumentSections(session.part());
      if (sections.length === 1) return sections[0]!.properties;
      const blocks = storyBlocks(session.part());
      const contains = (node: (typeof blocks)[number], id: string): boolean => {
        if (node.id === id) return true;
        for (const child of node.children) {
          if (child.kind !== 'textValue' && contains(child as (typeof blocks)[number], id)) {
            return true;
          }
        }
        return false;
      };
      const blockIndex = blocks.findIndex(
        (block) => block.id === paragraphId || contains(block, paragraphId)
      );
      // An unknown id falls back to the tail section — the document-wide answer.
      let owner = sections[sections.length - 1]!;
      if (blockIndex !== -1) {
        for (const section of sections) {
          if (section.blockStart <= blockIndex) owner = section;
          else break;
        }
      }
      return owner.properties;
    },

    setSectionProperties(update) {
      let committed = false;
      commit(() => {
        // Section geometry lives on the body story, never on an open furniture scope.
        const result = session.applyTreeOps(
          [{ op: 'setSectionProperties', ...update }],
          selectionMark(),
          undefined,
          { kind: 'body' }
        );
        committed = result.committed;
        return result;
      });
      return committed;
    },

    insertSectionBreak() {
      // Section breaks are body-only; refuse while a furniture scope is open.
      if (deps.storyScope().kind !== 'body') return false;
      const plan = deleteSelectionPlan();
      const start = plan.collapseTo;
      const before = new Set(session.paragraphIds());
      let committed = false;
      commit(
        () => {
          const result = session.applyTreeOps(
            [
              // A break REPLACES a selection, like every other insertion.
              ...plan.ops,
              { op: 'splitParagraph', paragraphId: start.paragraphId, offset: start.offset },
              // The HEAD keeps the original id; it ends the new section, cloning the
              // governing setup so the break changes where pages break, not how they look.
              { op: 'setSectionMark', paragraphId: start.paragraphId },
            ],
            selectionMark(),
            undefined,
            { kind: 'body' }
          );
          committed = result.committed;
          return result;
        },
        () => {
          // The caret lands at the start of the tail — the first paragraph of the
          // section the user keeps typing in, exactly where Word puts it.
          const tail = session.paragraphIds().find((id) => !before.has(id));
          return tail ? collapsedAt({ paragraphId: tail, offset: 0 }) : null;
        }
      );
      return committed;
    },
  };
}
