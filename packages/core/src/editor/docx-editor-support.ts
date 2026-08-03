// Pure helpers behind the `createDocxEditor` facade (docx-editor.ts).
//
// Everything here is a function of its arguments — no surface, no session, no DOM.
// The facade closure stays in docx-editor.ts; this module owns command classification,
// the empty interaction frame, source normalization, and the value-equality rules the
// cached snapshot uses to keep sub-object references stable across re-derivations.

import type {
  DocAnchor,
  DocRange,
  DocumentSource,
  EditorCommand,
  EditorError,
  EditorSnapshot,
  PageSetup,
  RunFormatting,
} from '@docx-editor.dev/core-contract/contracts/editor';
import type {
  InteractionFrame,
  SemanticPositionIndex,
} from '@docx-editor.dev/core-contract/contracts/interaction';
import type { SemanticSelection as SurfaceSelection } from '@docx-editor.dev/core-contract/layout';
// Direct, not through the layout barrel: this is an internal bound the write shares with
// the reader, not something the layout package publishes.
import { MAX_PARAGRAPH_INDENT_TWIPS } from '../layout/paragraph-flow.ts';
import { isDocAnchor, isDocAnchorRange } from './anchor-resolution.ts';

/** Recursively freeze plain objects and arrays (idempotent). */
export function deepFreezeValue<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) return value;
  if (Array.isArray(value)) {
    for (const item of value) deepFreezeValue(item);
    return Object.freeze(value);
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) deepFreezeValue(record[key]);
  return Object.freeze(value);
}

export const DEFAULT_PAGE_GAP_PX = 24;

function emptySemanticIndex(storyId = ''): SemanticPositionIndex {
  return {
    stories: [{ storyId, scope: { kind: 'body' }, blocks: [] }],
    caretStops: [],
    ownershipRegions: [],
  };
}

let emptyFrameSingleton: InteractionFrame | null = null;

/** The single immutable frame every frame-shaped contract member answers with. */
export function emptyInteractionFrame(): InteractionFrame {
  if (emptyFrameSingleton) return emptyFrameSingleton;
  emptyFrameSingleton = deepFreezeValue({
    id: { value: 0 },
    revisions: {
      modelRevision: 0,
      layoutRevision: 0,
      resourceEpoch: 0,
      configurationEpoch: 0,
      shapingProvenance: {
        extensionFingerprint: 'empty',
        shapingHash: 'empty',
        producerVersion: 0,
      },
    },
    completeness: { kind: 'complete' as const },
    display: [],
    semanticIndex: emptySemanticIndex(),
    pageGeometry: [],
    scrollGeometry: { contentHeight: 0, pageTops: [], pageGapPx: DEFAULT_PAGE_GAP_PX },
    selection: null,
    caret: null,
    selectionGeometry: null,
    focus: { scope: null, focused: false },
    composition: { active: false, scope: null },
    currentPage: { viewport: 0, caret: 0 },
  }) as InteractionFrame;
  return emptyFrameSingleton;
}

/**
 * Run-property spellings for the marks the surface can toggle, named as OOXML names them.
 *
 * Superscript and subscript are ONE property with two of its three values (`w:vertAlign`,
 * ST_VerticalAlignRun, 17.3.2.42), not two independent switches. Spelling them as two marks
 * over one `localName` is what makes them mutually exclusive for free — a property write
 * replaces the entry with the same name — and it is why the toggle has to compare the VALUE
 * in force rather than the mere presence of the element.
 *
 * A Map, not an object literal, because the key is CALLER input: an object answers
 * `constructor` and `toString` off the prototype chain, so `toggleMark` with either name
 * passed the support gate and reached the store, which then refused the write — `can` said
 * yes and the press did nothing. `HIGHLIGHT_NAMES` is a Set for the same reason.
 */
export const MARKS: ReadonlyMap<
  string,
  { localName: string; attributes?: Record<string, string> }
