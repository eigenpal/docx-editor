// One neutral document layout session shared by all exporters.

import {
  openHeadlessDocument,
  type HeadlessDocumentRejection,
  type HeadlessDocumentView,
  type ImageDecodePort,
} from '@docx-editor.dev/core/store';
import {
  createDocumentFurnitureSource,
  createDocumentLinkProjectors,
  createDocumentNotesInput,
  createDocumentStyleDependencies,
  createFieldLinkRegistry,
} from '../layout/index.ts';
import { createFixedMeasurer } from '../layout/fixed-measurer.ts';
import { createInlineDrawingLayoutBundle } from '../layout/inline-drawing-source.ts';
import { releasePageFieldProjectionState } from '../layout/field-page-furniture.ts';
import { createParagraphLayoutCache } from '../layout/layout-cache.ts';
import { createLayoutSession } from '../layout/layout-session.ts';
import { releaseOverflowPageShellState } from '../layout/page-furniture-insets.ts';
import { layoutSemanticDocument } from '../layout/semantic-layout.ts';
import type { AnchoredDrawingRecord, InlineDrawingRecord } from '../layout/drawing-layout.ts';
import type {
  BlockFragmentRecord,
  SemanticLayout,
  TextMeasurer,
} from '../layout/semantic-records.ts';
import type { RevisionDisplayMode } from '../layout/revision-projection.ts';
import {
  createNodeImageDecodePort,
  type PreservedImageConverter,
} from './node-image-decode-port.ts';

/** Source accepted by every exporter: untrusted bytes or an already-open live view. @public */
export type ExportDocumentSource = Uint8Array | HeadlessDocumentView;

/** Shared session options; translators add their own format-specific options. @public */
export interface OpenDocumentForExportOptions {
  /** Revision projection applied before records reach an exporter. Default: `original`. */
  readonly displayMode?: RevisionDisplayMode;
  /** Host-owned measurement override; omit to use the core fixed fallback. */
  readonly measurer?: TextMeasurer;
  /** Stable measurement implementation identity used by layout caches and diagnostics. */
  readonly producer?: string;
  /** Host image metadata decoder; omit for the bounded DOM-free Node decoder. */
  readonly imageDecodePort?: ImageDecodePort;
  /** Optional converter for preserved image formats the default decoder cannot inspect. */
  readonly convertPreservedImage?: PreservedImageConverter;
  /** Cancels resource waits and subsequent layouts. */
  readonly signal?: AbortSignal;
  /** Maximum time spent waiting for image resources in one layout call. Default: 60 seconds. */
  readonly resourceTimeoutMs?: number;
  /** Retain incremental state for a live view. Defaults to true for views and false for bytes. */
  readonly reuseAcrossRevisions?: boolean;
}

/** Bounded resource-settlement failure from a headless export session. @public */
export class ExportResourceError extends Error {
  constructor(
    readonly code: 'aborted' | 'timedOut' | 'nonConvergent' | 'disposed',
    message: string
  ) {
    super(message);
    this.name = 'ExportResourceError';
  }
}

/**
 * A single semantic-layout substrate reusable by Markdown, PDF, and later exporters.
 * @public
 */
export interface ExportSession {
  /** Settle resources and return the default revision projection. */
  layout(): Promise<SemanticLayout>;
  /** Settle resources and cache one explicit revision projection. */
  layoutFor(displayMode: RevisionDisplayMode): Promise<SemanticLayout>;
  /** Mint a defensive copy only for a ready drawing from this session. */
  validatedImageBytes(drawing: InlineDrawingRecord | AnchoredDrawingRecord): Uint8Array | null;
  /** Release per-document caches and pending resource work. Idempotent. */
  dispose(): void;
}

/** Typed refusal for bytes that cannot become a document view. @public */
export type OpenDocumentForExportResult =
  | { readonly ok: true; readonly session: ExportSession }
  | { readonly ok: false; readonly reason: HeadlessDocumentRejection; readonly detail?: string };

function normalizedResourceTimeout(value: number | undefined): number {
  if (value === undefined) return 60_000;
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError('resourceTimeoutMs must be a positive finite number');
  }
  return Math.max(1, value);
}

function blocksHavePendingImages(blocks: readonly BlockFragmentRecord[]): boolean {
  for (const block of blocks) {
    if (block.kind === 'table') {
      for (const row of block.rows) {
        for (const cell of row.cells) {
          if (blocksHavePendingImages(cell.blocks)) return true;
        }
      }
      continue;
    }
    for (const line of block.lines) {
      for (const drawing of line.drawings ?? []) {
        if (drawing.resource.kind === 'pending') return true;
      }
    }
  }
  return false;
}

function drawingHasPendingImage(drawing: AnchoredDrawingRecord): boolean {
  return (
    drawing.resource.kind === 'pending' ||
    (drawing.textboxStory !== undefined && blocksHavePendingImages(drawing.textboxStory.fragments))
  );
}

