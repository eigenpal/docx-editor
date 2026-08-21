/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// One activation decode for every chrome surface: boundary element → chrome layer →
// `data-tag` → registered definition. `CustomNodeChrome` (click/hover) and the context-menu
// section both resolve a pointer target through this, so they cannot disagree about which
// node was under it.

import { useMemo } from 'react';
import { useDocxEditor } from '@docx-editor.dev/react';
import type { Editor } from '@docx-editor.dev/core/contracts/editor';
import {
  isCustomNodeDefinition,
  type ActivatedCustomNode,
  type AnyCustomNodeDefinition,
} from '../custom-nodes/define-custom-node.ts';
import { decodeCustomNodeTag } from '../custom-nodes/tag-codec.ts';
import { parseCustomNodeData } from '../custom-nodes/data-schema.ts';
import { customNodePayloadsByControl } from '@docx-editor.dev/core/store';
import { partOfNodeId } from '@docx-editor.dev/core/editor';
import type { PaginatedSurface as EditorSurface } from '@docx-editor.dev/core/editor';

/**
 * The definitions a chrome surface should act on: the `nodes` prop when given, else the
 * definitions registered on the editor (`customNodesModule`). Registering once and letting
 * every surface default to it is the intended shape; the prop exists for a host that wants
 * one surface scoped narrower.
 */
export function useCustomNodeDefinitions(
  nodes: readonly AnyCustomNodeDefinition[] | undefined
): readonly AnyCustomNodeDefinition[] {
  const editor = useDocxEditor();
  return useMemo(() => {
    if (nodes) return nodes;
    return (editor?.getCustomNodeDefinitions() ?? []).filter(isCustomNodeDefinition);
  }, [nodes, editor]);
}

/** The painted boundary rect element the engine draws per line of a control. */
export const CUSTOM_NODE_BOUNDARY = '.docx-content-control-boundary';

/**
 * What {@link resolveCustomNodeActivation} found under a pointer target.
 *
 * The RAW decode, before the definition's `fromDocx` has had its say — use
 * `activatedCustomNodeOf` for the enriched form every host hook receives.
 *
 * @public
 */
export interface ResolvedCustomNodeActivation {
  /** RAW decode: attrs straight from the tag, `fromDocx` not yet applied. */
  readonly node: ActivatedCustomNode;
  readonly definition: AnyCustomNodeDefinition;
  /** The control's canonical node id, from the chrome layer — for review-item lookups. */
  readonly controlId: string | null;
}

/**
 * The recognized custom node a pointer target sits on, or null.
 *
 * Every input here is DOM the engine painted from file data — the tag is
 * attacker-controlled and goes through the codec's guards, never into markup.
 */
/**
 * The activation every host hook receives: identity, POST-`fromDocx` attrs, and — when the
 * review module derived a card for the node — its literal text and canonical node id.
 *
 * One enrichment step for every surface (click, hover, edit, context-menu card), so a hook
 * written against the review rail's attrs shape sees the SAME shape from the chip. Without
 * a review module the definition's `fromDocx` runs over the raw decode with `text: ''`;
 * its veto (null) drops the activation, exactly as recognition would have.
 */
export function activatedCustomNodeOf(
  resolved: ResolvedCustomNodeActivation,
  editor: Editor | null | undefined
): ActivatedCustomNode | null {
  const { node, definition, controlId } = resolved;
  const placement = controlId
    ? editor
        ?.getReviewItems()
        .find((entry) => entry.kind === 'custom' && entry.item.id === controlId)
    : undefined;
  if (placement && placement.kind === 'custom') {
    const item = placement.item;
    return {
      ...node,
      attrs: item.attrs,
      text: item.text,
      ...(item.data === undefined ? {} : { data: item.data }),
      ...(controlId ? { nodeId: controlId } : {}),
    };
  }
  // The fallback path: no review item for this control. `text` is genuinely unavailable here
  // (the DOM decode cannot see it), but the PAYLOAD is — it lives in the package, which the
  // editor has. Resolving it means a definition that folds payload values into its attrs does
  // not silently degrade on this branch.
  const data = controlId ? payloadOf(editor, controlId, definition) : undefined;
  const attrs = definition.fromDocx
    ? definition.fromDocx({ attrs: node.attrs, text: '', ...(data === undefined ? {} : { data }) })
    : node.attrs;
  if (attrs === null) return null;
  return {
    ...node,
    attrs,
    ...(data === undefined ? {} : { data }),
    ...(controlId ? { nodeId: controlId } : {}),
  };
}

/**
 * One control's payload, straight from the package.
 *
 * Through the same instance-only surface the write path uses. It is an escape hatch, and the
 * alternative was worse: `data` reaching a host only when a review module happened to be
 * registered is a capability that appears and disappears for a reason nothing on screen explains.
 */
function payloadOf(
  editor: Editor | null | undefined,
  controlId: string,
  definition: AnyCustomNodeDefinition
): unknown {
  const surface = (editor as (Editor & { readonly surface?: EditorSurface | null }) | null)
    ?.surface;
  if (!surface) return undefined;
  // The control is in ITS OWN story and the store hangs off the MAIN part, which are different
  // parts. Asking the body for both handed the host `data: undefined` for a chip in a header,
  // so a definition deriving its attrs from the payload produced different attrs there than in
  // the body — silently, because absent data is also what a chip with no payload looks like.
  //
  // The story part comes from the PACKAGE, not from `partFor`. This runs inside a hook, and
  // `partFor` opens a story store that is then retained for the session — a read that spends
  // one of sixty-four slots every time a chip is activated.
  const story = partOfNodeId(surface.session, controlId);
  const source = customNodePayloadsByControl(
    surface.session.currentPackage(),
    (story ?? surface.session.part()).name,
    surface.session.part().name
  ).get(controlId);
  if (!source) return undefined;
  // Through the definition's own schema, so this branch hands back the same checked type the
  // review-item branch does. A payload that fails it arrives absent, exactly as it does there.
  const parsed = parseCustomNodeData(definition.schema, source.data);
  return parsed.ok ? parsed.value : undefined;
}

/**
 * The recognized custom node a pointer target sits on, or null.
 *
 * Walks up from `target` to the painted control boundary, reads its `data-tag`, and matches the
 * decoded identity against `nodes`. Returns null for anything that is not a recognized chip —
 * ordinary text, an unclaimed SDT, a tag no definition owns.
 *
 * Every input is DOM the engine painted from FILE DATA. The tag is attacker-controlled and goes
 * through the codec's guards; it never reaches markup.
 *
 * @public
 */
export function resolveCustomNodeActivation(
  target: EventTarget | null,
  nodes: readonly AnyCustomNodeDefinition[]
): ResolvedCustomNodeActivation | null {
  const boundary = (target as HTMLElement | null)?.closest?.(CUSTOM_NODE_BOUNDARY);
  const layer = boundary?.closest('.docx-content-control-chrome');
  const tag = layer?.getAttribute('data-tag');
  const decoded = tag ? decodeCustomNodeTag(tag) : null;
  if (!boundary || !decoded || !tag) return null;
  const definition = nodes.find(
    (node) => node.tagPrefix === decoded.prefix && node.name === decoded.name
  );
  if (!definition) return null;
  return {
    node: {
      name: decoded.name,
      attrs: decoded.attrs,
      tag,
      rect: boundary.getBoundingClientRect(),
    },
    definition,
    controlId: layer?.getAttribute('data-docx-content-control') ?? null,
  };
}
