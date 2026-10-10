/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Hosts the runtime tests drive.
//
// Three kinds, and the distinction matters for what a test is allowed to conclude:
//
// - `openHost` is the REAL headless core host over real bytes. Anything about document
//   behaviour — ordering, atomicity, what a read answers — must be proved against this one.
// - `spyHost` wraps a real host and records the batches that reach it. It changes no answer,
//   so a test can assert "one batch, these operations, in this order" without giving up the
//   real host underneath.
// - `stubHost` implements the PUBLIC `AutomationHost` interface and nothing else. It exists
//   only for the states a real host will not enter on demand: a capability reported false, a
//   refused transaction, a response that disagrees with its request. It is never used to
//   assert document behaviour.

import {
  createServerAutomationHost,
  type AutomationBatchRequest,
  type AutomationBatchResponse,
  type AutomationCapabilities,
  type AutomationChangeEvent,
  type AutomationHost,
  type AutomationSaveResult,
  type AutomationUnsubscribe,
} from '@docx-editor.dev/core/automation';
import { TWO_PARAGRAPHS } from './docx.ts';

export function openHost(bytes: Uint8Array = TWO_PARAGRAPHS): AutomationHost {
  const opened = createServerAutomationHost(bytes);
  if (!opened.ok) throw new Error(`fixture host did not open: ${opened.reason}`);
  return opened.host;
}

export interface HostSpy {
  readonly host: AutomationHost;
  /** Every batch that reached the wrapped host, in order. */
  readonly requests: readonly AutomationBatchRequest[];
  /** Forget what has been seen so far, so a test can measure one phase. */
  reset(): void;
}

export function spyHost(inner: AutomationHost): HostSpy {
  const requests: AutomationBatchRequest[] = [];
  const host: AutomationHost = {
    capabilities: inner.capabilities,
    revision: () => inner.revision(),
    execute(request: AutomationBatchRequest): AutomationBatchResponse {
      requests.push(request);
      return inner.execute(request);
    },
    save: () => inner.save(),
    subscribe: (listener) => inner.subscribe(listener),
    dispose: () => {
      inner.dispose();
    },
  };
  return {
    host,
    requests,
    reset() {
      requests.length = 0;
    },
  };
}

export interface StubHostOptions {
  readonly capabilities?: Partial<AutomationCapabilities>;
  readonly revision?: () => number;
  readonly execute?: (request: AutomationBatchRequest) => AutomationBatchResponse;
  readonly save?: () => AutomationSaveResult;
}

const FULL_CAPABILITIES: AutomationCapabilities = Object.freeze({
  document: true,
  save: true,
  events: true,
  selection: false,
  scrolling: false,
  layout: false,
});

export interface HostStub {
  readonly host: AutomationHost;
  /** How many times the runtime disposed it — `dispose()` must be idempotent upstream. */
  readonly disposals: () => number;
}

export function stubHost(options: StubHostOptions = {}): HostStub {
  const capabilities = Object.freeze({ ...FULL_CAPABILITIES, ...options.capabilities });
  const listeners = new Set<(event: AutomationChangeEvent) => void>();
  let disposals = 0;
  const host: AutomationHost = {
    capabilities,
    revision: () => options.revision?.() ?? 0,
    execute(request: AutomationBatchRequest): AutomationBatchResponse {
      if (options.execute) return options.execute(request);
      return {
        ok: true,
        results: request.operations.map(() => ({
          status: 'ok' as const,
          value: { kind: 'applied' as const },
        })),
        revision: options.revision?.() ?? 0,
        changed: false,
      };
    },
    save: () =>
      options.save?.() ?? {
        ok: false,
        error: { code: 'unsupported-capability', message: 'stub cannot save' },
      },
    subscribe(listener): AutomationUnsubscribe {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      disposals += 1;
      listeners.clear();
    },
  };
  return { host, disposals: () => disposals };
}