function layoutHasPendingImages(layout: SemanticLayout): boolean {
  for (const page of layout.pages) {
    if (blocksHavePendingImages(page.fragments)) return true;
    if ((page.anchoredDrawings ?? []).some(drawingHasPendingImage)) return true;
    for (const story of [page.header, page.footer]) {
      if (!story) continue;
      if (blocksHavePendingImages(story.fragments)) return true;
      if ((story.anchoredDrawings ?? []).some(drawingHasPendingImage)) return true;
    }
    for (const area of [page.footnotes, page.endnotes]) {
      if (!area) continue;
      if (area.separator && blocksHavePendingImages(area.separator.fragments)) return true;
      for (const note of area.notes) {
        if (blocksHavePendingImages(note.fragments)) return true;
      }
    }
  }
  return false;
}

function isDocumentView(source: ExportDocumentSource): source is HeadlessDocumentView {
  return !ArrayBuffer.isView(source);
}

/** Exact dynamic inputs that can change projected text while story nodes stay identical. */
function textProjectionToken(view: HeadlessDocumentView): string {
  const pkg = view.currentPackage();
  return JSON.stringify({
    properties: view.documentProperties(),
    relationships: [...pkg.relationships.entries()].map(([owner, records]) => [
      owner,
      records.map((record) => [record.id, record.type, record.rawTarget, record.targetMode]),
    ]),
    externalTargets: pkg.externalTargets.map((record) => [
      record.ownerPart,
      record.id,
      record.type,
      record.rawTarget,
      record.sinkSafe,
    ]),
  });
}

