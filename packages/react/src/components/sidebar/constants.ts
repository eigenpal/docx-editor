// Sidebar geometry.
//
// Legacy re-exported these from `@docx-editor.dev/core/utils/sidebarConstants`. The
// greenfield core has no sidebar constants — sidebar geometry is adapter chrome, not
// engine state — so the VALUES are copied verbatim from that file rather than re-derived.
// `SIDEBAR_DOCUMENT_SHIFT` keeps its legacy derivation, so the document offset is exactly
// what the legacy shell computed.
export const SIDEBAR_WIDTH = 340;
export const SIDEBAR_PAGE_GAP = 12;
export const SIDEBAR_DOCUMENT_SHIFT = (SIDEBAR_PAGE_GAP + SIDEBAR_WIDTH) / 2;
export const MIN_CARD_GAP = 8;
