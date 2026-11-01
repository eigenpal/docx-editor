// A warm footnote pass publishes the pages a fresh pass does (issue #1761).
//
// The reserve of a page and its body decide each other, and more than one reserve can agree
// with its own body. These seeded documents mix keep-with-next, widow control, space after
// and notes of one to six lines on a small page, then take typed edits one at a time. After
// each edit, a pass over the retained session must publish exactly the pages that a pass with
// no session publishes over the same tree.
import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { resolveNotesPart } from '../../store/package/note-references.ts';
import {
  resolveEndnoteProperties,
  resolveFootnoteProperties,
} from '../../store/package/note-properties.ts';
import { TreeDocumentStore } from '../../store/index.ts';
import type { OoxmlElement, OoxmlPart } from '../../store/index.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { createLayoutSession, type LayoutSession } from '../layout-session.ts';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import type { SemanticLayout } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const EXACT = '<w:spacing w:line="240" w:lineRule="exact"';
const INDENTS = ['', '', '<w:ind w:left="720"/>', '<w:ind w:left="720" w:hanging="360"/>'];

function random(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
}

function documentBytes(next: () => number): Uint8Array {
  const count = 20 + Math.floor(next() * 40);
  const notes: number[] = [];
  const body: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const words = 1 + Math.floor(next() * 30);
    const indent = INDENTS[Math.floor(next() * INDENTS.length)]!;
    const keepNext = next() < 0.2 ? '<w:keepNext/>' : '';
    const widow = next() < 0.5 ? 1 : 0;
    const after = [0, 0, 6, 10][Math.floor(next() * 4)]! * 20;
    let cite = '';
    if (next() < 0.25) {
      notes.push(1 + Math.floor(next() * 6));
      cite = `<w:r><w:footnoteReference w:id="${notes.length}"/></w:r>`;
    }
    const text = Array.from({ length: words }, (_, k) => `w${i}x${k}`).join(' ');
    body.push(
      `<w:p><w:pPr>${keepNext}<w:widowControl w:val="${widow}"/>${EXACT} w:after="${after}"/>` +
        `${indent}</w:pPr><w:r><w:t xml:space="preserve">${text}</w:t></w:r>${cite}</w:p>`
    );
  }
  const note = (lines: number, k: number) =>
    `<w:footnote w:id="${k + 1}"><w:p><w:pPr><w:widowControl/>${EXACT} w:after="0"/></w:pPr>` +
    `<w:r><w:t>${'n'.repeat(Math.max(1, lines * 40 - 5))}</w:t></w:r></w:p></w:footnote>`;
  const separator = (type: string, id: number) =>
    `<w:footnote w:type="${type}" w:id="${id}"><w:p><w:pPr>${EXACT} w:after="0"/></w:pPr>` +
    `<w:r><w:${type}/></w:r></w:p></w:footnote>`;
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rIdFn" Type="${R}/footnotes" Target="footnotes.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body.join('')}<w:sectPr>` +
        '<w:pgSz w:w="4000" w:h="6000"/><w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0" w:header="0" w:footer="0"/>' +
        '</w:sectPr></w:body></w:document>'
    ),
    'word/footnotes.xml': strToU8(
      `<w:footnotes xmlns:w="${W}">${separator('separator', -1)}` +
        `${separator('continuationSeparator', 0)}${notes.map(note).join('')}</w:footnotes>`
    ),
  });
}

const measurer = createFixedMeasurer(5, 12);

function lay(
  part: OoxmlPart,
  footnotesPart: OoxmlPart | null,
  mode: number,
  revision: number,
  session?: LayoutSession
): SemanticLayout {
  const footnoteProps = resolveFootnoteProperties(undefined, undefined);
  const endnoteProps = resolveEndnoteProperties(undefined, undefined);
  return layoutSemanticDocument(part, revision, {
    measurer,
    notes: {
      footnotesPart,
      endnotesPart: null,
      footnotePropsBySection: [footnoteProps],
      endnotePropsBySection: [endnoteProps],
      documentFootnoteProps: footnoteProps,
      documentEndnoteProps: endnoteProps,
      measurer,
      producer: 'footnote-warm-equals-fresh',
    },
    ...(session ? { session } : {}),
    producer: 'footnote-warm-equals-fresh',
    compatibilityMode: mode,
  });
}

function paragraphIds(part: OoxmlPart): string[] {
  const body = part.root.children.find(
    (child): child is OoxmlElement => child.kind !== 'textValue' && child.localName === 'body'
  );
  return (body?.children ?? []).flatMap((child) =>
    child.kind !== 'textValue' && child.localName === 'p' ? [child.id] : []
  );
}

describe('a warm footnote pass matches a fresh one after each edit', () => {
  for (const mode of [15, 14]) {
    test(`compatibility mode ${mode}`, () => {
      const mismatches: string[] = [];
      for (let seed = 1; seed <= 12; seed += 1) {
        const next = random(seed * 7919 + mode);
        const loaded = readOoxmlPackage(documentBytes(next));
        if (!loaded.ok) throw new Error(loaded.reason);
        const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
        const footnotesPart = resolveNotesPart(loaded.package, 'footnote');
        const store = new TreeDocumentStore(part);
        const session = createLayoutSession();
        lay(store.part, footnotesPart, mode, 1, session);
        for (let step = 0; step < 10; step += 1) {
          const ids = paragraphIds(store.part);
          const paragraphId = ids[Math.floor(next() * ids.length)]!;
          const text = next() < 0.5 ? 'abc ' : 'a thirty-eight character phrase here. ';
          const result = store.transact((tx) =>
            tx.apply({ op: 'insertText', paragraphId, offset: 0, text })
          );
          expect(result.ok).toBe(true);
          const warm = lay(store.part, footnotesPart, mode, step + 2, session);
          const fresh = lay(store.part, footnotesPart, mode, step + 2);
          if (JSON.stringify(warm.pages) !== JSON.stringify(fresh.pages)) {
            mismatches.push(`seed ${seed} step ${step}`);
            break;
          }
        }
      }
      expect(mismatches).toEqual([]);
    }, 60000);
  }
});
