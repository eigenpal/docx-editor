// Default formatting travels with a copy as what the source painted: omitted defaults as the
// application's values, authored defaults with the format baseline where they say nothing.
import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import type { OoxmlPackage } from '../package/ooxml-package.ts';
import { serializeOoxmlPart } from '../package/ooxml-tree.ts';
import { extractFragmentPackage } from '../store/clipboard-fragment-extract.ts';
import {
  CT,
  R,
  REL,
  W,
  bodyOf,
  buildPackage,
  fullBodyCoverage,
  openStore,
  paragraphIdsUnder,
} from './clipboard-fragment-fixtures.ts';

describe('omitted and format defaults travel as what the source painted', () => {
  const styles = (inner: string) => `<w:styles xmlns:w="${W}">${inner}</w:styles>`;
  const authoredTenPoint = styles(
    '<w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="20"/></w:rPr></w:rPrDefault>' +
      '<w:pPrDefault/></w:docDefaults>'
  );
  const pasteInto = (targetStyles: string | null, fragmentBytes: Uint8Array): string => {
    const store = openStore(
      targetStyles === null
        ? buildPackage('<w:p/>')
        : buildPackage('<w:p/>', { 'word/styles.xml': targetStyles })
    );
    const main = store.currentPackage().mainDocumentPart;
    const hostId = paragraphIdsUnder(bodyOf(store.currentPackage().parts.get(main)!))[0]!;
    const pasted = store.applyFragmentPaste(
      { kind: 'body' },
      { paragraphId: hostId, offset: 0, fragmentBytes, lastMarkCovered: true }
    );
    expect(pasted.ok).toBe(true);
    return serializeOoxmlPart(store.currentPackage().parts.get(main)!);
  };
  const copied = (source: OoxmlPackage): Uint8Array => {
    const extracted = extractFragmentPackage(source, fullBodyCoverage(source));
    if (!extracted.ok) throw new Error('extract failed');
    return extracted.bytes;
  };
  const plain = '<w:p><w:r><w:t>carried</w:t></w:r></w:p>';

  test('a source that omits its defaults pastes its 12pt and 8pt after', () => {
    for (const source of [
      buildPackage(plain),
      buildPackage(plain, {
        'word/styles.xml': styles('<w:style w:type="paragraph" w:styleId="Body"/>'),
      }),
    ]) {
      const xml = pasteInto(authoredTenPoint, copied(source));
      expect(xml).toContain('<w:sz w:val="24"/>');
      expect(xml).toContain('w:after="160"');
    }
  });

  test('a 10pt source keeps its size and spacing in a target that omits its defaults', () => {
    const xml = pasteInto(
      null,
      copied(buildPackage(plain, { 'word/styles.xml': authoredTenPoint }))
    );
    expect(xml).toContain('<w:sz w:val="20"/>');
    expect(xml).toContain('w:after="0"');
    expect(xml).toContain('w:line="240"');
  });

  test('a travelling style that states part of the spacing gains only the rest', () => {
    const source = buildPackage(
      '<w:p><w:pPr><w:pStyle w:val="Head"/></w:pPr><w:r><w:t>carried</w:t></w:r></w:p>',
      {
        'word/styles.xml': styles(
          '<w:style w:type="paragraph" w:styleId="Head"><w:pPr>' +
            '<w:spacing w:before="240"/></w:pPr></w:style>'
        ),
      }
    );
    const xml = pasteInto(authoredTenPoint, copied(source));
    const spacing = xml.match(/<w:spacing [^>]*\/>/g) ?? [];
    expect(spacing).toHaveLength(1);
    expect(spacing[0]).toContain('w:after="160"');
    expect(spacing[0]).toContain('w:line="278"');
    expect(spacing[0]).not.toContain('w:before');
  });

  test('external content without a styles part stamps nothing', () => {
    const external = zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}"><w:body>${plain}</w:body></w:document>`
      ),
    });
    const xml = pasteInto(authoredTenPoint, external);
    expect(xml).not.toContain('<w:sz');
    expect(xml).not.toContain('<w:spacing');
  });
});
