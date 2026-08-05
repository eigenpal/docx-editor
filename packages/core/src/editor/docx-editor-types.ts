/**
 * Instance-level types for `createDocxEditor` — kept out of the composition root so
 * `docx-editor.ts` stays under the max-lines gate. Re-exported from `docx-editor.ts`
 * and the editor package barrel so public import paths do not change.
 */

import type {
  DocumentSource,
  Editor,
  EditorFontError,
  FontConfiguration,
  Unsubscribe,
} from '@docx-editor.dev/core/contracts/editor';
import type { EditorModule } from '../contracts/modules.ts';
import type { FontConfigurationFragment } from './font-composition.ts';
import type { PaginatedSurface } from './paginated-surface.ts';
import type { HyperlinkActivation } from './surface-navigation.ts';

export interface DocxEditorConfig {
  /**
   * The element the paginated surface mounts into. The surface owns this subtree.
   *
   * Optional: an instance created WITHOUT a container stashes its document bytes and does
   * no DOM work until `attach(el)` — the provider-first shape, where the editor exists
   * before any component has rendered a mount point. With a container, the document mounts
   * immediately at construction, exactly as before.
   */
  container?: HTMLElement;
  /**
   * A document to load at construction. Bytes only in practice: a `DocumentHandle` cannot
   * be re-opened (the handle is identity, not content), so passing one emits a typed
   * `error` event rather than silently loading nothing.
   */
  document?: DocumentSource;
  /**
   * Font bytes for Word-accurate (HarfBuzz-shaped) line wrap and pagination. Omitted,
   * layout falls back to a fixed-width estimate; fonts embedded in the document are
   * wired in automatically either way. For Word's default faces (Calibri, Times New
   * Roman, …) pass `await loadDefaultFonts()` from `@docx-editor.dev/fonts` — a bare
   * fragment (`{ sources, substitutions }`) is accepted and composed with defaults, or
   * merge several origins yourself with `composeFontConfiguration`. Sampled per load;
   * failures degrade to the fixed measurer and report through `onFontError`.
   */
  fonts?: FontConfiguration | FontConfigurationFragment;
  author?: string;
  locale?: string;
  /** Localized drawing refusal labels; defaults to English when omitted. */
  translate?: (key: string, params?: Record<string, string | number>) => string;
  /**
   * Capability modules to register — the seam `@docx-editor.dev/pro` plugs in
   * through. Omitted, the editor runs the free tier: lossless round-trip,
   * final-state revision rendering, review chrome disabled with the engine's
   * reason. See {@link EditorModule}.
   */
  modules?: readonly EditorModule[];
  /** `'view'` refuses every mutating command through the facade; default `'edit'`. */
  mode?: 'edit' | 'view';
  /** Override raster decode for insert/replace image commands; defaults to browser/headless. */
  imageDecodePort?: import('../store/package/image-resources.ts').ImageDecodePort;
  zoom?: number;
  onFontError?: (error: EditorFontError) => void;
  /** Localized labels for table insertion furniture on the painted surface. */
  tableInteractionLabel?: (key: 'table.insertRowBelow' | 'table.insertColumnRight') => string;
}

/**
 * Which measurer the current document's layout runs on, and whether shaped resolution is
 * still in flight. Returned by {@link DocxEditorInstance.fontMeasurement}.
 */
export interface FontMeasurementState {
  /** `fixed` estimates advance widths; `shaped` measures real font bytes with HarfBuzz. */
  readonly measurer: 'fixed' | 'shaped';
  /** True while font resolution for the current document is still running. */
  readonly resolving: boolean;
  /** The shaped measurer's identity (admitted face hashes); absent while fixed. */
  readonly producer?: string;
}

/**
 * The host chrome that answers the engine's hyperlink gestures.
 *
 * A CLICK on an external link and Ctrl/Cmd+K both mean "the user wants the link UI", and the
 * engine deliberately does not know what that looks like. Registered rather than passed at
 * construction because the chrome mounts after the editor does, and it survives a document
 * reload — the surface is rebuilt, the handlers are not.
 */
export interface HyperlinkChromeHandlers {
  /** A plain click on an external or inert link: show the popover at `activation.rect`. */
  readonly onPopover?: (activation: HyperlinkActivation) => void;
  /** Ctrl/Cmd+K: open insert-or-edit for the selection. */
  readonly onRequest?: () => void;
}

/**
 * The concrete facade type: the full `Editor` contract plus the instance-only surface.
 *
 * `surface`, `stateVersion`, `attach` and `detach` live HERE rather than on `Editor`:
 * they are what a store binding and a mounting host need, not what document commands
 * need. Production adapters program against `Editor` for everything else.
 */
export interface DocxEditorInstance extends Editor {
  /** Bumps on mount, detach, destroy, and document reload — guards async image intents. */
  readonly mountGeneration: number;
  /**
   * The underlying paginated surface for harnesses and tests that need capabilities the
   * contract does not carry yet (select-all, node-id addressed selection).
   */
  readonly surface: PaginatedSurface | null;
  /**
   * Wire the host's hyperlink chrome to the engine's gestures — a click on an external
   * link, and Ctrl/Cmd+K. Returns an unsubscribe that restores whatever was registered
   * before, so a popover component can register in an effect and clean up in its teardown.
   *
   * Instance-only, like `surface`: it is what a MOUNTING host needs, not what a document
   * command needs.
   */
  setHyperlinkChrome(handlers: HyperlinkChromeHandlers): Unsubscribe;
  /**
   * Monotonic version of the observable editor state. Bumps whenever anything
   * `snapshot()` reports could have moved — a committed change, a selection move, zoom,
   * load success or failure, attach/detach, destroy. An external store (React's
   * `useSyncExternalStore`) uses it as a cheap "did anything change" signal; `snapshot()`
   * itself is cached per version and returns a stable reference between bumps.
   */
  stateVersion(): number;
  /**
   * Which measurer the current document's layout runs on, and whether shaped
   * resolution is still in flight — the honest "are wrap points Word-accurate yet?"
   * readout a host shows instead of guessing. `fixed` with `resolving: false` is the
   * steady state for a document with no usable font source (the documented zero-config
   * fallback); `shaped` means HarfBuzz measurement over real font bytes. Changes bump
   * `stateVersion()`.
   */
  fontMeasurement(): FontMeasurementState;
  /**
   * Mount into `el`. If the instance holds pending document bytes (created without a
   * container, or previously detached), they mount now — under the shaped measurer when
   * fonts have resolved in the meantime. Attaching while already mounted elsewhere moves
   * the live content via `session.save()`.
   *
   * HONEST COSTS: a mount from bytes is a fresh session — the undo stack and the caret do
   * not survive re-attach (the same cost as the async font remount). After `destroy()`
   * this is a no-op that emits a typed `error` event: a destroyed instance never remounts.
   */
  attach(el: HTMLElement): void;
  /**
   * Tear down the painted surface, stashing the CURRENT document bytes
   * (`session.save()`) so a later `attach` restores the content — but not the undo stack
   * or the caret. No-op when already detached or destroyed.
   */
  detach(): void;
}
