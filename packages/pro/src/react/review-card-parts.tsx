/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The card and its parts. The Vue twin is `../vue/review-card-parts.tsx`.

import { Fragment, useContext, useId, useMemo } from 'react';
import type { ReactNode } from 'react';
import { Slot, useTranslation } from '@docx-editor.dev/react';
import type { ReviewItemView } from './useReview.ts';
import type { ReviewActionProps, ReviewPartProps } from './review-types.ts';
import { ReviewItemContext, useRail, useReviewLabel } from './review-context.ts';
import { COMPOSE_KEY, REVIEW_DATE_FORMAT, guardMousedown } from './review-shared.ts';
import { isCardControl, keepsPressFocus } from '../review/card-controls.ts';
import { authorCardStyle, authorSlot } from './review-author-styles.ts';
import { ACCEPT_ICON, DELETE_ICON, REJECT_ICON, icon } from './review-icons.tsx';
import { ResolvedCommentCard, createCommentResolutionParts } from './review-comment-resolution.tsx';
import { createReviewComposeParts } from './review-compose-boxes.tsx';
import { ReviewActionSlot } from './review-action-slot.tsx';
import { revisionItemLabel } from './review-labels.ts';

export const { ReviewResolve, ReviewReopen } = createCommentResolutionParts({
  useReview: () => useRail().review,
  useItem: () => useContext(ReviewItemContext),
  useLabel: useReviewLabel,
  guardMousedown,
});

export const { ReviewDraft, ReviewReply, ReviewBalloonReply } = createReviewComposeParts({
  useRail,
  useItem: () => useContext(ReviewItemContext),
  useLabel: useReviewLabel,
  guardMousedown,
  composeKey: COMPOSE_KEY,
});

/** Shown when nothing is pending. @public */
export function ReviewEmpty({ className, hidden, children }: ReviewPartProps) {
  const t = useReviewLabel();
  if (hidden) return null;
  return (
    <div
      className={`docx-review__empty${className ? ` ${className}` : ''}`}
      data-testid="review-empty"
    >
      {children ?? t('review.empty')}
    </div>
  );
}
ReviewEmpty.docxReviewPart = 'Empty' as const;

/**
 * One card.
 *
 * Clicking it makes the item active, which SELECTS ITS RANGE in the document — the card and
 * the text it is about are two views of one thing, and a card that highlighted nothing left
 * the reader hunting for which words a comment meant.
 *
 * @public
 */
export function ReviewCard({ className, asChild, hidden, children }: ReviewPartProps) {
  const { review, authorSlots, authorInfo, commentMarkers } = useRail();
  const entry = useContext(ReviewItemContext);
  const cardId = useId();
  const t = useReviewLabel();
  if (hidden || !entry) return null;
  const slot = authorSlots.get(entry.author) ?? 0;
  const resolvedCollapsible = !asChild && entry.kind === 'comment' && entry.resolved;

  const shared = {
    className: `docx-review__card${className ? ` ${className}` : ''}`,
    'data-testid': 'review-card',
    ...(!resolvedCollapsible ? { 'aria-labelledby': `${cardId}-author ${cardId}-summary` } : {}),
    'data-kind': entry.kind === 'revision' ? (entry.revisionKind ?? 'revision') : entry.kind,
    // Match each card to its painted author style.
    ...(entry.author
      ? {
          'data-review-author': entry.author,
          'data-review-author-slot': authorSlot(authorInfo.get(entry.author), slot),
        }
      : {}),
    // Let themes distinguish custom node types.
    ...(entry.kind === 'custom' && entry.item.kind === 'custom'
      ? { 'data-node-name': entry.item.name }
      : {}),
    ...(entry.isActive ? { 'data-active': '' } : {}),
    ...(entry.kind === 'comment' && entry.resolved ? { 'data-resolved': '' } : {}),
    ...(resolvedCollapsible ? { 'data-resolved-miniature': '' } : {}),
    // Keep author identity when a host restyles the card.
    style: authorCardStyle(entry.author, authorInfo.get(entry.author), slot),
    ...(!resolvedCollapsible ? { tabIndex: 0, role: 'button' as const } : {}),
    id: cardId,
    // Restore keyboard focus without moving the document caret.
    ...(!resolvedCollapsible
      ? {
          onMouseDown: (event: React.MouseEvent) => {
            if (keepsPressFocus(event.target)) return;
            (event.currentTarget as HTMLElement).focus({ preventScroll: true });
          },
          onClick: (event: React.MouseEvent) => {
            if (!isCardControl(event.target) && !entry.isActive) review.setActive(entry.key);
          },
          onKeyDown: (event: React.KeyboardEvent) => {
            if (event.target !== event.currentTarget) return;
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            review.setActive(entry.key);
          },
        }
      : {}),
  };

  if (asChild) return <Slot {...shared}>{children}</Slot>;
  if (resolvedCollapsible) {
    return (
      <ResolvedCommentCard
        {...shared}
        label={t('review.showResolvedComment')}
        statusLabel={t('review.resolved')}
        entryKey={entry.key}
        badge={commentMarkers === 'avatar'}
        onActivate={() => review.setActive(entry.key)}
        onDeactivate={() => review.setActive(null)}
      >
        <ReviewCardPreset>{children}</ReviewCardPreset>
      </ResolvedCommentCard>
    );
  }
  return (
    <div {...shared}>
      <ReviewCardPreset>{children}</ReviewCardPreset>
    </div>
  );
}
ReviewCard.docxReviewPart = 'Card' as const;

