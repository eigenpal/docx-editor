/**
 * Generate a very large DOCX file matching issue #68 specs, but additionally
 * seeded with comments and tracked changes (suggestions). This is the heavy
 * "review" variant of issue-68-large.docx, used to reproduce the latency that
 * appears once a large document carries many comments and suggestions.
 *
 * Same body content / size as issue-68-large.docx (~127K words, ~300 pages),
 * plus:
 *   - ~200 comments (one every ~10 body paragraphs), with comments.xml +
 *     commentsExtended.xml so reply threading / done-state parse cleanly.
 *   - ~200 tracked changes (alternating w:ins insertions and w:del deletions)
 *     spread across the whole document.
 *
 * Run: bun scripts/generate-large-doc-comments-suggestions.ts
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
  <Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>
  <Override PartName="/word/commentsExtended.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml"/>
</Types>`;

const RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOCUMENT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/commentsExtended" Target="commentsExtended.xml"/>
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

const commentBodies = [
  'Can we clarify this claim with a concrete example?',
  'Please add a citation for this statement.',
  'This sentence reads a little long — consider splitting it.',
  'Is this still accurate after the latest refactor?',
  'Good point, but it overlaps with the previous section.',
  'Reviewer note: double-check terminology here.',
  'Should we expand on the trade-offs mentioned?',
  'Nit: prefer active voice in this paragraph.',
];

const REVIEW_AUTHORS = ['Alice Reviewer', 'Bob Editor', 'Carol QA'];
const AUTHOR_INITIALS: Record<string, string> = {
  'Alice Reviewer': 'AR',
  'Bob Editor': 'BE',
  'Carol QA': 'CQ',
};

// Deterministic timestamps so the fixture is reproducible across runs.
const BASE_DATE = Date.parse('2026-01-05T09:00:00Z');

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Generate a w14:paraId-style 8-hex-digit id from a counter. */
function paraIdHex(n: number): string {
  return (0x10000000 + n).toString(16).toUpperCase().padStart(8, '0');
}

interface CommentRecord {
  id: number;
  author: string;
  date: string;
  paraId: string;
  text: string;
}

const comments: CommentRecord[] = [];

function generateHeading(text: string, style: string): string {
  return `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr><w:r><w:t xml:space="preserve">${escapeXml(
    text
  )}</w:t></w:r></w:p>`;
}

/**
 * Build a normal body paragraph, optionally decorated with a comment range
 * around its text and/or a tracked change (insertion or deletion) appended.
 */
