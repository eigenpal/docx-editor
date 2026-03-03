/**
 * DOCX Loremifier
 *
 * Replaces human-readable run text in DOCX XML parts with lorem-ipsum-like
 * text while preserving document structure and per-word lengths.
 *
 * Usage:
 *   bun run docx:loremify -- input.docx
 *   bun run docx:loremify -- input.docx --out-dir sanitized
 *   bun run docx:loremify -- input1.docx input2.docx --suffix .anon
 *   bun run docx:loremify -- input.docx --in-place
 */

import JSZip from 'jszip';
import { promises as fs } from 'fs';
import path from 'path';

type CliOptions = {
  help: boolean;
  inPlace: boolean;
  allXml: boolean;
  stripMedia: boolean;
  outDir?: string;
  suffix: string;
  inputs: string[];
};

type FileStats = {
  xmlFilesUpdated: number;
  wordsReplaced: number;
  mediaFilesRemoved: number;
  metadataFieldsSanitized: number;
};

const HELP_TEXT = `docx loremifier

USAGE:
  bun run docx:loremify -- <input1.docx> [input2.docx ...] [options]

OPTIONS:
  --out-dir <dir>   Output directory for generated files
  --suffix <text>   Output filename suffix (default: .lorem)
  --in-place        Overwrite original file(s)
  --all-xml         Replace text in every XML part (advanced)
  --strip-media     Remove embedded files in word/media and image references
  -h, --help        Show this help text

EXAMPLES:
  bun run docx:loremify -- sample.docx
  bun run docx:loremify -- sample.docx --out-dir sanitized
  bun run docx:loremify -- a.docx b.docx --suffix .anonymized
  bun run docx:loremify -- sample.docx --in-place
`;

const LOREM_WORDS = [
  'lorem',
  'ipsum',
  'dolor',
  'sit',
  'amet',
  'consectetur',
  'adipiscing',
  'elit',
  'sed',
  'do',
  'eiusmod',
  'tempor',
  'incididunt',
  'ut',
  'labore',
  'et',
  'dolore',
  'magna',
  'aliqua',
];

const TEXT_TAG_PATTERNS = [
  /<((?:[\w.-]+:)?t)(\s[^>]*)?>([\s\S]*?)<\/\1>/g,
  /<((?:[\w.-]+:)?delText)(\s[^>]*)?>([\s\S]*?)<\/\1>/g,
];

const XML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

const CORE_PROPERTIES_RULES: Array<{ tagName: string; replacement: string }> = [
  { tagName: 'dc:creator', replacement: 'Sanitized' },
  { tagName: 'cp:lastModifiedBy', replacement: 'Sanitized' },
  { tagName: 'cp:revision', replacement: '1' },
  { tagName: 'dc:title', replacement: '' },
  { tagName: 'dc:subject', replacement: '' },
  { tagName: 'dc:description', replacement: '' },
  { tagName: 'cp:keywords', replacement: '' },
  { tagName: 'cp:category', replacement: '' },
  { tagName: 'cp:contentStatus', replacement: '' },
];

const APP_PROPERTIES_RULES: Array<{ tagName: string; replacement: string }> = [
  { tagName: 'Company', replacement: 'Sanitized' },
  { tagName: 'Manager', replacement: 'Sanitized' },
  { tagName: 'HyperlinkBase', replacement: '' },
];

export class LoremWordGenerator {
  private index = 0;

  next(wordLength: number): string {
    if (wordLength <= 0) return '';

    const base = LOREM_WORDS[this.index % LOREM_WORDS.length];
    this.index += 1;
    return fitWordToLength(base, wordLength);
  }
}

function fitWordToLength(base: string, targetLength: number): string {
  if (targetLength <= base.length) {
    return base.slice(0, targetLength);
  }

  let value = '';
  while (value.length < targetLength) {
    value += base;
  }
  return value.slice(0, targetLength);
}

export function applyCasing(source: string, replacement: string): string {
  if (source.toUpperCase() === source) {
    return replacement.toUpperCase();
  }

  if (
    source.length > 0 &&
    source[0] === source[0].toUpperCase() &&
    source.slice(1) === source.slice(1).toLowerCase()
  ) {
    return replacement[0].toUpperCase() + replacement.slice(1).toLowerCase();
  }

  if (source.toLowerCase() === source) {
    return replacement.toLowerCase();
  }

  return replacement;
}

export function decodeXmlEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g, (full, entity) => {
    if (entity in XML_ENTITIES) {
      return XML_ENTITIES[entity];
    }

    if (entity.startsWith('#x')) {
      const codePoint = Number.parseInt(entity.slice(2), 16);
      if (!Number.isNaN(codePoint) && codePoint >= 0) {
        return String.fromCodePoint(codePoint);
      }
      return full;
    }

    if (entity.startsWith('#')) {
      const codePoint = Number.parseInt(entity.slice(1), 10);
      if (!Number.isNaN(codePoint) && codePoint >= 0) {
        return String.fromCodePoint(codePoint);
      }
      return full;
    }

    return full;
  });
}

function escapeXmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceTagValue(
  xml: string,
  tagName: string,
  replacement: string
): { xml: string; replacements: number } {
  const pattern = new RegExp(
    `<(${escapeRegex(tagName)})(\\s[^>]*)?>([\\s\\S]*?)<\\/\\1>`,
    'g'
  );

  let replacements = 0;
  const updatedXml = xml.replace(pattern, (_full, fullTagName: string, attrs: string) => {
    replacements += 1;
    return `<${fullTagName}${attrs ?? ''}>${escapeXmlText(replacement)}</${fullTagName}>`;
  });

  return { xml: updatedXml, replacements };
}

export function sanitizeMetadataXml(zipPath: string, xml: string): { xml: string; sanitizedFields: number } {
  const lower = zipPath.toLowerCase();
  const rules =
    lower === 'docprops/core.xml'
      ? CORE_PROPERTIES_RULES
      : lower === 'docprops/app.xml'
        ? APP_PROPERTIES_RULES
        : undefined;

  if (!rules) {
    return { xml, sanitizedFields: 0 };
  }

  let updatedXml = xml;
  let sanitizedFields = 0;

  for (const rule of rules) {
    const result = replaceTagValue(updatedXml, rule.tagName, rule.replacement);
    updatedXml = result.xml;
    sanitizedFields += result.replacements;
  }

  return { xml: updatedXml, sanitizedFields };
}

export function stripMediaReferencesFromRels(xml: string): string {
  return xml.replace(
    /<Relationship\b[^>]*\bTarget=(["'])([^"']+)\1[^>]*\/>/gi,
    (full, _quote, target: string) => {
      const normalizedTarget = target.toLowerCase().replace(/\\/g, '/');
      if (normalizedTarget.startsWith('media/') || normalizedTarget.includes('/media/')) {
        return '';
      }
      return full;
    }
  );
}

export function stripMediaMarkupFromWordXml(xml: string): string {
  const MARKUP_PATTERNS = [
    /<(?:[\w.-]+:)?drawing\b[\s\S]*?<\/(?:[\w.-]+:)?drawing>/g,
    /<(?:[\w.-]+:)?pict\b[\s\S]*?<\/(?:[\w.-]+:)?pict>/g,
    /<(?:[\w.-]+:)?object\b[\s\S]*?<\/(?:[\w.-]+:)?object>/g,
    /<(?:[\w.-]+:)?imagedata\b[^>]*\/>/g,
  ];

  let updatedXml = xml;
  for (const pattern of MARKUP_PATTERNS) {
    updatedXml = updatedXml.replace(pattern, '');
  }

  return updatedXml;
}

export function replaceWordsKeepingLengths(
  value: string,
  generator: LoremWordGenerator
): { text: string; replacedWords: number } {
  let replacedWords = 0;
  const text = value.replace(/\p{L}+/gu, (word) => {
    replacedWords += 1;
    const replacement = generator.next(word.length);
    return applyCasing(word, replacement);
  });

  return { text, replacedWords };
}

export function loremifyXml(
  xml: string,
  generator: LoremWordGenerator
): { xml: string; replacedWords: number } {
  let updatedXml = xml;
  let replacedWords = 0;

  for (const pattern of TEXT_TAG_PATTERNS) {
    updatedXml = updatedXml.replace(pattern, (full, tagName: string, attrs: string, text: string) => {
      const decoded = decodeXmlEntities(text);
      const result = replaceWordsKeepingLengths(decoded, generator);
      replacedWords += result.replacedWords;

      if (result.replacedWords === 0) {
        return full;
      }

      const safeText = escapeXmlText(result.text);
      return `<${tagName}${attrs ?? ''}>${safeText}</${tagName}>`;
    });
  }

  return { xml: updatedXml, replacedWords };
}

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    help: false,
    inPlace: false,
    allXml: false,
    stripMedia: false,
    suffix: '.lorem',
    inputs: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }

    if (arg === '--in-place') {
      options.inPlace = true;
      continue;
    }

    if (arg === '--all-xml') {
      options.allXml = true;
      continue;
    }

    if (arg === '--strip-media') {
      options.stripMedia = true;
      continue;
    }

    if (arg === '--out-dir') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('--out-dir requires a directory path');
      }
      options.outDir = path.resolve(value);
      i += 1;
      continue;
    }

    if (arg === '--suffix') {
      const value = argv[i + 1];
      if (!value || value.startsWith('-')) {
        throw new Error('--suffix requires a value');
      }
      options.suffix = value;
      i += 1;
      continue;
    }

    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    }

    options.inputs.push(path.resolve(arg));
  }

  return options;
}

