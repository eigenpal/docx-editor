/**
 * Real Document Change Strategy
 *
 * Applies targeted operations directly to DOCX package parts (ZIP entries)
 * so edits happen on the original document structure without model transpilation.
 *
 * Designed for precision workflows where AI emits explicit XML/text operations
 * and callers need strict validation of what changed.
 */

import type { DocxInput } from '../utils/docxInput';
import { type DocxXmlSaveOptions, openDocxXml } from './rawXmlEditor';
import {
  elementToXml,
  findChildrenByLocalName,
  getLocalName,
  parseXmlDocument,
  type XmlElement,
} from './xmlParser';

export type XmlReplaceOccurrence = 'first' | 'all';

const CONTENT_TYPES_PART = '[Content_Types].xml';
const RELATIONSHIPS_NAMESPACE = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CONTENT_TYPES_NAMESPACE = 'http://schemas.openxmlformats.org/package/2006/content-types';

export interface ReplaceXmlTextOperation {
  type: 'replace-xml-text';
  /** Target XML part path, e.g. "word/document.xml" */
  path: string;
  /** Exact string to find */
  find: string;
  /** Exact replacement string */
  replace: string;
  /** Replace strategy (default "first") */
  occurrence?: XmlReplaceOccurrence;
  /**
   * Expected number of replacements.
   * If provided and actual count differs, operation fails.
   */
  expectedReplacements?: number;
  /**
   * Allow 0 replacements for this operation even in strict mode.
   * Default false.
   */
  allowNoMatch?: boolean;
}

export interface SetXmlOperation {
  type: 'set-xml';
  path: string;
  xml: string;
}

export interface SetTextOperation {
  type: 'set-text';
  path: string;
  text: string;
}

export interface SetBinaryOperation {
  type: 'set-binary';
  path: string;
  bytes: ArrayBuffer | Uint8Array;
}

export interface RemovePartOperation {
  type: 'remove-part';
  path: string;
}

export interface UpsertRelationshipOperation {
  type: 'upsert-relationship';
  /** Source part owning the relationships file, e.g. "word/document.xml" */
  ownerPartPath: string;
  /** Relationship Id (e.g. "rId12") */
  id: string;
  /** Relationship type URI */
  relationshipType: string;
  /** Relationship target */
  target: string;
  /** Optional TargetMode (e.g. "External") */
  targetMode?: 'External';
  /** Optional explicit .rels part path override */
  relationshipsPartPath?: string;
}

export interface RemoveRelationshipOperation {
  type: 'remove-relationship';
  ownerPartPath: string;
  id: string;
  relationshipsPartPath?: string;
  /**
   * If true, do not fail when relationship does not exist.
   * Default false.
   */
  allowMissing?: boolean;
}

export interface EnsureContentTypeOverrideOperation {
  type: 'ensure-content-type-override';
  /** Part name with or without leading slash, e.g. "/word/header2.xml" */
  partName: string;
  contentType: string;
}

export interface RemoveContentTypeOverrideOperation {
  type: 'remove-content-type-override';
  partName: string;
  allowMissing?: boolean;
}

export interface EnsureContentTypeDefaultOperation {
  type: 'ensure-content-type-default';
  /** Extension with or without leading dot, e.g. "png" or ".png" */
  extension: string;
  contentType: string;
}

export interface RemoveContentTypeDefaultOperation {
  type: 'remove-content-type-default';
  extension: string;
  allowMissing?: boolean;
}

export type RealDocChangeOperation =
  | ReplaceXmlTextOperation
  | SetXmlOperation
  | SetTextOperation
  | SetBinaryOperation
  | RemovePartOperation
  | UpsertRelationshipOperation
  | RemoveRelationshipOperation
  | EnsureContentTypeOverrideOperation
  | RemoveContentTypeOverrideOperation
  | EnsureContentTypeDefaultOperation
  | RemoveContentTypeDefaultOperation;

export interface ApplyRealDocChangesOptions extends DocxXmlSaveOptions {
  /**
   * Strict mode (default true):
   * - missing parts fail
   * - no-match replacements fail unless allowNoMatch=true
   * - expectedReplacements mismatches fail
   */
  strict?: boolean;
}

export interface RealDocChangeReportItem {
  index: number;
  type: RealDocChangeOperation['type'];
  path: string;
  replacements?: number;
}

export interface ApplyRealDocChangesResult {
  buffer: ArrayBuffer;
  modifiedParts: string[];
  report: RealDocChangeReportItem[];
}

function countOccurrences(text: string, search: string): number {
  if (search.length === 0) return 0;
  let count = 0;
  let start = 0;
  while (true) {
    const index = text.indexOf(search, start);
    if (index === -1) return count;
    count += 1;
    start = index + search.length;
  }
}

