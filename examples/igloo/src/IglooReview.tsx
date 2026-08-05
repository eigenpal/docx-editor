// The review rail, re-cut as an ice core.
//
// The rail is the pro package's `DocxEditorReview`, and every card in it is still the
// packaged card: the anchoring, the stacking, the virtualization, the collapse-when-displaced
// rule, the accept/reject wiring and the reply box are all the library's. What this file
// changes is everything a reader actually sees, through the same five-rung ladder the toolbar
// and the context menu use:
//
// - `furniture`  — host content above the cards. Here: the core log, which counts what is in
//                  the document by reading the very same `useReview()` the rail reads.
// - part CHILDREN — `<Review.Summary>` with children replaces the card's body while keeping
//                  the packaged wrapper (and its test id, and its selectable marking).
// - part `className` / `icon` — the avatar's rime ring, and thaw/refreeze in place of the
//                  packaged tick and cross.
// - an UNRECOGNIZED child — appended inside every card, which is how the specimen panel gets
//                  into a card whose body the library owns.
// - `--doc-*` tokens — the author colour ramp restated in cold hues, so the per-author
//                  identity survives the theme instead of being overridden away.
//
// A CUSTOM node's card takes a different path on purpose: its title and detail come from the
// definition's own `reviewCard` hook (see `specimens.ts`), so the words are already the
// demo's, and the panel below them is the appended child reading the node's typed attrs.

import { DocxEditorReview, useReview, useReviewItem } from '@docx-editor.dev/pro/react';
import type { ReviewRevisionKind } from '@docx-editor.dev/core-contract/contracts/editor';
import { BergGlyph, DomeGlyph } from './art/Specimen';
import { Stats } from './SpecimenPopover';
import { iglooT } from './labels';
import { IceMelt, IceRefreeze } from './icons/review';
import { blocksOf, depthOf, insideTemperature, OUTSIDE, tipHeight } from './specimens';

/**
 * What each kind of tracked change is called here.
 *
 * The packaged card says "Added" and "Deleted", from the bundled catalogue. The rail takes no
 * `t` prop, so a renamed vocabulary goes through the SUMMARY override rather than through
 * `labels.ts` — which is the honest way round: these are the theme's words for the same
 * decisions, not a translation of them.
 */
const FLOE_WORDS: Record<ReviewRevisionKind, string> = {
  insert: 'Frozen in',
  delete: 'Calved off',
  replace: 'Recut',
  moveFrom: 'Drifted from',
  moveTo: 'Drifted to',
  format: 'Re-glazed',
  paragraphMark: 'New floe',
  structural: 'Reshaped',
};

export function IglooReview() {
  return (
    <DocxEditorReview
      className="igloo-rail"
      /* The rail's own label catalogue, the same `t` the toolbar and the menus take. Unlike
         those, an unresolved key here falls back to the bundled English rather than to the
         key, because every string in the rail ships a translation. */
      t={iglooT}
      /* Rung 1 on the card itself — the box, not the column around it. */
      card={{ className: 'igloo-rail__card' }}
      furniture={<CoreLog />}
    >
      {/* Rung 3/1: the packaged parts, re-iconed and re-classed. Everything they do —
          asking the engine, resolving every site of one decision in a single undo step —
          is untouched; only the glyph and the box are the demo's. */}
      <DocxEditorReview.Avatar className="igloo-rail__avatar" />
      <DocxEditorReview.Accept className="igloo-rail__action" icon={IceMelt} />
      <DocxEditorReview.Reject className="igloo-rail__action" icon={IceRefreeze} />

      {/* Rung 4: the card's BODY, replaced, inside the packaged wrapper. */}
      <DocxEditorReview.Summary className="igloo-rail__summary">
        <FloeSummary />
      </DocxEditorReview.Summary>

      {/* Unrecognized: appended inside every card, after the packaged parts. */}
      <CardFrost />
    </DocxEditorReview>
  );
}

/**
 * The core log: what has been drilled out of this document.
 *
 * `furniture` is plain flow content at the top of the rail, so this is ordinary React reading
 * the ordinary hook. Nothing here is privileged — a host could render the same three numbers
 * anywhere else in its own chrome.
 */
