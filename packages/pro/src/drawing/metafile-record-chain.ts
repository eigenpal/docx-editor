/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Whether the replayer reads every record of a metafile. It stops quietly at a record whose
// size does not fit, and after its record limit, and returns what it drew so far, which can be
// nothing at all. Walking the chain first tells a picture that drew in full from one that
// stopped early, so the exporter can report the second instead of placing a blank or partial
// picture without a word.
//
// The walk reads only record sizes and types. Each step moves forward by at least one record
// header, and it stops at the record limit, so it is linear in the file size. It is no
// stricter than the replayer: bytes too short to hold a record header after the last record
// are padding, and so is a zero-filled tail; an end record is the end whatever size it
// declares, because every drawing record before it was read; and a stream with no end record
// that runs to its last byte drew in full.

const EMR_EOF = 14;

/**
 * How far the replayer reads a metafile's records: all of them, up to its record limit, or up
 * to a malformed record.
 */
export type MetafileRecordChain = 'intact' | 'record-limit' | 'malformed-record';
const EMF_HEADER_MIN = 88;
const PLACEABLE_KEY = 0x9ac6cdd7;

/** Every byte from `at` to the end zero is padding, not a record. */
function tail(view: DataView, at: number): MetafileRecordChain {
  for (let i = at; i < view.byteLength; i += 1)
    if (view.getUint8(i) !== 0) return 'malformed-record';
  return 'intact';
}

function emfChain(view: DataView, maxRecords: number): MetafileRecordChain {
  if (view.byteLength < EMF_HEADER_MIN) return 'malformed-record';
  const headerSize = view.getUint32(4, true);
  if (headerSize < EMF_HEADER_MIN || headerSize > view.byteLength) return 'malformed-record';
  // The header is the first record.
  let records = 1;
  for (let at = headerSize; at + 8 <= view.byteLength; records += 1) {
    if (records >= maxRecords) return 'record-limit';
    const type = view.getUint32(at, true);
    const size = view.getUint32(at + 4, true);
    if (type === EMR_EOF) return 'intact';
    if (size < 8 || size > view.byteLength - at) return tail(view, at);
    at += size;
  }
  return 'intact';
}

function wmfChain(view: DataView, maxRecords: number): MetafileRecordChain {
  let at = view.byteLength >= 22 && view.getUint32(0, true) === PLACEABLE_KEY ? 22 : 0;
  if (at + 18 > view.byteLength) return 'malformed-record';
  at += view.getUint16(at + 2, true) * 2;
  for (let records = 0; at + 6 <= view.byteLength; records += 1) {
    if (records >= maxRecords) return 'record-limit';
    const size = view.getUint32(at, true) * 2;
    const fn = view.getUint16(at + 4, true);
    if (fn === 0) return 'intact';
    if (size < 6 || size > view.byteLength - at) return tail(view, at);
    at += size;
  }
  return 'intact';
}

/**
 * `intact` when the replayer reads every record of the metafile: each record fits, and the
 * chain reaches its end within `maxRecords`, the record limit the replay runs with. Otherwise
 * the reason the replayer stops early.
 */
export function metafileRecordChain(
  bytes: Uint8Array,
  mime: 'image/x-emf' | 'image/x-wmf',
  maxRecords: number
): MetafileRecordChain {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return mime === 'image/x-emf' ? emfChain(view, maxRecords) : wmfChain(view, maxRecords);
}
