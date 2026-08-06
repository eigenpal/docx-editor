/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The custom-node section of the right-click menu: when the press lands on a recognized
// chip, its card data and an "Edit {label}" action render ABOVE the packaged rows.
//
// The context menu is where node interaction lives ON PURPOSE: a left click on the chip
// competes with the caret (the surface owns primary-button presses), while a right-click
// reaches the menu with the selection intact. Compose inside `DocxEditor.ContextMenu`:
//
// ```tsx
// <DocxEditor.ContextMenu>
//   <CustomNodeContextMenu onEditNode={(node) => openMyEditor(node)} />
// </DocxEditor.ContextMenu>
// ```
//
// Definitions default to the ones registered with `customNodesModule` — register once,
// every surface follows.
//
// KNOWN GAP: a keyboard-opened menu (Shift+F10) carries no pointer target, so this
// section cannot appear for it yet; a caret-based fallback is the tracked follow-up.

import { useMemo } from 'react';
import {
  ContextMenuItem,
  useContextMenuTarget,
  useDocxEditor,
  useTranslation,
} from '@docx-editor.dev/react';
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

/**
 * Props for {@link CustomNodeContextMenu}: which definitions get menu sections, and which rows
 * those sections offer.
 *
 * The Edit row renders when either the definition's own `onEdit` or this component's
 * `onEditNode` is present; the Remove row is on by default but only where the node's canonical id
 * can be resolved.
 *
 * @public
 */
export interface CustomNodeContextMenuProps {
  /** Definitions to offer sections for. Defaults to the ones registered on the editor. */
  readonly nodes?: readonly CustomNodeDefinition[];
  /**
   * Component-level edit hook — where host UI state (an edit dialog) belongs, the twin of
   * `CustomNodeChrome`'s `onNodeClick`. Runs after the definition's own `onEdit`. The row
   * renders when EITHER hook is present.
   */
  readonly onEditNode?: (node: ActivatedCustomNode, definition: CustomNodeDefinition) => void;
  /**
   * The "Remove {label}" row, on by default: it deletes the node — wrapper and label, one
   * undo step — via `removeCustomNode`. Rendered only when the node's id is resolvable
   * (a registered review module resolves it). `false` removes the row.
   */
  readonly remove?: boolean;
}

/**
 * Renders the pointed-at node's card data plus its "Edit {label}" row, or nothing when the
 * right-click landed elsewhere. Carries `docxRowPlacement: 'start'`, so the context menu
 * mounts it above the packaged rows.
 *
 * @public
 */
export function CustomNodeContextMenu(props: CustomNodeContextMenuProps) {
  const { onEditNode, remove = true } = props;
  const nodes = useCustomNodeDefinitions(props.nodes);
  const target = useContextMenuTarget();
  const editor = useDocxEditor();
  const { t } = useTranslation();
  const resolved = useMemo(
    () => (target ? resolveCustomNodeActivation(target, nodes) : null),
    [target, nodes]
  );
  // The ENRICHED activation: post-`fromDocx` attrs, plus text/nodeId when the review
  // module resolves the node — one shape across every surface.
  const node = useMemo(
    () => (resolved ? activatedCustomNodeOf(resolved, editor) : null),
    [resolved, editor]
  );
  const card = useMemo(() => {
    if (!resolved?.definition.reviewCard || !node) return null;
    // `data` too: without it the info block silently rendered the no-payload branch of a hook
    // whose whole point is the payload.
    return resolved.definition.reviewCard({
      attrs: node.attrs,
      text: node.text ?? '',
      ...(node.data === undefined ? {} : { data: node.data }),
    });
  }, [resolved, node]);
  if (!resolved || !node) return null;
  const { definition } = resolved;
  const label = definition.label ?? definition.name;
  const editable = definition.onEdit !== undefined || onEditNode !== undefined;
  const removable = remove && node.nodeId !== undefined && editor !== null;
  if (!card && !editable && !removable) return null;
  return (
    <>
      {card ? (
        // Informational, not a row: every string here is file-derived or hook-derived and
        // renders as TEXT.
        <div className="docx-contextmenu__custom-info" data-testid="custom-node-info">
          <span className="docx-contextmenu__custom-title">{card.title}</span>
          {card.detail ? (
            <span className="docx-contextmenu__custom-detail">{card.detail}</span>
          ) : null}
        </div>
      ) : null}
      {editable ? (
        <ContextMenuItem
          label={t('contextMenu.editCustomNode', { label })}
          className="docx-contextmenu__custom-edit"
          onSelect={() => {
            definition.onEdit?.(node);
            onEditNode?.(node, definition);
          }}
        />
      ) : null}
      {removable ? (
        <ContextMenuItem
          label={t('contextMenu.removeCustomNode', { label })}
          className="docx-contextmenu__custom-remove"
          onSelect={() => {
            removeCustomNode(editor!, node.nodeId!);
          }}
        />
      ) : null}
      {/* The menu's own separator markup — the value is not exported bare from the
          adapter, and a second separator implementation would be a place to drift. */}
      <div role="separator" className="docx-toolbar__menu-separator" />
    </>
  );
}

CustomNodeContextMenu.docxRowPlacement = 'start' as const;
