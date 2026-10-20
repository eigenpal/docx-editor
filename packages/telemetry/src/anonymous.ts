/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/telemetry/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

/**
 * The second privacy check. The engine already builds every diagnostic from codes and
 * numbers; this guard makes sure that stays true at the boundary, whatever version of the
 * engine produced the event. A string that is not a known enum value is dropped, never sent.
 */
import {
  diagnosticCauses,
  diagnosticCodes,
  diagnosticCommands,
  explainDiagnostic,
} from '@docx-editor.dev/core';
import { nodeEnv } from './env.ts';
import type {
  DiagnosticCode,
  DiagnosticErrorName,
  EditorDiagnostic,
  DocumentPartKind,
  FailureStage,
  FormattingChangeKind,
  ReviewChangeKind,
  ReviewOperation,
} from '@docx-editor.dev/core';
import type { Attributes, AttributeValue, TelemetryEvent } from './pipeline.ts';

const CODES: ReadonlySet<string> = new Set(diagnosticCodes());

/** A closed list from a core type: a value the type gains fails the build here until listed. */
function closed<T extends string>(values: Readonly<Record<T, true>>): ReadonlySet<string> {
  return new Set(Object.keys(values));
}

const PART_KINDS = closed<DocumentPartKind>({
  package: true,
  'content-types': true,
  relationships: true,
  'main-document': true,
  glossary: true,
  styles: true,
  numbering: true,
  settings: true,
  'web-settings': true,
  'font-table': true,
  theme: true,
  header: true,
  footer: true,
  footnotes: true,
  endnotes: true,
  comments: true,
  people: true,
  'custom-xml': true,
  'document-properties': true,
  media: true,
  embedding: true,
  other: true,
});
const ERROR_NAMES = closed<DiagnosticErrorName>({
  Error: true,
  TypeError: true,
  RangeError: true,
  ReferenceError: true,
  SyntaxError: true,
  other: true,
});
const OPERATIONS = closed<ReviewOperation>({ accept: true, reject: true, reassign: true });
const STAGES = closed<FailureStage>({
  'open-mount': true,
  'open-layout': true,
  command: true,
  'review-item': true,
  automation: true,
  save: true,
});
const CHANGE_KINDS = closed<ReviewChangeKind>({
  insert: true,
  delete: true,
  replace: true,
  moveFrom: true,
  moveTo: true,
  format: true,
  paragraphMark: true,
  structural: true,
});
const FORMATTING_KINDS = closed<FormattingChangeKind>({
  rPrChange: true,
  pPrChange: true,
  sectPrChange: true,
  tblPrChange: true,
  tblPrExChange: true,
  tblGridChange: true,
  trPrChange: true,
  tcPrChange: true,
  numberingChange: true,
  other: true,
});

/** Carried on every event of the kind, or only when the condition holds. */
type Carried = true | ((event: Readonly<Record<string, unknown>>) => boolean);

interface KindSchema {
  /** The family of its codes, such as `edit` for `edit.read-only`. Absent: it has no code. */
  readonly codes?: string;
  /** The numeric fields it carries beyond the base ones. */
  readonly numbers: Readonly<Record<string, Carried>>;
}

/** A session's `active` and `end` phases carry its activity. */
const summary: Carried = (event) => event.phase === 'active' || event.phase === 'end';

/**
 * What each kind carries. A known numeric field on an event that does not carry it is removed
 * and the event is kept, so a newer engine that adds a field does not lose its events on an
 * older server. A kind that core adds fails the build here until it is listed.
 */
const KINDS = {
  // Only an open that succeeded reports how long it took.
  'document.open': {
    codes: 'open',
    numbers: { durationMs: (event) => event.outcome === 'opened' },
  },
  'edit.rejected': { codes: 'edit', numbers: { repeated: true } },
  'review.skipped': { codes: 'review', numbers: { count: true } },
  'font.failed': { codes: 'font', numbers: { repeated: true } },
  history: { codes: 'history', numbers: { repeated: true } },
  'custom-node': { codes: 'custom-node', numbers: { repeated: true } },
  // Only the first `ready` after a wait the editor saw reports how long the join took; its
  // deduplication summary does not report it again.
  'collab.status': {
    codes: 'collab',
    numbers: {
      repeated: true,
      connectMs: (event) => event.status === 'ready' && event.repeated === undefined,
    },
  },
  'collab.participants': { numbers: { count: true } },
  performance: { codes: 'performance', numbers: { windowMs: true } },
  // Saved and failed saves both report how long the call took.
  'document.save': { codes: 'save', numbers: { durationMs: true } },
  // A start carries nothing; a window summary and the end carry the activity.
  session: {
    numbers: {
      durationMs: summary,
      activeMs: summary,
      inputEdits: summary,
      commandEdits: summary,
      automationEdits: summary,
    },
  },
} satisfies Record<EditorDiagnostic['kind'], KindSchema>;
const KIND_SCHEMAS: Readonly<Record<string, KindSchema>> = KINDS;

