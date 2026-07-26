// The stable, engine- and framework-neutral EditorDriver (comprehensive 4.7; interactive-paginated 2.6).
// A thin automation surface over the production `Editor`, so the SAME browser smoke scenarios can
// drive the React and Vue adapters identically. Covers load, editability, commands, queries,
// interaction-frame observations, typed pointer intent, display snapshot, save, reopen, and dispose.

import type {
  Editor,
  DocumentSource,
  EditorCommand,
  EditorQueries,
  EditorQueryResults,
} from '@docx-editor.dev/core-contract/editor';
import type { DisplayPage, DocRange } from '@docx-editor.dev/core-contract/geometry';
import type {
  CaretGeometry,
  CompositionObservation,
  FocusObservation,
  InteractionFrame,
  InteractionFrameId,
  InteractionHostMetrics,
  InteractionOutcome,
  InputHostObservation,
  SelectionGeometry,
  SemanticHitTarget,
  SemanticSelection,
  AccessibilityObservation,
} from '@docx-editor.dev/core-contract/interaction';
import type { ExecResult, Point, Rect } from '@docx-editor.dev/core-contract/types';
import { createEditor } from './create-editor.ts';

/** The text a display page shows, in reading order. Layout emits one item per run-part (a maximal
 *  non-space chunk of a run), consuming inter-word spaces, so text is reconstructed from item BOX
 *  geometry: contiguous items on a line (no horizontal gap) are one word and join tightly (a
 *  bold "Hel" + italic "lo" -> "Hello"), a horizontal gap is a consumed space, and a new line is a
 *  newline. This is an approximation of visible text (it cannot recover exact whitespace runs or
 *  empty paragraphs) — fine for the smoke driver's "contains" assertions, not faithful extraction. */
export function pageText(page: DisplayPage): string {
  let out = '';
  let prev: { x: number; y: number; right: number } | null = null;
  for (const item of page.items) {
    if (item.kind !== 'text') continue;
    const b = item.box;
    if (prev) {
      if (Math.abs(b.y - prev.y) >= 1)
        out += '\n'; // wrapped / next line
      else if (b.x - prev.right > 1) out += ' '; // a consumed inter-word space
      // else: contiguous run-parts of one word — no separator
    }
    out += item.runs.map((r) => r.text).join('');
    prev = { x: b.x, y: b.y, right: b.x + b.width };
  }
  return out;
}

/** The whole display's approximate text: each page's text, pages joined by newlines. */
export function displayText(pages: readonly DisplayPage[]): string {
  return pages.map(pageText).join('\n');
}

export interface DisplaySnapshot {
  readonly pageCount: number;
  /** The visible text across all pages (display/reading order). */
  readonly text: string;
}

export interface PointerAtOptions {
  readonly frameId?: InteractionFrameId;
  readonly hostMetrics?: InteractionHostMetrics;
}

/** The engine-neutral automation surface both adapters expose for browser smoke tests. */
export interface EditorDriver {
  load(source: DocumentSource): void;
  /** Whether the loaded document is being edited (patchable + edit mode). */
  editable(): boolean;
  exec(command: EditorCommand): ExecResult;
  query<K extends keyof EditorQueries>(
    query: { type: K } & EditorQueries[K]
  ): EditorQueryResults[K];
  /** The current selection range, or null when collapsed/unavailable. */
  selection(): DocRange | null;
  /** The current coherent interaction frame. */
  interactionFrame(): InteractionFrame;
  /** Opaque frame identity for binding pointer input to a publication. */
  frameId(): InteractionFrameId;
  currentPage(mode?: 'viewport' | 'caret'): number;
  focusState(): FocusObservation;
  compositionState(): CompositionObservation;
  caretGeometry(): CaretGeometry | null;
  selectionGeometry(): SelectionGeometry | null;
  /** Semantic selection from the current interaction frame. */
  semanticSelection(): SemanticSelection | null;
  /** Authorize caret at a body paragraph entry (by reading-order index) then focus. */
  authorizeCaret(blockIndex: number, graphemeOffset: number): InteractionOutcome<void>;
  /** PM-free accessibility observation for browser gate assertions. */
  accessibilityObservation(): AccessibilityObservation;
  /** Canonical model revision for commit-once assertions. */
  modelRevision(): number;
  /** Hidden input-host clip shell observation (null when not mounted). */
  inputHostObservation(): InputHostObservation | null;
  /** Caret rectangle in client coordinates when host metrics and caret geometry exist. */
  caretClientRect(): Rect | null;
  focus(): InteractionOutcome<void>;
  setSelection(range: SemanticSelection): ExecResult;
  /** Republish layout/display from canonical model (sync by default). */
  relayout(options?: { sync?: boolean }): void;
  /** Client-coordinate pointer intent with typed stale/pending/read-only/unsupported outcomes. */
  pointerAt(point: Point, options?: PointerAtOptions): InteractionOutcome<SemanticHitTarget>;
  displaySnapshot(): DisplaySnapshot;
  save(): Promise<ArrayBuffer>;
  /** Prove the round-trip: save to DOCX and reopen headlessly, returning the reopened display text. */
  saveAndReopenText(): Promise<string>;
  dispose(): void;
}

