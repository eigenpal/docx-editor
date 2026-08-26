// How a tracked change LOOKS.
//
// OOXML says nothing about this. A revision carries `@w:author` and no colour: Word assigns
// colours per author, in the application, and the choice never reaches the file. So this is
// presentation policy, and it belongs where a host can replace it — the colours resolve through
// `--doc-review-author-N` tokens rather than literals, and the author-to-slot mapping is one
// pure function.
//
// The decorations follow Word: an insertion is underlined, a deletion struck through, and the
// two halves of a MOVE are drawn distinguishably from an ordinary delete/insert pair, because
// they are one decision and a reviewer resolving one half resolves both.

import type { RevisionAttribution } from '../layout/revision-projection.ts';
import {
  paragraphFragmentsOfBlocks,
  type BlockFragmentRecord,
  type SemanticLayout,
} from '../layout/semantic-records.ts';

/** How many author slots the token ramp defines. */
export const REVIEW_AUTHOR_SLOTS = 8;

/**
 * Everything a host can say about ONE author's presentation. Every field is optional and
 * every field is presentation-only — nothing here is ever serialised into the document.
 *
 * Deliberately about the PAINTED DOCUMENT (which only the painter can style) plus the
 * author's identity data. Review-card DESIGN is not configured here: the review chrome
 * follows `color` as its accent automatically, and everything further is composition —
 * a custom card reading this style through the review surface's `useReviewAuthor`, or
 * CSS on the cards' `data-review-author`/`data-review-author-slot` hooks.
 *
 * @public
 */
export interface RevisionAuthorStyle {
  /**
   * Ink and decoration colour of this author's changes in the document — and the accent
   * the review chrome keys on (avatar disc, card variable, marker).
   */
  color?: string;
  /** Background wash behind this author's changes in the document. */
  background?: string;
  /**
   * Class names added to every painted span of this author's changes, for styling the
   * typed fields do not cover. Keep the rules metric-safe (outlines, shadows, accents):
   * the engine measures the text it paints, and a class that resizes glyphs drifts the
   * page from its layout.
   */
  spanClassName?: string;
  /** Avatar image for this author; the packaged card renders it in place of initials. */
  avatarUrl?: string;
}

/**
 * Per-author style assignments.
 *
 * Keys match `w:author` exactly; a value is a CSS colour or a full
 * {@link RevisionAuthorStyle}. `others` says what authors WITHOUT an entry take: the
 * `--doc-review-author-N` ramp by default, or `'kind'` to leave them on the kind colours —
 * which is how "highlight these reviewers, leave everyone else green and red" is said.
 *
 * @public
 */
export interface RevisionAuthorAssignments {
  /** Authors without an entry: the ramp (default), or the `'kind'` colours. */
  readonly others?: 'kind' | 'author';
  readonly authors: Readonly<Record<string, string | RevisionAuthorStyle>>;
}

/**
 * How painted tracked changes are coloured.
 *
 * - `'author'` (the DEFAULT) — every change takes its author's colour from the
 *   `--doc-review-author-N` ramp. An attached document seeds slots by order of first
 *   appearance, then keeps those assignments stable for that session. Word's own default,
 *   and the reason it is this engine's: a paragraph three people edited has to read as three
 *   people. Restyle a slot under `.docx-editor` to change the ramp.
 * - `'kind'` — insertions and deletions take the two kind colours
 *   (`--doc-revision-insertion` / `--doc-revision-deletion`), so "added" and "removed" are
 *   what a reader tells apart at a glance, whoever proposed them.
 * - {@link RevisionAuthorAssignments} — style the named authors; `others` decides whether
 *   the rest take the ramp (the default) or the kind colours.
 *
 * Presentation only: nothing here is ever serialised into the document.
 *
 * @public
 */
export type RevisionStyles = 'kind' | 'author' | RevisionAuthorAssignments;

/**
 * One document author, resolved: who, which ramp slot, and what they draw in.
 *
 * @public
 */
