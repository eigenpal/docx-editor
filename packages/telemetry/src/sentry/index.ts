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
   * when the app can act: an open refused because the app passed something wrong or for an
   * unknown reason, a collaboration error that will not heal, a text shaper that did not load,
   * and an engine invariant. A corrupt or oversized file and a refused keystroke are
   * breadcrumbs.
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

const EXPECTED_COLLAB_CODES: ReadonlySet<string> = new Set([
  'collab.authentication-failed',
  'collab.room-generation-changed',
]);

const ACTIONABLE_OPEN_CODES: ReadonlySet<string> = new Set([
  'open.failed',
  'open.unsupported-source',
  'open.invalid-limits',
]);

/**
 * CSS selectors for everything that shows the document: the editor shell and the painted pages.
 * Pass them to Session Replay's `block` option, which replaces the editor with a placeholder, so
 * `mask` is not needed as well.
 *
 * @public
 */
export const EDITOR_SELECTORS: readonly string[] = Object.freeze(['.docx-editor', '.docx-pages']);

/** A Sentry breadcrumb, as `beforeBreadcrumb` receives it. @public */
export interface SentryBreadcrumbLike {
  readonly category?: string;
}

/** The hint Sentry passes with a breadcrumb. For a click or key press, `event` is the DOM event. @public */
export interface SentryBreadcrumbHintLike {
  readonly event?: unknown;
}

/**
 * A `beforeBreadcrumb` filter that drops Sentry's click and key press breadcrumbs from inside the
 * editor. Sentry describes the element a person clicked with its `alt`, `title`, and
 * `aria-label` values. Inside the editor, those values come from the document: picture
 * descriptions, link tooltips, and content control names. A `ui` breadcrumb whose element is
 * unknown is dropped too. Other breadcrumbs pass unchanged.
 *
 * @example
 * ```ts
 * Sentry.init({ dsn, beforeBreadcrumb: dropEditorBreadcrumbs });
 * // With a filter of your own:
 * Sentry.init({
 *   dsn,
 *   beforeBreadcrumb: (crumb, hint) => {
 *     const kept = dropEditorBreadcrumbs(crumb, hint);
 *     return kept && myFilter(kept, hint); // dropped breadcrumbs never reach your filter
 *   },
 * });
 * ```
 *
 * @public
 */
export function dropEditorBreadcrumbs<B extends SentryBreadcrumbLike>(
  breadcrumb: B,
  hint?: SentryBreadcrumbHintLike
): B | null {
  if (!breadcrumb.category?.startsWith('ui.')) return breadcrumb;
  return insideEditor((hint?.event as { target?: unknown } | undefined)?.target)
    ? null
    : breadcrumb;
}

interface ElementLike {
  closest?: (selectors: string) => unknown;
  parentElement?: unknown;
}

/** Whether a DOM event target is inside the editor. An unknown target counts as inside. */
function insideEditor(target: unknown): boolean {
  try {
    let node = target as ElementLike | null | undefined;
    // A text node has no `closest`; its parent element does.
    if (node && typeof node.closest !== 'function') node = node.parentElement as ElementLike;
    if (!node || typeof node.closest !== 'function') return true;
    return node.closest(EDITOR_SELECTORS.join(', ')) != null;
  } catch {
    return true;
  }
}

/**
 * The default issue rule: an open the app caused, an internal error, a shaper that never
 * loaded, and a collaboration error that will not heal become issues. Wrap it to add your own.
 *
 * @example
 * ```ts
 * sentryExporter(Sentry, {
 *   issue: (event) =>
 *     isSentryIssue(event) || ('code' in event && event.code === 'font.load-failed'),
 * });
 * ```
 *
 * @public
 */
