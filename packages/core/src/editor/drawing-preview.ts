// Previews of drawings from a host rendering service: one cache per editor, shared by every
// component that shows a preview. A preview is keyed by the drawing's source, so typing
// elsewhere reuses it and an edit to the drawing asks for a new one. The previous image stays
// visible while the new one loads.

import type { UnsupportedElement } from '../layout/unsupported-content-types.ts';
import {
  createDrawingPreviewPackage,
  type DrawingPreviewPackageResult,
} from '../store/package/drawing-preview-package.ts';
import { canonicalOoxmlFingerprint } from '../store/package/ooxml-serialize.ts';
import type { OoxmlElement } from '../store/package/ooxml-tree.ts';
import type { DocxEditorInstance } from './docx-editor-types.ts';
import { editorHostWindow } from './host-realm.ts';

/** What a {@link DrawingPreviewRender} receives. @public */
export interface DrawingPreviewRequest {
  /** A small DOCX that holds only this drawing and the parts it needs. */
  readonly docx: Uint8Array;
  /** The occurrence being previewed. */
  readonly element: UnsupportedElement;
  /** Aborted when the drawing changes or no component shows the preview any longer. */
  readonly signal: AbortSignal;
}

/**
 * Your rendering service call. Resolve with an image `Blob`, an image URL, or `null` to keep
 * the native drawing. Reject to report an error; the native drawing stays visible.
 *
 * @public
 */
export type DrawingPreviewRender = (
  request: DrawingPreviewRequest
) => Promise<Blob | string | null>;

/**
 * The preview for one occurrence.
 *
 * - `idle`: no request yet.
 * - `loading`: a request is running. `url` holds the previous image of this drawing, if any.
 * - `ready`: `url` holds the image.
 * - `unavailable`: the render function returned `null`, or the drawing cannot be packaged.
 * - `error`: the request failed. `error` holds the reason; `url` holds the previous image.
 *
 * @public
 */
export interface DrawingPreviewState {
  readonly status: 'idle' | 'loading' | 'ready' | 'unavailable' | 'error';
  readonly url: string | null;
  readonly error: unknown;
}

/** One preview cache for an editor. Adapters read it through their hook. @public */
export interface DrawingPreviewController {
  /** The current state of an occurrence. Stable until the state changes. */
  state(element: UnsupportedElement): DrawingPreviewState;
  /** Start a request unless the drawing already has a preview or a request is running. */
  request(element: UnsupportedElement, render: DrawingPreviewRender): void;
  /** Forget a failed or unavailable result and request again. */
  retry(element: UnsupportedElement, render: DrawingPreviewRender): void;
  /** Call `listener` after any state changes. Returns the unsubscribe function. */
  subscribe(listener: () => void): () => void;
}

interface Entry {
  state: DrawingPreviewState;
  controller: AbortController | null;
  /** True when this cache created the object URL and must revoke it. */
  ownsUrl: boolean;
}

const IDLE: DrawingPreviewState = Object.freeze({ status: 'idle', url: null, error: null });
const UNAVAILABLE: DrawingPreviewState = Object.freeze({
  status: 'unavailable',
  url: null,
  error: null,
});
const MAX_READY = 64;
const RELEASE_DELAY_MS = 30_000;
const controllers = new WeakMap<DocxEditorInstance, DrawingPreviewController>();
const fingerprints = new WeakMap<OoxmlElement, string>();

function sourceKey(element: UnsupportedElement): string | null {
  const source = element.source;
  if (!source) return null;
  let fingerprint = fingerprints.get(source);
  if (fingerprint === undefined) {
    fingerprint = canonicalOoxmlFingerprint(source);
    fingerprints.set(source, fingerprint);
  }
  return `${element.ownerPartName}\0${fingerprint}`;
}

/**
 * The preview DOCX for an occurrence, built from the editor's current document. Use it when
 * you call your rendering service yourself instead of through a preview hook.
 *
 * @public
 */
export function drawingPreviewDocx(
  editor: DocxEditorInstance,
  element: Pick<UnsupportedElement, 'ownerPartName' | 'nodeId'>
): DrawingPreviewPackageResult {
  const session = editor.surface?.session;
  if (!session) return { ok: false, reason: 'drawing-not-found' };
  return createDrawingPreviewPackage(session.currentPackage(), element);
}

/**
 * The shared preview cache of an editor. Every call with the same editor returns the same
 * controller. Images stay cached while any component shows a preview, and for 30 seconds
 * after the last one unmounts, so pagination does not request them again.
 *
 * @public
 */
