// The field-result addressing mode and the field date as cache-key components.
//
// In the `editable` mode a saved field result is laid out as ordinary text at its own model
// offsets; in `atomic` it is one unit. Pieces, breaks, and every offset a layout memo stores
// differ between the two, so a cache entry made in one mode must never answer the other. A
// DATE or TIME field shows the field date, so an entry made for one date must not answer
// another. The producer string is folded into every paragraph cache key, so both ride it.

import { currentFieldResultsMode } from '../store/package/field-result-mode.ts';
import { currentFieldDate } from './field-date.ts';

/**
 * `producer`, marked when the layout call in progress addresses saved results as text, and
 * with the moment DATE and TIME fields show.
 */
export function withFieldResultsProducer(producer: string): string {
  const addressed =
    currentFieldResultsMode() === 'editable' ? `${producer}|field-results` : producer;
  const date = currentFieldDate();
  return date === undefined ? addressed : `${addressed}|field-date:${date.getTime()}`;
}