/**
 * The packaged card, with in-place part override.
 *
 * A part passed as a child REPLACES the preset's copy of it rather than appending to it, so
 * `<Review.Reply hidden />` removes the reply box instead of adding a second hidden one.
 */
function ReviewCardPreset({ children }: { children?: ReactNode }) {
  const entry = useContext(ReviewItemContext);
  const overrides = useMemo(() => partOverrides(children), [children]);
  const take = (key: string, fallback: ReactNode): ReactNode =>
    key in overrides ? overrides[key] : fallback;
  if (!entry) return null;

  // A custom-node card is the definition's own: its `reviewCard` hook titled it, and it
  // has no author, no thread and nothing to resolve. Every string renders as TEXT — the
  // attrs and label originate in the file.
  if (entry.kind === 'custom' && entry.item.kind === 'custom') {
    const item = entry.item;
    // Overridable like every other kind. `Author` carries the title because that is the slot
    // it occupies in the packaged card.
    return (
      <>
        <div className="docx-review__head">
          {take('Avatar', null)}
          <div className="docx-review__meta">
            {take(
              'Author',
              <span className="docx-review__author" data-testid="review-custom-title">
                {item.title}
              </span>
            )}
          </div>
        </div>
        {take(
          'Summary',
          item.detail ? (
            <div
              className="docx-review__summary"
              data-testid="review-summary"
              data-review-selectable=""
            >
              <span className="docx-review__text">{item.detail}</span>
            </div>
          ) : null
        )}
        {overrides.__extra}
      </>
    );
  }
  const resolvable = entry.kind === 'revision' && !entry.readOnly;

  return (
    <>
      <div className="docx-review__head">
        {take('Avatar', <ReviewAvatar />)}
        <div className="docx-review__meta">
          {take('Author', <ReviewAuthor />)}
          {take('Time', <ReviewTime />)}
        </div>
        {/* Accept and Reject are absent, not disabled, on a kind the engine cannot resolve:
            a button that can never do anything is chrome pretending to be a capability.
            Delete follows the same rule and is on BOTH kinds, so every card a reader can
            act on carries a way to be rid of it. */}
        {resolvable || entry.kind === 'comment' ? (
          <div className="docx-review__actions">
            {take('Accept', <ReviewAccept />)}
            {take('Reject', <ReviewReject />)}
            {take('Resolve', <ReviewResolve />)}
            {take('Reopen', <ReviewReopen />)}
            {take('Delete', entry.kind === 'comment' ? <ReviewDelete /> : null)}
          </div>
        ) : null}
      </div>
      {take('Summary', <ReviewSummary />)}
      {take('Replies', <ReviewReplies />)}
      {take('Reply', <ReviewReply />)}
      {overrides.__extra}
    </>
  );
}

/** Map a child's part marker to itself, so the preset can swap it in place. */
function partOverrides(children: ReactNode): Record<string, ReactNode> {
  const found: Record<string, ReactNode> = {};
  const extra: ReactNode[] = [];
  const visit = (node: ReactNode): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== 'object' || !('type' in node)) {
      if (node) extra.push(node);
      return;
    }
    // A FRAGMENT is grouping, not content: `<><Accept/><Reject/></>` is the natural way to
    // pass two overrides, and treating it as an unrecognised child would render both inside
    // the card while the preset still drew its own copies of each.
    if (node.type === Fragment) {
      visit((node.props as { children?: ReactNode }).children);
      return;
    }
    const marker = (node.type as { docxReviewPart?: string }).docxReviewPart;
    if (marker) found[marker] = node;
    else extra.push(node);
  };
  visit(children);
  if (extra.length > 0) found.__extra = extra;
  return found;
}

