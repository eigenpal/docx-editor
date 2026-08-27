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
  ZoomMode,
} from '@docx-editor.dev/core/contracts/editor';
import type { EditorModule } from '../contracts/modules.ts';
import type { EditorCollaborationSession } from '../collaboration/index.ts';
import type {
  ReviewAuthorInfo,
  RevisionAuthorStyle,
  RevisionStyles,
} from '../output/revision-presentation.ts';
import type { FontConfigurationFragment, FontResolver } from './font-composition.ts';
import type { PaginatedSurface, RemoteCaretLabelHost } from './paginated-surface.ts';
import type { HyperlinkActivation } from './surface-navigation.ts';
import type { EquationActivation } from './surface-equations.ts';

/**
 * Everything {@link createDocxEditor} accepts. Every field is optional.
 *
 * `container` is the one that changes the shape of the whole lifecycle: omitting it produces an
 * instance that does no DOM work until `attach(el)`, which is what lets a provider own the editor
 * before any component has rendered a mount point.
 *
 * @public
 */
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
   * A document to load at construction: DOCX bytes, or `'blank'` for Word's blank
   * template. A `DocumentHandle` cannot be re-opened (the handle is identity, not
   * content), so passing one emits a typed `error` event rather than silently loading
   * nothing. Omitting this mounts NO document, which is not the same as an empty one.
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
   *
   * Pass a {@link FontResolver} instead to resolve ON DEMAND: the function is called once
   * per load, after the document is parsed, with the families it actually declares, and
   * only what it returns is loaded. A document naming nothing the resolver covers costs
   * nothing. Note that a fetching resolver makes opening a document perform network
   * requests — the engine never supplies one, so that stays your call.
   */
  fonts?: FontConfiguration | FontConfigurationFragment | FontResolver;
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
  /**
   * The mode the editor opens in — one prop, matching the toolbar's three-state pill.
   *
   * - `'edit'` — opens in editing, even when the document's `w:trackRevisions` asks for
   *   tracked changes; the reader still moves between modes from the toolbar.
   * - `'suggesting'` — opens in suggesting. It needs what suggesting always needs — a
   *   review module and an {@link DocxEditorConfig.author} — and falls back to editing
   *   with the reason published when either is missing.
   * - `'view'` — read-only: every mutating command through the facade is refused, and
   *   the toolbar cannot leave viewing.
   * - Omitted — the DOCUMENT decides: a package carrying `w:trackRevisions` opens in
   *   suggesting, everything else in editing.
   */
  mode?: 'edit' | 'view' | 'suggesting';
  /**
   * How painted tracked changes are coloured. Presentation only — nothing is serialised.
   *
   * - `'author'` (the DEFAULT) — every change takes its author's colour from the
   *   `--doc-review-author-N` ramp, by order of first appearance, as Word does. Restyle a
   *   slot under `.docx-editor` to change the ramp.
   * - `'kind'` — insertions green, deletions red, so "added" and "removed" are what a
   *   glance tells apart, whoever proposed them.
   * - {@link RevisionAuthorAssignments} — style the named authors; `others` decides
   *   whether the rest take the ramp (the default) or the kind colours.
   *
   * The opening value. In React this is authored declaratively — `DocxEditor.ColorByChangeType`
   * and `DocxEditor.AuthorStyle` compose and apply it, seeding this config for the first
   * paint — so React hosts never pass it by hand; it is the entry for headless hosts. Read
   * the document's resolved roster with `getReviewAuthors`. Applies wherever revision
   * markup paints: the full all-markup view needs a review module registered; without one
   * the proposed view still marks surviving insertions.
   */
  revisionStyles?: RevisionStyles;
  /** Override raster decode for insert/replace image commands; defaults to browser/headless. */
  imageDecodePort?: import('../store/package/image-resources.ts').ImageDecodePort;
  /**
   * The scale to open at, as a fixed number.
   *
   * Supplying one also picks the mode: an editor given a `zoom` and no `zoomMode` opens
   * FIXED at that value and stays there. An embedder that pinned 100% keeps 100%.
   */
  zoom?: number;
  /**
   * Where the scale comes from. Defaults to `'auto'` — fit the page width, between 50% and
   * 100% — unless {@link DocxEditorConfig.zoom} is supplied, which means fixed.
   *
   * `'auto'` leaves a window wide enough for the sheet exactly where it is today and shrinks
   * a narrower one instead of growing a horizontal scrollbar. Pass `{ type: 'fixed' }` for
   * the old unconditional behaviour.
   */
  zoomMode?: ZoomMode | 'auto';
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