> = new Map([
  ['bold', { localName: 'b' }],
  ['italic', { localName: 'i' }],
  ['underline', { localName: 'u', attributes: { val: 'single' } }],
  ['strike', { localName: 'strike' }],
  ['superscript', { localName: 'vertAlign', attributes: { val: 'superscript' } }],
  ['subscript', { localName: 'vertAlign', attributes: { val: 'subscript' } }],
]);

export type CommandSupport =
  | { readonly supported: true; readonly mutating: boolean }
  | {
      readonly supported: false;
      readonly reason: string;
      /** Refusal code for the gate: `invalidArgs` for a malformed value on a supported
       *  command, `unsupported` (the default) for a command outside the wired subset. */
      readonly code?: 'unsupported' | 'invalidArgs';
    };

/**
 * `ST_HighlightColor` names accepted by `setMarkAttr` for the `highlight` mark — the
 * same closed enumeration the paint lane maps to swatches (semantic-paint.ts's
 * `HIGHLIGHT` map). A Set, not an object literal, because the value is caller input:
 * membership must not answer `constructor` or `__proto__` from the prototype chain.
 */
export const HIGHLIGHT_NAMES: ReadonlySet<string> = new Set([
  // `none` is part of the enumeration: Word's "No Color". The read lane reports it as
  // "no highlight" (run-style maps it to null), so writing it clears the swatch.
  'none',
  'black',
  'blue',
  'cyan',
  'darkBlue',
  'darkCyan',
  'darkGray',
  'darkGreen',
  'darkMagenta',
  'darkRed',
  'darkYellow',
  'green',
  'lightGray',
  'magenta',
  'red',
  'yellow',
  'white',
]);

/** The shape the CSS sink enforces on family names (semantic-paint.ts's `FONT_NAME`);
 *  applying it at the command boundary keeps an invalid name out of the tree entirely. */
const FONT_FAMILY_VALUE = /^[\p{L}\p{N}\p{M} \-.+_]{1,64}$/u;

const HEX_COLOR_VALUE = /^[0-9A-Fa-f]{6}$/;

export type ResolvedMarkAttr =
  | {
      readonly ok: true;
      readonly localName: string;
      readonly attributes: Record<string, string>;
    }
  | {
      readonly ok: false;
      readonly code: 'unsupported' | 'invalidArgs';
      readonly reason: string;
    };

/**
 * Resolve a `setMarkAttr` command to the run property it writes, refusing invalid
 * values with a typed reason. One resolver serves `classifyCommand` and `exec`, so the
 * dry run can never disagree with the real one about what is accepted.
 *
 * Spellings are the ones the ENGINE READS back (`resolveRunStyle`): `w:rFonts` is read
 * as `ascii ?? hAnsi`, so a family write sets both; `w:sz` is half-points; `w:color`
 * and `w:highlight` are `val`-carrying elements.
 */
export function resolveMarkAttr(command: { mark: string; value: unknown }): ResolvedMarkAttr {
  const { mark, value } = command;
  switch (mark) {
    case 'fontFamily': {
      if (typeof value !== 'string' || !FONT_FAMILY_VALUE.test(value)) {
        return {
          ok: false,
          code: 'invalidArgs',
          reason: 'fontFamily requires a family name of 1-64 letters, digits, or [ -.+_]',
        };
      }
      return { ok: true, localName: 'rFonts', attributes: { ascii: value, hAnsi: value } };
    }
    case 'fontSize': {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 2 || value > 3276) {
        return {
          ok: false,
          code: 'invalidArgs',
          reason: 'fontSize requires an integer half-point value between 2 and 3276',
        };
      }
      return { ok: true, localName: 'sz', attributes: { val: String(value) } };
    }
    case 'color': {
      // `auto` is ST_HexColor's other member — Word's "Automatic". The read lane
      // already treats it as "no colour" (run-style's hexColor), so it round-trips.
      if (typeof value !== 'string' || (value !== 'auto' && !HEX_COLOR_VALUE.test(value))) {
        return {
          ok: false,
          code: 'invalidArgs',
          reason: "color requires a six-digit hex value like FF0000, or 'auto'",
        };
      }
      return { ok: true, localName: 'color', attributes: { val: value } };
    }
    case 'highlight': {
      if (typeof value !== 'string' || !HIGHLIGHT_NAMES.has(value)) {
        return {
          ok: false,
          code: 'invalidArgs',
          reason: 'highlight requires an ST_HighlightColor name (yellow, cyan, ...)',
        };
      }
      return { ok: true, localName: 'highlight', attributes: { val: value } };
    }
    default:
      return {
        ok: false,
        code: 'unsupported',
        reason: `mark '${mark}' is not supported by setMarkAttr`,
      };
  }
}