function replaceFirst(
  text: string,
  search: string,
  replacement: string
): { output: string; count: number } {
  const index = text.indexOf(search);
  if (index === -1) {
    return { output: text, count: 0 };
  }
  const output = text.slice(0, index) + replacement + text.slice(index + search.length);
  return { output, count: 1 };
}

function replaceAllExact(
  text: string,
  search: string,
  replacement: string
): { output: string; count: number } {
  const count = countOccurrences(text, search);
  if (count === 0) {
    return { output: text, count: 0 };
  }
  return {
    output: text.split(search).join(replacement),
    count,
  };
}

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function normalizePartPath(path: string): string {
  return path.replace(/^\/+/, '');
}

function normalizePartName(partName: string): string {
  const normalized = partName.replace(/\\/g, '/').replace(/^\/+/, '');
  return `/${normalized}`;
}

function normalizeExtension(extension: string): string {
  return extension.replace(/^\./, '').toLowerCase();
}

function getXmlDeclaration(xml: string | null): string {
  if (!xml) {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  }
  const match = xml.match(/^\s*<\?xml[^>]*\?>/);
  return match?.[0] ?? '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
}

function serializeRootXml(root: XmlElement, originalXml: string | null): string {
  return `${getXmlDeclaration(originalXml)}\n${elementToXml(root)}`;
}

function getAttributes(element: XmlElement): Record<string, string> {
  if (!element.attributes) {
    element.attributes = {};
  }
  return element.attributes as Record<string, string>;
}

function getRelationshipsPartPath(ownerPartPath: string): string {
  const normalized = normalizePartPath(ownerPartPath);
  const slash = normalized.lastIndexOf('/');
  const directory = slash === -1 ? '' : normalized.slice(0, slash);
  const filename = slash === -1 ? normalized : normalized.slice(slash + 1);
  if (directory.length === 0) {
    return `_rels/${filename}.rels`;
  }
  return `${directory}/_rels/${filename}.rels`;
}

function createRelationshipsRoot(): XmlElement {
  return {
    type: 'element',
    name: 'Relationships',
    attributes: {
      xmlns: RELATIONSHIPS_NAMESPACE,
    },
    elements: [],
  };
}

function createContentTypesRoot(): XmlElement {
  return {
    type: 'element',
    name: 'Types',
    attributes: {
      xmlns: CONTENT_TYPES_NAMESPACE,
    },
    elements: [],
  };
}

function parseRootElement(xml: string, expectedLocalName: string, context: string): XmlElement {
  const root = parseXmlDocument(xml);
  assertCondition(root, `${context}: failed to parse XML`);
  assertCondition(
    getLocalName(root.name ?? '') === expectedLocalName,
    `${context}: expected root <${expectedLocalName}>`
  );
  return root;
}

async function loadRelationshipsRoot(
  getXml: (path: string) => Promise<string>,
  hasPart: (path: string) => boolean,
  relsPath: string
): Promise<{ root: XmlElement; originalXml: string | null }> {
  if (!hasPart(relsPath)) {
    return { root: createRelationshipsRoot(), originalXml: null };
  }

  const xml = await getXml(relsPath);
  return {
    root: parseRootElement(xml, 'Relationships', `Relationships part ${relsPath}`),
    originalXml: xml,
  };
}

async function loadContentTypesRoot(
  getXml: (path: string) => Promise<string>,
  hasPart: (path: string) => boolean
): Promise<{ root: XmlElement; originalXml: string | null }> {
  if (!hasPart(CONTENT_TYPES_PART)) {
    return { root: createContentTypesRoot(), originalXml: null };
  }

  const xml = await getXml(CONTENT_TYPES_PART);
  return {
    root: parseRootElement(xml, 'Types', `${CONTENT_TYPES_PART}`),
    originalXml: xml,
  };
}

/**
 * Apply a precise, validated change plan directly to OOXML package parts.
 */
