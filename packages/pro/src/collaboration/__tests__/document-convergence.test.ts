/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { strToU8, zipSync } from 'fflate';
import type { CanonicalPrimitiveJournal } from '@docx-editor.dev/core/collaboration/replication';
import { collaborationDocx } from './support.ts';
import {
  applyJournal,
  collectKind,
  concurrent,
  destroyReplica,
  findText,
  findTextContaining,
  joinReplica,
  loadFixture,
  loadPackage,
  nodeText,
  packageFingerprint,
  packageOf,
  parentOf,
  seedReplica,
  spliceTextJournal,
  WML,
  W14,
} from './document-support.ts';
import { isElementRecord } from '../document/index.ts';

function bodyXml(inner: string): Uint8Array {
  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${WML}" xmlns:w14="${W14}"
 xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="w14">
  <w:body>${inner}<w:sectPr/></w:body>
</w:document>`;
  return zipSync({
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rels),
    'word/document.xml': strToU8(document),
  });
}

function insertParagraphJournal(
  replica: Awaited<ReturnType<typeof seedReplica>>,
  bodyId: string,
  index: number,
  text: string
): CanonicalPrimitiveJournal {
  const paragraphId = replica.mint.take();
  const runId = replica.mint.take();
  const textElId = replica.mint.take();
  const textId = replica.mint.take();
  return {
    effects: [
      {
        kind: 'putNode',
        descriptor: {
          logicalId: paragraphId,
          kind: 'paragraph',
          qname: { namespaceUri: WML, localName: 'p', prefix: 'w' },
        },
      },
      {
        kind: 'putNode',
        descriptor: {
          logicalId: runId,
          kind: 'run',
          qname: { namespaceUri: WML, localName: 'r', prefix: 'w' },
        },
      },
      {
        kind: 'putNode',
        descriptor: {
          logicalId: textElId,
          kind: 'text',
          qname: { namespaceUri: WML, localName: 't', prefix: 'w' },
        },
      },
      { kind: 'putNode', descriptor: { logicalId: textId, kind: 'textValue' } },
      { kind: 'spliceText', logicalId: textId, utf16Start: 0, deleteCount: 0, insert: text },
      {
        kind: 'spliceChildren',
        parentLogicalId: textElId,
        start: 0,
        deleteCount: 0,
        childLogicalIds: [textId],
      },
      {
        kind: 'spliceChildren',
        parentLogicalId: runId,
        start: 0,
        deleteCount: 0,
        childLogicalIds: [textElId],
      },
      {
        kind: 'spliceChildren',
        parentLogicalId: paragraphId,
        start: 0,
        deleteCount: 0,
        childLogicalIds: [runId],
      },
      {
        kind: 'spliceChildren',
        parentLogicalId: bodyId,
        start: index,
        deleteCount: 0,
        childLogicalIds: [paragraphId],
      },
    ],
  };
}

describe('full-document two-replica convergence', () => {
  test('same-offset text and different-paragraph text converge', async () => {
    const left = await seedReplica(loadPackage(collaborationDocx()));
    const right = joinReplica(left);
    try {
      concurrent(
        left,
        right,
        () =>
          applyJournal(
            left,
            spliceTextJournal(findText(packageOf(left), 'Alpha paragraph').id, 5, '[')
          ),
        () =>
          applyJournal(
            right,
            spliceTextJournal(findText(packageOf(right), 'Alpha paragraph').id, 5, ']')
          )
      );
      expect(packageFingerprint(packageOf(left))).toBe(packageFingerprint(packageOf(right)));
      expect(nodeText(collectKind(packageOf(left), 'paragraph')[0]!)).toMatch(/Alpha[\[\]]+/);

      const a = await seedReplica(loadPackage(collaborationDocx()));
      const b = joinReplica(a);
      try {
        concurrent(
          a,
          b,
          () =>
            applyJournal(
              a,
              spliceTextJournal(findText(packageOf(a), 'Alpha paragraph').id, 0, 'L')
            ),
          () =>
            applyJournal(b, spliceTextJournal(findText(packageOf(b), 'Bravo paragraph').id, 0, 'R'))
        );
        expect(packageFingerprint(packageOf(a))).toBe(packageFingerprint(packageOf(b)));
        const texts = collectKind(packageOf(a), 'paragraph').map(nodeText);
        expect(texts[0]).toBe('LAlpha paragraph');
        expect(texts[1]).toBe('RBravo paragraph');
      } finally {
        destroyReplica(a);
        destroyReplica(b);
      }
    } finally {
      destroyReplica(left);
      destroyReplica(right);
    }
  });

  test('attributes and run formatting converge', async () => {
    const left = await seedReplica(loadPackage(collaborationDocx()));
    const right = joinReplica(left);
    try {
      const leftPara = collectKind(packageOf(left), 'paragraph')[0]!;
      const rightPara = collectKind(packageOf(right), 'paragraph')[1]!;
      concurrent(
        left,
        right,
        () =>
          applyJournal(left, {
            effects: [
              {
                kind: 'setAttribute',
                logicalId: leftPara.id,
                qname: { namespaceUri: W14, localName: 'textId', prefix: 'w14' },
                value: 'AAAAAAAA',
              },
            ],
          }),
        () =>
          applyJournal(right, {
            effects: [
              {
                kind: 'setAttribute',
                logicalId: rightPara.id,
                qname: { namespaceUri: W14, localName: 'textId', prefix: 'w14' },
                value: 'BBBBBBBB',
              },
            ],
          })
      );
      expect(packageFingerprint(packageOf(left))).toBe(packageFingerprint(packageOf(right)));
    } finally {
      destroyReplica(left);
      destroyReplica(right);
    }
    const formatBytes = bodyXml(
      `<w:p w14:paraId="11111111"><w:r><w:rPr/><w:t>Format</w:t></w:r></w:p>`
    );
    const formatLeft = await seedReplica(loadPackage(formatBytes));
    const formatRight = joinReplica(formatLeft);
    try {
      const leftRun = collectKind(packageOf(formatLeft), 'run')[0]!;
      const rightRun = collectKind(packageOf(formatRight), 'run')[0]!;
      const leftRpr = leftRun.children.find((child) => child.kind === 'runProperties');
      const rightRpr = rightRun.children.find((child) => child.kind === 'runProperties');
      if (!leftRpr || !rightRpr || leftRpr.kind === 'textValue' || rightRpr.kind === 'textValue') {
        throw new Error('rPr missing');
      }
      concurrent(
        formatLeft,
        formatRight,
        () => {
          const markId = formatLeft.mint.take();
          applyJournal(formatLeft, {
            effects: [
              {
                kind: 'putNode',
                descriptor: {
                  logicalId: markId,
                  kind: 'generic',
                  qname: { namespaceUri: WML, localName: 'b', prefix: 'w' },
                },
              },
              {
                kind: 'spliceChildren',
                parentLogicalId: leftRpr.id,
                start: 0,
                deleteCount: 0,
                childLogicalIds: [markId],
              },
            ],
          });
        },
        () => {
          const markId = formatRight.mint.take();
          applyJournal(formatRight, {
            effects: [
              {
                kind: 'putNode',
                descriptor: {
                  logicalId: markId,
                  kind: 'generic',
                  qname: { namespaceUri: WML, localName: 'i', prefix: 'w' },
                },
              },
              {
                kind: 'spliceChildren',
                parentLogicalId: rightRpr.id,
                start: 0,
                deleteCount: 0,
                childLogicalIds: [markId],
              },
            ],
          });
        }
      );
      expect(packageFingerprint(packageOf(formatLeft))).toBe(
        packageFingerprint(packageOf(formatRight))
      );
      const rPr = collectKind(packageOf(formatLeft), 'run')[0]!.children.find(
        (child) => child.kind === 'runProperties'
      );
      expect(rPr && rPr.kind !== 'textValue' ? rPr.children.length : 0).toBe(2);
    } finally {
      destroyReplica(formatLeft);
      destroyReplica(formatRight);
    }
  });

  test('concurrent attributes on the same node keep both writes', async () => {
    const left = await seedReplica(loadPackage(collaborationDocx()));
    const right = joinReplica(left);
    try {
      const paragraphId = collectKind(packageOf(left), 'paragraph')[0]!.id;
      concurrent(
        left,
        right,
        () =>
          applyJournal(left, {
            effects: [
              {
                kind: 'setAttribute',
                logicalId: paragraphId,
                qname: { namespaceUri: W14, localName: 'textId', prefix: 'w14' },
                value: 'AAAAAAAA',
              },
            ],
          }),
        () =>
          applyJournal(right, {
            effects: [
              {
                kind: 'setAttribute',
                logicalId: paragraphId,
                qname: { namespaceUri: W14, localName: 'customId', prefix: 'w14' },
                value: 'BBBBBBBB',
              },
            ],
          })
      );
      expect(packageFingerprint(packageOf(left))).toBe(packageFingerprint(packageOf(right)));
      const paragraph = collectKind(packageOf(left), 'paragraph')[0]!;
      const textId = paragraph.attributes.find((attribute) => attribute.localName === 'textId');
      const customId = paragraph.attributes.find((attribute) => attribute.localName === 'customId');
      expect(textId?.value).toBe('AAAAAAAA');
      expect(customId?.value).toBe('BBBBBBBB');
    } finally {
      destroyReplica(left);
      destroyReplica(right);
    }
  });

  test('paragraph split, join, and delete converge', async () => {
    const left = await seedReplica(loadPackage(collaborationDocx()));
    const right = joinReplica(left);
    try {
      concurrent(
        left,
        right,
        () => {
          const text = findText(packageOf(left), 'Alpha paragraph');
          const paragraph = parentOf(left.registry, text.id, 'paragraph');
          const body = parentOf(left.registry, paragraph, 'body');
          const bodyRecord = left.registry.record(body);
          if (!bodyRecord || !isElementRecord(bodyRecord)) throw new Error('body');
          applyJournal(left, {
            effects: [
              {
                kind: 'spliceText',
                logicalId: text.id,
                utf16Start: 5,
                deleteCount: text.value.length - 5,
                insert: '',
              },
              ...insertParagraphJournal(
                left,
                body,
                bodyRecord.childIds.indexOf(paragraph) + 1,
                ' paragraph'
              ).effects,
            ],
          });
        },
        () =>
          applyJournal(
            right,
            spliceTextJournal(findText(packageOf(right), 'Bravo paragraph').id, 5, '!')
          )
      );
      expect(packageFingerprint(packageOf(left))).toBe(packageFingerprint(packageOf(right)));
    } finally {
      destroyReplica(left);
      destroyReplica(right);
    }

    const joinLeft = await seedReplica(loadPackage(collaborationDocx()));
    const joinRight = joinReplica(joinLeft);
    try {
      concurrent(
        joinLeft,
        joinRight,
        () => {
          const first = parentOf(
            joinLeft.registry,
            findText(packageOf(joinLeft), 'Alpha paragraph').id,
            'paragraph'
          );
          const second = parentOf(
            joinLeft.registry,
            findText(packageOf(joinLeft), 'Bravo paragraph').id,
            'paragraph'
          );
          const body = parentOf(joinLeft.registry, second, 'body');
          const secondRecord = joinLeft.registry.record(second);
          const bodyRecord = joinLeft.registry.record(body);
          if (!secondRecord || !isElementRecord(secondRecord)) throw new Error('second');
          if (!bodyRecord || !isElementRecord(bodyRecord)) throw new Error('body');
          const firstRecord = joinLeft.registry.record(first);
          if (!firstRecord || !isElementRecord(firstRecord)) throw new Error('first');
          applyJournal(joinLeft, {
            effects: [
              {
                kind: 'spliceChildren',
                parentLogicalId: first,
                start: firstRecord.childIds.length,
                deleteCount: 0,
                childLogicalIds: [...secondRecord.childIds],
              },
              {
                kind: 'spliceChildren',
                parentLogicalId: body,
                start: bodyRecord.childIds.indexOf(second),
                deleteCount: 1,
                childLogicalIds: [],
              },
            ],
          });
        },
        () =>
          applyJournal(
            joinRight,
            spliceTextJournal(findText(packageOf(joinRight), 'Alpha paragraph').id, 5, '*')
          )
      );
      expect(packageFingerprint(packageOf(joinLeft))).toBe(
        packageFingerprint(packageOf(joinRight))
      );
      expect(
        joinLeft.registry.isTombstoned(
          parentOf(
            joinRight.registry,
            findTextContaining(packageOf(joinRight), 'Bravo').id,
            'paragraph'
          )
        ) || collectKind(packageOf(joinLeft), 'paragraph').length < 3
      ).toBe(true);
    } finally {
      destroyReplica(joinLeft);
      destroyReplica(joinRight);
    }

    const delLeft = await seedReplica(loadPackage(collaborationDocx()));
    const delRight = joinReplica(delLeft);
    try {
      concurrent(
        delLeft,
        delRight,
        () => {
          const paragraph = parentOf(
            delLeft.registry,
            findText(packageOf(delLeft), 'Bravo paragraph').id,
            'paragraph'
          );
          const body = parentOf(delLeft.registry, paragraph, 'body');
          const bodyRecord = delLeft.registry.record(body);
          if (!bodyRecord || !isElementRecord(bodyRecord)) throw new Error('body');
          applyJournal(delLeft, {
            effects: [
              {
                kind: 'spliceChildren',
                parentLogicalId: body,
                start: bodyRecord.childIds.indexOf(paragraph),
                deleteCount: 1,
                childLogicalIds: [],
              },
            ],
          });
        },
        () =>
          applyJournal(
            delRight,
            spliceTextJournal(findText(packageOf(delRight), 'Alpha paragraph').id, 0, 'Z')
          )
      );
      expect(packageFingerprint(packageOf(delLeft))).toBe(packageFingerprint(packageOf(delRight)));
      expect(nodeText(collectKind(packageOf(delLeft), 'paragraph')[0]!)).toBe('ZAlpha paragraph');
    } finally {
      destroyReplica(delLeft);
      destroyReplica(delRight);
    }
  });

  test('table row insert and structural move with descendant edit converge', async () => {
    const tableBytes = bodyXml(
      `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid>` +
        `<w:tr><w:tc><w:p w14:paraId="44444444"><w:r><w:t>Cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>` +
        `<w:p w14:paraId="55555555"><w:r><w:t>After</w:t></w:r></w:p>`
    );
    const left = await seedReplica(loadPackage(tableBytes));
    const right = joinReplica(left);
    try {
      concurrent(
        left,
        right,
        () => {
          const table = collectKind(packageOf(left), 'table')[0]!;
          const rowId = left.mint.take();
          const cellId = left.mint.take();
          const paragraphId = left.mint.take();
          const runId = left.mint.take();
          const textElId = left.mint.take();
          const textId = left.mint.take();
          applyJournal(left, {
            effects: [
              {
                kind: 'putNode',
                descriptor: {
                  logicalId: rowId,
                  kind: 'tableRow',
                  qname: { namespaceUri: WML, localName: 'tr', prefix: 'w' },
                },
              },
              {
                kind: 'putNode',
                descriptor: {
                  logicalId: cellId,
                  kind: 'tableCell',
                  qname: { namespaceUri: WML, localName: 'tc', prefix: 'w' },
                },
              },
              {
                kind: 'putNode',
                descriptor: {
                  logicalId: paragraphId,
                  kind: 'paragraph',
                  qname: { namespaceUri: WML, localName: 'p', prefix: 'w' },
                },
              },
              {
                kind: 'putNode',
                descriptor: {
                  logicalId: runId,
                  kind: 'run',
                  qname: { namespaceUri: WML, localName: 'r', prefix: 'w' },
                },
              },
              {
                kind: 'putNode',
                descriptor: {
                  logicalId: textElId,
                  kind: 'text',
                  qname: { namespaceUri: WML, localName: 't', prefix: 'w' },
                },
              },
              { kind: 'putNode', descriptor: { logicalId: textId, kind: 'textValue' } },
              {
                kind: 'spliceText',
                logicalId: textId,
                utf16Start: 0,
                deleteCount: 0,
                insert: 'Row',
              },
              {
                kind: 'spliceChildren',
                parentLogicalId: textElId,
                start: 0,
                deleteCount: 0,
                childLogicalIds: [textId],
              },
              {
                kind: 'spliceChildren',
                parentLogicalId: runId,
                start: 0,
                deleteCount: 0,
                childLogicalIds: [textElId],
              },
              {
                kind: 'spliceChildren',
                parentLogicalId: paragraphId,
                start: 0,
                deleteCount: 0,
                childLogicalIds: [runId],
              },
              {
                kind: 'spliceChildren',
                parentLogicalId: cellId,
                start: 0,
                deleteCount: 0,
                childLogicalIds: [paragraphId],
              },
              {
                kind: 'spliceChildren',
                parentLogicalId: rowId,
                start: 0,
                deleteCount: 0,
                childLogicalIds: [cellId],
              },
              {
                kind: 'spliceChildren',
                parentLogicalId: table.id,
                start: table.children.length,
                deleteCount: 0,
                childLogicalIds: [rowId],
              },
            ],
          });
        },
        () => {
          const table = collectKind(packageOf(right), 'table')[0]!;
          const rowId = right.mint.take();
          applyJournal(right, {
            effects: [
              {
                kind: 'putNode',
                descriptor: {
                  logicalId: rowId,
                  kind: 'tableRow',
                  qname: { namespaceUri: WML, localName: 'tr', prefix: 'w' },
                },
              },
              {
                kind: 'spliceChildren',
                parentLogicalId: table.id,
                start: table.children.length,
                deleteCount: 0,
                childLogicalIds: [rowId],
              },
            ],
          });
        }
      );
      expect(packageFingerprint(packageOf(left))).toBe(packageFingerprint(packageOf(right)));
      expect(collectKind(packageOf(left), 'tableRow').length).toBe(3);
    } finally {
      destroyReplica(left);
      destroyReplica(right);
    }

    const moveBytes = bodyXml(
      `<w:p w14:paraId="66666666"><w:r><w:t>Keep</w:t></w:r><w:r><w:t>MoveMe</w:t></w:r></w:p>` +
        `<w:p w14:paraId="77777777"><w:r><w:t>Dest</w:t></w:r></w:p>`
    );
    const moveLeft = await seedReplica(loadPackage(moveBytes));
    const moveRight = joinReplica(moveLeft);
    try {
      const moved = collectKind(packageOf(moveLeft), 'run').find(
        (run) => nodeText(run) === 'MoveMe'
      )!;
      const dest = collectKind(packageOf(moveLeft), 'paragraph').find((node) =>
        nodeText(node).includes('Dest')
      )!;
      concurrent(
        moveLeft,
        moveRight,
        () =>
          applyJournal(moveLeft, {
            effects: [
              {
                kind: 'moveNode',
                logicalId: moved.id,
                destinationParentLogicalId: dest.id,
                destinationIndex: 1,
              },
            ],
          }),
        () =>
          applyJournal(
            moveRight,
            spliceTextJournal(findText(packageOf(moveRight), 'MoveMe').id, 6, '!')
          )
      );
      expect(packageFingerprint(packageOf(moveLeft))).toBe(
        packageFingerprint(packageOf(moveRight))
      );
      expect(collectKind(packageOf(moveLeft), 'run').some((run) => run.id === moved.id)).toBe(true);
      expect(
        collectKind(packageOf(moveLeft), 'paragraph').some((node) =>
          nodeText(node).includes('MoveMe!')
        )
      ).toBe(true);
    } finally {
      destroyReplica(moveLeft);
      destroyReplica(moveRight);
    }
  });

  test('comment anchors, revisions, content controls, and unknown nodes converge', async () => {
    const cases: Array<{ bytes: Uint8Array; text: string }> = [
      {
        bytes: bodyXml(
          `<w:p w14:paraId="AAAAAAAA"><w:commentRangeStart w:id="1"/><w:r><w:t>Commented</w:t></w:r>` +
            `<w:commentRangeEnd w:id="1"/><w:r><w:commentReference w:id="1"/></w:r></w:p>`
        ),
        text: 'Commented',
      },
      {
        bytes: bodyXml(
          `<w:p w14:paraId="BBBBBBBB"><w:ins w:author="Ada" w:date="2020-01-01T00:00:00Z" w:id="1">` +
            `<w:r><w:t>Inserted</w:t></w:r></w:ins></w:p>`
        ),
        text: 'Inserted',
      },
      {
        bytes: bodyXml(
          `<w:p w14:paraId="CCCCCCCC"><w:sdt><w:sdtPr><w:tag w:val="name"/><w:text/></w:sdtPr>` +
            `<w:sdtContent><w:r><w:t>Bound</w:t></w:r></w:sdtContent></w:sdt></w:p>`
        ),
        text: 'Bound',
      },
      {
        bytes: bodyXml(
          `<w:p w14:paraId="DDDDDDDD"><w:r><w:t>Known</w:t></w:r>` +
            `<demo:marker xmlns:demo="urn:docx-editor:spike">keep</demo:marker></w:p>`
        ),
        text: 'Known',
      },
    ];
    for (const fixture of cases) {
      const left = await seedReplica(loadPackage(fixture.bytes));
      const right = joinReplica(left);
      try {
        concurrent(
          left,
          right,
          () =>
            applyJournal(
              left,
              spliceTextJournal(findText(packageOf(left), fixture.text).id, 0, 'L')
            ),
          () =>
            applyJournal(
              right,
              spliceTextJournal(
                findText(packageOf(right), fixture.text).id,
                fixture.text.length,
                'R'
              )
            )
        );
        expect(packageFingerprint(packageOf(left))).toBe(packageFingerprint(packageOf(right)));
      } finally {
        destroyReplica(left);
        destroyReplica(right);
      }
    }
  });

  test('header, footer, and footnote part edits converge', async () => {
    const header = await loadFixture('titlePg-header-footer.docx');
    const left = await seedReplica(header);
    const right = joinReplica(left);
    try {
      const headerPart = [...packageOf(left).parts.values()].find((part) =>
        part.name.includes('header')
      );
      expect(headerPart).toBeDefined();
      const texts: string[] = [];
      if (headerPart) {
        const walk = (node: import('@docx-editor.dev/core/store').OoxmlNode): void => {
          if (node.kind === 'textValue') {
            if (node.value.trim()) texts.push(node.value);
            return;
          }
          for (const child of node.children) walk(child);
        };
        walk(headerPart.root);
      }
      const target = texts[0] ?? findTextContaining(packageOf(left), ' ').value;
      concurrent(
        left,
        right,
        () =>
          applyJournal(
            left,
            spliceTextJournal(findTextContaining(packageOf(left), target).id, 0, 'H')
          ),
        () =>
          applyJournal(
            right,
            spliceTextJournal(findTextContaining(packageOf(right), target).id, 0, 'F')
          )
      );
      expect(packageFingerprint(packageOf(left))).toBe(packageFingerprint(packageOf(right)));
    } finally {
      destroyReplica(left);
      destroyReplica(right);
    }

    const notes = await loadFixture('footnote-bottom-overflow.docx');
    const noteLeft = await seedReplica(notes);
    const noteRight = joinReplica(noteLeft);
    try {
      const notePart = [...packageOf(noteLeft).parts.values()].find((part) =>
        part.name.includes('footnote')
      );
      expect(notePart).toBeDefined();
      const sample = findTextContaining(packageOf(noteLeft), '');
      concurrent(
        noteLeft,
        noteRight,
        () => applyJournal(noteLeft, spliceTextJournal(sample.id, 0, 'N')),
        () =>
          applyJournal(
            noteRight,
            spliceTextJournal(findTextContaining(packageOf(noteRight), sample.value).id, 0, 'E')
          )
      );
      expect(packageFingerprint(packageOf(noteLeft))).toBe(
        packageFingerprint(packageOf(noteRight))
      );
    } finally {
      destroyReplica(noteLeft);
      destroyReplica(noteRight);
    }
  });

  test('relationship, content-type override, and binary descriptor edits converge', async () => {
    const left = await seedReplica(loadPackage(collaborationDocx()));
    const right = joinReplica(left);
    try {
      const owner = packageOf(left).mainDocumentPart;
      const digest = 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
      const bytes = new Uint8Array([1, 2, 3, 4]);
      left.blobs.put(digest, bytes);
      right.blobs.put(digest, bytes);
      concurrent(
        left,
        right,
        () =>
          applyJournal(left, {
            effects: [
              {
                kind: 'putRelationship',
                owner,
                record: {
                  ownerPart: owner,
                  id: 'rIdLeft',
                  type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
                  rawTarget: 'media/a.png',
                  targetMode: 'Internal',
                  order: 20,
                },
              },
              {
                kind: 'putContentTypeOverride',
                partName: '/word/media/a.png',
                mediaType: 'image/png',
              },
            ],
          }),
        () =>
          applyJournal(right, {
            effects: [
              {
                kind: 'putBinary',
                descriptor: {
                  storageKey: '/word/media/b.png',
                  digest,
                  size: bytes.byteLength,
                  mediaType: 'image/png',
                },
              },
            ],
          })
      );
      expect(packageFingerprint(packageOf(left))).toBe(packageFingerprint(packageOf(right)));
      expect(
        packageOf(left)
          .relationships.get(owner)
          ?.some((record) => record.id === 'rIdLeft')
      ).toBe(true);
      expect(packageOf(left).partBytes.get('/word/media/b.png')?.byteLength).toBe(4);
    } finally {
      destroyReplica(left);
      destroyReplica(right);
    }
  });

  test('forward and reversed delivery converge to the same fingerprint', async () => {
    const source = await seedReplica(loadPackage(collaborationDocx()));
    try {
      const left = joinReplica(source, 3);
      const right = joinReplica(source, 4);
      const { leftUpdate, rightUpdate } = concurrent(
        left,
        right,
        () =>
          applyJournal(
            left,
            spliceTextJournal(findText(packageOf(left), 'Alpha paragraph').id, 0, 'A')
          ),
        () =>
          applyJournal(
            right,
            spliceTextJournal(findText(packageOf(right), 'Bravo paragraph').id, 0, 'B')
          ),
        'left-right'
      );
      const replay = joinReplica(source, 5);
      try {
        Y.applyUpdate(replay.doc, rightUpdate, 'rev');
        Y.applyUpdate(replay.doc, leftUpdate, 'rev');
        const rebuilt = replay.materializer.rebuild();
        if (!rebuilt.ok) throw new Error(rebuilt.code);
        expect(packageFingerprint(rebuilt.package)).toBe(packageFingerprint(packageOf(left)));
      } finally {
        destroyReplica(replay);
      }
      destroyReplica(left);
      destroyReplica(right);
    } finally {
      destroyReplica(source);
    }
  });
});
