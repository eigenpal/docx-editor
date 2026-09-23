import { DocumentRefreshError } from './document-refresh-types.ts';
export { DocumentRefreshError } from './document-refresh-types.ts';
import { readOoxmlPackage } from '../store/package/ooxml-package.ts';
import type { DocxEditorInstance } from './docx-editor-types.ts';
import { createRefreshHighlights } from './document-refresh-highlights.ts';
import { refreshHostFor } from './document-refresh-host.ts';
import { refreshCompositionActive } from './refresh-write-guard.ts';
import { pendingSurfaceCommit } from './surface-commit-state.ts';
import {
  resolveRefreshChanges,
  revisionChangeKeys,
  type LocatedChange,
} from './document-refresh-changes.ts';
import type {
  DocumentRefresh,
  DocumentRefreshState,
  RefreshFailureCode,
  RefreshResult,
  RefreshSubmission,
  RefreshUpdate,
} from './document-refresh-types.ts';
export type * from './document-refresh-types.ts';

const controllers = new WeakMap<DocxEditorInstance, DocumentRefresh>();
let nextController = 0;

/**
 * Get the engine-owned controller for updated DOCX files. React and Vue use the same controller.
 * Transport and processor jobs belong to your application. This is a host API, not an Office.js document member.
 * @public
 */
