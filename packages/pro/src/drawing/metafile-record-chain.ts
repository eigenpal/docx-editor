/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Whether a metafile's records chain to its end. The replayer stops quietly at a record whose
// size does not fit and returns what it drew so far, which can be nothing at all. Walking the
// chain first tells a picture that drew in full from one that stopped early, so the exporter
// can report the second instead of placing a blank or partial picture without a word.
//
// The walk reads only record sizes and types. Each step moves forward by at least one record
// header, so it is linear in the file size.

const EMR_EOF = 14;
const EMF_HEADER_MIN = 88;
const PLACEABLE_KEY = 0x9ac6cdd7;

function emfChainIntact(view: DataView): boolean {
  if (view.byteLength < EMF_HEADER_MIN) return false;
  const headerSize = view.getUint32(4, true);
  if (headerSize < EMF_HEADER_MIN || headerSize > view.byteLength) return false;
  let at = headerSize;
  while (at + 8 <= view.byteLength) {
    const type = view.getUint32(at, true);
    const size = view.getUint32(at + 4, true);
    if (size < 8 || size > view.byteLength - at) return false;
    if (type === EMR_EOF) return true;
    at += size;
  }
  // A stream that ends exactly after its last record, without an end record, drew in full.
  return at === view.byteLength;
}

function wmfChainIntact(view: DataView): boolean {
  let at = view.byteLength >= 22 && view.getUint32(0, true) === PLACEABLE_KEY ? 22 : 0;
  if (at + 18 > view.byteLength) return false;
  const headerWords = view.getUint16(at + 2, true);
  if (headerWords < 9) return false;
  at += headerWords * 2;
  while (at + 6 <= view.byteLength) {
    const size = view.getUint32(at, true) * 2;
    const fn = view.getUint16(at + 4, true);
    if (size < 6 || size > view.byteLength - at) return false;
    if (fn === 0) return true;
    at += size;
  }
  return at === view.byteLength;
}

/** True when every record of the metafile fits and the chain reaches its end. */
export function metafileRecordsIntact(
  bytes: Uint8Array,
  mime: 'image/x-emf' | 'image/x-wmf'
): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return mime === 'image/x-emf' ? emfChainIntact(view) : wmfChainIntact(view);
}