export interface ReviewAuthorInfo {
  /** The `w:author` string, exactly as the file carries it. */
  readonly author: string;
  /**
   * Stable session rank, seeded by order of first appearance — an UNBOUNDED index.
   *
   * The ramp defines {@link REVIEW_AUTHOR_SLOTS} colours and every DOM hook wraps into it,
   * so the ninth author ranks 8 here and carries `data-review-author-slot="0"`. Building a
   * selector from this value needs the same wrap: `slot % 8`.
   */
  readonly slot: number;
  /**
   * The colour this author is DRAWN IN by the review chrome — their declared colour, or
   * their ramp slot's token.
   *
   * Not necessarily what the document paints. `'kind'`, and `others: 'kind'` for an author
   * with no declaration, colour the painted text by insertion/deletion instead, while the
   * cards keep the per-author accent this reports.
   */
  readonly color: string;
  /** The host-supplied style, normalised; absent when the author rides the ramp. */
  readonly style?: RevisionAuthorStyle;
}

/**
 * Where each {@link RevisionAuthorStyle} field lands, and so whether the paint-reuse key
 * hashes it. The `satisfies` clause makes a new style field a compile error here until it
 * is classified — a `'painted'` field the key misses keeps stale pages on screen, and a
 * `'card-only'` field the key hashes drops every retained page for a change that alters
 * no painted pixel.
 *
 * `avatarUrl` is deliberately `'card-only'`. It is read by the review card and by nothing
 * the painter emits, so hashing it made an avatar arriving late — a host resolving its
 * team roster over the network, then redeclaring — move the context key and drop every
 * retained page. Measured at 228ms and 0 of 41 pages retained for a change that alters no
 * painted pixel; an identical redeclaration kept all 41 at 0.1ms.
 */
const STYLE_KEY_REACH = {
  color: 'painted',
  background: 'painted',
  spanClassName: 'painted',
  avatarUrl: 'card-only',
} as const satisfies Record<keyof Required<RevisionAuthorStyle>, 'painted' | 'card-only'>;

const STYLE_KEYS = Object.keys(STYLE_KEY_REACH) as readonly (keyof RevisionAuthorStyle)[];

/** The `'painted'` subset, in declaration order — the hash fold at the context key relies
 * on that order staying stable. */
const PAINTED_STYLE_KEYS = STYLE_KEYS.filter((key) => STYLE_KEY_REACH[key] === 'painted');

/**
 * Schemes an avatar may load over. An allowlist, matching the package's `sanitizeHref`
 * policy rather than restating a denylist: the value is host-configured, but a config that
 * travelled through storage or `JSON.parse` is one typo away from a live scheme, and the
 * normalised value is PUBLIC — hosts render it themselves from `ReviewAuthorInfo.style`.
 */
const AVATAR_SCHEMES = new Set(['http', 'https', 'data', 'blob']);
const SCHEME_RE = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;

/**
 * An avatar URL an `<img>` may safely load, or `undefined`.
 *
 * Sanitised HERE, at the point the value is normalised, rather than at the render site: a
 * host reading `style.avatarUrl` off the roster gets the same guarantee the packaged card
 * does. Embedded tab/LF/CR and leading C0 controls are stripped first, because a browser
 * strips them while parsing a URL — so `jav&#9;ascript:` is a live scheme to the browser and
 * must not survive as an unrecognised one here.
 */
function sanitizedAvatarUrl(raw: string): string | undefined {
  const cleaned = raw.replace(/[\u0000-\u0020\u007f]/g, '');
  if (cleaned.length === 0) return undefined;
  const scheme = SCHEME_RE.exec(cleaned);
  if (scheme) {
    if (!AVATAR_SCHEMES.has(scheme[1]!.toLowerCase())) return undefined;
    // An SVG loaded through `<img>` runs no script, but it is the one image type that can
    // reference the network, and a `data:` payload is the one an attacker can hand-write.
    if (/^data:/i.test(cleaned) && !/^data:image\/(?!svg)/i.test(cleaned)) return undefined;
    return cleaned;
  }
  // No scheme: a relative or protocol-relative reference. `//host/path` reaches a third
  // party under the page's own scheme, which a same-origin-looking config should not do.
  // Backslashes count: a URL parser folds them to `/`, so `\\host/path` is the same
  // reference wearing a different coat.
  const slash = (index: number): boolean => cleaned[index] === '/' || cleaned[index] === '\\';
  return slash(0) && slash(1) ? undefined : cleaned;
}

