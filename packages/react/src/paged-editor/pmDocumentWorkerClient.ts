import type { Document } from '@eigenpal/docx-core/types/document';

export type ConversionMode = 'full' | 'incremental';

export type ConversionRequest = {
  mode: ConversionMode;
  pmDocJson: unknown;
  baseDocument: Document | null;
  dirtyIndices?: number[];
  expectedBlockCount?: number;
};

export type ConversionResult = {
  document: Document | null;
  mode: ConversionMode;
  error?: string;
};

type WorkerLike = {
  postMessage: (payload: any) => void;
  terminate: () => void;
  onmessage: ((event: { data: any }) => void) | null;
  onerror?: ((event: any) => void) | null;
};

export type WorkerClientOptions = {
  enabled?: boolean;
  workerFactory?: () => WorkerLike;
};

export function createWorkerClient(options: WorkerClientOptions) {
  const enabled = options.enabled ?? true;
  const workerFactory =
    options.workerFactory ??
    (() =>
      new Worker(new URL('./pmDocumentWorker.ts', import.meta.url), { type: 'module' }) as any);

  let worker: WorkerLike | null = null;
  let seq = 0;
  let latestId = 0;
  const pending = new Map<number, { resolve: (result: ConversionResult | null) => void }>();

  const ensureWorker = () => {
    if (worker) return;
    const nextWorker = workerFactory();
    worker = nextWorker;
    nextWorker.onmessage = (event: { data: any }) => {
      const payload = event.data as {
        id: number;
        document: Document | null;
        mode: ConversionMode;
        error?: string;
      };
      const entry = pending.get(payload.id);
      if (!entry) return;
      pending.delete(payload.id);

      if (payload.id !== latestId) {
        entry.resolve(null);
        return;
      }

      entry.resolve({
        document: payload.document ?? null,
        mode: payload.mode,
        error: payload.error,
      });
    };
    nextWorker.onerror = () => {
      // Fail all pending conversions; pipeline can retry on main thread.
      for (const entry of pending.values()) {
        entry.resolve(null);
      }
      pending.clear();
    };
  };

  const convert = async (request: ConversionRequest): Promise<ConversionResult | null> => {
    if (!enabled || typeof Worker === 'undefined') return null;
    ensureWorker();
    if (!worker) return null;

    const id = ++seq;
    latestId = id;

    return new Promise((resolve) => {
      pending.set(id, { resolve });
      worker!.postMessage({ id, ...request });
    });
  };

  const dispose = () => {
    if (worker) {
      worker.terminate();
      worker = null;
    }
    pending.clear();
  };

  return { convert, dispose };
}
