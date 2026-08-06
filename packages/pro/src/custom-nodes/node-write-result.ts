/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// What a write answers, and why a refusal carries more than a sentence.
//
// The engine's `ExecResult` is `{ ok, code, reason }` — a string for a human. That is the right
// answer for "this paragraph is locked", and the wrong one for "your payload did not match the
// schema": a host with an edit form wants to highlight the `year` field, and parsing
// `"year: expected a number"` back into a field name is a worse API than not having declared a
// schema at all.
//
// So a payload refusal keeps the ISSUES the schema produced, path intact. Everything else about
// the result is the engine's own, unchanged, so a caller that only reads `ok` and `reason` needs
// to know nothing about this.

import type { ExecResult } from '@docx-editor.dev/core/contracts/editor';
import type { StandardSchemaIssue } from './data-schema.ts';

/**
 * One field a payload got wrong.
 *
 * `path` is the route to it — `['authors', 0, 'name']` — which is what a form needs to find the
 * input to mark. Empty for an issue about the payload as a whole.
 *
 * @public
 */
export interface CustomNodeIssue {
  readonly message: string;
  readonly path: readonly (string | number)[];
  /** `authors.0.name`, for a log line or a message. Derived from `path`. */
  readonly pointer: string;
}

/**
 * What {@link insertCustomNode} and {@link updateCustomNode} answer.
 *
 * The engine's `ExecResult`, plus `issues` when the refusal was a schema failure. A host that
 * only branches on `ok` sees no difference.
 *
 * @public
 */
export type CustomNodeWriteOutcome =
  | (Extract<ExecResult, { ok: true }> & {
      /**
       * The control this write authored. A rewrite replaces the control rather than editing it,
       * so the id passed to `updateCustomNode` names nothing afterwards — re-point anything
       * attached to that node at this one.
       */
      readonly nodeId?: string;
    })
  | (Extract<ExecResult, { ok: false }> & {
      /** Present only for a payload the definition's schema refused. */
      readonly issues?: readonly CustomNodeIssue[];
    });

/** A Standard Schema issue with its path kept, rather than flattened into the message. */
export function customNodeIssueOf(issue: StandardSchemaIssue): CustomNodeIssue {
  const path = (issue.path ?? []).map((segment) => {
    const key = typeof segment === 'object' ? segment.key : segment;
    return typeof key === 'number' ? key : String(key);
  });
  return { message: issue.message, path, pointer: path.join('.') };
}

/** A refusal carrying the fields that were wrong. */
export function invalidPayload(
  reason: string,
  issues: readonly CustomNodeIssue[]
): CustomNodeWriteOutcome {
  return { ok: false, code: 'invalidArgs', reason, issues };
}
