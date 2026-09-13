/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { describe, expect, test } from 'bun:test';
import {
  canonicalOoxmlFingerprint,
  normalizeParagraphIdentity,
  readOoxmlPackage,
} from '@docx-editor.dev/core/store';
import { openBaselinePackage } from '../document-bootstrap.ts';
import { W, zipDocument } from './document-peer-support.ts';

const paragraph = '<w:p><w:r><w:t>Text</w:t></w:r></w:p>';
const xml = (root: string, content = paragraph) =>
  `<w:${root} xmlns:w="${W}">${content}</w:${root}>`;

const bytes = () =>
  zipDocument(paragraph + '<w:sectPr/>', {
    extraXml: {
      'word/header1.xml': xml('hdr'),
      'word/footer1.xml': xml('ftr'),
      'word/footnotes.xml': xml('footnotes', `<w:footnote w:id="1">${paragraph}</w:footnote>`),
      'word/endnotes.xml': xml('endnotes', `<w:endnote w:id="1">${paragraph}</w:endnote>`),
      'word/comments.xml': xml('comments', `<w:comment w:id="1">${paragraph}</w:comment>`),
      'customXml/item1.xml': xml('customXml'),
      'customXml/item2.xml': `<hdr xmlns="urn:custom" xmlns:w="${W}">${paragraph}</hdr>`,
    },
  });

describe('collaboration baseline story identity', () => {
  test('normalizes body, headers, and footers before they are opened locally', () => {
    const baseline = openBaselinePackage(bytes());
    for (const name of ['document', 'header1', 'footer1']) {
      const part = baseline.parts.get(`/word/${name}.xml`)!;
      expect(part).toBeDefined();
      // A lazy story open must have no identity changes left to make.
      expect(normalizeParagraphIdentity(part)).toBe(part);
    }
  });

  test('preserves notes and non-story XML, including lookalike roots and embedded paragraphs', () => {
    const document = bytes();
    const original = readOoxmlPackage(document);
    if (!original.ok) throw new Error(original.reason);
    const baseline = openBaselinePackage(document);
    for (const name of [
      '/word/footnotes.xml',
      '/word/endnotes.xml',
      '/word/comments.xml',
      '/customXml/item1.xml',
      '/customXml/item2.xml',
    ]) {
      expect(canonicalOoxmlFingerprint(baseline.parts.get(name)!)).toBe(
        canonicalOoxmlFingerprint(original.package.parts.get(name)!)
      );
    }
  });
});