function isSurfacePosition(value: unknown): value is SurfaceSelection['anchor'] {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { paragraphId?: unknown }).paragraphId === 'string' &&
    typeof (value as { offset?: unknown }).offset === 'number'
  );
}

/**
 * The surface's native selection form: paragraph-id + offset endpoints.
 *
 * `DocAnchor` forms (`{ anchor: { paraId } }`, `{ range: { from, to } }` with anchor
 * endpoints) are resolved through the session's paraId index at exec time — see
 * `anchor-resolution.ts`. `DocLocation` and `SemanticTarget` still address the document
 * through indexes this lane does not build, so they stay refused rather than resolved
 * approximately.
 */
export function isSurfaceSelection(value: unknown): value is SurfaceSelection {
  return (
    typeof value === 'object' &&
    value !== null &&
    isSurfacePosition((value as { anchor?: unknown }).anchor) &&
    isSurfacePosition((value as { head?: unknown }).head)
  );
}

export function editorError(code: string, message: string): EditorError {
  const error = new Error(message) as Error & { code?: string };
  error.code = code;
  return error;
}

export function selectionsMatch(a: SurfaceSelection | null, b: SurfaceSelection | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.anchor.paragraphId === b.anchor.paragraphId &&
    a.anchor.offset === b.anchor.offset &&
    a.head.paragraphId === b.head.paragraphId &&
    a.head.offset === b.head.offset
  );
}

export function normalizeSource(source: DocumentSource): Uint8Array | null {
  if (source instanceof Uint8Array) return source;
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  // The remaining form is a DocumentHandle: identity and revision, not content.
  return null;
}

/**
 * Whether a command is in the wired subset, and whether it writes.
 *
 * One classifier serves `exec` and `can`, so a dry run can never disagree with the real
 * one about what is supported.
 */
