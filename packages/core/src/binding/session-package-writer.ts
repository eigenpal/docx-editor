import { writeOoxmlPackage, type OoxmlPackage } from '@docx-editor.dev/core/store';

// Retain at most one compressed document per session, never an XML copy per undo state.
const MAX_CACHED_SAVE_BYTES = 8 * 1024 * 1024;

/** Cache only exact immutable package snapshots; every caller owns its returned bytes. */
export function createSessionPackageWriter(): (pkg: OoxmlPackage) => Uint8Array {
  // A weak key avoids keeping a previous package/tree alive after the session advances.
  // Replacing the map on a miss also bounds retained output when undo keeps old keys alive.
  let cached = new WeakMap<OoxmlPackage, Uint8Array>();
  return (pkg) => {
    const previous = cached.get(pkg);
    if (previous) return previous.slice();
    const bytes = writeOoxmlPackage(pkg);
    cached = new WeakMap();
    if (bytes.byteLength <= MAX_CACHED_SAVE_BYTES) cached.set(pkg, bytes.slice());
    return bytes;
  };
}