export async function applyRealDocChanges(
  input: DocxInput,
  operations: RealDocChangeOperation[],
  options: ApplyRealDocChangesOptions = {}
): Promise<ApplyRealDocChangesResult> {
  const { strict = true, compressionLevel = 6 } = options;
  const editor = await openDocxXml(input);
  const report: RealDocChangeReportItem[] = [];

  for (let i = 0; i < operations.length; i++) {
    const operation = operations[i];

    if (operation.type === 'set-xml') {
      editor.setXml(operation.path, operation.xml);
      report.push({ index: i, type: operation.type, path: operation.path });
      continue;
    }

    if (operation.type === 'set-text') {
      editor.setText(operation.path, operation.text);
      report.push({ index: i, type: operation.type, path: operation.path });
      continue;
    }

    if (operation.type === 'set-binary') {
      editor.setBinary(operation.path, operation.bytes);
      report.push({ index: i, type: operation.type, path: operation.path });
      continue;
    }

    if (operation.type === 'remove-part') {
      if (strict) {
        assertCondition(
          editor.hasPart(operation.path),
          `Operation ${i}: target part not found: ${operation.path}`
        );
      }
      editor.removePart(operation.path);
      report.push({ index: i, type: operation.type, path: operation.path });
      continue;
    }

    if (operation.type === 'upsert-relationship') {
      const relsPath = normalizePartPath(
        operation.relationshipsPartPath ?? getRelationshipsPartPath(operation.ownerPartPath)
      );
      const { root, originalXml } = await loadRelationshipsRoot(
        (path) => editor.getXml(path),
        (path) => editor.hasPart(path),
        relsPath
      );
      const relationships = findChildrenByLocalName(root, 'Relationship');
      let relationship = relationships.find((entry) => getAttributes(entry).Id === operation.id);

      if (!relationship) {
        relationship = {
          type: 'element',
          name: 'Relationship',
          attributes: {},
        };
        if (!root.elements) {
          root.elements = [];
        }
        root.elements.push(relationship);
      }

      const attrs = getAttributes(relationship);
      attrs.Id = operation.id;
      attrs.Type = operation.relationshipType;
      attrs.Target = operation.target;
      if (operation.targetMode) {
        attrs.TargetMode = operation.targetMode;
      } else {
        delete attrs.TargetMode;
      }

      editor.setXml(relsPath, serializeRootXml(root, originalXml));
      report.push({ index: i, type: operation.type, path: relsPath });
      continue;
    }

    if (operation.type === 'remove-relationship') {
      const relsPath = normalizePartPath(
        operation.relationshipsPartPath ?? getRelationshipsPartPath(operation.ownerPartPath)
      );
      if (!editor.hasPart(relsPath)) {
        if (strict && !operation.allowMissing) {
          throw new Error(`Operation ${i}: relationships part not found: ${relsPath}`);
        }
        report.push({ index: i, type: operation.type, path: relsPath });
        continue;
      }

      const originalXml = await editor.getXml(relsPath);
      const root = parseRootElement(originalXml, 'Relationships', `Relationships part ${relsPath}`);
      const children = root.elements ?? [];
      let removed = 0;
      root.elements = children.filter((entry) => {
        if (entry.type !== 'element' || getLocalName(entry.name ?? '') !== 'Relationship') {
          return true;
        }
        const attrs = getAttributes(entry);
        if (attrs.Id === operation.id) {
          removed += 1;
          return false;
        }
        return true;
      });

      if (strict && !operation.allowMissing) {
        assertCondition(
          removed > 0,
          `Operation ${i}: relationship ${operation.id} not found in ${relsPath}`
        );
      }

      if (removed > 0) {
        editor.setXml(relsPath, serializeRootXml(root, originalXml));
      }
      report.push({ index: i, type: operation.type, path: relsPath, replacements: removed });
      continue;
    }

    if (operation.type === 'ensure-content-type-override') {
      const normalizedPartName = normalizePartName(operation.partName);
      const { root, originalXml } = await loadContentTypesRoot(
        (path) => editor.getXml(path),
        (path) => editor.hasPart(path)
      );
      const overrides = findChildrenByLocalName(root, 'Override');
      const existing = overrides.find(
        (entry) => getAttributes(entry).PartName === normalizedPartName
      );

      if (existing) {
        const attrs = getAttributes(existing);
        attrs.PartName = normalizedPartName;
        attrs.ContentType = operation.contentType;
      } else {
        if (!root.elements) {
          root.elements = [];
        }
        root.elements.push({
          type: 'element',
          name: 'Override',
          attributes: {
            PartName: normalizedPartName,
            ContentType: operation.contentType,
          },
        });
      }

      editor.setXml(CONTENT_TYPES_PART, serializeRootXml(root, originalXml));
      report.push({ index: i, type: operation.type, path: CONTENT_TYPES_PART });
      continue;
    }

    if (operation.type === 'remove-content-type-override') {
      const normalizedPartName = normalizePartName(operation.partName);
      if (!editor.hasPart(CONTENT_TYPES_PART)) {
        if (strict && !operation.allowMissing) {
          throw new Error(`Operation ${i}: content types part not found: ${CONTENT_TYPES_PART}`);
        }
        report.push({ index: i, type: operation.type, path: CONTENT_TYPES_PART });
        continue;
      }

      const originalXml = await editor.getXml(CONTENT_TYPES_PART);
      const root = parseRootElement(originalXml, 'Types', CONTENT_TYPES_PART);
      const children = root.elements ?? [];
      let removed = 0;
      root.elements = children.filter((entry) => {
        if (entry.type !== 'element' || getLocalName(entry.name ?? '') !== 'Override') {
          return true;
        }
        const attrs = getAttributes(entry);
        if (attrs.PartName === normalizedPartName) {
          removed += 1;
          return false;
        }
        return true;
      });

      if (strict && !operation.allowMissing) {
        assertCondition(
          removed > 0,
          `Operation ${i}: content-type override not found for ${normalizedPartName}`
        );
      }

      if (removed > 0) {
        editor.setXml(CONTENT_TYPES_PART, serializeRootXml(root, originalXml));
      }
      report.push({
        index: i,
        type: operation.type,
        path: CONTENT_TYPES_PART,
        replacements: removed,
      });
      continue;
    }

    if (operation.type === 'ensure-content-type-default') {
      const extension = normalizeExtension(operation.extension);
      const { root, originalXml } = await loadContentTypesRoot(
        (path) => editor.getXml(path),
        (path) => editor.hasPart(path)
      );
      const defaults = findChildrenByLocalName(root, 'Default');
      const existing = defaults.find(
        (entry) => normalizeExtension(getAttributes(entry).Extension ?? '') === extension
      );

      if (existing) {
        const attrs = getAttributes(existing);
        attrs.Extension = extension;
        attrs.ContentType = operation.contentType;
      } else {
        if (!root.elements) {
          root.elements = [];
        }
        root.elements.push({
          type: 'element',
          name: 'Default',
          attributes: {
            Extension: extension,
            ContentType: operation.contentType,
          },
        });
      }

      editor.setXml(CONTENT_TYPES_PART, serializeRootXml(root, originalXml));
      report.push({ index: i, type: operation.type, path: CONTENT_TYPES_PART });
      continue;
    }

    if (operation.type === 'remove-content-type-default') {
      const extension = normalizeExtension(operation.extension);
      if (!editor.hasPart(CONTENT_TYPES_PART)) {
        if (strict && !operation.allowMissing) {
          throw new Error(`Operation ${i}: content types part not found: ${CONTENT_TYPES_PART}`);
        }
        report.push({ index: i, type: operation.type, path: CONTENT_TYPES_PART });
        continue;
      }

      const originalXml = await editor.getXml(CONTENT_TYPES_PART);
      const root = parseRootElement(originalXml, 'Types', CONTENT_TYPES_PART);
      const children = root.elements ?? [];
      let removed = 0;
      root.elements = children.filter((entry) => {
        if (entry.type !== 'element' || getLocalName(entry.name ?? '') !== 'Default') {
          return true;
        }
        const attrs = getAttributes(entry);
        if (normalizeExtension(attrs.Extension ?? '') === extension) {
          removed += 1;
          return false;
        }
        return true;
      });

      if (strict && !operation.allowMissing) {
        assertCondition(
          removed > 0,
          `Operation ${i}: content-type default not found for .${extension}`
        );
      }

      if (removed > 0) {
        editor.setXml(CONTENT_TYPES_PART, serializeRootXml(root, originalXml));
      }
      report.push({
        index: i,
        type: operation.type,
        path: CONTENT_TYPES_PART,
        replacements: removed,
      });
      continue;
    }

    assertCondition(operation.find.length > 0, `Operation ${i}: find must not be empty`);

    if (strict) {
      assertCondition(
        editor.hasPart(operation.path),
        `Operation ${i}: target part not found: ${operation.path}`
      );
    } else if (!editor.hasPart(operation.path)) {
      report.push({
        index: i,
        type: operation.type,
        path: operation.path,
        replacements: 0,
      });
      continue;
    }

    const xml = await editor.getXml(operation.path);
    const occurrence = operation.occurrence ?? 'first';
    const result =
      occurrence === 'all'
        ? replaceAllExact(xml, operation.find, operation.replace)
        : replaceFirst(xml, operation.find, operation.replace);

    if (operation.expectedReplacements !== undefined) {
      assertCondition(
        result.count === operation.expectedReplacements,
        `Operation ${i}: expected ${operation.expectedReplacements} replacements in ${operation.path}, got ${result.count}`
      );
    }

    if (strict && !operation.allowNoMatch) {
      assertCondition(result.count > 0, `Operation ${i}: no matches found in ${operation.path}`);
    }

    if (result.count > 0) {
      editor.setXml(operation.path, result.output);
    }

    report.push({
      index: i,
      type: operation.type,
      path: operation.path,
      replacements: result.count,
    });
  }

  const buffer = await editor.toBuffer({ compressionLevel });
  return {
    buffer,
    modifiedParts: editor.getModifiedParts(),
    report,
  };
}