export function classifyCommand(command: EditorCommand): CommandSupport {
  switch (command.type) {
    case 'toggleMark':
      return MARKS.has(command.mark)
        ? { supported: true, mutating: true }
        : { supported: false, reason: `mark '${command.mark}' is not supported` };
    case 'setMarkAttr': {
      const resolved = resolveMarkAttr(command);
      return resolved.ok
        ? { supported: true, mutating: true }
        : { supported: false, reason: resolved.reason, code: resolved.code };
    }
    case 'setAlignment':
      return { supported: true, mutating: true };
    case 'clearFormatting':
      return { supported: true, mutating: true };
    case 'setLineSpacing': {
      // Bounds are `w:spacing/@w:line`'s own (ST_SignedTwipsMeasure in practice, but Word
      // rejects a non-positive line height outright). Checked here so a malformed pick is
      // refused with a typed reason rather than writing a `w:spacing` Word will not open.
      const rules = ['multiple', 'exact', 'atLeast'];
      if (!rules.includes(command.rule)) {
        return {
          supported: false,
          code: 'invalidArgs',
          reason: "setLineSpacing requires a rule of 'multiple', 'exact' or 'atLeast'",
        };
      }
      const raw = command.rule === 'multiple' ? command.value * 240 : command.value * 20;
      if (!Number.isFinite(command.value) || command.value <= 0 || Math.round(raw) > 31680) {
        return {
          supported: false,
          code: 'invalidArgs',
          reason: 'setLineSpacing requires a positive value no taller than 1584pt',
        };
      }
      return { supported: true, mutating: true };
    }
    case 'setParagraphSpacing': {
      for (const field of ['beforePt', 'afterPt'] as const) {
        const value = command[field];
        if (value === undefined || value === null) continue;
        if (!Number.isFinite(value) || value < 0 || value > 1584) {
          return {
            supported: false,
            code: 'invalidArgs',
            reason: `setParagraphSpacing requires ${field} between 0 and 1584 points`,
          };
        }
      }
      return { supported: true, mutating: true };
    }
    case 'setParagraphStyle': {
      // Shape gate only, like `insertText`: whether the styleId names a style the DOCUMENT
      // defines is checked at exec, where the styles part is in hand. The bounds mirror the
      // catalog's own (`collectDocumentStyles`), so no listed style can be refused here.
      if (command.target !== undefined) {
        return {
          supported: false,
          reason: 'DocTarget addressing is not supported; the style applies at the selection',
        };
      }
      if (
        typeof command.styleId !== 'string' ||
        command.styleId.length === 0 ||
        command.styleId.length > 128 ||
        // eslint-disable-next-line no-control-regex
        /[\u0000-\u001f\u007f-\u009f]/.test(command.styleId)
      ) {
        return {
          supported: false,
          code: 'invalidArgs',
          reason: 'setParagraphStyle requires a styleId of 1-128 printable characters',
        };
      }
      return { supported: true, mutating: true };
    }
    case 'insertHyperlink': {
      if (command.target !== undefined) {
        return {
          supported: false,
          reason: 'DocTarget addressing is not supported; a link applies at the selection',
        };
      }
      // The `href` vocabulary is the WEB's, because that is what the contract declares and
      // what a host already has: `#name` is a bookmark in this document, anything else is
      // an external target. The allowlist is applied where the relationship is written, so
      // `can` reports only what it can check without touching the package.
      if (typeof command.href !== 'string' || command.href.length === 0) {
        return {
          supported: false,
          code: 'invalidArgs',
          reason: 'insertHyperlink requires an href',
        };
      }
      return { supported: true, mutating: true };
    }
    case 'removeHyperlink':
      return command.target === undefined
        ? { supported: true, mutating: true }
        : {
            supported: false,
            reason: 'DocTarget addressing is not supported; unlink acts at the selection',
          };
    case 'setIndent': {
      const fields = [command.left, command.right, command.firstLine];
      if (fields.every((value) => value === undefined)) {
        return { supported: false, reason: 'setIndent requires at least one indent field' };
      }
      // Bounded here because nothing downstream does: the store validates `w:ind`
      // attribute NAMES and XML-safety only, so an unchecked value reached the file as
      // `w:left="NaN"`. The read side clamps out-of-range values; a write refuses them,
      // because silently storing something other than what was asked for is the worse lie.
      for (const value of fields) {
        if (value === undefined || value === null) continue;
        if (!Number.isInteger(value)) {
          return { supported: false, reason: 'indent values must be whole twips' };
        }
        if (Math.abs(value) > MAX_PARAGRAPH_INDENT_TWIPS) {
          return {
            supported: false,
            reason: `indent values must be within ±${MAX_PARAGRAPH_INDENT_TWIPS} twips`,
          };
        }
      }
      return { supported: true, mutating: true };
    }
    case 'toggleList':
      return command.kind === 'bullet' || command.kind === 'ordered'
        ? { supported: true, mutating: true }
        : { supported: false, reason: `list kind '${command.kind}' is not supported` };
    case 'adjustIndent':
      return command.direction === 'increase' || command.direction === 'decrease'
        ? { supported: true, mutating: true }
        : { supported: false, reason: `indent direction '${command.direction}' is not supported` };
    case 'insertBreak':
      // Line, hard page, and next-page section breaks are wired. `column` belongs to the
      // multi-column lane, which layout does not own yet.
      return command.kind === 'line' || command.kind === 'page' || command.kind === 'section'
        ? { supported: true, mutating: true }
        : { supported: false, reason: `break kind '${command.kind}' is not supported` };
    case 'insertText':
      return command.target === undefined
        ? { supported: true, mutating: true }
        : {
            supported: false,
            reason: 'DocTarget addressing is not supported; text inserts at the selection',
          };
    case 'deleteText':
      return command.target === undefined
        ? { supported: true, mutating: true }
        : {
            supported: false,
            reason: 'DocTarget addressing is not supported; deletion removes the selection',
          };
    case 'setPageSetup': {
      const dims = [command.pageWidth, command.pageHeight];
      const margins = [
        command.marginTop,
        command.marginRight,
        command.marginBottom,
        command.marginLeft,
      ];
      if (
        dims.every((value) => value === undefined) &&
        margins.every((value) => value === undefined) &&
        command.orientation === undefined
      ) {
        return { supported: false, reason: 'setPageSetup requires at least one field' };
      }
      // The same bounds the op layer enforces, refused here so `can` answers honestly
      // BEFORE a dialog submits.
      for (const value of dims) {
        if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > 63360)) {
          return {
            supported: false,
            code: 'invalidArgs',
            reason: 'page dimensions must be integer twips between 1 and 63360',
          };
        }
      }
      for (const value of margins) {
        if (value !== undefined && (!Number.isInteger(value) || value < 0 || value > 31680)) {
          return {
            supported: false,
            code: 'invalidArgs',
            reason: 'margins must be integer twips between 0 and 31680',
          };
        }
      }
      if (
        command.orientation !== undefined &&
        command.orientation !== 'portrait' &&
        command.orientation !== 'landscape'
      ) {
        return {
          supported: false,
          code: 'invalidArgs',
          reason: "orientation must be 'portrait' or 'landscape'",
        };
      }
      if (
        command.scope !== undefined &&
        command.scope !== 'document' &&
        command.scope !== 'section'
      ) {
        return {
          supported: false,
          code: 'invalidArgs',
          reason: "scope must be 'document' or 'section'",
        };
      }
      return { supported: true, mutating: true };
    }
    case 'undo':
    case 'redo':
      return { supported: true, mutating: true };
    case 'editHeaderFooter':
      return command.position === 'header' || command.position === 'footer'
        ? { supported: true, mutating: true }
        : { supported: false, reason: "editHeaderFooter requires position 'header' or 'footer'" };
    case 'exitHeaderFooter':
      return { supported: true, mutating: false };
    case 'removeHeaderFooter':
    case 'linkHeaderFooterToPrevious':
    case 'unlinkHeaderFooterFromPrevious':
      return { supported: true, mutating: true };
    case 'setHeaderFooterOptions': {
      const empty =
        command.titlePage === undefined &&
        command.evenAndOddHeaders === undefined &&
        command.headerDistanceTwips === undefined &&
        command.footerDistanceTwips === undefined;
      return empty
        ? { supported: false, reason: 'setHeaderFooterOptions requires at least one option' }
        : { supported: true, mutating: true };
    }
    case 'insertPageField':
      return command.field === 'PAGE' ||
        command.field === 'NUMPAGES' ||
        command.field === 'SECTIONPAGES' ||
        command.field === 'PAGE_X_OF_Y'
        ? { supported: true, mutating: true }
        : {
            supported: false,
            reason:
              "insertPageField field must be 'PAGE', 'NUMPAGES', 'SECTIONPAGES', or 'PAGE_X_OF_Y'",
          };
    case 'insertNote':
      return command.noteKind === 'footnote' || command.noteKind === 'endnote'
        ? { supported: true, mutating: true }
        : { supported: false, reason: "insertNote noteKind must be 'footnote' or 'endnote'" };
    case 'deleteNote':
      return command.noteKind === 'footnote' || command.noteKind === 'endnote'
        ? { supported: true, mutating: true }
        : { supported: false, reason: "deleteNote noteKind must be 'footnote' or 'endnote'" };
    case 'convertNote':
      return command.fromKind === 'footnote' || command.fromKind === 'endnote'
        ? { supported: true, mutating: true }
        : { supported: false, reason: "convertNote fromKind must be 'footnote' or 'endnote'" };
    case 'convertAllNotes':
      return command.fromKind === 'footnote' || command.fromKind === 'endnote'
        ? { supported: true, mutating: true }
        : { supported: false, reason: "convertAllNotes fromKind must be 'footnote' or 'endnote'" };
    case 'setNoteProperties':
      if (command.endnote?.position === 'pageBottom') {
        return {
          supported: false,
          reason: 'endnote-pageBottom',
        };
      }
      return command.footnote !== undefined || command.endnote !== undefined
        ? { supported: true, mutating: true }
        : { supported: false, reason: 'setNoteProperties requires footnote and/or endnote fields' };
    case 'setSelection':
      // Shape gate only: whether an anchor's paraId exists (and its `search` phrase is
      // unique) is a property of the DOCUMENT, checked at exec — the same split as
      // `insertText`, whose target cannot be pre-verified either.
      return ('range' in command &&
        (isSurfaceSelection(command.range) || isDocAnchorRange(command.range))) ||
        ('anchor' in command && isDocAnchor(command.anchor))
        ? { supported: true, mutating: false }
        : {
            supported: false,
            reason:
              'setSelection accepts { anchor: { paraId } }, a { range } whose from/to are paraId anchors, or a { range } carrying a semantic { anchor: { paragraphId, offset }, head } selection',
          };
    default:
      return {
        supported: false,
        reason: `command '${command.type}' is not supported by the tree editor`,
      };
  }
}

