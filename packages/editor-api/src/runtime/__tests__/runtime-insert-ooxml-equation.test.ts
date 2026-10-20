/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// `Range.insertOoxml` with one equation: every location, tracked and untracked, the review
// decisions, and the refusals for every other OOXML shape.
import { describe, expect, test } from 'bun:test';
import { strFromU8, unzipSync } from 'fflate';
import { DocxEditor, type DocxEditorServerRuntime, type RequestContext } from '../../index.ts';
import {
  documentPart,
  equationPackage,
  flatOpc,
  RELS_PART,
  X_SQUARED,
} from './support/flat-opc.ts';
import { docx, p } from './support/docx.ts';

const AUTHOR = 'Math agent';
const SAMPLE = docx(p('Let x be real.') + p('Second paragraph.'));
const OBJECT = '\uFFFC';

async function documentXml(runtime: DocxEditorServerRuntime): Promise<string> {
  return strFromU8(unzipSync(await runtime.save())['word/document.xml']!);
}

async function bodyText(c: RequestContext): Promise<string> {
  c.document.body.load('text');
  await c.sync();
  return c.document.body.text;
}

type Location = 'Before' | 'After' | 'Start' | 'End' | 'Replace';

/** Insert `ooxml` at `location` of the word "x"; answer the returned range's text. */
async function insertAtX(
  runtime: DocxEditorServerRuntime,
  location: Location,
  tracked: boolean,
  ooxml = equationPackage()
): Promise<string> {
  return runtime.run(async (c) => {
    if (tracked) c.document.changeTrackingMode = 'TrackMineOnly';
    const inserted = c.document.body.search('x').getFirst().insertOoxml(ooxml, location);
    await c.sync();
    inserted.load('text');
    await c.sync();
    return inserted.text;
  });
}

const EXPECTED: Readonly<
  Record<Location, { readonly accepted: string; readonly paragraph: string }>
> = {
  Before: { accepted: `Let ${OBJECT}x be real.`, paragraph: `Let ${OBJECT}x be real.` },
  Start: { accepted: `Let ${OBJECT}x be real.`, paragraph: `Let ${OBJECT}x be real.` },
  After: { accepted: `Let x${OBJECT} be real.`, paragraph: `Let x${OBJECT} be real.` },
  End: { accepted: `Let x${OBJECT} be real.`, paragraph: `Let x${OBJECT} be real.` },
  Replace: { accepted: `Let ${OBJECT} be real.`, paragraph: `Let x${OBJECT} be real.` },
};