function generateBodyParagraph(
  text: string,
  opts: {
    commentId?: number;
    commentAuthor?: string;
    commentDate?: string;
    change?: { kind: 'ins' | 'del'; id: number; author: string; date: string; text: string };
  }
): string {
  const { commentId, change } = opts;
  let inner = '';

  if (commentId !== undefined) {
    inner += `<w:commentRangeStart w:id="${commentId}"/>`;
  }
  inner += `<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
  if (commentId !== undefined) {
    inner += `<w:commentRangeEnd w:id="${commentId}"/>`;
    inner += `<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="${commentId}"/></w:r>`;
  }

  if (change) {
    const { kind, id, author, date, text: changeText } = change;
    if (kind === 'ins') {
      inner += `<w:ins w:id="${id}" w:author="${escapeXml(author)}" w:date="${date}"><w:r><w:t xml:space="preserve"> ${escapeXml(
        changeText
      )}</w:t></w:r></w:ins>`;
    } else {
      inner += `<w:del w:id="${id}" w:author="${escapeXml(author)}" w:date="${date}"><w:r><w:delText xml:space="preserve"> ${escapeXml(
        changeText
      )}</w:delText></w:r></w:del>`;
    }
  }

  return `<w:p>${inner}</w:p>`;
}

/**
 * Generate a document with ~127K words plus comments and tracked changes.
 * Structure mirrors generate-large-doc-issue68.ts so page count matches.
 */
function generateLargeDocument(): {
  xml: string;
  wordCount: number;
  charCount: number;
  commentCount: number;
  changeCount: number;
} {
  const paragraphs: string[] = [];
  let totalWords = 0;
  let totalChars = 0;
  const TARGET_WORDS = 127_000;

  let sectionNum = 0;
  let subNum = 0;
  let bodyParaIndex = 0;
  let commentId = 0;
  let changeId = 1; // ins/del ids share the document-wide revision id space
  let changeCount = 0;

  // How often (in body paragraphs) to attach a comment / a tracked change.
  const COMMENT_EVERY = 10;
  const CHANGE_EVERY = 10;

  while (totalWords < TARGET_WORDS) {
    sectionNum++;
    const heading = `Chapter ${sectionNum} Analysis and Discussion of Technical Systems`;
    paragraphs.push(generateHeading(heading, 'Heading1'));
    totalWords += countWords(heading);
    totalChars += heading.length;

    for (let s = 0; s < 5 && totalWords < TARGET_WORDS; s++) {
      subNum++;
      const subHeading = `${sectionNum}.${s + 1} Detailed Subsection on Implementation Patterns`;
      paragraphs.push(generateHeading(subHeading, 'Heading2'));
      totalWords += countWords(subHeading);
      totalChars += subHeading.length;

      for (let p = 0; p < 8 && totalWords < TARGET_WORDS; p++) {
        const s1 = sentences[(subNum + p) % sentences.length];
        const s2 = sentences[(subNum + p + 7) % sentences.length];
        const s3 = sentences[(subNum + p + 13) % sentences.length];
        const text = `${s1} ${s2} ${s3}`;

        const opts: Parameters<typeof generateBodyParagraph>[1] = {};

        // Attach a comment to this paragraph.
        if (bodyParaIndex % COMMENT_EVERY === 0) {
          const author = REVIEW_AUTHORS[commentId % REVIEW_AUTHORS.length];
          const date = new Date(BASE_DATE + commentId * 3_600_000).toISOString();
          const paraId = paraIdHex(commentId);
          comments.push({
            id: commentId,
            author,
            date,
            paraId,
            text: commentBodies[commentId % commentBodies.length],
          });
          opts.commentId = commentId;
          opts.commentAuthor = author;
          opts.commentDate = date;
          commentId++;
        }

        // Attach a tracked change to this paragraph (offset so some
        // paragraphs carry both a comment and a suggestion).
        if (bodyParaIndex % CHANGE_EVERY === 5) {
          const kind: 'ins' | 'del' = changeCount % 2 === 0 ? 'ins' : 'del';
          const author = REVIEW_AUTHORS[changeCount % REVIEW_AUTHORS.length];
          const date = new Date(BASE_DATE + changeCount * 1_800_000).toISOString();
          const changeText =
            kind === 'ins'
              ? 'This clause was inserted during review.'
              : 'this redundant clause was removed during review.';
          opts.change = { kind, id: changeId, author, date, text: changeText };
          changeId++;
          changeCount++;
          totalWords += countWords(changeText);
          totalChars += changeText.length;
        }

        paragraphs.push(generateBodyParagraph(text, opts));
        totalWords += countWords(text);
        totalChars += text.length;
        bodyParaIndex++;
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

  return {
    xml,
    wordCount: totalWords,
    charCount: totalChars,
    commentCount: comments.length,
    changeCount,
  };
}

function buildCommentsXml(): string {
  const commentEls = comments
    .map((c) => {
      return `  <w:comment w:id="${c.id}" w:author="${escapeXml(c.author)}" w:date="${
        c.date
      }" w:initials="${AUTHOR_INITIALS[c.author] ?? ''}">
    <w:p w14:paraId="${c.paraId}"><w:r><w:t xml:space="preserve">${escapeXml(
      c.text
    )}</w:t></w:r></w:p>
  </w:comment>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">
${commentEls}
</w:comments>`;
}

function buildCommentsExtendedXml(): string {
  // Top-level comments (no parent). Provides done-state metadata.
  const els = comments
    .map((c) => {
      return `  <w15:commentEx w15:paraId="${c.paraId}" w15:done="0"/>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w15:commentsEx xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml">
${els}
</w15:commentsEx>`;
}

async function main() {
  console.log('Generating large DOCX with comments + suggestions...');
  console.log('Target: ~127,000 words\n');

  const { xml, wordCount, charCount, commentCount, changeCount } = generateLargeDocument();

  const zip = new JSZip();
  zip.file('[Content_Types].xml', CONTENT_TYPES_XML);
  zip.file('_rels/.rels', RELS_XML);
  zip.file('word/_rels/document.xml.rels', DOCUMENT_RELS_XML);
  zip.file('word/styles.xml', STYLES_XML);
  zip.file('word/document.xml', xml);
  zip.file('word/comments.xml', buildCommentsXml());
  zip.file('word/commentsExtended.xml', buildCommentsExtendedXml());

  const buffer = await zip.generateAsync({ type: 'nodebuffer' });

  const outputPath = path.join(
    path.dirname(new URL(import.meta.url).pathname),
    '..',
    'e2e',
    'fixtures',
    'issue-68-large-comments-suggestions.docx'
  );
  fs.writeFileSync(outputPath, buffer);

  console.log(`Generated: ${outputPath}`);
  console.log(`File size: ${(buffer.length / 1024).toFixed(1)} KB`);
  console.log(`Words: ~${wordCount.toLocaleString()}`);
  console.log(`Characters: ~${charCount.toLocaleString()}`);
  console.log(`Comments: ${commentCount}`);
  console.log(`Tracked changes (suggestions): ${changeCount}`);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
