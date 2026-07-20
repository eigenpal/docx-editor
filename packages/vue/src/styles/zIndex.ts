/**
 * Z-index stacking order for the Vue editor chrome — mirrors
 * `packages/react/src/styles/zIndex.ts` so layered UI stays consistent
 * across adapters instead of drifting into ad-hoc per-component numbers.
 *
 * Order, low to high:
 *   page content (default 0)
 *   selection overlay     — caret + selection rects painted over the pages
 *   decoration layer      — PM-plugin decorations (collab cursors, etc.), just above the local caret
 *   image overlay         — image selection / resize handles
 *   HF inline editor      — header/footer inline editor: above page content, below chrome
 *   ruler                 — must stay readable when the HF editor is active
 *   dropdown / popover     — opens from toolbar buttons or HF options
 *   context menu / modal  — top-most transient surfaces (context menus, dialogs)
 */
export const Z_INDEX = {
  selectionOverlay: 10,
  decorationLayer: 11,
  imageOverlay: 15,
  hfInlineEditor: 10,
  ruler: 30,
  dropdown: 100,
  contextMenu: 10000,
} as const;
