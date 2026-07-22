/** @spike-features one-preservation-capsule */
import JSZip from 'jszip';

export const POC_PARAGRAPH_ID = 'poc-para-001';
export const POC_NS = 'http://docx-editor.dev/poc/1';
export const POC_CUSTOM_NS = 'http://example.com/poc/unsupported/1';
export const POC_W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

export const POC_ZIP_MAX_BYTES = 256 * 1024;
export const POC_ZIP_MAX_ENTRIES = 16;
export const POC_ZIP_MAX_ENTRY_UNCOMPRESSED_BYTES = 64 * 1024;
export const POC_ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES = 128 * 1024;
export const POC_ZIP_MAX_DECOMPRESSION_RATIO = 100;
export const POC_XML_MAX_BYTES = 64 * 1024;
export const POC_XML_MAX_SCAN_STEPS = 100_000;

const POC_MAX_RUNS = 32;
const POC_MAX_RUN_TEXT_LENGTH = 4096;
const POC_MAX_TOTAL_TEXT_LENGTH = 8192;
const UTF8_FLAG = 0x0800;
const ALLOWED_FLAGS = UTF8_FLAG;
const CONTENT_TYPES_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const RELATIONSHIPS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_DOCUMENT_REL_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const STYLES_REL_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';
const RELS_CONTENT_TYPE = 'application/vnd.openxmlformats-package.relationships+xml';
const XML_CONTENT_TYPE = 'application/xml';
const DOCUMENT_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
const STYLES_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml';

const REQUIRED_ENTRIES = [
  '[Content_Types].xml',
  '_rels/.rels',
  'word/_rels/document.xml.rels',
  'word/styles.xml',
  'word/document.xml',
] as const;

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

const ROOT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOCUMENT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${POC_W_NS}">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
  </w:style>
</w:styles>`;

const CAPSULE_XML = `<custom:PocUnsupported xmlns:custom="${POC_CUSTOM_NS}" xmlns:w="${POC_W_NS}"><custom:Payload>deadbeef</custom:Payload></custom:PocUnsupported>`;

const DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${POC_W_NS}" xmlns:poc="${POC_NS}" xmlns:custom="${POC_CUSTOM_NS}">
  <w:body>
    <w:p>
      <w:pPr><poc:ParagraphId>${POC_PARAGRAPH_ID}</poc:ParagraphId></w:pPr>
      <poc:OwnedStart/>
      <w:r><w:t xml:space="preserve">Hello </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>italic</w:t></w:r>
      <poc:OwnedEnd/>
      ${CAPSULE_XML}
    </w:p>
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>
    </w:sectPr>
  </w:body>
</w:document>`;

export interface PocRun {
  readonly text: string;
  readonly bold: boolean;
  readonly italic: boolean;
}

export interface LoadedPocDocx {
  readonly text: string;
  readonly runs: readonly PocRun[];
  readonly paragraphId: string;
  readonly capsuleBytes: Uint8Array;
  readonly sourceBytes: Uint8Array;
}

export interface PocSaveSnapshot {
  readonly paragraphId: string;
  readonly text: string;
  readonly runs: readonly PocRun[];
}

interface ZipEntryMeta {
  readonly path: string;
  readonly nameBytes: Uint8Array;
  readonly flags: number;
  readonly method: number;
  readonly crc: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localOffset: number;
  readonly dataStart: number;
  readonly dataEnd: number;
}

interface XmlAttribute {
  readonly name: string;
  readonly value: string;
}

interface XmlToken {
  readonly kind: 'start' | 'end' | 'text';
  readonly name?: string;
  readonly attributes?: readonly XmlAttribute[];
  readonly selfClosing?: boolean;
  readonly text?: string;
  readonly start: number;
  readonly end: number;
}

interface ParsedDocument {
  readonly paragraphId: string;
  readonly text: string;
  readonly runs: readonly PocRun[];
  readonly capsuleBytes: Uint8Array;
}

interface ParsedRelationship {
  readonly id: string;
  readonly type: string;
  readonly target: string;
  readonly mode: 'internal';
}

const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
const utf8Encoder = new TextEncoder();

export async function createPocDocxFixture(): Promise<Uint8Array> {
  return buildStoredFixture([
    ['[Content_Types].xml', CONTENT_TYPES_XML],
    ['_rels/.rels', ROOT_RELS_XML],
    ['word/_rels/document.xml.rels', DOCUMENT_RELS_XML],
    ['word/styles.xml', STYLES_XML],
    ['word/document.xml', DOCUMENT_XML],
  ]);
}

export async function loadPocDocx(input: Uint8Array): Promise<LoadedPocDocx> {
  const source = new Uint8Array(input);
  if (source.length > POC_ZIP_MAX_BYTES) throw new Error('DOCX exceeds input byte cap');

  const entries = preflightClassicZip(source);
  const required = new Set<string>(REQUIRED_ENTRIES);
  if (entries.length !== required.size || entries.some((entry) => !required.has(entry.path))) {
    throw new Error('DOCX must contain exactly the required POC entries');
  }

  const zip = await JSZip.loadAsync(source);
  const jszipNames = Object.keys(zip.files).sort(codeUnitCompare);
  const preflightNames = entries.map((entry) => entry.path).sort(codeUnitCompare);
  if (!sameStrings(jszipNames, preflightNames)) {
    throw new Error('JSZip entry set differs from ZIP preflight');
  }

  const inflated = new Map<string, Uint8Array>();
  let aggregate = 0;
  for (const entry of entries) {
    const file = zip.file(entry.path);
    if (!file) throw new Error(`JSZip missing preflight entry ${entry.path}`);
    const unsafeOriginalName = (file as unknown as { unsafeOriginalName?: string }).unsafeOriginalName;
    if (unsafeOriginalName !== undefined && unsafeOriginalName !== entry.path) {
      throw new Error('JSZip unsafe original name differs from preflight path');
    }
    const bytes = await file.async('uint8array');
    if (bytes.length !== entry.uncompressedSize) {
      throw new Error(`post-inflate size mismatch for ${entry.path}`);
    }
    if (crc32(bytes) !== entry.crc) throw new Error(`post-inflate CRC mismatch for ${entry.path}`);
    aggregate += bytes.length;
    if (aggregate > POC_ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES) {
      throw new Error('post-inflate aggregate uncompressed size exceeds cap');
    }
    inflated.set(entry.path, bytes);
  }

  const xmlByPath = new Map<string, string>();
  const tokensByPath = new Map<string, readonly XmlToken[]>();
  for (const path of REQUIRED_ENTRIES) {
    const bytes = inflated.get(path)!;
    if (bytes.length > POC_XML_MAX_BYTES) throw new Error(`${path} exceeds XML byte cap`);
    const xml = decodeAndValidateXml(bytes, path);
    const tokens = tokenizeXml(xml);
    xmlByPath.set(path, xml);
    tokensByPath.set(path, tokens);
  }
  validateContentTypes(tokensByPath.get('[Content_Types].xml')!);
  const rootRelationships = validateRelationships(tokensByPath.get('_rels/.rels')!);
  validateRequiredRelationship(
    rootRelationships,
    'rId1',
    OFFICE_DOCUMENT_REL_TYPE,
    'word/document.xml'
  );
  const documentRelationships = validateRelationships(
    tokensByPath.get('word/_rels/document.xml.rels')!
  );
  validateRequiredRelationship(documentRelationships, 'rId1', STYLES_REL_TYPE, 'styles.xml');
  validateStyles(tokensByPath.get('word/styles.xml')!);
  const parsed = parsePocDocument(xmlByPath.get('word/document.xml')!);

  const sourceBacking = new Uint8Array(source);
  const capsuleBacking = new Uint8Array(parsed.capsuleBytes);
  const runs = Object.freeze(parsed.runs.map((run) => Object.freeze({ ...run })));
  const result = {
    text: parsed.text,
    runs,
    paragraphId: parsed.paragraphId,
    get sourceBytes(): Uint8Array {
      return new Uint8Array(sourceBacking);
    },
    get capsuleBytes(): Uint8Array {
      return new Uint8Array(capsuleBacking);
    },
  };
  return Object.freeze(result);
}