export function isSentryIssue(event: TelemetryEvent): boolean {
  switch (event.kind) {
    case 'document.open':
      // A corrupt or oversized file is the file's problem, not the app's: a breadcrumb. These
      // codes say the app passed something wrong, or the engine could not say why.
      return event.outcome === 'rejected' && ACTIONABLE_OPEN_CODES.has(event.code);
    case 'document.save':
      // A save that threw is the engine's defect; one without a document is the app's timing.
      return event.outcome === 'rejected' && event.code === 'save.failed';
    case 'edit.rejected':
      return event.code === 'edit.internal-invariant';
    case 'review.skipped':
      // The engine could not resolve a change it lists: a limit to lift, not a user mistake. An
      // incomplete selection or a change resolved already stays a breadcrumb.
      return (
        event.code === 'review.revision-unsupported' || event.code === 'review.retained-structure'
      );
    case 'font.failed':
      return event.code === 'font.shaper-unavailable';
    case 'collab.status':
      // An expired token and a compacted room are normal: the client rejoins.
      return (
        event.status === 'error' &&
        !event.recovering &&
        !EXPECTED_COLLAB_CODES.has(event.code ?? '')
      );
    default:
      return false;
  }
}

/** An opened or saved document, a session event, or a performance summary that needs no attention. */
function isInformational(event: TelemetryEvent): boolean {
  if (event.kind === 'document.open') return event.outcome === 'opened';
  if (event.kind === 'document.save') return event.outcome === 'saved';
  if (event.kind === 'session') return true;
  return event.kind === 'performance' && event.code === undefined;
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
    'docx_editor.editor_session': event.editorSessionId,
  };
  for (const [key, tag] of [
    ['origin', 'origin'],
    ['tracked', 'tracked'],
    ['status', 'status'],
    ['outcome', 'outcome'],
    ['command', 'command'],
    ['cause', 'cause'],
    ['part', 'part'],
    ['errorName', 'error_name'],
    ['stage', 'stage'],
    ['operation', 'operation'],
    ['changeKind', 'change_kind'],
    ['formattingKind', 'formatting_kind'],
  ] as const)
    if (fields[key] !== undefined) tags[`docx_editor.${tag}`] = String(fields[key]);
  // Your identifiers, such as `room.id` or `user.id`, so issues can be searched by them.
  for (const [key, value] of Object.entries(event.attributes ?? {})) tags[key] = String(value);
  return tags;
}

/**
 * One Sentry issue per distinct defect: the code, then the engine reason and the kind of change,
 * so `open.xml-malformed` from an undeclared prefix and from a parse error are separate issues.
 */
function fingerprintOf(event: TelemetryEvent, code: string): string[] {
  const fields = event as unknown as Record<string, unknown>;
  const detail = ['cause', 'errorName', 'stage', 'changeKind', 'formattingKind']
    .map((key) => fields[key])
    .filter((value): value is string => typeof value === 'string');
  return ['docx-editor', event.kind, code, ...detail];
}

/** The event without its resource block, as Sentry context data. */
function dataOf(event: TelemetryEvent): Record<string, unknown> {
  const { resource, ...rest } = event as TelemetryEvent & Record<string, unknown>;
  return { ...rest, ...(Object.keys(resource).length ? { resource } : {}) };
}

/**
 * Send diagnostics to Sentry.
 *
 * Sentry Session Replay records the page, and the page shows the document. Block the editor in
 * Replay, so neither its text nor its pictures are recorded, and drop the click breadcrumbs that
 * describe its elements: `Sentry.replayIntegration({ block: [...EDITOR_SELECTORS] })` and
 * `beforeBreadcrumb: dropEditorBreadcrumbs`.
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
          fingerprint: fingerprintOf(event, code),
          level:
            event.kind === 'font.failed' || event.kind === 'review.skipped' ? 'warning' : 'error',
          tags: tagsOf(event),
          contexts: { docx_editor: dataOf(event) },
        });
        return;
      }
      if (!breadcrumbs) return;
      sentry.addBreadcrumb({
        category: 'docx-editor',
        message: describeEvent(event),
        level: isInformational(event) ? 'info' : 'warning',
        data: dataOf(event),
      });
    },
    async flush() {
      await sentry.flush?.(2_000);
    },
  };
}

export type { TelemetryEvent, TelemetryExporter } from '../pipeline.ts';
