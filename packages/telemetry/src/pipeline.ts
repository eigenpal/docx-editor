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
import type { MetricDefinition } from './metrics.ts';

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
  /** Send anything buffered. Called by `flush()` and when a page is hidden. */
  flush?(): void | Promise<void>;
  /** Flush and release resources. Called by `shutdown()`. */
  shutdown?(): void | Promise<void>;
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
}

declare const __DOCX_EDITOR_TELEMETRY_VERSION__: string | undefined;

/** The version of the editor packages, or `'development'` when running from source. @public */
export const ENGINE_VERSION: string =
  typeof __DOCX_EDITOR_TELEMETRY_VERSION__ === 'string'
    ? __DOCX_EDITOR_TELEMETRY_VERSION__
    : 'development';

export interface Pipeline {
  readonly resource: Attributes;
  event(event: TelemetryEvent): void;
  metric(definition: MetricDefinition, value: number, attributes?: Attributes): void;
  flush(): Promise<void>;
  shutdown(): Promise<void>;
}

/** One delivery path for a set of exporters. */
export function createPipeline(options: TelemetryPipelineOptions): Pipeline {
  const exporters = [...options.exporters];
  const resource = Object.freeze({ ...checkAttributes(options.resource ?? {}, 'resource') });
  const reported = new Set<string>();
  let closed = false;

  function report(error: unknown, exporter: string): void {
    if (reported.has(exporter)) return;
    reported.add(exporter);
    try {
      if (options.onExporterError) options.onExporterError(error, exporter);
      else console.warn(`[docx-editor telemetry] exporter "${exporter}" failed`, error);
    } catch {
      /* the host's reporting problem */
    }
  }

  function consented(): boolean {
    if (closed) return false;
    const consent = options.consent ?? true;
    if (typeof consent === 'boolean') return consent;
    try {
      return consent() === true;
    } catch {
      return false;
    }
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
    event(event) {
      if (!consented()) return;
      const checked = checkEvent(event);
      if (!checked) return;
      for (const exporter of exporters) {
        if (!exporter.event) continue;
        try {
          exporter.event(checked);
        } catch (error) {
          report(error, exporter.name);
        }
      }
    },
    metric(definition, value, attributes = {}) {
      if (!consented() || !Number.isFinite(value)) return;
      const record: MetricRecord = {
        definition,
        value,
        attributes: checkAttributes(attributes, definition.name, definition.labels),
      };
      for (const exporter of exporters) {
        if (!exporter.metric) continue;
        try {
          exporter.metric(record);
        } catch (error) {
          report(error, exporter.name);
        }
      }
    },
    flush: () => each((exporter) => exporter.flush?.()),
    async shutdown() {
      if (closed) return;
      closed = true;
      await each((exporter) => exporter.shutdown?.() ?? exporter.flush?.());
    },
  };
}