// ---------------------------------------------------------------------------------------
// Snapshot value equality.
//
// The cached snapshot re-derives once per state tick, and reuses the PREVIOUS `formatting`
// and `page` sub-objects when they are value-equal — so a selector like
// `snapshot().formatting` stays reference-stable across ticks that did not change it, and
// a React store comparing by reference does not re-render every subscriber on every tick.
// ---------------------------------------------------------------------------------------

/**
 * Compile-time exhaustiveness for `formattingEqual`, in the manner of the content-node
 * switches: every key of `RunFormatting` is listed, so ADDING a field fails `typecheck`
 * here until its comparison is written.
 *
 * A field the comparator misses is a field the cache reports as unchanged. The previous
 * object is handed back, a host reading `snapshot().formatting` by reference never sees the
 * value move, and the control that made the write goes on showing the old state while the
 * document holds the new one — a silent, one-line-of-omission bug that no test of the write
 * path can catch, because the write is fine. A comment asking the next author to remember
 * is not a guarantee; this is.
 */
const COMPARED_FORMATTING_KEYS: Record<keyof Required<RunFormatting>, true> = {
  bold: true,
  italic: true,
  underline: true,
  strike: true,
  color: true,
  highlight: true,
  fontFamily: true,
  fontSizePt: true,
  superscript: true,
  subscript: true,
  alignment: true,
  styleId: true,
  lineSpacing: true,
  spaceBeforePt: true,
  spaceAfterPt: true,
  indent: true,
};
void COMPARED_FORMATTING_KEYS;