/**
 * One host value, normalised to a style — or `null` when it says nothing.
 *
 * Copied field-by-field through a fixed key list, OWN properties only: the record and its
 * values are host input that may have travelled through `JSON.parse`, so nothing here ever
 * reads through a prototype chain or copies a key the type does not declare.
 */
function normalizedStyle(
  value: string | RevisionAuthorStyle | undefined | null
): RevisionAuthorStyle | null {
  if (typeof value === 'string') return value.length > 0 ? { color: value } : null;
  if (value === null || typeof value !== 'object') return null;
  const style: RevisionAuthorStyle = {};
  const own = Object.prototype.hasOwnProperty;
  for (const key of STYLE_KEYS) {
    // OWN properties only, and by a borrowed `hasOwnProperty`: the record may carry a key
    // named `hasOwnProperty` itself, and `Object.hasOwn` needs a newer lib than every
    // adapter's tsconfig sets.
    if (!own.call(value, key)) continue;
    const field = (value as Record<string, unknown>)[key];
    if (typeof field !== 'string' || field.length === 0) continue;
    if (key === 'avatarUrl') {
      const url = sanitizedAvatarUrl(field);
      if (url !== undefined) style.avatarUrl = url;
      continue;
    }
    style[key] = field;
  }
  return Object.keys(style).length > 0 ? style : null;
}

/** The slot's colour, as the token reference every surface resolves through CSS. */
export function reviewAuthorSlotColor(slot: number): string {
  return `var(--doc-review-author-${slot % REVIEW_AUTHOR_SLOTS})`;
}

/**
 * The host option's assignments, normalised: one style per author the host addressed.
 */
export function revisionAuthorStylesOf(
  option: RevisionStyles | undefined
): ReadonlyMap<string, RevisionAuthorStyle> {
  const styles = new Map<string, RevisionAuthorStyle>();
  if (option === undefined || option === 'kind' || option === 'author') return styles;
  for (const [author, value] of Object.entries(option.authors)) {
    const style = normalizedStyle(value);
    if (style) styles.set(author, style);
  }
  return styles;
}

/**
 * The full resolved roster: every author in the document, in slot order, with the colour
 * and style they resolve to under `option`. This is what `getReviewAuthors` returns and
 * what the review chrome styles its cards from — one derivation, shared, so the document
 * and the cards cannot disagree about who draws in what.
 */
export function reviewAuthorsOf(
  authors: ReadonlyMap<string, number>,
  option: RevisionStyles | undefined
): readonly ReviewAuthorInfo[] {
  const styles = revisionAuthorStylesOf(option);
  return [...authors].map(([author, slot]) => {
    const style = styles.get(author);
    return {
      author,
      slot,
      color: style?.color ?? reviewAuthorSlotColor(slot),
      ...(style ? { style } : {}),
    };
  });
}

/**
 * The resolved form the painter consumes: the document's author→slot map, the host's
 * per-author styles, what UNSTYLED authors take, and the paint-reuse key for all of it.
 * `null` means the default kind colouring for everyone.
 */
export interface RevisionStyleContext {
  readonly authorSlots: ReadonlyMap<string, number>;
  readonly styles: ReadonlyMap<string, RevisionAuthorStyle>;
  /** `spanClassName` pre-split into tokens, so paint does not split per span. */
  readonly classTokens: ReadonlyMap<string, readonly string[]>;
  /** Authors without a style: `'kind'` colours, or the ramp. */
  readonly others: 'kind' | 'author';
  /** See {@link revisionStyleContextKey}. Computed once, with the context. */
  readonly key: string;
}

/**
 * FNV-1a over a BOUNDED projection of a string, plus its full length.
 *
 * Bounded because `w:author` is an attacker-controlled attribute: a document can carry
 * megabytes of author name for the price of one attribute, and this runs on the paint path.
 * Hashing a capped prefix and the length keeps the cost proportional to the author COUNT
 * instead of the author BYTES, and two names can only collide by sharing a length and a
 * 128-character prefix — where the cost is one page repainted in a stale colour, not a
 * correctness failure anywhere data is written.
 */
