// A short DOCX built in memory so the demo boots with something worth roasting.
// Same minimal-package construction the adapter test suites use. Open your own
// .docx from the title bar to replace it.

import { strToU8, zipSync } from 'fflate';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

// Deliberately terrible prose: every line carries at least one thing the
// roastmaster is told to look for.
const PARAGRAPHS = [
  'Q3 Strategic Alignment Readout',
  'At this juncture, it is important to note that our organization has been on a journey towards a more holistic and synergistic operating model, and that journey continues.',
  'Various stakeholders were consulted, and it was determined by the working group that a number of key learnings had been surfaced across a range of workstreams.',
  'Going forward, we will continue to leverage our core competencies in order to drive value, unlock potential, and move the needle on the metrics that matter most to the business.',
  'It should be noted that the aforementioned initiatives are currently being evaluated with a view to potentially being prioritized in the fullness of time.',
  'In conclusion, the team remains laser focused on boiling the ocean one bite at a time, and we are confident that the low hanging fruit will be harvested in due course.',
];

function paragraph(text: string): string {
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<w:p><w:r><w:t xml:space="preserve">${escaped}</w:t></w:r></w:p>`;
}

export function seedDocx(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${PARAGRAPHS.map(paragraph).join('')}</w:body></w:document>`
    ),
  });
}
