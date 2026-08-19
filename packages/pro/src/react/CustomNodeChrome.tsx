/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Chip chrome for custom nodes: per-definition colour, plus click and hover.
// Mount once inside `DocxEditor.Root`.

import { useEffect } from 'react';
import { useDocxEditor } from '@docx-editor.dev/react';
import {
  CUSTOM_NODE_IDENTITY_PATTERN,
  type ActivatedCustomNode,
  type CustomNodeDefinition,
} from '../custom-nodes/define-custom-node.ts';
import {
  activatedCustomNodeOf,
  resolveCustomNodeActivation,
  useCustomNodeDefinitions,
} from './custom-node-activation.ts';

/**
 * Props for {@link CustomNodeChrome}: which definitions to paint, and where activation goes.
 *
 * The two hooks are the component-level twins of a definition's own `onClick`/`onHover`. Host UI
 * state belongs here rather than on the definition, which every surface shares and which has no
 * React context to close over.
 *
 * @public
 */
export interface CustomNodeChromeProps {
  /** Definitions to style and dispatch on. Defaults to the ones registered on the editor. */
  readonly nodes?: readonly CustomNodeDefinition[];
  /** Component-level activation hook — where host UI state (popovers) belongs. */
  readonly onNodeClick?: (node: ActivatedCustomNode) => void;
  readonly onNodeHover?: (node: ActivatedCustomNode) => void;
}

const BOUNDARY = '.docx-content-control-boundary';

/**
 * The chrome-layer selectors for one definition, or none when its identity fails the charset.
 *
 * The identity lands in a page-global `<style>`, so it is charset-checked even though
 * `defineCustomNode` already does — a raw object handed to `customNodesModule` skips that.
 * Exact-or-query-prefixed, never bare `^=`, which also matched `acme:citationXX`.
 */
const layerSelectors = (definition: CustomNodeDefinition): readonly string[] => {
  if (
    !CUSTOM_NODE_IDENTITY_PATTERN.test(definition.tagPrefix) ||
    !CUSTOM_NODE_IDENTITY_PATTERN.test(definition.name)
  ) {
    return [];
  }
  const identity = `${definition.tagPrefix}:${definition.name}`;
  return [
    `.docx-content-control-chrome[data-tag="${identity}"]`,
    `.docx-content-control-chrome[data-tag^="${identity}?"]`,
  ];
};

/**
 * Paints custom-node chips and dispatches pointer activation on them.
 *
 * Renders nothing itself — it installs the chip styles and the activation listeners, so mount it
 * once anywhere inside the editor provider. Chip colours come from each definition's `chrome`,
 * which is host-authored and never file data.
 *
 * @example
 * ```tsx
 * <DocxEditor.Root>
 *   <CustomNodeChrome onNodeClick={(node) => setPopover(node)} />
 *   <DocxEditor.Viewport><DocxEditor.Content /></DocxEditor.Viewport>
 * </DocxEditor.Root>
 * ```
 *
 * @public
 */
export function CustomNodeChrome(props: CustomNodeChromeProps): null {
  const { onNodeClick, onNodeHover } = props;
  const editor = useDocxEditor();
  const nodes = useCustomNodeDefinitions(props.nodes);

  // Colours are host-authored; validated anyway so a typo cannot produce a broken rule.
  useEffect(() => {
    const style = document.createElement('style');
    const rules: string[] = [];
    for (const definition of nodes) {
      const selectors = layerSelectors(definition);
      if (selectors.length === 0) continue;
      const color =
        definition.chrome?.color !== undefined && CSS.supports('color', definition.chrome.color)
          ? definition.chrome.color
          : 'var(--doc-accent)';
      rules.push(
        `${selectors.map((selector) => `${selector} ${BOUNDARY}`).join(', ')} {`,
        '  pointer-events: auto !important;',
        '  opacity: 1;',
        '  border: none;',
        `  background: color-mix(in srgb, ${color} 12%, transparent);`,
        '  border-radius: 6px;',
        '  cursor: default;',
        '}'
      );
    }
    style.textContent = rules.join('\n');
    document.head.append(style);
    return () => style.remove();
  }, [nodes]);

  useEffect(() => {
    // Press and release, not `click`. Pressing a chip moves the caret into it, which repaints
    // the control and detaches the boundary the press landed on — leaving the browser no common
    // ancestor to dispatch `click` on, so it fires none.
    let pressedControl: string | null = null;
    let pressedTag: string | null = null;
    // By point, not by target: the event's own target may already be detached.
    const controlAt = (event: PointerEvent) =>
      resolveCustomNodeActivation(document.elementFromPoint(event.clientX, event.clientY), nodes);
    const onDown = (event: PointerEvent) => {
      // Primary button only: a right-click belongs to the context menu.
      const resolved = event.button === 0 ? controlAt(event) : null;
      pressedControl = resolved?.controlId ?? null;
      pressedTag = resolved?.node.tag ?? null;
    };
    const onUp = (event: PointerEvent) => {
      const wasControl = pressedControl;
      const wasTag = pressedTag;
      pressedControl = null;
      pressedTag = null;
      if (wasTag === null) return;
      const resolved = controlAt(event);
      // The same control, so a drag that ends elsewhere activates nothing.
      if (!resolved || resolved.node.tag !== wasTag) return;
      if (wasControl !== null && resolved.controlId !== wasControl) return;
      const node = activatedCustomNodeOf(resolved, editor);
      if (!node) return;
      resolved.definition.onClick?.(node);
      onNodeClick?.(node);
    };
    const onOver = (event: MouseEvent) => {
      const resolved = resolveCustomNodeActivation(event.target, nodes);
      if (!resolved) return;
      const related = (event.relatedTarget as HTMLElement | null)?.closest?.(BOUNDARY);
      if (related === (event.target as HTMLElement).closest(BOUNDARY)) return;
      const node = activatedCustomNodeOf(resolved, editor);
      if (!node) return;
      resolved.definition.onHover?.(node);
      onNodeHover?.(node);
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('pointerup', onUp, true);
    document.addEventListener('mouseover', onOver);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('pointerup', onUp, true);
      document.removeEventListener('mouseover', onOver);
    };
  }, [nodes, editor, onNodeClick, onNodeHover]);

  return null;
}
