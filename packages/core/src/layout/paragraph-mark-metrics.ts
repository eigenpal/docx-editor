import type { OoxmlProperty } from '../store/store/tree-op-types.ts';
import type { ResolvedRunStyle } from './run-style.ts';

/** Explicit mark formatting and script paragraphs retain their ordinary line-height floor. */
export function shouldIncludeParagraphMarkHeight(
  mark: readonly OoxmlProperty[],
  inherited: readonly OoxmlProperty[],
  spans: readonly { readonly style: ResolvedRunStyle }[]
): boolean {
  return !(
    (mark === inherited || (mark.length === 0 && inherited.length === 0)) &&
    spans.every((span) => span.style.verticalAlign === 'baseline')
  );
}
