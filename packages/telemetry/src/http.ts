/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/telemetry/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

/**
 * Sending telemetry to your own HTTP endpoint from a browser, and reading the browser's privacy
 * signals. No dependency: `fetch`, `sendBeacon`, and `localStorage` only.
 */
import type { TelemetryEvent, TelemetryExporter } from './pipeline.ts';

/** Options for {@link httpExporter}. @public */
export interface HttpExporterOptions {
  /**
   * Where to POST. Use a route on your own origin, which then forwards to your log service, so
   * the service's token never reaches the browser. See `@docx-editor.dev/telemetry/ingest`.
   */
  readonly url: string;
  /** Events per request. Defaults to 20. A full batch is sent at once. */
  readonly batchSize?: number;
  /** How long an event waits for its batch to fill, in milliseconds. Defaults to 10 000. */
  readonly flushIntervalMs?: number;
  /**
   * Extra request headers. A browser cannot set headers on `sendBeacon`, so with headers, a
   * batch sent while the page closes uses `fetch` with `keepalive` instead.
   */
  readonly headers?: Readonly<Record<string, string>>;
  /** Called when a request fails. Telemetry never throws into your app. */
  readonly onError?: (error: unknown) => void;
}

/** `sendBeacon` and `keepalive` both refuse bodies above 64 KiB; stay well below. */
const MAX_BODY_BYTES = 60 * 1024;

/**
 * Batch events and POST them as a JSON array to your own endpoint. Events wait up to
 * `flushIntervalMs` for a batch of `batchSize`. When the page is hidden, the telemetry client
 * flushes, and the batch goes out with `sendBeacon`, which still delivers while the page closes.
 *
 * @example
 * ```ts
 * import { createTelemetry, httpExporter } from '@docx-editor.dev/telemetry';
 *
 * export const telemetry = createTelemetry({
 *   exporters: [httpExporter({ url: '/api/telemetry' })],
 *   include: { documentOpen: true, editing: true, trackedChanges: true, performance: true },
 * });
 * ```
 *
 * @public
 */
export function httpExporter(options: HttpExporterOptions): TelemetryExporter {
  const batchSize = Math.max(1, options.batchSize ?? 20);
  const intervalMs = options.flushIntervalMs ?? 10_000;
  let queue: TelemetryEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pending = new Set<Promise<void>>();

  const post = (body: string, closing: boolean): void => {
    const beacon = (globalThis as { navigator?: Navigator }).navigator;
    if (closing && !options.headers && typeof beacon?.sendBeacon === 'function') {
      try {
        if (beacon.sendBeacon(options.url, new Blob([body], { type: 'application/json' }))) return;
      } catch {
        // Fall through to fetch.
      }
    }
    if (typeof fetch !== 'function') return;
    const request = fetch(options.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...options.headers },
      body,
      keepalive: true,
    })
      .then((response) => {
        if (!response.ok) throw new Error(`telemetry endpoint answered ${response.status}`);
      })
      .catch((error: unknown) => options.onError?.(error))
      .finally(() => pending.delete(request));
    pending.add(request);
  };

  /** Send everything queued, in batches that stay under the browser's body limit. */
  const drain = (closing: boolean): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    while (queue.length) {
      let take = Math.min(batchSize, queue.length);
      let body = JSON.stringify(queue.slice(0, take));
      while (take > 1 && body.length > MAX_BODY_BYTES) {
        take = Math.ceil(take / 2);
        body = JSON.stringify(queue.slice(0, take));
      }
      queue = queue.slice(take);
      // One event over the limit is not telemetry this package produces: drop it.
      if (body.length <= MAX_BODY_BYTES) post(body, closing);
    }
  };

  return {
    name: 'http',
    event(event) {
      queue.push(event);
      if (queue.length >= batchSize) drain(false);
      else if (timer === undefined) {
        timer = setTimeout(() => drain(false), intervalMs);
        (timer as { unref?: () => void }).unref?.();
      }
    },
    async flush() {
      drain(true);
      await Promise.all(pending);
    },
    async shutdown() {
      drain(true);
      await Promise.all(pending);
    },
  };
}

/** Options for {@link browserPrivacySignals}. @public */
export interface BrowserPrivacySignalsOptions {
  /**
   * A `localStorage` key that opts the visitor out when its value is `off`, such as one your
   * privacy settings page writes. Omit it to read only the browser signals.
   */
  readonly optOutKey?: string;
}

/**
 * A `consent` function that follows the browser's privacy signals: it returns `false` when the
 * visitor sends Global Privacy Control or Do Not Track, or when `optOutKey` is set to `off`.
 * On a server, it returns `false`. Combine it with your consent manager when you have one.
 *
 * @example
 * ```ts
 * import { browserPrivacySignals, createTelemetry } from '@docx-editor.dev/telemetry';
 *
 * const privacy = browserPrivacySignals({ optOutKey: 'my-app:telemetry' });
 * export const telemetry = createTelemetry({
 *   exporters: [],
 *   consent: () => privacy() && consentManager.analytics,
 * });
 * ```
 *
 * @public
 */
export function browserPrivacySignals(options: BrowserPrivacySignalsOptions = {}): () => boolean {
  return () => {
    const browser = (globalThis as { navigator?: Navigator & { globalPrivacyControl?: boolean } })
      .navigator;
    if (!browser) return false;
    if (browser.globalPrivacyControl === true || browser.doNotTrack === '1') return false;
    if (!options.optOutKey) return true;
    try {
      return globalThis.localStorage?.getItem(options.optOutKey) !== 'off';
    } catch {
      return true;
    }
  };
}
