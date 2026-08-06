/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Chip chrome for custom nodes: definition-driven color, click and hover — the
// generic form of what a host would otherwise hand-write with CSS and DOM
// delegation. Mount once inside `DocxEditor.Root`.
//
// HOW IT WORKS: the engine paints a chrome layer per content control carrying
// the control's `w:tag` (`data-tag`) with boundary rects over the painted text.
// This component injects per-definition styles keyed on the tag prefix
// (createElement + textContent — never HTML-from-strings) and delegates
// click/hover on the boundary layers, decoding the tag back into attrs.
//
// Layout publishes one boundary rect per LINE at the text's vertical extent,
// so a wrapped control tints exactly its own words and clicks land on the
// rect that was painted.

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
 * The two hooks are the COMPONENT-level twins of a definition's own `onClick`/`onHover`. Host UI
 * state — a popover, a dialog — belongs here rather than on the definition, which is shared by
 * every surface and has no React context to close over.
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
 * The chrome-layer selectors for one definition, or none when its identity fails the
 * charset.
 *
 * Two guards in one place. The charset check is defense in depth: registration paths that
 * skip `defineCustomNode` (a raw object handed to `customNodesModule`) could carry
 * selector-hostile characters, and this string lands in a page-global `<style>` element.
 * The match is EXACT-or-query-prefixed, never bare `^=`: a prefix match also claimed
 * `acme:citationXX`, so a hostile document could dress an unrecognized SDT in this
 * definition's trusted chip styling.
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
 * Renders nothing itself — it installs the per-definition chip styles and the click/hover
 * listeners, so mount it once anywhere inside the editor provider. Chip colours come from each
 * definition's `chrome`, which is HOST-authored and never file data.
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

  // Per-definition chip styles. Colors are HOST-authored; validated anyway so a
  // typo cannot produce a broken rule.
  useEffect(() => {
    const style = document.createElement('style');
    const rules: string[] = [];
    for (const definition of nodes) {
      const selectors = layerSelectors(definition);
      if (selectors.length === 0) continue;
      const color =
        definition.chrome?.color !== undefined && CSS.supports('color', definition.chrome.color)
          ? definition.chrome.color
          : '#2563eb';
      rules.push(
        `${selectors.map((selector) => `${selector} ${BOUNDARY}`).join(', ')} {`,
        '  pointer-events: auto !important;',
        '  opacity: 1;',
        // Borderless by design: a soft tint reads as a chip.
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

  // Delegated activation: boundary → chrome layer → tag → definition → ENRICHED node
  // (post-`fromDocx` attrs; text/nodeId when the review module can resolve them), so a
  // hook written against the review rail's attrs shape sees the same shape from the chip.
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      // Resolve from the click POINT when the target does not answer. Pressing a chip moves
      // the caret into it, which repaints the control — so the boundary the press landed on
      // is gone by mouseup, and the browser dispatches `click` on the nearest surviving
      // ancestor (the pages layer) instead. `elementFromPoint` sees the repainted boundary
      // that is there now, and a drag that ends elsewhere still resolves to nothing.
      const resolved =
        resolveCustomNodeActivation(event.target, nodes) ??
        resolveCustomNodeActivation(document.elementFromPoint(event.clientX, event.clientY), nodes);
      if (!resolved) return;
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
    document.addEventListener('click', onClick);
    document.addEventListener('mouseover', onOver);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('mouseover', onOver);
    };
  }, [nodes, editor, onNodeClick, onNodeHover]);

  return null;
}
