/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

import { computed, toValue, type ComputedRef, type MaybeRefOrGetter } from 'vue';
import { useDocxEditor } from '@docx-editor.dev/vue';
import type { Editor } from '@docx-editor.dev/core/contracts/editor';
import { customNodePayloadsByControl } from '@docx-editor.dev/core/store';
import { storyScopeOfId } from '../custom-nodes/insert-custom-node.ts';
import type { PaginatedSurface as EditorSurface } from '@docx-editor.dev/core/editor';
import {
  isCustomNodeDefinition,
  type ActivatedCustomNode,
  type AnyCustomNodeDefinition,
} from '../custom-nodes/define-custom-node.ts';
import { parseCustomNodeData } from '../custom-nodes/data-schema.ts';
import { decodeCustomNodeTag } from '../custom-nodes/tag-codec.ts';

/** Returns custom-node definitions from a prop or the mounted editor. @public */
export function useCustomNodeDefinitions(
  nodes?: MaybeRefOrGetter<readonly AnyCustomNodeDefinition[] | undefined>
): ComputedRef<readonly AnyCustomNodeDefinition[]> {
  const editorRef = useDocxEditor();
  return computed(() => {
    const supplied = toValue(nodes);
    if (supplied) return supplied;
    return (editorRef.value?.getCustomNodeDefinitions() ?? []).filter(isCustomNodeDefinition);
  });
}

/** CSS selector for a painted custom-node boundary. @public */
export const CUSTOM_NODE_BOUNDARY = '.docx-content-control-boundary';

/** A custom-node definition and decoded node under a pointer target. @public */
export interface ResolvedCustomNodeActivation {
  readonly node: ActivatedCustomNode;
  readonly definition: AnyCustomNodeDefinition;
  readonly controlId: string | null;
}

/** Resolves the host-facing custom-node activation payload. @public */
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
  if (placement?.kind === 'custom') {
    const item = placement.item;
    return {
      ...node,
      attrs: item.attrs,
      text: item.text,
      ...(item.data === undefined ? {} : { data: item.data }),
      ...(controlId ? { nodeId: controlId } : {}),
    };
  }
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
  const story = surface.session.partFor(storyScopeOfId(editor as Editor, controlId));
  const source = customNodePayloadsByControl(
    surface.session.currentPackage(),
    (story ?? surface.session.part()).name,
    surface.session.part().name
  ).get(controlId);
  if (!source) return undefined;
  const parsed = parseCustomNodeData(definition.schema, source.data);
  return parsed.ok ? parsed.value : undefined;
}

/** Resolves a painted pointer target to a registered custom-node definition. @public */
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
