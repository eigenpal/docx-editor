import { Toaster } from 'sonner';
import { TextContextMenu, type TextContextMenuItem } from '../TextContextMenu';
import { ImageContextMenu, useImageContextMenu } from '../ImageContextMenu';

interface ContextMenuState {
  isOpen: boolean;
  position: { x: number; y: number };
  hasSelection: boolean;
}

/**
 * Floating overlays painted on top of the editor: the right-click text
 * menu, the image right-click menu, and the toast container. Pulled out
 * as a single component because they always render as a sibling block at
 * the end of the editor tree.
 *
 * The hyperlink popup lives inside PagedEditor's root container — it
 * needs to share a scroll context with the link so CSS handles the
 * follow-on-scroll for free, with no JS listener.
 */
export function DocxEditorOverlays({
  // Right-click text menu
  contextMenu,
  contextMenuItems,
  onContextMenuAction,
  onContextMenuClose,
  // Image right-click menu
  imageContextMenu,
  onImageWrapApply,
  imageContextMenuTextActions,
  onOpenImageProperties,
  // Shared
  readOnly,
}: {
  contextMenu: ContextMenuState;
  contextMenuItems: TextContextMenuItem[];
  onContextMenuAction: React.ComponentProps<typeof TextContextMenu>['onAction'];
  onContextMenuClose: () => void;
  imageContextMenu: ReturnType<typeof useImageContextMenu>;
  onImageWrapApply: React.ComponentProps<typeof ImageContextMenu>['onApplyLayout'];
  imageContextMenuTextActions: React.ComponentProps<typeof ImageContextMenu>['textActions'];
  onOpenImageProperties: () => void;
  readOnly: boolean;
}) {
  return (
    <>
      <TextContextMenu
        isOpen={contextMenu.isOpen}
        position={contextMenu.position}
        hasSelection={contextMenu.hasSelection}
        isEditable={!readOnly}
        items={contextMenuItems}
        onAction={onContextMenuAction}
        onClose={onContextMenuClose}
      />
      <ImageContextMenu
        isOpen={imageContextMenu.isOpen}
        position={imageContextMenu.position}
        currentWrapType={imageContextMenu.currentWrapType}
        currentCssFloat={imageContextMenu.currentCssFloat}
        onApplyLayout={onImageWrapApply}
        textActions={imageContextMenuTextActions}
        onTextAction={onContextMenuAction}
        onOpenProperties={onOpenImageProperties}
        onClose={imageContextMenu.closeMenu}
      />
      <Toaster position="bottom-right" />
    </>
  );
}
