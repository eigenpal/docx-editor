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

const FIXED_ZIP_DATE = new Date('1980-01-01T00:00:00Z');

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

const OWNED_RUNS_XML = [
  '<w:r><w:t>Hello </w:t></w:r>',
  '<w:r><w:rPr><w:b/></w:rPr><w:t>bold</w:t></w:r>',
  '<w:r><w:t> </w:t></w:r>',
  '<w:r><w:rPr><w:i/></w:rPr><w:t>italic</w:t></w:r>',
].join('');

const DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${POC_W_NS}" xmlns:poc="${POC_NS}" xmlns:custom="${POC_CUSTOM_NS}">
  <w:body>
    <w:p>
      <w:pPr><poc:ParagraphId>${POC_PARAGRAPH_ID}</poc:ParagraphId></w:pPr>
      <poc:OwnedStart/>
      ${OWNED_RUNS_XML}
      <poc:OwnedEnd/>
      ${CAPSULE_XML}
    </w:p>
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>
    </w:sectPr>
  </w:body>
</w:document>`;

const CAPSULE_START_TAG = '<custom:PocUnsupported';
const CAPSULE_END_TAG = '</custom:PocUnsupported>';
const OWNED_START_TAG = '<poc:OwnedStart/>';
const OWNED_END_TAG = '<poc:OwnedEnd/>';
const PARAGRAPH_ID_OPEN = '<poc:ParagraphId>';
const PARAGRAPH_ID_CLOSE = '</poc:ParagraphId>';

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

interface ZipEntryMeta {
  readonly path: string;
  readonly compressionMethod: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly generalPurposeBitFlag: number;
  readonly localHeaderOffset: number;
}

interface ParsedZip {
  readonly entries: readonly ZipEntryMeta[];
}

interface ParsedDocument {
  readonly paragraphId: string;
  readonly runs: readonly PocRun[];
  readonly text: string;
  readonly capsuleBytes: Uint8Array;
  readonly ownedStart: number;
  readonly ownedEnd: number;
}

let cachedFixture: Uint8Array | undefined;

export async function createPocDocxFixture(): Promise<Uint8Array> {
  if (cachedFixture) return copyBytes(cachedFixture);
  const zip = new JSZip();
  const zipOptions = { date: FIXED_ZIP_DATE };
  zip.file('[Content_Types].xml', CONTENT_TYPES_XML, zipOptions);
  zip.file('_rels/.rels', ROOT_RELS_XML, zipOptions);
  zip.file('word/_rels/document.xml.rels', DOCUMENT_RELS_XML, zipOptions);
  zip.file('word/styles.xml', STYLES_XML, zipOptions);
  zip.file('word/document.xml', DOCUMENT_XML, zipOptions);
  const bytes = await zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });
  cachedFixture = bytes;
  return copyBytes(bytes);
}

export async function loadPocDocx(bytes: Uint8Array): Promise<LoadedPocDocx> {
  const sourceBytes = copyBytes(bytes);
  if (sourceBytes.length > POC_ZIP_MAX_BYTES) {
    throw new Error('DOCX exceeds input byte cap');
  }
  const parsedZip = parseZipCentralDirectory(sourceBytes);
  if (parsedZip.entries.length > POC_ZIP_MAX_ENTRIES) {
    throw new Error('DOCX exceeds maximum ZIP entry count');
  }
  validateZipEntryPaths(parsedZip.entries);
  validateZipEntryMetadata(parsedZip.entries);
  const zip = await JSZip.loadAsync(sourceBytes);
  const entryMap = new Map<string, Uint8Array>();
  let aggregateUncompressed = 0;
  for (const required of REQUIRED_ENTRIES) {
    const file = zip.file(required);
    if (!file) throw new Error(`missing required entry ${required}`);
    const data = await file.async('uint8array');
    if (data.length > POC_ZIP_MAX_ENTRY_UNCOMPRESSED_BYTES) {
      throw new Error('DOCX entry exceeds uncompressed byte cap');
    }
    aggregateUncompressed += data.length;
    if (aggregateUncompressed > POC_ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES) {
      throw new Error('aggregate uncompressed size exceeds cap');
    }
    entryMap.set(required, data);
  }
  validateRequiredEntryUniqueness(parsedZip.entries);
  for (const relPath of ['_rels/.rels', 'word/_rels/document.xml.rels'] as const) {
    validateRelationships(entryMap.get(relPath)!);
  }
  const documentBytes = entryMap.get('word/document.xml')!;
  if (documentBytes.length > POC_XML_MAX_BYTES) {
    throw new Error('word/document.xml exceeds XML byte cap');
  }
  rejectDtdOrEntitySurface(documentBytes);
  const parsedDocument = parseDocumentXml(documentBytes);
  return Object.freeze({
    text: parsedDocument.text,
    runs: Object.freeze(parsedDocument.runs.map((run) => Object.freeze({ ...run }))),
    paragraphId: parsedDocument.paragraphId,
    capsuleBytes: copyBytes(parsedDocument.capsuleBytes),
    sourceBytes,
  });
}

export async function savePocDocx(
  source: LoadedPocDocx,
  runs: readonly PocRun[]
): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(source.sourceBytes);
  const documentBytes = await zip.file('word/document.xml')!.async('uint8array');
  rejectDtdOrEntitySurface(documentBytes);
  const parsed = parseDocumentXml(documentBytes);
  if (!bytesEqual(parsed.capsuleBytes, source.capsuleBytes)) {
    throw new Error('source capsule bytes drifted from document.xml');
  }
  const rebuiltOwned = rebuildOwnedRunsXml(runs);
  const documentXml = Buffer.from(documentBytes).toString('utf8');
  const ownedRegion = `${OWNED_START_TAG}${rebuiltOwned}${OWNED_END_TAG}`;
  const beforeOwned = documentXml.slice(0, parsed.ownedStart);
  const afterOwned = documentXml.slice(parsed.ownedEnd);
  const nextDocumentXml = `${beforeOwned}${ownedRegion}${afterOwned}`;
  rejectDtdOrEntitySurface(new TextEncoder().encode(nextDocumentXml));
  const nextZip = new JSZip();
  for (const path of REQUIRED_ENTRIES) {
    if (path === 'word/document.xml') {
      nextZip.file(path, nextDocumentXml, { date: FIXED_ZIP_DATE });
      continue;
    }
    nextZip.file(path, await zip.file(path)!.async('uint8array'), { date: FIXED_ZIP_DATE });
  }
  return nextZip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });
}

function rebuildOwnedRunsXml(runs: readonly PocRun[]): string {
  return runs
    .map((run) => {
      const properties: string[] = [];
      if (run.bold) properties.push('<w:b/>');
      if (run.italic) properties.push('<w:i/>');
      const rPr = properties.length > 0 ? `<w:rPr>${properties.join('')}</w:rPr>` : '';
      return `<w:r>${rPr}<w:t>${escapeXml(run.text)}</w:t></w:r>`;
    })
    .join('');
}

function parseDocumentXml(documentBytes: Uint8Array): ParsedDocument {
  const xml = Buffer.from(documentBytes).toString('utf8');
  let scanSteps = 0;
  const nextStep = () => {
    scanSteps += 1;
    if (scanSteps > POC_XML_MAX_SCAN_STEPS) {
      throw new Error('XML scan step cap exceeded');
    }
  };

  const paragraphId = extractSingle(xml, PARAGRAPH_ID_OPEN, PARAGRAPH_ID_CLOSE, 'paragraph identity');
  nextStep();

  const ownedStart = findExactOccurrence(xml, OWNED_START_TAG, 'owned start marker');
  nextStep();
  const ownedEndMarker = findExactOccurrence(xml, OWNED_END_TAG, 'owned end marker');
  nextStep();
  if (ownedEndMarker <= ownedStart) {
    throw new Error('owned marker order invalid');
  }
  const ownedEnd = ownedEndMarker + OWNED_END_TAG.length;

  const capsuleStart = findExactOccurrence(xml, CAPSULE_START_TAG, 'capsule start');
  nextStep();
  const capsuleEndTagIndex = findExactOccurrence(xml, CAPSULE_END_TAG, 'capsule end');
  nextStep();
  if (capsuleEndTagIndex <= capsuleStart) {
    throw new Error('capsule marker order invalid');
  }
  if (capsuleStart < ownedEnd) {
    throw new Error('capsule must remain outside owned editable span');
  }
  const capsuleEnd = capsuleEndTagIndex + CAPSULE_END_TAG.length;
  const capsuleBytes = new TextEncoder().encode(xml.slice(capsuleStart, capsuleEnd));

  const ownedXml = xml.slice(ownedStart + OWNED_START_TAG.length, ownedEnd - OWNED_END_TAG.length);
  const runs = parseOwnedRuns(ownedXml, nextStep);
  const text = runs.map((run) => run.text).join('');
  if (countParagraphs(xml) !== 1) {
    throw new Error('fixture must contain exactly one body paragraph');
  }
  return {
    paragraphId,
    runs,
    text,
    capsuleBytes,
    ownedStart,
    ownedEnd,
  };
}

function parseOwnedRuns(ownedXml: string, nextStep: () => void): readonly PocRun[] {
  const runs: PocRun[] = [];
  let index = 0;
  while (index < ownedXml.length) {
    nextStep();
    const open = ownedXml.indexOf('<w:r', index);
    if (open < 0) break;
    const openEnd = ownedXml.indexOf('>', open);
    if (openEnd < 0) throw new Error('malformed run element');
    const close = ownedXml.indexOf('</w:r>', openEnd);
    if (close < 0) throw new Error('malformed run element');
    const runXml = ownedXml.slice(open, close + '</w:r>'.length);
    const textOpen = runXml.indexOf('<w:t');
    if (textOpen < 0) throw new Error('run missing text node');
    const textStart = runXml.indexOf('>', textOpen);
    if (textStart < 0) throw new Error('run missing text node');
    const textEnd = runXml.indexOf('</w:t>', textStart);
    if (textEnd < 0) throw new Error('run missing text node');
    const text = decodeXmlText(runXml.slice(textStart + 1, textEnd));
    const bold = runXml.includes('<w:b') || runXml.includes('<w:b/>');
    const italic = runXml.includes('<w:i') || runXml.includes('<w:i/>');
    runs.push(Object.freeze({ text, bold, italic }));
    index = close + '</w:r>'.length;
  }
  if (runs.length === 0) throw new Error('owned span contains no editable runs');
  return Object.freeze(runs);
}

function countParagraphs(xml: string): number {
  let count = 0;
  let index = 0;
  while (index < xml.length) {
    const open = xml.indexOf('<w:p', index);
    if (open < 0) break;
    const next = xml[open + 4];
    if (next === '>' || next === ' ' || next === '/') count += 1;
    index = open + 4;
  }
  return count;
}

function extractSingle(xml: string, open: string, close: string, label: string): string {
  const start = findExactOccurrence(xml, open, label);
  const end = findExactOccurrence(xml, close, label);
  if (end <= start) throw new Error(`${label} markers invalid`);
  return xml.slice(start + open.length, end);
}

function findExactOccurrence(haystack: string, needle: string, label: string): number {
  const first = haystack.indexOf(needle);
  if (first < 0) throw new Error(`missing ${label}`);
  if (haystack.indexOf(needle, first + needle.length) >= 0) {
    throw new Error(`duplicate ${label}`);
  }
  return first;
}

function rejectDtdOrEntitySurface(bytes: Uint8Array): void {
  const xml = Buffer.from(bytes).toString('utf8');
  const patterns = ['<!DOCTYPE', '<!ENTITY', '<!doctype', '<!entity'];
  for (const pattern of patterns) {
    if (xml.includes(pattern)) {
      throw new Error('DTD or entity declaration rejected');
    }
  }
}

function validateRelationships(bytes: Uint8Array): void {
  const xml = Buffer.from(bytes).toString('utf8');
  let index = 0;
  let steps = 0;
  while (index < xml.length) {
    steps += 1;
    if (steps > POC_XML_MAX_SCAN_STEPS) throw new Error('relationship scan step cap exceeded');
    const open = xml.indexOf('<Relationship', index);
    if (open < 0) break;
    const close = xml.indexOf('/>', open);
    const end = xml.indexOf('</Relationship>', open);
    const tagEnd = close >= 0 && (end < 0 || close < end) ? close + 2 : end + '</Relationship>'.length;
    if (tagEnd < 0) throw new Error('malformed relationship element');
    const tag = xml.slice(open, tagEnd);
    if (/TargetMode\s*=\s*"(?:External|external)"/.test(tag)) {
      throw new Error('external relationship rejected');
    }
    const targetMatch = tag.match(/\bTarget\s*=\s*"([^"]*)"/);
    if (targetMatch) {
      const target = targetMatch[1]!;
      if (/^[a-zA-Z][a-zA-Z+\-.]*:/.test(target) && !target.startsWith('word/')) {
        throw new Error('remote relationship target rejected');
      }
      if (target.includes('..') || target.startsWith('/') || target.includes('\\') || target.includes('\0')) {
        throw new Error('relationship traversal target rejected');
      }
    }
    index = tagEnd;
  }
}

function validateRequiredEntryUniqueness(entries: readonly ZipEntryMeta[]): void {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    counts.set(entry.path, (counts.get(entry.path) ?? 0) + 1);
  }
  for (const required of REQUIRED_ENTRIES) {
    if ((counts.get(required) ?? 0) !== 1) {
      throw new Error(`duplicate or missing required entry ${required}`);
    }
  }
}

function validateZipEntryPaths(entries: readonly ZipEntryMeta[]): void {
  const lowered = new Map<string, string>();
  const pathCounts = new Map<string, number>();
  for (const entry of entries) {
    const path = entry.path;
    pathCounts.set(path, (pathCounts.get(path) ?? 0) + 1);
    if (path.includes('\0')) throw new Error('ZIP path contains NUL');
    if (path.includes('\\')) throw new Error('ZIP path contains backslash');
    if (path.includes('..')) throw new Error('ZIP path contains traversal segment');
    if (path.startsWith('/')) throw new Error('ZIP path is absolute');
    const key = path.toLowerCase();
    const previous = lowered.get(key);
    if (previous && previous !== path) {
      throw new Error('ZIP path case collision detected');
    }
    lowered.set(key, path);
  }
  for (const [path, count] of pathCounts) {
    if (count > 1) throw new Error(`duplicate ZIP entry ${path}`);
  }
}

function validateZipEntryMetadata(entries: readonly ZipEntryMeta[]): void {
  let aggregateDeclared = 0;
  for (const entry of entries) {
    if ((entry.generalPurposeBitFlag & 0x0001) !== 0) {
      throw new Error('encrypted ZIP entry rejected');
    }
    if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
      throw new Error('unsupported ZIP compression method');
    }
    if (entry.uncompressedSize > POC_ZIP_MAX_ENTRY_UNCOMPRESSED_BYTES) {
      throw new Error('declared uncompressed size exceeds entry cap');
    }
    aggregateDeclared += entry.uncompressedSize;
    if (aggregateDeclared > POC_ZIP_MAX_TOTAL_UNCOMPRESSED_BYTES) {
      throw new Error('declared aggregate uncompressed size exceeds cap');
    }
    if (
      entry.compressedSize > 0 &&
      entry.uncompressedSize / entry.compressedSize > POC_ZIP_MAX_DECOMPRESSION_RATIO
    ) {
      throw new Error('ZIP decompression ratio exceeds cap');
    }
  }
}

function parseZipCentralDirectory(bytes: Uint8Array): ParsedZip {
  const eocdOffset = findEndOfCentralDirectory(bytes);
  const totalEntries = readU16(bytes, eocdOffset + 10);
  const centralSize = readU32(bytes, eocdOffset + 12);
  const centralOffset = readU32(bytes, eocdOffset + 16);
  if (centralOffset + centralSize > bytes.length) {
    throw new Error('invalid ZIP central directory');
  }
  const entries: ZipEntryMeta[] = [];
  let offset = centralOffset;
  for (let index = 0; index < totalEntries; index += 1) {
    if (readU32(bytes, offset) !== 0x02014b50) {
      throw new Error('invalid ZIP central directory entry');
    }
    const generalPurposeBitFlag = readU16(bytes, offset + 8);
    const compressionMethod = readU16(bytes, offset + 10);
    const compressedSize = readU32(bytes, offset + 20);
    const uncompressedSize = readU32(bytes, offset + 24);
    const fileNameLength = readU16(bytes, offset + 28);
    const extraLength = readU16(bytes, offset + 30);
    const commentLength = readU16(bytes, offset + 32);
    const localHeaderOffset = readU32(bytes, offset + 42);
    const nameStart = offset + 46;
    const path = new TextDecoder().decode(bytes.slice(nameStart, nameStart + fileNameLength));
    entries.push({
      path,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      generalPurposeBitFlag,
      localHeaderOffset,
    });
    offset = nameStart + fileNameLength + extraLength + commentLength;
  }
  return { entries };
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  const minEocdSize = 22;
  for (let index = bytes.length - minEocdSize; index >= 0; index -= 1) {
    if (readU32(bytes, index) !== 0x06054b50) continue;
    const commentLength = readU16(bytes, index + 20);
    const eocdSize = minEocdSize + commentLength;
    if (index + eocdSize !== bytes.length) continue;
    const centralSize = readU32(bytes, index + 12);
    const centralOffset = readU32(bytes, index + 16);
    if (centralOffset + centralSize !== index) continue;
    return index;
  }
  throw new Error('ZIP end of central directory not found');
}

function readU16(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! |
    (bytes[offset + 1]! << 8) |
    (bytes[offset + 2]! << 16) |
    (bytes[offset + 3]! << 24)
  ) >>> 0;
}

function decodeXmlText(value: string): string {
  let result = '';
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!;
    if (char !== '&') {
      result += char;
      continue;
    }
    const semi = value.indexOf(';', index + 1);
    if (semi < 0) throw new Error('invalid XML entity');
    const entity = value.slice(index, semi + 1);
    if (entity === '&amp;') result += '&';
    else if (entity === '&lt;') result += '<';
    else if (entity === '&gt;') result += '>';
    else if (entity === '&quot;') result += '"';
    else if (entity === '&apos;') result += "'";
    else if (/^&#x[0-9a-fA-F]+;/.test(entity)) {
      const codePoint = Number.parseInt(entity.slice(3, -1), 16);
      if (!Number.isFinite(codePoint) || codePoint > 0x10ffff) {
        throw new Error('invalid XML numeric entity');
      }
      result += String.fromCodePoint(codePoint);
    } else if (/^&#\d+;/.test(entity)) {
      const codePoint = Number.parseInt(entity.slice(2, -1), 10);
      if (!Number.isFinite(codePoint) || codePoint > 0x10ffff) {
        throw new Error('invalid XML numeric entity');
      }
      result += String.fromCodePoint(codePoint);
    } else {
      throw new Error('unsupported XML entity');
    }
    index = semi;
  }
  return result;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function copyBytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}
