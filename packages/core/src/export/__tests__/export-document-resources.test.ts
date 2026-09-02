import { expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { caretAt } from '../../layout/semantic-interaction.ts';
import { openDocumentForExport } from '../export-session.ts';
import { exportDestinationNamed } from '../export-document-resources.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CP = 'http://schemas.openxmlformats.org/package/2006/metadata/core-properties';
const DC = 'http://purl.org/dc/elements/1.1/';
const EP = 'http://schemas.openxmlformats.org/officeDocument/2006/extended-properties';

function docxBytes(
  body: string,
  withMetadata = true,
  extra: {
    readonly relationships?: string;
    readonly contentTypes?: string;
    readonly entries?: Readonly<Record<string, Uint8Array>>;
  } = {}
): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        (withMetadata
          ? '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
            '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>'
          : '') +
        (extra.contentTypes ?? '') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rDoc" Type="${R}/officeDocument" Target="word/document.xml"/>` +
        (withMetadata
          ? `<Relationship Id="rCore" Type="${REL}/metadata/core-properties" Target="docProps/core.xml"/>` +
            `<Relationship Id="rApp" Type="${R}/extended-properties" Target="docProps/app.xml"/>`
          : '') +
        '</Relationships>'
    ),
    ...(extra.relationships
      ? {
          'word/_rels/document.xml.rels': strToU8(
            `<Relationships xmlns="${REL}">${extra.relationships}</Relationships>`
          ),
        }
      : {}),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}</w:body></w:document>`
    ),
    ...(withMetadata
      ? {
          'docProps/core.xml': strToU8(
            `<cp:coreProperties xmlns:cp="${CP}" xmlns:dc="${DC}">` +
              '<dc:title>Export Title</dc:title>' +
              '<dc:creator>Export Author</dc:creator>' +
              '</cp:coreProperties>'
          ),
          'docProps/app.xml': strToU8(
            `<Properties xmlns="${EP}"><Company>Export Co</Company></Properties>`
          ),
        }
      : {}),
    ...(extra.entries ?? {}),
  });
}

test('immutable byte export provides frozen metadata and destinations from one layout call', async () => {
  const opened = openDocumentForExport(
    docxBytes(
      '<w:p><w:bookmarkStart w:id="1" w:name="Jump"/><w:r><w:t>Target text</w:t></w:r><w:bookmarkEnd w:id="1"/></w:p>' +
        '<w:p><w:hyperlink w:anchor="Jump"><w:r><w:t>Go</w:t></w:r></w:hyperlink></w:p>'
    )
  );
  if (!opened.ok) throw new Error(String(opened.reason));
  const layout = await opened.session.layout();

  expect(layout.documentMetadata).toEqual({
    title: 'Export Title',
    creator: 'Export Author',
    company: 'Export Co',
  });
  expect(Object.isFrozen(layout.documentMetadata)).toBe(true);
  expect(layout.destinations).toBeDefined();
  expect(Object.isFrozen(layout.destinations)).toBe(true);
  expect(layout.destinations!.length).toBe(1);

  const destination = exportDestinationNamed(layout, 'Jump');
  expect(destination?.anchor.name).toBe('Jump');
  expect(destination?.pageIndex).toBe(0);
  expect(destination!.pageContent.height).toBeGreaterThan(0);
  const page = layout.pages[0]!;
  const originY = page.box.y + (page.contentBox.y - page.box.y);
  expect(destination!.pageStack.y).toBeCloseTo(originY + destination!.pageContent.y, 4);
  expect(exportDestinationNamed(layout, 'Missing')).toBeUndefined();

  opened.session.dispose();
});

test('byte export without docProps publishes empty frozen metadata and destinations', async () => {
  const opened = openDocumentForExport(
    docxBytes('<w:p><w:r><w:t>No metadata</w:t></w:r></w:p>', false)
  );
  if (!opened.ok) throw new Error(String(opened.reason));
  const layout = await opened.session.layout();

  expect(layout.documentMetadata).toEqual({});
  expect(Object.isFrozen(layout.documentMetadata)).toBe(true);
  expect(layout.destinations).toEqual([]);
  expect(Object.isFrozen(layout.destinations)).toBe(true);
  opened.session.dispose();
});

test('metadata and destinations survive session disposal on the published layout', async () => {
  const opened = openDocumentForExport(
    docxBytes(
      '<w:p><w:bookmarkStart w:id="1" w:name="Keep"/><w:r><w:t>After dispose</w:t></w:r><w:bookmarkEnd w:id="1"/></w:p>'
    )
  );
  if (!opened.ok) throw new Error(String(opened.reason));
  const layout = await opened.session.layout();
  opened.session.dispose();

  expect(Object.isFrozen(layout)).toBe(true);
  expect(layout.documentMetadata?.title).toBe('Export Title');
  expect(exportDestinationNamed(layout, 'Keep')?.anchor.name).toBe('Keep');
  await expect(opened.session.layout()).rejects.toMatchObject({ code: 'disposed' });
});

test('layoutFor republishes metadata and destinations per revision projection', async () => {
  const opened = openDocumentForExport(
    docxBytes(
      '<w:p><w:bookmarkStart w:id="1" w:name="Mode"/><w:r><w:t>Stable</w:t></w:r><w:bookmarkEnd w:id="1"/></w:p>'
    )
  );
  if (!opened.ok) throw new Error(String(opened.reason));
  const allMarkup = await opened.session.layout();
  const proposed = await opened.session.layoutFor('proposed');
  expect(allMarkup.documentMetadata).toEqual(proposed.documentMetadata);
  expect(exportDestinationNamed(allMarkup, 'Mode')?.pageIndex).toBe(
    exportDestinationNamed(proposed, 'Mode')?.pageIndex
  );
  opened.session.dispose();
});

test('header and note destinations publish caret geometry in page-content space', async () => {
  const opened = openDocumentForExport(
    docxBytes(
      '<w:p><w:r><w:t>Body</w:t><w:footnoteReference w:id="1"/></w:r></w:p>' +
        '<w:sectPr><w:headerReference w:type="default" r:id="rHeader"/>' +
        '<w:pgSz w:w="12240" w:h="15840"/>' +
        '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/>' +
        '</w:sectPr>',
      true,
      {
        relationships:
          `<Relationship Id="rHeader" Type="${R}/header" Target="header1.xml"/>` +
          `<Relationship Id="rNotes" Type="${R}/footnotes" Target="footnotes.xml"/>`,
        contentTypes:
          '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
          '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>',
        entries: {
          'word/header1.xml': strToU8(
            `<w:hdr xmlns:w="${W}">` +
              '<w:p><w:bookmarkStart w:id="1" w:name="HeaderJump"/>' +
              '<w:r><w:t>Header target</w:t></w:r><w:bookmarkEnd w:id="1"/></w:p></w:hdr>'
          ),
          'word/footnotes.xml': strToU8(
            `<w:footnotes xmlns:w="${W}">` +
              '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' +
              '<w:footnote w:type="continuationSeparator" w:id="0">' +
              '<w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>' +
              '<w:footnote w:id="1"><w:p><w:bookmarkStart w:id="2" w:name="NoteJump"/>' +
              '<w:r><w:t>Note target</w:t></w:r><w:bookmarkEnd w:id="2"/></w:p></w:footnote></w:footnotes>'
          ),
        },
      }
    )
  );
  if (!opened.ok) throw new Error(String(opened.reason));
  const layout = await opened.session.layout();
  const page = layout.pages[0]!;
  const header = page.header;
  const note = page.footnotes?.notes[0];
  expect(header).toBeDefined();
  expect(note).toBeDefined();

  const headerDestination = exportDestinationNamed(layout, 'HeaderJump');
  expect(headerDestination).toBeDefined();
  const headerCaret = caretAt(layout, headerDestination!.anchor);
  expect(headerCaret).not.toBeNull();
  const headerOriginY = header!.box.y - page.contentBox.y;
  expect(Math.abs(headerOriginY)).toBeGreaterThan(1);
  expect(headerDestination!.pageContent.y).toBeCloseTo(headerCaret!.y + headerOriginY, 4);
  expect(headerDestination!.pageStack.y).toBeCloseTo(
    page.contentBox.y + headerDestination!.pageContent.y,
    4
  );

  const noteDestination = exportDestinationNamed(layout, 'NoteJump');
  expect(noteDestination).toBeDefined();
  const noteCaret = caretAt(layout, noteDestination!.anchor);
  expect(noteCaret).not.toBeNull();
  const noteOriginY = note!.box.y - page.contentBox.y;
  expect(Math.abs(noteOriginY)).toBeGreaterThan(1);
  expect(noteDestination!.pageContent.y).toBeCloseTo(noteCaret!.y + noteOriginY, 4);
  expect(noteDestination!.pageStack.y).toBeCloseTo(
    page.contentBox.y + noteDestination!.pageContent.y,
    4
  );

  opened.session.dispose();
});