function getOutputPath(inputPath: string, options: CliOptions): string {
  if (options.inPlace) {
    return inputPath;
  }

  const ext = path.extname(inputPath) || '.docx';
  const stem = path.basename(inputPath, ext);
  const outputDir = options.outDir ?? path.dirname(inputPath);
  return path.join(outputDir, `${stem}${options.suffix}${ext}`);
}

async function loremifyDocxBuffer(
  buffer: Buffer,
  options: Pick<CliOptions, 'allXml' | 'stripMedia'>
): Promise<{ output: Buffer; stats: FileStats }> {
  const zip = await JSZip.loadAsync(buffer);
  const generator = new LoremWordGenerator();

  let xmlFilesUpdated = 0;
  let wordsReplaced = 0;
  let metadataFieldsSanitized = 0;
  let mediaFilesRemoved = 0;

  if (options.stripMedia) {
    for (const [zipPath, zipFile] of Object.entries(zip.files)) {
      if (!zipFile.dir && zipPath.toLowerCase().startsWith('word/media/')) {
        zip.remove(zipPath);
        mediaFilesRemoved += 1;
      }
    }
  }

  for (const [zipPath, zipFile] of Object.entries(zip.files)) {
    const lower = zipPath.toLowerCase();
    const isXml = lower.endsWith('.xml');
    const isWordRels = /^word\/_rels\/.+\.rels$/.test(lower);

    if (zipFile.dir || (!isXml && !(options.stripMedia && isWordRels))) {
      continue;
    }

    const xml = await zipFile.async('text');
    let updatedXml = xml;
    let changed = false;

    if (isXml && shouldProcessXmlPart(zipPath, options.allXml)) {
      const result = loremifyXml(updatedXml, generator);
      updatedXml = result.xml;
      wordsReplaced += result.replacedWords;
      changed = changed || result.xml !== xml;
    }

    if (isXml) {
      const metadataResult = sanitizeMetadataXml(zipPath, updatedXml);
      if (metadataResult.sanitizedFields > 0) {
        updatedXml = metadataResult.xml;
        metadataFieldsSanitized += metadataResult.sanitizedFields;
        changed = true;
      }
    }

    if (options.stripMedia) {
      if (lower.startsWith('word/') && lower.endsWith('.xml')) {
        const withoutMarkup = stripMediaMarkupFromWordXml(updatedXml);
        if (withoutMarkup !== updatedXml) {
          updatedXml = withoutMarkup;
          changed = true;
        }
      }

      if (/^word\/_rels\/.+\.rels$/.test(lower)) {
        const withoutMediaRelationships = stripMediaReferencesFromRels(updatedXml);
        if (withoutMediaRelationships !== updatedXml) {
          updatedXml = withoutMediaRelationships;
          changed = true;
        }
      }
    }

    if (changed) {
      xmlFilesUpdated += 1;
      zip.file(zipPath, updatedXml, {
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      });
    }
  }

  const output = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  return {
    output,
    stats: { xmlFilesUpdated, wordsReplaced, mediaFilesRemoved, metadataFieldsSanitized },
  };
}

function shouldProcessXmlPart(zipPath: string, allXml: boolean): boolean {
  if (allXml) {
    return true;
  }

  const lower = zipPath.toLowerCase();
  if (lower === 'word/document.xml') return true;
  if (lower === 'word/footnotes.xml') return true;
  if (lower === 'word/endnotes.xml') return true;
  if (lower === 'word/comments.xml') return true;
  if (lower === 'word/commentsextensible.xml') return true;
  if (lower === 'word/commentsextended.xml') return true;

  if (/^word\/header\d+\.xml$/.test(lower)) return true;
  if (/^word\/footer\d+\.xml$/.test(lower)) return true;

  return false;
}

async function processFile(inputPath: string, options: CliOptions): Promise<void> {
  if (!inputPath.toLowerCase().endsWith('.docx')) {
    throw new Error(`Expected a .docx file: ${inputPath}`);
  }

  const outputPath = getOutputPath(inputPath, options);
  const source = await fs.readFile(inputPath);
  const result = await loremifyDocxBuffer(source, options);

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, result.output);

  console.log(
    [
      `Input: ${inputPath}`,
      `Output: ${outputPath}`,
      `Updated XML files: ${result.stats.xmlFilesUpdated}`,
      `Words replaced: ${result.stats.wordsReplaced}`,
      `Metadata fields sanitized: ${result.stats.metadataFieldsSanitized}`,
      `Media files removed: ${result.stats.mediaFilesRemoved}`,
      '',
    ].join('\n')
  );
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    console.log(HELP_TEXT);
    return;
  }

  if (options.inputs.length === 0) {
    throw new Error('At least one input .docx file is required. Use --help for usage.');
  }

  if (options.inPlace && options.outDir) {
    throw new Error('--in-place and --out-dir cannot be used together');
  }

  for (const inputPath of options.inputs) {
    await processFile(inputPath, options);
  }
}

if (import.meta.main) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    process.exit(1);
  });
}
