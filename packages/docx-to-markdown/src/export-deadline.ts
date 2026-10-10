import { ExportResourceError } from '@docx-editor.dev/core/export';

/** Bound one exporter resource startup and normalize its failures. @internal */
export async function provisionWithExportDeadline<T>(
  start: (signal: AbortSignal) => Promise<T>,
  options: { readonly signal?: AbortSignal; readonly resourceTimeoutMs?: number }
): Promise<T> {
  const timeoutMs = options.resourceTimeoutMs ?? 60_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError('resourceTimeoutMs must be a positive finite number');
  }
  if (options.signal?.aborted) {
    throw new ExportResourceError('aborted', 'Font provisioning was aborted', {
      cause: options.signal.reason,
    });
  }
  const controller = new AbortController();
  let rejectAbort: ((reason: ExportResourceError) => void) | undefined;
  const interrupted = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  const abort = (): void => {
    const error = new ExportResourceError('aborted', 'Font provisioning was aborted', {
      cause: options.signal?.reason,
    });
    rejectAbort?.(error);
    controller.abort(error);
  };
  options.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(
    () => {
      const error = new ExportResourceError('timedOut', 'Font provisioning timed out');
      rejectAbort?.(error);
      controller.abort(error);
    },
    Math.max(1, timeoutMs)
  );
  try {
    return await Promise.race([
      Promise.resolve().then(() => start(controller.signal)),
      interrupted,
    ]);
  } catch (cause) {
    if (cause instanceof ExportResourceError) throw cause;
    if (controller.signal.reason instanceof ExportResourceError) {
      throw controller.signal.reason;
    }
    throw new ExportResourceError('layoutFailed', 'Font provisioning failed', { cause });
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
    rejectAbort = undefined;
  }
}

/** Share one live attempt, evict it when its last caller leaves, and cache only a success. @internal */
export function createSuccessfulValueCache<T>(
  load: (signal: AbortSignal) => Promise<T>
): (signal: AbortSignal) => Promise<T> {
  let settled: T | undefined;
  interface Attempt {
    readonly controller: AbortController;
    promise: Promise<T>;
    subscribers: number;
  }
  let current: Attempt | undefined;
  return async (signal: AbortSignal): Promise<T> => {
    if (settled !== undefined) return settled;
    if (signal.aborted) throw signal.reason;
    let attempt = current;
    if (!attempt) {
      const controller = new AbortController();
      const created: Attempt = {
        controller,
        subscribers: 0,
        promise: undefined as never,
      };
      created.promise = Promise.resolve()
        .then(() => load(controller.signal))
        .then((candidate) => {
          if (current === created) settled ??= candidate;
          return settled ?? candidate;
        })
        .finally(() => {
          if (current === created) current = undefined;
        });
      current = created;
      attempt = created;
    }
    attempt.subscribers += 1;
    let rejectAbort: ((reason: unknown) => void) | undefined;
    const interrupted = new Promise<never>((_, reject) => {
      rejectAbort = reject;
    });
    const abort = (): void => rejectAbort?.(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    try {
      return await Promise.race([attempt.promise, interrupted]);
    } finally {
      signal.removeEventListener('abort', abort);
      rejectAbort = undefined;
      attempt.subscribers -= 1;
      if (attempt.subscribers === 0 && current === attempt && settled === undefined) {
        current = undefined;
        attempt.controller.abort(signal.reason);
      }
    }
  };
}
