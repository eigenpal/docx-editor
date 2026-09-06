// What `openPaginated` takes: the options record of the paginated surface.
//
// Split from `paginated-surface-contract.ts`, which is long enough to hold the surface
// interface alone; the record is only ever read at open time, and every consumer imports it
// from the contract, which re-exports it.

import type { RevisionDisplayMode } from '../layout/revision-projection.ts';
import type { RevisionStyles } from '../output/revision-presentation.ts';
import type { FieldShadingMode } from '../output/semantic-paint.ts';
import type {
  ReviewModuleContribution,
  CollaborationModuleContribution,
} from '../contracts/modules.ts';
import type { EquationActivation } from './surface-equations.ts';
import type { HyperlinkActivation } from './surface-navigation.ts';
import type { TextMeasurer } from '@docx-editor.dev/core/layout';
import type { PaginatedSurfaceState, SurfaceEditingMode } from './paginated-surface-contract.ts';

/**
 * How a paginated surface opens. Every field is optional.
 *
 * `measurer` is the injection seam that keeps layout DOM-free — supply one to lay a document out
 * on a server, or leave it off in a browser to get the canvas measurer.
 */
export interface PaginatedSurfaceOptions {
  /**
   * The collaboration module's replica for this surface's session. Absent,
   * the surface does not attach, and local store history remains the undo
   * authority.
   */
  readonly collaborationModel?: CollaborationModuleContribution;
  readonly measurer?: TextMeasurer;
  /** Ambient author for tracked edits. Required before suggesting can write anything. */
  readonly author?: string;
  /** Opening mode; changeable at runtime with `setEditingMode`. */
  readonly editingMode?: SurfaceEditingMode;
  /**
   * Identifies the measurer for cache invalidation.
   *
   * Fonts resolve asynchronously, so a host that swaps its measurer must change this or the
   * cached pre-font layout is served for the rest of the session.
   */
  readonly producer?: string;
  /**
   * Maps a document-declared font family to the alias its registered bytes live under, so
   * painted runs can use embedded glyphs without the file's family name entering the
   * page-global CSS font namespace.
   */
  readonly fontAlias?: (family: string) => string | undefined;
  /** Points to CSS pixels. */
  readonly scale?: number;
  /**
   * How revisions project into layout and paint. Omitted keeps the layout default
   * (`all-markup`). The editor facade passes `proposed` when no review module is
   * registered — the free tier's final-state rendering; the machinery below this
   * option is shared either way.
   */
  readonly revisionDisplayMode?: RevisionDisplayMode;
  /** Authors whose changes open in their accepted view-time projection. */
  readonly hiddenRevisionAuthors?: readonly string[];
  /**
   * When a field's result wears Word's grey shading. Omitted keeps Word's own default,
   * `when-selected`.
   *
   * Applies to ORDINARY fields only. Legacy form fields follow the document's
   * `w:doNotShadeFormData`, because a form's blanks are the document's own statement about
   * itself rather than a reader's preference.
   *
   * A paint-level option, not a layout one: it changes no geometry, so switching it repaints
   * without remeasuring a single line.
   */
  readonly fieldShading?: FieldShadingMode;
  /**
   * How tracked changes are coloured: by AUTHOR (the default), by kind, or by author with
   * host-pinned colours. A paint-level option like {@link fieldShading}: it changes no
   * geometry, so switching it repaints without remeasuring a line. Applies wherever
   * revision markup paints, whatever the {@link revisionDisplayMode} leaves visible.
   */
  readonly revisionStyles?: RevisionStyles;
  /**
   * The review module's derivation hooks for this surface's session. Absent,
   * `session.reviewItems()` is the typed empty queue and every review affordance
   * built on it stays inert.
   */
  readonly reviewModel?: ReviewModuleContribution;
  /**
   * The family a run with no authored font is reported as by `formatting()` AND painted
   * in — the face the measurer falls back to. Absent, such a run reports
   * `fontFamily: null` and paints in whatever font the page inherits, which the measurer
   * did not measure: visible glyphs drift from wrap points and caret geometry.
   */
  readonly defaultFontFamily?: string;
  /**
   * Who resolves a pointer to a caret.
   *
   * `'engine'` (the default) answers from the layout records, which is what makes a click in
   * a margin, an indent or a cell's padding land where it was aimed. `'native'` binds no
   * pointer handlers and leaves the browser's own caret placement in charge.
   */
  readonly pointer?: 'engine' | 'native';
  readonly onChange?: (state: PaginatedSurfaceState) => void;
  /**
   * A plain click on an external (or inert) hyperlink, for a host to open its popover with.
   *
   * Absent means such a click does nothing. That is deliberate: a host with no popover
   * mounted must not have clicks silently opening tabs, and the popover is the only path to
   * activation (see the navigation module's single `window.open` gate).
   */
  readonly onHyperlinkPopover?: (activation: HyperlinkActivation) => void;
  readonly onEquationPopover?: (activation: EquationActivation) => void;
  /**
   * Ctrl/Cmd+K — Word's Insert Hyperlink. The engine reports the request; the host's chrome
   * decides what a link dialog looks like. A host that passes nothing leaves the key alone
   * rather than doing something surprising with it.
   */
  readonly onRequestHyperlink?: () => void;
  /**
   * Localized accessible names for core-owned table insertion furniture.
   * Defaults to English from `@docx-editor.dev/i18n` when omitted.
   */
  readonly tableInteractionLabel?: (
    key: 'table.insertRowBelow' | 'table.insertColumnRight'
  ) => string;
  /** Localized drawing refusal labels; defaults to English when omitted. */
  readonly drawingStrings?: import('../output/semantic-paint-drawings.ts').DrawingPaintStrings;
  /** Override raster decode for package image intents; defaults to browser/headless. */
  readonly imageDecodePort?: import('../store/package/image-resources.ts').ImageDecodePort;
  /**
   * Localized name for a generated TOC, written as the control's `w:alias` on insert.
   *
   * The update ACTIONS are not here: they are rows in the host's context menu, which owns
   * its own labels. The engine paints no menu of its own.
   */
  readonly tocLabels?: { readonly title: string };
}
