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
 * the browser used, and fields the client chose itself are dropped unless you allow them. No
 * dependency: Fetch API `Request` and `Response` only, so it runs in Next.js route handlers,
 * Hono, Bun, Deno, and Cloudflare Workers.
 *
 * @packageDocumentation
 */
import { checkEvent, checkIdentifierAttributes } from '../anonymous.ts';
import { failureCount } from '../exporters.ts';
import type { Attributes, TelemetryEvent } from '../pipeline.ts';

/** Options for {@link validateTelemetryEvents}. @public */
export interface ValidateTelemetryEventsOptions {
  /** The most events one request may carry. Defaults to 50; a longer list is refused whole. */
  readonly maxEvents?: number;
  /**
   * Keys of the browser's `resource` and `attributes` to keep, such as `['app.version']`. Each
   * kept value must be a number, a boolean, or an identifier string. Defaults to none: a value
   * the client chose cannot be checked for meaning, so add your fixed fields on the server.
   */
  readonly attributeKeys?: readonly string[];
}

const DEFAULT_MAX_EVENTS = 50;

type Fields = Readonly<Record<string, unknown>>;
const isString = (value: unknown) => typeof value === 'string';
const isNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value);
const isBoolean = (value: unknown) => typeof value === 'boolean';

/** The fields every event of a kind must have, after the closed-list check. */
const REQUIRED: Readonly<
  Record<string, readonly (readonly [string, (value: unknown) => boolean])[]>
> = {
  'edit.rejected': [
    ['code', isString],
    ['origin', isString],
    ['tracked', isBoolean],
  ],
  'review.skipped': [
    ['code', isString],
    ['count', isNumber],
  ],
  'font.failed': [['code', isString]],
  history: [['code', isString]],
  'custom-node': [['code', isString]],
  'collab.status': [
    ['status', isString],
    ['previous', isString],
    ['recovering', isBoolean],
  ],
  'collab.participants': [['count', isNumber]],
  performance: [['windowMs', isNumber]],
};

const SESSION_ACTIVITY = [
  'durationMs',
  'activeMs',
  'inputEdits',
  'commandEdits',
  'automationEdits',
] as const;

/** Whether an event has every field its kind needs, so a log record is never half empty. */
function complete(event: Fields): boolean {
  if (!isNumber(event.schemaVersion) || !isNumber(event.time)) return false;
  if (!isString(event.editorSessionId) || !isString(event.engineVersion)) return false;
  if (event.kind === 'document.open')
    return event.outcome === 'opened'
      ? isString(event.sizeBucket) && isNumber(event.durationMs)
      : event.outcome === 'rejected' && isString(event.code);
  if (event.kind === 'document.save')
    return (
      isNumber(event.durationMs) &&
      (event.outcome === 'saved'
        ? isString(event.sizeBucket)
        : event.outcome === 'rejected' && isString(event.code))
    );
  if (event.kind === 'session')
    return (
      event.phase === 'start' ||
      ((event.phase === 'active' || event.phase === 'end') &&
        SESSION_ACTIVITY.every((key) => isNumber(event[key])))
    );
  const required = REQUIRED[event.kind as string];
  return !!required && required.every(([key, check]) => check(event[key]));
}

/** Only the allowed keys of a client's attributes, with identifier values. */
function allowed(value: unknown, keys: ReadonlySet<string>): Attributes {
  if (keys.size === 0) return {};
  const checked = checkIdentifierAttributes(value) ?? {};
  return Object.fromEntries(Object.entries(checked).filter(([key]) => keys.has(key)));
}

/**
 * The telemetry events in an untrusted request body, checked again with the package's own
 * closed lists. An event with an unknown kind or code, a code of another kind, a value outside
 * its list or range, or without the fields its kind needs, is dropped. An unknown field, a
 * number or timing summary its kind does not carry, or a wall-clock span above its bound is
 * removed. The client's `resource` and `attributes` keep only the keys in `attributeKeys`.
 * Returns an empty list for a body that is not an array or is longer than `maxEvents`.
 *
 * The check proves that every value comes from the package's lists or is a number in the range
 * the engine produces. It cannot prove that a client told the truth: a script can send a
 * well-formed event that never happened. It can never send text.
 *
 * @example
 * ```ts
 * const events = validateTelemetryEvents(await request.json(), { attributeKeys: ['app.version'] });
 * ```
 *
 * @public
 */