/** Host chrome that edits a clicked Office Math equation. */
export interface EquationChromeHandlers {
  readonly onPopover?: (activation: EquationActivation) => void;
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
  /** Wire the host equation popover to painted equation clicks. */
  setEquationChrome(handlers: EquationChromeHandlers): Unsubscribe;
  /**
   * Render the host's own component as the remote-caret label, or restore the default
   * collaborator-name label with `null`. The engine keeps owning label geometry, class,
   * and presence colour; the host owns the content of each published element.
   *
   * Instance-only, like `setHyperlinkChrome`: it is what a MOUNTING host needs. Tolerated
   * before `attach` and after `detach` — the registration waits and applies on the next
   * mount, and it survives a document reload the way the hyperlink chrome does.
   */
  setRemoteCaretLabelHost(host: RemoteCaretLabelHost | null): void;
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
   * Every author the review surface DRAWS, in Word's slot order, with the colour the review
   * chrome draws them in. The discovery surface a legend or colour picker builds on —
   * authors depend on the loaded file, so they cannot be known at configuration time.
   *
   * The colour is the author's, not the document's: under `'kind'` the painted text goes to
   * the insertion/deletion colours while the cards keep these accents, so a legend built
   * from this describes the rail rather than the page.
   *
   * BOTH HALVES OF REVIEW. Authors of tracked changes come first, numbered by where their
   * first change appears; authors who only commented follow. One person therefore draws in
   * one colour across their comments and their edits, which is what a reader assumes the
   * moment they learn the pairing on either. The order puts commenters last so that adding
   * a comment can never renumber a tracked change the painter has already drawn.
   *
   * Read of the rendered projection, not of the package: a resolved view hides the
   * revisions it has resolved away, so an author whose only change is hidden there is
   * listed only if they also commented. Empty while detached. Reference-stable between
   * changes, so it is safe as a dependency; changes bump `stateVersion()`.
   */
  getReviewAuthors(): readonly ReviewAuthorInfo[];
  /**
   * The presence colour the engine paints for one display name — the answer the remote
   * caret label takes, so chrome built on this cannot disagree with the painted caret.
   *
   * A name the review roster draws takes its resolved colour, sanitized exactly as the
   * paint sink sanitizes it: a declared colour the paint refuses falls to the author's
   * ramp-slot token. Any other name takes the next slot from the engine's stable
   * allocator, in first-resolution order, and keeps it for the session. While no document
   * is attached this returns `'var(--doc-accent)'`, the same default the overlay CSS
   * falls back to.
   */
  presenceColorFor(name: string): string;
  /**
   * The live collaboration replica, or null when this editor is not in a room.
   *
   * Presence chrome reads it from here rather than being handed it: the editor already holds
   * the session a `collaborationModule` contributed, so a host that threads it down to every
   * avatar and caret consumer is passing something the tree below it can already see.
   */
  collaborationSession(): EditorCollaborationSession | null;
  /**
   * The configured author used when a comment or reply omits an explicit author.
   *
   * @internal Review compose chrome uses this to draw an unfinished comment in the same
   * author colour it will receive after commit.
   */
  getConfiguredAuthor(): string | null;
  /**
   * The style declared for one author, whether or not the SURFACE has published them yet —
   * so review chrome can draw a card the rail is holding before the roster catches up.
   *
   * {@link DocxEditorInstance.getReviewAuthors} answers for every author of a tracked
   * change or a comment, so this is a narrow fallback rather than the way to reach a
   * commenter.
   *
   * @internal The seam `@docx-editor.dev/pro`'s review rail resolves those authors
   * through. A consumer reads `useReviewAuthor` (pro) or `useReviewAuthors` (react)
   * instead; nothing here answers a question those two do not.
   */
  getReviewAuthorStyle(author: string): RevisionAuthorStyle | undefined;
  /**
   * Replace how tracked changes are coloured, live. Paint-level: pages repaint without a
   * layout pass, and the caret, selection and undo history stay where they are. Pass
   * `'author'` to restore the default, or `'kind'` to opt out to the green/red
   * rendering. Survives a document reload.
   *
   * The imperative PRIMITIVE beneath React's declarative lane: `DocxEditor.ColorByChangeType`
   * and `DocxEditor.AuthorStyle` drive this seam, and React hosts declare those instead
   * of calling it. Call it directly from headless and non-React hosts.
   */
  setRevisionStyles(styles: RevisionStyles): void;
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
