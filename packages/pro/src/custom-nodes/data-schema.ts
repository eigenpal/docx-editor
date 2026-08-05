/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// What a custom node's payload is allowed to be, and the boundary that enforces it.
//
// A payload lives in a customXml data part, which means it arrives from a file the sender
// controls. The bytes say `{"depth":120}`; nothing says the sender did not write
// `{"depth":{"toString":…}}`, or 40 MB of nested arrays, or a `__proto__` key. So a definition
// declares its shape and this parses against it, at the read boundary, once — after which the
// host's `data` is the type it asked for and downstream code can stop apologising.
//
// WHY Standard Schema RATHER THAN A ZOD DEPENDENCY
//
// `StandardSchemaV1` is the interface zod implements (as do valibot and arktype), so a host
// passes an ordinary zod schema and it works:
//
//   const Iceberg = z.object({ depth: z.number(), charted: z.boolean() });
//   defineCustomNode({ name: 'iceberg', tagPrefix: 'igloo', schema: Iceberg, … });
//
// Depending on zod itself would put a copy of it in this tarball and a second one in the app,
// and two zods disagree about `instanceof` in exactly the way two engines disagree about
// caches. The interface is 30 lines and is meant to be vendored; this is that copy.

/**
 * The Standard Schema interface, vendored.
 *
 * Any zod, valibot or arktype schema satisfies it. See https://standardschema.dev.
 *
 * @public
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly '~standard': {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (
      value: unknown
    ) => StandardSchemaResult<Output> | Promise<StandardSchemaResult<Output>>;
    readonly types?: { readonly input: Input; readonly output: Output } | undefined;
  };
}

/** What a Standard Schema validation answers. @public */
export type StandardSchemaResult<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | { readonly issues: readonly { readonly message: string }[] };

/** The type a schema produces, for a definition to hand back to its host. @public */
export type InferSchemaOutput<Schema> =
  Schema extends StandardSchemaV1<unknown, infer Output> ? Output : never;

/**
 * Why a payload was refused.
 *
 * `malformed` is not valid JSON at all; `invalid` parsed but did not match the schema; `async`
 * is a schema whose validation returns a promise, which cannot be used here (see below).
 *
 * @public
 */
export type CustomNodeDataRejection = 'malformed' | 'invalid' | 'async';

/** What {@link parseCustomNodeData} answers. @public */
export type CustomNodeDataResult<Output> =
  | { readonly ok: true; readonly value: Output }
  | {
      readonly ok: false;
      readonly reason: CustomNodeDataRejection;
      /** Human-readable, for a host to log. Never rendered as markup by this package. */
      readonly issues: readonly string[];
    };

/**
 * The largest payload this will parse, in UTF-16 code units.
 *
 * A file-supplied length must never reach an allocation, and `JSON.parse` on a hostile string
 * is the allocation. 256 KB is far past any legitimate chip payload and far short of anything
 * that hurts.
 */
export const MAX_CUSTOM_NODE_DATA_LENGTH = 256 * 1024;

/**
 * Parse a payload out of a data part and validate it against the definition's schema.
 *
 * Synchronous on purpose. This runs inside the read path, where recognition happens for every
 * node in the document before anything paints, and an async boundary there would mean a
 * document that renders its chips a frame later than its text. A schema with an async refinement
 * is refused (`async`) rather than awaited, so the limitation is visible instead of silent.
 *
 * A payload with no schema comes back as the parsed JSON, typed `unknown` — the host asked for
 * no guarantees and gets none, rather than getting a lie.
 */
export function parseCustomNodeData<Schema extends StandardSchemaV1 | undefined>(
  schema: Schema,
  raw: string
): CustomNodeDataResult<Schema extends StandardSchemaV1 ? InferSchemaOutput<Schema> : unknown> {
  type Value = Schema extends StandardSchemaV1 ? InferSchemaOutput<Schema> : unknown;
  if (raw.length === 0) {
    return { ok: false, reason: 'malformed', issues: ['the node carries no payload'] };
  }
  if (raw.length > MAX_CUSTOM_NODE_DATA_LENGTH) {
    return {
      ok: false,
      reason: 'malformed',
      issues: [
        `the payload is ${String(raw.length)} characters; the cap is ${String(MAX_CUSTOM_NODE_DATA_LENGTH)}`,
      ],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      ok: false,
      reason: 'malformed',
      issues: [error instanceof Error ? error.message : 'the payload is not JSON'],
    };
  }

  // `JSON.parse` writes `__proto__` as an ordinary own property rather than invoking the
  // setter, so the parsed object itself is safe — but a host that spreads or merges it into
  // another object revives the hazard. Dropping the key here means it never gets the chance.
  const cleaned = withoutPollutingKeys(parsed);

  if (!schema) return { ok: true, value: cleaned as Value };

  const result = schema['~standard'].validate(cleaned);
  if (result instanceof Promise) {
    return {
      ok: false,
      reason: 'async',
      issues: ['the schema validates asynchronously, which the read path cannot await'],
    };
  }
  if (result.issues) {
    return { ok: false, reason: 'invalid', issues: result.issues.map((issue) => issue.message) };
  }
  return { ok: true, value: result.value as Value };
}

/** Serialize a payload for a data part. Refuses what cannot round-trip through JSON. */
export function serializeCustomNodeData(value: unknown): CustomNodeDataResult<string> {
  let raw: string;
  try {
    raw = JSON.stringify(value) ?? '';
  } catch (error) {
    // Cyclic, or a BigInt: both throw, and both are worth naming rather than writing `{}`.
    return {
      ok: false,
      reason: 'malformed',
      issues: [error instanceof Error ? error.message : 'the value cannot be serialized'],
    };
  }
  if (raw.length === 0) {
    return { ok: false, reason: 'malformed', issues: ['the value serializes to nothing'] };
  }
  if (raw.length > MAX_CUSTOM_NODE_DATA_LENGTH) {
    return {
      ok: false,
      reason: 'malformed',
      issues: [
        `the payload is ${String(raw.length)} characters; the cap is ${String(MAX_CUSTOM_NODE_DATA_LENGTH)}`,
      ],
    };
  }
  return { ok: true, value: raw };
}

const POLLUTING_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Strip the keys that turn an ordinary merge into prototype pollution, at every depth. */
function withoutPollutingKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutPollutingKeys);
  if (value === null || typeof value !== 'object') return value;
  const cleaned: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [key, nested] of Object.entries(value)) {
    if (POLLUTING_KEYS.has(key)) continue;
    cleaned[key] = withoutPollutingKeys(nested);
  }
  return cleaned;
}