describe('insertOoxml inserts one equation', () => {
  for (const location of ['Before', 'After', 'Start', 'End', 'Replace'] as const) {
    test(`${location}: untracked insertion reads as U+FFFC and survives reopen`, async () => {
      const runtime = await DocxEditor.createServer(SAMPLE);
      try {
        expect(await insertAtX(runtime, location, false)).toBe(OBJECT);
        await runtime.run(async (c) => {
          expect(await bodyText(c)).toBe(`${EXPECTED[location].accepted}\rSecond paragraph.`);
        });
        const xml = await documentXml(runtime);
        expect(xml).not.toMatch(/<w:ins[ >]/);
        expect(xml).toContain('<m:oMath><m:sSup><m:e><m:r><m:t>x</m:t>');
        const reopened = await DocxEditor.createServer(await runtime.save());
        try {
          await reopened.run(async (c) => {
            expect(await bodyText(c)).toBe(`${EXPECTED[location].accepted}\rSecond paragraph.`);
          });
        } finally {
          reopened.dispose();
        }
      } finally {
        runtime.dispose();
      }
    });

    test(`${location}: tracked insertion is one w:ins that accept keeps and reject removes`, async () => {
      const runtime = await DocxEditor.createServer(SAMPLE, { author: AUTHOR });
      try {
        expect(await insertAtX(runtime, location, true)).toBe(OBJECT);
        const xml = await documentXml(runtime);
        expect(xml).toMatch(new RegExp(`<w:ins [^>]*w:author="${AUTHOR}"[^>]*><m:oMath><m:sSup>`));
        expect(xml.match(/<w:ins /g)).toHaveLength(1);
        await runtime.run(async (c) => {
          expect(await bodyText(c)).toBe(`${EXPECTED[location].paragraph}\rSecond paragraph.`);
          const reviewed = c.document.body.paragraphs.getFirst().getRange('Whole');
          const current = reviewed.getReviewedText('Current');
          const original = reviewed.getReviewedText('Original');
          await c.sync();
          expect(current.value).toBe(EXPECTED[location].accepted);
          expect(original.value).toBe('Let x be real.');
        });
        const bytes = await runtime.save();
        for (const decision of ['accept', 'reject'] as const) {
          const reopened = await DocxEditor.createServer(bytes, { author: 'Reviewer' });
          try {
            await reopened.run(async (c) => {
              if (decision === 'accept') c.document.body.revisions.acceptAll();
              else c.document.body.revisions.rejectAll();
              await c.sync();
              expect(await bodyText(c)).toBe(
                decision === 'accept'
                  ? `${EXPECTED[location].accepted}\rSecond paragraph.`
                  : 'Let x be real.\rSecond paragraph.'
              );
            });
            const decided = await documentXml(reopened);
            expect(decided).not.toMatch(/<w:(ins|del)[ >]/);
            if (decision === 'reject') expect(decided).not.toContain('oMath');
            else expect(decided).toContain('<m:oMath>');
          } finally {
            reopened.dispose();
          }
        }
      } finally {
        runtime.dispose();
      }
    });
  }

  test('plain runs around the equation keep their own formatting, tracked too', async () => {
    const runtime = await DocxEditor.createServer(SAMPLE, { author: AUTHOR });
    try {
      const ooxml = equationPackage(
        `<w:r w:rsidR="00A1"><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">where </w:t></w:r>` +
          X_SQUARED +
          '<w:r><w:tab/><w:t>holds</w:t></w:r>'
      );
      expect(await insertAtX(runtime, 'After', true, ooxml)).toBe(`where ${OBJECT}\tholds`);
      const xml = await documentXml(runtime);
      expect(xml).toMatch(
        /<w:ins [^>]*><w:r><w:rPr><w:i\/><\/w:rPr><w:t xml:space="preserve">where <\/w:t><\/w:r><m:oMath>.*<\/m:oMath><w:r><w:tab\/><w:t>holds<\/w:t><\/w:r><\/w:ins>/
      );
      expect(xml).not.toContain('rsid');
    } finally {
      runtime.dispose();
    }
  });

  test('Replace across paragraphs refuses, tracked or not', async () => {
    const runtime = await DocxEditor.createServer(SAMPLE, { author: AUTHOR });
    try {
      const before = await documentXml(runtime);
      for (const tracked of [false, true]) {
        await expect(
          runtime.run(async (c) => {
            if (tracked) c.document.changeTrackingMode = 'TrackMineOnly';
            c.document.body.getRange('Whole').insertOoxml(equationPackage(), 'Replace');
            await c.sync();
          })
        ).rejects.toMatchObject({ code: 'InvalidArgument' });
      }
      expect(await documentXml(runtime)).toBe(before);
    } finally {
      runtime.dispose();
    }
  });
});

