// Handing saved bytes to the browser, and naming the file.
//
// The name comes from a user-typed document title, and a host that populates `title` from
// the package's own `docProps/core.xml` `dc:title` is feeding it a DOCX-DERIVED string —
// attacker-controlled, per the repo's trust rule. It lands in a `download` attribute,
// which the browser treats as a plain name rather than a path, so this is not an injection
// sink; what it IS is a name the user reads in a download shelf and a file manager, and
// those render bidi overrides and zero-width characters faithfully.

/**
 * Windows reserves these device names WITH ANY EXTENSION — `CON.docx` is still `CON`.
 * Saving to one fails or behaves strangely, so the name falls back instead.
 */
const RESERVED_DEVICE_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * Characters that must not survive into a filename, in one class:
 *
 * - U+0000-U+001F C0 controls, U+007F DEL and the U+0080-U+009F C1 block. A newline
 *   would split the name; the rest are invisible.
 * - U+200B-U+200F zero-width space/non-joiner/joiner and the LTR/RTL marks. A title of
 *   nothing but these is "truthy", so it would save as a file the user can neither
 *   find in a list nor type in a terminal.
 * - U+202A-U+202E and U+2066-U+2069, the bidi embedding and isolate overrides. This is
 *   the filename-spoofing class: a title ending in RIGHT-TO-LEFT OVERRIDE followed by
 *   "fdp.exe" renders in a download shelf and in Finder as "...exe.pdf", while the
 *   bytes are a .docx. Display-only deception rather than execution, which is why it
 *   is low severity and still not something to ship.
 * - U+FEFF, the BOM / zero-width no-break space.
 * - The Windows-reserved characters, which include both path separators.
 *
 * Ordinary punctuation and spaces are deliberately KEPT: a title is prose, and
 * "Q3 report - draft" should survive as itself.
 */
const UNSAFE_IN_FILENAME =
  /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff<>:"/\\|?*]/g;

/**
 * A conservative byte cap. `NAME_MAX` is 255 BYTES on ext4 and APFS, not 255 characters —
 * 120 emoji is 480 bytes — and the `.docx` suffix has to fit too.
 */
const MAX_NAME_BYTES = 200;

const encoder = new TextEncoder();

/**
 * Truncate to a UTF-8 byte budget without splitting a character.
 *
 * Iterating with `for…of` walks CODE POINTS, so an astral character is kept or dropped
 * whole. Slicing by UTF-16 units instead could leave a lone surrogate, which the browser
 * renders as U+FFFD in the name it saves.
 */
function capBytes(value: string, maxBytes: number): string {
  if (encoder.encode(value).length <= maxBytes) return value;
  let bytes = 0;
  let out = '';
  for (const character of value) {
    const size = encoder.encode(character).length;
    if (bytes + size > maxBytes) break;
    bytes += size;
    out += character;
  }
  return out;
}

/**
 * A download name from a user-typed title, always ending in `.docx`.
 *
 * Falls back to `document.docx` when nothing usable survives — including for a title that
 * is only separators, only dots, or a reserved device name.
 */
export function downloadName(title: string | undefined): string {
  const base = capBytes(
    (title ?? '')
      .replace(/\.docx$/i, '')
      .replace(UNSAFE_IN_FILENAME, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      // Windows silently drops trailing dots and spaces, and a LEADING dot makes a hidden
      // file with an empty stem on macOS and Linux (`.docx` from a title of ".").
      .replace(/^[.\s]+/, '')
      .replace(/[.\s]+$/, ''),
    MAX_NAME_BYTES
  ).trim();
  if (!base || RESERVED_DEVICE_NAME.test(base)) return 'document.docx';
  return `${base}.docx`;
}

/** Hand DOCX bytes to the browser as a download. */
export function download(buffer: ArrayBuffer, name: string): void {
  const url = URL.createObjectURL(
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  // Revoked on the next task, not inline: some browsers have not finished reading the
  // blob when `click()` returns, and a revoked URL cancels the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
