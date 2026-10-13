/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/telemetry/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

/**
 * Receive editor telemetry on your server and forward it to a log service, such as Better Stack,
 * Axiom, or Datadog Logs. Pair it with `httpExporter` in the browser: the browser posts to your
 * route, and only your server holds the log service's token.
 *
 * Anyone can POST to a public route, so every event is checked again with the same closed lists
 * the browser used. No dependency: Fetch API `Request` and `Response` only, so it runs in
 * Next.js route handlers, Hono, Bun, Deno, and Cloudflare Workers.
 *
 * @packageDocumentation
 */
import { checkEvent, checkIdentifierAttributes } from '../anonymous.ts';
import type { TelemetryEvent } from '../pipeline.ts';

/** Options for {@link validateTelemetryEvents}. @public */
export interface ValidateTelemetryEventsOptions {
  /** The most events one request may carry. Defaults to 50; a longer list is refused whole. */
  readonly maxEvents?: number;
}

const DEFAULT_MAX_EVENTS = 50;

/**
 * The telemetry events in an untrusted request body, checked again with the package's own
 * closed lists. An event with an unknown kind or code is dropped, a field outside its list is
 * removed, and `resource` and `attributes` keep only identifier values. Returns an empty list
 * for a body that is not an array or is longer than `maxEvents`.
 *
 * @example
 * ```ts
 * const events = validateTelemetryEvents(await request.json());
 * ```
 *
 * @public
 */
export function validateTelemetryEvents(
  body: unknown,
  options: ValidateTelemetryEventsOptions = {}
): TelemetryEvent[] {
  const maxEvents = options.maxEvents ?? DEFAULT_MAX_EVENTS;
  if (!Array.isArray(body) || body.length > maxEvents) return [];
  return body.flatMap((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const source = value as Record<string, unknown>;
    const checked = checkEvent(source as unknown as TelemetryEvent);
    if ('dropped' in checked) return [];
    const resource = checkIdentifierAttributes(source.resource) ?? {};
    const attributes = checkIdentifierAttributes(source.attributes);
    return [
      Object.freeze({
        ...checked.event,
        resource,
        ...(attributes ? { attributes } : {}),
      }) as TelemetryEvent,
    ];
  });
}

/** A log record with the fields log services read for time and summary. @public */
export type TelemetryLogRecord = Record<string, unknown> & {
  /** The event time in milliseconds since the epoch, which Better Stack and others read. */
  readonly dt: number;
  /** A one-line summary, such as `edit.rejected edit.picture-selected`. */
  readonly message: string;
};

/**
 * An event as a log record: `dt` for the time, `message` for the live tail, and every field of
 * the event except the fixed `hint` and `docs` text, which the code already identifies.
 *
 * @example
 * ```ts
 * body: JSON.stringify(events.map(toLogRecord))
 * ```
 *
 * @public
 */
export function toLogRecord(event: TelemetryEvent): TelemetryLogRecord {
  const {
    hint: _hint,
    docs: _docs,
    ...fields
  } = event as TelemetryEvent & {
    hint?: string;
    docs?: string;
  };
  const code = 'code' in event && event.code ? ` ${event.code}` : '';
  return { ...fields, dt: event.time, message: `${event.kind}${code}` };
}

/** Options for {@link telemetryRoute}. @public */
export interface TelemetryRouteOptions {
  /** Send the checked events on, such as to your log service. Errors are caught and reported. */
  forward(events: readonly TelemetryEvent[]): unknown;
  /** Origins allowed to post, such as `['https://app.example.com']`. Omit to allow any. */
  readonly allowedOrigins?: readonly string[];
  /** The largest body accepted, in bytes. Defaults to 64 KiB. */
  readonly maxBodyBytes?: number;
  /** The most events one request may carry. Defaults to 50. */
  readonly maxEvents?: number;
  /** Called when `forward` throws or rejects. Defaults to nothing. */
  readonly onError?: (error: unknown) => void;
}

const DEFAULT_MAX_BODY_BYTES = 64 * 1024;

/**
 * A Fetch-style POST handler for telemetry from `httpExporter`: it limits the body, checks the
 * origin, validates every event, and calls `forward` with what passes. It answers 204 in every
 * case, so a telemetry problem never surfaces in the editor; use `onError` to see failures. It
 * does not rate-limit; put it behind your platform's limits.
 *
 * @example
 * ```ts
 * // Next.js: app/api/telemetry/route.ts
 * import { telemetryRoute, toLogRecord } from '@docx-editor.dev/telemetry/ingest';
 *
 * export const POST = telemetryRoute({
 *   forward: (events) =>
 *     fetch(`https://${process.env.BETTERSTACK_INGESTING_HOST}`, {
 *       method: 'POST',
 *       headers: {
 *         'Content-Type': 'application/json',
 *         Authorization: `Bearer ${process.env.BETTERSTACK_SOURCE_TOKEN}`,
 *       },
 *       body: JSON.stringify(events.map(toLogRecord)),
 *     }),
 * });
 * ```
 *
 * @public
 */
export function telemetryRoute(
  options: TelemetryRouteOptions
): (request: Request) => Promise<Response> {
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const accepted = () => new Response(null, { status: 204 });
  return async (request) => {
    if (request.method !== 'POST') return new Response(null, { status: 405 });
    if (options.allowedOrigins) {
      const origin = request.headers.get('origin');
      if (!origin || !options.allowedOrigins.includes(origin)) return accepted();
    }
    if (Number(request.headers.get('content-length') ?? 0) > maxBodyBytes) return accepted();
    let text: string;
    try {
      text = await request.text();
    } catch {
      return accepted();
    }
    if (text.length > maxBodyBytes) return accepted();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return accepted();
    }
    const events = validateTelemetryEvents(body, {
      ...(options.maxEvents === undefined ? {} : { maxEvents: options.maxEvents }),
    });
    if (!events.length) return accepted();
    try {
      const forwarded = await options.forward(events);
      const response = forwarded as { ok?: unknown; status?: unknown } | undefined;
      // A fetch to the log service that the service refused is a failure too.
      if (response && response.ok === false)
        throw new Error(`the log service answered ${String(response.status)}`);
    } catch (error) {
      try {
        options.onError?.(error);
      } catch {
        /* an observer must never change the answer */
      }
    }
    return accepted();
  };
}

export type { TelemetryEvent } from '../pipeline.ts';