describe('insertOoxml inside inline containers', () => {
  const LINKED = docx(
    '<w:p><w:r><w:t xml:space="preserve">See </w:t></w:r><w:hyperlink w:anchor="a">' +
      '<w:r><w:t>linked x words</w:t></w:r></w:hyperlink><w:r><w:t xml:space="preserve"> end.</w:t></w:r></w:p>'
  );
  const CONTROL = (lock = '') =>
    docx(
      '<w:p><w:r><w:t xml:space="preserve">Before </w:t></w:r><w:sdt><w:sdtPr>' +
        `${lock}<w:richText/></w:sdtPr><w:sdtContent><w:r><w:t>control x text</w:t></w:r>` +
        '</w:sdtContent></w:sdt><w:r><w:t xml:space="preserve"> after</w:t></w:r></w:p>'
    );

  for (const tracked of [false, true]) {
    const mode = tracked ? 'tracked' : 'untracked';
    test(`${mode}: mid-hyperlink`, async () => {
      const runtime = await DocxEditor.createServer(LINKED, { author: AUTHOR });
      try {
        expect(await insertAtX(runtime, 'After', tracked)).toBe(OBJECT);
        await runtime.run(async (c) => {
          expect(await bodyText(c)).toBe(`See linked x${OBJECT} words end.`);
        });
        const reopened = await DocxEditor.createServer(await runtime.save(), { author: 'R' });
        try {
          await reopened.run(async (c) => {
            if (tracked) c.document.body.revisions.rejectAll();
            await c.sync();
            expect(await bodyText(c)).toBe(
              tracked ? 'See linked x words end.' : `See linked x${OBJECT} words end.`
            );
          });
        } finally {
          reopened.dispose();
        }
      } finally {
        runtime.dispose();
      }
    });

    test(`${mode}: inside a rich text content control`, async () => {
      const runtime = await DocxEditor.createServer(CONTROL(), { author: AUTHOR });
      try {
        expect(await insertAtX(runtime, 'After', tracked)).toBe(OBJECT);
        await runtime.run(async (c) => {
          expect(await bodyText(c)).toBe(`Before control x${OBJECT} text after`);
          const controls = c.document.body.contentControls;
          controls.load('items');
          await c.sync();
          expect(controls.items).toHaveLength(1);
        });
        // The equation is inside the one control.
        expect(await documentXml(runtime)).toMatch(
          /<w:sdtContent>(?:(?!<\/w:sdtContent>).)*<m:oMath>(?:(?!<\/w:sdtContent>).)*control x(?:(?!<\/w:sdtContent>).)*<\/w:sdtContent>|<w:sdtContent>(?:(?!<\/w:sdtContent>).)*control x(?:(?!<\/w:sdtContent>).)*<m:oMath>/
        );
      } finally {
        runtime.dispose();
      }
    });

    test(`${mode}: inside a content-locked control refuses`, async () => {
      const runtime = await DocxEditor.createServer(CONTROL('<w:lock w:val="contentLocked"/>'), {
        author: AUTHOR,
      });
      try {
        const before = await documentXml(runtime);
        await expect(insertAtX(runtime, 'After', tracked)).rejects.toMatchObject({
          code: 'InvalidArgument',
          debugInfo: { innerError: { code: 'edit.protected-content' } },
        });
        expect(await documentXml(runtime)).toBe(before);
      } finally {
        runtime.dispose();
      }
    });
  }

  test("tracked: right after the author's own pending insertion joins it", async () => {
    const runtime = await DocxEditor.createServer(SAMPLE, { author: AUTHOR });
    try {
      await runtime.run(async (c) => {
        c.document.changeTrackingMode = 'TrackMineOnly';
        const typed = c.document.body.search('x').getFirst().insertText(' and y', 'After');
        await c.sync();
        typed.insertOoxml(equationPackage(), 'After');
        await c.sync();
        expect(await bodyText(c)).toBe(`Let x and y${OBJECT} be real.\rSecond paragraph.`);
        c.document.body.revisions.load('items');
        await c.sync();
        c.document.body.revisions.rejectAll();
        await c.sync();
        expect(await bodyText(c)).toBe('Let x be real.\rSecond paragraph.');
      });
    } finally {
      runtime.dispose();
    }
  });
});

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const PKG = 'http://schemas.microsoft.com/office/2006/xmlPackage';
const nested = (depth: number): string =>
  '<m:oMath>' +
  '<m:f><m:num>'.repeat(depth) +
  '<m:r><m:t>1</m:t></m:r>' +
  '</m:num><m:den><m:r><m:t>2</m:t></m:r></m:den></m:f>'.repeat(depth) +
  '</m:oMath>';

