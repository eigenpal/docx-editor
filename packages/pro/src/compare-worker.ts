/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * The compare worker: `@docx-editor.dev/pro/compare-worker`. Start it as a module worker and
 * pass it to `reviewModule({ compareWorker })`. It runs the compare that the Compare documents
 * dialog asks for, off the page's main thread. It has no exports.
 *
 * @packageDocumentation
 */
import { readOoxmlPackage } from '@docx-editor.dev/core/store';
import { comparePackages } from './compare/compare-documents.ts';
import {
  COMPARE_WORKER_PROTOCOL,
  isCompareRequest,
  ownProtocol,
  type CompareWorkerMessage,
  type CompareWorkerRequest,
} from './compare/worker-protocol.ts';

interface WorkerScope {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: CompareWorkerMessage, transfer?: Transferable[]): void;
}

const scope = globalThis as unknown as WorkerScope;

function run(request: CompareWorkerRequest): CompareWorkerMessage {
  const base = readOoxmlPackage(request.original);
  if (!base.ok) {
    return result({
      ok: false,
      code: 'invalidOriginal',
      message: `The original document cannot be read (${base.reason}).`,
    });
  }
  const revised = readOoxmlPackage(request.revised);
  if (!revised.ok) {
    return result({
      ok: false,
      code: 'invalidRevised',
      message: `The revised document cannot be read (${revised.reason}).`,
    });
  }
  const compared = comparePackages(
    base.package,
    revised.package,
    request.options,
    false,
    (phase, fraction) =>
      scope.postMessage({ protocol: COMPARE_WORKER_PROTOCOL, type: 'progress', phase, fraction })
  );
  if (!compared.ok) return result(compared);
  return result({
    ok: true,
    bytes: compared.changed ? compared.bytes : null,
    revisionCount: compared.revisionCount,
    changed: compared.changed,
  });
}

const result = (value: Extract<CompareWorkerMessage, { type: 'result' }>['result']) =>
  ({ protocol: COMPARE_WORKER_PROTOCOL, type: 'result', result: value }) as const;

scope.onmessage = (event) => {
  // Messages of other code that shares the worker get no answer.
  if (!ownProtocol(event.data)) return;
  if (!isCompareRequest(event.data)) {
    scope.postMessage({
      protocol: COMPARE_WORKER_PROTOCOL,
      type: 'error',
      message: 'The compare request is malformed.',
    });
    return;
  }
  scope.postMessage({
    protocol: COMPARE_WORKER_PROTOCOL,
    type: 'progress',
    phase: 'reading',
    fraction: 0,
  });
  let message: CompareWorkerMessage;
  try {
    message = run(event.data);
  } catch (error) {
    message = {
      protocol: COMPARE_WORKER_PROTOCOL,
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    };
  }
  const bytes = message.type === 'result' && message.result.ok ? message.result.bytes : null;
  scope.postMessage(message, bytes ? [bytes.buffer as ArrayBuffer] : []);
};
