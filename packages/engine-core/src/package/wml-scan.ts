// WordprocessingML source-span scanner (document-engine task 2.10). Bounded, strict,
// string-level scanning of the ORIGINAL part text used by lossless preservation: it
// locates top-level body block spans and cell-paragraph spans WITHOUT re-parsing, and
// enforces well-formedness itself (the reader is lenient).
//
// OFFSETS ARE JAVASCRIPT STRING (UTF-16 CODE UNIT) INDICES into the original part text
// — NOT byte offsets. Only the top-level entry points are exported; the tag-walking
// primitives are private to this module.

const NAME_STOP = ' \t\r\n/>';

/** The element name at `<` position `lt` (handles the leading '/'); '' if none. */
function tagNameAt(s: string, lt: number): string {
  let i = lt + 1;
  if (s[i] === '/') i += 1;
  const start = i;
  while (i < s.length && !NAME_STOP.includes(s[i])) i += 1;
  return s.slice(start, i);
}

/** Index just past the '>' of the tag opening at `lt`, tracking attribute quotes. */
function openTagEnd(s: string, lt: number): { end: number; selfClosing: boolean } {
  let i = lt + 1;
  let quote = '';
  while (i < s.length) {
    const c = s[i];
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '>') {
      return { end: i + 1, selfClosing: s[i - 1] === '/' };
    }
    i += 1;
  }
  return { end: s.length, selfClosing: false };
}

/** Raised when the span scanner sees XML that is not well-formed (the reader is
 *  lenient, so the scanner enforces well-formedness itself). Callers fail closed. */
export class ScanError extends Error {}

/**
 * Index just past the end of the element opening at `lt`. NAME-AWARE: it tracks the
 * open-tag name stack and throws {@link ScanError} on a mismatched or missing close
 * tag, so malformed-but-lenient-parsed XML cannot yield a wrong ownership range.
 */
function elementSpanEnd(s: string, lt: number): number {
  const open = openTagEnd(s, lt);
  if (open.selfClosing) return open.end;
  const stack: string[] = [tagNameAt(s, lt)];
  let i = open.end;
  while (stack.length > 0) {
    const nx = s.indexOf('<', i);
    if (nx < 0) throw new ScanError('unclosed element');
    if (s.startsWith('<!--', nx)) {
      const e = s.indexOf('-->', nx);
      if (e < 0) throw new ScanError('unterminated comment');
      i = e + 3;
    } else if (s.startsWith('<![CDATA[', nx)) {
      const e = s.indexOf(']]>', nx);
      if (e < 0) throw new ScanError('unterminated cdata');
      i = e + 3;
    } else if (s.startsWith('<?', nx)) {
      const e = s.indexOf('?>', nx);
      if (e < 0) throw new ScanError('unterminated pi');
      i = e + 2;
    } else if (s.startsWith('<!', nx)) {
      const e = s.indexOf('>', nx);
      if (e < 0) throw new ScanError('unterminated declaration');
      i = e + 1;
    } else if (s[nx + 1] === '/') {
      const closeName = tagNameAt(s, nx);
      const o = openTagEnd(s, nx); // quote-aware: a '>' inside an attribute value is skipped
      if (s[o.end - 1] !== '>') throw new ScanError('unterminated close tag');
      // A close tag is `</name  >` — no attributes allowed (XML spec).
      if (s.slice(nx + 2 + closeName.length, o.end - 1).trim() !== '') throw new ScanError('malformed close tag');
      if (stack.pop() !== closeName) throw new ScanError('mismatched close tag');
      i = o.end;
    } else {
      const o = openTagEnd(s, nx);
      if (!o.selfClosing) stack.push(tagNameAt(s, nx));
      i = o.end;
    }
  }
  return i;
}

/** First OPENING tag whose full name matches, at/after `from`, before `before`,
 *  SKIPPING comment/CDATA/PI/decl regions so a decoy `<name>` inside them (e.g. a
 *  prolog comment containing `<w:body>`) can never be matched. */
function findOpen(s: string, name: string, from: number, before: number): number {
  let i = from;
  while (i < before) {
    const lt = s.indexOf('<', i);
    if (lt < 0 || lt >= before) return -1;
    if (s.startsWith('<!--', lt)) {
      const e = s.indexOf('-->', lt);
      i = e < 0 ? before : e + 3;
    } else if (s.startsWith('<![CDATA[', lt)) {
      const e = s.indexOf(']]>', lt);
      i = e < 0 ? before : e + 3;
    } else if (s.startsWith('<?', lt)) {
      const e = s.indexOf('?>', lt);
      i = e < 0 ? before : e + 2;
    } else if (s.startsWith('<!', lt)) {
      const e = s.indexOf('>', lt);
      i = e < 0 ? before : e + 1;
    } else if (s[lt + 1] === '/') {
      i = lt + 1; // a close tag, not an opening
    } else if (tagNameAt(s, lt) === name) {
      return lt;
    } else {
      i = lt + 1;
    }
  }
  return -1;
}

export interface BlockSpan {
  readonly name: 'w:p' | 'w:tbl';
  readonly start: number;
  readonly end: number;
}

