// The review rail, re-cut as an ice core.
//
// Every card is still the packaged `DocxEditorReview` card — anchoring, stacking,
// virtualization, accept/reject and the reply box are the library's. This file changes only
// what a reader sees, through five customization rungs at once: `furniture`, part `children`,
// part `className`/`icon`, a per-item `icon` on the collapsed rail's markers, an
// unrecognized child appended to every card, and `--doc-*` tokens.

import { DocxEditorReview, useReview, useReviewItem } from '@docx-editor.dev/pro/react';
import type { ReviewRevisionKind } from '@docx-editor.dev/core/contracts/editor';
import { BergGlyph, DomeGlyph } from './art/Specimen';
import { Stats } from './SpecimenPopover';
import { useChromeTranslate } from '@docx-editor.dev/react';
import { ICE_LABELS } from './labels';
import { iceMarker, IceMelt, IceRefreeze } from './icons/review';
import { blocksOf, insideTemperature, OUTSIDE, surveyOf, tipHeight } from './specimens';

/**
 * The theme's word for each kind of tracked change.
 *
 * Through the summary override rather than `labels.ts`, because `Recut` has to sit beside the
 * quoted before-and-after that only a replaced revision has.
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
  const iglooT = useChromeTranslate(ICE_LABELS);
  return (
    <DocxEditorReview
      className="igloo-rail"
      /* The same `t` the toolbar and the menus take; unresolved keys fall back to the bundled
         English rather than to the key. */
      t={iglooT}
      /* The card box, not the column around it. */
      card={{ className: 'igloo-rail__card' }}
      furniture={<CoreLog />}
    >
      {/* Packaged parts, re-iconed and re-classed. Their wiring is untouched. */}
      <DocxEditorReview.Avatar className="igloo-rail__avatar" />
      <DocxEditorReview.Accept className="igloo-rail__action" icon={IceMelt} />
      <DocxEditorReview.Reject className="igloo-rail__action" icon={IceRefreeze} />

      {/* The COLLAPSED rail's gutter markers. `icon` takes a function of the item, so a
          comment, a shift and a specimen are three shapes rather than three bubbles. The
          anchoring and virtualization the part was handed stay the library's. */}
      <DocxEditorReview.Markers icon={iceMarker} />

      {/* The card body, replaced inside the packaged wrapper. */}
      <DocxEditorReview.Summary className="igloo-rail__summary">
        <FloeSummary />
      </DocxEditorReview.Summary>

      {/* Unrecognized children append inside every card, after the packaged parts. */}
      <CardFrost />
    </DocxEditorReview>
  );
}

/** What has been drilled out of this document. Ordinary React over the rail's own hook. */
function CoreLog() {
  const { items } = useReview();
  // Replies are not separate entries, for the same reason they are not separate cards.
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
 * The card body, for all three kinds.
 *
 * `useReviewItem()` is the same hook the packaged parts read: children of a card take the
 * current item from context, not from props.
 */
function FloeSummary() {
  const item = useReviewItem();
  if (!item) return null;
  if (item.kind === 'custom') {
    const detail = item.item.kind === 'custom' ? item.item.detail : undefined;
    return detail ? <span className="igloo-rail__text">{detail}</span> : null;
  }
  if (item.kind === 'comment') {
    // File-derived, so rendered as text and never as markup.
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

/** Appended inside every card: an icicle fringe, plus a specimen panel where there is one. */
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

/** The demo's own element inside the library's card. The berg reads its payload, the igloo its attrs. */
function SpecimenPanel({
  node,
}: {
  node: { name: string; attrs: Readonly<Record<string, string>>; data?: unknown };
}) {
  if (node.name === 'iceberg') {
    const { depth } = surveyOf(node);
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
