import {
  revisionMarkupColor,
  revisionMarkupStyle,
  type ResolvedRevisionMarkup,
} from '../contracts/revision-markup.ts';
import type { RevisionKind } from '../layout/revision-projection.ts';

/** Apply view-only marks after authored run properties. */
export function paintRevisionMarkup(
  element: HTMLElement,
  settings: ResolvedRevisionMarkup,
  kind: RevisionKind,
  authorColor: string,
  legacyColor?: string
): void {
  const option = revisionMarkupStyle(settings, kind);
  if (option.mark === 'none') {
    return;
  }
  const color = revisionMarkupColor(option.color, legacyColor ?? authorColor);
  if (option.color !== 'auto') element.style.color = color;
  if (option.mark === 'bold') element.style.fontWeight = 'bold';
  if (option.mark === 'italic') element.style.fontStyle = 'italic';
  const line =
    option.mark === 'underline' || option.mark === 'doubleUnderline'
      ? 'underline'
      : option.mark === 'strikethrough' || option.mark === 'doubleStrikethrough'
        ? 'line-through'
        : undefined;
  if (line) {
    element.style.textDecorationLine = line;
    element.style.textDecorationStyle = option.mark.startsWith('double') ? 'double' : 'solid';
    element.style.textDecorationColor = color;
  }
}