/** Allowed string values for each enum field of a diagnostic. */
const ENUMS: Readonly<Record<string, ReadonlySet<string> | RegExp>> = {
  kind: new Set(Object.keys(KINDS)),
  code: CODES,
  outcome: new Set(['opened', 'saved', 'rejected']),
  phase: new Set(['start', 'active', 'end']),
  origin: new Set(['command', 'input', 'automation']),
  // A built-in command type such as `insertTable`; a host's own command is never named.
  command: new Set(diagnosticCommands()),
  sizeBucket: /^(?:\d+(?:KiB|MiB)?-\d+(?:KiB|MiB)|512MiB\+)$/,
  pagesBucket: new Set(['0', '1', '2-9', '10-99', '100-999', '1000+']),
  // The engine's three forms: a UUID, 32 hex digits, or a time and counter without Web Crypto.
  editorSessionId:
    /^e_(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{16,64}|[0-9a-z]{6,12}_[0-9a-z]{1,8})$/,
  // A release version, such as `2.29.0` or `2.29.0-next.1`, or `development` in this repository.
  engineVersion: /^(?:development|\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[0-9A-Za-z.]{1,20})?)$/,
  status: new Set(['initializing', 'ready', 'disconnected', 'error', 'destroyed']),
  previous: new Set(['none', 'initializing', 'ready', 'disconnected', 'error', 'destroyed']),
  // Failure detail: the engine's own reason and the anonymous context around it.
  cause: new Set(diagnosticCauses()),
  part: PART_KINDS,
  errorName: ERROR_NAMES,
  stage: STAGES,
  operation: OPERATIONS,
  changeKind: CHANGE_KINDS,
  formattingKind: FORMATTING_KINDS,
};

/** The largest count the guard accepts. A real editor stays far below it. */
export const MAX_COUNT = 1_000_000;
/**
 * The longest duration the guard accepts: 30 days. A performance window can span a sleeping
 * laptop, so the bound is loose; it only stops a value that no editor could produce.
 */
const MAX_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

interface Range {
  readonly min: number;
  readonly max: number;
  readonly integer: boolean;
  /**
   * Remove the field, not the event, when the value is above `max`. A wall-clock span, such as a
   * join after a month offline, can pass any bound, and the event still matters without it.
   */
  readonly removeAboveMax?: boolean;
}

const COUNT: Range = { min: 0, max: MAX_COUNT, integer: true };
const DURATION: Range = { min: 0, max: MAX_DURATION_MS, integer: false };
/** A wall-clock span at the top level of an event. */
const SPAN: Range = { ...DURATION, removeAboveMax: true };

/** Whether a number is inside a range. */
function inRange(value: unknown, range: Range): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= range.min &&
    value <= range.max &&
    (!range.integer || Number.isInteger(value))
  );
}

/**
 * The range of every numeric field. A value outside it drops the event, because a log service
 * sums some of these fields: one forged `repeated` of a billion, or a negative one, would
 * otherwise change a total.
 */
const NUMBERS: Readonly<Record<string, Range>> = {
  schemaVersion: { min: 1, max: 1000, integer: true },
  // The latest time a `Date` can hold.
  time: { min: 0, max: 8.64e15, integer: false },
  durationMs: SPAN,
  count: COUNT,
  // A summary carries one extra copy or more.
  repeated: { min: 1, max: MAX_COUNT, integer: true },
  connectMs: SPAN,
  windowMs: SPAN,
  activeMs: SPAN,
  inputEdits: COUNT,
  commandEdits: COUNT,
  automationEdits: COUNT,
};

/** Every event carries these. */
const BASE_NUMBERS: ReadonlySet<string> = new Set(['schemaVersion', 'time']);

/** Whether this event carries the numeric field at all. */
function carries(field: string, event: Readonly<Record<string, unknown>>): boolean {
  if (BASE_NUMBERS.has(field)) return true;
  const fields = KIND_SCHEMAS[event.kind as string]?.numbers;
  const carried = fields && Object.hasOwn(fields, field) ? fields[field] : undefined;
  return carried === true || (typeof carried === 'function' && carried(event));
}