const REFUSED: readonly {
  readonly name: string;
  readonly ooxml: string;
  readonly code: 'NotSupported' | 'InvalidArgument';
  readonly inner: string;
}[] = [
  {
    name: 'two paragraphs',
    ooxml: flatOpc(RELS_PART + documentPart(`<w:p>${X_SQUARED}</w:p><w:p>${X_SQUARED}</w:p>`)),
    code: 'NotSupported',
    inner: 'edit.ooxml-unsupported',
  },
  {
    name: 'two equations',
    ooxml: equationPackage(X_SQUARED + X_SQUARED),
    code: 'NotSupported',
    inner: 'edit.ooxml-unsupported',
  },
  {
    name: 'no equation',
    ooxml: equationPackage('<w:r><w:t>plain</w:t></w:r>'),
    code: 'NotSupported',
    inner: 'edit.ooxml-unsupported',
  },
  {
    name: 'a display equation',
    ooxml: equationPackage(`<m:oMathPara>${X_SQUARED}</m:oMathPara>`),
    code: 'NotSupported',
    inner: 'edit.ooxml-unsupported',
  },
  {
    name: 'paragraph properties',
    ooxml: equationPackage(`<w:pPr><w:jc w:val="center"/></w:pPr>${X_SQUARED}`),
    code: 'NotSupported',
    inner: 'edit.ooxml-unsupported',
  },
  {
    name: 'a section break',
    ooxml: flatOpc(RELS_PART + documentPart(`<w:p>${X_SQUARED}</w:p><w:sectPr/>`)),
    code: 'NotSupported',
    inner: 'edit.ooxml-unsupported',
  },
  {
    name: 'an image part',
    ooxml: flatOpc(
      RELS_PART +
        documentPart(`<w:p>${X_SQUARED}</w:p>`) +
        '<pkg:part pkg:name="/word/media/image1.png" pkg:contentType="image/png">' +
        '<pkg:binaryData>iVBORw0KGgo=</pkg:binaryData></pkg:part>'
    ),
    code: 'NotSupported',
    inner: 'edit.ooxml-unsupported',
  },
  {
    name: 'a document relationships part',
    ooxml: flatOpc(
      RELS_PART +
        documentPart(`<w:p>${X_SQUARED}</w:p>`) +
        '<pkg:part pkg:name="/word/_rels/document.xml.rels" ' +
        'pkg:contentType="application/vnd.openxmlformats-package.relationships+xml"><pkg:xmlData>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>' +
        '</pkg:xmlData></pkg:part>'
    ),
    code: 'NotSupported',
    inner: 'edit.ooxml-unsupported',
  },
  {
    name: 'an external relationship target',
    ooxml: flatOpc(
      RELS_PART.replace(
        'Target="word/document.xml"',
        'Target="https://example.com/a.xml" TargetMode="External"'
      ) + documentPart(`<w:p>${X_SQUARED}</w:p>`)
    ),
    code: 'NotSupported',
    inner: 'edit.ooxml-unsupported',
  },
  {
    name: 'a picture in a run',
    ooxml: equationPackage(`<w:r><w:drawing/></w:r>${X_SQUARED}`),
    code: 'NotSupported',
    inner: 'edit.ooxml-unsupported',
  },
  {
    name: 'a field in a run',
    ooxml: equationPackage(`<w:r><w:fldChar w:fldCharType="begin"/></w:r>${X_SQUARED}`),
    code: 'NotSupported',
    inner: 'edit.ooxml-unsupported',
  },
  {
    name: 'a hyperlink',
    ooxml: equationPackage(
      `<w:hyperlink w:anchor="a"><w:r><w:t>a</w:t></w:r></w:hyperlink>${X_SQUARED}`
    ),
    code: 'NotSupported',
    inner: 'edit.ooxml-unsupported',
  },
  {
    name: 'an unknown math element',
    ooxml: equationPackage('<m:oMath><m:script><m:r><m:t>x</m:t></m:r></m:script></m:oMath>'),
    code: 'NotSupported',
    inner: 'edit.ooxml-unsupported',
  },
  {
    name: 'a foreign attribute on math',
    ooxml: equationPackage(`<m:oMath><m:r w:rsidR="1"><m:t>x</m:t></m:r></m:oMath>`),
    code: 'NotSupported',
    inner: 'edit.ooxml-unsupported',
  },
  {
    name: 'a tracked change inside the snippet',
    ooxml: equationPackage(
      `<w:ins w:id="1" w:author="X" w:date="2026-01-01T00:00:00Z"><w:r><w:t>a</w:t></w:r></w:ins>${X_SQUARED}`
    ),
    code: 'NotSupported',
    inner: 'edit.ooxml-unsupported',
  },
  {
    name: 'a bare document without a package',
    ooxml: `<w:document xmlns:w="${W}"><w:body><w:p/></w:body></w:document>`,
    code: 'NotSupported',
    inner: 'edit.ooxml-unsupported',
  },
  {
    name: 'a DTD',
    ooxml: `<?xml version="1.0"?><!DOCTYPE pkg:package [<!ENTITY a "b">]><pkg:package xmlns:pkg="${PKG}"/>`,
    code: 'InvalidArgument',
    inner: 'edit.invalid-argument',
  },
  {
    name: 'an entity reference',
    ooxml: equationPackage('<m:oMath><m:r><m:t>&ext;</m:t></m:r></m:oMath>'),
    code: 'InvalidArgument',
    inner: 'edit.invalid-argument',
  },
  {
    name: 'malformed XML',
    ooxml: equationPackage('<m:oMath><m:r><m:t>x</m:r></m:oMath>'),
    code: 'InvalidArgument',
    inner: 'edit.invalid-argument',
  },
  {
    name: 'an oversize package',
    ooxml: equationPackage(`<w:r><w:t>${'a'.repeat(300 * 1024)}</w:t></w:r>${X_SQUARED}`),
    code: 'InvalidArgument',
    inner: 'edit.resource-limit',
  },
  {
    name: 'deep nesting',
    ooxml: equationPackage(nested(40)),
    code: 'InvalidArgument',
    inner: 'edit.resource-limit',
  },
];