const DIGEST_MAX_CHARS = 128;
function hashText(hash: number, text: string, cap = DIGEST_MAX_CHARS): number {
  const limit = text.length < cap ? text.length : cap;
  let next = hash;
  for (let i = 0; i < limit; i += 1) {
    next = Math.imul(next ^ text.charCodeAt(i), 0x01000193);
  }
  return Math.imul(next ^ text.length, 0x01000193);
}

/**
 * The paint-reuse key for a resolved context.
 *
 * The slot map is derived from the WHOLE layout, so an edit that reorders first appearances
 * recolours pages whose own records did not change — the key must move with the map, or
 * those pages are reused verbatim in the old colours. A digest rather than a serialisation:
 * see {@link hashText}.
 */
function computeContextKey(
  authorSlots: ReadonlyMap<string, number>,
  styles: ReadonlyMap<string, RevisionAuthorStyle>,
  others: 'kind' | 'author'
): string {
  // Seeded by the scheme, then fed the author list IN SLOT ORDER (so a reordering moves the
  // key) and every declared style field.
  let hash = hashText(0x811c9dc5, others);
  for (const author of authorSlots.keys()) hash = hashText(hash, author);
  for (const [author, style] of styles) {
    hash = hashText(hash, author);
    // UNCAPPED. These are host-supplied and bounded by the host, and two long class lists
    // that differ only near the end have to produce different keys or the pages carrying
    // the old classes are reused verbatim.
    for (const field of PAINTED_STYLE_KEYS) hash = hashText(hash, style[field] ?? '', Infinity);
  }
  return `${authorSlots.size}.${styles.size}.${(hash >>> 0).toString(36)}`;
}

/** The key for a context, or the constant for the default scheme. */
export function revisionStyleContextKey(context: RevisionStyleContext | null): string {
  return context === null ? 'kind' : context.key;
}

/**
 * Resolved contexts, cached per LAYOUT.
 *
 * `revisionStyleContextOf` walks every span of the document, and paint calls it on every
 * pass — including passes that then reuse every page (a scroll rematerialize, a chrome
 * toggle, a caret move). Keyed on the layout the walk read, so repeated paints of one
 * layout cost nothing and only a new layout pays the walk again.
 */
const contextCache = new WeakMap<
  SemanticLayout,
  {
    option: RevisionStyles | undefined;
    authorSlots: ReadonlyMap<string, number> | undefined;
    context: RevisionStyleContext | null;
  }
>();

/**
 * Resolve the public option against a layout, or `null` for the default kind colouring.
 *
 * `authorSlots` is the attached surface's stable assignment when one exists. A standalone
 * painter has no session and keeps deriving the assignment from the layout.
 */
export function revisionStyleContextOf(
  option: RevisionStyles | undefined,
  layout: SemanticLayout,
  authorSlots?: ReadonlyMap<string, number>
): RevisionStyleContext | null {
  // OMITTED MEANS BY AUTHOR. Word's default, and the one this engine takes: colour answers
  // who proposed the change, decoration answers what it was. `'kind'` is the opt-out.
  if (option === 'kind') return null;
  const cached = contextCache.get(layout);
  if (cached && cached.option === option && cached.authorSlots === authorSlots) {
    return cached.context;
  }
  const styles = revisionAuthorStylesOf(option);
  const others =
    option === undefined || option === 'author' ? 'author' : (option.others ?? 'author');
  // A scheme that names nobody and leaves the rest on the kind colours IS the kind scheme.
  // Returning a context for it would cost a full walk per paint and mark every tracked span
  // with a slot hook, for no visible difference.
  if (styles.size === 0 && others === 'kind') {
    contextCache.set(layout, { option, authorSlots, context: null });
    return null;
  }
  const resolvedAuthorSlots = authorSlots ?? authorSlotsOf(layout);
  const classTokens = new Map<string, readonly string[]>();
  for (const [author, style] of styles) {
    if (!style.spanClassName) continue;
    const tokens = style.spanClassName.split(/\s+/).filter((token) => token.length > 0);
    if (tokens.length > 0) classTokens.set(author, tokens);
  }
  const context: RevisionStyleContext = {
    authorSlots: resolvedAuthorSlots,
    styles,
    classTokens,
    others,
    key: computeContextKey(resolvedAuthorSlots, styles, others),
  };
  contextCache.set(layout, { option, authorSlots, context });
  return context;
}

