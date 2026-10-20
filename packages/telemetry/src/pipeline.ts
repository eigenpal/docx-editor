/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/telemetry/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

/**
 * The shared delivery path: consent, the anonymity guard, and exporters that can never throw
 * into the code they observe. The editor client and the room server both send through it.
 */
import type { EditorDiagnostic } from '@docx-editor.dev/core';
import { checkAttributes, checkEvent } from './anonymous.ts';
import { METRICS, type MetricDefinition } from './metrics.ts';

/** A metric attribute or a resource value. @public */
export type AttributeValue = string | number | boolean;

/** Attributes or resource values, keyed by name. @public */
export type Attributes = Readonly<Record<string, AttributeValue>>;

/** Context the package adds to every diagnostic before it reaches an exporter. @public */
export interface TelemetryEventContext {
  /** The fixed hint for the event's code. A constant, never document content. */
  readonly hint?: string;
  /** The documentation section for the event's code. */
  readonly docs?: string;
  /** The version of the editor packages. Core and this package release together. */
  readonly engineVersion: string;
  /**
   * Present only on a summary: the event that closes a deduplication window repeats the first
   * one, with the number of identical events folded into it beyond the first. Count it, do not
   * treat it as a new failure. Its `time` is the first event's. The Sentry exporter records
   * summaries as breadcrumbs.
   */
  readonly repeated?: number;
  /**
   * The host's own values from `createTelemetry({ resource })`, such as `service.name`. The
   * host decides what goes here, and every event carries it.
   */
  readonly resource: Attributes;
  /**
   * Your identifiers for this event: the client's `attributes`, then the values of the
   * `moduleFor` module of the editor that sent it, such as a room, a document, or a user.
   * Empty when you set none. The engine never adds a value here.
   */
  readonly attributes: Attributes;
}

/** A diagnostic as an exporter receives it. Switch on `kind` to narrow it. @public */
export type TelemetryEvent = EditorDiagnostic & TelemetryEventContext;

/** One metric measurement. @public */
export interface MetricRecord {
  readonly definition: MetricDefinition;
  /** A counter increment, a gauge value, or a histogram sample, in the metric's unit. */
  readonly value: number;
  readonly attributes: Attributes;
}

/**
 * Where telemetry goes. Implement `event`, `metric`, or both.
 *
 * An exporter never throws into the editor or the server: a failure is caught and reported
 * once through `onExporterError`.
 *
 * @example
 * ```ts
 * const toMyLogger: TelemetryExporter = {
 *   name: 'my-logger',
 *   event: (event) => myLogger.warn(event.kind, { code: 'code' in event ? event.code : undefined }),
 * };
 * ```
 *
 * @public
 */
export interface TelemetryExporter {
  /** Shown in `onExporterError` reports. */
  readonly name: string;
  event?(event: TelemetryEvent): void;
  metric?(record: MetricRecord): void;
  /**
   * Drop a series that no longer exists, such as a closed room's per-room gauge. Optional:
   * an exporter without it keeps the series until it expires on its own.
   */
  forget?(definition: MetricDefinition, attributes: Attributes): void;
  /**
   * Start a series at zero before its first measurement. A scraper that sees a counter first
   * at 1 cannot count that first increase, so the room server declares its known series when
   * it starts. Optional: an exporter without it creates each series at its first measurement.
   */
  declare?(definition: MetricDefinition, attributes: Attributes): void;
  /** Send anything buffered. Called by `flush()` and when a page is hidden. */
  flush?(): void | Promise<void>;
  /** Flush and release resources. Called by `shutdown()`. */
  shutdown?(): void | Promise<void>;
  /**
   * Called once when a telemetry client or room server takes the exporter. An exporter that
   * holds events, such as a batching one, reads `consented()` before it sends, so events queued
   * before consent was withdrawn are discarded, not sent.
   */
  attach?(context: TelemetryExporterContext): void;
}

