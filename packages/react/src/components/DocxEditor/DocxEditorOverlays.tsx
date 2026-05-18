import { Toaster } from 'sonner';
import { HyperlinkPopup, type HyperlinkPopupData } from '../ui/HyperlinkPopup';
import { TextContextMenu, type TextContextMenuItem } from '../TextContextMenu';
import { ImageContextMenu, useImageContextMenu } from '../ImageContextMenu';

interface ContextMenuState {
  isOpen: boolean;
  position: { x: number; y: number };
  hasSelection: boolean;
}

/**
 * Floating overlays painted on top of the editor: the link popup that
 * appears on hyperlink click, the right-click text menu, the image
 * right-click menu, and the toast container. Pulled out as a single
 * component because they always render as a sibling block at the end of
 * the editor tree.
 */
export function DocxEditorOverlays({
  // Hyperlink popup
  hyperlinkPopupData,
  onHyperlinkPopupNavigate,
  onHyperlinkPopupCopy,
  onHyperlinkPopupEdit,
  onHyperlinkPopupRemove,
  onHyperlinkPopupClose,
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
  hyperlinkPopupData: HyperlinkPopupData | null;
  onHyperlinkPopupNavigate: (href: string) => void;
  onHyperlinkPopupCopy: (href: string) => void;
  onHyperlinkPopupEdit: (displayText: string, href: string) => void;
  onHyperlinkPopupRemove: () => void;
  onHyperlinkPopupClose: () => void;
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
      <HyperlinkPopup
        data={hyperlinkPopupData}
        onNavigate={onHyperlinkPopupNavigate}
        onCopy={onHyperlinkPopupCopy}
        onEdit={onHyperlinkPopupEdit}
        onRemove={onHyperlinkPopupRemove}
        onClose={onHyperlinkPopupClose}
        readOnly={readOnly}
      />
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
