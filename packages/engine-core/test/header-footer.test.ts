// Header/footer story parsing (document-engine task 2.7 partial; OOXML-review
// gap #5). Header/footer part text — previously never read — becomes multi-story
// records.

import { describe, expect, test } from 'bun:test';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { parseDocx } from '../src/index.ts';
import { type ParagraphRecord, type Story } from '../src/index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFF_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function docxWithHeaderFooter(): Uint8Array {
  return zipSync({
    '[Content_Types].xml':
      strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    'word/document.xml': strToU8(`<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>body text</w:t></w:r></w:p></w:body></w:document>`),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${PKG_REL}">` +
        `<Relationship Id="rId1" Type="${OFF_REL}/header" Target="header1.xml"/>` +
        `<Relationship Id="rId2" Type="${OFF_REL}/footer" Target="footer1.xml"/>` +
        `</Relationships>`,
    ),
    'word/header1.xml': strToU8(`<w:hdr xmlns:w="${W}"><w:p><w:r><w:t>the header</w:t></w:r></w:p></w:hdr>`),
    'word/footer1.xml': strToU8(`<w:ftr xmlns:w="${W}"><w:p><w:r><w:t>the footer</w:t></w:r></w:p></w:ftr>`),
  });
}

function storyText(story: Story): string {
  return story.blocks.map((b) => (b as ParagraphRecord).runs.map((r) => r.text).join('')).join('|');
}

describe('header/footer stories', () => {
  test('are parsed into distinct stories with their text', () => {
    const r = parseDocx(docxWithHeaderFooter());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const byKind = new Map<string, Story>();
    for (const s of r.model.stories.values()) byKind.set(s.kind, s);
    expect(byKind.has('body')).toBe(true);
    expect(storyText(byKind.get('header')!)).toBe('the header');
    expect(storyText(byKind.get('footer')!)).toBe('the footer');
  });

  const fixture = join(import.meta.dir, '..', '..', '..', 'e2e', 'fixtures', 'watermark-confidential.docx');
  test.if(existsSync(fixture))('a real fixture with headers/footers yields extra stories', () => {
    const r = parseDocx(new Uint8Array(readFileSync(fixture)));
    expect(r.ok).toBe(true);
    if (r.ok) {
      const kinds = [...r.model.stories.values()].map((s) => s.kind);
      expect(kinds).toContain('body');
      // watermark-confidential has header/footer parts -> more than just the body story.
      expect(r.model.stories.size).toBeGreaterThan(1);
    }
  });
});

describe('footnote / endnote / comment stories', () => {
  function docxWithNotes(): Uint8Array {
    return zipSync({
      '[Content_Types].xml':
        strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
      'word/document.xml': strToU8(`<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>body</w:t></w:r></w:p></w:body></w:document>`),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="${PKG_REL}">` +
          `<Relationship Id="r1" Type="${OFF_REL}/footnotes" Target="footnotes.xml"/>` +
          `<Relationship Id="r2" Type="${OFF_REL}/comments" Target="comments.xml"/>` +
          `</Relationships>`,
      ),
      'word/footnotes.xml': strToU8(
        `<w:footnotes xmlns:w="${W}">` +
          `<w:footnote w:type="separator" w:id="-1"><w:p/></w:footnote>` +
          `<w:footnote w:id="1"><w:p><w:r><w:t>a footnote</w:t></w:r></w:p></w:footnote>` +
          `</w:footnotes>`,
      ),
      'word/comments.xml': strToU8(
        `<w:comments xmlns:w="${W}"><w:comment w:id="0"><w:p><w:r><w:t>a comment</w:t></w:r></w:p></w:comment></w:comments>`,
      ),
    });
  }

  test('footnote and comment part text is recovered as stories', () => {
    const r = parseDocx(docxWithNotes());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const all = [...r.model.stories.values()];
    const footnote = all.find((s) => s.kind === 'footnote')!;
    const comment = all.find((s) => s.kind === 'comment')!;
    expect(storyText(footnote)).toContain('a footnote');
    expect(storyText(comment)).toBe('a comment');
  });

  const endnoteFixture = join(import.meta.dir, '..', '..', '..', 'e2e', 'fixtures', 'endnotes-tracked-changes.docx');
  test.if(existsSync(endnoteFixture))('a real fixture with endnotes yields an endnote story', () => {
    const r = parseDocx(new Uint8Array(readFileSync(endnoteFixture)));
    expect(r.ok).toBe(true);
    if (r.ok) {
      const kinds = [...r.model.stories.values()].map((s) => s.kind);
      expect(kinds).toContain('endnote');
    }
  });
});
