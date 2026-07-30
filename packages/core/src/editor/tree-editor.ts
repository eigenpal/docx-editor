// The tree-lane `Editor` facade (phase 3, part 1 of the legacy-lane retirement).
//
// `createTreeEditor` implements the FULL `Editor` contract over the paginated surface —
// the tree session, semantic layout and painted pages — with no ProseMirror, no
// `PackageModel`, and no legacy display bridge. It is the shape the adapters will move to
// when `createEditor` retires.
//
// DELIBERATE PLACEHOLDER SHAPE — the `isActive` precedent, applied to a whole facade.
//
// The contract itself blesses honest-empty stubs: `isActive` documents that it returns
// `false` for every command until the derivation exists, because a control that shows
// nothing is better than one that shows a guess. This facade follows that rule everywhere:
//
// - REAL: load/save, the exec subset below (marks, alignment, indent, line break,
//   undo/redo, semantic setSelection, selection-addressed insert/delete text), selection
//   formatting, page setup, page counts, snapshot, change/selectionChange/error events,
//   focus, destroy, `query` for `selectedText` and `selectionFormatting`.
// - HONEST EMPTY: styles, fonts, outline, comments, tracked changes, find, image/table
//   context, watermark, header/footer state, and the entire geometry/interaction cluster
//   (`getInteractionFrame`, `hitTest`, `dispatchInteraction`, …) — the paginated surface
//   owns caret, selection and hit testing INTERNALLY through the browser's own selection,
//   so there is no engine-published geometry to project yet. Every member returns its
//   typed empty value, never an invented one.
// - The `display` event never fires: the surface paints its own pages into the container
//   rather than handing the host a render list.
//
// Filling any of these in later lights up whichever control reads it, with no change to
// callers — which is the point of wiring the full contract now.

import type {
  CanResult,
  DocumentChange,
  DocumentHandle,
  DocumentSource,
  Editor,
  EditorCommand,
  EditorError,
  EditorEvents,
  EditorFontError,
  EditorQueries,
  EditorQueryResults,
  EditorScope,
  EditorSnapshot,
  ExecResult,
  FontConfiguration,
  RunFormatting,
  TextMatch,
  Unsubscribe,
  ViewScope,
} from '@docx-editor.dev/core-contract/contracts/editor';
import {
  FontResolutionError,
  HARFBUZZ_SHAPING_LIBRARY,
  caretAt,
  createFixedMeasurer,
  createShapedMeasurer,
  type SemanticSelection as SurfaceSelection,
  type TextMeasurer,
} from '@docx-editor.dev/core-contract/layout';
import { createLayoutShaping, toEditorFontError } from './font-configuration.ts';
import { emptyInteractionFrame } from './interaction-frame.ts';
import { mountPaginatedSurface, type PaginatedSurface } from './paginated-surface.ts';

export interface TreeEditorConfig {
  /** The element the paginated surface mounts into. The surface owns this subtree. */
  container: HTMLElement;
  /**
   * A document to load at construction. Bytes only in practice: a `DocumentHandle` cannot
   * be re-opened (the handle is identity, not content), so passing one emits a typed
   * `error` event rather than silently loading nothing.
   */
  document?: DocumentSource;
  fonts?: FontConfiguration;
  author?: string;
  locale?: string;
  /** `'view'` refuses every mutating command through the facade; default `'edit'`. */
  mode?: 'edit' | 'view';
  zoom?: number;
  onFontError?: (error: EditorFontError) => void;
}

/**
 * The concrete facade type: the full `Editor` contract plus one escape hatch.
 *
 * `surface` exposes the underlying paginated surface for harnesses and tests that need
 * capabilities the contract does not carry yet (select-all, node-id addressed selection).
 * Production adapters must program against `Editor` alone.
 */
export interface TreeEditor extends Editor {
  readonly surface: PaginatedSurface | null;
}

/** Run-property spellings for the marks the surface can toggle, named as OOXML names them. */
const MARKS: Readonly<
  Record<string, { localName: string; attributes?: Record<string, string> }>
> = {
  bold: { localName: 'b' },
  italic: { localName: 'i' },
  underline: { localName: 'u', attributes: { val: 'single' } },
  strike: { localName: 'strike' },
};

type CommandSupport =
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
function isSurfaceSelection(value: unknown): value is SurfaceSelection {
  return (
    typeof value === 'object' &&
    value !== null &&
    isSurfacePosition((value as { anchor?: unknown }).anchor) &&
    isSurfacePosition((value as { head?: unknown }).head)
  );
}