export function drawingPreviewController(editor: DocxEditorInstance): DrawingPreviewController {
  const existing = controllers.get(editor);
  if (existing) return existing;
  const entries = new Map<string, Entry>();
  // The last image of each occurrence, shown while a changed drawing loads.
  const latest = new Map<string, string>();
  const listeners = new Set<() => void>();
  const running = new Map<string, { key: string; entry: Entry }>();
  let releaseTimer: number | undefined;

  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  const occurrence = (element: UnsupportedElement) => `${element.ownerPartName}\0${element.nodeId}`;
  const revoke = (entry: Entry) => {
    if (!entry.ownsUrl || !entry.state.url) return;
    const url = entry.state.url;
    editorHostWindow(editor).URL.revokeObjectURL(url);
    for (const [key, value] of latest) if (value === url) latest.delete(key);
  };
  const evict = () => {
    const ready = [...entries].filter(([, entry]) => entry.state.status === 'ready');
    for (const [key, entry] of ready.slice(0, Math.max(0, ready.length - MAX_READY))) {
      revoke(entry);
      entries.delete(key);
    }
  };
  const release = () => {
    for (const entry of entries.values()) {
      entry.controller?.abort();
      revoke(entry);
    }
    entries.clear();
    latest.clear();
    running.clear();
    notify();
  };
  const set = (key: string, entry: Entry, state: DrawingPreviewState) => {
    entry.state = Object.freeze(state);
    entries.delete(key);
    entries.set(key, entry);
    notify();
  };

  const controller: DrawingPreviewController = {
    state(element) {
      const key = sourceKey(element);
      const entry = key === null ? undefined : entries.get(key);
      if (entry) return entry.state;
      return key === null ? UNAVAILABLE : IDLE;
    },
    request(element, render) {
      const key = sourceKey(element);
      if (key === null || entries.has(key)) return;
      const packaged = drawingPreviewDocx(editor, element);
      const entry: Entry = { state: IDLE, controller: null, ownsUrl: false };
      if (!packaged.ok) {
        set(key, entry, { status: 'unavailable', url: null, error: packaged.reason });
        return;
      }
      // A changed drawing supersedes the request still running for its previous source.
      const place = occurrence(element);
      const superseded = running.get(place);
      if (superseded) {
        superseded.entry.controller?.abort();
        entries.delete(superseded.key);
      }
      const abort = new AbortController();
      entry.controller = abort;
      running.set(place, { key, entry });
      const previous = latest.get(place) ?? null;
      set(key, entry, { status: 'loading', url: previous, error: null });
      const settle = (state: DrawingPreviewState) => {
        if (abort.signal.aborted || entries.get(key) !== entry) return false;
        entry.controller = null;
        if (running.get(place)?.entry === entry) running.delete(place);
        set(key, entry, state);
        return true;
      };
      void Promise.resolve()
        .then(() => render({ docx: packaged.docx, element, signal: abort.signal }))
        .then(
          (result) => {
            if (result === null) {
              settle({ status: 'unavailable', url: null, error: null });
              return;
            }
            if (abort.signal.aborted || entries.get(key) !== entry) return;
            const url =
              typeof result === 'string'
                ? result
                : editorHostWindow(editor).URL.createObjectURL(result);
            entry.ownsUrl = typeof result !== 'string';
            if (!settle({ status: 'ready', url, error: null })) return;
            latest.set(place, url);
            evict();
          },
          (error: unknown) => {
            settle({ status: 'error', url: previous, error });
          }
        );
    },
    retry(element, render) {
      const key = sourceKey(element);
      const entry = key === null ? undefined : entries.get(key);
      if (
        key === null ||
        !entry ||
        entry.state.status === 'loading' ||
        entry.state.status === 'ready'
      )
        return;
      entries.delete(key);
      controller.request(element, render);
    },
    subscribe(listener) {
      listeners.add(listener);
      editorHostWindow(editor).clearTimeout(releaseTimer);
      return () => {
        listeners.delete(listener);
        if (listeners.size) return;
        editorHostWindow(editor).clearTimeout(releaseTimer);
        releaseTimer = editorHostWindow(editor).setTimeout(release, RELEASE_DELAY_MS);
      };
    },
  };
  controllers.set(editor, controller);
  return controller;
}

/**
 * Whether an occurrence is a drawing that the editor does not show in full: a placeholder, a
 * saved fallback, or a drawing with unsupported features. The default `match` of the drawing
 * preview components.
 *
 * @public
 */
export function drawingNeedsPreview(element: UnsupportedElement): boolean {
  return (
    element.drawing !== undefined && element.support !== undefined && element.support !== 'native'
  );
}
