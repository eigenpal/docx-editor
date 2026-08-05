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
// KNOWN LIMIT (ledger 4.5): a control that wraps across lines currently gets
// ONE union boundary rect from layout, so an oversized chip can cover
// neighboring words. The default styling is therefore a soft borderless tint;
// per-line fragments are the engine follow-up.

import { useEffect } from 'react';
import {
  type ActivatedCustomNode,
  type CustomNodeDefinition,
} from '../custom-nodes/define-custom-node.ts';
import { decodeCustomNodeTag } from '../custom-nodes/tag-codec.ts';

export interface CustomNodeChromeProps {
  readonly nodes: readonly CustomNodeDefinition[];
  /** Component-level activation hook — where host UI state (popovers) belongs. */
  readonly onNodeClick?: (node: ActivatedCustomNode) => void;
  readonly onNodeHover?: (node: ActivatedCustomNode) => void;
}

const BOUNDARY = '.docx-content-control-boundary';
const layerSelector = (definition: CustomNodeDefinition): string =>
  `.docx-content-control-chrome[data-tag^="${definition.tagPrefix}:${definition.name}"]`;

export function CustomNodeChrome(props: CustomNodeChromeProps): null {
  const { nodes, onNodeClick, onNodeHover } = props;

  // Per-definition chip styles. Colors are HOST-authored; validated anyway so a
  // typo cannot produce a broken rule.
  useEffect(() => {
    const style = document.createElement('style');
    const rules: string[] = [];
    for (const definition of nodes) {
      const color =
        definition.chrome?.color !== undefined && CSS.supports('color', definition.chrome.color)
          ? definition.chrome.color
          : '#2563eb';
      rules.push(
        `${layerSelector(definition)} ${BOUNDARY} {`,
        '  pointer-events: auto !important;',
        '  opacity: 1;',
        // Borderless by design: a soft tint reads as a chip without amplifying
        // the union-rect geometry limit noted above.
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

  // Delegated activation: boundary → chrome layer → tag → definition.
  useEffect(() => {
    const activationOf = (target: EventTarget | null): ActivatedCustomNode | null => {
      const boundary = (target as HTMLElement | null)?.closest?.(BOUNDARY);
      const tag = boundary?.closest('.docx-content-control-chrome')?.getAttribute('data-tag');
      const decoded = tag ? decodeCustomNodeTag(tag) : null;
      if (!boundary || !decoded || !tag) return null;
      const definition = nodes.find(
        (node) => node.tagPrefix === decoded.prefix && node.name === decoded.name
      );
      if (!definition) return null;
      return { name: decoded.name, attrs: decoded.attrs, tag, rect: boundary.getBoundingClientRect() };
    };
    const definitionOf = (node: ActivatedCustomNode) =>
      nodes.find((entry) => entry.name === node.name)!;
    const onClick = (event: MouseEvent) => {
      const node = activationOf(event.target);
      if (!node) return;
      definitionOf(node).onClick?.(node);
      onNodeClick?.(node);
    };
    const onOver = (event: MouseEvent) => {
      const node = activationOf(event.target);
      if (!node) return;
      const related = (event.relatedTarget as HTMLElement | null)?.closest?.(BOUNDARY);
      if (related === (event.target as HTMLElement).closest(BOUNDARY)) return;
      definitionOf(node).onHover?.(node);
      onNodeHover?.(node);
    };
    document.addEventListener('click', onClick);
    document.addEventListener('mouseover', onOver);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('mouseover', onOver);
    };
  }, [nodes, onNodeClick, onNodeHover]);

  return null;
}
