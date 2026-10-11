/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/telemetry/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

/**
 * Sentry: actionable failures become issues grouped by code; everything else becomes a
 * breadcrumb, so it appears beside your own errors without using your event quota.
 *
 * @packageDocumentation
 */
import { describeEvent } from '../exporters.ts';
import type { TelemetryEvent, TelemetryExporter } from '../pipeline.ts';

/** Sentry severity, as the Sentry SDKs spell it. @public */
export type SentrySeverity = 'fatal' | 'error' | 'warning' | 'info' | 'debug';

/**
 * The part of a Sentry SDK the exporter uses. `@sentry/browser`, `@sentry/react`,
 * `@sentry/vue`, `@sentry/nextjs`, and `@sentry/node` all fit: pass the module itself.
 *
 * @public
 */
export interface SentryLike {
  captureException(
    exception: unknown,
    context?: {
      readonly fingerprint?: string[];
      readonly level?: SentrySeverity;
      readonly tags?: Record<string, string>;
      readonly contexts?: Record<string, Record<string, unknown>>;
    }
  ): unknown;
  addBreadcrumb(breadcrumb: {
    readonly category?: string;
    readonly message?: string;
    readonly level?: SentrySeverity;
    readonly data?: Record<string, unknown>;
  }): void;
  /** Send queued events. Called when the page is hidden. */
  flush?(timeout?: number): PromiseLike<boolean>;
}

/** Options for {@link sentryExporter}. @public */
export interface SentryExporterOptions {
  /**
   * Which events become Sentry issues. The rest become breadcrumbs. The default sends an issue
   * for a refused open, a collaboration error that will not heal, a text shaper that did not
   * load, and an engine invariant. Those need an action; a refused keystroke does not.
   */
  readonly issue?: (event: TelemetryEvent) => boolean;
  /** Record breadcrumbs for the other events. Defaults to `true`. */
  readonly breadcrumbs?: boolean;
}

/**
 * The error a Sentry issue is made from. The message is the code, so issues group by cause,
 * and the stack trace contains no document data.
 *
 * @public
 */
export class DocxEditorDiagnosticError extends Error {
  override readonly name = 'DocxEditorDiagnosticError';
  readonly code: string;
  constructor(code: string, hint?: string) {
    super(hint ? `${code}: ${hint}` : code);
    this.code = code;
  }
}

/** The default issue rule. @public */
export function isSentryIssue(event: TelemetryEvent): boolean {
  switch (event.kind) {
    case 'document.open':
      return event.outcome === 'rejected';
    case 'edit.rejected':
      return event.code === 'edit.internal-invariant';
    case 'font.failed':
      return event.code === 'font.shaper-unavailable';
    case 'collab.status':
      return event.status === 'error' && !event.recovering;
    default:
      return false;
  }
}

function codeOf(event: TelemetryEvent): string {
  return 'code' in event && event.code ? event.code : event.kind;
}

function tagsOf(event: TelemetryEvent): Record<string, string> {
  const fields = event as unknown as Record<string, unknown>;
  const tags: Record<string, string> = {
    'docx_editor.kind': event.kind,
    'docx_editor.code': codeOf(event),
    'docx_editor.version': event.engineVersion,
  };
  for (const key of ['origin', 'tracked', 'status', 'outcome'])
    if (fields[key] !== undefined) tags[`docx_editor.${key}`] = String(fields[key]);
  return tags;
}

/** The event without its resource block, as Sentry context data. */
function dataOf(event: TelemetryEvent): Record<string, unknown> {
  const { resource, ...rest } = event as TelemetryEvent & Record<string, unknown>;
  return { ...rest, ...(Object.keys(resource).length ? { resource } : {}) };
}

/**
 * Send diagnostics to Sentry.
 *
 * Sentry Session Replay records the page, and the page shows the document. Mask the editor in
 * Replay: `Sentry.replayIntegration({ mask: ['.docx-editor'] })`.
 *
 * @example
 * ```ts
 * import * as Sentry from '@sentry/react';
 * import { createTelemetry } from '@docx-editor.dev/telemetry';
 * import { sentryExporter } from '@docx-editor.dev/telemetry/sentry';
 *
 * export const telemetry = createTelemetry({ exporters: [sentryExporter(Sentry)] });
 * ```
 *
 * @public
 */
export function sentryExporter(
  sentry: SentryLike,
  options: SentryExporterOptions = {}
): TelemetryExporter {
  const issue = options.issue ?? isSentryIssue;
  const breadcrumbs = options.breadcrumbs ?? true;
  return {
    name: 'sentry',
    event(event) {
      const code = codeOf(event);
      // A deduplication summary repeats an event already sent: never a second issue.
      if (event.repeated === undefined && issue(event)) {
        sentry.captureException(new DocxEditorDiagnosticError(code, event.hint), {
          fingerprint: ['docx-editor', event.kind, code],
          level: event.kind === 'font.failed' ? 'warning' : 'error',
          tags: tagsOf(event),
          contexts: { docx_editor: dataOf(event) },
        });
        return;
      }
      if (!breadcrumbs) return;
      sentry.addBreadcrumb({
        category: 'docx-editor',
        message: describeEvent(event),
        level: event.kind === 'document.open' && event.outcome === 'opened' ? 'info' : 'warning',
        data: dataOf(event),
      });
    },
    async flush() {
      await sentry.flush?.(2_000);
    },
  };
}

export type { TelemetryEvent, TelemetryExporter } from '../pipeline.ts';