/** What a telemetry client tells an exporter it takes. @public */
export interface TelemetryExporterContext {
  /** Whether the host's consent is given, read now. */
  consented(): boolean;
  /**
   * Whether the page is hidden or closing, read now. While it is, a browser exporter sends with
   * `sendBeacon` or `keepalive`, which still deliver after the page goes away.
   */
  pageClosing(): boolean;
}

/** Options shared by the editor client and the room server. @public */
export interface TelemetryPipelineOptions {
  /** Where telemetry goes. Nothing is recorded or sent without at least one exporter. */
  readonly exporters: readonly TelemetryExporter[];
  /**
   * Whether the viewer agreed to telemetry. Read before each event and metric, so a consent
   * banner can change it at any time. Events before consent are dropped, not buffered.
   * Defaults to `true`: without this option, events are sent. Pass it whenever your app asks
   * for consent.
   *
   * @example
   * ```ts
   * consent: () => window.cookieConsent?.analytics === true
   * ```
   */
  readonly consent?: boolean | (() => boolean);
  /**
   * Values added to every event, such as `{ 'service.name': 'contracts-app' }`. Metrics do not
   * carry them: set resource attributes on your OpenTelemetry SDK or Prometheus target instead.
   * You own these values: do not put a user, a document, or a room name here.
   */
  readonly resource?: Attributes;
  /** Told once per exporter when it throws. Defaults to one `console.warn`. */
  readonly onExporterError?: (error: unknown, exporter: string) => void;
  /**
   * Keys of your own attributes that may also label metrics, such as `tenant.tier` or
   * `app.region`. Only for values with few distinct values: each value makes a new series.
   * After {@link MAX_METRIC_LABEL_VALUES} distinct values of one key, later values become
   * `other`. Never list a user, document, or room id here; put those on events instead.
   */
  readonly metricLabels?: readonly string[];
}

/** Distinct values one of your metric labels may take before later values become `other`. @public */
export const MAX_METRIC_LABEL_VALUES = 50;

declare const __DOCX_EDITOR_TELEMETRY_VERSION__: string | undefined;

/** The version of the editor packages, or `'development'` when running from source. @public */
export const ENGINE_VERSION: string =
  typeof __DOCX_EDITOR_TELEMETRY_VERSION__ === 'string'
    ? __DOCX_EDITOR_TELEMETRY_VERSION__
    : 'development';

export interface Pipeline {
  readonly resource: Attributes;
  /** Whether consent is given and the pipeline is open, read now. */
  consented(): boolean;
  event(event: TelemetryEvent): void;
  metric(definition: MetricDefinition, value: number, attributes?: Attributes): void;
  forget(definition: MetricDefinition, attributes: Attributes): void;
  declare(definition: MetricDefinition, attributes?: Attributes): void;
  flush(): Promise<void>;
  shutdown(): Promise<void>;
  /** Mark the page as hidden or closing, or as visible again. */
  setPageClosing(closing: boolean): void;
}

