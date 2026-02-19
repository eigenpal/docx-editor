/**
 * Analyze a Word comparison output document (docx with tracked revisions).
 *
 * Usage:
 *   bun scripts/analyze-comparison-doc.ts "/absolute/path/to/Comparison.docx"
 */

import { readFileSync, writeFileSync } from 'node:fs';
import JSZip from 'jszip';

interface ChangeTagCounts {
  ins: number;
  del: number;
  moveFrom: number;
  moveTo: number;
  rPrChange: number;
  pPrChange: number;
  tblPrChange: number;
  trPrChange: number;
  tcPrChange: number;
  sectPrChange: number;
  pict: number;
  object: number;
}

interface ComparisonSummaryRow {
  label: string;
  value: string;
}

interface ComparisonAnalysisReport {
  file: string;
  documentTagCounts: ChangeTagCounts;
  comparisonSummary: ComparisonSummaryRow[];
  shapeSectionSignals: {
    deletionBlocks: number;
    insertionBlocks: number;
    deletionBlocksWithSectionProps: number;
    insertionBlocksWithSectionProps: number;
    deletionBlocksWithDrawing: number;
    insertionBlocksWithDrawing: number;
    deletionBlocksWithAlternateContent: number;
    insertionBlocksWithAlternateContent: number;
    deletionBlocksWithPict: number;
    insertionBlocksWithPict: number;
  };
  formattingSignals: {
    rPrChangeWithBold: number;
    rPrChangeWithFontSize: number;
    rPrChangeWithFontFamily: number;
    pPrChangeWithIndent: number;
    pPrChangeWithSpacing: number;
    pPrChangeWithJustification: number;
  };
}

function countTag(xml: string, tagName: string): number {
  const re = new RegExp(`<${tagName}(?=[ >/\\t\\r\\n])`, 'g');
  return (xml.match(re) || []).length;
}

function extractBlocks(xml: string, tagName: 'w:del' | 'w:ins'): string[] {
  const re = new RegExp(`<${tagName}\\b[\\s\\S]*?<\\/${tagName}>`, 'g');
  return [...xml.matchAll(re)].map((match) => match[0]);
}

function countContaining(blocks: string[], needle: string): number {
  return blocks.filter((block) => block.includes(needle)).length;
}

function extractSummaryTokens(xml: string): string[] {
  const start = xml.lastIndexOf('Intelligent Table Comparison:');
  if (start < 0) return [];
  const end = xml.indexOf('Total Changes:', start);
  if (end < 0) return [];

  const scope = xml.slice(start, Math.min(xml.length, end + 2500));
  return [...scope.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)]
    .map((match) => match[1].trim())
    .filter((value) => value.length > 0);
}

function extractComparisonSummary(xml: string): ComparisonSummaryRow[] {
  const tokens = extractSummaryTokens(xml);
  if (tokens.length === 0) {
    return [];
  }

  const labels = [
    'Original DMS:',
    'Modified DMS:',
    'Add',
    'Delete',
    'Move From',
    'Move To',
    'Table Insert',
    'Table Delete',
    'Table moves to',
    'Table moves from',
    'Embedded Graphics (Visio, ChemDraw, Images etc.)',
    'Embedded Excel',
    'Format changes',
    'Total Changes:',
  ];

  const rows: ComparisonSummaryRow[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!labels.includes(token)) {
      continue;
    }

    const nextValue = tokens[index + 1] ?? '';
    rows.push({
      label: token,
      value: nextValue,
    });
  }
  return rows;
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    throw new Error(
      'Usage: bun scripts/analyze-comparison-doc.ts "/absolute/path/to/Comparison.docx"'
    );
  }

  const fileBuffer = readFileSync(inputPath);
  const arrayBuffer = fileBuffer.buffer.slice(
    fileBuffer.byteOffset,
    fileBuffer.byteOffset + fileBuffer.byteLength
  );
  const zip = await JSZip.loadAsync(arrayBuffer);

  const docXmlFile = zip.file('word/document.xml');
  if (!docXmlFile) {
    throw new Error('Missing word/document.xml');
  }
  const documentXml = await docXmlFile.async('text');

  const delBlocks = extractBlocks(documentXml, 'w:del');
  const insBlocks = extractBlocks(documentXml, 'w:ins');
  const rPrChanges = [...documentXml.matchAll(/<w:rPrChange\b[\s\S]*?<\/w:rPrChange>/g)].map(
    (match) => match[0]
  );
  const pPrChanges = [...documentXml.matchAll(/<w:pPrChange\b[\s\S]*?<\/w:pPrChange>/g)].map(
    (match) => match[0]
  );

  const report: ComparisonAnalysisReport = {
    file: inputPath,
    documentTagCounts: {
      ins: countTag(documentXml, 'w:ins'),
      del: countTag(documentXml, 'w:del'),
      moveFrom: countTag(documentXml, 'w:moveFrom'),
      moveTo: countTag(documentXml, 'w:moveTo'),
      rPrChange: countTag(documentXml, 'w:rPrChange'),
      pPrChange: countTag(documentXml, 'w:pPrChange'),
      tblPrChange: countTag(documentXml, 'w:tblPrChange'),
      trPrChange: countTag(documentXml, 'w:trPrChange'),
      tcPrChange: countTag(documentXml, 'w:tcPrChange'),
      sectPrChange: countTag(documentXml, 'w:sectPrChange'),
      pict: countTag(documentXml, 'w:pict'),
      object: countTag(documentXml, 'w:object'),
    },
    comparisonSummary: extractComparisonSummary(documentXml),
    shapeSectionSignals: {
      deletionBlocks: delBlocks.length,
      insertionBlocks: insBlocks.length,
      deletionBlocksWithSectionProps: countContaining(delBlocks, '<w:sectPr'),
      insertionBlocksWithSectionProps: countContaining(insBlocks, '<w:sectPr'),
      deletionBlocksWithDrawing: countContaining(delBlocks, '<w:drawing'),
      insertionBlocksWithDrawing: countContaining(insBlocks, '<w:drawing'),
      deletionBlocksWithAlternateContent: countContaining(delBlocks, '<mc:AlternateContent'),
      insertionBlocksWithAlternateContent: countContaining(insBlocks, '<mc:AlternateContent'),
      deletionBlocksWithPict: countContaining(delBlocks, '<w:pict'),
      insertionBlocksWithPict: countContaining(insBlocks, '<w:pict'),
    },
    formattingSignals: {
      rPrChangeWithBold: countContaining(rPrChanges, '<w:b'),
      rPrChangeWithFontSize: countContaining(rPrChanges, '<w:sz'),
      rPrChangeWithFontFamily: countContaining(rPrChanges, '<w:rFonts'),
      pPrChangeWithIndent: countContaining(pPrChanges, '<w:ind'),
      pPrChangeWithSpacing: countContaining(pPrChanges, '<w:spacing'),
      pPrChangeWithJustification: countContaining(pPrChanges, '<w:jc'),
    },
  };

  const outputPath = '/tmp/comparison-analysis.json';
  writeFileSync(outputPath, JSON.stringify(report, null, 2));

  console.log(`Analysis written: ${outputPath}`);
  console.log('Document change tags:', report.documentTagCounts);
  console.log('Shape/section signals:', report.shapeSectionSignals);
  console.log('Formatting signals:', report.formattingSignals);
  if (report.comparisonSummary.length > 0) {
    console.log('Comparison summary rows:');
    for (const row of report.comparisonSummary) {
      console.log(`  - ${row.label} ${row.value}`);
    }
  }
}

main().catch((error) => {
  console.error('analyze-comparison-doc failed:', error);
  process.exitCode = 1;
});