/**
 * The presentation one span's revision stack resolves to.
 *
 * Both a decoration and a colour, because either alone is ambiguous: colour alone cannot say
 * whether text was added or removed, and a decoration alone cannot say by whom.
 */
export interface RevisionPresentation {
  /** The innermost attribution — whose pending decision this text is. */
  readonly attribution: RevisionAttribution;
  /** `text-decoration-line`, or null when the kind carries none. */
  readonly line: 'underline' | 'line-through' | null;
  /** `text-decoration-style`; double marks a MOVE, so it reads apart from a plain edit. */
  readonly decorationStyle: 'solid' | 'double' | 'dashed';
  /** CSS custom-property reference for the colour this revision draws in. */
  readonly color: string;
  /** True when the content is struck from the live document, by any enclosing revision. */
  readonly deleted: boolean;
  /** The author's colour slot, for surfaces that key on person rather than on kind. */
  readonly authorColor: string;
}

/**
 * Every author a block list attributes anything to, in reading order, MEMOISED on the
 * list's identity.
 *
 * The identity is what makes this cheap. Layout reuses block arrays it did not have to
 * rebuild — on a 200-page document a keystroke replaces a handful of pages and hands back
 * the rest by reference — and header, footer and note stories are literally one array
 * shared by every page that shows them. Walking per array instead of per page turns the
 * roster derivation from a whole-document scan on every commit into a scan of what
 * actually changed.
 */
const blockAuthorCache = new WeakMap<readonly BlockFragmentRecord[], readonly string[]>();

function blockAuthors(blocks: readonly BlockFragmentRecord[]): readonly string[] {
  const cached = blockAuthorCache.get(blocks);
  if (cached) return cached;
  const found: string[] = [];
  const seen = new Set<string>();
  const see = (author: string): void => {
    // A MISSING `w:author` is not a person. `@w:author` is required by the schema and a
    // malformed file can still omit it, and recording `''` made the blank a roster entry that
    // took slot 0 — pushing the first real reviewer off the colour Word gives them, and
    // putting an empty, colour-consuming chip in any legend built from the roster. The review
    // queue's own walk already skips it, so recording it here made the two disagree.
    if (author === '' || seen.has(author)) return;
    seen.add(author);
    found.push(author);
  };
  for (const fragment of paragraphFragmentsOfBlocks(blocks)) {
    for (const line of fragment.lines) {
      for (const span of line.spans) {
        // Index loops with an explicit guard: `?? []` allocated a throwaway array and an
        // iterator for every untracked span, which is the overwhelming majority of them.
        const revisions = span.revisions;
        if (revisions !== undefined) {
          for (let i = 0; i < revisions.length; i += 1) see(revisions[i]!.author);
        }
        // A tracked FORMAT change alters no characters, so it appears in neither list.
        // Read inline rather than through `formatRevisionOf`, which builds an attribution
        // object this walk would throw away once per revised span.
        for (const property of span.props) {
          if (property.localName !== 'rPrChange' && property.localName !== 'pPrChange') continue;
          const author = property.attributes?.author;
          // `formatRevisionOf` defaults a missing `@w:author` to the empty string, which
          // `see` then drops: an anonymous change is not a person and must not take a ramp
          // slot from one. It paints in slot 0's colour as any unknown author does — the
          // alternative, a roster entry with no name in it, is worse everywhere the roster
          // is read.
          see(author ?? '');
          break;
        }
      }
    }
    for (const line of fragment.lines) {
      // Tracked inline DRAWINGS, after the line's spans: a reviewer whose only change is a
      // picture is still a reviewer, and leaving them out silently painted their cue in
      // slot 0's colour. A separate pass so a drawing mid-line cannot renumber the text
      // authors around it relative to the pre-#479 assignment.
      const drawings = line.drawings;
      if (drawings === undefined) continue;
      for (let i = 0; i < drawings.length; i += 1) {
        const revisions = drawings[i]!.revisions;
        if (revisions === undefined) continue;
        for (let j = 0; j < revisions.length; j += 1) see(revisions[j]!.author);
      }
    }
    // The paragraph MARK last: it carries no span of its own, and the pilcrow paints at the
    // END of the fragment's final line. Reading it first gave a reviewer who only pressed
    // Enter a lower slot than the author of the text beside them.
    const marks = fragment.markRevisions;
    if (marks) for (let i = 0; i < marks.length; i += 1) see(marks[i]!.author);
  }
  blockAuthorCache.set(blocks, found);
  return found;
}