/** Value equality for the snapshot's `formatting` sub-object (color compared by value). */
export function formattingEqual(a: RunFormatting | null, b: RunFormatting | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (
    a.bold !== b.bold ||
    a.italic !== b.italic ||
    a.underline !== b.underline ||
    a.strike !== b.strike ||
    a.superscript !== b.superscript ||
    a.subscript !== b.subscript ||
    a.highlight !== b.highlight ||
    a.fontFamily !== b.fontFamily ||
    a.fontSizePt !== b.fontSizePt ||
    a.alignment !== b.alignment ||
    a.styleId !== b.styleId ||
    a.spaceBeforePt !== b.spaceBeforePt ||
    a.spaceAfterPt !== b.spaceAfterPt ||
    a.lineSpacing?.rule !== b.lineSpacing?.rule ||
    a.lineSpacing?.value !== b.lineSpacing?.value ||
    // FIELD BY FIELD, like `lineSpacing` above. `indent` is a fresh object on every derive,
    // so comparing it by reference would report every tick as a change, hand back a new
    // sub-object each time, and re-render every `snapshot().formatting` subscriber on each
    // keystroke — the exact opposite of what this cache exists for.
    a.indent?.left !== b.indent?.left ||
    a.indent?.right !== b.indent?.right ||
    a.indent?.firstLine !== b.indent?.firstLine ||
    a.indent?.mixed.left !== b.indent?.mixed.left ||
    a.indent?.mixed.right !== b.indent?.mixed.right ||
    a.indent?.mixed.firstLine !== b.indent?.mixed.firstLine
  ) {
    return false;
  }
  if (a.color === b.color) return true;
  if (!a.color || !b.color) return false;
  // ColorValue is a small tagged union of primitives; key-by-key compare covers all arms.
  const left = a.color as Record<string, unknown>;
  const right = b.color as Record<string, unknown>;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) if (left[key] !== right[key]) return false;
  return true;
}

