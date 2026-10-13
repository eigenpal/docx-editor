/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/telemetry/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

/**
 * Sending telemetry to your own HTTP endpoint from a browser, and reading the browser's privacy
 * signals. No dependency: `fetch`, `sendBeacon`, and `localStorage` only.
 */
import type { TelemetryEvent, TelemetryExporter, TelemetryExporterContext } from './pipeline.ts';

/** Options for {@link httpExporter}. @public */
export interface HttpExporterOptions {
  /**
   * Where to POST. Use a route on your own origin, which then forwards to your log service, so
   * the service's token never reaches the browser. See `@docx-editor.dev/telemetry/ingest`.
   */
  readonly url: string;
  /**
   * Events per request, from 1 to 50. Defaults to 20. A full batch is sent at once. The limit
   * matches the default `maxEvents` of `telemetryRoute`, which refuses a longer list.
   */
  readonly batchSize?: number;
  /** How long an event waits for its batch to fill, in milliseconds. Defaults to 10 000. */
  readonly flushIntervalMs?: number;
  /**
   * Extra request headers. A browser cannot set headers on `sendBeacon`, so with headers, the
   * batches sent while the page closes use `fetch` with `keepalive` instead.
   */
  readonly headers?: Readonly<Record<string, string>>;
  /**
   * Called when a request fails, or when batches are dropped because the page closed with more
   * than the browser lets it send. Telemetry never throws into your app.
   */
  readonly onError?: (error: unknown) => void;
}

/**
 * The bytes the browser lets a closing page send, across all its `sendBeacon` and `keepalive`
 * requests together: 64 KiB in the Fetch Standard. Stay below it.
 */
const CLOSING_BUDGET_BYTES = 60 * 1024;

/** The default `maxEvents` of `telemetryRoute`: a larger batch would be refused whole. */
const MAX_BATCH_SIZE = 50;

const encoder = new TextEncoder();
const byteLength = (text: string): number => encoder.encode(text).byteLength;

/**
 * Batch events and POST them as a JSON array to your own endpoint.
 *
 * While the page is open, events wait up to `flushIntervalMs` for a batch of `batchSize`, and
 * each batch goes out with an ordinary `fetch`; so does a `telemetry.flush()` you call. When the
 * page is hidden or closes, everything waiting goes out with `sendBeacon`. A closing page may
 * send only about 64 KiB in all, so delivery while closing is best effort: batches beyond that
 * are dropped and reported to `onError`. If consent is withdrawn, events still waiting are
 * discarded.
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
  const batchSize = Math.min(MAX_BATCH_SIZE, Math.max(1, Math.floor(options.batchSize ?? 20)));
  const intervalMs = options.flushIntervalMs ?? 10_000;
  let queue: TelemetryEvent[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let context: TelemetryExporterContext | undefined;
  const pending = new Set<Promise<void>>();

  const failed = (error: unknown): void => {
    try {
      options.onError?.(error);
    } catch {
      /* an observer must never break the app it observes */
    }
  };

  /** A batch while the page is open: an ordinary request, with no shared size budget. */
  const post = (body: string, keepalive: boolean): void => {
    if (typeof fetch !== 'function') return;
    const request = fetch(options.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...options.headers },
      body,
      keepalive,
    })
      .then((response) => {
        if (!response.ok) throw new Error(`telemetry endpoint answered ${response.status}`);
      })
      .catch(failed)
      .finally(() => pending.delete(request));
    pending.add(request);
  };

  /** A batch while the page closes: `sendBeacon`, or `fetch` with `keepalive` as a fallback. */
  const postClosing = (body: string): void => {
    const browser = (globalThis as { navigator?: Navigator }).navigator;
    if (!options.headers && typeof browser?.sendBeacon === 'function') {
      try {
        if (browser.sendBeacon(options.url, new Blob([body], { type: 'application/json' }))) return;
      } catch {
        // Fall through to fetch.
      }
    }
    post(body, true);
  };

  /** The next batch from the queue, split until it fits in `limit` bytes. */
  const nextBatch = (limit: number): { body: string; bytes: number; count: number } | null => {
    let count = Math.min(batchSize, queue.length);
    while (count > 0) {
      const body = JSON.stringify(queue.slice(0, count));
      const bytes = byteLength(body);
      if (bytes <= limit) return { body, bytes, count };
      if (count === 1) return null;
      count = Math.ceil(count / 2);
    }
    return null;
  };

  /**
   * Bytes sent since the page was last hidden. The browser's limit covers all of them; a page that
   * becomes visible again starts a new period, because what it sent before has been delivered.
   */
  let closingSent = 0;
  let wasClosing = false;

  const drain = (closing: boolean): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    // Consent can be withdrawn while events wait: they are discarded, never sent.
    if (context && !context.consented()) {
      queue = [];
      return;
    }
    if (!closing || !wasClosing) closingSent = 0;
    wasClosing = closing;
    let dropped = 0;
    while (queue.length) {
      const batch = nextBatch(CLOSING_BUDGET_BYTES - (closing ? closingSent : 0));
      if (!batch) {
        // Too large for what remains of the budget, or one event too large to send at all.
        dropped += closing ? queue.length : 1;
        queue = closing ? [] : queue.slice(1);
        continue;
      }
      queue = queue.slice(batch.count);
      if (closing) {
        closingSent += batch.bytes;
        postClosing(batch.body);
      } else post(batch.body, false);
    }
    if (dropped) failed(new Error(`telemetry dropped ${dropped} events that did not fit`));
  };

  /** Whether the page is hidden or closing now, so a send must survive it. */
  const closing = (): boolean => {
    const now = context?.pageClosing() ?? false;
    if (!now) wasClosing = false;
    return now;
  };
  // A page shown again starts a new hidden period, even when nothing was sent while it showed.
  const page = globalThis.document as Document | undefined;
  const onVisibility = () => {
    if (page?.visibilityState === 'visible') wasClosing = false;
  };
  const stopWatching = () => page?.removeEventListener?.('visibilitychange', onVisibility);

  return {
    name: 'http',
    attach(attached) {
      context = attached;
      page?.addEventListener?.('visibilitychange', onVisibility);
    },
    event(event) {
      queue.push(event);
      if (queue.length >= batchSize) drain(closing());
      else if (timer === undefined) {
        timer = setTimeout(() => drain(closing()), intervalMs);
        (timer as { unref?: () => void }).unref?.();
      }
    },
    async flush() {
      drain(closing());
      await Promise.all(pending);
    },
    async shutdown() {
      stopWatching();
      drain(closing());
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
 * Outside a browser page, such as during server rendering, it returns `false`. Combine it with
 * your consent manager when you have one.
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
    const page = globalThis as {
      window?: unknown;
      document?: unknown;
      navigator?: Navigator & { globalPrivacyControl?: boolean };
    };
    // Bun and Node have a `navigator` but no page: no visitor to ask, so no consent.
    if (!page.window || !page.document || !page.navigator) return false;
    if (page.navigator.globalPrivacyControl === true || page.navigator.doNotTrack === '1')
      return false;
    if (!options.optOutKey) return true;
    try {
      return globalThis.localStorage?.getItem(options.optOutKey) !== 'off';
    } catch {
      return true;
    }
  };
}
