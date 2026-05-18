/**
 * Shared `ImageContextMenuState` + `ImageContextMenuTextAction` types
 * — imported by `ImageContextMenu.vue` (for `defineProps`) and
 * `useContextMenus.ts` (for the composable's `imageContextMenu` ref).
 * Pulled out of the .vue SFC so a plain .ts module can reference it
 * without going through the `*.vue` wildcard shim, which doesn't
 * carry named type exports.
 */

import type { WrapType } from '@eigenpal/docx-editor-core/docx/wrapTypes';

type ImageAttrsCssFloat = 'left' | 'right' | 'none' | null;

export interface ImageContextMenuState {
  open: boolean;
  position: { x: number; y: number };
  pmPos: number;
  currentWrapType: WrapType;
  currentCssFloat?: ImageAttrsCssFloat;
  inlinePositionEmu?: { horizontalEmu: number; verticalEmu: number };
}

/**
 * Item appended below a divider — mirrors the React side
 * (`ImageContextMenuTextAction`). `dividerAfter` lets the host group
 * the items the same way Word does (Cut/Copy/Paste then divider then
 * Delete).
 */
export interface ImageContextMenuTextAction {
  action: string;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  dividerAfter?: boolean;
}
