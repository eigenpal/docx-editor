/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The WRITE half of `defineCustomNode`: insert a recognized-by-construction
// node — a run-level `w:sdt` whose `w:tag` carries the definition's identity
// and attrs, `contentLocked` by default so neither Word users nor inline
// typing can drift the label away from the attrs, with the literal label text
// as its content (what Word and the free tier render).

import type { Editor, ExecResult } from '@docx-editor.dev/core/contracts/editor';
import type { PaginatedSurface } from '@docx-editor.dev/core/editor';
import type { CustomNodeDefinition } from './define-custom-node.ts';
import { encodeCustomNodeTag } from './tag-codec.ts';

/** Instance-only surface on the concrete facade, the same escape hatch chrome uses. */
function surfaceOf(editor: Editor): PaginatedSurface | null {
  const candidate = editor as Editor & { readonly surface?: PaginatedSurface | null };
  return candidate.surface ?? null;
}

/**
 * How {@link insertCustomNode} places a node.
 *
 * Every field is optional: the ordinary call inserts at the caret with `contentLocked`, which is
 * the behaviour that keeps a chip's label from drifting out of sync with its attrs while leaving
 * the node deletable as one unit.
 *
 * @public
 */
export interface InsertCustomNodeOptions {
  /**
   * Where to insert. Omitted, the node lands at the current selection HEAD —
   * the programmatic mirror of "type a citation at the caret".
   */
  readonly at?: { readonly paragraphId: string; readonly offset: number };
  /**
   * The `w:lock` written on the control. Defaults to `contentLocked` — the text
   * is locked so the label cannot drift out of sync with the attrs by inline
   * typing (editing goes through the `onEdit` flow), while the node itself stays
   * DELETABLE as one unit, in the editor and in Word alike. `false` writes no
   * lock; `sdtContentLocked` also forbids deleting the node.
   */
  readonly lock?: false | 'sdtLocked' | 'sdtContentLocked' | 'contentLocked';
  /**
   * `w:alias` — the human title Word shows on the control, and what the
   * engine's control chrome uses as its floating label.
   */
  readonly alias?: string;
}

/**
 * Insert one custom node. Returns the engine's typed result: refusals carry the
 * engine's own reason (tag overflow, offset out of range, viewing mode, …).
 *
 * ```ts
 * insertCustomNode(editor, citation, { sourceId: 'src_9f3' }, '(Smith 2024)');
 * ```
 */
export function insertCustomNode(
  editor: Editor,
  definition: CustomNodeDefinition,
  attrs: Readonly<Record<string, string>>,
  text: string,
  options: InsertCustomNodeOptions = {}
): ExecResult {
  const surface = surfaceOf(editor);
  if (!surface) {
    return { ok: false, code: 'notFound', reason: 'no document is mounted' };
  }
  const encoded = encodeCustomNodeTag(definition.tagPrefix, definition.name, attrs);
  if (!encoded.ok) {
    return {
      ok: false,
      code: 'invalidArgs',
      reason: `the encoded tag is ${encoded.length} characters; Word caps w:tag at 64 — shorten the attrs (the customXml data-part escape hatch is not built yet)`,
    };
  }
  const at = options.at ?? surface.state().selection.head;
  const lock = options.lock === undefined ? 'contentLocked' : options.lock;
  const applied = surface.session.applyTreeOps([
    {
      op: 'insertInlineContentControl',
      paragraphId: at.paragraphId,
      offset: at.offset,
      tag: encoded.tag,
      text,
      ...(options.alias === undefined ? {} : { alias: options.alias }),
      ...(lock === false ? {} : { lock }),
    },
  ]);
  if (!applied.committed) {
    const reason = typeof applied.reason === 'string' ? applied.reason : 'the insert was refused';
    return { ok: false, code: 'unsupported', reason };
  }
  return { ok: true, changed: true };
}
