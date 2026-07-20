/**
 * Generate a very large DOCX file matching issue #68 specs:
 * ~428KB, ~127,151 words, ~652,733 characters.
 *
 * Run: bun scripts/generate-large-doc-issue68.ts
 */
import JSZip from 'jszip';
import * as fs from 'fs';
import * as path from 'path';

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

const RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOCUMENT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:qFormat/>
    <w:pPr><w:spacing w:after="200" w:line="276" w:lineRule="auto"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:pPr><w:spacing w:before="480" w:after="120"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:sz w:val="36"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:pPr><w:spacing w:before="360" w:after="80"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:b/><w:sz w:val="28"/></w:rPr>
  </w:style>
</w:styles>`;

// Varied lorem-ish sentences (~15-25 words each) for realistic content
const sentences = [
  'The quick brown fox jumps over the lazy dog near the riverbank on a warm sunny afternoon in early spring when flowers begin to bloom.',
  'Modern software engineering practices continue to evolve at an unprecedented pace pushing boundaries of what was once thought impossible in distributed systems.',
  'Research findings indicate that collaborative development methodologies significantly improve code quality metrics when properly implemented across diverse engineering teams.',
  'The implementation of microservices architecture has transformed how organizations approach system design enabling independent deployment cycles and fault isolation.',
  'Performance optimization remains a critical concern for large scale applications requiring careful consideration of algorithmic complexity and memory management.',
  'User experience design principles emphasize the importance of intuitive interfaces responsive layouts and accessible interactions across all platforms.',
  'Data driven decision making has become a cornerstone of modern business strategy leveraging analytical tools to extract actionable insights from datasets.',
  'Security best practices mandate regular vulnerability assessments comprehensive input validation encryption of sensitive data and least privilege principles.',
  'Continuous integration and deployment pipelines streamline the software delivery process automating testing building and release procedures for quality.',
  'Cloud native applications leverage containerization orchestration and serverless computing paradigms to achieve elastic scalability and fault tolerance.',
  'Documentation serves as the bridge between complex technical implementations and the developers who must maintain and extend them over time.',
  'Testing strategies range from unit tests that verify individual components to integration tests that ensure systems work together as expected.',
  'Version control systems provide the foundation for collaborative software development enabling teams to track changes and manage codebases effectively.',
  'Database optimization techniques include proper indexing query planning connection pooling and caching strategies for improved read and write performance.',
  'Monitoring and observability tools give engineers visibility into system behavior helping them detect and diagnose issues before they impact users.',
  'API design principles favor consistency simplicity and backward compatibility to reduce friction for consumers and minimize breaking changes over time.',
  'Infrastructure as code enables teams to define and manage computing resources through machine readable configuration files and automation scripts.',
  'Agile methodologies encourage iterative development frequent feedback loops and adaptive planning to deliver value incrementally and respond to changing requirements.',
  'Machine learning models require careful feature engineering data preprocessing and hyperparameter tuning to achieve optimal predictive performance in production.',
  'Distributed systems face challenges including network partitions eventual consistency leader election and coordination that require sophisticated consensus algorithms.',
];

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function generateParagraph(text: string, style?: string): string {
  const pPr = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : '';
  return `<w:p>${pPr}<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Generate a document with ~127K words.
 * Each paragraph combines 3 sentences (~60 words).
 * ~127000 / 60 = ~2117 paragraphs needed.
 * We'll organize into chapters/sections for realism.
 */
function generateLargeDocument(): { xml: string; wordCount: number; charCount: number } {
  const paragraphs: string[] = [];
  let totalWords = 0;
  let totalChars = 0;
  const TARGET_WORDS = 127_000;

  let sectionNum = 0;
  let subNum = 0;

  while (totalWords < TARGET_WORDS) {
    sectionNum++;
    // Section heading
    const heading = `Chapter ${sectionNum} Analysis and Discussion of Technical Systems`;
    paragraphs.push(generateParagraph(heading, 'Heading1'));
    totalWords += countWords(heading);
    totalChars += heading.length;

    // 5 subsections per chapter
    for (let s = 0; s < 5 && totalWords < TARGET_WORDS; s++) {
      subNum++;
      const subHeading = `${sectionNum}.${s + 1} Detailed Subsection on Implementation Patterns`;
      paragraphs.push(generateParagraph(subHeading, 'Heading2'));
      totalWords += countWords(subHeading);
      totalChars += subHeading.length;

      // 8 paragraphs per subsection, each combining 3 sentences
      for (let p = 0; p < 8 && totalWords < TARGET_WORDS; p++) {
        const s1 = sentences[(subNum + p) % sentences.length];
        const s2 = sentences[(subNum + p + 7) % sentences.length];
        const s3 = sentences[(subNum + p + 13) % sentences.length];
        const text = `${s1} ${s2} ${s3}`;
        paragraphs.push(generateParagraph(text));
        totalWords += countWords(text);
        totalChars += text.length;
      }
    }
  }

  const body = paragraphs.join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
            xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
            xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"
            mc:Ignorable="w14">
  <w:body>
    ${body}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/>
    </w:sectPr>
  </w:body>
</w:document>`;

  return { xml, wordCount: totalWords, charCount: totalChars };
}

async function main() {
  console.log('Generating large DOCX for issue #68 reproduction...');
  console.log('Target: ~127,000 words\n');

  const { xml, wordCount, charCount } = generateLargeDocument();

  const zip = new JSZip();
  zip.file('[Content_Types].xml', CONTENT_TYPES_XML);
  zip.file('_rels/.rels', RELS_XML);
  zip.file('word/_rels/document.xml.rels', DOCUMENT_RELS_XML);
  zip.file('word/styles.xml', STYLES_XML);
  zip.file('word/document.xml', xml);

  const buffer = await zip.generateAsync({ type: 'nodebuffer' });

  // Save to e2e fixtures
  const outputPath = path.join(
    path.dirname(new URL(import.meta.url).pathname),
    '..',
    'e2e',
    'fixtures',
    'issue-68-large.docx'
  );
  fs.writeFileSync(outputPath, buffer);

  console.log(`Generated: ${outputPath}`);
  console.log(`File size: ${(buffer.length / 1024).toFixed(1)} KB`);
  console.log(`Words: ~${wordCount.toLocaleString()}`);
  console.log(`Characters: ~${charCount.toLocaleString()}`);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
