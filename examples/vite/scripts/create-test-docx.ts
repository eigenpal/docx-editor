/**
 * Creates a test .docx file with both comments and template variables.
 * Run: bun examples/vite/scripts/create-test-docx.ts
 */
import JSZip from '../../../packages/core/node_modules/jszip';
import { writeFile } from 'fs/promises';
import { join } from 'path';

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const WORD_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>
</Relationships>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:rPr><w:sz w:val="24"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:pPr><w:outlineLvl w:val="0"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="36"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:pPr><w:outlineLvl w:val="1"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="28"/></w:rPr>
  </w:style>
</w:styles>`;

const COMMENTS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:comment w:id="1" w:author="Alice" w:date="2025-01-15T10:30:00Z" w:initials="A">
    <w:p><w:r><w:t>Should we use the client's legal name here?</w:t></w:r></w:p>
  </w:comment>
  <w:comment w:id="2" w:author="Bob" w:date="2025-01-15T11:00:00Z" w:initials="B">
    <w:p><w:r><w:t>This section needs to loop over all invoice items from the data source.</w:t></w:r></w:p>
  </w:comment>
  <w:comment w:id="3" w:author="Alice" w:date="2025-01-16T09:00:00Z" w:initials="A">
    <w:p><w:r><w:t>The total should auto-calculate. Verify the template formula works.</w:t></w:r></w:p>
  </w:comment>
  <w:comment w:id="4" w:author="Charlie" w:date="2025-01-16T14:30:00Z" w:initials="C">
    <w:p><w:r><w:t>Make sure the date format matches the client's locale preference.</w:t></w:r></w:p>
  </w:comment>
</w:comments>`;

// Document with mixed comments and template variables
const DOCUMENT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>

    <!-- Title -->
    <w:p>
      <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
      <w:r><w:t>Invoice Template</w:t></w:r>
    </w:p>

    <!-- Invoice number with template variable -->
    <w:p>
      <w:r><w:t xml:space="preserve">Invoice #: </w:t></w:r>
      <w:r><w:rPr><w:b/></w:rPr><w:t>{invoice_number}</w:t></w:r>
    </w:p>

    <!-- Date with comment and template variable -->
    <w:p>
      <w:r><w:t xml:space="preserve">Date: </w:t></w:r>
      <w:commentRangeStart w:id="4"/>
      <w:r><w:rPr><w:b/></w:rPr><w:t>{invoice_date}</w:t></w:r>
      <w:commentRangeEnd w:id="4"/>
      <w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="4"/></w:r>
    </w:p>

    <!-- Blank line -->
    <w:p/>

    <!-- Client section heading -->
    <w:p>
      <w:pPr><w:pStyle w:val="Heading2"/></w:pPr>
      <w:r><w:t>Bill To</w:t></w:r>
    </w:p>

    <!-- Client name with comment -->
    <w:p>
      <w:commentRangeStart w:id="1"/>
      <w:r><w:rPr><w:b/></w:rPr><w:t>{client.name}</w:t></w:r>
      <w:commentRangeEnd w:id="1"/>
      <w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="1"/></w:r>
    </w:p>

    <!-- Client address -->
    <w:p>
      <w:r><w:t>{client.address}</w:t></w:r>
    </w:p>

    <!-- Client city/state -->
    <w:p>
      <w:r><w:t xml:space="preserve">{client.city}, {client.state} {client.zip}</w:t></w:r>
    </w:p>

    <!-- Blank line -->
    <w:p/>

    <!-- Items section heading -->
    <w:p>
      <w:pPr><w:pStyle w:val="Heading2"/></w:pPr>
      <w:r><w:t>Line Items</w:t></w:r>
    </w:p>

    <!-- Loop start with comment -->
    <w:p>
      <w:commentRangeStart w:id="2"/>
      <w:r><w:t>{#items}</w:t></w:r>
      <w:commentRangeEnd w:id="2"/>
      <w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="2"/></w:r>
    </w:p>

    <!-- Item detail line -->
    <w:p>
      <w:r><w:t xml:space="preserve">  - {description}: {quantity} x \${price} = \${total}</w:t></w:r>
    </w:p>

    <!-- Loop end -->
    <w:p>
      <w:r><w:t>{/items}</w:t></w:r>
    </w:p>

    <!-- Blank line -->
    <w:p/>

    <!-- Total with comment -->
    <w:p>
      <w:pPr><w:pStyle w:val="Heading2"/></w:pPr>
      <w:r><w:t>Summary</w:t></w:r>
    </w:p>

    <w:p>
      <w:r><w:t xml:space="preserve">Subtotal: </w:t></w:r>
      <w:r><w:rPr><w:b/></w:rPr><w:t>\${subtotal}</w:t></w:r>
    </w:p>

    <w:p>
      <w:r><w:t xml:space="preserve">Tax ({tax_rate}%): </w:t></w:r>
      <w:r><w:rPr><w:b/></w:rPr><w:t>\${tax_amount}</w:t></w:r>
    </w:p>

    <w:p>
      <w:r><w:t xml:space="preserve">Total Due: </w:t></w:r>
      <w:commentRangeStart w:id="3"/>
      <w:r><w:rPr><w:b/><w:sz w:val="28"/></w:rPr><w:t>\${grand_total}</w:t></w:r>
      <w:commentRangeEnd w:id="3"/>
      <w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="3"/></w:r>
    </w:p>

    <!-- Blank line -->
    <w:p/>

    <!-- Payment terms -->
    <w:p>
      <w:pPr><w:pStyle w:val="Heading2"/></w:pPr>
      <w:r><w:t>Payment Terms</w:t></w:r>
    </w:p>

    <w:p>
      <w:r><w:t xml:space="preserve">Payment is due within {payment_terms} days. Please make checks payable to {company.name}.</w:t></w:r>
    </w:p>

    <w:p>
      <w:r><w:t xml:space="preserve">Bank: {company.bank_name} | Account: {company.account_number}</w:t></w:r>
    </w:p>

    <!-- Conditional notes -->
    <w:p/>
    <w:p>
      <w:r><w:t>{#notes}</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">Note: {notes}</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t>{/notes}</w:t></w:r>
    </w:p>

    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>
    </w:sectPr>
  </w:body>
</w:document>`;

async function main() {
  const zip = new JSZip();

  zip.file('[Content_Types].xml', CONTENT_TYPES);
  zip.file('_rels/.rels', RELS);
  zip.file('word/_rels/document.xml.rels', WORD_RELS);
  zip.file('word/document.xml', DOCUMENT);
  zip.file('word/comments.xml', COMMENTS);
  zip.file('word/styles.xml', STYLES);

  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  const outPath = join(import.meta.dir, '..', 'public', 'comments-and-templates.docx');
  await writeFile(outPath, buffer);
  console.log(`Created ${outPath}`);
}

main();