/**
 * The author→slot map per layout. ONE cache for the whole engine: the painter resolves it
 * for colouring and the surface answers `getReviewAuthors` from it, and before this they
 * each walked the document independently — twice per keystroke for a host with the review
 * rail mounted, for a map that is identical both times.
 */
const slotCache = new WeakMap<SemanticLayout, ReadonlyMap<string, number>>();

/**
 * Which colour slot each author gets, by ORDER OF FIRST APPEARANCE in the document.
 *
 * Word's model, and the reason it is worth the walk: a hash of the name is stable but collides,
 * and two reviewers drawn in one colour is not a cosmetic defect — it tells the reader the wrong
 * thing about who proposed what. Two ordinary names collide in an eight-slot hash often enough
 * to hit on the first document you try.
 *
 * EVERY STORY, not just the body. A reviewer whose only change is in a header, a footnote or a
 * text box is still a reviewer; leaving them out of the map does not leave them uncoloured, it
 * silently gives them slot 0 — the first body author's colour — and hides them from the roster
 * a host builds its legend from.
 *
 * Cached per layout, and per block list beneath that, so repeated calls are free.
 */
export function authorSlotsOf(layout: SemanticLayout): ReadonlyMap<string, number> {
  const cached = slotCache.get(layout);
  if (cached) return cached;
  const slots = new Map<string, number>();
  const fold = (blocks: readonly BlockFragmentRecord[]): void => {
    for (const author of blockAuthors(blocks)) {
      if (!slots.has(author)) slots.set(author, slots.size);
    }
  };
  for (const page of layout.pages) {
    fold(page.fragments);
    if (page.header) fold(page.header.fragments);
    if (page.footer) fold(page.footer.fragments);
    for (const area of [page.footnotes, page.endnotes]) {
      if (!area) continue;
      // The separator is an authored story too, and `paintPageNoteAreas` paints it.
      if (area.separator) fold(area.separator.fragments);
      for (const note of area.notes) fold(note.fragments);
    }
    // Text boxes: anchored on the page, and on the furniture stories that carry their own.
    for (const anchored of [
      page.anchoredDrawings,
      page.header?.anchoredDrawings,
      page.footer?.anchoredDrawings,
    ]) {
      if (!anchored) continue;
      for (const drawing of anchored) {
        // The anchored drawing's own tracked change, then any story inside it.
        const revisions = drawing.revisions;
        if (revisions !== undefined) {
          for (let i = 0; i < revisions.length; i += 1) {
            const author = revisions[i]!.author;
            if (author !== '' && !slots.has(author)) slots.set(author, slots.size);
          }
        }
        if (drawing.textboxStory) fold(drawing.textboxStory.fragments);
      }
    }
  }
  slotCache.set(layout, slots);
  return slots;
}

/**
 * The REVIEW roster's slot map: every author {@link authorSlotsOf} numbered, then every other
 * author who owns a review item, appended in queue order.
 *
 * Review is comments AND tracked changes, so one person has to draw in one colour across both
 * — the card annotating their comment and the card annotating their edit are the same person's
 * card, and a reader who learns the pairing on one must not have to relearn it on the other.
 *
 * Document authors KEEP the number the layout walk gave them. The painter has already written
 * that number into the page as `data-review-author-slot`, so renumbering here to make room
 * for a commenter would recolour tracked text that nobody touched. A comment-only author has
 * no painted revision to collide with, so they take the next free slot instead.
 *
 * Returns `documentSlots` ITSELF when there is nothing to add, so a caller keying a cache on
 * the map's identity — the review rail does — sees no change on a document of pure revisions.
 */