/** Open bytes or a live neutral view into one reusable layout session. @public */
export function openDocumentForExport(
  source: ExportDocumentSource,
  options: OpenDocumentForExportOptions = {}
): OpenDocumentForExportResult {
  const sourceIsView = isDocumentView(source);
  const opened = isDocumentView(source)
    ? { ok: true as const, view: source }
    : openHeadlessDocument(source);
  if (!opened.ok) return opened;

  const initialView = opened.view;
  const reuseAcrossRevisions = options.reuseAcrossRevisions ?? sourceIsView;
  const timeoutMs = normalizedResourceTimeout(options.resourceTimeoutMs);
  const displayMode = options.displayMode ?? 'original';
  const initialMeasurer = options.measurer ?? createFixedMeasurer();
  const producer =
    options.producer ?? (options.measurer ? 'host-export-measurer' : 'export-fixed-measurer');
  // Byte exports are immutable one-shot snapshots. Their break cache exists only to share work
  // inside the pass, so cap it much more tightly than a live editor's cross-revision cache.
  const initialParagraphCache = createParagraphLayoutCache<never>({
    retainAcrossPasses: reuseAcrossRevisions,
  });
  let resourceEpoch = 0;
  const waiters = new Set<() => void>();
  const resourcesChanged = (): void => {
    resourceEpoch += 1;
    for (const resolve of waiters) resolve();
    waiters.clear();
  };
  const initialDrawingBundle = createInlineDrawingLayoutBundle({
    session: initialView,
    decodePort:
      options.imageDecodePort ??
      createNodeImageDecodePort(
        options.convertPreservedImage
          ? { convertPreserved: options.convertPreservedImage }
          : undefined
      ),
    onResourcesChanged: resourcesChanged,
  });
  let activeState: {
    readonly view: HeadlessDocumentView;
    readonly measurer: TextMeasurer;
    readonly paragraphCache: ReturnType<typeof createParagraphLayoutCache<never>>;
    readonly sessions: Map<RevisionDisplayMode, ReturnType<typeof createLayoutSession>>;
    readonly completed: Map<
      RevisionDisplayMode,
      { readonly revision: number; readonly layout: SemanticLayout }
    >;
    readonly inFlight: Map<RevisionDisplayMode, Promise<SemanticLayout>>;
    readonly styles: ReturnType<typeof createDocumentStyleDependencies>;
    readonly fieldLinks: Map<
      RevisionDisplayMode,
      {
        readonly revision: number;
        readonly registry: ReturnType<typeof createFieldLinkRegistry>;
      }
    >;
    readonly links: ReturnType<typeof createDocumentLinkProjectors>;
    readonly drawingBundle: ReturnType<typeof createInlineDrawingLayoutBundle>;
    readonly furniture: Map<RevisionDisplayMode, ReturnType<typeof createDocumentFurnitureSource>>;
    projection: { revision: number; token: string };
  } | null = {
    view: initialView,
    measurer: initialMeasurer,
    paragraphCache: initialParagraphCache,
    sessions: new Map(),
    completed: new Map(),
    inFlight: new Map(),
    styles: createDocumentStyleDependencies(initialView),
    fieldLinks: new Map(),
    links: createDocumentLinkProjectors(initialView),
    drawingBundle: initialDrawingBundle,
    furniture: new Map(),
    projection: { revision: -1, token: '' },
  };
  const resourceAbort = new AbortController();
  const callerSignal = options.signal;
  const abortFromCaller = (): void => resourceAbort.abort(callerSignal?.reason);
  callerSignal?.addEventListener('abort', abortFromCaller, { once: true });
  if (callerSignal?.aborted) abortFromCaller();
  const assertActive = (): void => {
    if (!activeState) throw new ExportResourceError('disposed', 'Export session has been disposed');
    if (resourceAbort.signal.aborted) {
      throw new ExportResourceError('aborted', 'Export resource settlement was aborted');
    }
  };

  const waitForResourceChange = (observedEpoch: number, deadline: number): Promise<void> => {
    if (resourceEpoch !== observedEpoch) return Promise.resolve();
    assertActive();
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error?: ExportResourceError): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        waiters.delete(changed);
        resourceAbort.signal.removeEventListener('abort', aborted);
        if (error) reject(error);
        else resolve();
      };
      const changed = (): void => finish();
      const aborted = (): void =>
        finish(new ExportResourceError('aborted', 'Export resource settlement was aborted'));
      const remaining = deadline - Date.now();
      const timer = setTimeout(
        () =>
          finish(
            new ExportResourceError(
              'timedOut',
              `Image resources did not settle within ${timeoutMs}ms`
            )
          ),
        Math.max(0, remaining)
      );
      waiters.add(changed);
      resourceAbort.signal.addEventListener('abort', aborted, { once: true });
    });
  };

  const runLayout = async (
    mode: RevisionDisplayMode,
    revisionRestarts = 0,
    absoluteDeadline = Date.now() + timeoutMs
  ): Promise<SemanticLayout> => {
    assertActive();
    if (Date.now() >= absoluteDeadline) {
      throw new ExportResourceError(
        'timedOut',
        `Export layout did not stabilize within ${timeoutMs}ms`
      );
    }
    const state = activeState!;
    const deadline = absoluteDeadline;
    const revision = state.view.packageRevision();
    const cached = state.completed.get(mode);
    if (cached && cached.revision === revision) return cached.layout;

    if (state.projection.revision !== revision) {
      const token = textProjectionToken(state.view);
      if (state.projection.revision >= 0 && state.projection.token !== token) {
        // Link targets and document-property fields are projected before line breaking but do
        // not live in the paragraph tree. Drop only projection-dependent derived state; ordinary
        // text edits retain the incremental cache.
        state.paragraphCache.clear();
        state.furniture.clear();
        state.sessions.clear();
      }
      state.projection = { revision, token };
    }

    let fieldLinkState = state.fieldLinks.get(mode);
    if (!fieldLinkState || fieldLinkState.revision !== revision) {
      fieldLinkState?.registry.clear();
      fieldLinkState = { revision, registry: createFieldLinkRegistry() };
      state.fieldLinks.set(mode, fieldLinkState);
      // Furniture captures its mode/revision registry. A live-view edit must not reuse it.
      state.furniture.delete(mode);
    }
    const fieldLinks = fieldLinkState.registry;

    const session = state.sessions.get(mode) ?? createLayoutSession();
    state.sessions.set(mode, session);
    let source = state.furniture.get(mode);
    if (!source) {
      source = createDocumentFurnitureSource({
        view: state.view,
        measurer: state.measurer,
        producer,
        cache: state.paragraphCache,
        styleCascade: state.styles.styleCascade,
        numberingIndex: state.styles.numberingIndex,
        defaultTabStopPt: state.styles.defaultTabStopPt,
        displayMode: mode,
        inlineDrawingLayoutForPart: (partName) => state.drawingBundle.contextForPart(partName),
        drawingLayoutTokenForPart: (partName) => state.drawingBundle.cacheTokenForPart(partName),
        drawingTokenForParagraphForPart: (partName, paragraph) =>
          state.drawingBundle.drawingTokenForParagraph(paragraph, partName),
        projectLinkForPart: state.links.projectLinkForPart,
        projectFieldLink: (spec) => fieldLinks.project(spec),
      });
      state.furniture.set(mode, source);
    }

    for (let pass = 0; pass < 64; pass += 1) {
      const observedEpoch = resourceEpoch;
      state.drawingBundle.sync(state.view);
      if (state.view.packageRevision() !== revision) {
        if (revisionRestarts >= 63) {
          throw new ExportResourceError(
            'nonConvergent',
            'Document revision did not stabilize during export layout'
          );
        }
        return runLayout(mode, revisionRestarts + 1, deadline);
      }
      const notes = createDocumentNotesInput({
        view: state.view,
        measurer: state.measurer,
        producer,
        cache: state.paragraphCache,
        styleCascade: state.styles.styleCascade,
        numberingIndex: state.styles.numberingIndex,
        defaultTabStopPt: state.styles.defaultTabStopPt,
        inlineDrawingLayoutForPart: (partName) => state.drawingBundle.contextForPart(partName),
        drawingTokenForParagraphForPart: (partName, paragraph) =>
          state.drawingBundle.drawingTokenForParagraph(paragraph, partName),
        drawingLayoutEpochForPart: (partName) => state.drawingBundle.cacheTokenForPart(partName),
        projectLinkForPart: state.links.projectLinkForPart,
        projectFieldLink: (spec) => fieldLinks.project(spec),
        displayMode: mode,
      });
      const layout = layoutSemanticDocument(state.view.part(), state.view.packageRevision(), {
        measurer: state.measurer,
        cache: state.paragraphCache,
        session,
        producer,
        styleCascade: state.styles.styleCascade(),
        defaultTabStopPt: state.styles.defaultTabStopPt,
        numberingIndex: state.styles.numberingIndex(),
        sectionFurniture: source.sectionFurniture(),
        furniture: source.furniture(),
        projectLink: state.links.projectLink,
        projectFieldLink: (spec) => fieldLinks.project(spec),
        documentProperties: state.view.documentProperties(),
        inlineDrawingLayout: state.drawingBundle.bodyContext,
        drawingTokenForParagraph: (paragraph) =>
          state.drawingBundle.drawingTokenForParagraph(paragraph, state.view.part().name),
        drawingLayoutEpoch: state.drawingBundle.cacheTokenForPart(state.view.part().name),
        ...(notes ? { notes } : {}),
        displayMode: mode,
      });
      if (!layoutHasPendingImages(layout)) {
        if (state.view.packageRevision() !== revision) {
          if (revisionRestarts >= 63) {
            throw new ExportResourceError(
              'nonConvergent',
              'Document revision did not stabilize during export layout'
            );
          }
          return runLayout(mode, revisionRestarts + 1, deadline);
        }
        state.completed.set(mode, { revision, layout });
        if (!reuseAcrossRevisions) {
          releasePageFieldProjectionState(layout);
          releaseOverflowPageShellState(layout);
          state.paragraphCache.clear();
          state.sessions.delete(mode);
        }
        return layout;
      }
      // One pass discovers every image referenced by the laid-out stories. Await the whole
      // discovered batch before laying the document out again; relayout on each individual
      // decode made 65 valid staggered images hit the 64-pass convergence guard.
      let settlementEpoch = observedEpoch;
      while (state.drawingBundle.pendingResourceCount() > 0) {
        await waitForResourceChange(settlementEpoch, deadline);
        settlementEpoch = resourceEpoch;
        assertActive();
      }
      assertActive();
      if (state.view.packageRevision() !== revision) {
        if (revisionRestarts >= 63) {
          throw new ExportResourceError(
            'nonConvergent',
            'Document revision did not stabilize during export layout'
          );
        }
        return runLayout(mode, revisionRestarts + 1, deadline);
      }
    }
    throw new ExportResourceError(
      'nonConvergent',
      'Image resources did not reach quiescence after 64 layout passes'
    );
  };

  const layoutFor = (mode: RevisionDisplayMode): Promise<SemanticLayout> => {
    if (!activeState) {
      return Promise.reject(
        new ExportResourceError('disposed', 'Export session has been disposed')
      );
    }
    const state = activeState;
    const existing = state.inFlight.get(mode);
    if (existing) return existing;
    const promise = runLayout(mode).finally(() => state.inFlight.delete(mode));
    state.inFlight.set(mode, promise);
    return promise;
  };

  const exportSession: ExportSession = {
    layout: () => layoutFor(displayMode),
    layoutFor,
    validatedImageBytes(drawing) {
      const state = activeState;
      if (!state || drawing.resource.kind !== 'ready') return null;
      return (
        state.drawingBundle
          .mintValidatedBytes(drawing.resource.validatedHandle, drawing.resource.contentId)
          ?.slice() ?? null
      );
    },
    dispose() {
      const state = activeState;
      if (!state) return;
      activeState = null;
      callerSignal?.removeEventListener('abort', abortFromCaller);
      resourceAbort.abort();
      state.drawingBundle.dispose();
      state.paragraphCache.clear();
      for (const completed of state.completed.values()) {
        releasePageFieldProjectionState(completed.layout);
        releaseOverflowPageShellState(completed.layout);
      }
      for (const fieldLinks of state.fieldLinks.values()) fieldLinks.registry.clear();
      state.fieldLinks.clear();
      state.completed.clear();
      state.inFlight.clear();
      state.furniture.clear();
      state.sessions.clear();
      resourcesChanged();
    },
  };
  return { ok: true, session: exportSession };
}
