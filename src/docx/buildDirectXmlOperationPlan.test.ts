import { describe, expect, test } from 'bun:test';
import JSZip from 'jszip';
import type {
  Document,
  Endnote,
  Footnote,
  HeaderFooter,
  Paragraph,
  Relationship,
  RelationshipMap,
  SectionProperties,
} from '../types/document';
import { openDocxXml } from './rawXmlEditor';
import { applyRealDocChanges } from './realDocumentChangeStrategy';
import { buildDirectXmlOperationPlan } from './buildDirectXmlOperationPlan';
import { parseRelationships, resolveRelativePath } from './relsParser';
import { serializeDocument } from './serializer/documentSerializer';

const REL_TYPE_HEADER =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header';
const REL_TYPE_FOOTER =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer';
const REL_TYPE_FOOTNOTES =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes';
const REL_TYPE_ENDNOTES =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/endnotes';
const CONTENT_TYPE_HEADER =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml';
const CONTENT_TYPE_FOOTER =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml';
const CONTENT_TYPE_FOOTNOTES =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml';
const CONTENT_TYPE_ENDNOTES =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml';
const CONTENT_TYPE_DOCUMENT =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
const REL_TYPE_OFFICE_DOCUMENT =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function createParagraph(text: string, paraId?: string): Paragraph {
  return {
    type: 'paragraph',
    paraId,
    content: [
      {
        type: 'run',
        content: [{ type: 'text', text }],
      },
    ],
  };
}

function createHeader(text: string): HeaderFooter {
  return {
    type: 'header',
    hdrFtrType: 'default',
    content: [createParagraph(text)],
  };
}

function createFooter(text: string): HeaderFooter {
  return {
    type: 'footer',
    hdrFtrType: 'default',
    content: [createParagraph(text)],
  };
}

function createRelationshipMap(entries: Array<[string, Relationship]>): RelationshipMap {
  return new Map<string, Relationship>(entries);
}

function createDocument(params: {
  bodyText: string;
  bodyParagraphs?: Paragraph[];
  finalSectionProperties?: SectionProperties;
  headers?: Map<string, HeaderFooter>;
  footers?: Map<string, HeaderFooter>;
  footnotes?: Footnote[];
  endnotes?: Endnote[];
  relationships?: RelationshipMap;
}): Document {
  return {
    package: {
      document: {
        content: params.bodyParagraphs ?? [createParagraph(params.bodyText)],
        finalSectionProperties: params.finalSectionProperties,
      },
      headers: params.headers,
      footers: params.footers,
      footnotes: params.footnotes,
      endnotes: params.endnotes,
      relationships: params.relationships,
    },
  };
}

async function createDocxBufferWithDocumentXml(documentXml: string): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file('word/document.xml', documentXml);
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
}

async function createDocxBufferWithParts(parts: Record<string, string>): Promise<ArrayBuffer> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(parts)) {
    zip.file(path, content);
  }
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' });
}

function createContentTypesXml(
  overrides: Array<{ partName: string; contentType: string }>
): string {
  const byPartName = new Map<string, string>();
  for (const override of overrides) {
    byPartName.set(override.partName, override.contentType);
  }
  const overrideXml = [...byPartName.entries()]
    .map(
      ([partName, contentType]) => `<Override PartName="${partName}" ContentType="${contentType}"/>`
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
${overrideXml}
</Types>`;
}

async function createMinimalMainDocxBuffer(args: {
  documentXml: string;
  documentRelsXml?: string;
  contentTypeOverrides?: Array<{ partName: string; contentType: string }>;
  extraParts?: Record<string, string>;
}): Promise<ArrayBuffer> {
  const overrides = [
    {
      partName: '/word/document.xml',
      contentType: CONTENT_TYPE_DOCUMENT,
    },
    ...(args.contentTypeOverrides ?? []),
  ];
  return createDocxBufferWithParts({
    '[Content_Types].xml': createContentTypesXml(overrides),
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="${REL_TYPE_OFFICE_DOCUMENT}" Target="word/document.xml"/>
</Relationships>`,
    'word/document.xml': args.documentXml,
    ...(args.documentRelsXml ? { 'word/_rels/document.xml.rels': args.documentRelsXml } : {}),
    ...(args.extraParts ?? {}),
  });
}

function findDuplicateValues(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
      continue;
    }
    seen.add(value);
  }
  return [...duplicates].sort();
}

