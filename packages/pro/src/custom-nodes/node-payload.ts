/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Where a definition's payloads live, and what a payload has to satisfy to be written.
//
// Three decisions, in one place so the write path, the read path and the export path cannot
// each make them differently:
//
//   - WHICH STORE. One customXml store per namespace per document, so the namespace is what
//     decides whether two definitions share a store. Derived from `tagPrefix` unless a host
//     names its own, which means a host that never thinks about it still never collides with
//     another integrator's.
//   - WHICH ID. Minted from the store's own contents, so an id is unique within the document
//     that holds it and is stable for as long as the node is.
//   - WHETHER IT IS VALID. The definition's schema, applied on the way IN. A payload refused
//     here never reaches a file; a payload refused on the way out reaches one and comes back
//     broken.

import { customNodePayloadsOf } from '@docx-editor.dev/core/store';
import type { OoxmlPackage } from '@docx-editor.dev/core/store';
import type { AnyCustomNodeDefinition } from './define-custom-node.ts';
import { serializeCustomNodeData, type StandardSchemaV1 } from './data-schema.ts';
import { customNodeIssueOf, type CustomNodeIssue } from './node-write-result.ts';

/** The local name of every payload store this library authors. */
export const CUSTOM_NODE_STORE_ROOT = 'docxEditor';

/**
 * The namespace a definition's payloads live in.
 *
 * Keyed on `tagPrefix` rather than on `name`, so one integrator's nodes share one store. A
 * document with a citation and a figure carries one customXml part, not two.
 */
export function customNodeNamespace(definition: AnyCustomNodeDefinition): string {
  return definition.payloadNamespace ?? `urn:docx-editor.dev:custom-node:${definition.tagPrefix}`;
}

/**
 * The next free node id in a definition's store.
 *
 * Seeded from what the store already holds rather than from a clock or a random source: the
 * same document written twice has to produce the same bytes, or a save/reopen/save round trip
 * stops being a fixed point. `cx1`, `cx2`, … — the charset an XPath predicate can quote.
 */
export function nextCustomNodeId(
  pkg: OoxmlPackage,
  storyPartName: string,
  namespaceUri: string
): string {
  let highest = 0;
  for (const id of customNodePayloadsOf(pkg, storyPartName, namespaceUri).keys()) {
    const match = /^cx(\d{1,9})$/.exec(id);
    if (!match) continue;
    const value = Number(match[1]);
    if (value > highest) highest = value;
  }
  return `cx${String(highest + 1)}`;
}

/** A payload ready to be written, or why it was refused — with the fields that were wrong. */
export type CustomNodeDataResult =
  | { readonly ok: true; readonly data: string }
  | { readonly ok: false; readonly reason: string; readonly issues: readonly CustomNodeIssue[] };

/**
 * Validate a payload against the definition's schema and serialize it.
 *
 * VALIDATED FIRST, serialized second. A host's value is not a file yet, so the schema is the
 * only thing that can say the payload is the shape the definition promised — and the failure
 * has to name the field, or an integrator is left diffing a rejected object against a schema.
 *
 * A definition with no schema serializes whatever it was given, which is the honest answer to
 * having asked for no guarantees.
 */
export function customNodeDataFor(
  definition: AnyCustomNodeDefinition,
  value: unknown
): CustomNodeDataResult {
  const serialized = serializeCustomNodeData(value);
  if (!serialized.ok) {
    return {
      ok: false,
      reason: `the payload cannot be serialized: ${serialized.issues.join(', ')}`,
      issues: [],
    };
  }
  if (!definition.schema) return { ok: true, data: serialized.value };
  // Through the same parse the READ path uses, against the serialized form: a value that
  // survives `JSON.stringify` and then fails the schema is one the reader would have refused,
  // and finding that out at the insert is the whole point of checking here.
  // Validated against the SCHEMA ITSELF rather than through the read path's string form, so the
  // issues keep their `path` — which is the whole reason a host declared a schema.
  // Annotated because the definition is held as `AnyCustomNodeDefinition` here, so its schema —
  // and everything the validator returns — would otherwise be `any`.
  const schema: StandardSchemaV1 = definition.schema;
  const validated = schema['~standard'].validate(JSON.parse(serialized.value) as unknown);
  if (isThenable(validated)) {
    return {
      ok: false,
      reason: `${definition.name}'s schema validates asynchronously, which a write cannot await`,
      issues: [],
    };
  }
  if (validated.issues) {
    const issues = validated.issues.map(customNodeIssueOf);
    return {
      ok: false,
      reason:
        `the payload does not match ${definition.name}'s schema: ` +
        issues
          .map((issue) => (issue.pointer ? `${issue.pointer}: ` : '') + issue.message)
          .join(', '),
      issues,
    };
  }
  return { ok: true, data: serialized.value };
}

/** Thenable rather than `instanceof Promise`, for the same cross-realm reason `parseCustomNodeData` is. */
function isThenable<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof (value as { then?: unknown }).then === 'function';
}