/** The author's initials, in their colour. @public */
export function ReviewAvatar({ className, asChild, hidden, children }: ReviewPartProps) {
  const { authorInfo } = useRail();
  const entry = useContext(ReviewItemContext);
  if (hidden || !entry) return null;
  // Nothing to show is not an empty disc: a custom node's card has no author. Children win,
  // because a host passing its own glyph means it whatever the item says.
  if (children === undefined && !entry.initials) return null;
  const shared = {
    className: `docx-review__avatar${className ? ` ${className}` : ''}`,
    'data-testid': 'review-avatar',
    'aria-hidden': true,
  };
  if (asChild) return <Slot {...shared}>{children}</Slot>;
  // A host-supplied image replaces the initials; the disc (and its author-coloured
  // background, visible until the image loads) stays.
  // Already sanitised where the style was normalised, so every consumer of the roster —
  // this card and a host rendering its own — gets the same guarantee.
  const avatarUrl = authorInfo.get(entry.author)?.style?.avatarUrl;
  const face =
    children ??
    (avatarUrl ? (
      // `no-referrer`: a card renders as soon as it scrolls into view, so an avatar on a
      // third-party host would otherwise beacon the document's page URL on every render.
      <img
        className="docx-review__avatar-img"
        src={avatarUrl}
        alt=""
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
      />
    ) : undefined) ??
    entry.initials;
  return <span {...shared}>{face}</span>;
}
ReviewAvatar.docxReviewPart = 'Avatar' as const;

/** The author's name. @public */
export function ReviewAuthor({ className, asChild, hidden, children }: ReviewPartProps) {
  const entry = useContext(ReviewItemContext);
  const t = useReviewLabel();
  if (hidden || !entry) return null;
  const author = entry.author || t('comments.unknown');
  const shared = {
    className: `docx-review__author${className ? ` ${className}` : ''}`,
    'data-testid': 'review-author',
  };
  if (asChild) return <Slot {...shared}>{children}</Slot>;
  return <span {...shared}>{children ?? author}</span>;
}
ReviewAuthor.docxReviewPart = 'Author' as const;

/**
 * When the change was made.
 *
 * `@w:date` is optional in `CT_TrackChange` and files omit it when the author turned off
 * "store randomized IDs"/date stamping, so a missing date renders nothing rather than an
 * "Invalid Date".
 *
 * @public
 */
export function ReviewTime({ className, asChild, hidden, children }: ReviewPartProps) {
  const entry = useContext(ReviewItemContext);
  if (hidden || !entry) return null;
  const raw = entry.date;
  if (!raw) return null;
  const when = new Date(raw);
  if (Number.isNaN(when.getTime())) return null;
  // No `title`: the visible text already carries the date and time, and the native tooltip
  // popped over the author's name in the balloon, reading as a mystery grey box.
  const shared = {
    className: `docx-review__time${className ? ` ${className}` : ''}`,
    'data-testid': 'review-time',
    dateTime: raw,
  };
  if (asChild) return <Slot {...shared}>{children}</Slot>;
  // Month, day and time — what a reviewer actually needs: two comments
  // on the same day are ordered by the clock, which a bare date hides.
  return <time {...shared}>{children ?? REVIEW_DATE_FORMAT.format(when)}</time>;
}
ReviewTime.docxReviewPart = 'Time' as const;

/**
 * What the card is about: the comment's text, or what the revision did.
 *
 * A revision that carries no characters — a formatting change, a paragraph mark, a row
 * insertion — still gets a sentence. A card reading only "Ada Lovelace"
 * tells the reviewer nothing they can decide on.
 *
 * @public
 */