/** One delivery path for a set of exporters. */
export function createPipeline(options: TelemetryPipelineOptions): Pipeline {
  const exporters = [...options.exporters];
  const resource = Object.freeze({ ...checkAttributes(options.resource ?? {}, 'resource') });
  const hostLabels = [...(options.metricLabels ?? [])];
  const seenValues = new Map<string, Set<string>>();
  const reported = new Set<string>();

  /** Your labels, bounded: a value beyond the cap for its key becomes `other`. */
  function boundHostLabels(attributes: Attributes): Attributes {
    if (hostLabels.length === 0) return attributes;
    const out: Record<string, AttributeValue> = { ...attributes };
    for (const key of hostLabels) {
      const value = out[key];
      if (value === undefined) continue;
      const text = String(value);
      let seen = seenValues.get(key);
      if (!seen) seenValues.set(key, (seen = new Set()));
      if (!seen.has(text)) {
        if (seen.size >= MAX_METRIC_LABEL_VALUES) {
          out[key] = 'other';
          continue;
        }
        seen.add(text);
      }
    }
    return out;
  }
  let closed = false;

  function report(error: unknown, exporter: string): void {
    if (reported.has(exporter)) return;
    reported.add(exporter);
    try {
      if (options.onExporterError) {
        const result: unknown = options.onExporterError(error, exporter);
        if (result && typeof (result as PromiseLike<unknown>).then === 'function')
          void Promise.resolve(result).catch(() => {});
      } else console.warn(`[docx-editor telemetry] exporter "${exporter}" failed`, error);
    } catch {
      /* the host's reporting problem */
    }
  }

  /** Contain returned promise rejections without changing exporter-owned buffering. */
  function invoke(exporter: TelemetryExporter, run: () => unknown): void {
    try {
      const result = run();
      if (!result || typeof (result as PromiseLike<unknown>).then !== 'function') return;
      void Promise.resolve(result).then(undefined, (error) => report(error, exporter.name));
    } catch (error) {
      report(error, exporter.name);
    }
  }

  /** The host's consent only. A closed pipeline still lets exporters send what they hold. */
  function consentGiven(): boolean {
    const consent = options.consent ?? true;
    if (typeof consent === 'boolean') return consent;
    try {
      return consent() === true;
    } catch {
      return false;
    }
  }
  function consented(): boolean {
    return !closed && consentGiven();
  }
  let pageClosing = false;
  // The document state too: the engine's own hide listeners send their last summaries before the
  // window's listener, which sets the flag, runs.
  const isPageClosing = (): boolean =>
    pageClosing || globalThis.document?.visibilityState === 'hidden';
  for (const exporter of exporters) {
    invoke(exporter, () =>
      exporter.attach?.({ consented: consentGiven, pageClosing: isPageClosing })
    );
  }

  async function each(step: (exporter: TelemetryExporter) => void | Promise<void>) {
    await Promise.all(
      exporters.map(async (exporter) => {
        try {
          await step(exporter);
        } catch (error) {
          report(error, exporter.name);
        }
      })
    );
  }

  return {
    resource,
    consented,
    event(event) {
      if (!consented()) return;
      const checked = checkEvent(event);
      if ('dropped' in checked) {
        // Counted even in production, where the guard does not warn: a version mismatch
        // between core and telemetry shows up here instead of as silence.
        this.metric(METRICS.droppedEvents, 1, { reason: checked.dropped });
        return;
      }
      for (const exporter of exporters) {
        if (!exporter.event) continue;
        invoke(exporter, () => exporter.event!(checked.event));
      }
    },
    metric(definition, value, attributes = {}) {
      if (!consented() || !Number.isFinite(value)) return;
      const record: MetricRecord = {
        definition,
        value,
        attributes: boundHostLabels(
          checkAttributes(attributes, definition.name, [...definition.labels, ...hostLabels])
        ),
      };
      for (const exporter of exporters) {
        if (!exporter.metric) continue;
        invoke(exporter, () => exporter.metric!(record));
      }
    },
    forget(definition, attributes) {
      const checked = checkAttributes(attributes, definition.name, definition.labels);
      for (const exporter of exporters) {
        if (!exporter.forget) continue;
        invoke(exporter, () => exporter.forget!(definition, checked));
      }
    },
    declare(definition, attributes = {}) {
      if (!consented()) return;
      const labels = boundHostLabels(
        checkAttributes(attributes, definition.name, [...definition.labels, ...hostLabels])
      );
      for (const exporter of exporters) {
        if (!exporter.declare) continue;
        invoke(exporter, () => exporter.declare!(definition, labels));
      }
    },
    flush: () => each((exporter) => exporter.flush?.()),
    setPageClosing(closing) {
      pageClosing = closing;
    },
    async shutdown() {
      if (closed) return;
      closed = true;
      await each((exporter) => (exporter.shutdown ? exporter.shutdown() : exporter.flush?.()));
    },
  };
}
