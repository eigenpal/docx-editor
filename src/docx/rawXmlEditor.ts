/**
 * Raw DOCX XML Editor
 *
 * Provides direct ZIP part access for workflows that need to read/edit OOXML
 * without converting through the internal Document model.
 *
 * This is useful for:
 * - minimal-diff targeted XML edits
 * - preserving unsupported structures as-is
 * - advanced/legal workflows that operate directly on OOXML
 */

import JSZip from 'jszip';
import type { DocxInput } from '../utils/docxInput';
import { toArrayBuffer } from '../utils/docxInput';

/**
 * Metadata for a single DOCX package part.
 */
export interface DocxPartInfo {
  /** Path inside ZIP package, e.g. "word/document.xml" */
  path: string;
  /** True for .xml and .rels files */
  isXml: boolean;
  /** True for relationship files */
  isRels: boolean;
  /** True for media files under word/media/ */
  isMedia: boolean;
}

/**
 * Save options for exporting modified package.
 */
export interface DocxXmlSaveOptions {
  /** Compression level (0-9), default 6 */
  compressionLevel?: number;
}

/**
 * Mutator function used by editDocxXml helper.
 */
export type DocxXmlMutator = (editor: DocxXmlEditor) => void | Promise<void>;

function normalizePartPath(path: string): string {
  return path.replace(/^\/+/, '');
}

/**
 * Direct OOXML package editor.
 */
export class DocxXmlEditor {
  private readonly zip: JSZip;
  private readonly modifiedParts = new Set<string>();

  private constructor(zip: JSZip) {
    this.zip = zip;
  }

  /**
   * Open a DOCX package for direct part editing.
   */
  static async open(input: DocxInput): Promise<DocxXmlEditor> {
    const buffer = input instanceof ArrayBuffer ? input : await toArrayBuffer(input);
    const zip = await JSZip.loadAsync(buffer);
    return new DocxXmlEditor(zip);
  }

  /**
   * List package parts.
   */
  listParts(options: { xmlOnly?: boolean } = {}): DocxPartInfo[] {
    const { xmlOnly = false } = options;
    const parts: DocxPartInfo[] = [];

    for (const [path, file] of Object.entries(this.zip.files)) {
      if (file.dir) continue;

      const lower = path.toLowerCase();
      const isXml = lower.endsWith('.xml') || lower.endsWith('.rels');
      if (xmlOnly && !isXml) continue;

      parts.push({
        path,
        isXml,
        isRels: lower.endsWith('.rels'),
        isMedia: lower.startsWith('word/media/'),
      });
    }

    return parts.sort((a, b) => a.path.localeCompare(b.path));
  }

  /**
   * Check whether a part exists.
   */
  hasPart(path: string): boolean {
    const normalized = normalizePartPath(path);
    return !!this.zip.files[normalized] && !this.zip.files[normalized].dir;
  }

  /**
   * Read a part as text.
   */
  async getText(path: string): Promise<string> {
    const normalized = normalizePartPath(path);
    const file = this.zip.file(normalized);
    if (!file) {
      throw new Error(`Part not found: ${normalized}`);
    }
    return file.async('text');
  }

  /**
   * Read a part as XML text.
   */
  async getXml(path: string): Promise<string> {
    const normalized = normalizePartPath(path);
    const lower = normalized.toLowerCase();
    if (!lower.endsWith('.xml') && !lower.endsWith('.rels')) {
      throw new Error(`Part is not XML/RELS: ${normalized}`);
    }
    return this.getText(normalized);
  }

  /**
   * Read a part as binary bytes.
   */
  async getBinary(path: string): Promise<ArrayBuffer> {
    const normalized = normalizePartPath(path);
    const file = this.zip.file(normalized);
    if (!file) {
      throw new Error(`Part not found: ${normalized}`);
    }
    return file.async('arraybuffer');
  }

  /**
   * Write plain text to a part.
   */
  setText(path: string, text: string): this {
    const normalized = normalizePartPath(path);
    this.zip.file(normalized, text);
    this.modifiedParts.add(normalized);
    return this;
  }

  /**
   * Write XML to a part.
   */
  setXml(path: string, xml: string): this {
    const normalized = normalizePartPath(path);
    const lower = normalized.toLowerCase();
    if (!lower.endsWith('.xml') && !lower.endsWith('.rels')) {
      throw new Error(`Target part is not XML/RELS: ${normalized}`);
    }
    this.zip.file(normalized, xml);
    this.modifiedParts.add(normalized);
    return this;
  }

  /**
   * Write binary bytes to a part.
   */
  setBinary(path: string, bytes: ArrayBuffer | Uint8Array): this {
    const normalized = normalizePartPath(path);
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    this.zip.file(normalized, data);
    this.modifiedParts.add(normalized);
    return this;
  }

  /**
   * Remove a part from the package.
   */
  removePart(path: string): this {
    const normalized = normalizePartPath(path);
    this.zip.remove(normalized);
    this.modifiedParts.add(normalized);
    return this;
  }

  /**
   * Get paths changed during this editing session.
   */
  getModifiedParts(): string[] {
    return Array.from(this.modifiedParts).sort();
  }

  /**
   * Export package back to DOCX buffer.
   */
  async toBuffer(options: DocxXmlSaveOptions = {}): Promise<ArrayBuffer> {
    const { compressionLevel = 6 } = options;
    return this.zip.generateAsync({
      type: 'arraybuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: compressionLevel },
    });
  }
}

/**
 * Open a DOCX package for direct XML editing.
 */
export async function openDocxXml(input: DocxInput): Promise<DocxXmlEditor> {
  return DocxXmlEditor.open(input);
}

/**
 * One-shot helper: open, mutate, and export in one call.
 */
export async function editDocxXml(
  input: DocxInput,
  mutate: DocxXmlMutator,
  options: DocxXmlSaveOptions = {}
): Promise<ArrayBuffer> {
  const editor = await openDocxXml(input);
  await mutate(editor);
  return editor.toBuffer(options);
}