export function ReviewSummary({ className, asChild, hidden, children }: ReviewPartProps) {
  const entry = useContext(ReviewItemContext);
  const t = useReviewLabel();
  if (hidden || !entry) return null;
  const text = entry.text;
  const label = entry.kind !== 'revision' ? null : revisionItemLabel(entry.item, t);
  // A replacement reads as one sentence, not as a label over a quote: what went, and what
  // took its place. Both quoted, both in their own colour.
  const replaced = entry.kind === 'revision' && entry.revisionKind === 'replace';
  const shared = {
    className: `docx-review__summary${className ? ` ${className}` : ''}`,
    'data-testid': 'review-summary',
    'data-review-selectable': '',
  };
  if (asChild) return <Slot {...shared}>{children}</Slot>;
  return (
    <div {...shared}>
      {children ??
        (replaced ? (
          <span className="docx-review__text">
            {t('review.replaced')}{' '}
            <span className="docx-review__removed">&quot;{entry.replacedText}&quot;</span>{' '}
            {t('review.replacedWith')}{' '}
            <span className="docx-review__added">&quot;{text}&quot;</span>
          </span>
        ) : (
          <>
            {/* `data-kind` carries the colour: an "Added" label in the green the insertion
                already wears reads as one statement with the document, where a grey label
                over green text reads as two. */}
            {label ? (
              <span
                className="docx-review__label"
                data-kind={entry.kind === 'revision' ? entry.revisionKind : 'revision'}
              >
                {label}
              </span>
            ) : null}
            {/* The quoted text is the DOCUMENT's, so it is rendered as text and never as
                markup: a `.docx` is a zip of XML an attacker controls end to end. */}
            {text ? <span className="docx-review__text">{text}</span> : null}
          </>
        ))}
    </div>
  );
}
ReviewSummary.docxReviewPart = 'Summary' as const;

/** Accept the revision behind this card. @public */
export function ReviewAccept({
  className,
  asChild,
  hidden,
  children,
  icon: glyph,
}: ReviewActionProps) {
  const { readOnly, review } = useRail();
  const entry = useContext(ReviewItemContext);
  const t = useReviewLabel();
  if (hidden || !entry || entry.kind !== 'revision' || entry.readOnly) return null;
  const label = t('review.accept');
  const disabledReason = readOnly ? t('editingMode.viewingHint') : null;
  const shared = {
    type: 'button' as const,
    className: `docx-review__action${className ? ` ${className}` : ''}`,
    'data-testid': 'review-accept',
    'aria-label': label,
    title: disabledReason ?? label,
    disabled: readOnly,
    onMouseDown: guardMousedown,
    onClick: (event: React.MouseEvent) => {
      event.stopPropagation();
      if (readOnly) return;
      review.accept(entry);
    },
  };
  if (asChild) {
    return (
      <ReviewActionSlot
        engineDisabled={readOnly}
        disabledReason={disabledReason}
        slotProps={shared}
      >
        {children}
      </ReviewActionSlot>
    );
  }
  return <button {...shared}>{glyph ?? children ?? icon(ACCEPT_ICON)}</button>;
}
ReviewAccept.docxReviewPart = 'Accept' as const;

/** Reject the revision behind this card. @public */
export function ReviewReject({
  className,
  asChild,
  hidden,
  children,
  icon: glyph,
}: ReviewActionProps) {
  const { readOnly, review } = useRail();
  const entry = useContext(ReviewItemContext);
  const t = useReviewLabel();
  if (hidden || !entry || entry.kind !== 'revision' || entry.readOnly) return null;
  const label = t('review.reject');
  const disabledReason = readOnly ? t('editingMode.viewingHint') : null;
  const shared = {
    type: 'button' as const,
    className: `docx-review__action${className ? ` ${className}` : ''}`,
    'data-testid': 'review-reject',
    'aria-label': label,
    title: disabledReason ?? label,
    disabled: readOnly,
    onMouseDown: guardMousedown,
    onClick: (event: React.MouseEvent) => {
      event.stopPropagation();
      if (readOnly) return;
      review.reject(entry);
    },
  };
  if (asChild) {
    return (
      <ReviewActionSlot
        engineDisabled={readOnly}
        disabledReason={disabledReason}
        slotProps={shared}
      >
        {children}
      </ReviewActionSlot>
    );
  }
  return <button {...shared}>{glyph ?? children ?? icon(REJECT_ICON)}</button>;
}
ReviewReject.docxReviewPart = 'Reject' as const;