export function createDocumentRefresh(editor: DocxEditorInstance): DocumentRefresh {
  const existing = controllers.get(editor);
  if (existing) return existing;
  const host = refreshHostFor(editor);
  const prefix = `refresh-${++nextController}`;
  let generation = 0;
  let active: {
    token: RefreshSubmission;
    epoch: number;
    revision: number;
    sequence: number;
    seen: Map<string, string>;
  } | null = null;
  let abort = new AbortController();
  let busy = false;
  let queue = Promise.resolve();
  let recovery: { bytes: Uint8Array; epoch: number } | null = null;
  let located: LocatedChange[] = [];
  let acceptedRevision: number | null = null;
  const listeners = new Set<() => void>();
  const resultListeners = new Set<(result: RefreshResult) => void>();
  let state: DocumentRefreshState = Object.freeze({
    phase: 'idle',
    result: null,
    changes: [],
    highlightsVisible: false,
    recoveryAvailable: false,
  });
  const notify = (patch: Partial<DocumentRefreshState>) => {
    state = Object.freeze({ ...state, ...patch });
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        /* A host observer cannot abort replacement. */
      }
    }
  };
  const highlights = createRefreshHighlights(editor, host, () => {
    if (state.highlightsVisible) notify({ highlightsVisible: false });
  });
  const publish = (result: RefreshResult, phase?: DocumentRefreshState['phase']): RefreshResult => {
    if (phase) notify({ phase, result, recoveryAvailable: recovery !== null });
    for (const listener of resultListeners) {
      try {
        listener(result);
      } catch {
        /* Isolate host observers. */
      }
    }
    return result;
  };
  const failure = (
    resultId: string,
    code: RefreshFailureCode,
    recovered?: boolean
  ): RefreshResult => ({
    ok: false,
    resultId,
    code,
    ...(recovered === undefined ? {} : { recovered }),
  });
  const refusal = (): RefreshFailureCode | null =>
    host.collaboration()
      ? 'collaboration'
      : !host.surface() || !host.container() || editor.snapshot().isOpening
        ? 'unavailable'
        : null;
  const reset = () => {
    generation++;
    active = null;
    abort.abort();
    abort = new AbortController();
    located = [];
    acceptedRevision = null;
    highlights.clear();
  };
  host.invalidated.add(() => {
    reset();
    recovery = null;
    notify({
      phase: 'idle',
      result: null,
      changes: [],
      highlightsVisible: false,
      recoveryAvailable: false,
    });
  });
  editor.on('change', (change) => {
    if (change.source || acceptedRevision === null || host.revision === acceptedRevision) return;
    // Locations name one accepted revision. Never paint stale ranges after a local edit.
    located = [];
    highlights.clear();
    acceptedRevision = null;
    notify({ changes: [], highlightsVisible: false });
  });
  const settle = async (signal: AbortSignal) => {
    const surface = host.surface();
    const container = host.container();
    if (!surface || !container) throw new Error('unavailable');
    if (refreshCompositionActive(surface)) {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          container.removeEventListener('compositionend', done);
          signal.removeEventListener('abort', cancel);
        };
        const done = () => {
          cleanup();
          resolve();
        };
        const cancel = () => {
          cleanup();
          reject(new Error('cancelled'));
        };
        container.addEventListener('compositionend', done);
        signal.addEventListener('abort', cancel, { once: true });
        if (signal.aborted) cancel();
      });
    }
    const pending = pendingSurfaceCommit(container);
    if (pending) await pending;
    if (signal.aborted || host.surface() !== surface) throw new Error('document-changed');
    // No await between final input, serialization, and the revision read.
    const bytes = surface.save();
    if (host.surface() !== surface) throw new Error('document-changed');
    return { bytes, revision: host.revision };
  };
  const controller: DocumentRefresh = {
    async capture() {
      const code = refusal();
      if (recovery) throw new DocumentRefreshError('recovery-failed');
      if (code || busy) throw new DocumentRefreshError(code ?? 'busy');
      reset();
      recovery = null;
      const current = generation;
      const epoch = host.epoch;
      const signal = abort.signal;
      notify({
        phase: 'capturing',
        result: null,
        changes: [],
        highlightsVisible: false,
        recoveryAvailable: false,
      });
      try {
        const captured = await settle(signal);
        if (current !== generation || epoch !== host.epoch) throw new Error('superseded');
        const token = Object.freeze({
          id: `${prefix}-${current}`,
          bytes: captured.bytes.slice().buffer as ArrayBuffer,
        });
        active = {
          token,
          epoch,
          revision: captured.revision,
          sequence: -1,
          seen: revisionChangeKeys(host),
        };
        notify({ phase: 'processing' });
        return token;
      } catch (error) {
        if (current === generation) notify({ phase: 'failed' });
        throw new DocumentRefreshError(
          current === generation ? 'input-failed' : 'superseded',
          error
        );
      }
    },
    applyUpdate(update) {
      const resultId = `${update.submission?.id ?? 'unknown'}:${update.sequence}`;
      // Own bytes and metadata at delivery. A caller cannot mutate a queued result.
      let owned: RefreshUpdate;
      try {
        if (
          !Number.isSafeInteger(update.sequence) ||
          update.sequence < 0 ||
          !(update.bytes instanceof Uint8Array || update.bytes instanceof ArrayBuffer) ||
          (update.failures !== undefined &&
            (!Array.isArray(update.failures) ||
              update.failures.length > 10000 ||
              update.failures.some((id) => typeof id !== 'string'))) ||
          (update.changes &&
            (update.changes.length > 10000 ||
              new Set(update.changes.map((c) => c.id)).size !== update.changes.length ||
              update.changes.some(
                (c) =>
                  typeof c.id !== 'string' ||
                  !c.id ||
                  (c.unavailableReason !== undefined &&
                    !['deleted', 'unavailable'].includes(c.unavailableReason))
              )))
        )
          throw new Error('invalid-result');
        owned = {
          ...update,
          bytes: new Uint8Array(
            update.bytes instanceof Uint8Array ? update.bytes : update.bytes
          ).slice(),
          changes: update.changes?.map((c) => ({
            ...c,
            location: c.location ? { ...c.location } : undefined,
          })),
          failures: update.failures?.slice(),
        };
      } catch {
        return Promise.resolve(publish(failure(resultId, 'invalid-result')));
      }
      const apply = async (): Promise<RefreshResult> => {
        const request = active;
        const code = refusal();
        if (code) return publish(failure(resultId, code));
        if (!request || request.token !== owned.submission)
          return publish(failure(resultId, 'superseded'));
        if (owned.sequence <= request.sequence) return publish(failure(resultId, 'out-of-order'));
        if (request.epoch !== host.epoch) return publish(failure(resultId, 'document-changed'));
        busy = true;
        const signal = abort.signal;
        const valid = () => active === request && request.epoch === host.epoch && !signal.aborted;
        try {
          const previous = await settle(signal);
          if (!valid()) return publish(failure(resultId, 'cancelled'));
          if (previous.revision !== request.revision)
            return publish(failure(resultId, 'local-edits'), 'failed');
          const bytes = owned.bytes as Uint8Array;
          if (!readOoxmlPackage(bytes).ok)
            return publish(failure(resultId, 'invalid-document'), 'failed');
          highlights.clear();
          located = [];
          acceptedRevision = null;
          notify({ phase: 'refreshing', changes: [], highlightsVisible: false });
          // Observers can cancel, switch documents, or edit when notified.
          if (!valid()) return publish(failure(resultId, 'cancelled'));
          const finalBytes = host.surface()!.save();
          if (!valid()) return publish(failure(resultId, 'cancelled'));
          if (host.revision !== request.revision)
            return publish(failure(resultId, 'local-edits'), 'failed');
          recovery = { bytes: finalBytes.slice(), epoch: host.epoch };
          const loaded = await host.replace(bytes, 'refresh');
          if (request.epoch !== host.epoch) return publish(failure(resultId, 'document-changed'));
          if (!loaded && !valid()) {
            recovery = null;
            return publish(failure(resultId, 'cancelled'));
          }
          if (!loaded) {
            notify({ phase: 'recovering' });
            if (request.epoch !== host.epoch) return publish(failure(resultId, 'document-changed'));
            const restored = recovery && (await host.replace(recovery.bytes, 'recovery'));
            if (request.epoch !== host.epoch) return publish(failure(resultId, 'document-changed'));
            if (restored) recovery = null;
            active = null;
            return publish(
              failure(resultId, restored ? 'load-failed' : 'recovery-failed', !!restored),
              'failed'
            );
          }
          // Accepted content stays accepted if cancellation races with mount completion.
          recovery = null;
          highlights.clear();
          request.revision = host.mountedRevision;
          request.sequence = owned.sequence;
          const resolved = resolveRefreshChanges(host, resultId, owned.changes, request.seen);
          located = host.revision === request.revision ? resolved.located : [];
          for (const entry of located) request.seen.set(entry.change.id, entry.fingerprint);
          acceptedRevision = request.revision;
          const changes = Object.freeze(located.map((entry) => Object.freeze(entry.change)));
          const result: RefreshResult = Object.freeze({
            ok: true,
            resultId,
            changes,
            changeInformation:
              host.revision === request.revision && resolved.available
                ? 'available'
                : 'unavailable',
            failures: Object.freeze(owned.failures ?? []),
          });
          notify({ changes, result, phase: 'complete', recoveryAvailable: false });
          return publish(result);
        } catch {
          return publish(
            failure(resultId, valid() ? 'input-failed' : 'cancelled'),
            valid() ? 'failed' : undefined
          );
        } finally {
          busy = false;
        }
      };
      const result = queue.then(apply);
      queue = result.then(
        () => undefined,
        () => undefined
      );
      return result;
    },
    cancel() {
      const keepRecovery = state.phase === 'recovering' || (!host.surface() && recovery !== null);
      host.cancel();
      generation++;
      active = null;
      abort.abort();
      abort = new AbortController();
      if (!keepRecovery) recovery = null;
      notify({
        phase: keepRecovery ? 'failed' : state.result?.ok ? 'complete' : 'idle',
        result: keepRecovery || state.result?.ok ? state.result : null,
        recoveryAvailable: recovery !== null,
      });
    },
    finish(submission) {
      if (active?.token === submission && !busy) {
        active = null;
        notify({ phase: state.phase === 'processing' ? 'idle' : state.phase });
      }
    },
    snapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    onResult(listener) {
      resultListeners.add(listener);
      return () => {
        resultListeners.delete(listener);
      };
    },
    highlightChanges(options) {
      highlights.validate(options);
      if (acceptedRevision !== host.revision) return 0;
      const ids = options?.changeIds === undefined ? null : new Set(options.changeIds);
      const selected = located.filter(
        (entry) =>
          entry.change.status === 'available' &&
          (ids ? ids.has(entry.change.id) : options?.includePrevious || entry.change.isNew)
      );
      highlights.show(selected, options);
      notify({ highlightsVisible: selected.length > 0 });
      return selected.length;
    },
    clearHighlights(options) {
      highlights.hide(options);
      notify({ highlightsVisible: false });
    },
    navigateToChange(id, options = {}) {
      const block = options.block ?? 'center';
      const behavior = options.behavior ?? 'instant';
      const offsetPx = options.offsetPx ?? 24;
      if (!['start', 'center', 'centerIfNeeded', 'nearest'].includes(block))
        throw new TypeError('block must be start, center, centerIfNeeded, or nearest.');
      if (!['instant', 'smooth'].includes(behavior))
        throw new TypeError('behavior must be instant or smooth.');
      if (options.focus !== undefined && typeof options.focus !== 'boolean')
        throw new TypeError('focus must be a boolean.');
      if (!Number.isFinite(offsetPx) || offsetPx < 0)
        throw new RangeError('offsetPx must be finite and nonnegative.');
      if (acceptedRevision !== host.revision) return false;
      const reduced =
        host
          .container()
          ?.ownerDocument.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ??
        false;
      const target = located.find((entry) => entry.change.id === id);
      if (!target?.paragraphId || target.offset === undefined) return false;
      const surface = host.surface();
      if (
        !surface?.revealPosition(
          { paragraphId: target.paragraphId, offset: target.offset },
          { block, offsetPx, behavior: reduced ? 'instant' : behavior }
        )
      )
        return false;
      if (options?.focus) {
        surface.setActiveScope({ kind: 'body' });
        const position = { paragraphId: target.paragraphId, offset: target.offset };
        surface.setSelection({ anchor: position, head: position });
        surface.focus();
      }
      return true;
    },
    recoveryBytes: () => (recovery ? (recovery.bytes.slice().buffer as ArrayBuffer) : null),
    async recover() {
      if (!recovery || recovery.epoch !== host.epoch || busy) return false;
      busy = true;
      const saved = recovery;
      notify({ phase: 'recovering' });
      try {
        if (saved.epoch !== host.epoch) return false;
        const ok = await host.replace(saved.bytes, 'recovery');
        if (saved.epoch !== host.epoch) return false;
        if (ok) recovery = null;
        notify({ phase: ok ? 'idle' : 'failed', recoveryAvailable: !ok });
        return ok;
      } finally {
        busy = false;
      }
    },
  };
  controllers.set(editor, controller);
  return controller;
}
