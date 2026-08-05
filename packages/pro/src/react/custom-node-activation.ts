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
  type CustomNodeDefinition,
} from '../custom-nodes/define-custom-node.ts';
import { decodeCustomNodeTag } from '../custom-nodes/tag-codec.ts';

/**
 * The definitions a chrome surface should act on: the `nodes` prop when given, else the
 * definitions registered on the editor (`customNodesModule`). Registering once and letting
 * every surface default to it is the intended shape; the prop exists for a host that wants
 * one surface scoped narrower.
 */
export function useCustomNodeDefinitions(
  nodes: readonly CustomNodeDefinition[] | undefined
): readonly CustomNodeDefinition[] {
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
  readonly definition: CustomNodeDefinition;
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
      ...(controlId ? { nodeId: controlId } : {}),
    };
  }
  const attrs = definition.fromDocx
    ? definition.fromDocx({ attrs: node.attrs, text: '' })
    : node.attrs;
  if (attrs === null) return null;
  return { ...node, attrs, ...(controlId ? { nodeId: controlId } : {}) };
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
  nodes: readonly CustomNodeDefinition[]
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