const BOOLEANS = new Set(['tracked', 'recovering']);

/** Why the guard dropped an event. Also the `reason` label of the dropped-events metric. */
export type DropReason = 'unknown-kind' | 'unknown-code' | 'invalid-field';

const warned = new Set<string>();
/** Warn once per kind of problem, in development only. */
function devWarn(message: string, kind = message): void {
  if (warned.has(kind) || nodeEnv() === 'production') return;
  warned.add(kind);
  console.warn(`[docx-editor telemetry] ${message}`);
}

function allowed(field: string, value: string): boolean {
  const rule = Object.hasOwn(ENUMS, field) ? ENUMS[field] : undefined;
  if (!rule) return false;
  return rule instanceof RegExp ? rule.test(value) : rule.has(value);
}

/**
 * The event with every field checked, or the reason it was dropped. Unknown fields, numbers or
 * timing summaries on an event that does not carry them, and wall-clock spans above their bound
 * are removed. The whole event is dropped for an unknown kind or code, a code of another kind, a
 * string outside its enum, any other number outside its range, an inconsistent timing summary,
 * or a performance summary without timings. `hint` and `docs` must be the constants for the
 * event's own code.
 */
export function checkEvent(
  event: TelemetryEvent
): { readonly event: TelemetryEvent } | { readonly dropped: DropReason } {
  const source = event as unknown as Record<string, unknown>;
  if (typeof source.kind !== 'string' || !allowed('kind', source.kind)) {
    devWarn('dropped an event of an unknown kind; core and telemetry versions may differ', 'kind');
    return { dropped: 'unknown-kind' };
  }
  const kind = source.kind;
  const code = typeof source.code === 'string' ? source.code : undefined;
  const family = KIND_SCHEMAS[kind]?.codes;
  if (code !== undefined && (!CODES.has(code) || !family || !code.startsWith(`${family}.`))) {
    devWarn(
      'dropped an event with an unknown code; core and telemetry versions may differ',
      'code'
    );
    return { dropped: 'unknown-code' };
  }
  const explained = code ? explainDiagnostic(code as DiagnosticCode) : undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    // Your own values, checked when the client built them; the engine never sets them.
    if (key === 'resource' || key === 'attributes') continue;
    if (key === 'shape') {
      const shape = checkShape(value);
      if (!shape) {
        devWarn('dropped an event whose "shape" is not a valid document shape', 'shape');
        return { dropped: 'invalid-field' };
      }
      out.shape = shape;
      continue;
    }
    if (TIMING_FIELDS.has(key)) {
      if (kind !== 'performance') {
        devWarn(`removed "${key}", which only performance events carry`, `on:${key}`);
        continue;
      }
      const timing = checkTiming(value);
      if (!timing) {
        devWarn(`dropped an event whose "${key}" is not a valid timing summary`, `timing:${key}`);
        return { dropped: 'invalid-field' };
      }
      out[key] = timing;
      continue;
    }
    if (key === 'hint' || key === 'docs') {
      if (explained && value === explained[key]) out[key] = value;
      continue;
    }
    const numeric = Object.hasOwn(NUMBERS, key);
    if (numeric && !carries(key, source)) {
      devWarn(`removed "${key}", which a ${kind} event does not carry`, `on:${kind}:${key}`);
      continue;
    }
    const known = Object.hasOwn(ENUMS, key) || numeric || BOOLEANS.has(key);
    const range = numeric ? NUMBERS[key]! : undefined;
    if (range && inRange(value, range)) out[key] = value;
    else if (range?.removeAboveMax && typeof value === 'number' && value > range.max) {
      devWarn(`removed "${key}", which is longer than the guard accepts`, `long:${key}`);
      continue;
    } else if (typeof value === 'boolean' && BOOLEANS.has(key)) out[key] = value;
    else if (typeof value === 'string' && allowed(key, value)) out[key] = value;
    else if (known) {
      // A known field that fails its check would leave a typed event with a hole in it.
      devWarn(`dropped an event whose "${key}" is not a valid value`, `field:${key}`);
      return { dropped: 'invalid-field' };
    } else
      devWarn(
        `dropped the field "${key}", which is not an anonymous diagnostic field`,
        `extra:${key}`
      );
  }
  // The engine sends a performance summary only after it timed something.
  if (kind === 'performance' && ![...TIMING_FIELDS].some((key) => out[key] !== undefined)) {
    devWarn('dropped a performance summary without timings', 'performance:empty');
    return { dropped: 'invalid-field' };
  }
  out.resource = event.resource;
  out.attributes = event.attributes ?? {};
  return { event: Object.freeze(out) as unknown as TelemetryEvent };
}