/**
 * Discard what the card holds: delete a comment thread, or reject a tracked change.
 *
 * The rail had accept and reject for a change and NOTHING for a comment, so a remark could be
 * resolved but never removed — a reader who commented by mistake had to go back to the text and
 * delete the words to be rid of it. One control on both kinds, because "remove this" is the same
 * intent whichever the card holds; the engine's `deleteReviewItem` decides what it means.
 *
 * Absent, not disabled, on a card with nothing to discard — a custom node's, or a revision kind
 * the engine cannot resolve.
 *
 * Revealed on HOVER of the one thing it deletes, and on keyboard focus — the stylesheet owns
 * that, not this component. A rail of twenty cards each carrying a standing invitation to
 * delete somebody's remark reads as an invitation to click one by mistake; scoping it to the
 * node under the pointer also means a reply and the comment it answers never offer two
 * identical buttons at once, which is the state that makes a reader delete the wrong one.
 *
 * CSS rather than an `isActive` gate because a reply is never itself the active item, and
 * because requiring the reader to open a card before they can be rid of it is a step with
 * nothing behind it. `visibility`, not `opacity`: hidden must also mean unclickable, and the
 * space stays reserved so the row does not jump as the pointer crosses it.
 *
 * @public
 */
export function ReviewDelete({
  className,
  asChild,
  hidden,
  children,
  icon: glyph,
}: ReviewActionProps) {
  const { readOnly, review } = useRail();
  const entry = useContext(ReviewItemContext);
  const { t } = useTranslation();
  if (hidden || !entry || entry.kind === 'custom') return null;
  if (entry.kind === 'revision' && entry.readOnly) return null;
  const label = entry.kind === 'comment' ? t('review.deleteComment') : t('review.discardChange');
  const disabledReason = readOnly ? t('editingMode.viewingHint') : null;
  const shared = {
    type: 'button' as const,
    className: `docx-review__action${className ? ` ${className}` : ''}`,
    'data-testid': 'review-delete',
    'aria-label': label,
    title: disabledReason ?? label,
    disabled: readOnly,
    onMouseDown: guardMousedown,
    onClick: (event: React.MouseEvent) => {
      // The card is a `role="button"` that activates the item; without this the click both
      // deleted the comment and asked the engine to open a card that no longer exists.
      event.stopPropagation();
      if (readOnly) return;
      review.remove(entry);
    },
  };
  if (asChild) {
    return (
      <ReviewActionSlot
        engineDisabled={readOnly}
        disabledReason={disabledReason}
        slotProps={shared}
      >
        {children}
      </ReviewActionSlot>
    );
  }
  return <button {...shared}>{glyph ?? children ?? icon(DELETE_ICON)}</button>;
}
ReviewDelete.docxReviewPart = 'Delete' as const;

/** The thread under a comment, in document order. @public */
export function ReviewReplies({ className, hidden }: ReviewPartProps) {
  const { byId, authorSlots, authorInfo } = useRail();
  const entry = useContext(ReviewItemContext);
  // Comments AND revisions. A reply to a tracked change is a comment over that change's range,
  // and refusing to draw it here is what put the reader's answer in a card of its own, floating
  // beside the change instead of under it.
  if (hidden || !entry || entry.kind === 'custom') return null;
  const replies = entry.replyIds
    .map((id) => byId.get(id))
    .filter((reply): reply is ReviewItemView => reply !== undefined);
  if (replies.length === 0) return null;
  return (
    <ol className={`docx-review__replies${className ? ` ${className}` : ''}`}>
      {replies.map((reply) => (
        <ReviewItemContext.Provider key={reply.key} value={reply}>
          <li
            className="docx-review__reply"
            data-testid="review-reply"
            // Each reply draws in its OWN author's colour, not the thread's.
            {...(reply.author
              ? {
                  'data-review-author': reply.author,
                  'data-review-author-slot': authorSlot(
                    authorInfo.get(reply.author),
                    authorSlots.get(reply.author) ?? 0
                  ),
                }
              : {})}
            style={authorCardStyle(
              reply.author,
              authorInfo.get(reply.author),
              authorSlots.get(reply.author) ?? 0
            )}
          >
            <div className="docx-review__head">
              <ReviewAvatar />
              <div className="docx-review__meta">
                <ReviewAuthor />
                <ReviewTime />
              </div>
              {/* A reply is a comment like any other and can be deleted like one. Without
                  this the only way to take back a reply was to delete the whole thread it
                  hangs off — the parent's control is the only one that was drawn. */}
              <div className="docx-review__actions">
                <ReviewDelete />
              </div>
            </div>
            <ReviewSummary />
          </li>
        </ReviewItemContext.Provider>
      ))}
    </ol>
  );
}
ReviewReplies.docxReviewPart = 'Replies' as const;
