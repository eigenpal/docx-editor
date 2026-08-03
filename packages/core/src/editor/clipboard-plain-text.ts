// The plain text behind a clipboard or drag payload (paginated-surface seam).
//
// Paste stays PLAIN TEXT only — pasted markup is attacker-controlled and rich paste
// belongs behind the same bounded parse the file path uses. But a payload that carries
// `text/html` WITHOUT a `text/plain` flavour used to paste nothing at all, silently: the
// handler prevented the browser's default and then returned on the empty string. A few
// real applications write only the HTML flavour, and for them the editor simply looked
// broken.
//
// So the HTML flavour is read for its TEXT, never for its structure. This is a string
// transform end to end: no `innerHTML`, no `DOMParser`, no DOM built from the payload at
// all, so there is no markup sink to escape from. Whatever comes out is inserted through
// the same path typed text takes, which only ever produces text runs — the worst case for
// a payload this function mis-reads is odd characters, never live markup.

/**
 * The most text this will pull out of one payload.
 *
 * A clipboard is as attacker-controlled as a file: the cap keeps a hostile multi-megabyte
 * payload from turning into an unbounded run of work in the transform below and an
 * unbounded insert afterwards. Truncating beats the old behaviour of dropping silently.
 */
const MAX_HTML_INPUT = 2_000_000;

/** Named entities worth decoding; anything else numeric is handled separately. */
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  // A real U+00A0, written as an escape so it is not an invisible literal in the
  // source. It stays non-breaking rather than collapsing to a space: it is a distinct
  // character with distinct line-breaking behaviour, and Word preserves it too.
  nbsp: '\u00a0',
};

/**
 * Decode character references.
 *
 * Runs LAST, after every tag has already been removed, which is what makes it safe: an
 * authored `&lt;script&gt;` becomes the literal characters `<script>` only once nothing
 * downstream will read them as a tag again.
 */
function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith('#')) {
      const codePoint = body.startsWith('#x')
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      // Surrogates and out-of-range values would throw in fromCodePoint; a payload that
      // names one keeps its literal text rather than taking the paste down with it.
      if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return match;
      if (codePoint >= 0xd800 && codePoint <= 0xdfff) return match;
      return String.fromCodePoint(codePoint);
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

/**
 * The visible text of an HTML fragment.
 *
 * Block boundaries become newlines and table cells become tabs, matching how this engine
 * already flattens a copied cell range — so an HTML table pasted here lands in the same
 * shape a table copied out of the document does.
 */
export function plainTextFromHtml(html: string): string {
  const bounded = html.length > MAX_HTML_INPUT ? html.slice(0, MAX_HTML_INPUT) : html;
  return (
    decodeEntities(
      bounded
        // Comments first: they can contain anything, including tag-shaped text.
        .replace(/<!--[\s\S]*?-->/g, '')
        // Script and style CONTENT is not visible text — dropping the tags alone would
        // paste the source of both.
        .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
        .replace(/<(script|style)\b[^>]*>[\s\S]*$/gi, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(td|th)\s*>/gi, '\t')
        .replace(/<\/(p|div|li|tr|h[1-6]|blockquote|section|article|pre|table)\s*>/gi, '\n')
        // Every remaining tag, open or close. `[^>]*` is linear — no nested quantifier for
        // a hostile payload to walk into.
        .replace(/<[^>]*>/g, '')
    )
      // Collapse the runs of blank lines that block-level markup leaves behind, and drop
      // the trailing tab a final cell contributes.
      .replace(/\r\n?/g, '\n')
      .replace(/\t+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

/**
 * Make pasted text insertable, or the whole paste is refused and NOTHING happens.
 *
 * Run text is serialized into XML, so the store validates every `insertText` against XML
 * 1.0 and rejects the op if it fails — and one rejected op vetoes the atomic transaction.
 * A single stray control character therefore turned an entire paste into a silent no-op.
 *
 * This is not a hypothetical payload. `selectedText()` writes U+000C for a page break, so
 * copying any range that spans one produced text this editor could not paste back into
 * itself: Select All, Copy, Paste did nothing on any document longer than a page.
 *
 * The form feed becomes a paragraph break, which is the honest paragraph-lane reading of a
 * page break — the same reading a newline already gets. Every other character XML 1.0
 * forbids is dropped: a control character has no representation in run text, and losing it
 * beats losing the paste. Mirrors `isValidXmlText` in store/package/sinks.ts; the two must
 * agree, or this silently hands the store something it will refuse.
 */
export function insertableText(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const unit = text.charCodeAt(i);
    // A page break reads as a paragraph break; CRLF/CR normalize with it.
    if (unit === 0x0c) {
      out += '\n';
      continue;
    }
    if (unit === 0x0d) {
      out += '\n';
      if (text.charCodeAt(i + 1) === 0x0a) i += 1;
      continue;
    }
    if (unit === 0x09 || unit === 0x0a) {
      out += text[i]!;
      continue;
    }
    if (unit < 0x20 || unit === 0xfffe || unit === 0xffff) continue;
    // Surrogates only survive as a well-formed pair; a lone one is refused by the store,
    // and truncating a payload mid-pair is an easy way to produce one.
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += text[i]! + text[i + 1]!;
        i += 1;
      }
      continue;
    }
    if (unit >= 0xdc00 && unit <= 0xdfff) continue;
    out += text[i]!;
  }
  return out;
}

/**
 * The text a paste or drop should insert, whatever flavours the payload carries.
 *
 * `text/plain` wins whenever it is present — it is what the source application chose to
 * say. The HTML flavour is a fallback for payloads that omit it, not a richer path.
 */
export function plainTextFromTransfer(data: DataTransfer | null | undefined): string {
  if (!data) return '';
  const plain = data.getData('text/plain');
  if (plain.length > 0) return plain;
  const html = data.getData('text/html');
  if (html.length > 0) return plainTextFromHtml(html);
  return '';
}