/** Emit spans for each w:p / w:tbl directly under [start,end), descending into
 *  block-level w:sdt > w:sdtContent and w:customXml so wrapped blocks are still found. */
function walkBlockSpans(s: string, start: number, end: number, out: BlockSpan[]): void {
  let i = start;
  while (i < end) {
    const lt = s.indexOf('<', i);
    if (lt < 0 || lt >= end) break;
    if (s.startsWith('<!--', lt)) {
      const e = s.indexOf('-->', lt);
      i = e < 0 ? end : e + 3;
      continue;
    }
    if (s.startsWith('<![CDATA[', lt)) {
      const e = s.indexOf(']]>', lt);
      i = e < 0 ? end : e + 3;
      continue;
    }
    if (s.startsWith('<?', lt)) {
      const e = s.indexOf('?>', lt);
      i = e < 0 ? end : e + 2;
      continue;
    }
    if (s.startsWith('<!', lt)) {
      const e = s.indexOf('>', lt);
      i = e < 0 ? end : e + 1;
      continue;
    }
    if (s[lt + 1] === '/') {
      const gt = s.indexOf('>', lt);
      i = gt < 0 ? end : gt + 1;
      continue;
    }
    const name = tagNameAt(s, lt);
    const span = elementSpanEnd(s, lt);
    if (name === 'w:p' || name === 'w:tbl') {
      out.push({ name, start: lt, end: Math.min(span, end) });
    } else if (name === 'w:sdt') {
      const cOpen = findOpen(s, 'w:sdtContent', lt, span);
      if (cOpen >= 0) {
        const inner = openTagEnd(s, cOpen).end;
        const cEnd = elementSpanEnd(s, cOpen);
        const closeAt = s.lastIndexOf('</w:sdtContent', cEnd);
        walkBlockSpans(s, inner, closeAt < 0 ? cEnd : closeAt, out);
      }
    } else if (name === 'w:customXml') {
      const inner = openTagEnd(s, lt).end;
      const closeAt = s.lastIndexOf('</w:customXml', span);
      walkBlockSpans(s, inner, closeAt < 0 ? span : closeAt, out);
    }
    i = span;
  }
}

/** Ordered spans of every top-level body block (w:p / w:tbl) in document.xml text. */
export function scanBodyBlockSpans(docText: string): BlockSpan[] {
  const bodyLt = findOpen(docText, 'w:body', 0, docText.length);
  if (bodyLt < 0) return [];
  const contentStart = openTagEnd(docText, bodyLt).end;
  const bodyEnd = elementSpanEnd(docText, bodyLt);
  const closeAt = docText.lastIndexOf('</w:body', bodyEnd);
  const out: BlockSpan[] = [];
  walkBlockSpans(docText, contentStart, closeAt < 0 ? bodyEnd : closeAt, out);
  return out;
}

/** Direct child element spans named `name` within a container's content [start,end). */
function childSpans(s: string, start: number, end: number, name: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  let i = start;
  while (i < end) {
    const lt = s.indexOf('<', i);
    if (lt < 0 || lt >= end) break;
    if (s.startsWith('<!--', lt)) { const e = s.indexOf('-->', lt); i = e < 0 ? end : e + 3; continue; }
    if (s.startsWith('<![CDATA[', lt)) { const e = s.indexOf(']]>', lt); i = e < 0 ? end : e + 3; continue; }
    if (s.startsWith('<?', lt)) { const e = s.indexOf('?>', lt); i = e < 0 ? end : e + 2; continue; }
    if (s.startsWith('<!', lt)) { const e = s.indexOf('>', lt); i = e < 0 ? end : e + 1; continue; }
    if (s[lt + 1] === '/') { const gt = s.indexOf('>', lt); i = gt < 0 ? end : gt + 1; continue; }
    const nm = tagNameAt(s, lt);
    const span = elementSpanEnd(s, lt);
    if (nm === name) out.push({ start: lt, end: Math.min(span, end) });
    i = span;
  }
  return out;
}

/** Content region [start,end) inside an element span (between its open and close tags). */
function contentRegion(s: string, span: { start: number; end: number }, name: string): { start: number; end: number } {
  const inner = openTagEnd(s, span.start).end;
  const closeAt = s.lastIndexOf('</' + name, span.end);
  return { start: inner, end: closeAt < 0 ? span.end : closeAt };
}

/** Spans of every direct cell paragraph (w:tr › w:tc › w:p) of a SIMPLE table slice,
 *  in document order (offsets relative to the slice). No wrapper/nested-table descent. */
export function scanCellParagraphSpans(tableText: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  const tbl = childSpans(tableText, 0, tableText.length, 'w:tbl')[0] ?? { start: 0, end: tableText.length };
  const tblContent = contentRegion(tableText, tbl, 'w:tbl');
  for (const tr of childSpans(tableText, tblContent.start, tblContent.end, 'w:tr')) {
    const trc = contentRegion(tableText, tr, 'w:tr');
    for (const tc of childSpans(tableText, trc.start, trc.end, 'w:tc')) {
      const tcc = contentRegion(tableText, tc, 'w:tc');
      out.push(...childSpans(tableText, tcc.start, tcc.end, 'w:p'));
    }
  }
  return out;
}