/** Value equality for the snapshot's `page` sub-object. */
export function pageEqual(a: EditorSnapshot['page'], b: EditorSnapshot['page']): boolean {
  return a.current === b.current && a.total === b.total;
}

/** Value equality for the snapshot's `pageSetup` sub-object. */
export function pageSetupEqual(a: PageSetup | null, b: PageSetup | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.pageWidthTwips === b.pageWidthTwips &&
    a.pageHeightTwips === b.pageHeightTwips &&
    a.orientation === b.orientation &&
    a.marginsTwips.top === b.marginsTwips.top &&
    a.marginsTwips.right === b.marginsTwips.right &&
    a.marginsTwips.bottom === b.marginsTwips.bottom &&
    a.marginsTwips.left === b.marginsTwips.left &&
    a.gutterTwips === b.gutterTwips
  );
}

function docAnchorEndpointEqual(
  a: DocRange['from'] | undefined,
  b: DocRange['from'] | undefined
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const left = a as Partial<DocAnchor>;
  const right = b as Partial<DocAnchor>;
  return (
    left.paraId === right.paraId &&
    left.search === right.search &&
    left.occurrence === right.occurrence
  );
}

/**
 * Value equality for the snapshot's `selection`. Emitted ranges carry bare DocAnchor
 * endpoints, but all anchor fields are compared for honesty; a DocLocation endpoint
 * (never emitted today) compares unequal unless reference-equal.
 */
export function docRangeEqual(a: DocRange | null, b: DocRange | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (!isDocAnchorRange(a) || !isDocAnchorRange(b)) return false;
  return docAnchorEndpointEqual(a.from, b.from) && docAnchorEndpointEqual(a.to, b.to);
}

/**
 * Whether two snapshots are value-equal AFTER sub-object reuse — i.e. every field can be
 * compared by reference or primitive. When true, the previous snapshot object itself is
 * kept, so `snapshot()` returns the same reference across ticks that changed nothing.
 */
export function snapshotsEqual(a: EditorSnapshot, b: EditorSnapshot): boolean {
  return (
    a.scope === b.scope &&
    a.isLoading === b.isLoading &&
    a.parseError === b.parseError &&
    a.editable === b.editable &&
    a.zoom === b.zoom &&
    a.selection === b.selection &&
    a.formatting === b.formatting &&
    a.table === b.table &&
    a.image === b.image &&
    a.page === b.page &&
    a.canUndo === b.canUndo &&
    a.canRedo === b.canRedo &&
    a.pageSetup === b.pageSetup
  );
}