const TIMING_FIELDS: ReadonlySet<string> = new Set(['interaction', 'layout', 'paint']);
const TIMING_NUMBERS = ['count', 'p50Ms', 'p95Ms', 'maxMs'] as const;
/** Bands in a timing summary: seven bounds and one band above them. */
const TIMING_BANDS = 8;

/**
 * A timing summary with exactly its numbers and its bands, or null. The engine sends a summary
 * only when it timed something, counts each timing in exactly one band, and takes the median
 * and the 95th percentile from a sample of the timings that the maximum covers.
 */
function checkTiming(value: unknown): Readonly<Record<string, unknown>> | null {
  if (!value || typeof value !== 'object') return null;
  const fields = value as Record<string, unknown>;
  const allowedKeys: readonly string[] = [...TIMING_NUMBERS, 'bands'];
  if (Object.keys(fields).some((key) => !allowedKeys.includes(key))) return null;
  const { count, p50Ms, p95Ms, maxMs, bands } = fields;
  if (!inRange(count, COUNT) || count < 1) return null;
  if (!inRange(p50Ms, DURATION) || !inRange(p95Ms, DURATION) || !inRange(maxMs, DURATION))
    return null;
  if (p50Ms > p95Ms || p95Ms > maxMs) return null;
  if (
    !Array.isArray(bands) ||
    bands.length !== TIMING_BANDS ||
    !bands.every((band) => inRange(band, COUNT))
  )
    return null;
  if (bands.reduce((total: number, band: number) => total + band, 0) !== count) return null;
  return Object.freeze({ count, p50Ms, p95Ms, maxMs, bands: Object.freeze([...bands]) });
}

const SHAPE_FIELDS = ['parts', 'paragraphs', 'reviewItems', 'embeddedFonts'] as const;

/** A document shape with exactly its four count buckets, or null. */
function checkShape(value: unknown): Readonly<Record<string, string>> | null {
  if (!value || typeof value !== 'object') return null;
  const fields = value as Record<string, unknown>;
  if (Object.keys(fields).some((key) => !(SHAPE_FIELDS as readonly string[]).includes(key)))
    return null;
  const out: Record<string, string> = {};
  for (const key of SHAPE_FIELDS) {
    const bucket = fields[key];
    if (typeof bucket !== 'string' || !allowed('pagesBucket', bucket)) return null;
    out[key] = bucket;
  }
  return Object.freeze(out);
}

const KEY = /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/;
const LABEL_VALUE = /^[A-Za-z0-9_.:+-]{0,64}$/;

/**
 * Attributes with only primitive values and well-formed keys. With `labels`, a metric's own
 * label list, other keys are dropped and string values outside the label alphabet become
 * `other`, so no free text becomes a time series.
 */
export function checkAttributes(
  attributes: Attributes,
  context: string,
  labels?: readonly string[]
): Attributes {
  const out: Record<string, AttributeValue> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (!KEY.test(key) || (labels && !labels.includes(key))) {
      devWarn(
        `dropped the attribute "${key.slice(0, 40)}" on ${context}`,
        `attribute:${context}:${key}`
      );
      continue;
    }
    if (typeof value === 'number' || typeof value === 'boolean') out[key] = value;
    else if (typeof value === 'string')
      out[key] = labels && !LABEL_VALUE.test(value) ? 'other' : value.slice(0, 256);
  }
  return out;
}

/**
 * Attributes received from an untrusted client: well-formed keys, and values that are numbers,
 * booleans, or identifier strings. A string with spaces or other text is dropped, not cut, so
 * free text never passes a server that forwards it.
 */
export function checkIdentifierAttributes(value: unknown): Attributes | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const out: Record<string, AttributeValue> = {};
  for (const [key, field] of Object.entries(value)) {
    if (!KEY.test(key)) continue;
    if (typeof field === 'boolean' || (typeof field === 'number' && Number.isFinite(field)))
      out[key] = field;
    else if (typeof field === 'string' && field && LABEL_VALUE.test(field)) out[key] = field;
  }
  return Object.keys(out).length ? out : undefined;
}