export function escapeXmlText(value: string): string {
  let output = '';
  for (const char of value) {
    switch (char) {
      case '&':
        output += '&amp;';
        break;
      case '<':
        output += '&lt;';
        break;
      case '>':
        output += '&gt;';
        break;
      case '"':
        output += '&quot;';
        break;
      case "'":
        output += '&apos;';
        break;
      default:
        output += char;
    }
  }
  validateXmlCharacters(output);
  return output;
}

export async function savePocDocx(
  source: LoadedPocDocx,
  snapshot: PocSaveSnapshot
): Promise<Uint8Array> {
  if (!source || typeof source !== 'object') throw new Error('save source is required');
  const sourceBytes = source.sourceBytes;
  if (!(sourceBytes instanceof Uint8Array)) throw new Error('save source bytes are required');
  const trusted = await loadPocDocx(sourceBytes);
  validateSaveSnapshot(snapshot, trusted);

  const zip = await JSZip.loadAsync(trusted.sourceBytes);
  const documentXml = buildSavedDocumentXml(trusted, snapshot);
  const parts: Array<[string, string]> = [];
  for (const path of REQUIRED_ENTRIES) {
    if (path === 'word/document.xml') {
      parts.push([path, documentXml]);
      continue;
    }
    const file = zip.file(path);
    if (!file) throw new Error(`trusted source missing required entry ${path}`);
    parts.push([path, await file.async('string')]);
  }
  return buildStoredFixture(parts);
}

function validateSaveSnapshot(snapshot: PocSaveSnapshot, trusted: LoadedPocDocx): void {
  if (!snapshot || typeof snapshot !== 'object') throw new Error('save snapshot is required');
  if (typeof snapshot.paragraphId !== 'string' || snapshot.paragraphId.length === 0) {
    throw new Error('save snapshot paragraphId is required');
  }
  if (snapshot.paragraphId !== trusted.paragraphId) {
    throw new Error('save snapshot paragraph identity mismatch');
  }
  if (typeof snapshot.text !== 'string') throw new Error('save snapshot text is required');
  if (snapshot.text.length > POC_MAX_TOTAL_TEXT_LENGTH) {
    throw new Error('save snapshot text exceeds bound');
  }
  if (!Array.isArray(snapshot.runs)) throw new Error('save snapshot runs are required');
  if (snapshot.runs.length === 0) throw new Error('save snapshot runs must not be empty');
  if (snapshot.runs.length > POC_MAX_RUNS) throw new Error('save snapshot run count exceeds bound');

  let reconstructed = '';
  for (let index = 0; index < snapshot.runs.length; index += 1) {
    const run = snapshot.runs[index]!;
    if (!run || typeof run !== 'object') throw new Error('save snapshot run is invalid');
    if (typeof run.text !== 'string') throw new Error('save snapshot run text is invalid');
    if (typeof run.bold !== 'boolean' || typeof run.italic !== 'boolean') {
      throw new Error('save snapshot run formatting is invalid');
    }
    if (run.text.length > POC_MAX_RUN_TEXT_LENGTH) {
      throw new Error('save snapshot run text exceeds bound');
    }
    validateXmlCharacters(run.text);
    reconstructed += run.text;
    const previous = snapshot.runs[index - 1];
    if (
      previous &&
      previous.bold === run.bold &&
      previous.italic === run.italic
    ) {
      throw new Error('save snapshot runs are not maximally merged');
    }
  }
  if (reconstructed !== snapshot.text) {
    throw new Error('save snapshot runs do not reconstruct text');
  }
}

