import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';

const HERE = dirname(fileURLToPath(import.meta.url));

const BODY_OPEN = /<w:body\b[^>]*>/i;
const BODY_CLOSE = '</w:body>';
const SECT_PR = /<w:sectPr\b[\s\S]*?<\/w:sectPr>/i;
const PARA_ID = /\s+w14:(?:paraId|textId)="[^"]*"/g;

export interface DuplicatedDocument {
  readonly bytes: Uint8Array;
  readonly copies: number;
  readonly marker: string;
  readonly fileBytes: number;
}

/**
 * Repeat the body of an existing DOCX `copies` times.
 *
 * Paragraph ids are stripped so copies do not share identity. A unique marker
 * paragraph is prepended so a test can tell which file a peer actually holds.
 */
export function duplicateDocxBody(sourcePath: string, copies: number): DuplicatedDocument {
  if (!Number.isInteger(copies) || copies < 1) {
    throw new Error('copies must be a positive integer');
  }
  const unzipped = unzipSync(readFileSync(sourcePath));
  const partName = Object.keys(unzipped).find((name) => name.replace(/\\/g, '/') === 'word/document.xml');
  if (!partName) throw new Error(`${sourcePath} has no word/document.xml`);
  const xml = strFromU8(unzipped[partName]!);
  const open = xml.match(BODY_OPEN);
  if (!open || open.index === undefined) throw new Error('document.xml has no w:body');
  const innerStart = open.index + open[0].length;
  const innerEnd = xml.toLowerCase().lastIndexOf(BODY_CLOSE);
  if (innerEnd < innerStart) throw new Error('document.xml has no closing w:body');
  const inner = xml.slice(innerStart, innerEnd);
  const sect = inner.match(SECT_PR)?.[0] ?? '';
  const content = inner.replace(SECT_PR, '').replace(PARA_ID, '');
  const marker = `COLLAB-SIZE-${copies}x-${Date.now().toString(36)}`;
  const markerParagraph = `<w:p><w:r><w:t xml:space="preserve">${marker}</w:t></w:r></w:p>`;
  const next = `${xml.slice(0, innerStart)}${markerParagraph}${content.repeat(copies)}${sect}${xml.slice(innerEnd)}`;
  unzipped[partName] = strToU8(next);
  const bytes = zipSync(unzipped, { level: 6 });
  return { bytes, copies, marker, fileBytes: bytes.byteLength };
}

export interface SharedStateSize {
  readonly ok: boolean;
  readonly nodes?: number;
  readonly updateBytes?: number;
  readonly error?: string;
}

/** Encode the document the way a join does, so the table reports shared-state size. */
export function measureSharedState(bytes: Uint8Array): SharedStateSize {
  const file = join(tmpdir(), `collab-size-${process.pid}-${Date.now()}.docx`);
  writeFileSync(file, bytes);
  try {
    const stdout = execFileSync(
      'bun',
      [join(HERE, 'collaboration-documentload-measure.ts'), file],
      { encoding: 'utf8', timeout: 180_000, maxBuffer: 4 * 1024 * 1024 }
    );
    return JSON.parse(stdout) as SharedStateSize;
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : String(cause) };
  }
}
