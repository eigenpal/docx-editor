// Pure helpers behind the `createDocxEditor` facade (docx-editor.ts).
//
// Everything here is a function of its arguments — no surface, no session, no DOM.
// The facade closure stays in docx-editor.ts; this module owns command classification,
// the empty interaction frame, source normalization, and the value-equality rules the
// cached snapshot uses to keep sub-object references stable across re-derivations.

import type {
  DocumentSource,
  EditorCommand,
  EditorError,
  EditorSnapshot,
  RunFormatting,
} from '@docx-editor.dev/core-contract/contracts/editor';
import type {
  InteractionFrame,
  SemanticPositionIndex,
} from '@docx-editor.dev/core-contract/contracts/interaction';
import type { SemanticSelection as SurfaceSelection } from '@docx-editor.dev/core-contract/layout';

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

/** Run-property spellings for the marks the surface can toggle, named as OOXML names them. */
export const MARKS: Readonly<
  Record<string, { localName: string; attributes?: Record<string, string> }>
> = {
  bold: { localName: 'b' },
  italic: { localName: 'i' },
  underline: { localName: 'u', attributes: { val: 'single' } },
  strike: { localName: 'strike' },
};

export type CommandSupport =
  | { readonly supported: true; readonly mutating: boolean }
  | { readonly supported: false; readonly reason: string };

function isSurfacePosition(value: unknown): value is SurfaceSelection['anchor'] {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { paragraphId?: unknown }).paragraphId === 'string' &&
    typeof (value as { offset?: unknown }).offset === 'number'
  );
}

/**
 * The one selection form the surface can honour: paragraph-id + offset endpoints.
 *
 * The contract's other position forms (`DocAnchor`, `DocLocation`, `SemanticTarget`)
 * address the document through indexes this lane does not build yet, so they are refused
 * as unsupported rather than resolved approximately.
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
      return MARKS[command.mark]
        ? { supported: true, mutating: true }
        : { supported: false, reason: `mark '${command.mark}' is not supported` };
    case 'setAlignment':
      return { supported: true, mutating: true };
    case 'setIndent':
      return command.left !== undefined ||
        command.right !== undefined ||
        command.firstLine !== undefined ||
        command.hanging !== undefined
        ? { supported: true, mutating: true }
        : { supported: false, reason: 'setIndent requires at least one indent field' };
    case 'insertBreak':
      // Page/column/section breaks belong to lanes the surface does not own yet.
      return command.kind === 'line'
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
    case 'undo':
    case 'redo':
      return { supported: true, mutating: true };
    case 'setSelection':
      return 'range' in command && isSurfaceSelection(command.range)
        ? { supported: true, mutating: false }
        : {
            supported: false,
            reason:
              'only a semantic { anchor: { paragraphId, offset }, head } selection is supported',
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
    a.styleId !== b.styleId
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
    a.canRedo === b.canRedo
  );
}