function CoreLog() {
  const { items, paneOpen } = useReview();
  // GONE when the rail is shut, not merely hidden. A closed rail gives up its width and
  // becomes a 32px strip of markers, and `furniture` is rendered either way — a summary
  // built for a 300px column wrapped one letter per line inside that strip and spilled its
  // counters over the page. The pane's open state is the ENGINE's (the toolbar's rail button
  // toggles it), so reading it here cannot disagree with what the reader sees.
  if (!paneOpen) return null;
  // Threaded replies are not separate entries in the log for the same reason they are not
  // separate cards: one conversation is one thing to read.
  const observations = items.filter(
    (entry) => entry.kind === 'comment' && entry.parentId === undefined
  ).length;
  const shifts = items.filter((entry) => entry.kind === 'revision').length;
  const specimens = items.filter((entry) => entry.kind === 'custom').length;

  return (
    <div className="igloo-core">
      <h2 className="igloo-core__title">Ice core</h2>
      <ul className="igloo-core__strata">
        <Stratum count={observations} label="observations" />
        <Stratum count={shifts} label="shifts" />
        <Stratum count={specimens} label="specimens" />
      </ul>
    </div>
  );
}

function Stratum({ count, label }: { count: number; label: string }) {
  return (
    <li className="igloo-core__stratum" data-empty={count === 0 ? '' : undefined}>
      <span className="igloo-core__count">{count}</span>
      <span className="igloo-core__label">{label}</span>
    </li>
  );
}

/**
 * The card body.
 *
 * `useReviewItem()` is the hook the packaged parts themselves read — children passed into a
 * card get the CURRENT item from context rather than from props, so this composes exactly
 * the way `Review.Summary`'s own default does.
 *
 * ONE body for all three kinds. A custom node's card runs this too — its detail comes from
 * the definition's own `reviewCard` hook, so the words were already the demo's, and routing
 * them through here means a card cannot end up styled two different ways depending on what
 * put it in the rail.
 */
function FloeSummary() {
  const item = useReviewItem();
  if (!item) return null;
  if (item.kind === 'custom') {
    const detail = item.item.kind === 'custom' ? item.item.detail : undefined;
    return detail ? <span className="igloo-rail__text">{detail}</span> : null;
  }
  if (item.kind === 'comment') {
    // Untrusted: the words come out of the file, so they are rendered as TEXT and never as
    // markup — the same rule the packaged summary follows.
    return <span className="igloo-rail__text">{item.text}</span>;
  }
  if (item.kind !== 'revision') return null;
  return (
    <>
      <span className="igloo-rail__label" data-kind={item.revisionKind}>
        {FLOE_WORDS[item.revisionKind]}
      </span>
      {item.revisionKind === 'replace' && item.replacedText ? (
        <span className="igloo-rail__text">
          <span className="igloo-rail__gone">“{item.replacedText}”</span>
          <span className="igloo-rail__arrow" aria-hidden="true">
            {' → '}
          </span>
          <span className="igloo-rail__new">“{item.text}”</span>
        </span>
      ) : item.text ? (
        <span className="igloo-rail__text">{item.text}</span>
      ) : null}
    </>
  );
}

/**
 * What this demo appends inside EVERY card: a specimen panel where there is a specimen, and
 * an icicle fringe on all of them.
 *
 * A child the rail does not recognize as one of its parts is appended rather than dropped,
 * which is the extension point that makes a custom card body possible at all — the packaged
 * custom branch owns its title and detail, so this is where anything more goes.
 */
function CardFrost() {
  const item = useReviewItem();
  if (!item) return null;
  return (
    <>
      {item.kind === 'custom' ? <SpecimenPanel node={item.item} /> : null}
      <div className="igloo-rail__fringe" aria-hidden="true" />
    </>
  );
}

/**
 * The specimen panel: the demo's OWN element, inside the library's card.
 *
 * This is the whole point of the exercise. The node was authored by this demo
 * (`insertCustomNode`), recognized by this demo's definition, given a card by that
 * definition's `reviewCard` hook — and here it reads its own typed attrs back off the item
 * and draws itself. The card around it is still the packaged card, still anchored at the
 * node's text, still stacking with the comments and the tracked changes beside it.
 *
 * Attrs are file-derived and therefore untrusted; `depthOf`/`blocksOf` clamped them at the
 * recognition boundary, so what arrives here is already a number in range.
 */
function SpecimenPanel({ node }: { node: { name: string; attrs: Readonly<Record<string, string>> } }) {
  if (node.name === 'iceberg') {
    const depth = depthOf(node.attrs);
    return (
      <div className="igloo-specimen" data-specimen="iceberg">
        <BergGlyph className="igloo-specimen__art" />
        <Stats
          rows={[
            ['Above', `${tipHeight(depth)} m`],
            ['Below', `${depth} m`],
          ]}
        />
      </div>
    );
  }
  const blocks = blocksOf(node.attrs);
  return (
    <div className="igloo-specimen" data-specimen="igloo">
      <DomeGlyph className="igloo-specimen__art" />
      <Stats
        rows={[
          ['Inside', `${insideTemperature(blocks)} °C`],
          ['Outside', `${OUTSIDE} °C`],
        ]}
      />
    </div>
  );
}