function editorError(code: string, message: string): EditorError {
  const error = new Error(message) as Error & { code?: string };
  error.code = code;
  return error;
}

function selectionsMatch(a: SurfaceSelection | null, b: SurfaceSelection | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.anchor.paragraphId === b.anchor.paragraphId &&
    a.anchor.offset === b.anchor.offset &&
    a.head.paragraphId === b.head.paragraphId &&
    a.head.offset === b.head.offset
  );
}

export function createTreeEditor(config: TreeEditorConfig): TreeEditor {
  const container = config.container;
  const mode = config.mode ?? 'edit';
  let zoom =
    config.zoom !== undefined && Number.isFinite(config.zoom) && config.zoom >= 0.1 && config.zoom <= 5
      ? config.zoom
      : 1;

  let surface: PaginatedSurface | null = null;
  let parseError: string | null = null;
  let unsubscribeSession: Unsubscribe | null = null;
  let lastSelection: SurfaceSelection | null = null;
  let destroyed = false;

  /** The measurer built from `config.fonts` once shaping resolves; undefined until then. */
  let shapedMeasurer: TextMeasurer | undefined;
  let shapedProducer: string | undefined;

  const handlers: { [E in keyof EditorEvents]: Set<EditorEvents[E]> } = {
    change: new Set(),
    selectionChange: new Set(),
    display: new Set(),
    error: new Set(),
  };

  function emitError(error: EditorError): void {
    for (const handler of [...handlers.error]) handler(error);
  }

  function emitSelectionChange(): void {
    if (handlers.selectionChange.size === 0) return;
    const snapshot = snapshotOf();
    for (const handler of [...handlers.selectionChange]) handler(snapshot);
  }

  function teardownSurface(): void {
    unsubscribeSession?.();
    unsubscribeSession = null;
    surface?.destroy();
    surface = null;
    lastSelection = null;
  }

  /** Points to CSS pixels: zoom 1 paints at the browser's 96dpi reading of a 72dpi point. */
  const scaleOf = (): number => zoom * (96 / 72);

  function mountBytes(bytes: Uint8Array): void {
    teardownSurface();
    const result = mountPaginatedSurface(container, bytes, {
      scale: scaleOf(),
      ...(shapedMeasurer
        ? { measurer: shapedMeasurer, ...(shapedProducer ? { producer: shapedProducer } : {}) }
        : {}),
      onChange: (state) => {
        // The mount-time render reports before `surface` is assigned; nothing observable
        // has changed at that point, so it is not a selection change.
        if (!surface) return;
        if (selectionsMatch(state.selection, lastSelection)) return;
        lastSelection = state.selection;
        emitSelectionChange();
      },
    });
    if (!result.ok) {
      parseError = result.detail ? `${result.reason}: ${result.detail}` : result.reason;
      emitError(editorError(result.reason, `failed to open document: ${parseError}`));
      return;
    }
    parseError = null;
    surface = result.surface;
    lastSelection = surface.state().selection;
    unsubscribeSession = surface.session.subscribe((change) => {
      const documentChange: DocumentChange = {
        revision: change.toRevision,
        created: change.created,
        deleted: change.deleted,
        dirty: change.dirty,
      };
      for (const handler of [...handlers.change]) handler(documentChange);
    });
  }

  function normalizeSource(source: DocumentSource): Uint8Array | null {
    if (source instanceof Uint8Array) return source;
    if (source instanceof ArrayBuffer) return new Uint8Array(source);
    // The remaining form is a DocumentHandle: identity and revision, not content.
    return null;
  }

  // Fonts resolve asynchronously (HarfBuzz init + validation), and the surface samples its
  // measurer at mount. So the document opens on the fixed measurer immediately, and when the
  // shaped measurer arrives the surface is remounted FROM THE CURRENT TREE — `session.save()`
  // — so every edit made before fonts resolved survives. What does not survive is the undo
  // stack and the caret, the honest cost of a full remount; a rescale-in-place path on the
  // surface would remove it.
  if (config.fonts) {
    const fonts = config.fonts;
    void createLayoutShaping(fonts)
      .then((shaping) => {
        if (destroyed) return;
        shapedMeasurer = createShapedMeasurer({
          shaper: shaping.shaper,
          resolveFont: (style) => {
            const resolved = shaping.fonts.resolve({
              family: style.fontFamily ?? fonts.defaultFont.family,
              weight: style.bold ? 700 : 400,
              style: style.italic ? 'italic' : 'normal',
            });
            return resolved instanceof FontResolutionError ? null : resolved;
          },
          fallback: createFixedMeasurer(),
          shapingLibrary: HARFBUZZ_SHAPING_LIBRARY,
          unicodeDataVersion: '16.0.0',
          ...(fonts.language ? { language: fonts.language } : {}),
        });
        shapedProducer = `shaped:${shaping.operation.extensionFingerprint}`;
        if (surface) mountBytes(surface.session.save());
      })
      .catch((error: unknown) => {
        if (destroyed) return;
        const fontError = toEditorFontError(error);
        config.onFontError?.(fontError);
        emitError(fontError);
      });
  }

  /**
   * Whether a command is in the wired subset, and whether it writes.
   *
   * One classifier serves `exec` and `can`, so a dry run can never disagree with the real
   * one about what is supported.
   */
  function classify(command: EditorCommand): CommandSupport {
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

  function gate(
    command: EditorCommand,
    options?: { scope?: EditorScope }
  ): { ok: true } | { ok: false; refusal: Exclude<ExecResult, { ok: true }> } {
    if (options?.scope && options.scope.kind !== 'body') {
      return {
        ok: false,
        refusal: { ok: false, code: 'unsupported', reason: 'only the body scope is supported' },
      };
    }
    const support = classify(command);
    if (!support.supported) {
      return { ok: false, refusal: { ok: false, code: 'unsupported', reason: support.reason } };
    }
    if (!surface) {
      return {
        ok: false,
        refusal: { ok: false, code: 'notFound', reason: 'no document is loaded' },
      };
    }
    if (support.mutating && (mode === 'view' || !surface.session.editable)) {
      return {
        ok: false,
        refusal: { ok: false, code: 'locked', reason: 'the document is read-only' },
      };
    }
    return { ok: true };
  }

  function runFormattingOf(): RunFormatting | null {
    if (!surface) return null;
    const formatting = surface.formatting();
    return {
      bold: formatting.bold,
      italic: formatting.italic,
      underline: formatting.underline,
      strike: formatting.strikethrough,
      ...(formatting.color ? { color: { kind: 'hex' as const, value: formatting.color } } : {}),
      ...(formatting.highlight ? { highlight: formatting.highlight } : {}),
      ...(formatting.fontFamily ? { fontFamily: formatting.fontFamily } : {}),
      ...(formatting.fontSizeHalfPoints !== null
        ? { fontSizePt: formatting.fontSizeHalfPoints / 2 }
        : {}),
    };
  }

  function totalPages(): number {
    return surface ? surface.state().pageCount : 0;
  }

  function currentPage(): number {
    // Caret page from the layout records. There is no viewport tracking on this facade yet,
    // so `'viewport'` honestly answers with the caret's page as the nearest derivable value.
    if (!surface) return 1;
    const caret = caretAt(surface.layout(), surface.state().selection.head);
    return caret ? caret.pageIndex + 1 : 1;
  }

  function snapshotOf(): EditorSnapshot {
    return {
      scope: { kind: 'body' },
      isLoading: false,
      parseError,
      editable: surface !== null && surface.session.editable && mode !== 'view',
      zoom,
      // A DocRange addresses paragraphs by `w14:paraId`; the surface selection addresses
      // canonical node ids. Until that mapping exists, null is the honest answer.
      selection: null,
      formatting: runFormattingOf(),
      table: null,
      image: null,
      page: { current: currentPage(), total: totalPages() },
    };
  }

  if (config.document) {
    const bytes = normalizeSource(config.document);
    if (bytes) mountBytes(bytes);
    else {
      parseError = 'a DocumentHandle cannot be re-loaded; pass DOCX bytes';
      emitError(editorError('unsupported', parseError));
    }
  }

  const editor: TreeEditor = {
    get surface() {
      return surface;
    },

    load(document) {
      const bytes = normalizeSource(document);
      if (!bytes) {
        // A handle is identity, not content — there are no bytes to reopen. The current
        // document (if any) stays mounted rather than being torn down for nothing.
        emitError(
          editorError('unsupported', 'a DocumentHandle cannot be re-loaded; pass DOCX bytes')
        );
        return;
      }
      mountBytes(bytes);
    },

    save() {
      if (!surface) return Promise.reject(editorError('notFound', 'no document is loaded'));
      // A fresh copy, so the returned ArrayBuffer is exactly the document — not a window
      // into a larger allocation.
      const bytes = surface.session.save();
      const copy = bytes.slice();
      return Promise.resolve(copy.buffer as ArrayBuffer);
    },

    getDocumentHandle(): DocumentHandle {
      return Object.freeze({ revision: surface?.session.revision() ?? 0 });
    },

    exec(command, options) {
      const gated = gate(command, options);
      if (!gated.ok) return gated.refusal;
      const mounted = surface!;
      const before = mounted.session.revision();

      switch (command.type) {
        case 'toggleMark': {
          const mark = MARKS[command.mark]!;
          mounted.toggleRunProperty(mark.localName, mark.attributes);
          break;
        }
        case 'setAlignment':
          // The contract says `justify`; `w:jc` spells it `both`.
          mounted.setParagraphProperty('jc', {
            val: command.align === 'justify' ? 'both' : command.align,
          });
          break;
        case 'setIndent': {
          const attributes: Record<string, string> = {};
          if (command.left !== undefined) attributes.left = String(command.left);
          if (command.right !== undefined) attributes.right = String(command.right);
          if (command.firstLine !== undefined) attributes.firstLine = String(command.firstLine);
          if (command.hanging !== undefined) attributes.hanging = String(command.hanging);
          mounted.setParagraphProperty('ind', attributes);
          break;
        }
        case 'insertBreak':
          mounted.insertLineBreak();
          break;
        case 'insertText':
          mounted.type(command.text);
          break;
        case 'deleteText':
          mounted.deleteSelection();
          break;
        case 'undo':
          mounted.undo();
          break;
        case 'redo':
          mounted.redo();
          break;
        case 'setSelection': {
          if ('range' in command && isSurfaceSelection(command.range)) {
            mounted.setSelection(command.range);
          }
          // Selection is not document state: nothing to save changed.
          return { ok: true, changed: false };
        }
        default:
          // Unreachable: `classify` refused everything else. Typed for the compiler.
          return { ok: false, code: 'unsupported', reason: 'unsupported command' };
      }

      // `changed` is read from the model, not assumed: a toggle on a collapsed caret or an
      // undo on an empty stack commits nothing, and reporting `changed: true` would be a lie.
      return { ok: true, changed: mounted.session.revision() !== before };
    },

    can(command, options): CanResult {
      const gated = gate(command, options);
      return gated.ok ? { ok: true } : gated.refusal;
    },

    // The documented deliberate placeholder: never a value it has not derived.
    isActive: () => false,

    getDocumentStyles: () => [],
    getDocumentFonts: () => [],
    getOutline: () => [],
    getComments: () => [],

    getSelectionFormatting() {
      if (!surface) return null;
      const formatting = surface.formatting();
      return {
        bold: formatting.bold,
        italic: formatting.italic,
        underline: formatting.underline,
        ...(formatting.fontFamily ? { fontFamily: formatting.fontFamily } : {}),
        ...(formatting.fontSizeHalfPoints !== null
          ? { fontSizeHalfPoints: formatting.fontSizeHalfPoints }
          : {}),
        ...(formatting.styleId ? { styleId: formatting.styleId } : {}),
        ...(formatting.alignment ? { alignment: formatting.alignment } : {}),
      };
    },

    findMatches: () => [],
    selectMatch: (_match: TextMatch): ExecResult => ({
      ok: false,
      code: 'unsupported',
      reason: 'find is not wired on the tree editor yet',
    }),

    getSelectedImage: () => null,
    getSelectedTable: () => null,

    getPageSetup() {
      if (!surface) return null;
      const section = surface.sectionProperties();
      return {
        pageWidthTwips: section.pageSize.widthTwips,
        pageHeightTwips: section.pageSize.heightTwips,
        orientation: section.landscape ? ('landscape' as const) : ('portrait' as const),
        marginsTwips: {
          top: section.margins.topTwips,
          right: section.margins.rightTwips,
          bottom: section.margins.bottomTwips,
          left: section.margins.leftTwips,
        },
      };
    },

    getWatermark: () => null,
    getHeaderFooterState: () => null,
    getTrackedChanges: () => [],

    setActiveScope(_scope: ViewScope) {
      // The body is the only editable view; a non-body scope has nowhere to go.
    },
    getActiveScope: (): ViewScope => ({ kind: 'body' }),

    query<K extends keyof EditorQueries>(query: { type: K } & EditorQueries[K]) {
      // Two real answers, and the typed empty value for everything else.
      switch (query.type as keyof EditorQueries) {
        case 'selectedText':
          return (surface?.selectedText() ?? '') as EditorQueryResults[K];
        case 'selectionFormatting':
          return runFormattingOf() as EditorQueryResults[K];
        case 'isInsideToc':
          return false as EditorQueryResults[K];
        case 'trackedChanges':
        case 'revisions':
        case 'paragraphs':
        case 'findText':
        case 'contentControls':
        case 'comments':
          return [] as unknown as EditorQueryResults[K];
        case 'styles':
          return {
            paragraph: new Map(),
            character: new Map(),
            table: new Map(),
          } as unknown as EditorQueryResults[K];
        case 'variables':
          return {} as EditorQueryResults[K];
        default:
          // selection, tableContext, hyperlinkAt, watermark, splitCellConfig,
          // contentControlAt, pageContent — all nullable, all underived.
          return null as EditorQueryResults[K];
      }
    },

    snapshot: () => snapshotOf(),

    getTotalPages: () => totalPages(),
    getCurrentPage: () => currentPage(),

    scrollToPage: () => false,
    scrollToBlock: () => false,

    getZoom: () => zoom,
    setZoom(next: number): ExecResult {
      // Refused rather than clamped, mirroring the legacy facade: a caller that asked for
      // 0 or NaN has a bug, and silently substituting 1 hides it.
      if (!Number.isFinite(next) || next < 0.1 || next > 5) {
        return {
          ok: false,
          code: 'invalidArgs',
          reason: `zoom must be between 0.1 and 5, got ${next}`,
        };
      }
      if (next === zoom) return { ok: true, changed: false };
      zoom = next;
      // The surface samples its scale at mount and exposes no rescale-in-place, and a
      // remount here would discard the user's undo history for a zoom click. So the stored
      // zoom applies from the NEXT mount (a `load`, or the shaped-measurer remount);
      // repaint-at-current-scale lands when the surface grows a rescale path.
      return { ok: true, changed: true };
    },

    // ── Geometry / interaction cluster: the surface owns interaction internally, so every
    // member below projects the typed empty frame rather than guessed geometry. ──────────
    getInteractionFrame: () => emptyInteractionFrame(),
    getDisplay: () => [],
    getSelectionRects: () => [],
    getCaretRect: () => null,
    getCaretGeometry: () => null,
    getSelectionGeometry: () => null,
    hitTest: () => null,
    getPageGeometry: () => [],
    getScrollGeometry: () => emptyInteractionFrame().scrollGeometry,
    resolvePointer: () => ({
      ok: false,
      code: 'unsupported',
      reason: 'the paginated surface owns pointer interaction internally',
    }),
    dispatchInteraction: () => ({
      outcome: {
        ok: false,
        code: 'unsupported',
        reason: 'the paginated surface owns interaction dispatch internally',
      },
      hostEffects: [],
    }),
    getAccessibilityObservation: () => ({
      owner: 'none',
      scope: { kind: 'body' },
      frameId: emptyInteractionFrame().id,
      modelRevision: surface?.session.revision() ?? 0,
      editable: surface !== null && surface.session.editable && mode !== 'view',
      name: { kind: 'absent' },
      entries: [],
      focus: { scope: null, focused: false },
      selection: null,
      paintedPagesAssistiveRole: null,
    }),
    getInputHostObservation: () => null,
    getInteractionHostMetrics: () => null,
    getCaretClientRect: () => null,

    relayout() {
      // `layout()` flushes any commit the scheduler has not published yet; the surface
      // repaints from its own publish path, so there is nothing further to trigger.
      surface?.layout();
    },

    focus() {
      if (!surface) {
        return { ok: false, code: 'invalidTarget', reason: 'no document is loaded' };
      }
      surface.focus();
      return { ok: true, value: undefined, frameId: { value: 0 } };
    },

    destroy() {
      destroyed = true;
      teardownSurface();
      for (const set of Object.values(handlers)) set.clear();
    },

    on<E extends keyof EditorEvents>(event: E, handler: EditorEvents[E]): Unsubscribe {
      // `display` handlers are accepted but never called: the surface paints its own
      // pages instead of publishing a render list. Documented at the top of this file.
      handlers[event].add(handler);
      return () => {
        handlers[event].delete(handler);
      };
    },
  };

  return editor;
}
