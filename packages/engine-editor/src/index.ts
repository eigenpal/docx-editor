// @docx-editor.dev/engine-editor
//
// Browser editor composition root: the production createEditor. Composes the PM-free
// engine-binding edit surface, engine-layout pagination, and engine-output-shaped display into the
// PM-free Editor/EditorHost contract. Becomes @docx-editor.dev/core/editor at the section 7/14
// migration. Production placement: docs/architecture/production-engine-packages.md.
//
// ADR-S9: production modules MUST NOT import from packages/core/spike/**.

/** Stable package identity used by the import-graph / package-authority checks. */
export const ENGINE_EDITOR_PACKAGE = '@docx-editor.dev/engine-editor' as const;

export { createEditor } from './create-editor.ts';
export {
  toDisplayPages,
  overlaysForFrame,
  cssMatrix,
  firstEditableGlyphTarget,
  ONE_SURFACE_CLICK_TARGET,
  type FrameOverlays,
  type GlyphClickTarget,
  type OverlayBox,
} from './display-bridge.ts';
export { colorToCss, runStyle, borderSegLine, type RunStyle, type BorderLine } from './paint-style.ts';
export {
  type EditorDriver,
  type DisplaySnapshot,
  createEditorDriver,
  pageText,
  displayText,
} from './driver.ts';
export { measureInteractionHostMetrics } from './host-metrics.ts';
export {
  attachAdapterEventBridge,
  keyboardIntentKind,
  normalizeClickCount,
  type BridgeEditorPort,
  type BridgeElement,
  type BridgeKeyboardEvent,
  type BridgePointerEvent,
  type KeyboardModifiers,
} from './adapter-event-bridge.ts';
export { emptySemanticIndex } from './interaction-frame.ts';
export {
  generateRulerTicks,
  rulerPageBox,
  PX_PER_INCH,
  PX_PER_CM,
  type RulerTick,
  type RulerUnit,
} from './ruler-ticks.ts';
export {
  runSave,
  runToolbarCommand,
  toolbarCommand,
  toolbarCommandState,
  toolbarCommandStates,
  type ToolbarCommandId,
  type ToolbarCommandState,
} from './toolbar-commands.ts';

export {
  LEGACY_CHROME_GROUPS,
  LEGACY_CHROME_MENUS,
  LEGACY_CHROME_UNAVAILABLE_KEY,
  legacyChromeControlCount,
  type LegacyChromeControl,
  type LegacyChromeControlState,
  type LegacyChromeCommandId,
  type LegacyChromeGroup,
} from './legacy-chrome.ts';
