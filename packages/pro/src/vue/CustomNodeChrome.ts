/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

import { defineComponent, onBeforeUnmount, onMounted, watch, type PropType } from 'vue';
import { useDocxEditor } from '@docx-editor.dev/vue';
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

/** Props for custom-node chip colors and pointer activation. @public */
export interface CustomNodeChromeProps {
  /** Definitions to style. Defaults to definitions registered on the editor. */
  readonly nodes?: readonly CustomNodeDefinition[];
  /** Receives primary-button activation after the definition's own hook. */
  readonly onNodeClick?: (node: ActivatedCustomNode) => void;
  /** Receives pointer-entry activation after the definition's own hook. */
  readonly onNodeHover?: (node: ActivatedCustomNode) => void;
}

const BOUNDARY = '.docx-content-control-boundary';

function layerSelectors(definition: CustomNodeDefinition): readonly string[] {
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
}

/**
 * Applies custom-node chip colors and dispatches click and hover activation.
 *
 * Mount this component once inside `DocxEditorRoot`. It renders no element.
 *
 * @public
 */
export const CustomNodeChrome = defineComponent({
  name: 'CustomNodeChrome',
  props: {
    nodes: {
      type: Array as PropType<readonly CustomNodeDefinition[]>,
      default: undefined,
    },
    onNodeClick: {
      type: Function as PropType<(node: ActivatedCustomNode) => void>,
      default: undefined,
    },
    onNodeHover: {
      type: Function as PropType<(node: ActivatedCustomNode) => void>,
      default: undefined,
    },
  },
  setup(props) {
    const editorRef = useDocxEditor();
    const nodes = useCustomNodeDefinitions(() => props.nodes);
    let stopStyleWatch: (() => void) | undefined;
    let pressedControl: string | null = null;
    let pressedTag: string | null = null;

    const controlAt = (event: PointerEvent) =>
      resolveCustomNodeActivation(
        document.elementFromPoint(event.clientX, event.clientY),
        nodes.value
      );
    const onDown = (event: PointerEvent) => {
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
      if (!resolved || resolved.node.tag !== wasTag) return;
      if (wasControl !== null && resolved.controlId !== wasControl) return;
      const node = activatedCustomNodeOf(resolved, editorRef.value);
      if (!node) return;
      resolved.definition.onClick?.(node);
      props.onNodeClick?.(node);
    };
    const onOver = (event: MouseEvent) => {
      const resolved = resolveCustomNodeActivation(event.target, nodes.value);
      if (!resolved) return;
      const related = (event.relatedTarget as HTMLElement | null)?.closest?.(BOUNDARY);
      if (related === (event.target as HTMLElement).closest(BOUNDARY)) return;
      const node = activatedCustomNodeOf(resolved, editorRef.value);
      if (!node) return;
      resolved.definition.onHover?.(node);
      props.onNodeHover?.(node);
    };

    onMounted(() => {
      stopStyleWatch = watch(
        nodes,
        (definitions, _, onCleanup) => {
          const style = document.createElement('style');
          const rules: string[] = [];
          for (const definition of definitions) {
            const selectors = layerSelectors(definition);
            if (selectors.length === 0) continue;
            const candidate = definition.chrome?.color;
            const color =
              candidate !== undefined &&
              typeof CSS !== 'undefined' &&
              CSS.supports('color', candidate)
                ? candidate
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
          onCleanup(() => style.remove());
        },
        { immediate: true }
      );
      document.addEventListener('pointerdown', onDown, true);
      document.addEventListener('pointerup', onUp, true);
      document.addEventListener('mouseover', onOver);
    });

    onBeforeUnmount(() => {
      stopStyleWatch?.();
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('pointerup', onUp, true);
      document.removeEventListener('mouseover', onOver);
    });

    return () => null;
  },
}) as unknown as {
  new (): { $props: CustomNodeChromeProps };
};