export function validateTelemetryEvents(
  body: unknown,
  options: ValidateTelemetryEventsOptions = {}
): TelemetryEvent[] {
  const maxEvents = options.maxEvents ?? DEFAULT_MAX_EVENTS;
  const keys = new Set(options.attributeKeys ?? []);
  if (!Array.isArray(body) || body.length > maxEvents) return [];
  return body.flatMap((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const source = value as Fields;
    const {
      resource: _resource,
      attributes: _attributes,
      ...rest
    } = source as Fields & { resource?: unknown; attributes?: unknown };
    const checked = checkEvent(rest as unknown as TelemetryEvent);
    if ('dropped' in checked || !complete(checked.event as unknown as Fields)) return [];
    const attributes = allowed(source.attributes, keys);
    // The check copies the attributes it was given; these come only from `attributeKeys`.
    const { attributes: _checkedAttributes, ...event } = checked.event as TelemetryEvent & {
      attributes?: unknown;
    };
    return [
      Object.freeze({
        ...event,
        resource: allowed(source.resource, keys),
        attributes,
      }) as TelemetryEvent,
    ];
  });
}

/** A log record with the fields log services read for time, summary, and counts. @public */
export type TelemetryLogRecord = Record<string, unknown> & {
  /** The event time in milliseconds since the epoch, which Better Stack and others read. */
  readonly dt: number;
  /** A one-line summary, such as `edit.rejected edit.picture-selected`. */
  readonly message: string;
  /**
   * How many times the event happened: `1`, or `repeated` for a deduplication summary, whose
   * first event was already sent. Sum it to count events; do not count records.
   */
  readonly occurrences: number;
  /** How many failures the record adds to a failure total. See `failureCount`. */
  readonly failures: number;
};

/**
 * An event as a log record: `dt` for the time, `message` for the live tail, `occurrences` and
 * `failures` to sum, and every field of the event except the fixed `hint` and `docs` text,
 * which the code already identifies. Add your own fixed fields, such as a service name, to the
 * result.
 *
 * @example
 * ```ts
 * body: JSON.stringify(events.map((event) => ({ ...toLogRecord(event), service: 'my-app' })))
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
  return {
    ...fields,
    dt: event.time,
    message: `${event.kind}${code}`,
    occurrences: event.repeated ?? 1,
    failures: failureCount(event),
  };
}

/** Options for {@link telemetryRoute}. @public */
export interface TelemetryRouteOptions extends ValidateTelemetryEventsOptions {
  /** Send the checked events on, such as to your log service. Errors are caught and reported. */
  forward(events: readonly TelemetryEvent[]): unknown;
  /** Origins allowed to post, such as `['https://app.example.com']`. Omit to allow any. */
  readonly allowedOrigins?: readonly string[];
  /** The largest body accepted, in bytes. Defaults to 64 KiB. */
  readonly maxBodyBytes?: number;
  /** Called when `forward` throws or rejects, or the log service refuses. Defaults to nothing. */
  readonly onError?: (error: unknown) => void;
}

const DEFAULT_MAX_BODY_BYTES = 64 * 1024;

/** The body as text, or null when it is larger than `limit` bytes. Stops reading at the limit. */
async function readLimited(request: Request, limit: number): Promise<string | null> {
  if (Number(request.headers.get('content-length') ?? 0) > limit) return null;
  const body = request.body;
  if (!body) return '';
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/**
 * A Fetch-style handler for telemetry from `httpExporter`: it accepts POST only, checks the
 * origin, reads at most `maxBodyBytes`, validates every event, and calls `forward` with what
 * passes. It answers 204 to every request, so a telemetry problem never surfaces in the
 * editor; use `onError` to see failures. It does not rate-limit; put it behind your platform's
 * limits.
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
  const failed = (error: unknown): void => {
    try {
      options.onError?.(error);
    } catch {
      /* an observer must never change the answer */
    }
  };
  return async (request) => {
    if (request.method !== 'POST') return accepted();
    if (options.allowedOrigins) {
      const origin = request.headers.get('origin');
      if (!origin || !options.allowedOrigins.includes(origin)) return accepted();
    }
    let text: string | null;
    try {
      text = await readLimited(request, maxBodyBytes);
    } catch {
      return accepted();
    }
    if (text === null) return accepted();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return accepted();
    }
    const events = validateTelemetryEvents(body, options);
    if (!events.length) return accepted();
    try {
      const forwarded = await options.forward(events);
      const response = forwarded as { ok?: unknown; status?: unknown } | undefined;
      // A fetch to the log service that the service refused is a failure too.
      if (response && response.ok === false)
        throw new Error(`the log service answered ${String(response.status)}`);
    } catch (error) {
      failed(error);
    }
    return accepted();
  };
}

export type { TelemetryEvent } from '../pipeline.ts';
