/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

import { computed, defineComponent, Fragment, type PropType } from 'vue';
import {
  ContextMenuItem,
  useContextMenuTarget,
  useDocxEditor,
  useTranslation,
} from '@docx-editor.dev/vue';
import {
  type ActivatedCustomNode,
  type CustomNodeDefinition,
} from '../custom-nodes/define-custom-node.ts';
import { removeCustomNode } from '../custom-nodes/update-custom-node.ts';
import {
  activatedCustomNodeOf,
  resolveCustomNodeActivation,
  useCustomNodeDefinitions,
} from './custom-node-activation.ts';

/** Props for the custom-node context-menu section. @public */
export interface CustomNodeContextMenuProps {
  /** Definitions to offer. Defaults to definitions registered on the editor. */
  readonly nodes?: readonly CustomNodeDefinition[];
  /** Runs after the definition's own edit hook. */
  readonly onEditNode?: (node: ActivatedCustomNode, definition: CustomNodeDefinition) => void;
  /** Adds the remove row. Defaults to `true`. */
  readonly remove?: boolean;
  /** Receives the engine reason when removal is refused. */
  readonly onRemoveRefused?: (node: ActivatedCustomNode, reason: string) => void;
}

/**
 * Adds custom-node information, edit, and remove rows to the context menu.
 *
 * Place this component inside `DocxEditorContextMenu`.
 *
 * @public
 */
export const CustomNodeContextMenu = Object.assign(
  defineComponent({
    name: 'CustomNodeContextMenu',
    props: {
      nodes: {
        type: Array as PropType<readonly CustomNodeDefinition[]>,
        default: undefined,
      },
      onEditNode: {
        type: Function as PropType<
          (node: ActivatedCustomNode, definition: CustomNodeDefinition) => void
        >,
        default: undefined,
      },
      remove: { type: Boolean, default: true },
      onRemoveRefused: {
        type: Function as PropType<(node: ActivatedCustomNode, reason: string) => void>,
        default: undefined,
      },
    },
    setup(props) {
      const nodes = useCustomNodeDefinitions(() => props.nodes);
      const target = useContextMenuTarget();
      const editorRef = useDocxEditor();
      const { t } = useTranslation();
      const resolved = computed(() => resolveCustomNodeActivation(target, nodes.value));
      const node = computed(() => {
        const current = resolved.value;
        return current ? activatedCustomNodeOf(current, editorRef.value) : null;
      });
      const card = computed(() => {
        const current = resolved.value;
        const active = node.value;
        if (!current?.definition.reviewCard || !active) return null;
        return current.definition.reviewCard({
          attrs: active.attrs,
          text: active.text ?? '',
          ...(active.data === undefined ? {} : { data: active.data }),
        });
      });

      return () => {
        const current = resolved.value;
        const active = node.value;
        if (!current || !active) return null;
        const { definition } = current;
        const label = definition.label ?? definition.name;
        const editable = definition.onEdit !== undefined || props.onEditNode !== undefined;
        const removable = props.remove && active.nodeId !== undefined && editorRef.value !== null;
        if (!card.value && !editable && !removable) return null;
        return (
          <Fragment>
            {card.value ? (
              <div class="docx-contextmenu__custom-info" data-testid="custom-node-info">
                <span class="docx-contextmenu__custom-title">{card.value.title}</span>
                {card.value.detail ? (
                  <span class="docx-contextmenu__custom-detail">{card.value.detail}</span>
                ) : null}
              </div>
            ) : null}
            {editable ? (
              <ContextMenuItem
                label={t('contextMenu.editCustomNode', { label })}
                className="docx-contextmenu__custom-edit"
                onSelect={() => {
                  definition.onEdit?.(active);
                  props.onEditNode?.(active, definition);
                }}
              />
            ) : null}
            {removable ? (
              <ContextMenuItem
                label={t('contextMenu.removeCustomNode', { label })}
                className="docx-contextmenu__custom-remove"
                onSelect={() => {
                  const result = removeCustomNode(editorRef.value!, active.nodeId!);
                  if (!result.ok) props.onRemoveRefused?.(active, result.reason);
                }}
              />
            ) : null}
            <div role="separator" class="docx-toolbar__menu-separator" />
          </Fragment>
        );
      };
    },
  }),
  {
    docxRowPlacement: 'start' as const,
  }
) as unknown as {
  readonly docxRowPlacement: 'start';
  new (): { $props: CustomNodeContextMenuProps };
};
