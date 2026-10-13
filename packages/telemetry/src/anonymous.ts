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

/** Allowed string values for each enum field of a diagnostic. */
const ENUMS: Readonly<Record<string, ReadonlySet<string> | RegExp>> = {
  kind: new Set([
    'document.open',
    'edit.rejected',
    'review.skipped',
    'font.failed',
    'history',
    'custom-node',
    'collab.status',
    'collab.participants',
    'performance',
  ]),
  code: CODES,
  outcome: new Set(['opened', 'rejected']),
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

const NUMBERS = new Set([
  'schemaVersion',
  'time',
  'durationMs',
  'count',
  'repeated',
  'connectMs',
  'participants',
  'windowMs',
]);
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
 * The event with every field checked, or `null` when its kind or code is unknown. Unknown
 * fields and strings outside their enum are dropped. `hint` and `docs` must be the constants
 * for the event's own code.
 */
export function checkEvent(
  event: TelemetryEvent
): { readonly event: TelemetryEvent } | { readonly dropped: DropReason } {
  const source = event as unknown as Record<string, unknown>;
  if (typeof source.kind !== 'string' || !allowed('kind', source.kind)) {
    devWarn('dropped an event of an unknown kind; core and telemetry versions may differ', 'kind');
    return { dropped: 'unknown-kind' };
  }
  const code = typeof source.code === 'string' ? source.code : undefined;
  if (code !== undefined && !CODES.has(code)) {
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
    const known = Object.hasOwn(ENUMS, key) || NUMBERS.has(key) || BOOLEANS.has(key);
    if (typeof value === 'number' && NUMBERS.has(key) && Number.isFinite(value)) out[key] = value;
    else if (typeof value === 'boolean' && BOOLEANS.has(key)) out[key] = value;
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
  out.resource = event.resource;
  out.attributes = event.attributes ?? {};
  return { event: Object.freeze(out) as unknown as TelemetryEvent };
}

const TIMING_FIELDS: ReadonlySet<string> = new Set(['interaction', 'layout', 'paint']);
const TIMING_NUMBERS = ['count', 'p50Ms', 'p95Ms', 'maxMs'] as const;
/** Bands in a timing summary: seven bounds and one band above them. */
const TIMING_BANDS = 8;

const countable = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** A timing summary with exactly its numbers and its bands, or null. */
function checkTiming(value: unknown): Readonly<Record<string, unknown>> | null {
  if (!value || typeof value !== 'object') return null;
  const fields = value as Record<string, unknown>;
  const allowedKeys: readonly string[] = [...TIMING_NUMBERS, 'bands'];
  if (Object.keys(fields).some((key) => !allowedKeys.includes(key))) return null;
  const out: Record<string, unknown> = {};
  for (const key of TIMING_NUMBERS) {
    if (!countable(fields[key])) return null;
    out[key] = fields[key];
  }
  const bands = fields.bands;
  if (!Array.isArray(bands) || bands.length !== TIMING_BANDS || !bands.every(countable))
    return null;
  out.bands = Object.freeze([...bands]);
  return Object.freeze(out);
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
