import {
  markRevisionRemovesMark,
  shownMarkRevision,
  type RevisionAttribution,
  type LineRecord,
} from '@docx-editor.dev/core/layout';
import {
  REVIEW_AUTHOR_SLOTS,
  reviewAuthorSlotColor,
  type RevisionStyleContext,
} from './revision-presentation.ts';

/** Manual line-break furniture. The zero-width model span still owns the newline. */
export function paintManualLineBreak(
  document: Document,
  line: LineRecord,
  scale: number
): HTMLElement {
  const glyph = document.createElement('span');
  const last = line.spans[line.spans.length - 1];
  glyph.className = 'docx-line-break-mark';
  glyph.dataset.docxMarker = '';
  glyph.setAttribute('aria-hidden', 'true');
  glyph.contentEditable = 'false';
  glyph.textContent = '\u21b5';
  glyph.style.position = 'absolute';
  glyph.style.pointerEvents = 'none';
  glyph.style.userSelect = 'none';
  glyph.style.left = `${((last ? last.box.x + last.box.width : line.contentX) - line.contentX) * scale}px`;
  glyph.style.top = `${line.leading * scale}px`;
  glyph.style.marginLeft = `${2 * scale}px`;
  glyph.style.fontSize = `${(last?.style.fontSizePt ?? line.box.height) * scale}px`;
  glyph.style.lineHeight = `${Math.max(0, line.box.height - line.leading - (line.trailingSpacing ?? 0)) * scale}px`;
  glyph.style.color = 'var(--doc-revision-format)';
  return glyph;
}

/**
 * The pilcrow beside a paragraph whose MARK was inserted or deleted.
 *
 * Show/Hide controls its visibility independently of revision selection. A tracked
 * deletion retains its strike and attribution when paragraph marks are visible.
 *
 * Furniture: no model range, `aria-hidden`, not editable, so it can never be selected, copied
 * or counted as text.
 */
export function paintParagraphMark(
  document: Document,
  revisions: readonly RevisionAttribution[],
  scale: number,
  colors: RevisionStyleContext | undefined
): HTMLElement {
  // ONE glyph however many decisions stand on it: there is one pilcrow, and drawing a second
  // beside it would read as a second paragraph break. A REMOVAL wins the face when a mark
  // carries both — a break proposed and then unproposed ends up removed, and the same rule
  // already decides the colour of a change bar over mixed lines. `moveFrom` counts as a
  // removal, which is what keeps this glyph agreeing with the rule in the margin beside it.
  // Both attributions are published on the element, so review chrome can offer both.
  const shown = shownMarkRevision(revisions);
  if (!shown) {
    const glyph = document.createElement('span');
    glyph.className = 'docx-paragraph-mark';
    glyph.setAttribute('aria-hidden', 'true');
    glyph.contentEditable = 'false';
    glyph.textContent = '\u00b6';
    glyph.style.position = 'absolute';
    glyph.style.pointerEvents = 'none';
    glyph.style.marginLeft = `${2 * scale}px`;
    glyph.style.color = 'var(--doc-revision-format)';
    return glyph;
  }
  const glyph = document.createElement('span');
  glyph.className = `docx-paragraph-mark docx-revision-pmark docx-revision-pmark-${shown.kind}`;
  glyph.setAttribute('aria-hidden', 'true');
  glyph.contentEditable = 'false';
  glyph.dataset.revisionKind = shown.kind;
  glyph.dataset.revisionId = shown.id;
  if (shown.author !== '') glyph.dataset.reviewAuthor = shown.author;
  // Always, not only for a pair: a consumer reading `data-revision-ids` should not have to
  // fall back to `data-revision-id` for the ordinary case. Kinds ride alongside, because the
  // ids alone cannot say which decision each one is.
  glyph.dataset.revisionIds = revisions.map((revision) => revision.id).join(' ');
  glyph.dataset.revisionKinds = revisions.map((revision) => revision.kind).join(' ');
  glyph.textContent = '\u00b6';
  glyph.style.position = 'absolute';
  glyph.style.pointerEvents = 'none';
  glyph.style.marginLeft = `${2 * scale}px`;
  const removes = markRevisionRemovesMark(shown);
  // Under author colouring the glyph follows its author, like the spans beside it; the
  // strike still says a removal is a removal.
  const markStyle = colors?.styles.get(shown.author);
  const markSlot = colors ? (colors.authorSlots.get(shown.author) ?? 0) % REVIEW_AUTHOR_SLOTS : 0;
  if (colors) {
    glyph.dataset.reviewAuthorSlot = String(markSlot);
    const tokens = colors.classTokens.get(shown.author);
    if (tokens) for (let i = 0; i < tokens.length; i += 1) glyph.classList.add(tokens[i]!);
  }
  // The same selective rule as the spans, read straight off the maps: building a whole
  // presentation object for one field allocated per paragraph mark, and a heavily revised
  // document has one per paragraph.
  glyph.style.color =
    markStyle?.color ??
    (colors?.others === 'author'
      ? reviewAuthorSlotColor(markSlot)
      : removes
        ? 'var(--doc-revision-deletion)'
        : 'var(--doc-revision-insertion)');
  if (removes) glyph.style.textDecorationLine = 'line-through';
  return glyph;
}
