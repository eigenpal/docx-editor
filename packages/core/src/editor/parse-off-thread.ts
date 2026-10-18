// Reading a large document's package on a worker, so the page stays responsive while it opens.
//
// `parseInWorker` turns it on. The open scheduler's prepare task asks this module for the read
// (`docx-editor-prepared-open.ts`); every way the worker can fail answers null, and the open
// then reads the bytes on the page exactly as it does without the option. A failed worker
// costs time, never the document.
//
// One worker per read, terminated as soon as it answers: an open is rare, and an idle worker
// would keep a parser's heap alive for the editor's whole life.

import type { OoxmlPackageResult } from '../store/package/ooxml-package.ts';
import {
  parsedDocumentRead,
  receiveParsedDocumentInSlices,
  type ParseReply,
  type ParseRequest,
} from '../store/package/parsed-document.ts';
import { hostTimers, hostWindowOf } from './host-realm.ts';
import { queueTask } from './sliced-steps.ts';

/**
 * Whether the editor reads large documents on a Web Worker: `true` for the worker this package
 * ships, or a function that creates one, for hosts whose bundler or content security policy
 * needs to say where the worker comes from.
 */
export type ParseInWorkerOption = boolean | (() => Worker);

/**
 * How long the open waits for a worker before it reads the bytes on the page. A real read
 * answers long before this; the limit is for a worker that never starts or never answers.
 */
export const PARSE_WORKER_TIMEOUT_MS = 30_000;

/** Reads packages on workers for one editor. */
export interface OffThreadParser {
  /** The read of `bytes`, or null when a worker could not produce one. Never rejects. */
  read(bytes: Uint8Array): Promise<OoxmlPackageResult | null>;
  /** Stop every read in flight. Their promises answer null at once. */
  cancel(): void;
}

/**
 * The worker this package ships. The expression is the one bundlers recognise to emit the
 * worker file and rewrite its URL, so it must stay literal; see `harfbuzz-wasm-binary.ts` for
 * the same convention on the shaping binary. In source it names the worker's source, which a
 * host compiling core's sources bundles as it is; the package build rewrites it to the emitted
 * `./parse.js` beside this module (`parseWorkerUrl` in `tsup.config.ts`). Where a bundler
 * leaves it alone, the request for the file fails and the open reads on the page.
 */
function shippedParseWorker(): Worker {
  return new Worker(new URL('../parse/worker.ts', import.meta.url), { type: 'module' });
}

/** Null when `option` is off, or when this environment has no workers. Paced by `node`'s window. */
export function createOffThreadParser(
  option: ParseInWorkerOption | undefined,
  node: () => Node | null
): OffThreadParser | null {
  if (!option) return null;
  if (option === true && typeof Worker !== 'function') return null;
  const create = option === true ? shippedParseWorker : option;
  const inFlight = new Set<() => void>();
  let nextId = 0;
  return {
    read(bytes) {
      return new Promise((resolve) => {
        let worker: Worker;
        try {
          worker = create();
        } catch {
          resolve(null);
          return;
        }
        const id = ++nextId;
        const clock = hostTimers(node);
        let settled = false;
        const finish = (read: OoxmlPackageResult | null): void => {
          if (settled) return;
          settled = true;
          inFlight.delete(stop);
          clock.clearTimeout(timeout);
          worker.terminate();
          resolve(read);
        };
        const stop = (): void => finish(null);
        inFlight.add(stop);
        const timeout = clock.setTimeout(stop, PARSE_WORKER_TIMEOUT_MS);
        worker.onerror = (event) => {
          // Handled: the open continues on the page, so the host's console stays clean.
          event.preventDefault();
          stop();
        };
        worker.onmessageerror = stop;
        worker.onmessage = (event: MessageEvent<unknown>) => {
          const reply = event.data as Partial<ParseReply> | null;
          if (reply?.id !== id || !reply.parsed) {
            stop();
            return;
          }
          const parsed = reply.parsed;
          // The worker is done; the rebuild runs here, in short tasks between input and paint.
          worker.terminate();
          clock.clearTimeout(timeout);
          // A cancelled read stops rebuilding at its next slice rather than finishing unseen.
          const yieldToHost = (): Promise<void> =>
            settled
              ? Promise.reject(new Error('cancelled'))
              : new Promise((next) => queueTask(next, hostWindowOf(node())));
          receiveParsedDocumentInSlices(parsed, { yieldToHost }).then(
            (received) => finish(received && !settled ? parsedDocumentRead(received) : null),
            stop
          );
        };
        // A copy: the editor keeps its bytes, and the copy's buffer moves rather than clones.
        const copy = bytes.slice();
        const request: ParseRequest = { id, bytes: copy };
        try {
          worker.postMessage(request, [copy.buffer]);
        } catch {
          stop();
        }
      });
    },
    cancel() {
      for (const stop of [...inFlight]) stop();
    },
  };
}