/** A no-op EditorHost for the headless reopen editor (no DOM, no surface — just layout + display). */
function headlessHost() {
  let pages: readonly DisplayPage[] = [];
  return {
    host: {
      getBodyHostEl: () => null,
      getHfHostEl: () => null,
      getPagesContainer: () => null,
      getScrollContainer: () => null,
      scheduleFrame: (cb: () => void) => {
        cb();
        return () => {};
      },
      onDisplay: (next: readonly DisplayPage[]) => {
        pages = next;
      },
    },
    getPages: () => pages,
  };
}

/** Wrap a production `Editor` in the stable driver. */
export function createEditorDriver(editor: Editor): EditorDriver {
  function paragraphEntry(blockIndex: number) {
    const entries = editor
      .getAccessibilityObservation()
      .entries.filter((e) => e.role === 'editableParagraph');
    const entry = entries[blockIndex];
    if (!entry) throw new Error(`paragraph index ${blockIndex} is out of range`);
    return entry;
  }

  function semanticSelection(
    blockIndex: number,
    anchorOffset: number,
    headOffset: number
  ): SemanticSelection {
    const entry = paragraphEntry(blockIndex);
    const frameId = editor.getInteractionFrame().id;
    const target = (
      offset: number,
      affinity: 'upstream' | 'downstream'
    ): SemanticSelection['anchor'] => ({
      kind: 'text',
      scope: { kind: 'body' },
      identity: { storyId: entry.identity.storyId, blockId: entry.identity.blockId },
      graphemeOffset: offset,
      affinity,
    });
    return {
      frameId,
      scope: { kind: 'body' },
      anchor: target(anchorOffset, 'upstream'),
      head: target(headOffset, headOffset >= anchorOffset ? 'downstream' : 'upstream'),
    };
  }

  return {
    load: (source) => editor.load(source),
    editable: () => editor.snapshot().editable,
    exec: (command) => editor.exec(command),
    query: (query) => editor.query(query),
    selection: () => editor.snapshot().selection,
    interactionFrame: () => editor.getInteractionFrame(),
    frameId: () => editor.getInteractionFrame().id,
    currentPage: (mode) => editor.getCurrentPage(mode),
    focusState: () => editor.getInteractionFrame().focus,
    compositionState: () => editor.getInteractionFrame().composition,
    caretGeometry: () => editor.getCaretGeometry(),
    selectionGeometry: () => editor.getSelectionGeometry(),
    semanticSelection: () => editor.getInteractionFrame().selection,
    authorizeCaret(blockIndex, graphemeOffset) {
      const set = editor.exec({
        type: 'setSelection',
        range: semanticSelection(blockIndex, graphemeOffset, graphemeOffset),
      });
      if (!set.ok) {
        return {
          ok: false,
          code:
            set.code === 'locked'
              ? 'readOnly'
              : set.code === 'invalidArgs'
                ? 'invalidTarget'
                : 'unsupported',
          reason: set.reason,
        };
      }
      return editor.focus();
    },
    accessibilityObservation: () => editor.getAccessibilityObservation(),
    modelRevision: () => editor.getDocumentHandle().revision,
    inputHostObservation: () => editor.getInputHostObservation(),
    caretClientRect: () => editor.getCaretClientRect(),
    focus: () => editor.focus(),
    setSelection: (range) => editor.exec({ type: 'setSelection', range }),
    relayout: (options) => editor.relayout(options),
    pointerAt: (point, options) =>
      editor.resolvePointer(point, {
        frameId: options?.frameId,
        hostMetrics: options?.hostMetrics,
      }),
    displaySnapshot: () => {
      const pages = editor.getDisplay();
      return { pageCount: pages.length, text: displayText(pages) };
    },
    save: () => editor.save(),
    async saveAndReopenText(): Promise<string> {
      const bytes = await editor.save();
      const { host, getPages } = headlessHost();
      const reopened = createEditor({ host, document: bytes });
      try {
        return displayText(getPages());
      } finally {
        reopened.destroy();
      }
    },
    dispose: () => editor.destroy(),
  };
}