async function assertDocxPackageIntegrity(buffer: ArrayBuffer): Promise<void> {
  const zip = await JSZip.loadAsync(buffer);
  const partPaths = new Set(
    Object.values(zip.files)
      .filter((entry) => !entry.dir)
      .map((entry) => entry.name)
  );

  const contentTypesFile = zip.file('[Content_Types].xml');
  expect(contentTypesFile).toBeDefined();
  if (!contentTypesFile) return;
  const contentTypesXml = await contentTypesFile.async('text');
  const overridePartNames = [
    ...contentTypesXml.matchAll(/<Override\b[^>]*\bPartName=(["'])(.*?)\1[^>]*\/?>/g),
  ].map((match) => match[2]);
  expect(findDuplicateValues(overridePartNames)).toEqual([]);
  for (const partName of overridePartNames) {
    expect(partPaths.has(partName.replace(/^\/+/, ''))).toBe(true);
  }

  const relsPaths = [...partPaths].filter((path) => path.endsWith('.rels')).sort();
  for (const relsPath of relsPaths) {
    const relsFile = zip.file(relsPath);
    expect(relsFile).toBeDefined();
    if (!relsFile) continue;
    const relsXml = await relsFile.async('text');
    const relationshipIds = [
      ...relsXml.matchAll(/<Relationship\b[^>]*\bId=(["'])(.*?)\1[^>]*\/?>/g),
    ].map((match) => match[2]);
    expect(findDuplicateValues(relationshipIds)).toEqual([]);

    const relationships = parseRelationships(relsXml);
    for (const relationship of relationships.values()) {
      if (relationship.targetMode === 'External') continue;
      const targetPath = resolveRelativePath(relsPath, relationship.target);
      expect(partPaths.has(targetPath)).toBe(true);
    }
  }
}

describe('buildDirectXmlOperationPlan', () => {
  test('emits set-xml for changed footnotes.xml', async () => {
    const relationships = createRelationshipMap([
      [
        'rIdFootnotes',
        {
          id: 'rIdFootnotes',
          type: REL_TYPE_FOOTNOTES,
          target: 'footnotes.xml',
        },
      ],
    ]);

    const baseline = createDocument({
      bodyText: 'Body',
      relationships,
      footnotes: [
        {
          type: 'footnote',
          id: 1,
          content: [createParagraph('Old note')],
        },
      ],
    });
    const current = createDocument({
      bodyText: 'Body',
      relationships,
      footnotes: [
        {
          type: 'footnote',
          id: 1,
          content: [createParagraph('New note')],
        },
      ],
    });

    const operations = await buildDirectXmlOperationPlan({
      currentDocument: current,
      baselineDocument: baseline,
    });
    const footnotesOp = operations.find(
      (operation) => operation.type === 'set-xml' && operation.path === 'word/footnotes.xml'
    );
    expect(footnotesOp).toBeDefined();
    if (!footnotesOp || footnotesOp.type !== 'set-xml') return;
    expect(footnotesOp.xml).toContain('New note');
  });

  test('emits relationship + content-type operations when footnotes are introduced', async () => {
    const baseline = createDocument({
      bodyText: 'Body',
      relationships: new Map(),
      footnotes: [],
    });
    const current = createDocument({
      bodyText: 'Body',
      relationships: createRelationshipMap([
        [
          'rIdFootnotes',
          {
            id: 'rIdFootnotes',
            type: REL_TYPE_FOOTNOTES,
            target: 'footnotes.xml',
          },
        ],
      ]),
      footnotes: [
        {
          type: 'footnote',
          id: 1,
          content: [createParagraph('First note')],
        },
      ],
    });

    const operations = await buildDirectXmlOperationPlan({
      currentDocument: current,
      baselineDocument: baseline,
    });

    expect(
      operations.some(
        (operation) =>
          operation.type === 'upsert-relationship' &&
          operation.ownerPartPath === 'word/document.xml' &&
          operation.id === 'rIdFootnotes' &&
          operation.relationshipType === REL_TYPE_FOOTNOTES &&
          operation.target === 'footnotes.xml'
      )
    ).toBe(true);
    expect(
      operations.some(
        (operation) =>
          operation.type === 'ensure-content-type-override' &&
          operation.partName === '/word/footnotes.xml' &&
          operation.contentType === CONTENT_TYPE_FOOTNOTES
      )
    ).toBe(true);
    expect(
      operations.some(
        (operation) => operation.type === 'set-xml' && operation.path === 'word/footnotes.xml'
      )
    ).toBe(true);
  });

  test('emits relationship + content-type operations when endnotes are introduced', async () => {
    const baseline = createDocument({
      bodyText: 'Body',
      relationships: new Map(),
      endnotes: [],
    });
    const current = createDocument({
      bodyText: 'Body',
      relationships: createRelationshipMap([
        [
          'rIdEndnotes',
          {
            id: 'rIdEndnotes',
            type: REL_TYPE_ENDNOTES,
            target: 'endnotes.xml',
          },
        ],
      ]),
      endnotes: [
        {
          type: 'endnote',
          id: 2,
          content: [createParagraph('First endnote')],
        },
      ],
    });

    const operations = await buildDirectXmlOperationPlan({
      currentDocument: current,
      baselineDocument: baseline,
    });

    expect(
      operations.some(
        (operation) =>
          operation.type === 'upsert-relationship' &&
          operation.ownerPartPath === 'word/document.xml' &&
          operation.id === 'rIdEndnotes' &&
          operation.relationshipType === REL_TYPE_ENDNOTES &&
          operation.target === 'endnotes.xml'
      )
    ).toBe(true);
    expect(
      operations.some(
        (operation) =>
          operation.type === 'ensure-content-type-override' &&
          operation.partName === '/word/endnotes.xml' &&
          operation.contentType === CONTENT_TYPE_ENDNOTES
      )
    ).toBe(true);
    expect(
      operations.some(
        (operation) => operation.type === 'set-xml' && operation.path === 'word/endnotes.xml'
      )
    ).toBe(true);
  });

  test('emits set-xml for footnotes when baseline relationship is external', async () => {
    const baseline = createDocument({
      bodyText: 'Body',
      relationships: createRelationshipMap([
        [
          'rIdFootnotes',
          {
            id: 'rIdFootnotes',
            type: REL_TYPE_FOOTNOTES,
            target: 'https://example.com/footnotes.xml',
            targetMode: 'External',
          },
        ],
      ]),
      footnotes: [],
    });
    const current = createDocument({
      bodyText: 'Body',
      relationships: createRelationshipMap([
        [
          'rIdFootnotes',
          {
            id: 'rIdFootnotes',
            type: REL_TYPE_FOOTNOTES,
            target: 'footnotes.xml',
          },
        ],
      ]),
      footnotes: [
        {
          type: 'footnote',
          id: 1,
          content: [createParagraph('External rel migrated note')],
        },
      ],
    });

    const operations = await buildDirectXmlOperationPlan({
      currentDocument: current,
      baselineDocument: baseline,
    });

    expect(
      operations.some(
        (operation) =>
          operation.type === 'upsert-relationship' &&
          operation.ownerPartPath === 'word/document.xml' &&
          operation.id === 'rIdFootnotes' &&
          operation.relationshipType === REL_TYPE_FOOTNOTES &&
          operation.target === 'footnotes.xml'
      )
    ).toBe(true);
    expect(
      operations.some(
        (operation) =>
          operation.type === 'ensure-content-type-override' &&
          operation.partName === '/word/footnotes.xml' &&
          operation.contentType === CONTENT_TYPE_FOOTNOTES
      )
    ).toBe(true);
    expect(
      operations.some(
        (operation) => operation.type === 'set-xml' && operation.path === 'word/footnotes.xml'
      )
    ).toBe(true);
  });

  test('emits set-xml for endnotes when baseline relationship is external', async () => {
    const baseline = createDocument({
      bodyText: 'Body',
      relationships: createRelationshipMap([
        [
          'rIdEndnotes',
          {
            id: 'rIdEndnotes',
            type: REL_TYPE_ENDNOTES,
            target: 'https://example.com/endnotes.xml',
            targetMode: 'External',
          },
        ],
      ]),
      endnotes: [],
    });
    const current = createDocument({
      bodyText: 'Body',
      relationships: createRelationshipMap([
        [
          'rIdEndnotes',
          {
            id: 'rIdEndnotes',
            type: REL_TYPE_ENDNOTES,
            target: 'endnotes.xml',
          },
        ],
      ]),
      endnotes: [
        {
          type: 'endnote',
          id: 1,
          content: [createParagraph('External rel migrated endnote')],
        },
      ],
    });

    const operations = await buildDirectXmlOperationPlan({
      currentDocument: current,
      baselineDocument: baseline,
    });

    expect(
      operations.some(
        (operation) =>
          operation.type === 'upsert-relationship' &&
          operation.ownerPartPath === 'word/document.xml' &&
          operation.id === 'rIdEndnotes' &&
          operation.relationshipType === REL_TYPE_ENDNOTES &&
          operation.target === 'endnotes.xml'
      )
    ).toBe(true);
    expect(
      operations.some(
        (operation) =>
          operation.type === 'ensure-content-type-override' &&
          operation.partName === '/word/endnotes.xml' &&
          operation.contentType === CONTENT_TYPE_ENDNOTES
      )
    ).toBe(true);
    expect(
      operations.some(
        (operation) => operation.type === 'set-xml' && operation.path === 'word/endnotes.xml'
      )
    ).toBe(true);
  });

  test('emits header relationship + content-type operations when relationship maps are undefined', async () => {
    const baseline = createDocument({
      bodyText: 'Body',
      headers: new Map(),
      finalSectionProperties: {},
    });
    const current = createDocument({
      bodyText: 'Body',
      headers: new Map([['rId_new_header', createHeader('New header')]]),
      finalSectionProperties: {
        headerReferences: [{ type: 'default', rId: 'rId_new_header' }],
      },
    });

    const operations = await buildDirectXmlOperationPlan({
      currentDocument: current,
      baselineDocument: baseline,
    });

    const headerUpsert = operations.find(
      (operation) =>
        operation.type === 'upsert-relationship' &&
        operation.ownerPartPath === 'word/document.xml' &&
        operation.id === 'rId_new_header' &&
        operation.relationshipType === REL_TYPE_HEADER
    );
    expect(headerUpsert).toBeDefined();
    if (!headerUpsert || headerUpsert.type !== 'upsert-relationship') return;

    expect(headerUpsert.target).toMatch(/^header\d+\.xml$/);
    const headerPartPath = `word/${headerUpsert.target}`;
    expect(
      operations.some(
        (operation) =>
          operation.type === 'ensure-content-type-override' &&
          operation.partName === `/${headerPartPath}` &&
          operation.contentType === CONTENT_TYPE_HEADER
      )
    ).toBe(true);
    expect(
      operations.some(
        (operation) => operation.type === 'set-xml' && operation.path === headerPartPath
      )
    ).toBe(true);
  });

  test('emits notes relationship + content-type operations when relationship maps are undefined', async () => {
    const baseline = createDocument({
      bodyText: 'Body',
      footnotes: [],
    });
    const current = createDocument({
      bodyText: 'Body',
      footnotes: [
        {
          type: 'footnote',
          id: 1,
          content: [createParagraph('First note')],
        },
      ],
    });

    const operations = await buildDirectXmlOperationPlan({
      currentDocument: current,
      baselineDocument: baseline,
    });

    expect(
      operations.some(
        (operation) =>
          operation.type === 'upsert-relationship' &&
          operation.ownerPartPath === 'word/document.xml' &&
          operation.id === 'rIdFootnotes' &&
          operation.relationshipType === REL_TYPE_FOOTNOTES &&
          operation.target === 'footnotes.xml'
      )
    ).toBe(true);
    expect(
      operations.some(
        (operation) =>
          operation.type === 'ensure-content-type-override' &&
          operation.partName === '/word/footnotes.xml' &&
          operation.contentType === CONTENT_TYPE_FOOTNOTES
      )
    ).toBe(true);
    expect(
      operations.some(
        (operation) => operation.type === 'set-xml' && operation.path === 'word/footnotes.xml'
      )
    ).toBe(true);
  });

  test('preserves separator/continuation note XML when normal footnote is edited', async () => {
    const relationships = createRelationshipMap([
      [
        'rIdFootnotes',
        {
          id: 'rIdFootnotes',
          type: REL_TYPE_FOOTNOTES,
          target: 'footnotes.xml',
        },
      ],
    ]);
    const baselineFootnotesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:t>SEP-MARKER</w:t></w:r></w:p><w:customSep data-x="1"/></w:footnote>
  <w:footnote w:id="1"><w:p><w:r><w:t>Old note</w:t></w:r></w:p></w:footnote>
  <w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:t>CONT-MARKER</w:t></w:r></w:p></w:footnote>
</w:footnotes>`;
    const baselineBuffer = await createDocxBufferWithParts({
      'word/footnotes.xml': baselineFootnotesXml,
    });

    const baseline = createDocument({
      bodyText: 'Body',
      relationships,
      footnotes: [
        {
          type: 'footnote',
          id: 1,
          content: [createParagraph('Old note')],
        },
      ],
    });
    const current = createDocument({
      bodyText: 'Body',
      relationships,
      footnotes: [
        {
          type: 'footnote',
          id: 1,
          content: [createParagraph('New note')],
        },
      ],
    });

    const operations = await buildDirectXmlOperationPlan({
      currentDocument: current,
      baselineDocument: baseline,
      baselineBuffer,
    });

    const footnotesOp = operations.find(
      (operation) => operation.type === 'set-xml' && operation.path === 'word/footnotes.xml'
    );
    expect(footnotesOp).toBeDefined();
    if (!footnotesOp || footnotesOp.type !== 'set-xml') return;

    expect(footnotesOp.xml).toContain('New note');
    expect(footnotesOp.xml).not.toContain('Old note');
    expect(footnotesOp.xml).toContain('SEP-MARKER');
    expect(footnotesOp.xml).toContain('CONT-MARKER');
    expect(footnotesOp.xml).toContain('customSep');
  });

  test('emits relationship + content-type operations when a header is introduced without relationships metadata', async () => {
    const baseline = createDocument({
      bodyText: 'Body',
      relationships: new Map(),
      headers: new Map(),
      finalSectionProperties: {},
    });
    const current = createDocument({
      bodyText: 'Body',
      relationships: new Map(),
      headers: new Map([['rId_new_header', createHeader('New header')]]),
      finalSectionProperties: {
        headerReferences: [{ type: 'default', rId: 'rId_new_header' }],
      },
    });

    const operations = await buildDirectXmlOperationPlan({
      currentDocument: current,
      baselineDocument: baseline,
    });

    const headerUpsert = operations.find(
      (operation) =>
        operation.type === 'upsert-relationship' &&
        operation.ownerPartPath === 'word/document.xml' &&
        operation.id === 'rId_new_header' &&
        operation.relationshipType === REL_TYPE_HEADER
    );
    expect(headerUpsert).toBeDefined();
    if (!headerUpsert || headerUpsert.type !== 'upsert-relationship') return;

    expect(headerUpsert.target).toMatch(/^header\d+\.xml$/);
    const headerPartPath = `word/${headerUpsert.target}`;

    expect(
      operations.some(
        (operation) =>
          operation.type === 'ensure-content-type-override' &&
          operation.partName === `/${headerPartPath}` &&
          operation.contentType === CONTENT_TYPE_HEADER
      )
    ).toBe(true);
    expect(
      operations.some(
        (operation) => operation.type === 'set-xml' && operation.path === headerPartPath
      )
    ).toBe(true);
  });

  test('emits relationship + content-type operations when a footer is introduced without relationships metadata', async () => {
    const baseline = createDocument({
      bodyText: 'Body',
      relationships: new Map(),
      footers: new Map(),
      finalSectionProperties: {},
    });
    const current = createDocument({
      bodyText: 'Body',
      relationships: new Map(),
      footers: new Map([['rId_new_footer', createFooter('New footer')]]),
      finalSectionProperties: {
        footerReferences: [{ type: 'default', rId: 'rId_new_footer' }],
      },
    });

    const operations = await buildDirectXmlOperationPlan({
      currentDocument: current,
      baselineDocument: baseline,
    });

    const footerUpsert = operations.find(
      (operation) =>
        operation.type === 'upsert-relationship' &&
        operation.ownerPartPath === 'word/document.xml' &&
        operation.id === 'rId_new_footer' &&
        operation.relationshipType === REL_TYPE_FOOTER
    );
    expect(footerUpsert).toBeDefined();
    if (!footerUpsert || footerUpsert.type !== 'upsert-relationship') return;

    expect(footerUpsert.target).toMatch(/^footer\d+\.xml$/);
    const footerPartPath = `word/${footerUpsert.target}`;

    expect(
      operations.some(
        (operation) =>
          operation.type === 'ensure-content-type-override' &&
          operation.partName === `/${footerPartPath}` &&
          operation.contentType === CONTENT_TYPE_FOOTER
      )
    ).toBe(true);
    expect(
      operations.some(
        (operation) => operation.type === 'set-xml' && operation.path === footerPartPath
      )
    ).toBe(true);
  });

  test('emits removal operations when a header reference is deleted', async () => {
    const baselineRelationships = createRelationshipMap([
      [
        'rIdHdr1',
        {
          id: 'rIdHdr1',
          type: REL_TYPE_HEADER,
          target: 'header1.xml',
        },
      ],
    ]);

    const baseline = createDocument({
      bodyText: 'Body',
      relationships: baselineRelationships,
      headers: new Map([['rIdHdr1', createHeader('Header text')]]),
      finalSectionProperties: {
        headerReferences: [{ type: 'default', rId: 'rIdHdr1' }],
      },
    });
    const current = createDocument({
      bodyText: 'Body',
      relationships: new Map(),
      headers: new Map(),
      finalSectionProperties: {},
    });

    const operations = await buildDirectXmlOperationPlan({
      currentDocument: current,
      baselineDocument: baseline,
    });

    expect(
      operations.some(
        (operation) =>
          operation.type === 'remove-relationship' &&
          operation.ownerPartPath === 'word/document.xml' &&
          operation.id === 'rIdHdr1'
      )
    ).toBe(true);
    expect(
      operations.some(
        (operation) => operation.type === 'remove-part' && operation.path === 'word/header1.xml'
      )
    ).toBe(true);
    expect(
      operations.some(
        (operation) =>
          operation.type === 'remove-content-type-override' &&
          operation.partName === '/word/header1.xml'
      )
    ).toBe(true);
  });

  test('uses context baselineBuffer to avoid stale originalBuffer on repeated saves', async () => {
    const staleBaseline = createDocument({
      bodyText: '',
      bodyParagraphs: [
        createParagraph('Paragraph A v0', 'AAAA1111'),
        createParagraph('Paragraph B v0', 'BBBB2222'),
      ],
    });
    const baselineAfterFirstSave = createDocument({
      bodyText: '',
      bodyParagraphs: [
        createParagraph('Paragraph A v1', 'AAAA1111'),
        createParagraph('Paragraph B v0', 'BBBB2222'),
      ],
    });
    const currentAfterSecondSave = createDocument({
      bodyText: '',
      bodyParagraphs: [
        createParagraph('Paragraph A v1', 'AAAA1111'),
        createParagraph('Paragraph B v1', 'BBBB2222'),
      ],
    });

    const staleBuffer = await createDocxBufferWithDocumentXml(serializeDocument(staleBaseline));
    const freshBuffer = await createDocxBufferWithDocumentXml(
      serializeDocument(baselineAfterFirstSave)
    );
    baselineAfterFirstSave.originalBuffer = staleBuffer;

    const operations = await buildDirectXmlOperationPlan({
      currentDocument: currentAfterSecondSave,
      baselineDocument: baselineAfterFirstSave,
      baselineBuffer: freshBuffer,
      editedParagraphIds: ['BBBB2222'],
    });

    const documentXmlOp = operations.find(
      (operation) => operation.type === 'set-xml' && operation.path === 'word/document.xml'
    );
    expect(documentXmlOp).toBeDefined();
    if (!documentXmlOp || documentXmlOp.type !== 'set-xml') return;

    expect(documentXmlOp.xml).toContain('Paragraph A v1');
    expect(documentXmlOp.xml).not.toContain('Paragraph A v0');
    expect(documentXmlOp.xml).toContain('Paragraph B v1');
  });

  test('edit -> save -> undo -> save round-trips to original document.xml in direct XML mode', async () => {
    const baselineV0 = createDocument({
      bodyText: '',
      bodyParagraphs: [
        createParagraph('Paragraph A v0', 'AAAA1111'),
        createParagraph('Paragraph B v0', 'BBBB2222'),
      ],
    });
    const bufferV0 = await createDocxBufferWithDocumentXml(serializeDocument(baselineV0));
    baselineV0.originalBuffer = bufferV0;

    const currentV1 = createDocument({
      bodyText: '',
      bodyParagraphs: [
        createParagraph('Paragraph A v1', 'AAAA1111'),
        createParagraph('Paragraph B v0', 'BBBB2222'),
      ],
    });

    const planSave1 = await buildDirectXmlOperationPlan({
      currentDocument: currentV1,
      baselineDocument: baselineV0,
      baselineBuffer: bufferV0,
      editedParagraphIds: ['AAAA1111'],
    });

    const save1Result = await applyRealDocChanges(bufferV0, planSave1, { strict: true });

    const baselineAfterSave1 = createDocument({
      bodyText: '',
      bodyParagraphs: [
        createParagraph('Paragraph A v1', 'AAAA1111'),
        createParagraph('Paragraph B v0', 'BBBB2222'),
      ],
    });
    baselineAfterSave1.originalBuffer = save1Result.buffer;

    const currentAfterUndo = createDocument({
      bodyText: '',
      bodyParagraphs: [
        createParagraph('Paragraph A v0', 'AAAA1111'),
        createParagraph('Paragraph B v0', 'BBBB2222'),
      ],
    });

    const planSave2 = await buildDirectXmlOperationPlan({
      currentDocument: currentAfterUndo,
      baselineDocument: baselineAfterSave1,
      baselineBuffer: save1Result.buffer,
      editedParagraphIds: ['AAAA1111'],
    });

    const save2Result = await applyRealDocChanges(save1Result.buffer, planSave2, { strict: true });
    const originalXml = await (await openDocxXml(bufferV0)).getXml('word/document.xml');
    const finalXml = await (await openDocxXml(save2Result.buffer)).getXml('word/document.xml');

    expect(finalXml).toBe(originalXml);
  });

  test('relationship-less docs: mixed header/footer/footnote/endnote additions remain package-consistent', async () => {
    const baseline = createDocument({
      bodyText: '',
      bodyParagraphs: [createParagraph('Body v0', 'AAAA1111')],
      finalSectionProperties: {},
    });
    const baselineBuffer = await createMinimalMainDocxBuffer({
      documentXml: serializeDocument(baseline),
    });

    const current = createDocument({
      bodyText: '',
      bodyParagraphs: [createParagraph('Body v1', 'AAAA1111')],
      headers: new Map([['rIdHdrA', createHeader('Header A')]]),
      footers: new Map([['rIdFtrA', createFooter('Footer A')]]),
      footnotes: [
        {
          type: 'footnote',
          id: 1,
          content: [createParagraph('Footnote A')],
        },
      ],
      endnotes: [
        {
          type: 'endnote',
          id: 2,
          content: [createParagraph('Endnote A')],
        },
      ],
      finalSectionProperties: {
        headerReferences: [{ type: 'default', rId: 'rIdHdrA' }],
        footerReferences: [{ type: 'default', rId: 'rIdFtrA' }],
      },
    });

    const operations = await buildDirectXmlOperationPlan({
      currentDocument: current,
      baselineDocument: baseline,
      baselineBuffer,
      editedParagraphIds: ['AAAA1111'],
    });
    expect(operations.some((operation) => operation.type === 'upsert-relationship')).toBe(true);
    expect(
      operations.some(
        (operation) =>
          operation.type === 'ensure-content-type-override' &&
          operation.contentType === CONTENT_TYPE_HEADER
      )
    ).toBe(true);
    expect(
      operations.some(
        (operation) =>
          operation.type === 'ensure-content-type-override' &&
          operation.contentType === CONTENT_TYPE_FOOTER
      )
    ).toBe(true);
    expect(
      operations.some(
        (operation) =>
          operation.type === 'ensure-content-type-override' &&
          operation.contentType === CONTENT_TYPE_FOOTNOTES
      )
    ).toBe(true);
    expect(
      operations.some(
        (operation) =>
          operation.type === 'ensure-content-type-override' &&
          operation.contentType === CONTENT_TYPE_ENDNOTES
      )
    ).toBe(true);

    const result = await applyRealDocChanges(baselineBuffer, operations, { strict: true });
    await assertDocxPackageIntegrity(result.buffer);

    const editor = await openDocxXml(result.buffer);
    expect(editor.hasPart('word/header1.xml')).toBe(true);
    expect(editor.hasPart('word/footer1.xml')).toBe(true);
    expect(editor.hasPart('word/footnotes.xml')).toBe(true);
    expect(editor.hasPart('word/endnotes.xml')).toBe(true);
  });

  test('multi-save invariant: second mixed save keeps first-save body/note edits', async () => {
    const baselineV0 = createDocument({
      bodyText: '',
      bodyParagraphs: [createParagraph('Body v0', 'AAAA1111')],
      finalSectionProperties: {},
    });
    const bufferV0 = await createMinimalMainDocxBuffer({
      documentXml: serializeDocument(baselineV0),
    });

    const currentV1 = createDocument({
      bodyText: '',
      bodyParagraphs: [createParagraph('Body v1', 'AAAA1111')],
      headers: new Map([['rIdHdr1', createHeader('Header v1')]]),
      footnotes: [
        {
          type: 'footnote',
          id: 1,
          content: [createParagraph('Footnote v1')],
        },
      ],
      finalSectionProperties: {
        headerReferences: [{ type: 'default', rId: 'rIdHdr1' }],
      },
    });

    const planSave1 = await buildDirectXmlOperationPlan({
      currentDocument: currentV1,
      baselineDocument: baselineV0,
      baselineBuffer: bufferV0,
      editedParagraphIds: ['AAAA1111'],
    });
    const save1Result = await applyRealDocChanges(bufferV0, planSave1, { strict: true });

    const baselineAfterSave1 = createDocument({
      bodyText: '',
      bodyParagraphs: [createParagraph('Body v1', 'AAAA1111')],
      headers: new Map([['rIdHdr1', createHeader('Header v1')]]),
      footnotes: [
        {
          type: 'footnote',
          id: 1,
          content: [createParagraph('Footnote v1')],
        },
      ],
      finalSectionProperties: {
        headerReferences: [{ type: 'default', rId: 'rIdHdr1' }],
      },
    });

    const currentV2 = createDocument({
      bodyText: '',
      bodyParagraphs: [createParagraph('Body v1', 'AAAA1111')],
      headers: new Map([['rIdHdr1', createHeader('Header v2')]]),
      footnotes: [
        {
          type: 'footnote',
          id: 1,
          content: [createParagraph('Footnote v1')],
        },
      ],
      endnotes: [
        {
          type: 'endnote',
          id: 2,
          content: [createParagraph('Endnote v2')],
        },
      ],
      finalSectionProperties: {
        headerReferences: [{ type: 'default', rId: 'rIdHdr1' }],
      },
    });

    const planSave2 = await buildDirectXmlOperationPlan({
      currentDocument: currentV2,
      baselineDocument: baselineAfterSave1,
      baselineBuffer: save1Result.buffer,
    });
    const save2Result = await applyRealDocChanges(save1Result.buffer, planSave2, { strict: true });
    await assertDocxPackageIntegrity(save2Result.buffer);

    const editor = await openDocxXml(save2Result.buffer);
    const documentXml = await editor.getXml('word/document.xml');
    expect(documentXml).toContain('Body v1');
    expect(documentXml).not.toContain('Body v0');

    const documentRelsXml = await editor.getXml('word/_rels/document.xml.rels');
    const relationships = parseRelationships(documentRelsXml);
    const headerRelationship = [...relationships.values()].find(
      (rel) => rel.type === REL_TYPE_HEADER
    );
    const footnotesRelationship = [...relationships.values()].find(
      (rel) => rel.type === REL_TYPE_FOOTNOTES
    );
    const endnotesRelationship = [...relationships.values()].find(
      (rel) => rel.type === REL_TYPE_ENDNOTES
    );
    expect(headerRelationship).toBeDefined();
    expect(footnotesRelationship).toBeDefined();
    expect(endnotesRelationship).toBeDefined();
    if (!headerRelationship || !footnotesRelationship || !endnotesRelationship) return;

    const headerPath = resolveRelativePath(
      'word/_rels/document.xml.rels',
      headerRelationship.target
    );
    const footnotesPath = resolveRelativePath(
      'word/_rels/document.xml.rels',
      footnotesRelationship.target
    );
    const endnotesPath = resolveRelativePath(
      'word/_rels/document.xml.rels',
      endnotesRelationship.target
    );
    const headerXml = await editor.getXml(headerPath);
    const footnotesXml = await editor.getXml(footnotesPath);
    const endnotesXml = await editor.getXml(endnotesPath);
    expect(headerXml).toContain('Header v2');
    expect(footnotesXml).toContain('Footnote v1');
    expect(endnotesXml).toContain('Endnote v2');
  });

  test('remove header + add footer in one save keeps rels/content-types consistent', async () => {
    const baselineRelationships = createRelationshipMap([
      [
        'rIdHdr1',
        {
          id: 'rIdHdr1',
          type: REL_TYPE_HEADER,
          target: 'header1.xml',
        },
      ],
    ]);
    const baseline = createDocument({
      bodyText: 'Body',
      relationships: baselineRelationships,
      headers: new Map([['rIdHdr1', createHeader('Header v1')]]),
      finalSectionProperties: {
        headerReferences: [{ type: 'default', rId: 'rIdHdr1' }],
      },
    });
    const baselineBuffer = await createMinimalMainDocxBuffer({
      documentXml: serializeDocument(baseline),
      documentRelsXml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rIdHdr1" Type="${REL_TYPE_HEADER}" Target="header1.xml"/>
</Relationships>`,
      contentTypeOverrides: [{ partName: '/word/header1.xml', contentType: CONTENT_TYPE_HEADER }],
      extraParts: {
        'word/header1.xml':
          '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Header v1</w:t></w:r></w:p></w:hdr>',
      },
    });

    const current = createDocument({
      bodyText: 'Body',
      relationships: createRelationshipMap([
        [
          'rIdFtr1',
          {
            id: 'rIdFtr1',
            type: REL_TYPE_FOOTER,
            target: 'footer1.xml',
          },
        ],
      ]),
      footers: new Map([['rIdFtr1', createFooter('Footer v1')]]),
      finalSectionProperties: {
        footerReferences: [{ type: 'default', rId: 'rIdFtr1' }],
      },
    });

    const operations = await buildDirectXmlOperationPlan({
      currentDocument: current,
      baselineDocument: baseline,
      baselineBuffer,
    });
    const result = await applyRealDocChanges(baselineBuffer, operations, { strict: true });
    await assertDocxPackageIntegrity(result.buffer);

    const editor = await openDocxXml(result.buffer);
    expect(editor.hasPart('word/header1.xml')).toBe(false);
    expect(editor.hasPart('word/footer1.xml')).toBe(true);
  });

  test('preserves separator/continuation note XML when normal endnote is edited', async () => {
    const relationships = createRelationshipMap([
      [
        'rIdEndnotes',
        {
          id: 'rIdEndnotes',
          type: REL_TYPE_ENDNOTES,
          target: 'endnotes.xml',
        },
      ],
    ]);
    const baselineEndnotesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:endnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:endnote w:type="separator" w:id="-1"><w:p><w:r><w:t>END-SEP</w:t></w:r></w:p><w:customEnd/></w:endnote>
  <w:endnote w:id="2"><w:p><w:r><w:t>Old endnote</w:t></w:r></w:p></w:endnote>
  <w:endnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:t>END-CONT</w:t></w:r></w:p></w:endnote>
</w:endnotes>`;
    const baselineBuffer = await createMinimalMainDocxBuffer({
      documentXml: serializeDocument(
        createDocument({
          bodyText: 'Body',
          relationships,
          endnotes: [{ type: 'endnote', id: 2, content: [createParagraph('Old endnote')] }],
        })
      ),
      documentRelsXml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rIdEndnotes" Type="${REL_TYPE_ENDNOTES}" Target="endnotes.xml"/>
</Relationships>`,
      contentTypeOverrides: [
        { partName: '/word/endnotes.xml', contentType: CONTENT_TYPE_ENDNOTES },
      ],
      extraParts: {
        'word/endnotes.xml': baselineEndnotesXml,
      },
    });

    const baseline = createDocument({
      bodyText: 'Body',
      relationships,
      endnotes: [{ type: 'endnote', id: 2, content: [createParagraph('Old endnote')] }],
    });
    const current = createDocument({
      bodyText: 'Body',
      relationships,
      endnotes: [{ type: 'endnote', id: 2, content: [createParagraph('New endnote')] }],
    });
    const operations = await buildDirectXmlOperationPlan({
      currentDocument: current,
      baselineDocument: baseline,
      baselineBuffer,
    });
    const endnotesOp = operations.find(
      (operation) => operation.type === 'set-xml' && operation.path === 'word/endnotes.xml'
    );
    expect(endnotesOp).toBeDefined();
    if (!endnotesOp || endnotesOp.type !== 'set-xml') return;

    expect(endnotesOp.xml).toContain('New endnote');
    expect(endnotesOp.xml).not.toContain('Old endnote');
    expect(endnotesOp.xml).toContain('END-SEP');
    expect(endnotesOp.xml).toContain('END-CONT');
    expect(endnotesOp.xml).toContain('customEnd');
  });

  test('allocates unique notes relationship id when preferred id is already used', async () => {
    const conflictingRelationships = createRelationshipMap([
      [
        'rIdFootnotes',
        {
          id: 'rIdFootnotes',
          type: REL_TYPE_HEADER,
          target: 'header1.xml',
        },
      ],
    ]);
    const baseline = createDocument({
      bodyText: 'Body',
      relationships: conflictingRelationships,
      footnotes: [],
    });
    const current = createDocument({
      bodyText: 'Body',
      relationships: conflictingRelationships,
      footnotes: [
        {
          type: 'footnote',
          id: 1,
          content: [createParagraph('Collision-safe note')],
        },
      ],
    });

    const operations = await buildDirectXmlOperationPlan({
      currentDocument: current,
      baselineDocument: baseline,
    });

    expect(
      operations.some(
        (operation) =>
          operation.type === 'upsert-relationship' &&
          operation.relationshipType === REL_TYPE_FOOTNOTES &&
          operation.id === 'rIdFootnotes_1' &&
          operation.target === 'footnotes.xml'
      )
    ).toBe(true);
  });
});