function buildSavedDocumentXml(trusted: LoadedPocDocx, snapshot: PocSaveSnapshot): string {
  const ownedRuns = snapshot.runs.map((run) => serializePocRun(run)).join('');
  const capsule = utf8Decoder.decode(trusted.capsuleBytes);
  if (!capsule.startsWith('<custom:PocUnsupported') || !capsule.endsWith('</custom:PocUnsupported>')) {
    throw new Error('trusted capsule substring shape is invalid');
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${POC_W_NS}" xmlns:poc="${POC_NS}" xmlns:custom="${POC_CUSTOM_NS}">
  <w:body>
    <w:p>
      <w:pPr><poc:ParagraphId>${escapeXmlText(snapshot.paragraphId)}</poc:ParagraphId></w:pPr>
      <poc:OwnedStart/>
      ${ownedRuns}
      <poc:OwnedEnd/>
      ${capsule}
    </w:p>
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>
    </w:sectPr>
  </w:body>
</w:document>`;
}

function serializePocRun(run: PocRun): string {
  let runProperties = '';
  if (run.bold || run.italic) {
    const marks: string[] = [];
    if (run.bold) marks.push('<w:b/>');
    if (run.italic) marks.push('<w:i/>');
    runProperties = `<w:rPr>${marks.join('')}</w:rPr>`;
  }
  const spaceAttribute = startsOrEndsXmlWhitespace(run.text) ? ' xml:space="preserve"' : '';
  return `<w:r>${runProperties}<w:t${spaceAttribute}>${escapeXmlText(run.text)}</w:t></w:r>`;
}

function preflightClassicZip(bytes: Uint8Array): readonly ZipEntryMeta[] {
  if (bytes.length < 22) throw new Error('truncated ZIP: end of central directory missing');
  if (containsSignature(bytes, 0x06064b50) || containsSignature(bytes, 0x07064b50)) {
    throw new Error('ZIP64 records are not supported');
  }
  const eocd = locateClassicEocd(bytes);
  const disk = readU16(bytes, eocd + 4);
  const centralDisk = readU16(bytes, eocd + 6);
  const diskEntries = readU16(bytes, eocd + 8);
  const totalEntries = readU16(bytes, eocd + 10);
  const centralSize = readU32(bytes, eocd + 12);
  const centralOffset = readU32(bytes, eocd + 16);
  const commentLength = readU16(bytes, eocd + 20);
  if (commentLength !== 0) throw new Error('ZIP comments are not supported');
  if (
    diskEntries === 0xffff ||
    totalEntries === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff
  ) {
    throw new Error('ZIP64 sentinels are not supported');
  }
  if (disk !== 0 || centralDisk !== 0 || diskEntries !== totalEntries) {
    throw new Error('ZIP must be a single-disk archive');
  }
  if (totalEntries > POC_ZIP_MAX_ENTRIES) throw new Error('DOCX exceeds ZIP entry count cap');
  if (centralOffset + centralSize !== eocd) throw new Error('invalid central directory range');

  const entries: ZipEntryMeta[] = [];
  const exactNames = new Set<string>();
  const foldedNames = new Map<string, string>();
  const localOffsets = new Set<number>();
  let aggregate = 0;
  let cursor = centralOffset;
  for (let index = 0; index < totalEntries; index += 1) {
    requireRange(bytes, cursor, 46, 'central directory entry');
    if (readU32(bytes, cursor) !== 0x02014b50) throw new Error('invalid central directory entry');
    const flags = readU16(bytes, cursor + 8);
    const method = readU16(bytes, cursor + 10);
    const crc = readU32(bytes, cursor + 16);
    const compressedSize = readU32(bytes, cursor + 20);
    const uncompressedSize = readU32(bytes, cursor + 24);
    const nameLength = readU16(bytes, cursor + 28);
    const extraLength = readU16(bytes, cursor + 30);
    const entryCommentLength = readU16(bytes, cursor + 32);
    const diskStart = readU16(bytes, cursor + 34);
    const localOffset = readU32(bytes, cursor + 42);
    if (
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localOffset === 0xffffffff ||
      diskStart === 0xffff
    ) {
      throw new Error('ZIP64 entry sentinels are not supported');
    }
    if (extraLength !== 0) throw new Error('ZIP extra fields are not supported');
    if (entryCommentLength !== 0) throw new Error('ZIP entry comments are not supported');
    if (diskStart !== 0) throw new Error('ZIP entry must be on the single archive disk');
    if (localOffsets.has(localOffset)) throw new Error('ZIP entry ranges overlap at local header offset');
    localOffsets.add(localOffset);
    validateFlagsAndMethod(flags, method);
    requireRange(bytes, cursor + 46, nameLength, 'central filename');
    const nameBytes = bytes.slice(cursor + 46, cursor + 46 + nameLength);
    const path = decodeZipPath(nameBytes);
    validateZipPath(path);
    if (exactNames.has(path)) throw new Error(`duplicate ZIP entry ${path}`);
    const folded = path.toLowerCase();
    const prior = foldedNames.get(folded);
    if (prior !== undefined && prior !== path) throw new Error('ZIP path case collision');
    exactNames.add(path);
    foldedNames.set(folded, path);
    if (uncompressedSize > POC_ZIP_MAX_ENTRY_UNCOMPRESSED_BYTES) {
      throw new Error('declared entry uncompressed size exceeds cap');
    }
    aggregate += uncompressedSize;
    if (aggregate > POC_ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES) {
      throw new Error('declared aggregate uncompressed size exceeds cap');
    }
    if (compressedSize === 0 ? uncompressedSize !== 0 : uncompressedSize / compressedSize > POC_ZIP_MAX_DECOMPRESSION_RATIO) {
      throw new Error('declared ZIP decompression ratio exceeds cap');
    }
    const local = parseAndBindLocalHeader(bytes, {
      path,
      nameBytes,
      flags,
      method,
      crc,
      compressedSize,
      uncompressedSize,
      localOffset,
    });
    entries.push(local);
    cursor += 46 + nameLength;
  }
  if (cursor !== eocd) throw new Error('central directory size or entry count mismatch');
  validateEntryRanges(entries, centralOffset);
  return Object.freeze(entries);
}

function parseAndBindLocalHeader(
  bytes: Uint8Array,
  central: Omit<ZipEntryMeta, 'dataStart' | 'dataEnd'>
): ZipEntryMeta {
  const offset = central.localOffset;
  requireRange(bytes, offset, 30, 'local header');
  if (readU32(bytes, offset) !== 0x04034b50) throw new Error('invalid local header offset');
  const flags = readU16(bytes, offset + 6);
  const method = readU16(bytes, offset + 8);
  const crc = readU32(bytes, offset + 14);
  const compressedSize = readU32(bytes, offset + 18);
  const uncompressedSize = readU32(bytes, offset + 22);
  const nameLength = readU16(bytes, offset + 26);
  const extraLength = readU16(bytes, offset + 28);
  if (extraLength !== 0) throw new Error('local ZIP extra fields are not supported');
  requireRange(bytes, offset + 30, nameLength, 'local filename');
  const nameBytes = bytes.slice(offset + 30, offset + 30 + nameLength);
  if (
    flags !== central.flags ||
    method !== central.method ||
    crc !== central.crc ||
    compressedSize !== central.compressedSize ||
    uncompressedSize !== central.uncompressedSize ||
    !equalBytes(nameBytes, central.nameBytes)
  ) {
    throw new Error('local and central ZIP metadata mismatch');
  }
  const dataStart = offset + 30 + nameLength;
  const dataEnd = dataStart + compressedSize;
  requireRange(bytes, dataStart, compressedSize, 'compressed entry data');
  return { ...central, dataStart, dataEnd };
}

function validateEntryRanges(entries: readonly ZipEntryMeta[], centralOffset: number): void {
  const ordered = [...entries].sort((a, b) => a.localOffset - b.localOffset);
  let expectedOffset = 0;
  for (const entry of ordered) {
    if (entry.localOffset !== expectedOffset) {
      throw new Error(entry.localOffset < expectedOffset ? 'ZIP entry ranges overlap' : 'ambiguous bytes between ZIP entries');
    }
    if (entry.dataEnd > centralOffset) throw new Error('ZIP entry data range overlaps central directory');
    expectedOffset = entry.dataEnd;
  }
  if (expectedOffset !== centralOffset) throw new Error('ambiguous trailing bytes before central directory');
}

function validateFlagsAndMethod(flags: number, method: number): void {
  if ((flags & 0x0001) !== 0) throw new Error('encrypted ZIP entries are not supported');
  if ((flags & 0x0008) !== 0) throw new Error('ZIP data descriptors are not supported');
  if ((flags & UTF8_FLAG) === 0) throw new Error('canonical UTF-8 flag is required for filenames');
  if ((flags & ~ALLOWED_FLAGS) !== 0) throw new Error('unknown ZIP general-purpose flag bits');
  if (method !== 0 && method !== 8) throw new Error('unsupported ZIP compression method');
}

function decodeZipPath(nameBytes: Uint8Array): string {
  let path: string;
  try {
    path = utf8Decoder.decode(nameBytes);
  } catch {
    throw new Error('ZIP filename is not valid UTF-8');
  }
  for (const byte of nameBytes) {
    if (byte < 0x20 || byte > 0x7e) throw new Error('POC ZIP paths must be ASCII-safe');
  }
  return path;
}

function validateZipPath(path: string): void {
  if (path.length === 0 || path.includes('\0') || path.includes('\\') || path.startsWith('/')) {
    throw new Error('invalid ZIP path');
  }
  const segments = path.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new Error('invalid ZIP path segment');
  }
}

function decodeAndValidateXml(bytes: Uint8Array, path: string): string {
  let start = 0;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) start = 3;
  else if (
    (bytes[0] === 0xff && bytes[1] === 0xfe) ||
    (bytes[0] === 0xfe && bytes[1] === 0xff) ||
    (bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0xfe && bytes[3] === 0xff)
  ) {
    throw new Error(`${path} must use UTF-8 XML`);
  }
  let xml: string;
  try {
    xml = utf8Decoder.decode(bytes.subarray(start));
  } catch {
    throw new Error(`${path} is not valid UTF-8 XML`);
  }
  const declarationEnd = xml.startsWith('<?xml') ? xml.indexOf('?>') : -1;
  if (xml.startsWith('<?xml')) {
    if (declarationEnd < 0) throw new Error('malformed XML declaration');
    const declaration = xml.slice(0, declarationEnd + 2);
    if (declaration !== '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>') {
      throw new Error('only the canonical UTF-8 XML declaration is supported');
    }
  } else if (startsLikeXmlDeclaration(xml)) {
    throw new Error('malformed XML declaration');
  }
  return xml;
}

function tokenizeXml(xml: string): readonly XmlToken[] {
  const tokens: XmlToken[] = [];
  let cursor = 0;
  let steps = 0;
  while (cursor < xml.length) {
    steps += 1;
    if (steps > POC_XML_MAX_SCAN_STEPS) throw new Error('XML token scan step cap exceeded');
    if (xml[cursor] !== '<') {
      const end = xml.indexOf('<', cursor);
      const textEnd = end < 0 ? xml.length : end;
      const raw = xml.slice(cursor, textEnd);
      validateXmlCharacters(raw);
      tokens.push({ kind: 'text', text: decodeXmlEntities(raw), start: cursor, end: textEnd });
      cursor = textEnd;
      continue;
    }
    const declarationKind = scanBangDeclaration(xml, cursor);
    if (declarationKind !== undefined) throw new Error(`${declarationKind} declaration rejected`);
    if (xml.startsWith('<?', cursor)) {
      const end = xml.indexOf('?>', cursor + 2);
      if (end < 0) throw new Error('malformed XML processing instruction');
      if (cursor !== 0 || !xml.startsWith('<?xml ', cursor)) {
        throw new Error('unsupported XML processing instruction');
      }
      cursor = end + 2;
      continue;
    }
    if (xml.startsWith('<!--', cursor)) throw new Error('XML comments are not supported in POC parts');
    const tagEnd = findTagEnd(xml, cursor + 1);
    const body = xml.slice(cursor + 1, tagEnd);
    if (body.startsWith('/')) {
      const name = body.slice(1).trim();
      if (!isXmlName(name)) throw new Error('malformed XML end tag');
      tokens.push({ kind: 'end', name, start: cursor, end: tagEnd + 1 });
    } else {
      const parsed = parseStartTag(body);
      tokens.push({ kind: 'start', ...parsed, start: cursor, end: tagEnd + 1 });
    }
    cursor = tagEnd + 1;
  }
  validateTokenNesting(tokens);
  return Object.freeze(tokens);
}

function parseStartTag(body: string): Pick<XmlToken, 'name' | 'attributes' | 'selfClosing'> {
  let end = body.length;
  while (end > 0 && isXmlWhitespace(body[end - 1]!)) end -= 1;
  const selfClosing = body[end - 1] === '/';
  if (selfClosing) {
    end -= 1;
    while (end > 0 && isXmlWhitespace(body[end - 1]!)) end -= 1;
  }
  let cursor = 0;
  while (cursor < end && !isXmlWhitespace(body[cursor]!)) cursor += 1;
  const name = body.slice(0, cursor);
  if (!isXmlName(name)) throw new Error('malformed XML start tag');
  const attributes: XmlAttribute[] = [];
  const seen = new Set<string>();
  while (cursor < end) {
    while (cursor < end && isXmlWhitespace(body[cursor]!)) cursor += 1;
    if (cursor >= end) break;
    const nameStart = cursor;
    while (cursor < end && !isXmlWhitespace(body[cursor]!) && body[cursor] !== '=') cursor += 1;
    const attributeName = body.slice(nameStart, cursor);
    if (!isXmlName(attributeName) || seen.has(attributeName)) throw new Error('malformed or duplicate XML attribute');
    while (cursor < end && isXmlWhitespace(body[cursor]!)) cursor += 1;
    if (body[cursor] !== '=') throw new Error('malformed XML attribute');
    cursor += 1;
    while (cursor < end && isXmlWhitespace(body[cursor]!)) cursor += 1;
    const quote = body[cursor];
    if (quote !== '"' && quote !== "'") throw new Error('XML attribute value must be quoted');
    cursor += 1;
    const valueStart = cursor;
    while (cursor < end && body[cursor] !== quote) cursor += 1;
    if (cursor >= end) throw new Error('unterminated XML attribute');
    const rawValue = body.slice(valueStart, cursor);
    validateXmlCharacters(rawValue);
    attributes.push(Object.freeze({ name: attributeName, value: decodeXmlEntities(rawValue) }));
    seen.add(attributeName);
    cursor += 1;
  }
  return { name, attributes: Object.freeze(attributes), selfClosing };
}

function validateRelationships(tokens: readonly XmlToken[]): readonly ParsedRelationship[] {
  const rootIndex = singleRootIndex(tokens);
  const root = tokens[rootIndex]!;
  if (localName(root.name!) !== 'Relationships') throw new Error('RELS root must be Relationships');
  const prefix = namespacePrefix(root.name!);
  const namespaceAttribute = prefix === '' ? 'xmlns' : `xmlns:${prefix}`;
  if (
    root.attributes!.length !== 1 ||
    getAttributeExact(root.attributes!, namespaceAttribute) !== RELATIONSHIPS_NS
  ) {
    throw new Error('RELS root must bind the package relationships namespace exactly');
  }
  const expectedChildName = prefix === '' ? 'Relationship' : `${prefix}:Relationship`;
  const children = directChildTokens(tokens, rootIndex);
  if (children.some((token) => token.name !== expectedChildName)) {
    throw new Error('RELS contains unknown or mis-cased child');
  }
  const relationships: ParsedRelationship[] = [];
  const ids = new Set<string>();
  for (const token of children) {
    if (!token.selfClosing) throw new Error('relationship elements must be self-closing');
    const attributes = token.attributes!;
    for (const attribute of attributes) {
      if (!['Id', 'Type', 'Target', 'TargetMode'].includes(attribute.name)) {
        throw new Error('unknown relationship attribute');
      }
    }
    const target = normalizedAttribute(attributes, 'Target');
    const id = normalizedAttribute(attributes, 'Id');
    const type = normalizedAttribute(attributes, 'Type');
    if (target === undefined || id === undefined || type === undefined) {
      throw new Error('relationship requires Id, Type, and Target attributes');
    }
    if (id.length === 0 || type.length === 0 || target.length === 0) {
      throw new Error('relationship attributes must be non-empty');
    }
    if (ids.has(id)) throw new Error('relationship IDs must be unique');
    ids.add(id);
    const mode = normalizedAttribute(attributes, 'TargetMode');
    if (mode !== undefined && mode.toLowerCase() !== 'internal') {
      throw new Error('only absent or internal relationship mode is accepted');
    }
    if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(target)) throw new Error('remote relationship target rejected');
    if (target.startsWith('/') || target.startsWith('\\') || target.includes('\\')) {
      throw new Error('absolute relationship target rejected');
    }
    const segments = target.split('/');
    if (segments.some((segment) => segment === '.' || segment === '..')) {
      throw new Error('relationship traversal target rejected');
    }
    relationships.push(Object.freeze({ id, type, target, mode: 'internal' }));
  }
  return Object.freeze(relationships);
}

function validateRequiredRelationship(
  relationships: readonly ParsedRelationship[],
  id: string,
  type: string,
  target: string
): void {
  if (
    relationships.length !== 1 ||
    relationships[0]!.id !== id ||
    relationships[0]!.type !== type ||
    relationships[0]!.target !== target ||
    relationships[0]!.mode !== 'internal'
  ) {
    throw new Error('required package relationship is missing or incorrect');
  }
}

function validateContentTypes(tokens: readonly XmlToken[]): void {
  const rootIndex = singleRootIndex(tokens);
  const root = tokens[rootIndex]!;
  if (
    root.name !== 'Types' ||
    root.attributes!.length !== 1 ||
    getAttributeExact(root.attributes!, 'xmlns') !== CONTENT_TYPES_NS
  ) {
    throw new Error('content types root namespace is invalid');
  }
  const expected = new Set([
    `Default|rels|${RELS_CONTENT_TYPE}`,
    `Default|xml|${XML_CONTENT_TYPE}`,
    `Override|/word/document.xml|${DOCUMENT_CONTENT_TYPE}`,
    `Override|/word/styles.xml|${STYLES_CONTENT_TYPE}`,
  ]);
  const observed = new Set<string>();
  for (const child of directChildTokens(tokens, rootIndex)) {
    if (!child.selfClosing || (child.name !== 'Default' && child.name !== 'Override')) {
      throw new Error('unknown content type child');
    }
    const requiredNames =
      child.name === 'Default' ? ['Extension', 'ContentType'] : ['PartName', 'ContentType'];
    if (
      child.attributes!.length !== requiredNames.length ||
      child.attributes!.some((attribute) => !requiredNames.includes(attribute.name))
    ) {
      throw new Error('content type attributes are invalid');
    }
    const key =
      child.name === 'Default'
        ? `Default|${getAttributeExact(child.attributes!, 'Extension')}|${getAttributeExact(child.attributes!, 'ContentType')}`
        : `Override|${getAttributeExact(child.attributes!, 'PartName')}|${getAttributeExact(child.attributes!, 'ContentType')}`;
    if (!expected.has(key) || observed.has(key)) throw new Error('unknown or duplicate content type entry');
    observed.add(key);
  }
  if (observed.size !== expected.size) throw new Error('required content type entry is missing');
}

function validateStyles(tokens: readonly XmlToken[]): void {
  const rootIndex = singleRootIndex(tokens);
  const root = tokens[rootIndex]!;
  if (
    root.name !== 'w:styles' ||
    root.attributes!.length !== 1 ||
    getAttributeExact(root.attributes!, 'xmlns:w') !== POC_W_NS
  ) {
    throw new Error('styles root namespace is invalid');
  }
  validateNamespaceDeclarations(tokens, new Map([['w', POC_W_NS]]));
}

function parsePocDocument(xml: string): ParsedDocument {
  const tokens = tokenizeXml(xml);
  const starts = (name: string) =>
    tokens.filter((token) => token.kind === 'start' && localName(token.name!) === name);
  if (starts('document').length !== 1 || starts('body').length !== 1 || starts('p').length !== 1) {
    throw new Error('POC document requires exactly one document, body, and paragraph');
  }
  validateOuterPocShape(tokens);
  const ownedStarts = starts('OwnedStart');
  const ownedEnds = starts('OwnedEnd');
  const capsules = starts('PocUnsupported');
  if (ownedStarts.length !== 1 || ownedEnds.length !== 1) throw new Error('exact owned markers required');
  if (capsules.length !== 1) throw new Error('exactly one unsupported capsule required');
  if (
    ownedStarts[0]!.name !== 'poc:OwnedStart' ||
    ownedEnds[0]!.name !== 'poc:OwnedEnd' ||
    capsules[0]!.name !== 'custom:PocUnsupported'
  ) {
    throw new Error('POC marker namespace prefix mismatch');
  }
  if (!ownedStarts[0]!.selfClosing || !ownedEnds[0]!.selfClosing) throw new Error('owned markers must be empty');
  if (ownedStarts[0]!.attributes!.length !== 0 || ownedEnds[0]!.attributes!.length !== 0) {
    throw new Error('owned markers do not accept attributes');
  }

  const paragraphIds = starts('ParagraphId');
  if (paragraphIds.length !== 1) throw new Error('exactly one paragraph identity required');
  if (paragraphIds[0]!.name !== 'poc:ParagraphId' || paragraphIds[0]!.attributes!.length !== 0) {
    throw new Error('paragraph identity shape invalid');
  }
  const paragraphIdIndex = tokens.indexOf(paragraphIds[0]!);
  const paragraphIdText = tokens[paragraphIdIndex + 1];
  const paragraphIdEnd = tokens[paragraphIdIndex + 2];
  if (
    paragraphIdText?.kind !== 'text' ||
    paragraphIdEnd?.kind !== 'end' ||
    localName(paragraphIdEnd.name!) !== 'ParagraphId'
  ) {
    throw new Error('malformed paragraph identity');
  }
  const paragraphId = paragraphIdText.text!;
  if (paragraphId !== POC_PARAGRAPH_ID) throw new Error('unexpected POC paragraph identity');

  const ownedStartIndex = tokens.indexOf(ownedStarts[0]!);
  const ownedEndIndex = tokens.indexOf(ownedEnds[0]!);
  const capsuleIndex = tokens.indexOf(capsules[0]!);
  if (ownedEndIndex <= ownedStartIndex || capsuleIndex <= ownedEndIndex) {
    throw new Error('owned markers or capsule order invalid');
  }
  const ownedTokens = tokens.slice(ownedStartIndex + 1, ownedEndIndex);
  const runs = parseOwnedRuns(ownedTokens);

  const capsuleStart = capsules[0]!.start;
  const capsuleEnd = findMatchingEndOffset(tokens, capsuleIndex);
  const capsuleBytes = utf8Encoder.encode(xml.slice(capsuleStart, capsuleEnd));
  validateParagraphDirectChildren(tokens, ownedStartIndex, ownedEndIndex, capsuleIndex);
  return {
    paragraphId,
    text: runs.map((run) => run.text).join(''),
    runs,
    capsuleBytes,
  };
}

function parseOwnedRuns(tokens: readonly XmlToken[]): readonly PocRun[] {
  const runs: PocRun[] = [];
  let cursor = 0;
  while (cursor < tokens.length) {
    while (tokens[cursor]?.kind === 'text' && tokens[cursor]!.text!.trim().length === 0) cursor += 1;
    if (cursor >= tokens.length) break;
    const runOpen = tokens[cursor++];
    if (!isExactStart(runOpen, 'w:r', false) || runOpen.attributes!.length !== 0) throw new Error('unknown owned markup');
    let bold = false;
    let italic = false;
    if (isExactStart(tokens[cursor], 'w:rPr', false)) {
      const rPr = tokens[cursor++]!;
      if (rPr.attributes!.length !== 0) throw new Error('run properties do not accept attributes');
      while (!isExactEnd(tokens[cursor], 'w:rPr')) {
        const mark = tokens[cursor++];
        if (!mark || mark.kind !== 'start' || !mark.selfClosing) throw new Error('malformed run property');
        if (mark.name !== 'w:b' && mark.name !== 'w:i') throw new Error('unknown run property');
        const name = localName(mark.name);
        if (mark.attributes!.some((attribute) => localName(attribute.name) !== 'val')) {
          throw new Error('unknown run property attribute');
        }
        const value = getAttribute(mark.attributes!, 'val');
        const enabled = value === undefined || value === 'true' || value === '1';
        if (value !== undefined && !['true', '1', 'false', '0'].includes(value)) {
          throw new Error('invalid boolean run property');
        }
        if (name === 'b') bold = enabled;
        else italic = enabled;
      }
      cursor += 1;
    }
    const textOpen = tokens[cursor++];
    if (!isExactStart(textOpen, 'w:t', false)) throw new Error('run must contain exactly one text element');
    const attributes = textOpen.attributes!;
    if (attributes.some((attribute) => attribute.name !== 'xml:space')) throw new Error('unknown text attribute');
    const space = getAttributeExact(attributes, 'xml:space');
    if (space !== undefined && space !== 'preserve') throw new Error('invalid xml:space value');
    const textToken = tokens[cursor++];
    if (!textToken || textToken.kind !== 'text') throw new Error('markup inside run text is forbidden');
    const text = textToken.text!;
    if (text.length > POC_MAX_RUN_TEXT_LENGTH) throw new Error('run text exceeds bound');
    if ((startsOrEndsXmlWhitespace(text) && space !== 'preserve')) {
      throw new Error('boundary whitespace requires xml:space preserve');
    }
    if (!isExactEnd(tokens[cursor++], 'w:t') || !isExactEnd(tokens[cursor++], 'w:r')) {
      throw new Error('run has unknown markup or malformed structure');
    }
    runs.push(Object.freeze({ text, bold, italic }));
    if (runs.length > POC_MAX_RUNS) throw new Error('run count exceeds bound');
  }
  if (runs.length === 0) throw new Error('owned span must contain editable runs');
  if (runs.reduce((length, run) => length + run.text.length, 0) > POC_MAX_TOTAL_TEXT_LENGTH) {
    throw new Error('owned text exceeds bound');
  }
  return Object.freeze(runs);
}

function validateParagraphDirectChildren(
  tokens: readonly XmlToken[],
  ownedStartIndex: number,
  ownedEndIndex: number,
  capsuleIndex: number
): void {
  const paragraphIndex = tokens.findIndex((token) => isStart(token, 'p', false));
  const paragraphEnd = findMatchingEndIndex(tokens, paragraphIndex);
  if (!(paragraphIndex < ownedStartIndex && ownedStartIndex < ownedEndIndex && ownedEndIndex < capsuleIndex && capsuleIndex < paragraphEnd)) {
    throw new Error('POC paragraph child order invalid');
  }
  let depth = 0;
  const direct: string[] = [];
  for (let index = paragraphIndex + 1; index < paragraphEnd; index += 1) {
    const token = tokens[index]!;
    if (token.kind === 'start') {
      if (depth === 0) direct.push(localName(token.name!));
      if (!token.selfClosing) depth += 1;
    } else if (token.kind === 'end') {
      depth -= 1;
    }
  }
  const expectedPrefix = ['pPr', 'OwnedStart'];
  if (direct[0] !== expectedPrefix[0] || direct[1] !== expectedPrefix[1]) {
    throw new Error('POC paragraph prefix shape invalid');
  }
  const ownedEndDirect = direct.indexOf('OwnedEnd');
  if (ownedEndDirect < 2 || direct[ownedEndDirect + 1] !== 'PocUnsupported' || direct.length !== ownedEndDirect + 2) {
    throw new Error('POC paragraph contains unknown direct child');
  }
}

function validateOuterPocShape(tokens: readonly XmlToken[]): void {
  const documentIndex = tokens.findIndex((token) => isExactStart(token, 'w:document', false));
  const bodyIndex = tokens.findIndex((token) => isExactStart(token, 'w:body', false));
  const paragraphIndex = tokens.findIndex((token) => isExactStart(token, 'w:p', false));
  const pPrIndex = tokens.findIndex((token) => isExactStart(token, 'w:pPr', false));
  if (documentIndex < 0 || bodyIndex < 0 || paragraphIndex < 0 || pPrIndex < 0) {
    throw new Error('POC document namespace or outer shape invalid');
  }
  const document = tokens[documentIndex]!;
  const requiredBindings = new Map([
    ['w', POC_W_NS],
    ['poc', POC_NS],
    ['custom', POC_CUSTOM_NS],
  ]);
  if (
    document.attributes!.length !== requiredBindings.size ||
    [...requiredBindings].some(
      ([prefix, namespace]) =>
        getAttributeExact(document.attributes!, `xmlns:${prefix}`) !== namespace
    )
  ) {
    throw new Error('POC document namespace bindings are invalid');
  }
  validateNamespaceDeclarations(tokens, requiredBindings);
  if (!sameStrings(directChildNames(tokens, documentIndex), ['w:body'])) {
    throw new Error('POC document contains unknown root child');
  }
  if (!sameStrings(directChildNames(tokens, bodyIndex), ['w:p', 'w:sectPr'])) {
    throw new Error('POC body contains unknown child');
  }
  if (!sameStrings(directChildNames(tokens, pPrIndex), ['poc:ParagraphId'])) {
    throw new Error('POC paragraph properties contain unknown child');
  }
}

function directChildNames(tokens: readonly XmlToken[], parentIndex: number): string[] {
  const parentEnd = findMatchingEndIndex(tokens, parentIndex);
  const names: string[] = [];
  let depth = 0;
  for (let index = parentIndex + 1; index < parentEnd; index += 1) {
    const token = tokens[index]!;
    if (token.kind === 'start') {
      if (depth === 0) names.push(token.name!);
      if (!token.selfClosing) depth += 1;
    } else if (token.kind === 'end') {
      depth -= 1;
    }
  }
  return names;
}

function directChildTokens(tokens: readonly XmlToken[], parentIndex: number): XmlToken[] {
  const parentEnd = findMatchingEndIndex(tokens, parentIndex);
  const children: XmlToken[] = [];
  let depth = 0;
  for (let index = parentIndex + 1; index < parentEnd; index += 1) {
    const token = tokens[index]!;
    if (token.kind === 'text') {
      if (depth === 0 && token.text!.trim().length !== 0) {
        throw new Error('unexpected text in closed XML grammar');
      }
      continue;
    }
    if (token.kind === 'start') {
      if (depth === 0) children.push(token);
      if (!token.selfClosing) depth += 1;
    } else {
      depth -= 1;
    }
  }
  return children;
}

function singleRootIndex(tokens: readonly XmlToken[]): number {
  let rootIndex = -1;
  let depth = 0;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token.kind === 'text') {
      if (depth === 0 && token.text!.trim().length !== 0) throw new Error('text outside XML root');
      continue;
    }
    if (token.kind === 'start') {
      if (depth === 0) {
        if (rootIndex !== -1) throw new Error('XML part must contain exactly one root');
        rootIndex = index;
      }
      if (!token.selfClosing) depth += 1;
    } else {
      depth -= 1;
    }
  }
  if (rootIndex < 0 || tokens[rootIndex]!.selfClosing) throw new Error('XML part requires a non-empty root');
  return rootIndex;
}

function validateNamespaceDeclarations(
  tokens: readonly XmlToken[],
  expected: ReadonlyMap<string, string>
): void {
  for (const token of tokens) {
    if (token.kind !== 'start') continue;
    for (const attribute of token.attributes!) {
      if (attribute.name === 'xmlns') throw new Error('unexpected default namespace binding');
      if (!attribute.name.startsWith('xmlns:')) continue;
      const prefix = attribute.name.slice('xmlns:'.length);
      if (expected.get(prefix) !== attribute.value) {
        throw new Error('namespace prefix rebinding or unknown binding rejected');
      }
    }
  }
}

function validateTokenNesting(tokens: readonly XmlToken[]): void {
  const stack: string[] = [];
  for (const token of tokens) {
    if (token.kind === 'start' && !token.selfClosing) stack.push(token.name!);
    else if (token.kind === 'end') {
      const expected = stack.pop();
      if (expected !== token.name) throw new Error('mismatched XML tags');
    }
  }
  if (stack.length !== 0) throw new Error('unclosed XML tags');
}

function findMatchingEndOffset(tokens: readonly XmlToken[], startIndex: number): number {
  return tokens[findMatchingEndIndex(tokens, startIndex)]!.end;
}

function findMatchingEndIndex(tokens: readonly XmlToken[], startIndex: number): number {
  const start = tokens[startIndex];
  if (!start || start.kind !== 'start' || start.selfClosing) throw new Error('expected non-empty XML element');
  let depth = 1;
  for (let index = startIndex + 1; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token.kind === 'start' && !token.selfClosing) depth += 1;
    else if (token.kind === 'end') depth -= 1;
    if (depth === 0) return index;
  }
  throw new Error('unclosed XML element');
}

function scanBangDeclaration(xml: string, offset: number): 'DTD' | 'ENTITY' | 'XML' | undefined {
  let cursor = offset + 1;
  while (isXmlWhitespace(xml[cursor] ?? '')) cursor += 1;
  if (xml[cursor] !== '!') return undefined;
  cursor += 1;
  while (isXmlWhitespace(xml[cursor] ?? '')) cursor += 1;
  let word = '';
  while (cursor < xml.length && /[A-Za-z]/.test(xml[cursor]!)) word += xml[cursor++]!;
  const lower = word.toLowerCase();
  if (lower === 'doctype') return 'DTD';
  if (lower === 'entity') return 'ENTITY';
  return 'XML';
}

function findTagEnd(xml: string, start: number): number {
  let quote: '"' | "'" | undefined;
  for (let cursor = start; cursor < xml.length; cursor += 1) {
    const char = xml[cursor]!;
    if (quote !== undefined) {
      if (char === quote) quote = undefined;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '>') return cursor;
  }
  throw new Error('unterminated XML tag');
}

function decodeXmlEntities(value: string): string {
  let output = '';
  for (let cursor = 0; cursor < value.length; cursor += 1) {
    const char = value[cursor]!;
    if (char !== '&') {
      output += char;
      continue;
    }
    const semicolon = value.indexOf(';', cursor + 1);
    if (semicolon < 0) throw new Error('unterminated XML entity');
    const body = value.slice(cursor + 1, semicolon);
    let decoded: string;
    if (body === 'amp') decoded = '&';
    else if (body === 'lt') decoded = '<';
    else if (body === 'gt') decoded = '>';
    else if (body === 'quot') decoded = '"';
    else if (body === 'apos') decoded = "'";
    else if (body.startsWith('#x') && body.length > 2 && isHex(body.slice(2))) {
      decoded = decodeNumericEntity(Number.parseInt(body.slice(2), 16));
    } else if (body.startsWith('#') && body.length > 1 && isDecimal(body.slice(1))) {
      decoded = decodeNumericEntity(Number.parseInt(body.slice(1), 10));
    } else {
      throw new Error('unsupported XML entity');
    }
    output += decoded;
    cursor = semicolon;
  }
  validateXmlCharacters(output);
  return output;
}

function decodeNumericEntity(codePoint: number): string {
  if (!isValidXmlCodePoint(codePoint)) throw new Error('invalid XML numeric entity');
  return String.fromCodePoint(codePoint);
}

function validateXmlCharacters(value: string): void {
  for (const char of value) {
    if (!isValidXmlCodePoint(char.codePointAt(0)!)) throw new Error('invalid XML control character');
  }
}

function isValidXmlCodePoint(value: number): boolean {
  return (
    value === 0x09 ||
    value === 0x0a ||
    value === 0x0d ||
    (value >= 0x20 && value <= 0xd7ff) ||
    (value >= 0xe000 && value <= 0xfffd) ||
    (value >= 0x10000 && value <= 0x10ffff)
  );
}

function buildStoredFixture(parts: readonly (readonly [string, string])[]): Uint8Array {
  const local: number[] = [];
  const central: number[] = [];
  let offset = 0;
  for (const [path, text] of parts) {
    const name = utf8Encoder.encode(path);
    const data = utf8Encoder.encode(text);
    const crc = crc32(data);
    local.push(
      0x50, 0x4b, 0x03, 0x04,
      ...u16(20), ...u16(UTF8_FLAG), ...u16(0),
      ...u16(0), ...u16(0x21),
      ...u32(crc), ...u32(data.length), ...u32(data.length),
      ...u16(name.length), ...u16(0), ...name, ...data
    );
    central.push(
      0x50, 0x4b, 0x01, 0x02,
      ...u16(20), ...u16(20), ...u16(UTF8_FLAG), ...u16(0),
      ...u16(0), ...u16(0x21),
      ...u32(crc), ...u32(data.length), ...u32(data.length),
      ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0),
      ...u32(offset), ...name
    );
    offset = local.length;
  }
  const centralOffset = local.length;
  return new Uint8Array([
    ...local,
    ...central,
    0x50, 0x4b, 0x05, 0x06,
    ...u16(0), ...u16(0),
    ...u16(parts.length), ...u16(parts.length),
    ...u32(central.length), ...u32(centralOffset), ...u16(0),
  ]);
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function requireRange(bytes: Uint8Array, offset: number, length: number, label: string): void {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > bytes.length) {
    throw new Error(`truncated or invalid ${label} range`);
  }
}

function locateClassicEocd(bytes: Uint8Array): number {
  const minimum = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
    if (readU32(bytes, offset) !== 0x06054b50) continue;
    const commentLength = readU16(bytes, offset + 20);
    if (offset + 22 + commentLength === bytes.length) {
      if (commentLength !== 0) throw new Error('ZIP comments are not supported');
      return offset;
    }
    if (commentLength === 0) throw new Error('trailing bytes after ZIP end of central directory');
  }
  throw new Error('truncated ZIP: end of central directory missing');
}

function containsSignature(bytes: Uint8Array, signature: number): boolean {
  for (let offset = 0; offset <= bytes.length - 4; offset += 1) {
    if (readU32(bytes, offset) === signature) return true;
  }
  return false;
}

function readU16(bytes: Uint8Array, offset: number): number {
  requireRange(bytes, offset, 2, '16-bit ZIP field');
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function readU32(bytes: Uint8Array, offset: number): number {
  requireRange(bytes, offset, 4, '32-bit ZIP field');
  return (
    bytes[offset]! |
    (bytes[offset + 1]! << 8) |
    (bytes[offset + 2]! << 16) |
    (bytes[offset + 3]! << 24)
  ) >>> 0;
}

function u16(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff];
}

function u32(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}

function sameStrings(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function codeUnitCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function localName(name: string): string {
  const colon = name.indexOf(':');
  return colon < 0 ? name : name.slice(colon + 1);
}

function getAttribute(attributes: readonly XmlAttribute[], name: string): string | undefined {
  return attributes.find((attribute) => localName(attribute.name) === name)?.value;
}

function getAttributeExact(attributes: readonly XmlAttribute[], name: string): string | undefined {
  return attributes.find((attribute) => attribute.name === name)?.value;
}

function normalizedAttribute(
  attributes: readonly XmlAttribute[],
  name: string
): string | undefined {
  const value = getAttributeExact(attributes, name);
  return value === undefined ? undefined : normalizeSecurityValue(value);
}

function normalizeSecurityValue(value: string): string {
  let normalized = '';
  for (const char of value) {
    const point = char.codePointAt(0)!;
    if (point <= 0x20 || point === 0x7f) continue;
    normalized += char;
  }
  return normalized.trim();
}

function namespacePrefix(name: string): string {
  const colon = name.indexOf(':');
  return colon < 0 ? '' : name.slice(0, colon);
}

function isStart(token: XmlToken | undefined, name: string, selfClosing: boolean): boolean {
  return token?.kind === 'start' && localName(token.name!) === name && token.selfClosing === selfClosing;
}

function isEnd(token: XmlToken | undefined, name: string): boolean {
  return token?.kind === 'end' && localName(token.name!) === name;
}

function isExactStart(token: XmlToken | undefined, name: string, selfClosing: boolean): boolean {
  return token?.kind === 'start' && token.name === name && token.selfClosing === selfClosing;
}

function isExactEnd(token: XmlToken | undefined, name: string): boolean {
  return token?.kind === 'end' && token.name === name;
}

function isXmlName(value: string): boolean {
  if (value.length === 0 || !isNameStart(value[0]!)) return false;
  for (let index = 1; index < value.length; index += 1) {
    if (!isNameChar(value[index]!)) return false;
  }
  return true;
}

function isNameStart(char: string): boolean {
  return (
    char === ':' ||
    char === '_' ||
    (char >= 'A' && char <= 'Z') ||
    (char >= 'a' && char <= 'z')
  );
}

function isNameChar(char: string): boolean {
  return isNameStart(char) || char === '-' || char === '.' || (char >= '0' && char <= '9');
}

function isXmlWhitespace(char: string): boolean {
  return char === ' ' || char === '\t' || char === '\r' || char === '\n';
}

function startsOrEndsXmlWhitespace(value: string): boolean {
  return value.length > 0 && (isXmlWhitespace(value[0]!) || isXmlWhitespace(value[value.length - 1]!));
}

function stripControls(value: string): string {
  let output = '';
  for (const char of value) {
    const point = char.codePointAt(0)!;
    if (point > 0x1f && point !== 0x7f) output += char;
  }
  return output;
}

function isHex(value: string): boolean {
  for (const char of value) {
    if (!((char >= '0' && char <= '9') || (char >= 'a' && char <= 'f') || (char >= 'A' && char <= 'F'))) {
      return false;
    }
  }
  return value.length > 0;
}

function isDecimal(value: string): boolean {
  for (const char of value) if (char < '0' || char > '9') return false;
  return value.length > 0;
}

function startsLikeXmlDeclaration(xml: string): boolean {
  return xml.length >= 5 && xml.slice(0, 5).toLowerCase() === '<?xml';
}
