import { strToU8, zipSync } from 'fflate';
import type { ServerUpdate } from './src/refresh-job';

// Generate controlled fixtures. This is not a general DOCX processor.
export function sampleDocx(round = 0, sequence = 0) {
  const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const ct = 'http://schemas.openxmlformats.org/package/2006/content-types';
  const rel = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const office = 'http://schemas.openxmlformats.org/officeDocument/2006';
  const reviewed = round > 1 || sequence === 2;
  const delivery = `October ${10 + (round % 18)}`;
  const reviewRound = sequence === 2 ? round : Math.max(1, round - 1);
  const review = `October ${11 + (reviewRound % 18)}`;
  const paragraphs = Array.from({ length: 40 }, (_, index) => {
    if (reviewed && index === 30) return '';
    const text =
      round > 0 && index === 20
        ? `Delivery date: ${delivery}.`
        : reviewed && index === 25
          ? `Review date: ${review}.`
          : `Section ${index + 1}: Project schedule.`;
    return `<w:p w14:paraId="${(index + 1).toString(16).padStart(8, '0')}"><w:pPr><w:spacing w:after="480"/></w:pPr>
      <w:r><w:t>${text}</w:t></w:r></w:p>`;
  }).join('');
  return zipSync({
    '[Content_Types].xml': strToU8(`<Types xmlns="${ct}">
      <Default Extension="rels"
        ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Override PartName="/word/document.xml"
        ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
      <Override PartName="/word/footer1.xml"
        ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
      </Types>`),
    '_rels/.rels': strToU8(`<Relationships xmlns="${rel}">
      <Relationship Id="rId1" Type="${office}/relationships/officeDocument"
        Target="word/document.xml"/></Relationships>`),
    'word/_rels/document.xml.rels': strToU8(`<Relationships xmlns="${rel}">
      <Relationship Id="footer" Type="${office}/relationships/footer"
        Target="footer1.xml"/></Relationships>`),
    'word/footer1.xml': strToU8(`<w:ftr xmlns:w="${w}"><w:p><w:r><w:t>
      ${reviewed ? `Reviewed version ${reviewRound}` : 'Draft version'}
      </w:t></w:r></w:p></w:ftr>`),
    'word/document.xml':
      strToU8(`<w:document xmlns:w="${w}" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"><w:body>
      ${paragraphs}<w:sectPr><w:footerReference w:type="default" r:id="footer" xmlns:r="${office}/relationships"/><w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:bottom="1440" w:left="1440" w:right="1440"/>
      </w:sectPr></w:body></w:document>`),
  });
}

export function sampleUpdate(submissionId: string, round: number, sequence: number): ServerUpdate {
  const reviewRound = sequence === 2 ? round : Math.max(1, round - 1);
  return {
    documentId: 'schedule',
    submissionId,
    sequence,
    bytes: Buffer.from(sampleDocx(round, sequence)).toString('base64'),
    changes: [
      {
        id: 'delivery-date',
        description: 'Changed the delivery date',
        location: {
          paragraphId: '00000015',
          start: 15,
          end: 25,
          text: `October ${10 + (round % 18)}`,
        },
      },
      ...(round > 1 || sequence === 2
        ? [
            {
              id: 'review-date',
              description: 'Changed the review date',
              location: {
                paragraphId: '0000001a',
                start: 13,
                end: 23,
                text: `October ${11 + (reviewRound % 18)}`,
              },
            },
            {
              id: 'footer',
              description: `Updated the footer to version ${reviewRound}`,
              unavailableReason: 'unavailable' as const,
            },
            {
              id: 'removed-clause',
              description: 'Removed section 31',
              unavailableReason: 'deleted' as const,
            },
          ]
        : []),
    ],
    // Simulate a failed processor operation without repeating successful work.
    failures: sequence === 2 ? ['risk-summary'] : [],
  };
}
