/**
 * Generate a large DOCX file (~50+ pages) for scale testing.
 * Run: bun scripts/generate-large-doc.ts
 */
import PizZip from 'pizzip';
import * as fs from 'fs';
import * as path from 'path';

// Minimal DOCX template parts
const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const wordRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:rPr>
      <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>
      <w:sz w:val="22"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:pPr><w:spacing w:before="480" w:after="120"/></w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>
      <w:b/><w:sz w:val="36"/>
    </w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:pPr><w:spacing w:before="360" w:after="80"/></w:pPr>
    <w:rPr>
      <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>
      <w:b/><w:sz w:val="28"/>
    </w:rPr>
  </w:style>
</w:styles>`;

function generateParagraph(text: string, style?: string): string {
  const pPr = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : '';
  return `<w:p>${pPr}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
}

function generateTable(rows: number, cols: number): string {
  const colWidth = Math.floor(9000 / cols);
  let xml = '<w:tbl>';
  xml += '<w:tblPr><w:tblW w:w="9000" w:type="dxa"/><w:tblBorders>';
  xml += '<w:top w:val="single" w:sz="4" w:space="0" w:color="000000"/>';
  xml += '<w:left w:val="single" w:sz="4" w:space="0" w:color="000000"/>';
  xml += '<w:bottom w:val="single" w:sz="4" w:space="0" w:color="000000"/>';
  xml += '<w:right w:val="single" w:sz="4" w:space="0" w:color="000000"/>';
  xml += '<w:insideH w:val="single" w:sz="4" w:space="0" w:color="000000"/>';
  xml += '<w:insideV w:val="single" w:sz="4" w:space="0" w:color="000000"/>';
  xml += '</w:tblBorders></w:tblPr>';
  xml += '<w:tblGrid>';
  for (let c = 0; c < cols; c++) {
    xml += `<w:gridCol w:w="${colWidth}"/>`;
  }
  xml += '</w:tblGrid>';

  for (let r = 0; r < rows; r++) {
    xml += '<w:tr>';
    for (let c = 0; c < cols; c++) {
      xml += `<w:tc><w:tcPr><w:tcW w:w="${colWidth}" w:type="dxa"/></w:tcPr>`;
      xml += `<w:p><w:r><w:t>Row ${r + 1}, Col ${c + 1}</w:t></w:r></w:p>`;
      xml += '</w:tc>';
    }
    xml += '</w:tr>';
  }
  xml += '</w:tbl>';
  return xml;
}

// Lorem ipsum-ish text blocks for realistic content
const loremTexts = [
  'The quick brown fox jumps over the lazy dog near the riverbank on a warm sunny afternoon in early spring.',
  'In the vast expanse of the digital landscape, modern software engineering practices continue to evolve at an unprecedented pace, pushing boundaries of what was once thought impossible.',
  'Research findings indicate that collaborative development methodologies significantly improve code quality metrics when properly implemented across diverse engineering teams working on complex distributed systems.',
  'The implementation of microservices architecture has transformed how organizations approach system design, enabling independent deployment cycles and reducing the blast radius of individual component failures.',
  'Performance optimization remains a critical concern for large-scale applications, requiring careful consideration of algorithmic complexity, memory management, and efficient resource utilization strategies.',
  'User experience design principles emphasize the importance of intuitive interfaces, responsive layouts, and accessible interactions that accommodate diverse user needs and preferences across platforms.',
  'Data-driven decision making has become a cornerstone of modern business strategy, leveraging analytical tools and machine learning algorithms to extract actionable insights from vast datasets.',
  'Security best practices mandate regular vulnerability assessments, comprehensive input validation, encryption of sensitive data at rest and in transit, and adherence to the principle of least privilege.',
  'Continuous integration and deployment pipelines streamline the software delivery process, automating testing, building, and release procedures to maintain high development velocity without compromising quality.',
  'Cloud-native applications leverage containerization, orchestration, and serverless computing paradigms to achieve elastic scalability, fault tolerance, and cost efficiency in production environments.',
];

function generateLargeDocument(): string {
  const paragraphs: string[] = [];

  // Generate ~50+ pages of content
  // 20 sections x 4 subsections x 5 paragraphs = 400 paragraphs
  // Plus tables every 3rd subsection (about 27 tables with 12 rows each)

  for (let section = 0; section < 20; section++) {
    // Section heading
    paragraphs.push(generateParagraph(`Section ${section + 1}: Document Content Area`, 'Heading1'));

    // 4 subsections per section
    for (let sub = 0; sub < 4; sub++) {
      paragraphs.push(generateParagraph(`${section + 1}.${sub + 1} Subsection Topic`, 'Heading2'));

      // 5 paragraphs per subsection
      for (let p = 0; p < 5; p++) {
        const text = loremTexts[(section * 4 + sub + p) % loremTexts.length];
        // Make paragraphs longer by combining 4 lorem texts
        const longText = `${text} ${loremTexts[(section + sub + p + 1) % loremTexts.length]} ${loremTexts[(section + sub + p + 2) % loremTexts.length]} ${loremTexts[(section + sub + p + 3) % loremTexts.length]}`;
        paragraphs.push(generateParagraph(longText));
      }

      // Add a table every 3rd subsection (more frequently)
      if ((section * 4 + sub) % 3 === 0) {
        paragraphs.push(generateTable(12, 4));
      }
    }
  }

  const body = paragraphs.join('\n');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
            xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
            xmlns:o="urn:schemas-microsoft-com:office:office"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
            xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"
            xmlns:v="urn:schemas-microsoft-com:vml"
            xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
            xmlns:w10="urn:schemas-microsoft-com:office:word"
            xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"
            xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"
            xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk"
            xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml"
            xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
            mc:Ignorable="w14 wp14">
  <w:body>
    ${body}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/>
    </w:sectPr>
  </w:body>
</w:document>`;
}

// Build the DOCX
const zip = new PizZip();
zip.file('[Content_Types].xml', contentTypesXml);
zip.file('_rels/.rels', relsXml);
zip.file('word/_rels/document.xml.rels', wordRelsXml);
zip.file('word/document.xml', generateLargeDocument());
zip.file('word/styles.xml', stylesXml);

const output = zip.generate({ type: 'nodebuffer' });

// Output 1: e2e fixtures (original path)
const outputPath = path.join(import.meta.dir, '..', 'e2e', 'fixtures', 'large-36-page.docx');
fs.writeFileSync(outputPath, output);
console.log(`Generated large DOCX: ${outputPath} (${output.length} bytes)`);

// Output 2: e2e fixtures (very-large-50-page.docx)
const outputPath2 = path.join(import.meta.dir, '..', 'e2e', 'fixtures', 'very-large-50-page.docx');
fs.writeFileSync(outputPath2, output);
console.log(`Generated large DOCX: ${outputPath2} (${output.length} bytes)`);

// Output 3: examples/vite/public
const outputPath3 = path.join(
  import.meta.dir,
  '..',
  'examples',
  'vite',
  'public',
  'very-large-50-page.docx'
);
fs.writeFileSync(outputPath3, output);
console.log(`Generated large DOCX: ${outputPath3} (${output.length} bytes)`);