export function reviewAuthorSlotsOf(
  documentSlots: ReadonlyMap<string, number>,
  reviewAuthors: Iterable<string>
): ReadonlyMap<string, number> {
  let combined: Map<string, number> | null = null;
  for (const author of reviewAuthors) {
    if (author === '' || documentSlots.has(author)) continue;
    if (combined === null) combined = new Map(documentSlots);
    if (!combined.has(author)) combined.set(author, combined.size);
  }
  return combined ?? documentSlots;
}

/**
 * One attached document's author-slot allocator.
 *
 * The first resolve seeds the assignment in document order. Later resolves keep every slot
 * already issued, including slots whose author is temporarily absent. New authors append after
 * the reserved range, so deleting and undoing a decision cannot recolour another reviewer.
 */
export interface StableReviewAuthorSlots {
  resolve(
    documentSlots: ReadonlyMap<string, number>,
    reviewAuthors: Iterable<string>
  ): ReadonlyMap<string, number>;
}

export function createStableReviewAuthorSlots(): StableReviewAuthorSlots {
  const reserved = new Map<string, number>();
  let nextSlot = 0;
  return {
    resolve(documentSlots, reviewAuthors) {
      const current = reviewAuthorSlotsOf(documentSlots, reviewAuthors);
      for (const author of current.keys()) {
        if (reserved.has(author)) continue;
        reserved.set(author, nextSlot);
        nextSlot += 1;
      }
      return new Map(
        [...current.keys()]
          .map((author) => [author, reserved.get(author)!] as const)
          .sort((left, right) => left[1] - right[1])
      );
    },
  };
}

/**
 * The presentation for a span's revision stack, or null when the text is untracked.
 *
 * The INNERMOST attribution names the colour and the decoration, because it is the pending
 * decision about this text. Deletion is asked of the WHOLE stack: an insertion inside a
 * deletion is text that is on its way out, and drawing it as a plain insertion would tell the
 * reader the opposite.
 */
export function revisionPresentationOf(
  revisions: readonly RevisionAttribution[] | undefined,
  authorSlots?: ReadonlyMap<string, number>,
  authorStyles?: ReadonlyMap<string, RevisionAuthorStyle>
): RevisionPresentation | null {
  if (revisions === undefined || revisions.length === 0) return null;
  const attribution = revisions[revisions.length - 1]!;
  const deleted = revisions.some(
    (revision) => revision.kind === 'delete' || revision.kind === 'moveFrom'
  );
  const kind = attribution.kind;
  const line =
    kind === 'delete' || kind === 'moveFrom'
      ? 'line-through'
      : kind === 'insert' || kind === 'moveTo'
        ? 'underline'
        : null;
  return {
    attribution,
    // A deletion nested in an insertion still reads as removed: the strike wins over the
    // underline its container would have drawn.
    line: deleted && line === 'underline' ? 'line-through' : line,
    // An insertion's rule is DASHED. A solid one is hard to tell from an authored `w:u`, which
    // underlines plenty of ordinary text in a contract, so two different statements would be
    // drawn identically. A strike has no such clash and stays solid; a move stays double,
    // because it is one decision with two halves.
    decorationStyle:
      kind === 'moveFrom' || kind === 'moveTo' ? 'double' : kind === 'insert' ? 'dashed' : 'solid',
    // Coloured by KIND, not by author: a reader scanning a page needs "added" and "removed"
    // to be the two things they can tell apart at a glance, and Word's own default view draws
    // them that way. The per-author ramp stays available for the review cards, where the
    // question is "who" rather than "what".
    color: deleted ? 'var(--doc-revision-deletion)' : 'var(--doc-revision-insertion)',
    // The author's colour, for a surface that colours by person instead: the host's when
    // their style names one, otherwise the author's ramp slot.
    authorColor:
      authorStyles?.get(attribution.author)?.color ??
      reviewAuthorSlotColor(authorSlots?.get(attribution.author) ?? 0),
    deleted,
  };
}
