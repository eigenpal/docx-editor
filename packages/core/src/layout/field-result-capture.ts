import type { OoxmlProperty } from '@docx-editor.dev/core/store';
import type { PendingFieldProjection } from './field-pieces.ts';
import type { RevisionAttribution } from './revision-projection.ts';
import type { ResolvedRunStyle } from './run-style.ts';
import type { SpanLinkRecord } from './semantic-records.ts';
import { fieldResultIsDirectionOnly } from './field-result-style.ts';

/** Capture style from visible result text and attribution from its first displayed run. */
export function captureFieldResult(
  pending: PendingFieldProjection | null,
  context: {
    props: readonly OoxmlProperty[];
    style: ResolvedRunStyle;
    revisions: readonly RevisionAttribution[];
    runFormatSite: RevisionAttribution | null;
    currentLink?: SpanLinkRecord;
  },
  resultText?: string
): void {
  const { props, style, revisions, runFormatSite, currentLink } = context;
  if (!pending) return;
  const directionOnly = resultText !== undefined && fieldResultIsDirectionOnly(resultText);
  if (
    !pending.capturedResultStyle ||
    (pending.capturedResultStyleIsDirectional && !directionOnly)
  ) {
    pending.props = props;
    pending.style = style;
    pending.capturedResultStyle = true;
    pending.capturedResultStyleIsDirectional = directionOnly;
  }
  if (!pending.capturedResultRevisions) {
    pending.resultRevisions = revisions;
    pending.resultFormatSite = runFormatSite;
    pending.capturedResultRevisions = true;
    if (!pending.resultLink && currentLink) pending.resultLink = currentLink;
  }
}