describe('insertOoxml refusals', () => {
  for (const { name, ooxml, code, inner } of REFUSED) {
    for (const tracked of [false, true]) {
      test(`${name} ${tracked ? 'tracked' : 'untracked'} refuses and changes nothing`, async () => {
        const runtime = await DocxEditor.createServer(SAMPLE, { author: AUTHOR });
        try {
          const before = await documentXml(runtime);
          await expect(insertAtX(runtime, 'After', tracked, ooxml)).rejects.toMatchObject({
            code,
            debugInfo: { innerError: { code: inner } },
          });
          expect(await documentXml(runtime)).toBe(before);
        } finally {
          runtime.dispose();
        }
      });
    }
  }

  test('a non-string argument refuses at the call', async () => {
    const runtime = await DocxEditor.createServer(SAMPLE);
    try {
      await expect(
        runtime.run(async (c) => {
          c.document.body
            .search('x')
            .getFirst()
            .insertOoxml(42 as unknown as string, 'After');
          await c.sync();
        })
      ).rejects.toMatchObject({ code: 'InvalidArgument' });
    } finally {
      runtime.dispose();
    }
  });

  test("a tracked equation inside another author's pending insertion's container refuses", async () => {
    const pending = docx(
      '<w:p><w:ins w:id="5" w:author="Other" w:date="2026-01-01T00:00:00Z">' +
        '<w:hyperlink w:anchor="a"><w:r><w:t>linked x words</w:t></w:r></w:hyperlink></w:ins></w:p>'
    );
    const runtime = await DocxEditor.createServer(pending, { author: AUTHOR });
    try {
      const before = await documentXml(runtime);
      await expect(insertAtX(runtime, 'After', true)).rejects.toMatchObject({
        code: 'NotImplemented',
      });
      expect(await documentXml(runtime)).toBe(before);
    } finally {
      runtime.dispose();
    }
  });
});
